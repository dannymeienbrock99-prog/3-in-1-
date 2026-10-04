using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Prism.WindowsLighting;

// ABI follows MSI's public 1.0.0.08 reference and its C# sample. The SDK
// communicates with the installed Mystic Light application; no HID/SMBus scan.
internal interface IMsiSdk
{
    int Initialize();
    int Release();
    int GetDevices(out string[] types, out string[] counts);
    int GetDeviceNames(string type, out string[] names);
    int GetLedInfo(string type, uint index, out string name, out string[] styles);
    int GetLedNames(string type, out string[] names);
    int GetColor(string type, uint index, out uint r, out uint g, out uint b);
    int GetMaxBrightness(string type, uint index, out uint maximum);
    int GetMaxSpeed(string type, uint index, out uint maximum);
    int SetStyle(string type, uint index, string style);
    int SetColor(string type, uint index, uint r, uint g, uint b);
    int SetColors(string type, uint index, string[] names, uint[] r, uint[] g, uint[] b);
    int SetBrightness(string type, uint index, uint value);
    int SetSpeed(string type, uint index, uint value);
}

internal sealed class PinnedMsiSdk : IMsiSdk
{
    internal const string DllSha256 = "AD1BD5A464C120F086839631CF9CB7A56E8E7373209158E66C628A89BE06D166";
    private IntPtr library;
    private Init? initialize;
    private Init? release;
    private Devices? getDevices;
    private Names? getDeviceNames;
    private LedInfo? getLedInfo;
    private Names? getLedNames;
    private ReadColor? getColor;
    private ReadLevel? getMaxBrightness;
    private ReadLevel? getMaxSpeed;
    private WriteStyle? setStyle;
    private WriteColor? setColor;
    private WriteColors? setColors;
    private WriteLevel? setBrightness;
    private WriteLevel? setSpeed;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Init();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Devices(
        [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] types,
        [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] counts);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Names([MarshalAs(UnmanagedType.BStr)] string type,
        [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] names);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int LedInfo([MarshalAs(UnmanagedType.BStr)] string type, uint index,
        [MarshalAs(UnmanagedType.BStr)] out string name,
        [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] styles);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ReadColor([MarshalAs(UnmanagedType.BStr)] string type, uint index, out uint r, out uint g, out uint b);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ReadLevel([MarshalAs(UnmanagedType.BStr)] string type, uint index, out uint value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int WriteStyle([MarshalAs(UnmanagedType.BStr)] string type, uint index, [MarshalAs(UnmanagedType.BStr)] string style);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int WriteColor([MarshalAs(UnmanagedType.BStr)] string type, uint index, uint r, uint g, uint b);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int WriteColors([MarshalAs(UnmanagedType.BStr)] string type, uint index,
        [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] ref string[] names,
        [In] uint[] r, [In] uint[] g, [In] uint[] b);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int WriteLevel([MarshalAs(UnmanagedType.BStr)] string type, uint index, uint value);

    private T Export<T>(string name) where T : Delegate => Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, name));
    private T? Optional<T>(string name) where T : Delegate => NativeLibrary.TryGetExport(library, name, out var address) ? Marshal.GetDelegateForFunctionPointer<T>(address) : null;
    public int Initialize()
    {
        if (library == IntPtr.Zero)
        {
            string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PRISM RGB Studio", "SDK", "MysticLight_SDK_x64.dll");
            if (!File.Exists(path)) throw new LightingException("MSI_SDK_MISSING", "Die optionale MSI-Anbindung ist noch nicht eingerichtet.");
            using (var stream = File.OpenRead(path))
                if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(DllSha256, StringComparison.OrdinalIgnoreCase))
                    throw new LightingException("MSI_SDK_INVALID", "Die MSI-Schnittstelle entspricht nicht der geprüften offiziellen Version. Bitte die Anbindung erneut einrichten.");
            library = NativeLibrary.Load(Path.GetFullPath(path), typeof(PinnedMsiSdk).Assembly, DllImportSearchPath.UseDllDirectoryForDependencies | DllImportSearchPath.System32);
            initialize = Export<Init>("MLAPI_Initialize"); release = Export<Init>("MLAPI_Release");
            getDevices = Export<Devices>("MLAPI_GetDeviceInfo"); getDeviceNames = Export<Names>("MLAPI_GetDeviceName");
            getLedInfo = Export<LedInfo>("MLAPI_GetLedInfo"); getLedNames = Optional<Names>("MLAPI_GetLedName");
            getColor = Export<ReadColor>("MLAPI_GetLedColor"); setStyle = Export<WriteStyle>("MLAPI_SetLedStyle");
            setColor = Export<WriteColor>("MLAPI_SetLedColor"); setColors = Optional<WriteColors>("MLAPI_SetLedColors");
            getMaxBrightness = Optional<ReadLevel>("MLAPI_GetLedMaxBright"); setBrightness = Optional<WriteLevel>("MLAPI_SetLedBright");
            getMaxSpeed = Optional<ReadLevel>("MLAPI_GetLedMaxSpeed"); setSpeed = Optional<WriteLevel>("MLAPI_SetLedSpeed");
        }
        return initialize!();
    }
    public int Release() => release?.Invoke() ?? 0;
    public int GetDevices(out string[] types, out string[] counts) => getDevices!(out types, out counts);
    public int GetDeviceNames(string type, out string[] names) => getDeviceNames!(type, out names);
    public int GetLedInfo(string type, uint index, out string name, out string[] styles) => getLedInfo!(type, index, out name, out styles);
    public int GetLedNames(string type, out string[] names) { names = []; return getLedNames == null || setColors == null ? -103 : getLedNames(type, out names); }
    public int GetColor(string type, uint index, out uint r, out uint g, out uint b) => getColor!(type, index, out r, out g, out b);
    public int GetMaxBrightness(string type, uint index, out uint maximum) { maximum = 0; return getMaxBrightness == null || setBrightness == null ? -103 : getMaxBrightness(type, index, out maximum); }
    public int GetMaxSpeed(string type, uint index, out uint maximum) { maximum = 0; return getMaxSpeed == null || setSpeed == null ? -103 : getMaxSpeed(type, index, out maximum); }
    public int SetStyle(string type, uint index, string style) => setStyle!(type, index, style);
    public int SetColor(string type, uint index, uint r, uint g, uint b) => setColor!(type, index, r, g, b);
    public int SetColors(string type, uint index, string[] names, uint[] r, uint[] g, uint[] b) => setColors == null ? -103 : setColors(type, index, ref names, r, g, b);
    public int SetBrightness(string type, uint index, uint value) => setBrightness == null ? -103 : setBrightness(type, index, value);
    public int SetSpeed(string type, uint index, uint value) => setSpeed == null ? -103 : setSpeed(type, index, value);
}

internal sealed class MsiLightingService(IMsiSdk? api = null)
{
    private readonly IMsiSdk sdk = api ?? new PinnedMsiSdk();
    private readonly Dictionary<string, int> stableIds = new(StringComparer.Ordinal);
    private readonly Dictionary<int, Area> devices = [];
    private int nextId = 20000;
    private bool initialized;
    public string Status { get; private set; } = "sdkMissing";
    public string Message { get; private set; } = "Die optionale MSI-Anbindung ist noch nicht eingerichtet.";
    public int ExcludedCount { get; private set; }
    public List<object> Discovery { get; } = [];
    public List<string> Warnings { get; } = [];
    private sealed record Area(string Type, uint Index, string Name, string[] Styles, string? DirectStyle, string[] LedNames, uint[] Colors, uint? BrightnessMax, uint? SpeedMax)
    { public string? AppliedStyle { get; set; } }
    private static bool Protected(string text) => Regex.IsMatch(text, @"stream[\s_-]*deck|elgato|vid[_:=\s-]?0fd9", RegexOptions.IgnoreCase);
    private static string Clean(string? text, string fallback) => string.IsNullOrWhiteSpace(text) ? fallback : text.Trim();
    private static int Kind(string type, string name)
    {
        string value = (type + " " + name).ToLowerInvariant();
        if (Regex.IsMatch(value, @"dram|dimm|memory|\bram\b|kingston|fury|hyperx")) return 1;
        if (value.Contains("msi_mb") || value.Contains("motherboard") || value.Contains("mainboard")) return 0;
        if (Regex.IsMatch(value, @"vga|gpu|graphics|geforce|radeon")) return 2;
        if (value.Contains("keyboard")) return 5;
        if (value.Contains("mouse")) return 6;
        if (Regex.IsMatch(value, @"fan|cooler|pump")) return 3;
        return 21;
    }
    private static string Vendor(string name) => Regex.IsMatch(name, @"kingston|fury|hyperx", RegexOptions.IgnoreCase) ? "Kingston" : name.Contains("Corsair", StringComparison.OrdinalIgnoreCase) ? "Corsair" : "MSI";
    private static string StyleId(string style) => "msi:style:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(style.Trim().ToLowerInvariant())))[..16].ToLowerInvariant();
    private static LightingException Error(int code) => new("MSI_ERROR", code switch {
        -3 => "MSI Center mit Mystic Light fehlt oder diese Version unterstützt die SDK-Steuerung nicht.",
        -4 => "Die MSI-Anbindung ist noch nicht initialisiert.", -2 => "Die MSI-Anbindung antwortet nicht rechtzeitig.",
        -101 => "Die MSI-Anbindung hat einen ungültigen Parameter abgelehnt.", -102 => "Das MSI-RGB-Ziel ist nicht mehr verfügbar.",
        -103 => "Diese Funktion wird von der ausgewählten MSI-RGB-Zone nicht unterstützt.", _ => $"Die MSI-Anbindung hat Fehler {code} gemeldet."
    });
    private static void Check(int code) { if (code != 0) throw Error(code); }
    private bool Initialize()
    {
        if (initialized) return true;
        try { int code = sdk.Initialize(); if (code != 0) { Status = code == -3 ? "notConnected" : "sdkError"; Message = Error(code).Message; return false; } initialized = true; return true; }
        catch (Exception error) { Status = error is LightingException e && e.Code == "MSI_SDK_MISSING" ? "sdkMissing" : "sdkError"; Message = error.Message; return false; }
    }

    public object[] Enumerate()
    {
        devices.Clear(); Discovery.Clear(); Warnings.Clear(); ExcludedCount = 0;
        if (!Initialize()) return [];
        int code = sdk.GetDevices(out var types, out var counts);
        if (code != 0) { Status = "unavailable"; Message = Error(code).Message; return []; }
        if (types == null || counts == null || types.Length != counts.Length || types.Length > 64 || types.Any(t => string.IsNullOrWhiteSpace(t) || t.Length > 256) || types.Distinct().Count() != types.Length)
            throw new LightingException("MSI_INVALID_DATA", "MSI hat eine ungültige RGB-Geräteliste geliefert.");
        var output = new List<object>();
        for (int typeIndex = 0; typeIndex < types.Length; typeIndex++)
        {
            string type = types[typeIndex];
            if (Protected(type)) { ExcludedCount++; continue; }
            if (!uint.TryParse(counts[typeIndex], NumberStyles.None, CultureInfo.InvariantCulture, out uint areaCount) || areaCount > 128)
            { Warnings.Add($"{type}: ungültige Anzahl von RGB-Zonen."); continue; }
            string[] friendly = sdk.GetDeviceNames(type, out var foundNames) == 0 && foundNames != null && foundNames.Length <= 128 ? foundNames : [];
            string[] allNames = sdk.GetLedNames(type, out var foundLeds) == 0 && foundLeds != null && foundLeds.Length <= 8192 ? foundLeds : [];
            if (friendly.Any(n => Protected(n ?? ""))) { ExcludedCount++; continue; }
            for (uint index = 0; index < areaCount; index++)
            {
                string name = friendly.Length == areaCount ? Clean(friendly[index], type) : friendly.Length == 1 ? Clean(friendly[0], type) : type;
                try
                {
                    Check(sdk.GetLedInfo(type, index, out var areaName, out var reportedStyles));
                    areaName = Clean(areaName, $"RGB-Zone {index + 1}");
                    if (Protected(areaName)) { ExcludedCount++; continue; }
                    name = name.Equals(areaName, StringComparison.OrdinalIgnoreCase) ? name : $"{name} · {areaName}";
                    if (name.Length > 512 || reportedStyles == null || reportedStyles.Length > 128 || reportedStyles.Any(s => string.IsNullOrWhiteSpace(s) || s.Length > 128))
                        throw new LightingException("MSI_INVALID_DATA", "MSI hat ungültige Zonen- oder Effektnamen gemeldet.");
                    string[] styles = reportedStyles.Distinct(StringComparer.Ordinal).Where(s => !s.Trim().Equals("Direct All Sync", StringComparison.OrdinalIgnoreCase)).DistinctBy(StyleId).ToArray();
                    // MSI's sample encodes named LEDs as '<area index>:<LED name>'.
                    // Only an unambiguous complete list for this area is usable.
                    string prefix = index.ToString(CultureInfo.InvariantCulture) + ":";
                    string[] ledNames = allNames.Where(n => n != null && n.StartsWith(prefix, StringComparison.Ordinal)).Select(n => n[prefix.Length..]).ToArray();
                    if (ledNames.Any(n => string.IsNullOrWhiteSpace(n) || n.Length > 256) || ledNames.Distinct(StringComparer.Ordinal).Count() != ledNames.Length) ledNames = [];
                    string? direct = ledNames.Length > 0 ? styles.FirstOrDefault(s => s.Equals("Direct Lighting Control", StringComparison.OrdinalIgnoreCase)) : null;
                    direct ??= styles.FirstOrDefault(s => s.Equals("Steady", StringComparison.OrdinalIgnoreCase) || s.Equals("Static", StringComparison.OrdinalIgnoreCase) || s.Equals("No Animation", StringComparison.OrdinalIgnoreCase));
                    if (direct == null || !direct.Equals("Direct Lighting Control", StringComparison.OrdinalIgnoreCase)) ledNames = [];
                    int ledCount = ledNames.Length > 0 ? ledNames.Length : 1;
                    bool known = false;
                    uint initial = 0;
                    if (ledNames.Length == 0 && sdk.GetColor(type, index, out uint red, out uint green, out uint blue) == 0 && red <= 255 && green <= 255 && blue <= 255) { initial = red | green << 8 | blue << 16; known = true; }
                    uint? brightness = sdk.GetMaxBrightness(type, index, out uint maxBright) == 0 && maxBright is > 0 and <= 10000 ? maxBright : null;
                    uint? speed = sdk.GetMaxSpeed(type, index, out uint maxSpeed) == 0 && maxSpeed is > 0 and <= 10000 ? maxSpeed : null;
                    string nativeId = $"{type}:{index}";
                    if (!stableIds.TryGetValue(nativeId, out int id)) stableIds[nativeId] = id = nextId++;
                    var colors = Enumerable.Repeat(initial, ledCount).ToArray();
                    int kind = Kind(type, name);
                    string? reason = direct == null ? "Diese MSI-Zone meldet keinen sicheren Modus für frei berechnete RGB-Effekte. Ihre Hersteller-Effekte sind separat verfügbar." : null;
                    var nativeEffects = styles.Select((style, modeId) => new { id = StyleId(style), modeId, name = style, provider = "msi", brightnessMax = brightness, speedMax = speed, colorCount = 1, colorsMax = 1, supportsDirection = false,
                        controls = new { brightness = brightness.HasValue, speed = speed.HasValue, colors = true, direction = false } }).ToArray();
                    devices[id] = new Area(type, index, name, styles, direct, ledNames, colors, brightness, speed);
                    output.Add(new { id, name, model = friendly.Length == areaCount ? friendly[index] : friendly.Length == 1 ? friendly[0] : null, vendor = Vendor(name), type = kind, nativeId,
                        provider = "msi", backend = "msi", location = "MSI Mystic Light SDK", description = ledNames.Length > 0 ? "Benannte LEDs einer MSI-RGB-Zone" : "Ein gemeinsamer SDK-Farbkanal; physische LED-Anzahl nicht gemeldet",
                        ledCount, ledGranularity = ledNames.Length > 0 ? "led" : "area", colors, colorsKnown = known, directMode = direct != null, directModeId = direct == null ? -1 : Array.IndexOf(styles, direct),
                        modes = styles.Select((style, modeId) => new { id = modeId, name = style }).ToArray(), nativeEffects,
                        zones = new[] { new { id = 0, name = areaName, startIndex = 0, ledCount } },
                        leds = colors.Select((color, ledIndex) => new { id = ledIndex, name = ledNames.Length > 0 ? ledNames[ledIndex] : areaName, color = $"#{color & 255:x2}{(color >> 8) & 255:x2}{(color >> 16) & 255:x2}" }).ToArray(), backgroundSupported = true, unavailableReason = reason });
                    Discovery.Add(new { name, vendor = Vendor(name), provider = "msi", status = direct != null || nativeEffects.Length > 0 ? "connected" : "unsupported", reason, type = kind, ledCount, controllable = direct != null, deviceId = id });
                    if (output.Count >= 128) { Warnings.Add("MSI meldet mehr RGB-Zonen als unterstützt; die übrigen werden nicht angeboten."); break; }
                }
                catch (Exception error) { Warnings.Add($"{name}: {error.Message}"); Discovery.Add(new { name, provider = "msi", status = "unavailable", reason = error.Message, controllable = false }); }
            }
            if (output.Count >= 128) break;
        }
        Status = "connected";
        Message = output.Count == 0 ? "MSI Mystic Light verbunden, aber keine unterstützten RGB-Zonen gemeldet." : $"{output.Count} tatsächliche RGB-Zonen über MSI Mystic Light erkannt.";
        return output.ToArray();
    }

    private Area Get(int id) => devices.TryGetValue(id, out var area) && !Protected(area.Type + " " + area.Name) ? area : throw new LightingException("DEVICE_NOT_FOUND", "Das MSI-RGB-Ziel ist nicht mehr verfügbar. Bitte erneut suchen.");
    public object Set(int id, JsonElement values)
    {
        var area = Get(id);
        if (area.DirectStyle == null) throw new LightingException("DIRECT_UNSUPPORTED", "Diese MSI-Zone meldet keinen sicheren Modus für frei berechnete RGB-Effekte.");
        if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() != area.Colors.Length) throw new LightingException("INVALID_COLORS", "Die MSI-Farbanzahl stimmt nicht mit der erkannten Zone überein.");
        uint[] colors = values.EnumerateArray().Select(v => v.TryGetUInt32(out uint color) && color <= 0xffffff ? color : throw new LightingException("INVALID_COLORS", "Ungültige MSI-RGB-Farbe.")).ToArray();
        if (area.AppliedStyle != area.DirectStyle) { Check(sdk.SetStyle(area.Type, area.Index, area.DirectStyle)); area.AppliedStyle = area.DirectStyle; }
        if (area.LedNames.Length == 0) Check(sdk.SetColor(area.Type, area.Index, colors[0] & 255, colors[0] >> 8 & 255, colors[0] >> 16 & 255));
        else Check(sdk.SetColors(area.Type, area.Index, area.LedNames, colors.Select(c => c & 255).ToArray(), colors.Select(c => c >> 8 & 255).ToArray(), colors.Select(c => c >> 16 & 255).ToArray()));
        colors.CopyTo(area.Colors, 0);
        return new { updated = true, deviceId = id, provider = "msi" };
    }

    public object Effect(int id, JsonElement command)
    {
        var area = Get(id);
        if (!command.TryGetProperty("modeId", out var modeValue) || !modeValue.TryGetInt32(out int modeId) || modeId < 0 || modeId >= area.Styles.Length) throw new LightingException("INVALID_EFFECT", "Ungültiger MSI-Hersteller-Effekt.");
        uint? brightness = Percentage(command, "brightness", area.BrightnessMax);
        uint? speed = Percentage(command, "speed", area.SpeedMax);
        if (command.TryGetProperty("direction", out var direction) && direction.GetString() != "forward") throw new LightingException("MSI_NOT_SUPPORTED", "Die MSI-Schnittstelle meldet keine steuerbare Effektrichtung.");
        uint? color = null;
        if (command.TryGetProperty("colors", out var rawColors))
        {
            if (rawColors.ValueKind != JsonValueKind.Array || rawColors.GetArrayLength() is < 1 or > 8) throw new LightingException("INVALID_COLORS", "Ungültige MSI-Effektfarbe.");
            if (rawColors.EnumerateArray().Any(v => v.ValueKind != JsonValueKind.String || !Regex.IsMatch(v.GetString() ?? "", @"^#[0-9a-fA-F]{6}$"))) throw new LightingException("INVALID_COLORS", "Ungültige MSI-Effektfarbe.");
            string? first = rawColors[0].GetString();
            if (first == null || !Regex.IsMatch(first, @"^#[0-9a-fA-F]{6}$")) throw new LightingException("INVALID_COLORS", "Ungültige MSI-Effektfarbe.");
            uint rgb = uint.Parse(first[1..], NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            color = (rgb >> 16 & 255) | (rgb >> 8 & 255) << 8 | (rgb & 255) << 16;
        }
        string style = area.Styles[modeId];
        Check(sdk.SetStyle(area.Type, area.Index, style)); area.AppliedStyle = style;
        if (color.HasValue)
        {
            if (style.Equals("Direct Lighting Control", StringComparison.OrdinalIgnoreCase) && area.LedNames.Length > 0)
                Check(sdk.SetColors(area.Type, area.Index, area.LedNames, Enumerable.Repeat(color.Value & 255, area.LedNames.Length).ToArray(), Enumerable.Repeat(color.Value >> 8 & 255, area.LedNames.Length).ToArray(), Enumerable.Repeat(color.Value >> 16 & 255, area.LedNames.Length).ToArray()));
            else Check(sdk.SetColor(area.Type, area.Index, color.Value & 255, color.Value >> 8 & 255, color.Value >> 16 & 255));
        }
        if (brightness.HasValue) Check(sdk.SetBrightness(area.Type, area.Index, brightness.Value));
        if (speed.HasValue) Check(sdk.SetSpeed(area.Type, area.Index, speed.Value));
        return new { updated = true, deviceId = id, provider = "msi", modeId, effect = style };
    }
    private static uint? Percentage(JsonElement command, string key, uint? max)
    {
        if (!command.TryGetProperty(key, out var raw) || raw.ValueKind == JsonValueKind.Null) return null;
        if (!raw.TryGetInt32(out int value) || value is < 0 or > 100) throw new LightingException("INVALID_EFFECT", $"Ungültiger MSI-Wert für {key}.");
        if (!max.HasValue) throw new LightingException("MSI_NOT_SUPPORTED", $"Diese MSI-Zone meldet keine Unterstützung für {key}.");
        return (uint)Math.Round(value * max.Value / 100.0, MidpointRounding.AwayFromZero);
    }
    public object Release()
    {
        if (initialized) sdk.Release(); initialized = false; devices.Clear();
        return new { released = true, provider = "msi" };
    }
}
