using System.Text.Json;
namespace Batto.DesktopFanControl;

internal static class SelfTests
{
    internal static int Run()
    {
        int count = 0;
        void Check(bool value, string name) { if (!value) throw new Exception(name); count++; }
        Reply Send(FanEngine engine, object value) { using var document = JsonDocument.Parse(JsonSerializer.Serialize(value)); return engine.Process(document.RootElement); }
        var now = DateTimeOffset.Parse("2026-10-06T20:00:00Z");
        try
        {
            var backend = new FakeBackend(); var engine = new FanEngine(backend, () => now);
            Check(Send(engine, new { requestId = 1, command = "enable" }).Ok, "Enable opens service");
            Check(backend.Writes.Count == 0, "Enable never writes PWM");
            Check(!Send(engine, new { requestId = 2, command = "manual", id = "fan-a", duty = 50 }).Ok && backend.Writes.Count == 0, "Unconfirmed header rejected before writes");
            Check(!Send(engine, new { requestId = 3, command = "manual", id = "missing", duty = 50, fanConfirmed = true }).Ok && backend.Writes.Count == 0, "Missing identity rejected");
            Check(!Send(engine, new { requestId = 4, command = "manual", id = "fan-a", duty = 0, fanConfirmed = true }).Ok && backend.Writes.Count == 0, "Zero PWM rejected");
            var applied = Send(engine, new { requestId = 5, command = "manual", id = "fan-a", duty = 45, fanConfirmed = true });
            Check(applied.Ok && applied.Applied == true && applied.Duty == 45, "Manual ACK");
            Check(backend.Writes.SequenceEqual(new[] { ("fan-a", 100f), ("fan-a", 45f) }), "First ownership starts at 100, never zero");
            var disabled = Send(engine, new { requestId = 6, command = "disable" });
            Check(disabled.Ok && disabled.Released == true && !disabled.State.Enabled, "Disable ACK after restore");
            Check(backend.Restored.SequenceEqual(new[] { "fan-a" }), "Only the owned fan restored");
            Check(!Send(engine, new { requestId = 7, command = "manual", id = "fan-a", duty = 50, fanConfirmed = true }).Ok, "Off blocks writes");

            backend = new FakeBackend(); engine = new FanEngine(backend, () => now);
            Send(engine, new { requestId = 1, command = "enable" });
            disabled = Send(engine, new { requestId = 2, command = "disable" });
            Check(disabled.Ok && backend.Restored.Count == 0 && backend.Writes.Count == 0, "Unowned disable has no PWM or restore writes");

            backend = new FakeBackend(); engine = new FanEngine(backend, () => now);
            Send(engine, new { requestId = 1, command = "enable" });
            var curve = Send(engine, new { requestId = 2, command = "curve", id = "fan-a", sensorId = "temp", fanConfirmed = true, points = new[] { new { temperature = 30, duty = 30 }, new { temperature = 80, duty = 100 } } });
            Check(curve.Ok && curve.Applied == true && curve.FailsafeDuty == 100, "Curve ACK");
            Check(Math.Abs(backend.Writes[^1].Item2 - 44) < .1, "Curve interpolation");
            backend.Thermal = [new("temp", "CPU", 50, now.AddSeconds(-11))];
            engine.Tick(true);
            Check(backend.Writes[^1].Item2 == 100, "Stale temperature selects full cooling");
            backend.Thermal = [new("temp", "CPU", 90, now)];
            engine.Tick(true);
            Check(backend.Writes[^1].Item2 == 100, "High temperature selects full cooling");
            now = now.AddSeconds(9); engine.Tick(true);
            Check(engine.ShouldExit && backend.Restored.SequenceEqual(new[] { "fan-a" }), "Heartbeat timeout releases owned channel");

            backend = new FakeBackend(); engine = new FanEngine(backend, () => now);
            Send(engine, new { requestId = 1, command = "enable" });
            Send(engine, new { requestId = 2, command = "manual", id = "fan-b", duty = 60, fanConfirmed = true });
            engine.Tick(false);
            Check(engine.ShouldExit && backend.Restored.SequenceEqual(new[] { "fan-b" }), "Parent loss releases only owned channel");

            backend = new FakeBackend(); engine = new FanEngine(backend, () => now);
            Send(engine, new { requestId = 1, command = "enable" });
            Send(engine, new { requestId = 2, command = "manual", id = "fan-a", duty = 50, fanConfirmed = true });
            backend.FailRestore = true;
            var failed = Send(engine, new { requestId = 3, command = "disable" });
            Check(!failed.Ok && failed.Released != true && failed.State.ReleasePending, "Failed release never ACKs success");
            backend.FailRestore = false;
            Check(Send(engine, new { requestId = 4, command = "disable" }).Released == true, "Release can retry");

            backend = new FakeBackend { FailWrite = true }; engine = new FanEngine(backend, () => now);
            Send(engine, new { requestId = 1, command = "enable" });
            failed = Send(engine, new { requestId = 2, command = "manual", id = "fan-a", duty = 50, fanConfirmed = true });
            Check(!failed.Ok && backend.Restored.SequenceEqual(new[] { "fan-a" }), "Failure after ownership restores the possibly changed channel");

            Check(new SessionSettings().GetValue("/lpc/0/control/0/control/value", "0") == "100", "Initial software value seeded 100");
            Check(new SessionSettings().GetValue("/lpc/0/control/0/control/mode", "0") == "0", "No persisted software mode");
            Check(LibreBackend.IsFanHeader("CPU Fan", "CPU Fan") && LibreBackend.IsFanHeader("Chassis Fan #2", null) && LibreBackend.IsFanHeader("System Fan #3", "System Fan #3"), "Known header labels supported");
            Check(!LibreBackend.IsFanHeader("Pump Fan", null) && !LibreBackend.IsFanHeader("AIO Pump", null) && !LibreBackend.IsFanHeader("CPU Fan", "Water Pump"), "Pump names excluded on both control and RPM sensors");
            Check(!LibreBackend.IsFanHeader("Fan #1", null) && !LibreBackend.IsFanHeader("PWM #1", null), "Unmapped generic headers excluded");
            Check(LibreBackend.ApprovedController("Nuvoton NCT6799D") && !LibreBackend.ApprovedController("Nuvoton NCT6687D-R") && !LibreBackend.ApprovedController("Nuvoton NCT6683D") && !LibreBackend.ApprovedController("Winbond W83627DHG"), "Unaudited and faulty restore controllers excluded");
            backend = new FakeBackend { Thermal = [new("temp", "CPU", 40, null)] }; engine = new FanEngine(backend, () => now);
            Send(engine, new { requestId = 1, command = "enable" });
            failed = Send(engine, new { requestId = 2, command = "curve", id = "fan-a", sensorId = "temp", fanConfirmed = true, points = new[] { new { temperature = 30, duty = 30 }, new { temperature = 80, duty = 100 } } });
            Check(!failed.Ok && backend.Writes.Count == 0 && failed.State.CurveAvailability?.Available == false, "Unproven temperature freshness rejects curve before ownership");
            Check(Blocked(new(false, "ASUSTeK", "Test", true, true)), "Notebook fails closed");
            Check(Blocked(new(true, "Unknown", "Test", true, true)), "Unknown manufacturer fails closed");
            Check(Blocked(new(true, "ASUSTeK", "Test", false, true)), "Non-admin fails closed");
            Check(Blocked(new(true, "MSI", "Test", true, false)), "Missing driver fails closed");
            HardwarePolicy.Validate(new(true, "Micro-Star International Co., Ltd.", "Test", true, true)); count++;
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, checks = count, realHardwareWrites = 0 }, JsonProtocol.Options));
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine("Self-test failed: " + error.Message); return 1; }
    }
    private static bool Blocked(HardwareFacts facts) { try { HardwarePolicy.Validate(facts); return false; } catch (InvalidOperationException) { return true; } }

    private sealed class FakeBackend : IFanBackend
    {
        public bool IsOpen { get; private set; }
        public bool FailWrite, FailRestore;
        public List<(string, float)> Writes { get; } = [];
        public List<string> Restored { get; } = [];
        public ThermalSensor[] Thermal { get; set; } = [new("temp", "CPU", 40, DateTimeOffset.Parse("2026-10-06T20:00:00Z"))];
        private readonly Dictionary<string, float> duties = new() { ["fan-a"] = 50, ["fan-b"] = 50 };
        public FanChannel[] Channels => IsOpen ? duties.Select(d => new FanChannel(d.Key, "Chassis Fan", "Synthetic only", 1000, d.Value)).ToArray() : [];
        public ThermalSensor[] Sensors => IsOpen ? Thermal : [];
        public void Open() => IsOpen = true;
        public void Update(DateTimeOffset now) { }
        public void Set(string id, float duty) { Writes.Add((id, duty)); if (FailWrite) throw new IOException("Synthetic write failure"); duties[id] = duty; }
        public void Restore(string id) { if (FailRestore) throw new IOException("Synthetic restore failure"); Restored.Add(id); duties[id] = 50; }
        public void Close() => IsOpen = false;
    }
}
