using System.Diagnostics;
using System.Text.Json;
using Batto.DesktopFanControl;

namespace Batto.Hardware;

// This module is loaded into Batto's existing process. Creating it, checking
// capabilities, or reading the cached status never opens hardware or writes PWM.
internal sealed class FanModule : IDisposable
{
    private readonly object gate = new();
    private readonly DateTimeOffset startedUtc = DateTimeOffset.UtcNow;
    private readonly Stopwatch monotonic = Stopwatch.StartNew();
    private LibreBackend? backend;
    private FanEngine? engine;
    private Timer? watchdog;
    private bool disposed;
    private string? fault;

    internal bool Active { get { lock (gate) return backend?.IsOpen == true; } }

    internal object Dispatch(JsonElement request)
    {
        string command = JsonProtocol.Text(request, "command", 30);
        int requestId = RequestId(request);
        if (command == "self-test") return PureSelfTest();
        lock (gate)
        {
            if (disposed) throw new ObjectDisposedException(nameof(FanModule), "Battos Lüftersteuerung wurde geschlossen.");
            if (command is "status" or "capabilities")
                return new Reply(requestId, fault is null, CachedState(), fault);
            if (command is not ("scan" or "enable" or "heartbeat" or "manual" or "curve" or "disable" or "shutdown"))
                throw new InvalidDataException("Unbekannter Befehl für Battos PC-Lüftersteuerung.");
            if (fault is not null && command is not ("disable" or "shutdown"))
                return new Reply(requestId, false, CachedState(), fault);

            // Heartbeat/disable of an unopened module must not manufacture a
            // scan. In particular, closing Batto while default OFF is read-only.
            if (engine is null && command is ("heartbeat" or "disable" or "shutdown"))
                return new Reply(requestId, true, CachedState(), Released: command is "disable" or "shutdown" ? true : null);
            if (engine is null && command is ("manual" or "curve"))
                return new Reply(requestId, false, CachedState(), "Bitte Battos PC-Lüftersteuerung zuerst einschalten.");

            backend ??= new LibreBackend();
            engine ??= new FanEngine(backend, Now);
            Reply reply = ProcessRequest(engine, request, requestId);
            if (reply.Ok && command is ("disable" or "shutdown"))
            {
                fault = null;
                StopWatchdog();
                // A new explicit enable starts a new session and cannot reload
                // old ownership or persisted software assignments.
                engine = null;
                backend = null;
            }
            else if (backend.IsOpen && fault is null)
                StartWatchdog();
            return reply;
        }
    }

    private DateTimeOffset Now() => startedUtc + monotonic.Elapsed;
    private FanState CachedState() => engine?.Snapshot() ?? new(false, [], [], [],
        ReleaseVerification: "none", CurveAvailability: new(false, "Temperaturkurven benötigen bestätigte aktuelle Messwerte."));
    private static int RequestId(JsonElement request)
    {
        if (!request.TryGetProperty("requestId", out var value)) return 0;
        if (!value.TryGetInt32(out int id) || id < 0) throw new InvalidDataException("Ungültige Anfragekennung.");
        return id;
    }
    private static Reply ProcessRequest(FanEngine target, JsonElement request, int requestId)
    {
        if (request.TryGetProperty("requestId", out _)) return target.Process(request);
        // The exported dispatcher can assign the outer correlation ID. Preserve
        // compatibility when the inner fan command has no separate request ID.
        var normalized = request.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
        normalized["requestId"] = JsonSerializer.SerializeToElement(requestId);
        return target.Process(JsonSerializer.SerializeToElement(normalized));
    }

    private void StartWatchdog()
    {
        if (watchdog is null) watchdog = new Timer(OnWatchdog, null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
        else watchdog.Change(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
    }
    private void StopWatchdog() => watchdog?.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
    private void OnWatchdog(object? state)
    {
        // Driver calls and restoration share one lock. A still-running native
        // hardware call must never overlap another write or a forced teardown.
        if (!Monitor.TryEnter(gate)) return;
        try
        {
            if (disposed || engine is null) return;
            try
            {
                // In one process there is no external parent to monitor. The
                // heartbeat still releases owned channels if JS stops polling.
                engine.Tick(true);
                if (engine.ShouldExit)
                {
                    StopWatchdog();
                    engine = null;
                    backend = null;
                }
            }
            catch (Exception error)
            {
                // FanEngine has attempted its own release. Preserve any pending
                // ownership so an explicit OFF retry can finish that release.
                fault = "Battos Lüftersteuerung wurde unterbrochen: " + error.Message;
                StopWatchdog();
            }
        }
        finally { Monitor.Exit(gate); }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            StopWatchdog();
            try { engine?.Release(); }
            catch (Exception error)
            {
                fault = "Die Rückgabe der eigenen Lüftersteuerung wurde nicht bestätigt: " + error.Message;
                // Keep the same engine and owned channel identities for retry.
                // No one-process design can restore PWM after process death.
                throw;
            }
            engine = null;
            backend = null;
            watchdog?.Dispose();
            watchdog = null;
            disposed = true;
        }
    }

    // Tests only an in-memory backend. No driver, process, USB or service access.
    private static object PureSelfTest()
    {
        int checks = 0;
        void Check(bool condition, string name) { if (!condition) throw new InvalidOperationException("Lüfter-Selbsttest: " + name); checks++; }
        static Reply Send(FanEngine target, object input)
        {
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(input));
            return target.Process(json.RootElement);
        }
        var now = DateTimeOffset.Parse("2026-10-07T00:00:00Z");
        var fake = new FixtureBackend();
        var target = new FanEngine(fake, () => now);
        Check(!target.Snapshot().Enabled && !fake.IsOpen && fake.Writes.Count == 0, "Beim Start aus");
        Check(Send(target, new { requestId = 1, command = "enable" }).Ok && fake.Writes.Count == 0, "Einschalten ohne PWM");
        Check(!Send(target, new { requestId = 2, command = "manual", id = "fixture-fan", duty = 50 }).Ok && fake.Writes.Count == 0, "Bestätigung erforderlich");
        Reply changed = Send(target, new { requestId = 3, command = "manual", id = "fixture-fan", duty = 45, fanConfirmed = true });
        Check(changed.Ok && changed.Applied == true && changed.Id == "fixture-fan" && changed.Duty == 45, "Bestätigter Anschluss");
        Check(fake.Writes.SequenceEqual(new[] { 100f, 45f }), "Keine Null-Leistung");
        fake.FailRestore = true;
        Reply pending = Send(target, new { requestId = 4, command = "disable" });
        Check(!pending.Ok && pending.State.ReleasePending && pending.Released != true, "Fehlgeschlagene Rückgabe bleibt offen");
        fake.FailRestore = false;
        Reply stopped = Send(target, new { requestId = 5, command = "disable" });
        Check(stopped.Ok && stopped.Released == true && !stopped.State.Enabled && !fake.IsOpen && fake.Restores == 1, "Rückgabe wiederholbar");
        fake = new FixtureBackend();
        target = new FanEngine(fake, () => now);
        Send(target, new { requestId = 6, command = "enable" });
        Send(target, new { requestId = 7, command = "manual", id = "fixture-fan", duty = 60, fanConfirmed = true });
        now = now.AddSeconds(9);
        target.Tick(true);
        Check(target.ShouldExit && fake.Restores == 1 && !fake.IsOpen, "Heartbeat gibt eigenen Anschluss zurück");
        return new { ok = true, checks, realHardwareWrites = 0, separateProcesses = 0 };
    }

    private sealed class FixtureBackend : IFanBackend
    {
        public bool IsOpen { get; private set; }
        internal bool FailRestore;
        internal int Restores;
        internal List<float> Writes { get; } = [];
        private float duty = 50;
        public FanChannel[] Channels => IsOpen ? [new("fixture-fan", "Chassis Fan", "Testdaten", 1000, duty)] : [];
        public ThermalSensor[] Sensors => [];
        public void Open() => IsOpen = true;
        public void Update(DateTimeOffset now) { }
        public void Set(string id, float value) { if (id != "fixture-fan") throw new InvalidDataException("Testanschluss fehlt."); Writes.Add(value); duty = value; }
        public void Restore(string id) { if (id != "fixture-fan" || FailRestore) throw new IOException("Testfreigabe fehlgeschlagen."); duty = 50; Restores++; }
        public void Close() => IsOpen = false;
    }
}
