using System.Text.Json;
namespace Batto.DesktopFanControl;

internal sealed class FanEngine(IFanBackend backend, Func<DateTimeOffset> clock)
{
    private readonly Dictionary<string, FanAssignment> assignments = new(StringComparer.Ordinal);
    private readonly HashSet<string> owned = new(StringComparer.Ordinal);
    private DateTimeOffset heartbeat = clock();
    private bool enabled;
    internal bool ShouldExit { get; private set; }
    internal FanState Snapshot()
    {
        bool fresh = backend.Sensors.Any(s => IsFresh(s, clock()));
        return new(enabled, backend.Channels, backend.Sensors, assignments.Values.ToArray(), !enabled && owned.Count != 0,
            CurveAvailability: new(fresh, fresh ? null : "Temperaturkurven brauchen bestätigte aktuelle Messwerte. Für diesen Treiber steht nur manuelle Steuerung bereit."));
    }
    internal Reply Process(JsonElement request)
    {
        int requestId = request.TryGetProperty("requestId", out var requestValue) && requestValue.TryGetInt32(out int parsedId) ? parsedId : -1;
        try
        {
            if (requestId < 0) throw new InvalidDataException("Ungültige Anfragekennung.");
            string command = JsonProtocol.Text(request, "command", 30);
            if (command is "disable" or "shutdown")
            {
                Release();
                if (command == "shutdown") ShouldExit = true;
                return new(requestId, true, Snapshot(), "Die übernommenen Anschlüsse wurden über die Hardwarebibliothek freigegeben.", Released: true);
            }
            if (command == "heartbeat")
            {
                heartbeat = clock();
                return new(requestId, true, Snapshot());
            }
            if (command is "scan" or "enable")
            {
                if (owned.Count != 0 && !enabled) throw new InvalidOperationException("Die vorherige Freigabe ist noch nicht abgeschlossen.");
                backend.Open();
                backend.Update(clock());
                heartbeat = clock();
                if (command == "enable") enabled = true;
                // Enabling exposes the channel service. It never takes ownership.
                return new(requestId, true, Snapshot(), command == "enable" ? "Mainboardanschlüsse bereit. Eine Änderung erfolgt erst für den ausgewählten Anschluss." : null);
            }
            if (command is not ("manual" or "curve")) throw new InvalidDataException("Unbekannter Lüfterbefehl.");
            if (!enabled) throw new InvalidOperationException("Die Lüftersteuerung ist ausgeschaltet.");
            if (clock() - heartbeat > TimeSpan.FromSeconds(8)) { Release(); throw new InvalidOperationException("Die Verbindung zu Batto ist veraltet."); }
            string id = JsonProtocol.Text(request, "id");
            if (!backend.Channels.Any(c => c.Id == id)) throw new InvalidOperationException("Der ausgewählte Mainboardanschluss fehlt.");
            if (!request.TryGetProperty("fanConfirmed", out var confirmed) || confirmed.ValueKind != JsonValueKind.True)
                throw new InvalidDataException("Bitte bestätigen: An diesem Anschluss hängt ein Lüfter, keine Pumpe.");
            if (command == "manual")
            {
                float duty = (float)JsonProtocol.Number(request, "duty", 30, 100);
                if (duty != MathF.Truncate(duty)) throw new InvalidDataException("Bitte eine ganze Lüfterleistung zwischen 30 und 100 Prozent wählen.");
                TakeOwnership(id);
                backend.Set(id, duty);
                assignments[id] = new(id, "manual", null, null, duty);
                backend.Update(clock());
                return new(requestId, true, Snapshot(), Applied: true, Id: id, Duty: duty);
            }
            string sensorId = JsonProtocol.Text(request, "sensorId");
            ThermalSensor? sensor = backend.Sensors.FirstOrDefault(s => s.Id == sensorId);
            if (sensor is null) throw new InvalidOperationException("Der ausgewählte Temperaturfühler fehlt.");
            if (!IsFresh(sensor, clock())) throw new InvalidOperationException("Der Temperaturfühler liefert keine bestätigten aktuellen Messwerte. Die Kurve wurde nicht übernommen.");
            CurvePoint[] points = ReadPoints(request);
            TakeOwnership(id);
            float target = CurveDuty(sensorId, points, clock());
            backend.Set(id, target);
            assignments[id] = new(id, "curve", sensorId, points, target);
            backend.Update(clock());
            return new(requestId, true, Snapshot(), Applied: true, Id: id, SensorId: sensorId, FailsafeDuty: 100);
        }
        catch (Exception error)
        {
            // A failed write may have changed hardware before failing. Restore
            // every owned channel, rather than returning a nominal success.
            string message = error.Message;
            if (owned.Count > 0)
            {
                try { Release(); }
                catch (Exception releaseError) { message += " Freigabe fehlgeschlagen: " + releaseError.Message; }
            }
            return new(requestId, false, Snapshot(), message);
        }
    }

    private void TakeOwnership(string id)
    {
        if (owned.Contains(id)) return;
        owned.Add(id); // Includes a channel whose first write subsequently fails.
        backend.Set(id, 100);
    }
    internal static CurvePoint[] ReadPoints(JsonElement request)
    {
        if (!request.TryGetProperty("points", out var input) || input.ValueKind != JsonValueKind.Array || input.GetArrayLength() is < 2 or > 20)
            throw new InvalidDataException("Eine Lüfterkurve benötigt 2 bis 20 Punkte.");
        var points = input.EnumerateArray().Select(p => new CurvePoint(JsonProtocol.Number(p, "temperature", 0, 120), JsonProtocol.Number(p, "duty", 30, 100))).ToArray();
        for (int i = 1; i < points.Length; i++)
            if (points[i].Temperature <= points[i - 1].Temperature || points[i].Duty < points[i - 1].Duty)
                throw new InvalidDataException("Temperaturen müssen steigen; die Lüfterleistung darf dabei nicht fallen.");
        return points;
    }
    private float CurveDuty(string sensorId, CurvePoint[] points, DateTimeOffset now)
    {
        ThermalSensor? sensor = backend.Sensors.FirstOrDefault(s => s.Id == sensorId);
        if (sensor is null || !IsFresh(sensor, now) || sensor.Celsius >= 85) return 100;
        if (sensor.Celsius <= points[0].Temperature) return (float)points[0].Duty;
        for (int i = 1; i < points.Length; i++)
        {
            if (sensor.Celsius > points[i].Temperature) continue;
            double ratio = (sensor.Celsius - points[i - 1].Temperature) / (points[i].Temperature - points[i - 1].Temperature);
            return (float)Math.Clamp(points[i - 1].Duty + ratio * (points[i].Duty - points[i - 1].Duty), 30, 100);
        }
        return (float)points[^1].Duty;
    }
    private static bool IsFresh(ThermalSensor sensor, DateTimeOffset now) => sensor.UpdatedUtc.HasValue &&
        now - sensor.UpdatedUtc.Value <= TimeSpan.FromSeconds(10) && sensor.UpdatedUtc.Value <= now.AddSeconds(2) && float.IsFinite(sensor.Celsius);
    internal void Tick(bool parentAlive)
    {
        if (!backend.IsOpen) return;
        if (!parentAlive || clock() - heartbeat > TimeSpan.FromSeconds(8)) { Release(); ShouldExit = true; return; }
        if (!enabled) return;
        try
        {
            DateTimeOffset now = clock();
            backend.Update(now);
            foreach (FanAssignment assignment in assignments.Values.ToArray())
            {
                if (!backend.Channels.Any(c => c.Id == assignment.Id)) throw new IOException("Ein übernommener Lüfteranschluss ist verschwunden.");
                float duty = assignment.Mode == "curve" ? CurveDuty(assignment.SensorId!, assignment.Points!, now) : assignment.Duty;
                // Recheck the observed duty so a competing controller becomes
                // a visible error instead of silently fighting this session.
                FanChannel channel = backend.Channels.First(c => c.Id == assignment.Id);
                if (assignment.Mode == "curve" && Math.Abs(duty - assignment.Duty) >= 0.5f) { backend.Set(assignment.Id, duty); assignments[assignment.Id] = assignment with { Duty = duty }; }
                else if (!channel.Duty.HasValue || Math.Abs(channel.Duty.Value - assignment.Duty) > 7) throw new IOException("Die Lüfterleistung weicht vom angeforderten Wert ab.");
            }
        }
        catch { Release(); throw; }
    }
    internal void Release()
    {
        enabled = false;
        var errors = new List<Exception>();
        foreach (string id in owned.ToArray())
        {
            try { backend.Restore(id); owned.Remove(id); assignments.Remove(id); }
            catch (Exception error) { errors.Add(error); }
        }
        if (errors.Count != 0) throw new AggregateException("Mainboardfreigabe über die Bibliothek nicht abgeschlossen.", errors);
        backend.Close();
        assignments.Clear();
    }
}
