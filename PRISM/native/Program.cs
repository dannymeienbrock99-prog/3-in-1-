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
