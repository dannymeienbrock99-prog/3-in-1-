using System.Text.Json;

namespace Prism.LianLi;

// The receiver query and master query do not bind devices or change fan/PWM
// settings. RGB uploads target one already-bound, freshly verified Strimer.
internal sealed class WirelessSession : IDisposable
{
    sealed record ReceiverPort(WinUsbDevice Device, string Path);
    sealed record MasterPort(WinUsbDevice Device, WirelessMaster Master);
    sealed record Cable(int Id, ReceiverPort Receiver, MasterPort Transmitter, WirelessReceiver Snapshot);
    readonly List<ReceiverPort> receivers = [];
    readonly List<MasterPort> transmitters = [];
    readonly Dictionary<int, Cable> cables = [];
    readonly Dictionary<string, int> ids = new(StringComparer.OrdinalIgnoreCase);

    async Task<WirelessDiscovery> ReadDiscovery(ReceiverPort receiver)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        int pages = 1;
        for (int query = 0; query < 2; query++)
        {
            // Discard queued metadata replies, never interpret old RGB state as a
            // new acknowledgement. Cancellation completes before its buffer dies.
            for (int drain = 0; drain < 16; drain++)
            {
                using var shortWait = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                shortWait.CancelAfter(15);
                try { await receiver.Device.ReadPacket(shortWait.Token); }
                catch (OperationCanceledException) { break; }
                catch (TimeoutException) { break; }
            }
            await receiver.Device.WritePacket(WirelessProtocol.DiscoveryQuery(pages), deadline.Token);
            var bytes = new List<byte>(pages * 512);
            for (int packet = 0; packet < pages * 8; packet++)
            {
                using var wait = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                wait.CancelAfter(700);
                var chunk = await receiver.Device.ReadPacket(wait.Token);
                bytes.AddRange(chunk);
                if (bytes.Count >= pages * 512) break;
                if (bytes.Count >= 4 && bytes[0] == 0x10 && bytes.Count >= 4 + Math.Min(bytes[1], pages * 10) * 42) break;
            }
            var result = WirelessProtocol.ParseDiscovery(bytes.ToArray(), pages);
            if (result.RequiredPages <= pages) return result;
            pages = result.RequiredPages;
        }
        throw new IOException("Die Wireless-Geräteliste hat sich während der Abfrage geändert. Bitte erneut suchen.");
    }

    static bool SameAddress(WirelessReceiver a, WirelessReceiver b) =>
        a.Mac.Equals(b.Mac, StringComparison.OrdinalIgnoreCase) && a.MasterMac.Equals(b.MasterMac, StringComparison.OrdinalIgnoreCase)
        && a.Channel == b.Channel && a.RxType == b.RxType && a.DeviceType == b.DeviceType && a.LedCount == b.LedCount;

    async Task<WirelessReceiver> Current(Cable cable)
    {
        var actual = (await ReadDiscovery(cable.Receiver)).Devices.Where(d => d.Mac.Equals(cable.Snapshot.Mac, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (actual.Length != 1 || !SameAddress(actual[0], cable.Snapshot))
            throw new IOException("Die Strimer-Wireless-Verbindung hat sich geändert. Bitte Geräte erneut suchen.");
        if (actual[0].MotherboardSync) throw new IOException("Strimer Wireless synchronisiert mit dem Mainboard. Diese Licht-Synchronisierung zuerst in L-Connect ausschalten; Lüftereinstellungen werden nicht verändert.");
        return actual[0];
    }

    public async Task<object> Scan()
    {
        DisposeHandles();
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        var warnings = new List<string>(); var discovery = new List<object>(); var diagnostics = new List<object>();
        var sightings = new Dictionary<ReceiverPort, WirelessReceiver[]>();
        var receiverFound = WinUsbDevice.Enumerate(false).Take(4).ToArray();
        var transmitterFound = WinUsbDevice.Enumerate(true).Take(4).ToArray();
        foreach (var found in receiverFound)
        {
            if (elapsed.Elapsed.TotalSeconds > 18) { warnings.Add("Die Wireless-Suche hat ihr Zeitlimit erreicht. Bitte erneut suchen."); break; }
            WinUsbDevice? usb = null;
            try
            {
                usb = new WinUsbDevice(found.Path, found.Vid, found.Pid, found.Product);
                var port = new ReceiverPort(usb, found.Path);
                var first = (await ReadDiscovery(port)).Devices;
                await Task.Delay(80);
                var second = (await ReadDiscovery(port)).Devices;
                var stable = second.Where(d => first.Count(old => SameAddress(old, d)) == 1).ToArray();
                receivers.Add(port); sightings[port] = stable; usb = null;
                discovery.Add(new { name = string.IsNullOrWhiteSpace(found.Product) ? "Lian Li L-Wireless · Empfänger" : found.Product, vendor = "Lian Li", provider = "lianli-wireless", vendorId = found.Vid, productId = found.Pid, status = "detected", reason = "Wireless-Empfänger erkannt. Kabel müssen bereits mit dem Sender gekoppelt sein." });
            }
            catch (Exception error) {
                warnings.Add($"Wireless-Empfänger: {error.Message}"); diagnostics.Add(WirelessErrors.Diagnostic(error, "receiver"));
                discovery.Add(new { name = found.Product, vendor = "Lian Li", provider = "lianli-wireless", vendorId = found.Vid, productId = found.Pid,
                    status = "unavailable", reason = error.Message, diagnostic = WirelessErrors.Diagnostic(error, "receiver") });
            }
            finally { usb?.Dispose(); }
        }
        foreach (var found in transmitterFound)
        {
            if (elapsed.Elapsed.TotalSeconds > 18) { warnings.Add("Die Wireless-Suche hat ihr Zeitlimit erreicht. Bitte erneut suchen."); break; }
            WinUsbDevice? usb = null;
            try
            {
                usb = new WinUsbDevice(found.Path, found.Vid, found.Pid, found.Product);
                // Probe observed channels only; do not perform a binding/channel
                // sweep across somebody else's wireless devices.
                var channels = sightings.Values.SelectMany(d => d).Select(d => d.Channel).Where(c => c is >= 1 and <= 39).Distinct().Take(10).ToArray();
                WirelessMaster? master = null; Exception? lastQueryError = null;
                foreach (var channel in channels.Length > 0 ? channels : [8])
                {
                    if (elapsed.Elapsed.TotalSeconds > 24) break;
                    try
                    {
                        for (int drain = 0; drain < 8; drain++)
                        {
                            using var shortWait = new CancellationTokenSource(15);
                            try { await usb.ReadPacket(shortWait.Token); }
                            catch (OperationCanceledException) { break; }
                            catch (TimeoutException) { break; }
                        }
                        await usb.WritePacket(WirelessProtocol.MasterQuery(channel));
                        using var wait = new CancellationTokenSource(700);
                        master = WirelessProtocol.ParseMaster(await usb.ReadPacket(wait.Token), channel);
                        break;
                    }
                    catch (Exception error) when (error is IOException or ArgumentException or OperationCanceledException or TimeoutException) { lastQueryError = error; }
                }
                if (master == null) throw lastQueryError is WirelessUsbException ? lastQueryError
                    : new IOException("Der Wireless-Sender meldet keine gültige Metadatenantwort. Bitte Geräte erneut suchen." + (lastQueryError == null ? "" : $" {lastQueryError.Message}"), lastQueryError);
                transmitters.Add(new MasterPort(usb, master)); usb = null;
                discovery.Add(new { name = string.IsNullOrWhiteSpace(found.Product) ? "Lian Li L-Wireless · Sender" : found.Product, vendor = "Lian Li", provider = "lianli-wireless", vendorId = found.Vid, productId = found.Pid, status = "detected", reason = "Sender geprüft. Die steuerbaren gekoppelten Kabel stehen in der Geräteliste." });
            }
            catch (Exception error) {
                warnings.Add($"Wireless-Sender: {error.Message}"); diagnostics.Add(WirelessErrors.Diagnostic(error, "transmitter"));
                discovery.Add(new { name = found.Product, vendor = "Lian Li", provider = "lianli-wireless", vendorId = found.Vid, productId = found.Pid,
                    status = "unavailable", reason = error.Message, diagnostic = WirelessErrors.Diagnostic(error, "transmitter") });
            }
            finally { usb?.Dispose(); }
        }
        var devices = new List<object>();
        foreach (var (port, observed) in sightings)
        {
            foreach (var receiver in observed.Where(d => d.DeviceType is >= 1 and <= 9))
            {
                var owners = transmitters.Where(t => t.Master.Mac.Equals(receiver.MasterMac, StringComparison.OrdinalIgnoreCase)).ToArray();
                if (owners.Length != 1 || receiver.LedCount <= 0 || receiver.MotherboardSync || receiver.RxType is < 1 or > 254)
                {
                    var reason = owners.Length != 1 ? "Kein eindeutig passender Sender: das Kabel zuerst in L-Connect koppeln."
                        : receiver.LedCount <= 0 ? "Dieses Strimer-Modell meldet eine noch nicht verifizierte LED-Anordnung."
                        : receiver.MotherboardSync ? "Mainboard-Licht-Synchronisierung ist aktiv. Diese zuerst in L-Connect ausschalten."
                        : "Die Funkadresse des Kabels ist noch nicht eindeutig bestätigt. Bitte erneut suchen.";
                    discovery.Add(new { name = receiver.ModelName, vendor = "Lian Li", provider = "lianli-wireless", status = "unavailable", reason });
                    continue;
                }
                if (cables.Values.Any(c => c.Snapshot.Mac.Equals(receiver.Mac, StringComparison.OrdinalIgnoreCase)))
                    throw new IOException("Doppelte Strimer-Wireless-Kennung. Keine eindeutige Steuerung möglich.");
                if (!ids.TryGetValue(receiver.Mac, out var id))
                {
                    if (ids.Count >= 256) throw new IOException("Zu viele Wireless-Kennungen in einer Sitzung.");
                    ids[receiver.Mac] = id = 60000 + ids.Count;
                }
                var cable = new Cable(id, port, owners[0], receiver); cables[id] = cable;
                devices.Add(new { id, name = receiver.ModelName, vendor = "Lian Li", provider = "lianli-wireless", category = "strip", type = 4,
                    vendorId = cable.Transmitter.Device.Vid, productId = cable.Transmitter.Device.Pid,
                    receiverVendorId = port.Device.Vid, receiverProductId = port.Device.Pid,
                    receiverType = receiver.DeviceType, ledCount = receiver.LedCount, mac = receiver.Mac,
                    masterMac = receiver.MasterMac, channel = receiver.Channel, rxType = receiver.RxType,
                    motherboardSync = false, effectUpload = true, directMode = true, firmware = cable.Transmitter.Master.Firmware,
                    acknowledgement = "Wireless-Effektübertragung", warning = "Eigene Effekte werden als Schleife im Kabel gespeichert. Lüfter, Kopplung und Mainboard-Sync werden nicht verändert." });
            }
        }
        return new { devices, discovery, warnings, environment = new { lianliWireless = new { status = cables.Count > 0 ? "ready" : transmitterFound.Length + receiverFound.Length > 0 ? "unavailable" : "not-found",
            deviceCount = cables.Count, controllerCount = transmitters.Count, diagnostics,
            message = cables.Count > 0 ? "Gekoppelte Strimer-Wireless-Kabel erkannt. Eigene Effekte werden erst nach Anwenden übertragen."
                : diagnostics.Count > 0 ? "Wireless-USB-Geräte erkannt; der direkte Zugriff ist blockiert. Die Gerätehinweise nennen den fehlgeschlagenen Schritt."
                : transmitterFound.Length + receiverFound.Length > 0 ? "Wireless-USB-Geräte erkannt. Kein eindeutig gekoppeltes, unterstütztes Strimer-Kabel verfügbar; Hinweise prüfen."
                : "Kein L-Wireless-Controller mit vorhandenem WinUSB-Treiber erkannt." } } };
    }

    public async Task<object> Upload(JsonElement request)
    {
        var id = request.GetProperty("deviceId").GetInt32();
        if (!cables.TryGetValue(id, out var cable)) throw new IOException("Strimer Wireless ist nicht mehr verbunden. Bitte erneut suchen.");
        var count = request.GetProperty("frameCount").GetInt32();
        var interval = request.GetProperty("intervalMs").GetInt32();
        var encoded = request.GetProperty("rgb").GetString();
        if (count is < 1 or > 64 || encoded == null || encoded.Length > 50000) throw new ArgumentException("Ungültige Wireless-Animation.");
        var raw = Convert.FromBase64String(encoded);
        if (raw.Length != count * cable.Snapshot.LedCount * 3) throw new ArgumentException("Die LED-Anzahl der Wireless-Animation stimmt nicht.");
        var frames = Enumerable.Range(0, count).Select(i => raw.AsSpan(i * cable.Snapshot.LedCount * 3, cable.Snapshot.LedCount * 3).ToArray()).ToArray();
        // Compression, timing, exact addressing and full packet bounds are
        // validated before the first lighting packet leaves this process.
        var current = await Current(cable);
        var upload = WirelessProtocol.BuildUpload(current, cable.Transmitter.Master, frames, interval);
        using var uploadDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(16));
        var outcome = await WirelessUploadRunner.Send(upload, current, cable.Transmitter.Master,
            cable.Transmitter.Device.WritePacket, () => Current(cable),
            (milliseconds, token) => Task.Delay(milliseconds, token), uploadDeadline.Token);
        return new { deviceId = id, transmitted = true, confirmed = outcome.Confirmed, attempts = outcome.Attempts,
            observedEffectIndex = outcome.ObservedEffectIndex, effectIndex = Convert.ToHexString(upload.EffectIndex).ToLowerInvariant(),
            frameCount = upload.FrameCount, intervalMs = upload.IntervalMs, acknowledgement = outcome.Confirmed ? "Funkempfänger bestätigt den Effekt" : "Übertragen; Funkbestätigung steht aus" };
    }

    void DisposeHandles()
    {
        foreach (var port in receivers) port.Device.Dispose();
        foreach (var port in transmitters) port.Device.Dispose();
        receivers.Clear(); transmitters.Clear(); cables.Clear();
    }
    public void Dispose() => DisposeHandles();
}

internal sealed record WirelessUploadOutcome(bool Confirmed, int Attempts, string? ObservedEffectIndex);
// A finite repeat of the same validated RGB loop, never a bind/PWM/sync command.
// Injection permits hardware-independent checks against missed RF headers.
internal static class WirelessUploadRunner
{
    internal static async Task<WirelessUploadOutcome> Send(WirelessUpload upload, WirelessReceiver target, WirelessMaster master,
        Func<byte[], CancellationToken, Task> write, Func<Task<WirelessReceiver>> read,
        Func<int, CancellationToken, Task> delay, CancellationToken token)
    {
        string? observed = null;
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            token.ThrowIfCancellationRequested();
            var fresh = await read();
            if (fresh.Mac != target.Mac || fresh.MasterMac != master.Mac || fresh.Channel != target.Channel
                || fresh.RxType != target.RxType || fresh.DeviceType != target.DeviceType || fresh.LedCount != target.LedCount || fresh.MotherboardSync)
                throw new IOException("Die Strimer-Verbindung hat sich vor der Übertragung geändert. Bitte erneut suchen.");
            for (int packet = 0; packet < upload.Packets.Length; packet++)
            {
                await write(upload.Packets[packet], token);
                // Four fragments form one RF frame. Repeated headers need the
                // manufacturer's 20 ms settling time between complete frames.
                await delay(packet < 15 && packet % 4 == 3 ? 20 : 1, token);
            }
            for (int poll = 0; poll < 4; poll++)
            {
                await delay(250, token);
                var reported = await read();
                observed = Convert.ToHexString(reported.EffectIndex).ToLowerInvariant();
                if (WirelessProtocol.Acknowledged(reported, target, master, upload.EffectIndex))
                    return new(true, attempt, observed);
            }
        }
        return new(false, 3, observed);
    }
}
