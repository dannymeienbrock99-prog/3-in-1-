using System.Text;
using System.Text.Json;
using Prism.LianLi;

Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = new UTF8Encoding(false);
var json = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
var controllers = new Dictionary<int, HidDevice>();
var endpoints = new Dictionary<int, Endpoint>();
using var wireless = new WirelessSession();
bool wirelessMode = args.Contains("--wireless");

object Fixtures()
{
    var settings = new EffectOptions("Static", ["#010203"], 100, 50, "forward");
    object Case(Endpoint e, EffectOptions s) => new { e.Pid, e.Port, e.Ring, s.EffectId, packets = Protocol.Effect(e, s).Select(p => new { p.Feature, bytes = Convert.ToHexString(p.Bytes) }) };
    var invalid = new List<string>();
    foreach (var bad in new[] { settings with { EffectId = "Direct" }, settings with { Brightness = 101 }, settings with { Colors = ["not-a-color"] }, settings with { Direction = "global" } })
        try { Protocol.Effect(new Endpoint(50000, 0, 0xa100, 2, "all", []), bad); } catch (ArgumentException) { invalid.Add(bad.EffectId); }
    var hs = Protocol.TlPacket(0xa1, [0x80, 0x04, 0xd2, 0xa2, 0, 0]);
    return new {
        cases = new[] {
            Case(new(50000, 0, 0xa100, 2, "all", []), settings),
            Case(new(50000, 0, 0xa102, 2, "outer", []), settings with { EffectId = "MopUp", Direction = "reverse", Brightness = 0 }),
            Case(new(50000, 0, 0xa104, 3, "outer", []), settings with { EffectId = "Meteor", Colors = ["#010203", "#040506"] }),
            Case(new(50000, 0, 0xa103, 0, "all", []), settings),
            Case(new(50000, 0, 0x7372, 2, "all", [0, 2]), settings with { EffectId = "MeteorShower" }) },
        invalidCount = invalid.Count,
        handshake = Protocol.ParseTlHandshake(hs).Select(f => new { f.Port, f.Fan, f.Rpm }),
        firmwareValid = Protocol.ValidFirmware(0xa102, [0xe0, 0x50, 0x80, 0xc4, 0x42]),
        firmwareMismatchRejected = !Protocol.ValidFirmware(0xa100, [0xe0, 0x50, 0x80, 0xc4, 0x42])
    };
}

void Clear()
{
    foreach (var device in controllers.Values) device.Dispose();
    controllers.Clear(); endpoints.Clear();
}

async Task<object> Enumerate()
{
    Clear();
    var warnings = new List<string>(); var discovery = new List<object>(); var devices = new List<object>();
    int controllerId = 0;
    foreach (var found in HidDevice.Enumerate().OrderBy(x => x.Path, StringComparer.OrdinalIgnoreCase))
    {
        if (controllerId >= 16) break;
        var nativeId = controllerId++;
        HidDevice? hid = null;
        try
        {
            var controllerDevices = new List<object>();
            hid = new HidDevice(found.Path, found.Vid, found.Pid, found.Product, found.Caps);
            var model = Protocol.ModelName(found.Pid);
            var reported = $"Lian Li UNI FAN {model}";
            int[]? rpms = null;
            if (Protocol.IsEne(found.Vid, found.Pid))
            {
                if (found.Caps.FeatureReportByteLength is < 6 or > 1024 || found.Caps.InputReportByteLength is < 10 or > 1024 || found.Caps.OutputReportByteLength is < 50 or > 1024)
                    throw new IOException("ENE HID-Berichte werden von diesem Windows-Treiber nicht vollständig unterstützt.");
                hid.Feature([0xe0, 0x50, 0x01]); await Task.Delay(20);
                var fw = hid.Input(0xe0, 5);
                if (!Protocol.ValidFirmware(found.Pid, fw)) throw new IOException("Die Firmware-Kennung passt nicht zum bekannten Lian-Li-Protokoll. Keine Schreibzugriffe erlaubt.");
                try
                {
                    hid.Feature([0xe0, 0x50, 0x00]); await Task.Delay(20);
                    var rawRpm = hid.Input(0xe0, Protocol.V2(found.Pid) ? 9 : 8);
                    int offset = Protocol.V2(found.Pid) ? 1 : 0;
                    rpms = Enumerable.Range(0, 4).Select(i => rawRpm[offset + i * 2] << 8 | rawRpm[offset + i * 2 + 1]).ToArray();
                }
                catch { warnings.Add($"{reported}: Drehzahl momentan nicht auslesbar."); }
                for (int port = 0; port < 4; port++)
                    foreach (var ring in Protocol.Dual(found.Pid) ? new[] { "inner", "outer" } : ["all"])
                    {
                        var e = new Endpoint(50000 + nativeId * 16 + port * 2 + (ring == "outer" ? 1 : 0), nativeId, found.Pid, port, ring, []);
                        var modes = Protocol.Modes(e).Where(m => {
                            var packets = Protocol.Effect(e, new EffectOptions(m.Id, ["#ffffff"], 100, 50, "forward"));
                            return packets.All(p => p.Feature ? p.Bytes.Length <= found.Caps.FeatureReportByteLength : p.Bytes.Length <= found.Caps.OutputReportByteLength);
                        }).ToArray();
                        if (modes.Length == 0) continue;
                        endpoints[e.Id] = e;
                        controllerDevices.Add(Public(e, modes, reported, rpms == null ? null : rpms[port], null));
                    }
            }
            else
            {
                var fans = Protocol.ParseTlHandshake(await hid.TlQuery(0xa1));
                foreach (var group in fans.GroupBy(x => x.Port).OrderBy(x => x.Key))
                {
                    var fanIds = group.Select(x => x.Fan).Order().ToArray();
                    var e = new Endpoint(50000 + nativeId * 16 + group.Key * 2, nativeId, found.Pid, group.Key, "all", fanIds);
                    endpoints[e.Id] = e;
                    controllerDevices.Add(Public(e, Protocol.Modes(e), reported, null, group.OrderBy(x => x.Fan).Select(f => new { index = f.Fan, rpm = f.Rpm }).ToArray()));
                }
            }
            controllers[nativeId] = hid; hid = null;
            devices.AddRange(controllerDevices);
            discovery.Add(new { name = reported, vendor = "Lian Li", vendorId = found.Vid, productId = found.Pid, provider = "lianli", status = "verified" });
        }
        catch (Exception error)
        {
            hid?.Dispose();
            foreach (var id in endpoints.Values.Where(e => e.ControllerId == nativeId).Select(e => e.Id).ToArray()) endpoints.Remove(id);
            warnings.Add($"Lian Li {Protocol.ModelName(found.Pid)}: {error.Message}");
            discovery.Add(new { name = $"Lian Li UNI FAN {Protocol.ModelName(found.Pid)}", vendor = "Lian Li", vendorId = found.Vid, productId = found.Pid, provider = "lianli", status = "unavailable" });
        }
    }
    return new { devices, discovery, warnings, environment = new { lianli = new { status = controllers.Count > 0 ? "ready" : discovery.Count > 0 ? "unavailable" : "not-found", controllerCount = controllers.Count, deviceCount = endpoints.Count,
        message = controllers.Count > 0 ? "Bekannte Lian-Li-HID-Controller geprüft. Effekte werden erst nach Auswahl gesendet." : discovery.Count > 0 ? "Lian-Li-Controller gefunden, aber Firmware oder Windows-HID-Treiber nicht passend. Kein Treiber wird ersetzt." : "Kein kompatibler Lian-Li-HID-Controller gefunden. Andere Controller und USB-Treiber bleiben unverändert." } } };
}

object Public(Endpoint e, Mode[] modes, string reported, int? rpm, object? fanRpms)
{
    string ringName = e.Ring == "inner" ? " · Innenring" : e.Ring == "outer" ? " · Außenring" : "";
    return new {
        id = e.Id, name = $"{reported} · Anschluss {e.Port + 1}{ringName}", vendor = "Lian Li", provider = "lianli", type = 21,
        typeName = "RGB-Controller", category = "fans", directMode = false, directModeId = (int?)null, ledCount = 0,
        physicalLedCount = (int?)null, ledGranularity = "area", colors = Array.Empty<int>(), leds = Array.Empty<object>(), zones = Array.Empty<object>(), modes = Array.Empty<object>(),
        nativeEffects = modes.Select(m => new { id = m.Id, name = m.Name, maxColors = e.Pid == 0xa104 ? 6 : 4, supportsBrightness = true, supportsSpeed = m.Id is not "Off" and not "Static" and not "StaticColorful", directions = new[] { "forward", "reverse" } }),
        controllerId = e.ControllerId, controllerFamily = Protocol.ModelName(e.Pid), port = e.Port, ring = e.Ring,
        vendorId = e.Pid == 0x7372 ? 0x0416 : 0x0cf2, productId = e.Pid,
        fanCount = e.Pid == 0x7372 ? (int?)e.FanIds.Length : null, detectedFanIds = e.FanIds, fanRpms, rpm,
        warning = e.Pid == 0x7372 ? "Gruppeneffekte benötigen eine Gruppen-Konfiguration. Hier werden nur sichere Effekte pro erkanntem Lüfter angeboten." : "Der Controller meldet keine angeschlossene Lüfteranzahl. Die Anschlussanzahl stammt aus dem Controller-Modell; Fan-Einstellungen bleiben erhalten.",
        acknowledgement = "Windows-HID-Übertragung"
    };
}

async Task<object> Apply(JsonElement request)
{
    int id = request.GetProperty("deviceId").GetInt32();
    if (!endpoints.TryGetValue(id, out var endpoint) || !controllers.TryGetValue(endpoint.ControllerId, out var hid)) throw new IOException("Lian-Li-Gerät nicht mehr verfügbar. Erneut suchen.");
    var settings = new EffectOptions(request.GetProperty("effectId").GetString()!, request.GetProperty("colors").EnumerateArray().Select(x => x.GetString()!).ToArray(), request.GetProperty("brightness").GetInt32(), request.GetProperty("speed").GetInt32(), request.GetProperty("direction").GetString()!);
    var packets = Protocol.Effect(endpoint, settings);
    if (packets.Any(p => p.Feature ? p.Bytes.Length > hid.Caps.FeatureReportByteLength : p.Bytes.Length > hid.Caps.OutputReportByteLength)) throw new IOException("Dieser Windows-Treiber unterstützt die benötigte Berichtgröße nicht.");
    if (endpoint.Pid == 0x7372)
    {
        var actual = Protocol.ParseTlHandshake(await hid.TlQuery(0xa1)).Where(f => f.Port == endpoint.Port).Select(f => f.Fan).Order().ToArray();
        if (!actual.SequenceEqual(endpoint.FanIds)) throw new IOException("Die angeschlossenen TL-Lüfter haben sich geändert. Bitte erneut suchen.");
    }
    // Entire request is validated before its first write.
    foreach (var packet in packets)
    {
        if (packet.Feature) hid.Feature(packet.Bytes); else await hid.Output(packet.Bytes);
        await Task.Delay(20);
    }
    return new { deviceId = id, effectId = settings.EffectId, transmitted = true, acknowledgement = "Windows-HID-Übertragung" };
}

async Task<object> Telemetry()
{
    var values = new List<object>(); bool layoutChanged = false;
    foreach (var (controllerId, hid) in controllers)
    {
        var selected = endpoints.Values.Where(e => e.ControllerId == controllerId).ToArray();
        try
        {
            if (Protocol.IsTl(hid.Vid, hid.Pid))
            {
                var fans = Protocol.ParseTlHandshake(await hid.TlQuery(0xa1));
                if (fans.Any(f => !selected.Any(e => e.Port == f.Port && e.FanIds.Contains(f.Fan)))) layoutChanged = true;
                foreach (var e in selected)
                {
                    var portFans = fans.Where(f => f.Port == e.Port).OrderBy(f => f.Fan).ToArray();
                    if (!portFans.Select(f => f.Fan).SequenceEqual(e.FanIds)) { layoutChanged = true; continue; }
                    values.Add(new { deviceId = e.Id, rpm = (int?)null, fanRpms = portFans.Select(f => new { index = f.Fan, rpm = f.Rpm }).ToArray() });
                }
            }
            else
            {
                hid.Feature([0xe0, 0x50, 0x00]); await Task.Delay(20);
                var raw = hid.Input(0xe0, Protocol.V2(hid.Pid) ? 9 : 8); int offset = Protocol.V2(hid.Pid) ? 1 : 0;
                foreach (var e in selected) values.Add(new { deviceId = e.Id, rpm = (int?)(raw[offset + e.Port * 2] << 8 | raw[offset + e.Port * 2 + 1]), fanRpms = (object?)null });
            }
        }
        catch { foreach (var e in selected) values.Add(new { deviceId = e.Id, rpm = (int?)null, fanRpms = (object?)null }); }
    }
    return new { devices = values, layoutChanged };
}

try
{
    if (args.Contains("--wireless-fixtures")) { Console.WriteLine(JsonSerializer.Serialize(WirelessProtocol.Fixtures(), json)); return; }
    if (args.Contains("--wireless-scan")) { Console.WriteLine(JsonSerializer.Serialize(await wireless.Scan(), json)); return; }
    if (args.Contains("--fixtures")) { Console.WriteLine(JsonSerializer.Serialize(Fixtures(), json)); return; }
    string? line;
    while ((line = await Console.In.ReadLineAsync()) != null)
    {
        int requestId = 0;
        try
        {
            if (line.Length > 65536) throw new ArgumentException("Anfrage zu groß");
            using var request = JsonDocument.Parse(line, new JsonDocumentOptions { MaxDepth = 12 });
            requestId = request.RootElement.GetProperty("requestId").GetInt32();
            string? command = request.RootElement.GetProperty("command").GetString();
            object result = command switch {
                "enumerate" => OperatingSystem.IsWindows() ? wirelessMode ? await wireless.Scan() : await Enumerate() : throw new PlatformNotSupportedException("Die Lian-Li-Anbindung benötigt Windows."),
                "animation" when wirelessMode => await wireless.Upload(request.RootElement),
                "effect" => await Apply(request.RootElement),
                "telemetry" => await Telemetry(),
                _ => throw new ArgumentException("Unbekannter Lian-Li-Befehl") };
            Console.WriteLine(JsonSerializer.Serialize(new { requestId, ok = true, result }, json));
        }
        catch (Exception error) { Console.WriteLine(JsonSerializer.Serialize(new { requestId, ok = false, error = new { code = error is WirelessAnimationTooLargeException ? "WIRELESS_ANIMATION_TOO_LARGE" : "LIANLI_ERROR", message = error.Message } }, json)); }
    }
}
finally { Clear(); }
