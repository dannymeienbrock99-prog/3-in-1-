using LibreHardwareMonitor.Hardware;
using LibreHardwareMonitor.Hardware.Motherboard;
namespace Batto.DesktopFanControl;

// Never reload a persisted software mode. Seeding 100 avoids LHM's first
// mode-change writing its default SoftwareValue (0) before the requested duty.
internal sealed class SessionSettings : ISettings
{
    public bool Contains(string name) => false;
    public string GetValue(string name, string value) => name.EndsWith("/control/value", StringComparison.Ordinal) ? "100" : value;
    public void SetValue(string name, string value) { }
    public void Remove(string name) { }
}

internal sealed class LibreBackend : IFanBackend
{
    private Computer? computer;
    private readonly Dictionary<string, (ISensor Sensor, ISensor? Rpm)> controls = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ISensor> temperatures = new(StringComparer.Ordinal);
    private FanChannel[] channels = [];
    private ThermalSensor[] sensors = [];
    public bool IsOpen => computer is not null;
    public FanChannel[] Channels => channels;
    public ThermalSensor[] Sensors => sensors;

    internal static bool IsFanHeader(string controlName, string? rpmName)
    {
        string name = (controlName + " " + rpmName).ToLowerInvariant();
        if (name.Contains("pump") || name.Contains("pumpe") || name.Contains("aio") || name.Contains("water") || name.Contains("flow") || name.Contains("unused")) return false;
        if (Generic(controlName)) return false;
        return System.Text.RegularExpressions.Regex.IsMatch(controlName, @"^(?:CPU(?: Optional)?|System|SYS|Chassis|CHA)(?:[ _-]*Fan)?(?:[ _#-]*\d+)?(?:[ _-]*Control)?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }
    internal static bool Generic(string name) => System.Text.RegularExpressions.Regex.IsMatch(name, @"^(?:Fan|PWM|Control)\s*#?\s*\d+$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    internal static bool ApprovedController(string name) => name.StartsWith("Nuvoton NCT", StringComparison.Ordinal) &&
        !System.Text.RegularExpressions.Regex.IsMatch(name, @"NCT668[367]", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    public void Open()
    {
        if (IsOpen) return;
        HardwarePolicy.Validate(HardwarePolicy.Read());
        var next = new Computer(new SessionSettings()) { IsMotherboardEnabled = true, IsCpuEnabled = false, IsGpuEnabled = false, IsControllerEnabled = false, IsPsuEnabled = false, IsPowerMonitorEnabled = false, IsMemoryEnabled = false, IsStorageEnabled = false, IsNetworkEnabled = false, IsBatteryEnabled = false };
        try
        {
            next.Open();
            foreach (IHardware board in next.Hardware.Where(h => h.HardwareType == HardwareType.Motherboard))
            {
                foreach (IHardware hardware in board.SubHardware.Where(h => h.HardwareType == HardwareType.SuperIO))
                {
                    hardware.Update();
                    // NCT668x has an upstream restore-mode bug. Other SuperIO
                    // families have no verified restore policy in this helper.
                    if (!ApprovedController(hardware.Name)) continue;
                    foreach (ISensor control in hardware.Sensors.Where(s => s.SensorType == SensorType.Control && s.Control is not null))
                    {
                        ISensor? rpm = hardware.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Fan && s.Index == control.Index);
                        if (!IsFanHeader(control.Name, rpm?.Name)) continue;
                        // A control without a readable duty cannot acknowledge writes.
                        if (!control.Value.HasValue || !float.IsFinite(control.Value.Value)) continue;
                        string id = control.Identifier.ToString();
                        if (!controls.TryAdd(id, (control, rpm))) throw new InvalidOperationException("Mehrdeutiger Lüfteranschluss.");
                    }
                    foreach (ISensor sensor in hardware.Sensors.Where(s => s.SensorType == SensorType.Temperature))
                        temperatures.TryAdd(sensor.Identifier.ToString(), sensor);
                }
            }
            computer = next;
            Update(DateTimeOffset.UtcNow);
            if (channels.Length == 0) throw new InvalidOperationException("Keine unterstützten Mainboard-Lüfteranschlüsse mit lesbarer Leistung gefunden.");
        }
        catch { try { next.Close(); } finally { computer = null; controls.Clear(); temperatures.Clear(); channels = []; sensors = []; } throw; }
    }

    public void Update(DateTimeOffset now)
    {
        if (computer is null) return;
        foreach (IHardware hardware in computer.Hardware.SelectMany(h => h.SubHardware).Where(h => h.HardwareType == HardwareType.SuperIO)) hardware.Update();
        channels = controls.Select(pair => new FanChannel(pair.Key, pair.Value.Sensor.Name, pair.Value.Sensor.Hardware.Name, Finite(pair.Value.Rpm?.Value), Finite(pair.Value.Sensor.Value), Generic(pair.Value.Sensor.Name))).ToArray();
        sensors = temperatures.Where(p => p.Value.Value.HasValue && float.IsFinite(p.Value.Value.Value) && p.Value.Value.Value is >= -10 and <= 150)
            // LHM Update can silently retain cached values on bus timeout. Its
            // public API has no read timestamp; observed values are not fresh.
            .Select(p => new ThermalSensor(p.Key, p.Value.Name, p.Value.Value!.Value, null)).ToArray();
    }
    private static float? Finite(float? value) => value.HasValue && float.IsFinite(value.Value) ? value : null;

    public void Set(string id, float duty)
    {
        if (!controls.TryGetValue(id, out var target)) throw new InvalidOperationException("Der ausgewählte Mainboardanschluss fehlt.");
        if (!float.IsFinite(duty) || duty is < 30 or > 100) throw new InvalidDataException("Lüfterleistung muss zwischen 30 und 100 Prozent liegen.");
        target.Sensor.Control!.SetSoftware(duty);
        target.Sensor.Hardware.Update();
        float? reported = target.Sensor.Value;
        if (!reported.HasValue || !float.IsFinite(reported.Value) || Math.Abs(reported.Value - duty) > 7)
            throw new IOException("Der Mainboardanschluss bestätigt die gewünschte Leistung nicht.");
    }
    public void Restore(string id)
    {
        if (!controls.TryGetValue(id, out var target)) throw new IOException("Der übernommene Mainboardanschluss fehlt; Freigabe nicht bestätigt.");
        target.Sensor.Control!.SetDefault();
        if (target.Sensor.Control.ControlMode != ControlMode.Default) throw new IOException("Die Mainboardsteuerung konnte nicht zurückgegeben werden.");
    }
    public void Close()
    {
        if (computer is null) return;
        computer.Close();
        computer = null; controls.Clear(); temperatures.Clear(); channels = []; sensors = [];
    }
}
