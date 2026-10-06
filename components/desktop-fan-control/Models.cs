using System.Text.Json;
namespace Batto.DesktopFanControl;

internal sealed record FanChannel(string Id, string Name, string Device, float? Rpm, float? Duty, bool RequiresConfirmation = false)
{
    public string Provider => "LibreHardwareMonitor";
    public string Kind => "fan";
    public int MinDuty => 30;
    public int MaxDuty => 100;
}
internal sealed record ThermalSensor(string Id, string Name, float Celsius, DateTimeOffset? UpdatedUtc);
internal sealed record CurvePoint(double Temperature, double Duty);
internal sealed record FanAssignment(string Id, string Mode, string? SensorId, CurvePoint[]? Points, float Duty);
internal sealed record CurveAvailability(bool Available, string? Reason);
internal sealed record FanState(bool Enabled, FanChannel[] Channels, ThermalSensor[] Sensors, FanAssignment[] Assignments, bool ReleasePending = false, string ReleaseVerification = "api-only", CurveAvailability? CurveAvailability = null);
internal sealed record Reply(int RequestId, bool Ok, FanState State, string? Message = null, bool? Released = null, bool? Applied = null, string? Id = null, float? Duty = null, string? SensorId = null, int? FailsafeDuty = null);
internal sealed record HardwareFacts(bool IsDesktop, string Manufacturer, string Product, bool Administrator, bool PawnInstalled);

internal interface IFanBackend
{
    bool IsOpen { get; }
    void Open();
    void Update(DateTimeOffset now);
    FanChannel[] Channels { get; }
    ThermalSensor[] Sensors { get; }
    void Set(string id, float duty);
    void Restore(string id);
    void Close();
}

internal static class JsonProtocol
{
    internal static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static string Text(JsonElement input, string key, int max = 400)
    {
        if (!input.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("Ungültiger Wert: " + key);
        string text = value.GetString() ?? "";
        if (text.Length == 0 || text.Length > max || text.Any(char.IsControl))
            throw new InvalidDataException("Ungültiger Wert: " + key);
        return text;
    }
    internal static double Number(JsonElement input, string key, double min, double max)
    {
        if (!input.TryGetProperty(key, out var value) || !value.TryGetDouble(out double result) || !double.IsFinite(result) || result < min || result > max)
            throw new InvalidDataException($"{key} muss zwischen {min} und {max} liegen.");
        return result;
    }
}
