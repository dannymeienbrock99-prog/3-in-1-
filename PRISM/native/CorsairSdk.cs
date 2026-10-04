using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace Prism.WindowsLighting;

// Manufacturer SDK, not USB/HID probing. Shared LED access only: no keyboard
// events, interception, exclusive-device requests or iCUE setting changes.
internal sealed class CorsairLightingService
{
    private const string DllHash = "D72FD819B91FD1D3B0C3DB2EA17A47DCFE3B38E26269AA967ECFEE10D2E93884";
    private readonly Dictionary<string, int> stableIds = new(StringComparer.Ordinal);
    private readonly Dictionary<int, CueDevice> devices = [];
    private int nextId = 10000;
    private IntPtr library;
    private bool initialized;
    private int sessionState;
    private StateChanged? stateCallback;
    private Connect? connect;
    private Disconnect? disconnect;
    private GetDevices? getDevices;
    private GetPositions? getPositions;
    private SetColors? setColors;
    private ReadColors? readColors;
    private GetPropertyInfo? getPropertyInfo;
    private ReadProperty? readProperty;
    private FreeProperty? freeProperty;
    public string Status { get; private set; } = "sdkMissing";
    public string Message { get; private set; } = "Die optionale Corsair-Anbindung ist noch nicht eingerichtet.";
    public int DeviceCount => devices.Count;
    public List<object> Discovery { get; } = [];
    public List<string> Warnings { get; } = [];
    public int ExcludedCount { get; private set; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct DeviceInfo
    {
        public int Type;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Serial;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Model;
        public int LedCount;
        public int ChannelCount;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Filter { public int Mask; }
    [StructLayout(LayoutKind.Sequential)] private struct Position { public uint Id; public double X; public double Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Color { public uint Id; public byte R; public byte G; public byte B; public byte A; }
    // Official SDK x64 ABI: enum at byte 0; 16-byte union aligned at byte 8.
    [StructLayout(LayoutKind.Explicit, Size = 24)] private struct Property
    {
        [FieldOffset(0)] public int Type;
        [FieldOffset(8)] public int Int32;
        [FieldOffset(8)] public IntPtr Items;
        [FieldOffset(16)] public uint Count;
    }
    private sealed record ChannelDevice(int Index, string Name, int Type, int LedCount);
    private sealed record ChannelInfo(int Index, string Name, int? DeviceCount, int? DeviceType, int? LedCount, ChannelDevice[] Devices, bool Complete, string Source = "icue-configuration");
    private sealed record CueDevice(string NativeId, string Name, uint[] LedIds, uint[] Colors);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void StateChanged(IntPtr context, IntPtr state);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Connect(StateChanged callback, IntPtr context);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Disconnect();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int GetDevices(ref Filter filter, int capacity, [Out] DeviceInfo[] devices, out int size);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int GetPositions([MarshalAs(UnmanagedType.LPUTF8Str)] string id, int capacity, [Out] Position[] positions, out int size);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SetColors([MarshalAs(UnmanagedType.LPUTF8Str)] string id, int size, [In] Color[] colors);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ReadColors([MarshalAs(UnmanagedType.LPUTF8Str)] string id, int size, [In, Out] Color[] colors);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int GetPropertyInfo([MarshalAs(UnmanagedType.LPUTF8Str)] string id, int property, uint index, out int type, out uint flags);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int ReadProperty([MarshalAs(UnmanagedType.LPUTF8Str)] string id, int property, uint index, ref Property value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int FreeProperty(ref Property value);

    private T Export<T>(string name) where T : Delegate => Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, name));
    private T? OptionalExport<T>(string name) where T : Delegate => NativeLibrary.TryGetExport(library, name, out IntPtr pointer) ? Marshal.GetDelegateForFunctionPointer<T>(pointer) : null;
    private bool Initialize()
    {
        if (initialized) return true;
        string sdkPath = Environment.GetEnvironmentVariable("PRISM_CUE_SDK_PATH") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PRISM RGB Studio", "SDK", "iCUESDK.x64_2019.dll");
        if (!File.Exists(sdkPath)) { Status = "sdkMissing"; Message = "Die optionale Corsair-Anbindung ist noch nicht eingerichtet."; return false; }
        try
        {
            using var stream = File.OpenRead(sdkPath);
            if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(DllHash, StringComparison.OrdinalIgnoreCase))
                throw new LightingException("CUE_SDK_INVALID", "Die Corsair-Schnittstelle entspricht nicht der offiziellen geprüften Version. Bitte die Anbindung erneut einrichten.");
            if (library == IntPtr.Zero) library = NativeLibrary.Load(Path.GetFullPath(sdkPath));
            connect = Export<Connect>("CorsairConnect"); disconnect = Export<Disconnect>("CorsairDisconnect");
            getDevices = Export<GetDevices>("CorsairGetDevices"); getPositions = Export<GetPositions>("CorsairGetLedPositions");
            setColors = Export<SetColors>("CorsairSetLedColors"); readColors = Export<ReadColors>("CorsairGetLedColors");
            getPropertyInfo = OptionalExport<GetPropertyInfo>("CorsairGetDevicePropertyInfo");
            readProperty = OptionalExport<ReadProperty>("CorsairReadDeviceProperty"); freeProperty = OptionalExport<FreeProperty>("CorsairFreeProperty");
            stateCallback = (_, value) => { if (value != IntPtr.Zero) Volatile.Write(ref sessionState, Marshal.ReadInt32(value)); };
            int error = connect(stateCallback, IntPtr.Zero);
            if (error != 0) throw CueError(error);
            initialized = true;
            return true;
        }
        catch (Exception error)
        {
            Status = "sdkError"; Message = error.Message;
            return false;
        }
    }

    public object[] Enumerate()
    {
        devices.Clear();
        Discovery.Clear(); Warnings.Clear(); ExcludedCount = 0;
        if (!Initialize()) return [];
        for (int wait = 0; wait < 100 && Volatile.Read(ref sessionState) is 0 or 1 or 2; wait++) Thread.Sleep(20);
        int current = Volatile.Read(ref sessionState);
        if (current != 6)
        {
            Status = current == 4 ? "denied" : "notConnected";
            Message = current == 4 ? "iCUE verweigert den SDK-Zugriff. In iCUE unter SDK die Steuerung für PRISM erlauben." : "iCUE muss auf diesem PC mit denselben Benutzerrechten wie PRISM laufen. Die SDK-Steuerung muss in iCUE erlaubt sein.";
            return [];
        }
        // CDT_All discovers keyboards, mice and other supported lighting too.
        // Protected identities are rejected before any LED/property access.
        var filter = new Filter { Mask = unchecked((int)0xffffffff) };
        var infos = new DeviceInfo[64];
        int code = getDevices!(ref filter, infos.Length, infos, out int count);
        if (code != 0) { Status = "notConnected"; Message = CueError(code).Message; return []; }
        if (count < 0 || count > infos.Length) throw new LightingException("CUE_INVALID_DATA", "iCUE hat eine ungültige Geräteliste geliefert.");
        var output = new List<object>();
        for (int index = 0; index < count; index++)
        {
            var info = infos[index];
            string name = string.IsNullOrWhiteSpace(info.Model) ? "Corsair RGB-Komponente" : info.Model.Trim();
            int type = DeviceType(info.Type);
            if (Protected(info.Id + " " + name)) { ExcludedCount++; continue; }
            ChannelInfo[] channels = [];
            void Skip(string reason, string status = "unsupported")
            {
                Warnings.Add($"{name}: {reason}");
                Discovery.Add(new { name, provider = "corsair", status, reason, type, ledCount = info.LedCount, channels, controllable = false });
            }
            if (string.IsNullOrWhiteSpace(info.Id)) { Skip("iCUE meldet keinen gültigen Gerätebezeichner."); continue; }
            try
            {
                channels = ReadChannels(info.Id, name, info.ChannelCount);
                if (info.LedCount < 1) { Skip("iCUE meldet für dieses Gerät keine steuerbaren LEDs."); continue; }
                if (info.LedCount > 512) { Skip("Die LED-Anzahl liegt über der Grenze dieser Corsair-SDK-Version (512). Bitte die iCUE-Konfiguration prüfen."); continue; }
                var positions = new Position[512];
                int positionsCode = getPositions!(info.Id, positions.Length, positions, out int ledCount);
                if (positionsCode != 0) { Skip(CueError(positionsCode).Message, "unavailable"); continue; }
                if (ledCount < 1 || ledCount > positions.Length) { Skip("iCUE liefert keine gültige LED-Anordnung."); continue; }
                uint[] ledIds = positions.Take(ledCount).Select(position => position.Id).ToArray();
                if (ledIds.Any(id => (id & 0xffff) == 0) || ledIds.Distinct().Count() != ledIds.Length) { Skip("iCUE liefert ungültige oder doppelte LED-Bezeichner."); continue; }
                // Each documented DIY LED group is an actual controller channel.
                // Split only a complete validated partition; individual fan offsets
                // are not documented and therefore never inferred from LED totals.
                object[] zones = BuildChannelZones(ref ledIds, channels, info.ChannelCount);
                var colors = ledIds.Select(id => new Color { Id = id }).ToArray();
                int colorsCode = readColors!(info.Id, colors.Length, colors);
                uint[] packed = colorsCode == 0 ? colors.Select(color => (uint)(color.R | color.G << 8 | color.B << 16)).ToArray() : new uint[ledCount];
                if (colorsCode != 0) Warnings.Add($"{name}: Aktuelle LED-Farben konnten nicht gelesen werden. {CueError(colorsCode).Message}");
                if (!stableIds.TryGetValue(info.Id, out int id)) stableIds[info.Id] = id = nextId++;
                devices[id] = new CueDevice(info.Id, name, ledIds, packed);
                Discovery.Add(new { name, provider = "corsair", status = "connected", reason = (string?)null, type, ledCount, channels, controllable = true, deviceId = id });
                string vendor = name.StartsWith("ASUS", StringComparison.OrdinalIgnoreCase) ? "ASUS" : "Corsair";
                output.Add(new { id, name, model = name, vendor, type, description = "Direkte iCUE-Schnittstelle", location = "iCUE SDK", ledCount, directMode = true, colors = packed, colorsKnown = colorsCode == 0, zones, channels, provider = "corsair", backgroundSupported = true });
            }
            catch (Exception error) { Skip(error.Message, "unavailable"); }
        }
        Status = "connected";
        Message = output.Count == 0 ? "iCUE verbunden, aber keine unterstützten RGB-Geräte gemeldet." : $"{output.Count} RGB-Geräte über iCUE erkannt.";
        return output.ToArray();
    }

    private static int DeviceType(int type) => type switch
    {
        0x1 => 5, 0x2 => 6, 0x4 => 7, 0x8 => 8, 0x10 => 9, 0x20 => 3,
        0x40 => 4, 0x80 => 1, 0x100 => 3, 0x200 => 0, 0x400 => 2,
        0x800 => 18, 0x1000 => 10, _ => 21
    };

    private object? ReadValue(string id, string name, int propertyId, uint channel, int expectedType)
    {
        if (getPropertyInfo == null || readProperty == null || freeProperty == null) return null;
        int code = getPropertyInfo(id, propertyId, channel, out int type, out uint flags);
        if (code == 4) return null; // Property unavailable on this device.
        if (code != 0) { Warnings.Add($"{name}, Kanal {channel + 1}: Eigenschaft {propertyId} nicht verfügbar. {CueError(code).Message}"); return null; }
        if (type != expectedType || (flags & 1) == 0) { Warnings.Add($"{name}, Kanal {channel + 1}: Unerwarteter Typ für Eigenschaft {propertyId}."); return null; }
        var value = new Property();
        code = readProperty(id, propertyId, channel, ref value);
        if (code != 0) { Warnings.Add($"{name}, Kanal {channel + 1}: Eigenschaft {propertyId} konnte nicht gelesen werden. {CueError(code).Message}"); return null; }
        try
        {
            if (value.Type != expectedType) { Warnings.Add($"{name}, Kanal {channel + 1}: Ungültige Eigenschaftsdaten."); return null; }
            if (expectedType == 1)
            {
                if (value.Int32 is >= 0 and <= 512) return value.Int32;
                Warnings.Add($"{name}, Kanal {channel + 1}: Ungültige Anzahl für Eigenschaft {propertyId}.");
                return null;
            }
            if (value.Count > 512 || value.Count > 0 && value.Items == IntPtr.Zero) { Warnings.Add($"{name}, Kanal {channel + 1}: Ungültige Kanalgeräteliste."); return null; }
            var items = new int[value.Count];
            if (items.Length > 0) Marshal.Copy(value.Items, items, 0, items.Length);
            return items;
        }
        finally { freeProperty(ref value); }
    }

    private ChannelInfo[] ReadChannels(string id, string name, int channelCount)
    {
        if (channelCount == 0) return [];
        if (channelCount < 0 || channelCount > 64) { Warnings.Add($"{name}: Ungültige Kanalanzahl von iCUE."); return []; }
        var channels = new List<ChannelInfo>();
        for (uint channel = 0; channel < channelCount; channel++)
        {
            int? total = ReadValue(id, name, 10, channel, 1) as int?;
            int? count = ReadValue(id, name, 11, channel, 1) as int?;
            int[]? ledCounts = ReadValue(id, name, 12, channel, 17) as int[];
            int[]? types = ReadValue(id, name, 13, channel, 17) as int[];
            bool complete = count.HasValue && ledCounts?.Length == count.Value && types?.Length == count.Value && ledCounts.All(n => n >= 0 && n <= 512) && types.All(n => n >= 0);
            if (complete && total.HasValue && ledCounts!.Sum() != total.Value) { complete = false; Warnings.Add($"{name}, Kanal {channel + 1}: LED-Anzahl und konfigurierte Geräte stimmen nicht überein."); }
            ChannelDevice[] configured = complete ? types!.Select((type, i) => new ChannelDevice(i, ChannelName(type), type, ledCounts![i])).ToArray() : [];
            // Invalid type zero plus zero LEDs denotes an unnamed empty SDK
            // entry, not a detected physical device. Keep the reported metadata
            // but omit it from the human-readable configuration summary.
            var summary = configured.Where(d => d.Type != 0 || d.LedCount > 0).GroupBy(d => d.Name).Select(g => $"{g.Count()}× {g.Key}").ToArray();
            string label = $"Kanal {channel + 1}" + (summary.Length > 0 ? " · " + string.Join(", ", summary) : "") + " (iCUE-Konfiguration)";
            channels.Add(new ChannelInfo((int)channel, label, count, types?.Distinct().Count() == 1 ? types[0] : null, total, configured, complete));
        }
        return channels.ToArray();
    }

    private static string ChannelName(int type) => type switch
    {
        1 => "Corsair HD RGB-Lüfter", 2 => "Corsair SP RGB-Lüfter", 3 => "Corsair LL RGB-Lüfter",
        4 => "Corsair ML RGB-Lüfter", 5 => "Corsair QL RGB-Lüfter", 6 => "Corsair 8-LED-Lüfter",
        7 => "Corsair LED-Streifen", 8 => "Corsair DAP", 9 => "Corsair Pumpe",
        10 => "Corsair RAM-Modul", 11 => "Corsair Wasserblock", 12 => "Corsair QX RGB-Lüfter",
        _ => "Kanalgerät · Modell nicht gemeldet"
    };

    private static object[] BuildChannelZones(ref uint[] ledIds, ChannelInfo[] channels, int reportedChannels)
    {
        var groups = ledIds.GroupBy(id => (int)(id >> 16)).OrderBy(g => g.Key).ToArray();
        bool valid = reportedChannels is >= 1 and <= 64 && groups.All(g => g.Key is >= 11 and <= 13 && g.Key - 11 < reportedChannels);
        if (valid) valid = groups.All(g => channels.FirstOrDefault(c => c.Index == g.Key - 11)?.LedCount is not int count || count == g.Count());
        if (!valid) return [new { id = 0, name = "Alle LEDs", startIndex = 0, ledCount = ledIds.Length }];
        ledIds = groups.SelectMany(group => group).ToArray();
        var zones = new List<object>();
        int start = 0;
        foreach (var group in groups)
        {
            int channel = group.Key - 11;
            string name = channels.FirstOrDefault(c => c.Index == channel)?.Name ?? $"Kanal {channel + 1}";
            zones.Add(new { id = channel + 1, name, startIndex = start, ledCount = group.Count() });
            start += group.Count();
        }
        return zones.ToArray();
    }

    public object Set(int id, JsonElement rawColors)
    {
        if (!devices.TryGetValue(id, out CueDevice? device)) throw new LightingException("DEVICE_NOT_FOUND", "Corsair-Gerät nicht mehr verfügbar. Bitte erneut suchen.");
        if (Protected(device.NativeId + " " + device.Name)) throw new LightingException("DEVICE_PROTECTED", "Stream Deck und Elgato-Geräte sind ausgeschlossen.");
        if (rawColors.ValueKind != JsonValueKind.Array || rawColors.GetArrayLength() != device.LedIds.Length) throw new LightingException("INVALID_COLORS", "Ungültige Corsair-LED-Farbenanzahl.");
        uint[] packed = rawColors.EnumerateArray().Select(value => value.TryGetUInt32(out uint color) && color <= 0xffffff ? color : throw new LightingException("INVALID_COLORS", "Ungültiger LED-Farbwert.")).ToArray();
        var colors = packed.Select((color, index) => new Color { Id = device.LedIds[index], R = (byte)color, G = (byte)(color >> 8), B = (byte)(color >> 16), A = 255 }).ToArray();
        int error = setColors!(device.NativeId, colors.Length, colors);
        if (error != 0) throw CueError(error);
        packed.CopyTo(device.Colors, 0);
        return new { updated = true, deviceId = id, provider = "corsair" };
    }

    public object Release()
    {
        if (initialized) disconnect!();
        initialized = false; Volatile.Write(ref sessionState, 0); devices.Clear();
        // Keep the loaded library/delegates alive until process exit, avoiding
        // unloading a DLL while its asynchronous callback is still completing.
        return new { released = true, provider = "corsair" };
    }
    private static bool Protected(string identity) => System.Text.RegularExpressions.Regex.IsMatch(identity, @"stream[\s_-]*deck|elgato|vid[_:=\s-]?0fd9", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    private static LightingException CueError(int code) => new(code == 2 ? "CUE_NO_CONTROL" : "CUE_ERROR", code switch {
        1 => "iCUE ist nicht verbunden oder die SDK-Steuerung ist gesperrt.",
        2 => "Eine andere iCUE-Anwendung hat die Beleuchtungssteuerung. PRISM fordert keinen exklusiven Zugriff an.",
        3 => "Die iCUE-Version unterstützt diese SDK-Anfrage nicht.",
        6 => "Das Corsair-Gerät ist nicht mehr verbunden.",
        7 => "iCUE erlaubt diese Anfrage nicht.",
        _ => $"Die Corsair-Schnittstelle hat Fehler {code} gemeldet."
    });
}
