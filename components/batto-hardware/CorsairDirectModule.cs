using System.Buffers.Binary;
using System.Text.Json;

namespace Batto.Hardware;

/// <summary>Own one explicitly chosen LINK hub in Batto; no SDK, child process or automatic takeover.</summary>
internal sealed class CorsairDirectModule : IDisposable
{
    readonly SemaphoreSlim gate = new(1, 1);
    readonly Func<bool, object> takeVendor;
    readonly Func<object> releaseVendor, vendorStatus;
    readonly Func<CorsairDirectIdentity[]> discover;
    readonly Func<CorsairDirectIdentity, ICorsairDirectTransport> open;
    readonly Action<int> delay;
    readonly Func<DateTimeOffset> now;
    readonly Dictionary<int, int> requested = new();
    ICorsairDirectTransport? transport;
    CorsairDirectIdentity[] hubs = [];
    CorsairDirectProtocol.Channel[] topology = [];
    Version? firmware;
    Timer? watchdog;
    DateTimeOffset heartbeat;
    Dictionary<int, int?> rpms = [], temperatures = [];
    bool enabled, modeMayBeOwned, vendorPending, ledVerified;
    string phase = "off", error = "", releaseVerification = "none";
    object? vendorLease;
    int queued;
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    internal CorsairDirectModule(Func<bool, object> takeVendor, Func<object> releaseVendor, Func<object> vendorStatus)
        : this(takeVendor, releaseVendor, vendorStatus, CorsairDirectTransport.Discover, identity => new CorsairDirectTransport(identity),
            milliseconds => Thread.Sleep(milliseconds), () => DateTimeOffset.UtcNow, true) { }
    internal CorsairDirectModule(Func<bool, object> takeVendor, Func<object> releaseVendor, Func<object> vendorStatus,
        Func<CorsairDirectIdentity[]> discover, Func<CorsairDirectIdentity, ICorsairDirectTransport> open,
        Action<int> delay, Func<DateTimeOffset> now, bool useWatchdog = false)
    {
        this.takeVendor = takeVendor; this.releaseVendor = releaseVendor; this.vendorStatus = vendorStatus;
        this.discover = discover; this.open = open; this.delay = delay; this.now = now;
        if (useWatchdog) watchdog = new Timer(CheckLease, null, Timeout.Infinite, Timeout.Infinite);
    }
    internal object Dispatch(JsonElement request)
    {
        if (Interlocked.Increment(ref queued) > 4) { Interlocked.Decrement(ref queued); throw new CorsairDirectException("CORSAIR_BUSY", "Batto verarbeitet bereits Corsair-Anfragen."); }
        bool locked = false;
        try
        {
            locked = gate.Wait(TimeSpan.FromSeconds(5)); if (!locked) throw new TimeoutException("Corsair-Anfrage ist noch in Arbeit.");
            string command = request.GetProperty("command").GetString() ?? "";
            return command switch
            {
                "status" or "control-status" => Snapshot(),
                "enumerate" => Enumerate(),
                "enable" or "take-control" => Take(request),
                "heartbeat" or "telemetry" => Telemetry(),
                "manual" => Manual(request),
                "set" or "set-colors" => SetColors(request),
                "release" or "release-control" or "close" or "shutdown" => Release(),
                _ => throw new ArgumentException("Unbekannter direkter Corsair-Befehl.")
            };
        }
        catch (Exception failure) { error = failure.Message; if (modeMayBeOwned || vendorPending) phase = "error"; throw; }
        finally { if (locked) gate.Release(); Interlocked.Decrement(ref queued); }
    }
    static bool Successful(object reply)
    {
        var value = JsonSerializer.SerializeToElement(reply, Json);
        return value.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;
    }
    object Snapshot()
    {
        vendorLease = vendorStatus();
        bool active = modeMayBeOwned || vendorPending;
        string hubId = transport?.Identity.Id ?? "";
        var visibleTopology = transport == null ? Array.Empty<CorsairDirectProtocol.Channel>() : topology;
        var channels = visibleTopology.Where(c => c.Known?.Fan == true && !c.Known.Pump).Select(c => new
        {
            id = FanId(c), hubId, channel = c.Index, serial = c.Serial, name = "Corsair " + c.Known!.Name + " · " + c.Index,
            kind = "fan", provider = "corsair-direct", device = "iCUE LINK System Hub", rpm = rpms.GetValueOrDefault(c.Index),
            duty = requested.TryGetValue(c.Index, out var duty) ? (int?)duty : null, minDuty = 30, maxDuty = 100,
            requestedOnly = true, physicalVerification = false
        }).ToArray();
        int leds = ledVerified ? topology.Sum(c => c.Known!.Leds) : 0;
        int startIndex = 0;
        var zones = topology.Where(c => c.Known?.Leds > 0).OrderBy(c => c.Index).Select(c =>
        {
            var zone = new { id = c.Index - 1, startIndex, name = c.Known!.Name + " · " + c.Index, type = 1,
                ledsCount = c.Known.Leds, ledCount = c.Known.Leds, channel = c.Index };
            startIndex += c.Known.Leds; return zone;
        }).ToArray();
        var devices = enabled && leds > 0 && transport != null ? new object[] { new
        {
            id = hubId, deviceId = hubId, nativeId = hubId, hubId, name = "Corsair iCUE LINK System Hub", model = "iCUE LINK System Hub",
            serial = transport.Identity.Serial, vendor = "Corsair", type = 2, provider = "corsair-direct", ledCount = leds,
            firmware = firmware?.ToString(), directMode = true, backgroundSupported = true,
            zones
        } } : Array.Empty<object>();
        return new
        {
            enabled, active, ownsControl = modeMayBeOwned, phase, error, inProcess = true, requiresICue = false,
            released = !active, retryRequired = phase == "error" && active,
            remaining = active ? new[] { modeMayBeOwned ? "Corsair iCUE LINK hardware mode" : "Corsair services" } : Array.Empty<string>(),
            releaseVerification, physicalVerification = false, vendorLease,
            hubs = hubs.Select(h => new { id = h.Id, serial = h.Serial, name = h.Name, vendorId = h.VendorId, productId = h.ProductId,
                firmware = transport?.Identity.Id == h.Id ? firmware?.ToString() : null, opened = transport?.Identity.Id == h.Id }).ToArray(),
            hubId, channels, devices, sensors = visibleTopology.Where(c => temperatures.GetValueOrDefault(c.Index) != null).Select(c => new
                { id = hubId + "/temperature/" + c.Index, name = c.Known?.Name ?? "LINK Sensor", celsius = temperatures[c.Index] / 10.0, updatedUtc = heartbeat.ToString("O") }).ToArray(),
            rgbAvailable = devices.Length > 0, rgbReason = devices.Length > 0 ? "" : "RGB benötigt eine vollständig bekannte und frisch bestätigte LED-Topologie.",
            unsupported = topology.Where(c => c.Known == null).Select(c => new { channel = c.Index, type = c.Type, variant = c.Variant, serial = c.Serial }).ToArray()
        };
    }
    string FanId(CorsairDirectProtocol.Channel channel) => (transport?.Identity.Id ?? "") + "/fan/" + channel.Index + "/" + channel.Serial;
    object Enumerate()
    {
        if (modeMayBeOwned || vendorPending) return Telemetry();
        hubs = discover();
        // Enumeration lists real exact USB identities. A passive firmware check
        // opens only a temporary handle; it never requests software mode/PWM.
        var probes = new List<object>();
        foreach (var hub in hubs)
        {
            try
            {
                using var probe = open(hub); using var transaction = probe.BeginTransaction();
                var version = CorsairDirectProtocol.Firmware(probe.Exchange(CorsairDirectProtocol.FirmwareCommand, []));
                var devices = ReadTopology(probe);
                probes.Add(new { id = hub.Id, firmware = version.ToString(), connected = devices.Length, channelNames = devices.Select(c => c.Known?.Name ?? "Nicht unterstütztes LINK-Gerät").ToArray(), readable = true });
            }
            catch (Exception failure) { probes.Add(new { id = hub.Id, readable = false, reason = failure.Message }); }
        }
        return new { state = Snapshot(), hubs = hubs.Select(h => new { id = h.Id, serial = h.Serial, name = h.Name, vendorId = h.VendorId, productId = h.ProductId }).ToArray(),
            devices = Array.Empty<object>(), probes = probes.ToArray(), readOnly = true, hardwareModeChanged = false, pwmWrites = 0 };
    }
    object Take(JsonElement request)
    {
        if (!request.TryGetProperty("confirmICuePause", out var confirmation) || confirmation.ValueKind != JsonValueKind.True)
            throw new CorsairDirectException("CORSAIR_CONFIRMATION_REQUIRED", "Die bewusste Corsair-Übernahme muss zuerst bestätigt werden.");
        if (enabled && modeMayBeOwned) return Snapshot();
        if (transport != null || modeMayBeOwned || vendorPending) throw new CorsairDirectException("CORSAIR_RELEASE_REQUIRED", "Die vorherige Corsair-Übernahme muss zuerst sicher beendet werden.");
        hubs = discover();
        string? chosen = request.TryGetProperty("hubId", out var value) ? value.GetString() : null;
        var hub = chosen == null && hubs.Length == 1 ? hubs[0] : hubs.SingleOrDefault(h => h.Id == chosen);
        if (hub == null) throw new CorsairDirectException("CORSAIR_HUB_REQUIRED", "Bitte einen eindeutig erkannten iCUE-LINK-Hub auswählen.");
        vendorPending = true; vendorLease = takeVendor(true);
        if (!Successful(vendorLease)) { phase = "error"; throw new CorsairDirectException("CORSAIR_VENDOR_PAUSE_FAILED", "Die Corsair-Gerätedienste konnten nicht übernommen werden."); }
        phase = "starting"; releaseVerification = "none";
        try
        {
            transport = open(hub); using var transaction = transport.BeginTransaction();
            firmware = CorsairDirectProtocol.Firmware(transport.Exchange(CorsairDirectProtocol.FirmwareCommand, []));
            // Record uncertainty BEFORE mode submission: even a lost ACK must be returned via explicit OFF retry.
            modeMayBeOwned = true; transport.Exchange(CorsairDirectProtocol.SoftwareCommand, []); delay(500);
            topology = ReadTopology(transport);
            if (!topology.Any(c => c.Known?.Fan == true)) throw new CorsairDirectException("CORSAIR_NO_SUPPORTED_FANS", "Der LINK-Hub meldet keine sicher unterstützten Lüfter.");
            RefreshValues(); enabled = true; phase = "ready"; error = ""; heartbeat = now(); watchdog?.Change(1000, 1000);
            return Snapshot();
        }
        catch (Exception failure)
        {
            error = failure.Message; phase = "error";
            // Try genuine hardware-mode return, never a 50% substitute. Failed
            // rollback preserves both the HID handle and the vendor obligation.
            try { Release(); } catch { }
            throw;
        }
    }
    static byte[] ReadEndpoint(ICorsairDirectTransport device, byte endpoint, ushort? type = null, bool continued = false)
    {
        device.Exchange([5, 1, 1], [endpoint]); device.Exchange([13, 1], [endpoint]);
        try
        {
            var first = device.Exchange([8, 1], [], type);
            if (!continued) return first;
            var next = device.Exchange([8, 1], []);
            var output = new byte[first.Length + next.Length - 4]; first.CopyTo(output, 0); next.AsSpan(4).CopyTo(output.AsSpan(first.Length)); return output;
        }
        finally { device.Exchange([5, 1, 1], [endpoint]); }
    }
    static CorsairDirectProtocol.Channel[] ReadTopology(ICorsairDirectTransport device)
    {
        device.Exchange([5, 1, 1], [0x36]); device.Exchange([13, 1], [0x36]);
        try { return CorsairDirectProtocol.Topology(device.Exchange([8, 1], [], 0x21), device.Exchange([8, 1], [])); }
        finally { device.Exchange([5, 1, 1], [0x36]); }
    }
    void RefreshValues()
    {
        if (transport == null) return;
        rpms = CorsairDirectProtocol.Values(ReadEndpoint(transport, 0x17, 0x25));
        temperatures = CorsairDirectProtocol.Values(ReadEndpoint(transport, 0x21, 0x10), true);
        // A failed optional LED probe disables RGB; it does not fabricate an LED count.
        try { ledVerified = CorsairDirectProtocol.LedTopologyMatches(ReadEndpoint(transport, 0x20), topology); } catch { ledVerified = false; }
        heartbeat = now();
    }
    object Telemetry()
    {
        if (!enabled || transport == null) return Snapshot();
        using var transaction = transport.BeginTransaction();
        var fresh = ReadTopology(transport);
        if (CorsairDirectProtocol.Fingerprint(fresh) != CorsairDirectProtocol.Fingerprint(topology))
            throw new CorsairDirectException("CORSAIR_TOPOLOGY_CHANGED", "Die LINK-Gerätezuordnung hat sich verändert. Bitte zuerst die Steuerung freigeben.");
        RefreshValues(); return Snapshot();
    }
    void Ready() { if (!enabled || !modeMayBeOwned || transport == null || phase != "ready") throw new CorsairDirectException("CORSAIR_NOT_ACTIVE", "Bitte die direkte Corsair-Steuerung zuerst bewusst einschalten."); }
    object Manual(JsonElement request)
    {
        Ready(); if (!request.TryGetProperty("fanConfirmed", out var confirmation) || confirmation.ValueKind != JsonValueKind.True) throw new ArgumentException("Der Anschluss muss ausdrücklich als Lüfter bestätigt werden.");
        string id = request.GetProperty("id").GetString() ?? ""; int duty = request.GetProperty("duty").GetInt32();
        var channel = topology.SingleOrDefault(c => FanId(c) == id) ?? throw new ArgumentException("Der ausgewählte LINK-Lüfter wurde nicht erkannt.");
        var payload = CorsairDirectProtocol.Manual(channel, duty);
        using var transaction = transport!.BeginTransaction();
        var fresh = ReadTopology(transport);
        if (CorsairDirectProtocol.Fingerprint(fresh) != CorsairDirectProtocol.Fingerprint(topology)) throw new CorsairDirectException("CORSAIR_TOPOLOGY_CHANGED", "Die LINK-Gerätezuordnung hat sich verändert.");
        transport.Exchange([5, 1, 1], [0x18]); transport.Exchange([13, 1], [0x18]);
        try { transport.Exchange([6, 1], payload); }
        finally { transport.Exchange([5, 1, 1], [0x18]); }
        requested[channel.Index] = duty; heartbeat = now();
        return new { applied = true, id, duty, physicalVerification = false, acknowledgement = "device-ack", state = Snapshot() };
    }
    object SetColors(JsonElement request)
    {
        Ready(); string deviceId = request.GetProperty("deviceId").GetString() ?? "";
        if (deviceId != transport!.Identity.Id || !ledVerified || topology.Any(c => c.Known == null)) throw new ArgumentException("Die vollständige LINK-LED-Zuordnung wurde nicht bestätigt.");
        int count = topology.Sum(c => c.Known!.Leds);
        var colors = request.GetProperty("colors"); if (count < 1 || count > 1200 || colors.ValueKind != JsonValueKind.Array || colors.GetArrayLength() != count) throw new ArgumentException("Ungültige Anzahl von Corsair-LINK-LED-Farben.");
        var bytes = new byte[count * 3]; int index = 0;
        foreach (var color in colors.EnumerateArray())
        {
            string value = color.GetString() ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(value, "^#[0-9a-fA-F]{6}$")) throw new ArgumentException("Ungültige Corsair-RGB-Farbe.");
            bytes[index++] = Convert.ToByte(value.Substring(1, 2), 16); bytes[index++] = Convert.ToByte(value.Substring(3, 2), 16); bytes[index++] = Convert.ToByte(value.Substring(5, 2), 16);
        }
        using var transaction = transport.BeginTransaction();
        var fresh = ReadTopology(transport);
        if (CorsairDirectProtocol.Fingerprint(fresh) != CorsairDirectProtocol.Fingerprint(topology) || !CorsairDirectProtocol.LedTopologyMatches(ReadEndpoint(transport, 0x20), topology))
            throw new CorsairDirectException("CORSAIR_TOPOLOGY_CHANGED", "Die LINK-LED-Zuordnung hat sich verändert.");
        var payload = CorsairDirectProtocol.Payload(0x12, bytes);
        transport.Exchange([5, 1, 1], [0x22]); transport.Exchange([13, 0], [0x22]);
        try { for (int offset = 0; offset < payload.Length; offset += 508) transport.Exchange(offset == 0 ? [6, 0] : [7, 0], payload.AsSpan(offset, Math.Min(508, payload.Length - offset)).ToArray()); }
        finally { transport.Exchange([5, 1, 1], [0x22]); }
        heartbeat = now(); return new { applied = true, deviceId, ledCount = count, acknowledgement = "device-ack", physicalVerification = false, state = Snapshot() };
    }
    object Release()
    {
        watchdog?.Change(Timeout.Infinite, Timeout.Infinite);
        if (transport != null)
        {
            try
            {
                using (var transaction = transport.BeginTransaction())
                {
                    if (modeMayBeOwned)
                    {
                        transport.Exchange(CorsairDirectProtocol.HardwareCommand, []); delay(500);
                        var fresh = CorsairDirectProtocol.Firmware(transport.Exchange(CorsairDirectProtocol.FirmwareCommand, []));
                        if (fresh != firmware || !transport.SameIdentity()) throw new IOException("Der Corsair-Hub konnte die Rückgabe nicht mit seiner frischen Geräteidentität bestätigen.");
                        releaseVerification = "device-ack"; modeMayBeOwned = false;
                    }
                }
                transport.Dispose(); transport = null; enabled = false;
            }
            catch (Exception failure) { phase = "error"; error = failure.Message; return new { ok = false, released = false, retryRequired = true, state = Snapshot() }; }
        }
        if (vendorPending)
        {
            try { vendorLease = releaseVendor(); }
            catch (Exception failure) { error = failure.Message; phase = "error"; return new { ok = false, released = false, retryRequired = true, state = Snapshot() }; }
            if (!Successful(vendorLease)) { phase = "error"; error = "Die Corsair-Dienste wurden noch nicht vollständig zurückgegeben."; return new { ok = false, released = false, retryRequired = true, state = Snapshot() }; }
            vendorPending = false;
        }
        enabled = false; phase = "off"; error = ""; topology = []; rpms.Clear(); temperatures.Clear(); requested.Clear(); ledVerified = false;
        return new { ok = true, released = true, retryRequired = false, releaseVerification, physicalVerification = false, state = Snapshot() };
    }
    void CheckLease(object? state)
    {
        if (!gate.Wait(0)) return;
        try { if (enabled && now() - heartbeat > TimeSpan.FromSeconds(8)) Release(); }
        catch (Exception failure) { error = failure.Message; phase = "error"; }
        finally { gate.Release(); }
    }
    public void Dispose()
    {
        gate.Wait(); try { var result = Release(); if (!Successful(result)) throw new IOException("Die Corsair-Übernahme benötigt einen erneuten Freigabeversuch."); watchdog?.Dispose(); watchdog = null; }
        finally { gate.Release(); }
    }
}
