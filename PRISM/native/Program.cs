using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Windows.Devices.Enumeration;
using Windows.Devices.Lights;
using WinRT;

namespace Prism.WindowsLighting;

internal sealed class LightingException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

internal sealed class DeviceState(int id, string nativeId, string name, string vendor, LampArray lamp)
{
    public int Id { get; } = id;
    public string NativeId { get; } = nativeId;
    public string Name { get; } = name;
    public string Vendor { get; } = vendor;
    public LampArray Lamp { get; } = lamp;
    public uint[] Colors { get; set; } = new uint[lamp.LampCount];
    public long LastFrameTicks { get; set; }
    public bool Controlled { get; set; }
}

internal static class Ownership
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int GetBool(IntPtr self, out byte value);
    private static readonly Guid LampArray2Id = new("050c181f-60a8-4711-a1af-1b1b4c658ea2");

    public static bool IsForeground
    {
        get { GetWindowThreadProcessId(GetForegroundWindow(), out uint pid); return pid == Environment.ProcessId; }
    }

    public static bool? IsAvailable(LampArray lamp)
    {
        // Microsoft's Windows SDK projection omits this experimental v15 interface.
        // IID and ABI: microsoft/windows-rs, Windows/Devices/Lights/ILampArray2.
        // Read only; no raw USB, device handles, or feature reports are opened.
        var native = ((IWinRTObject)lamp).NativeObject;
        var iid = LampArray2Id;
        int hr = Marshal.QueryInterface(native.ThisPtr, ref iid, out IntPtr pointer);
        if (hr == unchecked((int)0x80004002)) return null;
        Marshal.ThrowExceptionForHR(hr);
        try
        {
            IntPtr table = Marshal.ReadIntPtr(pointer);
            IntPtr getter = Marshal.ReadIntPtr(table, 6 * IntPtr.Size);
            hr = Marshal.GetDelegateForFunctionPointer<GetBool>(getter)(pointer, out byte available);
            Marshal.ThrowExceptionForHR(hr);
            return available != 0;
        }
        finally { Marshal.Release(pointer); }
    }
}

internal sealed class LightingService
{
    private readonly Dictionary<string, int> stableIds = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, DeviceState> devices = [];
    private int nextId;
    public int ExcludedCount { get; private set; }
    public List<string> ScanWarnings { get; } = [];
    public List<object> Discovery { get; } = [];

    internal static bool IsExcluded(string id, string name, string manufacturer) =>
        id.Contains("VID_0FD9", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("Stream Deck", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("StreamDeck", StringComparison.OrdinalIgnoreCase) ||
        manufacturer.Contains("Elgato", StringComparison.OrdinalIgnoreCase);

    public async Task<object> Enumerate()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
            throw new LightingException("WINDOWS_LIGHTING_UNSUPPORTED", "Direkte Windows-Beleuchtung benötigt Windows 10 Version 1809 oder neuer.");
        ScanWarnings.Clear();
        Discovery.Clear();
        ExcludedCount = 0;
        var found = await DeviceInformation.FindAllAsync(LampArray.GetDeviceSelector(), ["System.Devices.Manufacturer", "System.Devices.ModelName", "System.Devices.FriendlyName", "System.ItemNameDisplay"]);
        if (found.Count > 128) throw new LightingException("TOO_MANY_DEVICES", "Windows meldet mehr als 128 RGB-Geräte.");
        HashSet<int> retained = [];
        foreach (var info in found)
        {
            string vendor = info.Properties.TryGetValue("System.Devices.Manufacturer", out object? value) ? value?.ToString() ?? "" : "";
            if (IsExcluded(info.Id, info.Name, vendor)) { ExcludedCount++; continue; }
            string name = PreferredName(info);
            if (IsExcluded(info.Id, name, vendor)) { ExcludedCount++; continue; }
            void Skip(string reason) { ScanWarnings.Add($"{name}: {reason}"); Discovery.Add(new { name, provider = "windows", status = "unavailable", reason, controllable = false }); }
            try
            {
                if (!stableIds.TryGetValue(info.Id, out int id)) { id = nextId++; stableIds[info.Id] = id; }
                if (devices.TryGetValue(id, out DeviceState? existing) && existing.Lamp.IsConnected) { retained.Add(id); continue; }
                var lamp = await LampArray.FromIdAsync(info.Id);
                if (lamp == null) { Skip("Windows hat den Zugriff verweigert."); continue; }
                if (lamp.HardwareVendorId == 0x0fd9 || IsExcluded(info.Id, name, vendor)) { ExcludedCount++; continue; }
                if (lamp.LampCount < 1 || lamp.LampCount > 8192) { Skip("LED-Anzahl außerhalb des unterstützten Bereichs."); continue; }
                devices[id] = new DeviceState(id, info.Id, name, string.IsNullOrWhiteSpace(vendor) ? $"VID {lamp.HardwareVendorId:X4}" : vendor, lamp);
                retained.Add(id);
            }
            catch (Exception e) { Skip(e.Message); }
        }
        foreach (int removed in devices.Keys.Where(id => !retained.Contains(id)).ToArray())
        {
            ReleaseDevice(devices[removed]); devices.Remove(removed);
        }
        var publicDevices = new List<object>();
        foreach (DeviceState device in devices.Values)
        {
            try
            {
                object details = PublicDevice(device);
                var row = JsonSerializer.SerializeToElement(details);
                bool programmable = row.GetProperty("directMode").GetBoolean();
                publicDevices.Add(details);
                Discovery.Add(new { name = device.Name, provider = "windows", status = programmable ? "connected" : "unsupported", reason = programmable ? (string?)null : "Windows meldet keine frei steuerbaren RGB-LEDs.", ledCount = device.Lamp.LampCount, controllable = programmable, deviceId = device.Id });
            }
            catch (Exception error) { ScanWarnings.Add($"{device.Name}: {error.Message}"); Discovery.Add(new { name = device.Name, provider = "windows", status = "unavailable", reason = error.Message, controllable = false }); }
        }
        return new
        {
            devices = publicDevices.ToArray(), discovery = Discovery.ToArray(),
            backend = "windows-lamparray",
            excludedCount = ExcludedCount,
            warnings = ScanWarnings.ToArray(),
            foreground = Ownership.IsForeground,
            backgroundSupported = false,
            compatibleOnly = true
        };
    }

    private static string PreferredName(DeviceInformation device)
    {
        foreach (string key in new[] { "System.Devices.ModelName", "System.Devices.FriendlyName", "System.ItemNameDisplay" })
            if (device.Properties.TryGetValue(key, out object? value) && value is string name && !string.IsNullOrWhiteSpace(name)) return name.Trim();
        return device.Name;
    }

    private object PublicDevice(DeviceState d)
    {
        string kind = d.Lamp.LampArrayKind.ToString();
        int type = kind switch { "Keyboard" => 5, "Mouse" => 6, "GameController" => 10, "Headset" or "Wearable" => 8, "Chassis" => TypeFromName(d.Name), "Scene" => 11, _ => 21 };
        string[] names = ["Mainboard", "Arbeitsspeicher", "Grafikkarte", "Kühlung", "LED-Streifen", "Tastatur", "Maus", "Mauspad", "Headset", "Headset-Ständer", "Gamepad", "Leuchte", "Lautsprecher", "Virtuelles Gerät", "Speicherlaufwerk", "Gehäuse", "Mikrofon", "Zubehör", "Tastenfeld", "Laptop", "Monitor", "RGB-Gerät"];
        bool connected = d.Lamp.IsConnected;
        bool? available = Ownership.IsAvailable(d.Lamp);
        bool programmable = Enumerable.Range(0, d.Lamp.LampCount).All(i => IsRgb(d.Lamp.GetLampInfo(i)));
        bool owned = Ownership.IsForeground && (available ?? true);
        return new
        {
            id = d.Id, name = d.Name, type, typeName = names[type], vendor = d.Vendor,
            location = "Windows · Dynamische Beleuchtung", description = kind,
            ledCount = d.Lamp.LampCount,
            zones = new[] { new { id = 0, name = "Alle LEDs", type = 1, startIndex = 0, ledCount = d.Lamp.LampCount, ledsMin = d.Lamp.LampCount, ledsMax = d.Lamp.LampCount } },
            leds = Enumerable.Range(0, d.Lamp.LampCount).Select(i => new { id = i, name = $"LED {i + 1}", value = i, color = Hex(d.Colors[i]) }).ToArray(),
            colors = d.Colors, directMode = connected && programmable, directModeId = 0,
            modes = new[] { new { id = 0, name = "Direct", colorMode = 1, flags = 0 } },
            available = owned, connected, ownershipKnown = available.HasValue,
            unavailableReason = owned ? null : Ownership.IsForeground ? "Windows hat den Beleuchtungszugriff gesperrt. Einstellungen → Personalisierung → Dynamische Beleuchtung prüfen." : "PRISM muss für die direkte Beleuchtung im Vordergrund bleiben.",
            nativeId = d.NativeId, backend = "windows-lamparray", minUpdateIntervalMs = d.Lamp.MinUpdateInterval.TotalMilliseconds,
            layoutValid = true, activeMode = 0
        };
    }

    private static int TypeFromName(string name)
    {
        string n = name.ToLowerInvariant();
        if (n.Contains("ram") || n.Contains("dimm") || n.Contains("memory")) return 1;
        if (n.Contains("gpu") || n.Contains("geforce") || n.Contains("radeon")) return 2;
        if (n.Contains("mainboard") || n.Contains("motherboard")) return 0;
        if (n.Contains("fan") || n.Contains("cooler")) return 3;
        return 15;
    }

    private static string Hex(uint packed) => $"#{packed & 255:x2}{(packed >> 8) & 255:x2}{(packed >> 16) & 255:x2}";

    private static bool IsRgb(LampInfo info) => info.RedLevelCount > 1 && info.GreenLevelCount > 1 && info.BlueLevelCount > 1;

    public object Set(int id, JsonElement values)
    {
        if (!devices.TryGetValue(id, out DeviceState? d)) throw new LightingException("DEVICE_NOT_FOUND", "Das RGB-Gerät ist nicht mehr verbunden. Bitte erneut suchen.");
        if (values.ValueKind != JsonValueKind.Array || values.GetArrayLength() != d.Lamp.LampCount)
            throw new LightingException("INVALID_COLORS", "Die Farbanzahl stimmt nicht mit der LED-Anzahl überein.");
        uint[] packed = values.EnumerateArray().Select(c => c.TryGetUInt32(out uint p) && p <= 0xffffff ? p : throw new LightingException("INVALID_COLORS", "Ungültige RGB-Farbe.")).ToArray();
        if (!Ownership.IsForeground) throw new LightingException("LIGHTING_UNAVAILABLE", "PRISM muss für die direkte Windows-Beleuchtung im Vordergrund bleiben.");
        if (!d.Lamp.IsConnected) throw new LightingException("DEVICE_DISCONNECTED", "Das RGB-Gerät wurde getrennt.");
        bool? available = Ownership.IsAvailable(d.Lamp);
        if (available == false) throw new LightingException("LIGHTING_UNAVAILABLE", "Windows hat den Beleuchtungszugriff gesperrt. Dynamische Beleuchtung und die Priorität der Anwendungen prüfen.");
        if (!Enumerable.Range(0, d.Lamp.LampCount).All(i => IsRgb(d.Lamp.GetLampInfo(i))))
            throw new LightingException("DEVICE_NOT_PROGRAMMABLE", "Dieses Gerät bietet keine frei programmierbaren LEDs.");
        long now = Stopwatch.GetTimestamp();
        double elapsed = d.LastFrameTicks == 0 ? double.MaxValue : (now - d.LastFrameTicks) * 1000.0 / Stopwatch.Frequency;
        if (elapsed < Math.Max(0, d.Lamp.MinUpdateInterval.TotalMilliseconds)) return new { applied = false, throttled = true };
        var colors = packed.Select(p => Windows.UI.Color.FromArgb(255, (byte)(p & 255), (byte)((p >> 8) & 255), (byte)((p >> 16) & 255))).ToArray();
        d.Lamp.IsEnabled = true;
        d.Controlled = true;
        d.Lamp.SetColorsForIndices(colors, Enumerable.Range(0, colors.Length).ToArray());
        d.Colors = packed; d.LastFrameTicks = now;
        return new { applied = true, throttled = false };
    }

    private static void ReleaseDevice(DeviceState d)
    {
        if (!d.Controlled) return;
        try { d.Lamp.IsEnabled = false; } catch { }
        d.Controlled = false;
    }

    public object Release()
    {
        foreach (var d in devices.Values) ReleaseDevice(d);
        return new { released = true };
    }
}

internal sealed class MainWindow : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly string userDataFolder;
    private readonly int expectedUiPort;
    public MainWindow(string userDataFolder, int expectedUiPort)
    {
        this.userDataFolder = userDataFolder;
        this.expectedUiPort = expectedUiPort;
        Text = "PRISM RGB Studio";
        Width = 1420; Height = 980; MinimumSize = new Size(850, 620);
        BackColor = System.Drawing.Color.FromArgb(12, 13, 18);
        StartPosition = FormStartPosition.CenterScreen;
        if (Environment.ProcessPath is string executable) Icon = System.Drawing.Icon.ExtractAssociatedIcon(executable);
        Controls.Add(web);
    }

    public async Task Open(string url)
    {
        if (!UiPolicy.TryLocalUrl(url, expectedUiPort, out Uri? uri))
            throw new LightingException("INVALID_URL", "PRISM kann nur seine lokale Steuerzentrale öffnen.");
        Show();
        if (web.CoreWebView2 != null) { Activate(); return; }
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userDataFolder);
        await web.EnsureCoreWebView2Async(environment);
        var core = web.CoreWebView2 ?? throw new LightingException("WEBVIEW2_START_FAILED", "Die lokale PRISM-Oberfläche konnte nicht geöffnet werden.");
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.PermissionRequested += (_, e) => { e.State = CoreWebView2PermissionState.Deny; };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (e.IsUserInitiated && UiPolicy.SafeExternalLink(e.Uri))
            {
                try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
            }
        };
        core.NavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) || target.Scheme != uri.Scheme || target.Host != uri.Host || target.Port != uri.Port) e.Cancel = true; };
        core.Navigate(uri!.AbsoluteUri);
        Activate();
    }

}

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    [STAThread]
    private static void Main(string[] args)
    {
        int expectedUiPort = UiPolicy.ParsePort(args);
        // GUI-subsystem applications have redirected pipes, but no console code page.
        // Calling Console.InputEncoding would fail with ERROR_INVALID_HANDLE.
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var lighting = new LightingService();
        var corsair = new CorsairLightingService();
        var msi = new MsiLightingService();
        using var dispatcher = new Control();
        _ = dispatcher.Handle;
        var context = new ApplicationContext();
        MainWindow? window = null;
        bool suppressWindowClosed = false;
        string userData = args.FirstOrDefault(a => a.StartsWith("--user-data="))?[12..] ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PRISM", "WebView2");

        object ReleaseAll() { lighting.Release(); corsair.Release(); msi.Release(); return new { released = true }; }

        async Task<object> Execute(JsonElement command)
        {
            string op = command.GetProperty("command").GetString() ?? "";
            switch (op)
            {
                case "enumerate":
                    JsonElement windows;
                    string windowsStatus = "ready", windowsMessage = "Direkte Windows-Beleuchtung ist verfügbar. Nur kompatible LampArray-Geräte werden angeboten.";
                    try { windows = JsonSerializer.SerializeToElement(await lighting.Enumerate(), JsonOptions); }
                    catch (Exception error)
                    {
                        windowsStatus = "unavailable"; windowsMessage = error.Message;
                        windows = JsonSerializer.SerializeToElement(new { devices = Array.Empty<object>(), discovery = Array.Empty<object>(), excludedCount = 0, warnings = new[] { error.Message } });
                    }
                    var windowsDevices = windows.GetProperty("devices").EnumerateArray().Select(d => d.Clone()).ToArray();
                    JsonElement[] cueDevices;
                    string corsairStatus, corsairMessage;
                    try
                    {
                        cueDevices = corsair.Enumerate().Select(d => JsonSerializer.SerializeToElement(d, JsonOptions)).ToArray();
                        corsairStatus = corsair.Status; corsairMessage = corsair.Message;
                    }
                    catch (Exception error) { cueDevices = []; corsairStatus = "unavailable"; corsairMessage = error.Message; corsair.Warnings.Add(error.Message); }
                    JsonElement[] msiDevices;
                    string msiStatus, msiMessage;
                    try
                    {
                        msiDevices = msi.Enumerate().Select(d => JsonSerializer.SerializeToElement(d, JsonOptions)).ToArray();
                        msiStatus = msi.Status; msiMessage = msi.Message;
                    }
                    catch (Exception error) { msiDevices = []; msiStatus = "unavailable"; msiMessage = error.Message; msi.Warnings.Add(error.Message); }
                    var windowsWarnings = windows.GetProperty("warnings").EnumerateArray().Select(w => w.GetString() ?? "").ToArray();
                    var discovered = windows.GetProperty("discovery").EnumerateArray().Select(d => d.Clone()).Concat(corsair.Discovery.Select(d => JsonSerializer.SerializeToElement(d, JsonOptions))).Concat(msi.Discovery.Select(d => JsonSerializer.SerializeToElement(d, JsonOptions))).ToArray();
                    return new
                    {
                        devices = windowsDevices.Concat(cueDevices).Concat(msiDevices).ToArray(), backend = "windows-native", compatibleOnly = true,
                        foreground = Ownership.IsForeground, backgroundSupported = cueDevices.Length > 0 || msiDevices.Length > 0,
                        excludedCount = windows.GetProperty("excludedCount").GetInt32() + corsair.ExcludedCount + msi.ExcludedCount, warnings = windowsWarnings.Concat(corsair.Warnings).Concat(msi.Warnings).ToArray(), discovery = discovered,
                        environment = new
                        {
                            windows = new { status = windowsStatus, message = windowsMessage, deviceCount = windowsDevices.Length, foreground = Ownership.IsForeground, backgroundSupported = false, warnings = windowsWarnings, excludedCount = windows.GetProperty("excludedCount").GetInt32() },
                            corsair = new { status = corsairStatus, message = corsairMessage, deviceCount = cueDevices.Length, backgroundSupported = true, warnings = corsair.Warnings.ToArray(), excludedCount = corsair.ExcludedCount },
                            msi = new { status = msiStatus, message = msiMessage, deviceCount = msiDevices.Length, backgroundSupported = true, warnings = msi.Warnings.ToArray(), excludedCount = msi.ExcludedCount }
                        }
                    };
                case "set":
                    int deviceId = command.GetProperty("deviceId").GetInt32();
                    return deviceId >= 20000 ? msi.Set(deviceId, command.GetProperty("colors")) : deviceId >= 10000 ? corsair.Set(deviceId, command.GetProperty("colors")) : lighting.Set(deviceId, command.GetProperty("colors"));
                case "effect":
                    int effectDevice = command.GetProperty("deviceId").GetInt32();
                    if (effectDevice < 20000) throw new LightingException("NATIVE_EFFECT_UNSUPPORTED", "Dieses Gerät meldet keinen unterstützten Hersteller-Effekt.");
                    return msi.Effect(effectDevice, command);
                case "release": return ReleaseAll();
                case "show":
                    try
                    {
                        if (window == null || window.IsDisposed)
                        {
                            window = new MainWindow(userData, expectedUiPort);
                            window.FormClosed += (_, _) => { if (suppressWindowClosed) return; ReleaseAll(); Emit(new { @event = "windowClosed" }); };
                        }
                        await window.Open(command.GetProperty("url").GetString() ?? "");
                        return new { shown = true, browser = "webview2", backgroundSupported = false };
                    }
                    catch (WebView2RuntimeNotFoundException)
                    {
                        suppressWindowClosed = true;
                        try { window?.Close(); } finally { suppressWindowClosed = false; }
                        throw new LightingException("WEBVIEW2_MISSING", "Die Microsoft Edge WebView2-Laufzeit fehlt. Bitte WebView2 von Microsoft installieren.");
                    }
                case "quit":
                    ReleaseAll(); window?.Close(); context.ExitThread(); return new { stopped = true };
                default: throw new LightingException("UNKNOWN_COMMAND", "Unbekannter Windows-Beleuchtungsbefehl.");
            }
        }

        Task<object> Dispatch(JsonElement command)
        {
            var completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            dispatcher.BeginInvoke(async () => { try { completion.SetResult(await Execute(command)); } catch (Exception e) { completion.SetException(e); } });
            return completion.Task;
        }

        _ = Task.Run(async () =>
        {
            string? line;
            while ((line = await Console.In.ReadLineAsync()) != null)
            {
                JsonElement requestId = default;
                try
                {
                    if (line.Length > 1024 * 1024) throw new LightingException("REQUEST_TOO_LARGE", "Der Beleuchtungsbefehl ist zu groß.");
                    using var document = JsonDocument.Parse(line);
                    var root = document.RootElement;
                    if (!root.TryGetProperty("requestId", out requestId)) throw new LightingException("INVALID_REQUEST", "Die Anfragenummer fehlt.");
                    requestId = requestId.Clone();
                    var result = await Dispatch(root);
                    Emit(new { requestId, ok = true, result });
                }
                catch (Exception e)
                {
                    string code = e is LightingException error ? error.Code : e is JsonException or InvalidOperationException or KeyNotFoundException or FormatException ? "INVALID_REQUEST" : "WINDOWS_LIGHTING_ERROR";
                    Emit(new { requestId = requestId.ValueKind == JsonValueKind.Undefined ? (object?)null : requestId, ok = false, error = new { code, message = e.Message } });
                }
            }
            dispatcher.BeginInvoke(() => { ReleaseAll(); window?.Close(); context.ExitThread(); });
        });
        string? initialUrl = args.FirstOrDefault(a => a.StartsWith("--url="))?[6..];
        if (initialUrl != null)
        {
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(new { command = "show", url = initialUrl }));
            JsonElement initial = document.RootElement.Clone();
            dispatcher.BeginInvoke(async () => { try { await Execute(initial); } catch (Exception e) { Emit(new { @event = "windowError", error = new { code = "WINDOW_ERROR", message = e.Message } }); } });
        }
        Application.Run(context);
        ReleaseAll();
    }

    private static void Emit(object value)
    {
        lock (Console.Out) { Console.WriteLine(JsonSerializer.Serialize(value, JsonOptions)); Console.Out.Flush(); }
    }
}
