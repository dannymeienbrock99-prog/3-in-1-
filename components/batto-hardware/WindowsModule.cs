using System.Text.Json;
using Prism.WindowsLighting;
namespace Batto.Hardware;

// Uses the same supported Windows/MSI/Corsair APIs without their former EXE.
// Corsair's SDK still depends on iCUE. It is compatibility, not independent USB.
internal sealed class WindowsModule
{
    readonly LightingService lighting = new();
    readonly CorsairLightingService corsair = new();
    readonly MsiLightingService msi = new();
    bool corsairSuppressed;
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public object Dispatch(JsonElement request)
    {
        var command = request.GetProperty("command").GetString();
        switch (command)
        {
            case "status": return new { inProcess = true, processId = Environment.ProcessId, sdkRequiresICue = true, corsairSuppressed };
            case "suspend-corsair":
                corsairSuppressed = true;
                corsair.Release();
                return new { suspended = true, inProcess = true };
            case "resume-corsair":
                corsairSuppressed = false;
                return new { suspended = false, inProcess = true };
            case "enumerate": return Enumerate();
            case "set":
                int id = request.GetProperty("deviceId").GetInt32();
                if (corsairSuppressed && id is >= 10000 and < 20000) throw new LightingException("CORSAIR_DIRECT_ACTIVE", "iCUE ist während der direkten Corsair-Steuerung pausiert.");
                return id >= 20000 ? msi.Set(id, request.GetProperty("colors")) : id >= 10000 ? corsair.Set(id, request.GetProperty("colors")) : lighting.Set(id, request.GetProperty("colors"));
            case "effect": return msi.Effect(request.GetProperty("deviceId").GetInt32(), request);
            case "release":
            case "close": lighting.Release(); corsair.Release(); msi.Release(); return new { releaseRequested = true, verification = "unconfirmed", inProcess = true };
            case "show": throw new LightingException("INTEGRATED_UI", "Die RGB-Steuerung wird direkt in Batto angezeigt.");
            default: throw new ArgumentException("Unbekannter Windows-RGB-Befehl.");
        }
    }
    object Enumerate()
    {
        JsonElement windows;
        string windowsStatus = "ready", windowsMessage = "Windows-Beleuchtung ist direkt in Batto integriert.";
        try { windows = JsonSerializer.SerializeToElement(lighting.Enumerate().GetAwaiter().GetResult(), Json); }
        catch (Exception error) { windowsStatus = "unavailable"; windowsMessage = error.Message; windows = JsonSerializer.SerializeToElement(new { devices = Array.Empty<object>(), discovery = Array.Empty<object>(), excludedCount = 0, warnings = new[] { error.Message } }, Json); }
        JsonElement[] cueDevices, msiDevices;
        try { cueDevices = corsairSuppressed ? [] : corsair.Enumerate().Select(d => JsonSerializer.SerializeToElement(d, Json)).ToArray(); }
        catch (Exception error) { cueDevices = []; corsair.Warnings.Add(error.Message); }
        try { msiDevices = msi.Enumerate().Select(d => JsonSerializer.SerializeToElement(d, Json)).ToArray(); }
        catch (Exception error) { msiDevices = []; msi.Warnings.Add(error.Message); }
        var windowsDevices = windows.GetProperty("devices").EnumerateArray().Select(d => d.Clone()).ToArray();
        var windowsWarnings = windows.GetProperty("warnings").EnumerateArray().Select(w => w.GetString() ?? "").ToArray();
        return new
        {
            devices = windowsDevices.Concat(cueDevices).Concat(msiDevices).ToArray(), backend = "batto-in-process", compatibleOnly = true,
            foreground = Ownership.IsForeground, backgroundSupported = cueDevices.Length > 0 || msiDevices.Length > 0,
            excludedCount = windows.GetProperty("excludedCount").GetInt32() + corsair.ExcludedCount + msi.ExcludedCount,
            warnings = windowsWarnings.Concat(corsair.Warnings).Concat(msi.Warnings).ToArray(),
            discovery = windows.GetProperty("discovery").EnumerateArray().Select(d => d.Clone()).Concat(corsair.Discovery.Select(d => JsonSerializer.SerializeToElement(d, Json))).Concat(msi.Discovery.Select(d => JsonSerializer.SerializeToElement(d, Json))).ToArray(),
            environment = new
            {
                integration = new { inProcess = true, processId = Environment.ProcessId, childProcesses = false },
                windows = new { status = windowsStatus, message = windowsMessage, deviceCount = windowsDevices.Length, foreground = Ownership.IsForeground, backgroundSupported = false, warnings = windowsWarnings },
                corsair = new { status = corsairSuppressed ? "paused" : corsair.Status, message = corsairSuppressed ? "iCUE ist während der direkten Corsair-Steuerung pausiert." : corsair.Message, deviceCount = cueDevices.Length, backgroundSupported = true, requiresICue = true, warnings = corsairSuppressed ? [] : corsair.Warnings.ToArray() },
                msi = new { status = msi.Status, message = msi.Message, deviceCount = msiDevices.Length, backgroundSupported = true, warnings = msi.Warnings.ToArray() }
            }
        };
    }
}
