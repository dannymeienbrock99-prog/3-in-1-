namespace FanAtlas;

// The suite already has an editor. Its sensor service needs no Window, controls,
// image decoders, history charts or WPF rendering/GPU resources.
internal sealed class SuiteSensorHost : IAsyncDisposable
{
    private readonly AppState state;
    private readonly List<SensorRow> sensors = new();
    private readonly NvidiaReader nvidia = new();
    private readonly WindowsSensors windows = new();
    private readonly HwinfoReader hwinfo = new();
    private readonly CsvReader csv = new();
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly CancellationTokenSource stop = new();
    private readonly LocalBridge bridge;
    private Task? loop;
    private string selectedId, pollError = "";

    internal SuiteSensorHost(AppState state)
    {
        this.state = state;
        selectedId = state.CustomCurves.Concat(state.Profile.Curves).FirstOrDefault()?.Id ?? "";
        bridge = new LocalBridge(state.Bridge, id => Locked(() =>
        {
            if (!state.CustomCurves.Concat(state.Profile.Curves).Any(c => c.Id == id)) return (false, "Kurve nicht gefunden.");
            selectedId = id; Publish();
            return (true, "Entwurf ausgewählt; keine Hardwareänderung. Für echte Wechsel die offizielle iCUE-Aktion verwenden.");
        }));
        bridge.Catalog = () => Locked(() => (object)new
        {
            state = Snapshot(),
            curves = state.CustomCurves.Concat(state.Profile.Curves).Select(c => new { c.Id, c.Name, c.SensorLabel, c.IsCustom, Points = c.Points.ToArray() }).ToArray(),
            fans = state.Profile.Fans.Select(f => new { f.Key, f.Name, f.CurveId, f.CurveName }).ToArray(),
            profile = new { state.Profile.Name, state.Profile.ImportedAt },
            csvPaths = state.CsvPaths.ToArray(), overlayUrl = bridge.OverlayUrl,
            sources = new { icue = IcueDiscovery.Status, nvidia = nvidia.Status, hwinfo = hwinfo.Status, csv = csv.Messages.ToArray(), error = pollError }
        });
        bridge.Configure = (command, body) => Locked(() =>
        {
            var curve = SuiteState.ConfigureAndSave(state, sensors, command, body);
            if (command == "profile") selectedId = "";
            if (curve != null) selectedId = curve.Id;
            Publish();
            return (object)new { ok = true, hardwareApplied = false, curveId = curve?.Id };
        });
    }

    private async Task<T> Locked<T>(Func<T> action)
    {
        await gate.WaitAsync(stop.Token).ConfigureAwait(false);
        try { return action(); }
        finally { gate.Release(); }
    }
    private BridgeSnapshot Snapshot() => SuiteState.Snapshot(state, sensors, selectedId);
    private void Publish() => bridge.Publish(Snapshot());
    internal async Task Start()
    {
        Publish(); StateStore.Save(state); await bridge.Start().ConfigureAwait(false);
        loop = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
            try
            {
                do { await Locked(() => { Poll(); return true; }).ConfigureAwait(false); }
                while (await timer.WaitForNextTickAsync(stop.Token).ConfigureAwait(false));
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        });
    }
    private void Poll()
    {
        try
        {
            IcueDiscovery.DiscoverLogs(state);
            var values = state.NvidiaEnabled ? nvidia.Read() : new List<Measurement>();
            values.AddRange(windows.Read()); values.AddRange(hwinfo.Read()); values.AddRange(csv.Read(state.CsvPaths.ToArray()));
            foreach (var value in values)
            {
                var row = sensors.FirstOrDefault(s => s.Key == value.Key);
                if (row == null) { row = new(value); sensors.Add(row); }
                row.Update(value, state.StaleSeconds);
            }
            sensors.RemoveAll(s => s.Key.StartsWith("nvml/") && !state.NvidiaEnabled
                || s.Key.StartsWith("csv/") && !state.CsvPaths.Any(p => s.Key.StartsWith("csv/" + System.IO.Path.GetFullPath(p).ToUpperInvariant() + "/")));
            foreach (var row in sensors) row.Refresh(state.StaleSeconds);
            if (FanDiscovery.Refresh(state, sensors)) StateStore.Save(state);
            pollError = "";
        }
        catch (Exception error)
        {
            pollError = "Messwerte konnten nicht aktualisiert werden: " + error.Message;
            foreach (var row in sensors) row.Refresh(state.StaleSeconds);
        }
        Publish();
    }
    public async ValueTask DisposeAsync()
    {
        stop.Cancel();
        if (loop != null) await loop.ConfigureAwait(false);
        await bridge.DisposeAsync().ConfigureAwait(false);
        nvidia.Dispose(); stop.Dispose(); gate.Dispose();
    }
}
