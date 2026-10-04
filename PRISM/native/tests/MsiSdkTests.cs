using System.Text.Json;

namespace Prism.WindowsLighting;

internal sealed class LightingException(string code, string message) : Exception(message) { public string Code { get; } = code; }

internal sealed class FakeMsiSdk : IMsiSdk
{
    public int Initialization;
    public int ReleaseCount;
    public int ColorFailure;
    public bool InvalidCounts;
    public List<string> Writes { get; } = [];
    public int Initialize() => Initialization;
    public int Release() { ReleaseCount++; return 0; }
    public int GetDevices(out string[] types, out string[] counts) { types = ["MSI_MB", "DRAM", "Peripheral", "Elgato_StreamDeck"]; counts = InvalidCounts ? ["129", "4", "1", "15"] : ["1", "4", "1", "15"]; return 0; }
    public int GetDeviceNames(string type, out string[] names) { names = type switch { "MSI_MB" => ["MSI MEG X670E GODLIKE"], "DRAM" => ["Kingston FURY Beast RGB DIMM 1", "Kingston FURY Beast RGB DIMM 2", "Kingston FURY Beast RGB DIMM 3", "Kingston FURY Beast RGB DIMM 4"], _ => ["Elgato Stream Deck"] }; return 0; }
    public int GetLedInfo(string type, uint index, out string name, out string[] styles) { name = type == "DRAM" ? "RGB-Arbeitsspeicher" : "Mainboard"; styles = type == "MSI_MB" ? ["Rainbow", "Direct Lighting Control", "Direct All Sync"] : index == 3 ? ["Rainbow", "Unfamiliar mode"] : ["Steady", "Rainbow", "Direct All Sync"]; return 0; }
    public int GetLedNames(string type, out string[] names) { names = type == "MSI_MB" ? ["0:Dragon LED", "0:Logo LED"] : []; return 0; }
    public int GetColor(string type, uint index, out uint r, out uint g, out uint b) { r = 10; g = 20; b = 30; return 0; }
    public int GetMaxBrightness(string type, uint index, out uint maximum) { maximum = 10; return type == "MSI_MB" ? -103 : 0; }
    public int GetMaxSpeed(string type, uint index, out uint maximum) { maximum = 5; return 0; }
    public int SetStyle(string type, uint index, string style) { Writes.Add($"style:{type}:{index}:{style}"); return 0; }
    public int SetColor(string type, uint index, uint r, uint g, uint b) { Writes.Add($"color:{type}:{index}:{r}:{g}:{b}"); return ColorFailure; }
    public int SetColors(string type, uint index, string[] names, uint[] r, uint[] g, uint[] b) { Writes.Add($"leds:{type}:{index}:" + string.Join(",", names) + ":" + string.Join(",", r)); return ColorFailure; }
    public int SetBrightness(string type, uint index, uint value) { Writes.Add($"bright:{type}:{index}:{value}"); return 0; }
    public int SetSpeed(string type, uint index, uint value) { Writes.Add($"speed:{type}:{index}:{value}"); return 0; }
}

internal static class Tests
{
    private static int checks;
    private static void Expect(bool value, string name) { checks++; if (!value) throw new Exception("FAILED: " + name); }
    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
    private static void Rejected(Action operation, string code, string name)
    { try { operation(); throw new Exception("FAILED: accepted " + name); } catch (LightingException error) { Expect(error.Code == code, name); } }
    public static int Main()
    {
        Expect(UiPolicy.ParsePort([]) == 4783, "standalone UI port remains the default");
        Expect(UiPolicy.ParsePort(["--ui-port=43873"]) == 43873, "embedded UI port supplied by parent process");
        foreach (var bad in new[] { "0", "1023", "65536", "43873.5", "+43873", " 43873", "x" })
            Rejected(() => UiPolicy.ParsePort(["--ui-port=" + bad]), "INVALID_UI_PORT", "invalid native UI port rejected: " + bad);
        Rejected(() => UiPolicy.ParsePort(["--ui-port=43873", "--ui-port=4783"]), "INVALID_UI_PORT", "duplicate native UI port rejected");
        Expect(UiPolicy.TryLocalUrl("http://127.0.0.1:43873/", 43873, out _), "actual embedded loopback root accepted");
        foreach (string bad in new[] { "http://127.0.0.1:4783/", "http://localhost:43873/", "http://127.1:43873/", "http://2130706433:43873/", "http://[::1]:43873/", "https://127.0.0.1:43873/", "http://user:pass@127.0.0.1:43873/", "http://127.0.0.1:43873/other", "http://127.0.0.1:43873/?x=1", "http://127.0.0.1:43873/#fragment", "http://example.com:43873/" })
            Expect(!UiPolicy.TryLocalUrl(bad, 43873, out _), "untrusted native UI address rejected: " + bad);
        foreach (string safe in new[] { "https://www.msi.com/Landing/mystic-light-rgb-gaming-pc/download", "https://download.msi.com/uti_exe/Mystic_light_SDK.zip", "https://www.kingston.com/en/memory/gaming/kingston-fury-beast-ddr5-rgb-memory", "https://lian-li.com/product/uni-fan-tl/", "https://github.com/CorsairOfficial/cue-sdk", "https://github.com/Beej126/KingstonFuryRgbCLI/blob/master/README.md", "https://github.com/sgtaziz/lian-li-linux" })
            Expect(UiPolicy.SafeExternalLink(safe), "known user-requested documentation accepted: " + safe);
        foreach (string bad in new[] { "http://www.msi.com/", "https://user:pass@www.msi.com/", "https://www.msi.com:444/", "https://www.msi.com.evil.example/", "https://github.com/unknown/repository", "https://github.com/sgtaziz/lian-li-linux-evil", "file:///C:/Windows/notepad.exe", "javascript:alert(1)" })
            Expect(!UiPolicy.SafeExternalLink(bad), "untrusted external documentation rejected: " + bad);
        var api = new FakeMsiSdk(); var service = new MsiLightingService(api);
        var devices = service.Enumerate().Select(Json).ToArray();
        Expect(devices.Length == 5, "only actual SDK motherboard area and four RAM areas");
        Expect(api.Writes.Count == 0, "discovery is read only");
        Expect(service.ExcludedCount == 2, "Stream Deck is excluded by SDK type and friendly name");
        Expect(service.Status == "connected", "live provider status");
        Expect(devices[0].GetProperty("ledCount").GetInt32() == 2, "named LEDs follow SDK area-index mapping");
        Expect(!devices[0].GetProperty("colorsKnown").GetBoolean(), "area color is not misreported as current per-LED color");
        Expect(devices[1].GetProperty("ledCount").GetInt32() == 1 && devices[1].GetProperty("ledGranularity").GetString() == "area", "SDK color area is not a fabricated physical LED count");
        Expect(devices[1].GetProperty("vendor").GetString() == "Kingston", "actual Kingston friendly names retained");
        Expect(devices[1].GetProperty("type").GetInt32() == 1, "DRAM classified as memory");
        Expect(!devices[4].GetProperty("directMode").GetBoolean(), "unknown vendor styles do not imply direct color support");
        Expect(!devices.Any(d => d.GetProperty("nativeEffects").EnumerateArray().Any(e => e.GetProperty("name").GetString() == "Direct All Sync")), "global all-sync is never offered");
        Expect(devices[0].GetProperty("nativeEffects")[0].GetProperty("id").GetString() == devices[1].GetProperty("nativeEffects")[1].GetProperty("id").GetString(), "same native style has the same semantic ID despite different SDK mode order");
        Expect(devices[0].GetProperty("nativeEffects")[1].GetProperty("id").GetString() != devices[1].GetProperty("nativeEffects")[1].GetProperty("id").GetString(), "different styles with the same SDK mode index never share IDs");
        int ram = devices[1].GetProperty("id").GetInt32(); int board = devices[0].GetProperty("id").GetInt32();
        service.Set(ram, Json(new uint[] { 0x332211 }));
        Expect(api.Writes.SequenceEqual(new[] { "style:DRAM:0:Steady", "color:DRAM:0:17:34:51" }), "RAM color writes only the selected SDK area");
        api.Writes.Clear(); service.Set(ram, Json(new uint[] { 0x445566 }));
        Expect(api.Writes.Count == 1 && api.Writes[0].StartsWith("color:DRAM:0:"), "repeated frame does not reselect SDK style");
        api.Writes.Clear(); service.Set(board, Json(new uint[] { 0x0000ff, 0x00ff00 }));
        Expect(api.Writes.SequenceEqual(new[] { "style:MSI_MB:0:Direct Lighting Control", "leds:MSI_MB:0:Dragon LED,Logo LED:255,0" }), "direct named LEDs use only the requested SDK area");
        api.Writes.Clear();
        Rejected(() => service.Set(ram, Json(new uint[] { 1, 2 })), "INVALID_COLORS", "wrong LED count rejected");
        Rejected(() => service.Set(ram, Json(new uint[] { 0x1000000 })), "INVALID_COLORS", "invalid packed color rejected");
        Rejected(() => service.Set(devices[4].GetProperty("id").GetInt32(), Json(new uint[] { 0 })), "DIRECT_UNSUPPORTED", "unknown style cannot control arbitrary colors");
        Rejected(() => service.Set(20999, Json(new uint[] { 0 })), "DEVICE_NOT_FOUND", "stale target rejected");
        Expect(api.Writes.Count == 0, "invalid frame never writes hardware");
        service.Effect(ram, Json(new { modeId = 1, brightness = 50, speed = 60, colors = new[] { "#ff0080" }, direction = "forward" }));
        Expect(api.Writes.SequenceEqual(new[] { "style:DRAM:0:Rainbow", "color:DRAM:0:255:0:128", "bright:DRAM:0:5", "speed:DRAM:0:3" }), "native styles, color and percentages use only selected area and reported maxima");
        api.Writes.Clear();
        Rejected(() => service.Effect(ram, Json(new { modeId = 2 })), "INVALID_EFFECT", "unreported/global mode rejected");
        Rejected(() => service.Effect(ram, Json(new { modeId = 1, brightness = 101 })), "INVALID_EFFECT", "out of range effect options rejected");
        Rejected(() => service.Effect(board, Json(new { modeId = 0, brightness = 50 })), "MSI_NOT_SUPPORTED", "unsupported brightness rejected before any mode write");
        Rejected(() => service.Effect(ram, Json(new { modeId = 1, direction = "reverse" })), "MSI_NOT_SUPPORTED", "unsupported direction rejected before any mode write");
        Expect(api.Writes.Count == 0, "invalid native effects never change SDK mode");
        api.ColorFailure = -103;
        Rejected(() => service.Set(ram, Json(new uint[] { 0x445566 })), "MSI_ERROR", "driver rejection is not reported as success");
        var previousIds = devices.Select(d => d.GetProperty("id").GetInt32()).ToArray();
        Expect(service.Enumerate().Select(Json).Select(d => d.GetProperty("id").GetInt32()).SequenceEqual(previousIds), "IDs remain stable across discovery");
        service.Release(); Expect(api.ReleaseCount == 1, "SDK session released");
        var unavailable = new MsiLightingService(new FakeMsiSdk { Initialization = -3 });
        Expect(unavailable.Enumerate().Length == 0 && unavailable.Status == "notConnected", "missing MSI application does not fabricate RAM");
        var bounded = new MsiLightingService(new FakeMsiSdk { InvalidCounts = true });
        Expect(bounded.Enumerate().Length == 4 && bounded.Warnings.Count > 0, "oversized SDK area count rejected");
        Console.WriteLine($"MSI fake-SDK checks passed: {checks}; no native DLL or physical hardware used."); return 0;
    }
}
