using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Prism.LianLi;
using Prism.WindowsLighting;

namespace Batto.Hardware;

/// <summary>Own hardware operations in Batto. No subprocess or IPC guard; L-Connect pause requires explicit confirmation.</summary>
public static unsafe class NativeExports
{
    internal const int MaximumRequestBytes = 8 * 1024 * 1024;
    internal const int MaximumResponseBytes = 2097152;
    static readonly UTF8Encoding Utf8 = new(false, true);
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    static readonly SemaphoreSlim WirelessGate = new(1, 1);
    static readonly SemaphoreSlim FanGate = new(1, 1);
    static readonly SemaphoreSlim WindowsGate = new(1, 1);
    static readonly SemaphoreSlim LianLiGate = new(1, 1);
    static readonly SemaphoreSlim InventoryGate = new(1, 1);
    static readonly SemaphoreSlim CorsairGate = new(1, 1);
    static readonly ConcurrentDictionary<nint, int> Outputs = new();
    static WirelessSession? wireless;
    static FanModule? fan;
    static WindowsModule? windows;
    static LianLiModule? lianli;
    static ServicesModule? serviceControl;
    static InventoryModule? inventory;
    static CorsairDirectModule? corsairDirect;
    static CorsairOwnership? corsairOwnership;
    static object? lastWirelessScan;

    /// <summary>cdecl ABI: int Invoke(const uint8_t*, int32_t, uint8_t**, int32_t*). Result 0 means a JSON envelope was returned.</summary>
    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvCdecl)])]
    public static int Invoke(byte* input, int length, nint* output, int* outputLength)
    {
        if (output == null || outputLength == null) return -1;
        *output = 0; *outputLength = 0;
        if (input == null || length <= 0 || length > MaximumRequestBytes) return -1;
        try
        {
            byte[] response = Execute(new ReadOnlySpan<byte>(input, length));
            if (response.Length > MaximumResponseBytes || Outputs.Count >= 32) return -2;
            byte* memory = (byte*)NativeMemory.Alloc((nuint)response.Length);
            if (memory == null) return -3;
            response.CopyTo(new Span<byte>(memory, response.Length));
            if (!Outputs.TryAdd((nint)memory, response.Length)) { NativeMemory.Free(memory); return -3; }
            *output = (nint)memory; *outputLength = response.Length; return 0;
        }
        catch { return -3; } // No managed exception crosses a native call boundary.
    }

    /// <summary>Release only buffers issued by Invoke; repeated/unknown pointers are ignored.</summary>
    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvCdecl)])]
    public static void Free(nint output)
    {
        if (output != 0 && Outputs.TryRemove(output, out _)) NativeMemory.Free((void*)output);
    }

    internal static byte[] Execute(ReadOnlySpan<byte> input)
    {
        int requestId = -1;
        try
        {
            if (input.Length == 0 || input.Length > MaximumRequestBytes) throw new ArgumentException("Ungültige Größe der Batto-Hardwareanfrage.");
            // Strict UTF-8 and bounded JSON reject malformed/truncated native calls before any hardware command.
            using var document = JsonDocument.Parse(Utf8.GetString(input), new JsonDocumentOptions { MaxDepth = 16 });
            var request = document.RootElement;
            if (request.ValueKind != JsonValueKind.Object || !request.TryGetProperty("requestId", out var identity)
                || !identity.TryGetInt32(out requestId) || requestId < 0)
                throw new ArgumentException("Ungültige Anfragekennung.");
            string provider = request.TryGetProperty("provider", out var providerValue) ? RequiredText(providerValue, 20) : "wireless";
            string command = request.TryGetProperty("command", out var commandValue) ? RequiredText(commandValue, 30) : throw new ArgumentException("Hardwarebefehl fehlt.");
            ValidateProperties(request, provider, command);
            var gate = provider == "fan" ? FanGate : provider == "windows" ? WindowsGate : provider == "lianli" ? LianLiGate : provider == "inventory" ? InventoryGate : provider == "corsair-direct" ? CorsairGate : WirelessGate;
            if (!gate.Wait(TimeSpan.FromSeconds(5))) return Serialize(new { requestId, ok = false, error = new { code = "HARDWARE_BUSY", message = "Batto verarbeitet noch eine Hardwareanfrage. Bitte kurz warten." } });
            try
            {
                if (command == "capabilities") return Serialize(new { requestId, ok = true, result = Capabilities() });
                if (command == "self-test" && provider == "wireless") return Serialize(new { requestId, ok = true, result = SelfCheck() });
                if (command == "self-test" && provider == "lianli") return Serialize(new { requestId, ok = true, result = LianLiSelfCheck() });
                if (command == "self-test" && provider == "inventory") return Serialize(new { requestId, ok = true, result = InventoryModule.Fixtures() });
                if (command == "self-test" && provider == "corsair-direct") return Serialize(new { requestId, ok = true, result = CorsairSelfCheck() });
                if (provider == "corsair-direct") return DispatchCorsair(requestId, request);
                if (provider == "fan")
                {
                    fan ??= new FanModule();
                    // FanModule returns the existing verified Reply envelope, without an extra wrapper.
                    object reply = fan.Dispatch(request);
                    return command == "self-test" ? Serialize(new { requestId, ok = true, result = reply }) : Serialize(reply);
                }
                if (provider == "windows")
                {
                    windows ??= new WindowsModule();
                    if (command == "resume-corsair")
                    {
                        // Serialize resume with native takeover/release: a cached OFF snapshot alone can race a new ON.
                        if (!CorsairGate.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException("Die Corsair-Steuerung wird noch umgestellt.");
                        try
                        {
                            if (corsairDirect != null)
                            {
                                var state = JsonSerializer.SerializeToElement(CachedCorsairStatus(), Json);
                                if (!state.GetProperty("released").GetBoolean())
                                    throw new CorsairDirectException("CORSAIR_RELEASE_REQUIRED", "Die direkte Corsair-Steuerung muss zuerst vollständig freigegeben werden.");
                            }
                            return Serialize(new { requestId, ok = true, result = windows.Dispatch(request) });
                        }
                        finally { CorsairGate.Release(); }
                    }
                    return Serialize(new { requestId, ok = true, result = windows.Dispatch(request) });
                }
                if (provider == "lianli")
                {
                    lianli ??= new LianLiModule();
                    return Serialize(new { requestId, ok = true, result = lianli.Dispatch(request) });
                }
                if (provider == "inventory")
                {
                    inventory ??= new InventoryModule();
                    return Serialize(new { requestId, ok = true, result = inventory.Dispatch(request) });
                }
                if (command is "take-control" or "release-control" or "control-status" or "close" or "shutdown")
                {
                    object state = command switch
                    {
                        "take-control" => TakeWirelessControl(request),
                        "control-status" => CachedWirelessControl(),
                        _ => ReleaseWirelessControl()
                    };
                    var resultState = JsonSerializer.SerializeToElement(state, Json);
                    bool ok = !resultState.TryGetProperty("ok", out var succeeded) || succeeded.GetBoolean();
                    return ok ? Serialize(new { requestId, ok = true, result = state })
                        : Serialize(new { requestId, ok = false, result = state, error = new { code = "WIRELESS_CONTROL_FAILED", message = ServiceFailureMessage(resultState) } });
                }
                object result = command switch
                {
                    "status" => new { inProcess = true, opened = wireless != null, scan = lastWirelessScan },
                    "enumerate" => ScanWireless(),
                    "animation" => UploadWireless(request),
                    _ => throw new ArgumentException("Unbekannter Batto-Hardwarebefehl.")
                };
                return Serialize(new { requestId, ok = true, result });
            }
            finally { gate.Release(); }
        }
        catch (Exception error)
        {
            string code = error switch
            {
                WirelessUsbException usb => usb.Code,
                LightingException lighting => lighting.Code,
                CorsairDirectException corsair => corsair.Code,
                WirelessAnimationTooLargeException => "WIRELESS_ANIMATION_TOO_LARGE",
                DecoderFallbackException or JsonException or ArgumentException or InvalidOperationException => "HARDWARE_INVALID_REQUEST",
                OperationCanceledException or TimeoutException => "HARDWARE_TIMEOUT",
                _ => "HARDWARE_ERROR"
            };
            return Serialize(new { requestId, ok = false, error = new { code, message = error.Message } });
        }
    }

    static object EmptyCorsairLease() => new { ok = true, active = false, released = true, retryRequired = false, confirmationRequired = false,
        paused = Array.Empty<string>(), remaining = Array.Empty<string>(), services = Array.Empty<object>(), errors = Array.Empty<object>(), inProcess = true };
    static object CachedCorsairStatus()
    {
        using var cached = JsonDocument.Parse("{\"command\":\"status\"}");
        return corsairDirect!.Dispatch(cached.RootElement);
    }
    static byte[] DispatchCorsair(int requestId, JsonElement request)
    {
        // Keep service construction lazy: status, idle OFF and pure checks never access SCM.
        corsairDirect ??= new CorsairDirectModule(
            confirmed => (corsairOwnership ??= new CorsairOwnership()).Take(confirmed),
            () => (object?)corsairOwnership?.Release() ?? EmptyCorsairLease(),
            () => (object?)corsairOwnership?.Status() ?? EmptyCorsairLease());
        try
        {
            object reply = corsairDirect.Dispatch(request);
            var value = JsonSerializer.SerializeToElement(reply, Json);
            if (value.TryGetProperty("ok", out var succeeded) && succeeded.ValueKind == JsonValueKind.False)
            {
                var state = value.TryGetProperty("state", out var snapshot) ? snapshot.Clone() : value;
                string message = state.TryGetProperty("error", out var detail) && detail.ValueKind == JsonValueKind.String
                    ? detail.GetString() ?? "" : "";
                return Serialize(new { requestId, ok = false, result = state,
                    error = new { code = "CORSAIR_RELEASE_REQUIRED", message = message.Length > 0 ? message : "Die Corsair-Steuerung benötigt einen erneuten Freigabeversuch." } });
            }
            return Serialize(new { requestId, ok = true, result = reply });
        }
        catch (Exception failure)
        {
            string code = failure switch
            {
                CorsairDirectException corsair => corsair.Code,
                ArgumentException or InvalidOperationException or JsonException => "HARDWARE_INVALID_REQUEST",
                TimeoutException or OperationCanceledException => "HARDWARE_TIMEOUT",
                _ => "CORSAIR_HARDWARE_ERROR"
            };
            // The snapshot carries any remaining hardware/service ownership through errors for OFF retry.
            return Serialize(new { requestId, ok = false, result = CachedCorsairStatus(), error = new { code, message = failure.Message } });
        }
    }
    static object CorsairSelfCheck()
    {
        byte[] firmwareCapture = [0, 0, 0, 2, 0, 2, 9, 0xe8, 1];
        var version = CorsairDirectProtocol.Firmware(CorsairDirectProtocol.Reply(firmwareCapture, CorsairDirectProtocol.FirmwareCommand));
        var lease = JsonSerializer.SerializeToElement(CorsairOwnership.Fixtures(), Json);
        bool passed = version == new Version(2, 9, 488)
            && CorsairDirectProtocol.Packet(CorsairDirectProtocol.HardwareCommand, []).Length == 513
            && lease.GetProperty("ok").GetBoolean() && lease.GetProperty("passed").GetInt32() >= 40;
        if (!passed) throw new InvalidOperationException("Die interne direkte Corsair-Prüfung ist fehlgeschlagen.");
        return new { passed = true, hardwarePackets = 0, fanWrites = 0, realServiceControls = 0, childProcesses = 0,
            capturedFirmwareReply = true, serviceLeaseChecks = lease.GetProperty("passed").GetInt32(),
            corsairModuleCreated = corsairDirect != null, serviceControlCreated = corsairOwnership != null };
    }

    static object ScanWireless()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Die direkte Hardwaresteuerung benötigt Windows.");
        wireless ??= new WirelessSession();
        return lastWirelessScan = wireless.Scan().GetAwaiter().GetResult();
    }
    static object UploadWireless(JsonElement request)
    {
        if (wireless == null) throw new InvalidOperationException("Strimer Wireless zuerst in Batto suchen.");
        return wireless.Upload(request).GetAwaiter().GetResult();
    }
    static void CloseWirelessSession()
    {
        wireless?.Dispose(); wireless = null; lastWirelessScan = null;
    }
    static object CachedWirelessControl() => (object?)serviceControl?.Status() ?? new { ok = true, active = false, released = true, retryRequired = false, confirmationRequired = false,
        paused = Array.Empty<string>(), remaining = Array.Empty<string>(), services = Array.Empty<object>(), errors = Array.Empty<object>(), inProcess = true };
    static object TakeWirelessControl(JsonElement request)
    {
        if (!request.TryGetProperty("confirmLConnectPause", out var confirmation) || confirmation.ValueKind != JsonValueKind.True)
            throw new ArgumentException("Die L-Connect-Pause muss zuerst ausdrücklich bestätigt werden.");
        CloseWirelessSession();
        serviceControl ??= new ServicesModule();
        return serviceControl.TakeControl(true);
    }
    static object ReleaseWirelessControl()
    {
        CloseWirelessSession();
        if (serviceControl is null) return new { ok = true, closed = true, restored = true, released = true, active = false, retryRequired = false, confirmationRequired = false,
            paused = Array.Empty<string>(), remaining = Array.Empty<string>(), services = Array.Empty<object>(), errors = Array.Empty<object>(), inProcess = true };
        return serviceControl.ReleaseControl();
    }
    static string ServiceFailureMessage(JsonElement state)
    {
        const string prefix = "Die L-Connect-Steuerung konnte nicht vollständig umgestellt werden.";
        if (!state.TryGetProperty("errors", out var errors) || errors.ValueKind != JsonValueKind.Array) return prefix;
        var messages = errors.EnumerateArray().Take(3)
            .Where(error => error.ValueKind == JsonValueKind.Object && error.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String)
            .Select(error => error.GetProperty("message").GetString())
            .Where(message => !string.IsNullOrWhiteSpace(message)).Select(message => message!.Length > 1000 ? message[..1000] : message);
        string detail = string.Join(" ", messages);
        return detail.Length == 0 ? prefix : prefix + " " + detail;
    }
    static string RequiredText(JsonElement value, int limit)
    {
        if (value.ValueKind != JsonValueKind.String || value.GetString() is not string text || text.Length is < 1 || text.Length > limit)
            throw new ArgumentException("Ungültiger Hardwarebefehl.");
        return text;
    }
    static void ValidateProperties(JsonElement request, string provider, string command)
    {
        if (provider is not "wireless" and not "fan" and not "windows" and not "lianli" and not "inventory" and not "corsair-direct") throw new ArgumentException("Unbekannter Hardwarebereich.");
        string[] common = ["requestId", "provider", "command"];
        string[] specific = provider == "fan" && command == "manual" ? ["id", "duty", "fanConfirmed"]
            : provider == "fan" && command == "curve" ? ["id", "sensorId", "points", "fanConfirmed", "failsafeDuty"]
            : provider == "wireless" && command == "animation" ? ["deviceId", "frameCount", "intervalMs", "rgb"]
            : provider == "wireless" && command == "take-control" ? ["confirmLConnectPause"]
            : provider == "windows" && command == "set" ? ["deviceId", "colors"]
            : provider == "windows" && command == "effect" ? ["deviceId", "modeId", "brightness", "speed", "colors", "direction"]
            : provider == "corsair-direct" && (command is "take-control" or "enable") ? ["confirmICuePause", "hubId"]
            : provider == "corsair-direct" && command == "manual" ? ["id", "duty", "fanConfirmed"]
            : provider == "corsair-direct" && (command is "set" or "set-colors") ? ["deviceId", "colors"]
            : provider == "lianli" && command == "effect" ? ["deviceId", "effectId", "brightness", "speed", "colors", "direction", "controllerScope", "confirmWholeController"] : [];
        var allowed = common.Concat(specific).ToHashSet(StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in request.EnumerateObject())
            if (!seen.Add(property.Name) || !allowed.Contains(property.Name)) throw new ArgumentException("Die Hardwareanfrage enthält ungültige oder doppelte Felder.");
        bool known = command == "capabilities" || (command == "self-test" && (provider is "wireless" or "fan" or "lianli" or "inventory" or "corsair-direct")) || (provider == "wireless"
            ? command is "status" or "enumerate" or "animation" or "take-control" or "release-control" or "control-status" or "close" or "shutdown"
            : provider == "windows" ? command is "status" or "enumerate" or "set" or "effect" or "release" or "close" or "show" or "suspend-corsair" or "resume-corsair"
            : provider == "corsair-direct" ? command is "status" or "control-status" or "enumerate" or "enable" or "take-control" or "heartbeat" or "telemetry" or "manual" or "set" or "set-colors" or "release" or "release-control" or "close" or "shutdown"
            : provider == "lianli" ? command is "status" or "enumerate" or "effect" or "telemetry" or "close"
            : provider == "inventory" ? command is "status" or "platform" or "kingston" or "close"
            : command is "status" or "scan" or "enable" or "heartbeat" or "manual" or "curve" or "disable" or "shutdown");
        if (!known) throw new ArgumentException("Unbekannter Batto-Hardwarebefehl.");
        if (provider == "fan" && command == "curve" && request.TryGetProperty("failsafeDuty", out var failsafe)
            && (!failsafe.TryGetInt32(out int duty) || duty != 100)) throw new ArgumentException("Die Lüfter-Notfallleistung muss 100 Prozent betragen.");
    }
    static object Capabilities() => new { abi = 1, inProcess = true, childProcesses = false, vendorServiceControlAvailable = true,
        automaticVendorPause = false, providers = new[] { "wireless", "fan", "windows", "lianli", "inventory", "corsair-direct" }, maximumRequestBytes = MaximumRequestBytes, maximumResponseBytes = MaximumResponseBytes };
    static object LianLiSelfCheck()
    {
        var fixtures = JsonSerializer.SerializeToElement(LianLiModule.Fixtures(), Json);
        var strimer = JsonSerializer.SerializeToElement(StrimerProtocol.Fixtures(), Json);
        bool passed = fixtures.GetProperty("cases").GetArrayLength() == 5
            && fixtures.GetProperty("invalidCount").GetInt32() == 4
            && fixtures.GetProperty("firmwareValid").GetBoolean()
            && fixtures.GetProperty("firmwareMismatchRejected").GetBoolean()
            && fixtures.GetProperty("handshake").GetArrayLength() > 0;
        passed = passed && strimer.GetProperty("cases").GetArrayLength() == 3
            && strimer.GetProperty("rejected").GetArrayLength() == 6
            && new[] { "descriptorAccepted", "wrongInterfaceRejected", "wrongUsageRejected", "wrongReportRejected", "wrongFeatureRejected", "wrongInputRejected", "firmwareValid", "firmwareMismatchRejected", "count4Accepted", "count6Accepted", "unknownCountRejected" }
                .All(name => strimer.GetProperty(name).GetBoolean());
        if (!passed) throw new InvalidOperationException("Die interne Lian-Li-Protokollprüfung ist fehlgeschlagen.");
        return new { passed = true, hardwarePackets = 0, realServiceControls = 0, fanWrites = 0, childProcesses = 0, lianliProtocol = true, strimerPlusV2Protocol = true, lianliCreated = lianli != null };
    }
    static object SelfCheck()
    {
        // Pure framing checks only; no WinUSB enumeration, service access or fan backend opens.
        var fixtures = JsonSerializer.SerializeToElement(WirelessProtocol.Fixtures(), Json);
        var acknowledgements = fixtures.GetProperty("acknowledgements");
        bool passed = acknowledgements.GetProperty("confirmed").GetBoolean()
            && !acknowledgements.GetProperty("wrongIdentity").GetBoolean()
            && !acknowledgements.GetProperty("wrongChannel").GetBoolean()
            && !acknowledgements.GetProperty("wrongRadioAddress").GetBoolean()
            && fixtures.GetProperty("invalid").GetArrayLength() == 9;
        var leaseCheck = JsonSerializer.SerializeToElement(ServicesModule.Fixtures(), Json);
        passed = passed && leaseCheck.GetProperty("ok").GetBoolean()
            && leaseCheck.GetProperty("passed").GetInt32() >= 28
            && leaseCheck.GetProperty("realServiceControls").GetInt32() == 0;
        if (!passed) throw new InvalidOperationException("Die interne Wireless-Protokollprüfung ist fehlgeschlagen.");
        return new { passed = true, hardwarePackets = 0, realServiceControls = 0, fanWrites = 0, childProcesses = 0,
            wirelessProtocol = true, serviceLeaseChecks = leaseCheck.GetProperty("passed").GetInt32(), wirelessOpened = wireless != null, fanCreated = fan != null, serviceControlCreated = serviceControl != null };
    }
    static byte[] Serialize(object value) => JsonSerializer.SerializeToUtf8Bytes(value, Json);
}
