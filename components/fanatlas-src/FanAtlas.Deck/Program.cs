using System.Collections.Concurrent;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Security.Cryptography;

namespace FanAtlas.Deck;
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--render-test") { KeyImage.Draw("Jarvis", "", "Zuhören", "Bereit", false, false).Save(args[1], ImageFormat.Png); return 0; }
        try
        {
            string Arg(string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : ""; }
            if (!int.TryParse(Arg("-port"), out int port) || port < 1024 || port > 65535 || Arg("-pluginUUID").Length == 0 || Arg("-registerEvent") != "registerPlugin") return 2;
            using var plugin = new DeckPlugin();
            await plugin.Run(port, Arg("-pluginUUID"), Arg("-registerEvent")); return 0;
        }
        catch (Exception e) { Console.Error.WriteLine("FanAtlas Stream Deck: " + e.Message); return 1; }
    }
}
public sealed class DeckPlugin : IDisposable
{
    private readonly ClientWebSocket socket = new();
    private readonly SemaphoreSlim sendLock = new(1, 1);
    private readonly HttpClient http = new(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(3) };
    private readonly ConcurrentDictionary<string, ActionState> actions = new();
    private readonly ConcurrentDictionary<int, Task> keyOperations = new();
    private int keySequence;
    private readonly CancellationTokenSource lifetime = new();
    private JsonObject? snapshot,suiteSnapshot,suiteCatalog;
    private readonly string descriptorPath = Environment.GetEnvironmentVariable("FANATLAS_TEST_BRIDGE") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CrazyBatto", "BattoSuite", "FanAtlas", "bridge.json");
    private readonly string suiteDescriptor = Environment.GetEnvironmentVariable("BATTO_TEST_BRIDGE") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CrazyBatto", "BattoSuite", "bridge.json");
    private string address = "", token = "";
    private sealed class ActionState
    {
        public string Action { get; set; } = "";
        public JsonObject Settings { get; set; } = new();
        public string LastImageHash { get; set; } = "";
    }
    public async Task Run(int port, string uuid, string registration)
    {
        await socket.ConnectAsync(new Uri($"ws://127.0.0.1:{port}"), lifetime.Token);
        await Send(new { @event = registration, uuid });
        var poller = PollLoop();
        var buffer = new byte[65536];
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                using var message = new MemoryStream();
                WebSocketReceiveResult read;
                do { read = await socket.ReceiveAsync(buffer, lifetime.Token); if (read.MessageType == WebSocketMessageType.Close) return; message.Write(buffer, 0, read.Count); if (message.Length > 1_000_000) throw new InvalidDataException("Stream-Deck-Nachricht zu groß."); } while (!read.EndOfMessage);
                if (JsonNode.Parse(message.ToArray()) is JsonObject data)
                {
                    if (data["event"]?.GetValue<string>() == "keyDown") await DispatchKey(data);
                    else await Handle(data);
                }
            }
        }
        finally { lifetime.Cancel(); try { await Task.WhenAll(keyOperations.Values.Append(poller)); } catch (OperationCanceledException) { } }
    }
    private static string Text(JsonNode? node) => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : "";
    private bool Emergency(string context)
    {
        if (!actions.TryGetValue(context, out var state)) return false;
        var control = state.Settings["control"] as JsonObject;
        // Only explicit stop actions bypass the ordinary pending-action limit.
        // Combinations may contain other side effects and keep the usual limit.
        return state.Action.EndsWith(".control") && Text(control?["action"]) is "stop" or "speech-stop" or "cancel";
    }
    private async Task DispatchKey(JsonObject data)
    {
        string context = Text(data["context"]);
        if (keyOperations.Count >= (Emergency(context) ? 12 : 8))
        {
            await Send(new { @event = "showAlert", context }); return;
        }
        // Keep receiving settings, removals and stop keys while a Suite request
        // waits. The Suite still owns action ordering and validates each action.
        int id = Interlocked.Increment(ref keySequence);
        Task operation = HandleKey(data); keyOperations[id] = operation;
        _ = operation.ContinueWith(completed => keyOperations.TryRemove(id, out _), CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }
    private async Task HandleKey(JsonObject data)
    {
        try { await Handle(data); }
        catch (Exception) when (!lifetime.IsCancellationRequested)
        {
            await Send(new { @event = "showAlert", context = Text(data["context"]) });
        }
    }
    private async Task Send(object data)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(data));
        await sendLock.WaitAsync(lifetime.Token);
        try { if (socket.State == WebSocketState.Open) await socket.SendAsync(bytes, WebSocketMessageType.Text, true, lifetime.Token); }
        finally { sendLock.Release(); }
    }
    private async Task Handle(JsonObject e)
    {
        string evt = e["event"]?.GetValue<string>() ?? "", context = e["context"]?.GetValue<string>() ?? "";
        string action = e["action"]?.GetValue<string>() ?? "";
        var payload = e["payload"] as JsonObject ?? new();
        if (evt is "willAppear" or "didReceiveSettings")
        {
            actions.AddOrUpdate(context, _ => new() { Action = action, Settings = (payload["settings"]?.DeepClone() as JsonObject) ?? new() },
                (_, previous) => { previous.Settings = (payload["settings"]?.DeepClone() as JsonObject) ?? new(); previous.LastImageHash = ""; return previous; });
            await Render(context);
        }
        if (evt == "willDisappear") actions.TryRemove(context, out _);
        if (evt is "propertyInspectorDidAppear" or "sendToPlugin")
        {
            if (evt == "sendToPlugin" && payload["command"]?.GetValue<string>() != "catalog") return;
            await RefreshSnapshot();await RefreshSuite(true);
            await Send(new { @event = "sendToPropertyInspector", action, context, payload = new { online = Online, suiteOnline=SuiteOnline, catalog = snapshot?.DeepClone(), controls=suiteCatalog?.DeepClone() } });
        }
        if (evt == "keyDown" && actions.TryGetValue(context, out var state))
        {
            if (state.Action.EndsWith(".fan"))
            {
                var next = (JsonObject)state.Settings.DeepClone(); next["mode"] = next["mode"]?.GetValue<string>() switch { "percent" => "rpm", "rpm" => "temperature", "temperature" => "percent", _ => "rpm" }; state.Settings = next;
                await Send(new { @event = "setSettings", context, payload = state.Settings }); state.LastImageHash = ""; await Render(context);
            }
            else if (new[]{".listen",".scene",".control",".combo"}.Any(state.Action.EndsWith))
            {
                JsonObject value;
                if(state.Action.EndsWith(".listen"))value=new(){["action"]="listen"};
                else if(state.Action.EndsWith(".combo"))value=new(){["steps"]=state.Settings["steps"]?.DeepClone()??new JsonArray()};
                else value=state.Settings["control"]?.DeepClone() as JsonObject??new(){["action"]=state.Action.EndsWith(".scene")?"scene":"navigate",["target"]=state.Action.EndsWith(".scene")?"Pause":"jarvis"};
                bool ok=await SuitePost("/api/control",value);await Send(new{@event=ok?"showOk":"showAlert",context});await RefreshSuite();await Render(context);
            }
            else if (state.Action.EndsWith(".command") || state.Action.EndsWith(".sensor"))
            {
                string text = state.Settings["command"]?.GetValue<string>() ?? "";
                if (state.Action.EndsWith(".sensor")) text = (snapshot?["sensors"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(s => s["id"]?.GetValue<string>() == state.Settings["sensorId"]?.GetValue<string>())?["name"]?.GetValue<string>() ?? "";
                bool ok = await SuitePost("/api/command",new JsonObject{["text"]=text});
                await Send(new { @event = ok ? "showOk" : "showAlert", context });
            }
            else if (state.Action.EndsWith(".curve"))
            {
                string id = state.Settings["curveId"]?.GetValue<string>() ?? "";
                bool ok = false;
                try
                {
                    if (id.Length > 0 && Online)
                    {
                        using var request = new HttpRequestMessage(HttpMethod.Post, address + "/api/select-curve");
                        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                        request.Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(new { curveId = id }), Encoding.UTF8, "application/json");
                        using var response = await http.SendAsync(request, lifetime.Token); ok = response.IsSuccessStatusCode;
                    }
                }
                catch (Exception) when (!lifetime.IsCancellationRequested) { }
                await Send(new { @event = ok ? "showOk" : "showAlert", context });
                await RefreshSnapshot(); await Render(context);
            }
        }
    }
    private bool SuiteOnline=>suiteSnapshot!=null&&DateTime.TryParse(suiteSnapshot["generatedUtc"]?.GetValue<string>(),out var dt)&&DateTime.UtcNow-dt.ToUniversalTime()<TimeSpan.FromSeconds(10);
    private async Task<JsonObject?> SuiteRequest(string route,JsonObject? body=null){
        var file=new FileInfo(suiteDescriptor);if(!file.Exists||file.Length>8192)return null;
        var d=JsonNode.Parse(await File.ReadAllTextAsync(suiteDescriptor));int port=d?["port"]?.GetValue<int>()??0;var secret=d?["token"]?.GetValue<string>()??"";
        if(port!=(Environment.GetEnvironmentVariable("BATTO_TEST_INSTANCE")=="1"?17666:17656)||secret.Length!=64||!secret.All(Uri.IsHexDigit))return null;
        using var request=new HttpRequestMessage(body==null?HttpMethod.Get:HttpMethod.Post,$"http://127.0.0.1:{port}"+route);request.Headers.Authorization=new("Bearer",secret);
        if(body!=null)request.Content=new StringContent(body.ToJsonString(),Encoding.UTF8,"application/json");
        using var client=new HttpClient(new HttpClientHandler{UseProxy=false}){Timeout=TimeSpan.FromSeconds(body==null?3:110)};
        using var response=await client.SendAsync(request,lifetime.Token);if(!response.IsSuccessStatusCode)return null;string content=await response.Content.ReadAsStringAsync(lifetime.Token);return content.Length<=1000000?JsonNode.Parse(content) as JsonObject:null;
    }
    private async Task<bool> SuitePost(string route,JsonObject body){try{return (await SuiteRequest(route,body))?["ok"]?.GetValue<bool>()==true;}catch(Exception)when(!lifetime.IsCancellationRequested){return false;}}
    private async Task RefreshSuite(bool catalog=false){try{suiteSnapshot=await SuiteRequest("/api/state");if(catalog)suiteCatalog=await SuiteRequest("/api/catalog");}catch(Exception)when(!lifetime.IsCancellationRequested){suiteSnapshot=null;}}
    private bool Online => snapshot != null && DateTime.TryParse(snapshot["generatedUtc"]?.GetValue<string>(), out var dt) && DateTime.UtcNow - dt.ToUniversalTime() < TimeSpan.FromSeconds(10);
    private async Task RefreshSnapshot()
    {
        try
        {
            using var file = new FileStream(descriptorPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (file.Length > 8192) { snapshot = null; return; }
            var descriptor = await JsonNode.ParseAsync(file, cancellationToken: lifetime.Token);
            int port = descriptor?["port"]?.GetValue<int>() ?? 0;
            string secret = descriptor?["token"]?.GetValue<string>() ?? "";
            if (port < 1024 || port > 65535 || secret.Length != 64) { snapshot = null; return; }
            address = $"http://127.0.0.1:{port}"; token = secret;
            using var request = new HttpRequestMessage(HttpMethod.Get, address + "/api/state"); request.Headers.Authorization = new("Bearer", token);
            using var response = await http.SendAsync(request, lifetime.Token);
            if (!response.IsSuccessStatusCode) { snapshot = null; return; }
            string text = await response.Content.ReadAsStringAsync(lifetime.Token);
            if (text.Length > 2_000_000) { snapshot = null; return; }
            snapshot = JsonNode.Parse(text) as JsonObject;
        }
        catch (Exception) when (!lifetime.IsCancellationRequested) { snapshot = null; }
    }
    private async Task PollLoop()
    {
        while (!lifetime.IsCancellationRequested)
        {
            if(actions.Count>0){if(actions.Values.Any(a=>a.Action.EndsWith(".fan")||a.Action.EndsWith(".sensor")||a.Action.EndsWith(".curve")))await RefreshSnapshot();await RefreshSuite();}
            foreach (string id in actions.Keys) await Render(id);
            await Task.Delay(2000, lifetime.Token);
        }
    }
    private async Task Render(string context)
    {
        if (!actions.TryGetValue(context, out var action)) return;
        string name = "Lüfter wählen", main = "—", bottom = "", status = Online ? "Einrichten" : "FanAtlas offline";
        if (action.Action.EndsWith(".fan"))
        {
            string tileId = action.Settings["tileId"]?.GetValue<string>() ?? "";
            var tile = (snapshot?["scene"]?["tiles"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == tileId);
            if (tile != null)
            {
                name = tile["name"]?.GetValue<string>() ?? "Lüfter";
                var sensors = (snapshot?["sensors"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
                var temp = sensors.FirstOrDefault(s => s["id"]?.GetValue<string>() == tile["temperatureSensorId"]?.GetValue<string>());
                var rpm = sensors.FirstOrDefault(s => s["id"]?.GetValue<string>() == tile["rpmSensorId"]?.GetValue<string>());
                string Value(JsonObject? s, bool temperature) => Online && s?["fresh"]?.GetValue<bool>() == true && s["value"] != null ? s["value"]!.GetValue<double>().ToString("0.#", System.Globalization.CultureInfo.GetCultureInfo("de-DE")) + (temperature ? "°" : " " + s["unit"]?.GetValue<string>()) : "—";
                string mode = action.Settings["mode"]?.GetValue<string>() ?? "percent";
                var percent = tile["speedPercent"] as JsonObject;
                main = Value(mode == "rpm" ? rpm : mode == "temperature" ? temp : percent, mode == "temperature");
                if (main == "—" && mode == "percent") main = "— %";
                bottom = mode == "rpm" ? Value(percent, false) : Value(rpm, false);
                status = Online && mode == "percent" && percent?["fresh"]?.GetValue<bool>() == true ? (percent["basis"]?.GetValue<string>() == "rpm-reference" ? "% Max. RPM" : "Live %") : !Online ? "FanAtlas offline" : rpm?["fresh"]?.GetValue<bool>() == true ? "Live" : "Quelle fehlt";
            }
        }
        else if (action.Action.EndsWith(".sensor"))
        {
            var sensor = (snapshot?["sensors"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(s => s["id"]?.GetValue<string>() == action.Settings["sensorId"]?.GetValue<string>());
            name = sensor?["name"]?.GetValue<string>() ?? "Messwert wählen";
            bool fresh = Online && sensor?["fresh"]?.GetValue<bool>() == true && sensor["value"] != null;
            main = fresh ? sensor!["value"]!.GetValue<double>().ToString("0.##", System.Globalization.CultureInfo.GetCultureInfo("de-DE")) : "—";
            bottom = sensor?["unit"]?.GetValue<string>() ?? ""; status = fresh ? "Live · Vorlesen" : "Quelle fehlt";
        }
        else if (action.Action.EndsWith(".command"))
        {
            name = action.Settings["label"]?.GetValue<string>() ?? "Jarvis"; main = "JARVIS";
            bottom = action.Settings["command"]?.GetValue<string>() ?? "Befehl wählen"; status = SuiteOnline ? "Bereit" : "Batto offline";
        }
        else if (action.Action.EndsWith(".curve"))
        {
            string id = action.Settings["curveId"]?.GetValue<string>() ?? "";
            var curve = (snapshot?["curves"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(c => c["id"]?.GetValue<string>() == id);
            name = curve?["name"]?.GetValue<string>() ?? "Kurve wählen"; main = "KURVE"; bottom = "Entwurf";
            status = !Online ? "FanAtlas offline" : snapshot?["selectedCurveId"]?.GetValue<string>() == id ? "Ausgewählt" : "Öffnen";
        }
        else if(new[]{".listen",".scene",".control",".combo"}.Any(action.Action.EndsWith)){
            name=action.Settings["label"]?.GetValue<string>()??"Batto";
            main=action.Action.EndsWith(".listen")?"JARVIS":action.Action.EndsWith(".scene")?"SZENE":action.Action.EndsWith(".combo")?"KOMBI":"BATTO";
            bottom=action.Action.EndsWith(".listen")?"Fragen & zuhören":action.Settings["control"]?["target"]?.GetValue<string>()??"Tastenaktion";
            status=SuiteOnline?(action.Action.EndsWith(".scene")?suiteSnapshot?["program"]?["scene"]?.GetValue<string>()??"Bereit":"Bereit"):"Batto offline";
        }
        string signature=string.Join("|",name,main,bottom,status);if(signature==action.LastImageHash)return;
        using var bitmap = KeyImage.Draw(name, main, bottom, status, status is "FanAtlas offline" or "Quelle fehlt", action.Action.EndsWith(".fan"), action.Action.EndsWith(".sensor"));
        using var stream = new MemoryStream(); bitmap.Save(stream, ImageFormat.Png); byte[] bytes = stream.ToArray();
        action.LastImageHash = signature;
        await Send(new { @event = "setImage", context, payload = new { image = "data:image/png;base64," + Convert.ToBase64String(bytes), target = 0 } });
        await Send(new { @event = "setTitle", context, payload = new { title = "", target = 0 } });
    }
    public void Dispose() { lifetime.Cancel(); socket.Dispose(); http.Dispose(); sendLock.Dispose(); lifetime.Dispose(); }
}
public static class KeyImage
{
    public static Bitmap Draw(string name, string main, string bottom, string state, bool stale, bool fanArtwork = true, bool showValue = false)
    {
        var bmp = new Bitmap(144, 144); using var g = Graphics.FromImage(bmp); g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Color.FromArgb(7, 19, 35));
        string imagePath = Path.Combine(AppContext.BaseDirectory, fanArtwork ? "fan.png" : "deck-pause.png");
        if (File.Exists(imagePath)) { using var img = Image.FromFile(imagePath); g.DrawImage(img, fanArtwork ? new Rectangle(9, 9, 126, 126) : new Rectangle(0, 0, 144, 144)); }
        using var shade = new SolidBrush(Color.FromArgb(235, 7, 19, 35)); if(fanArtwork)g.FillEllipse(shade, 32, 35, 74, 74);
        using var outline = new Pen(stale ? Color.Gray : Color.Cyan, 2); if(fanArtwork)g.DrawEllipse(outline, 32, 35, 74, 74);
        void Text(string text, int size, FontStyle style, Color color, RectangleF box)
        { using var font = new Font("Segoe UI", size, style, GraphicsUnit.Pixel); using var brush = new SolidBrush(color); using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap }; g.FillRectangle(shade, box); g.DrawString(text, font, brush, box, format); }
        Text(name, 13, FontStyle.Bold, Color.White, new(0, 0, 144, 22));
        // Center text is drawn without the rectangular backdrop, preserving the circular fan hub.
        using (var font = new Font("Segoe UI", main.Length > 5 ? 16 : 23, FontStyle.Bold, GraphicsUnit.Pixel))
        using (var brush = new SolidBrush(Color.White))
        using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            if(fanArtwork||showValue){if(!fanArtwork)g.FillRectangle(shade,new RectangleF(24,48,96,44));g.DrawString(main, font, brush, new RectangleF(24,35,96,74), format);}
        Text(bottom, 14, FontStyle.Bold, Color.Cyan, new(0, 112, 144, 16));
        Text(state, 11, FontStyle.Regular, stale ? Color.Goldenrod : Color.LightGreen, new(0, 128, 144, 16));
        return bmp;
    }
}
