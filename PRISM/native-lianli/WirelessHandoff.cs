using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Prism.LianLi;

// This deliberately separate privileged mode only leases two fixed, verified
// L-Connect services. It never creates USB handles or accepts lighting, process,
// registry-write, driver or fan/PWM commands.
internal static class WirelessHandoff
{
    internal const string ServiceName = "LConnectService", WatcherName = "LConnectServiceWatcher";
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static bool ValidPipeName(string value) => System.Text.RegularExpressions.Regex.IsMatch(value, @"\Abatto-strimer-[a-f0-9]{32,64}\z", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    internal static bool ValidToken(string value) => value.Length == 64 && value.All(Uri.IsHexDigit);
    internal static bool TokenMatches(string expected, string? supplied) => supplied != null && ValidToken(supplied)
        && CryptographicOperations.FixedTimeEquals(Convert.FromHexString(expected), Convert.FromHexString(supplied));
    internal static bool OwnerMatches(int pid, long ticks)
    {
        try { using var owner = Process.GetProcessById(pid); return !owner.HasExited && owner.StartTime.ToUniversalTime().Ticks == ticks; }
        catch { return false; }
    }
    internal static string ImageName(string name) => name switch {
        ServiceName => "L-Connect-Service.exe", WatcherName => "L-Connect-Service-Watcher.exe", _ => throw new ArgumentException("Unbekannter Dienst.")
    };
    internal static bool ValidInstalledImage(string name, string image, string account, string programFiles)
    {
        if (name is not ServiceName and not WatcherName || !Path.IsPathFullyQualified(programFiles) || !account.Equals("LocalSystem", StringComparison.OrdinalIgnoreCase)
            || image.Length < 3 || image[0] != '"' || image[^1] != '"' || image[1..^1].Contains('"')) return false;
        try { return Path.GetFullPath(image[1..^1]).Equals(Path.GetFullPath(Path.Combine(programFiles, "Lian-Li", "L-Connect 3", ImageName(name))), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    internal static async Task Run(string[] args, bool probe = false, bool legacyPipe = false)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Der Wireless-Modus benötigt Windows.");
        string mode = probe ? legacyPipe ? "--wireless-handoff-probe-currentuser" : "--wireless-handoff-probe" : "--wireless-handoff";
        if (args.Length != 5 || args[0] != mode || !ValidPipeName(args[1]) || !ValidToken(args[2])
            || !int.TryParse(args[3], out int ownerPid) || ownerPid <= 0 || ownerPid == Environment.ProcessId
            || !long.TryParse(args[4], out long ownerTicks) || ownerTicks <= 0 || !OwnerMatches(ownerPid, ownerTicks))
            throw new ArgumentException("Ungültiger oder beendeter Wireless-Auftrag.");
        using var identity = WindowsIdentity.GetCurrent();
        if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) throw new UnauthorizedAccessException("Die bestätigte Windows-Freigabe für den Wireless-Modus fehlt.");
        string token = args[2];
        using var pipe = legacyPipe
            ? new NamedPipeServerStream(args[1], PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, 4096, 4096)
            : WirelessGuardPipe.Create(args[1], ownerPid);
        using var watchCancellation = new CancellationTokenSource();
        long lastHeartbeat = Environment.TickCount64; bool connected = false, ready = false; string reason = "error";
        var monitor = Task.Run(async () => {
            try {
                while (!watchCancellation.IsCancellationRequested) {
                    if (!OwnerMatches(ownerPid, ownerTicks)) { reason = "owner-exit"; watchCancellation.Cancel(); break; }
                    if (Volatile.Read(ref connected) && Environment.TickCount64 - Interlocked.Read(ref lastHeartbeat) > (Volatile.Read(ref ready) ? 15000 : 25000)) {
                        reason = Volatile.Read(ref ready) ? "heartbeat-timeout" : "startup-timeout"; watchCancellation.Cancel(); break;
                    }
                    await Task.Delay(500, watchCancellation.Token);
                }
            } catch (OperationCanceledException) { }
        });
        HandoffLease? lease = null; bool returned = false; Task? inputTask = null;
        using var outputLock = new SemaphoreSlim(1, 1);
        var stops = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true, SingleWriter = true });
        async Task Emit(object value)
        {
            if (!pipe.IsConnected) return;
            using var timeout = new CancellationTokenSource(3000);
            await outputLock.WaitAsync(timeout.Token);
            try { byte[] bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, Json) + "\n"); await pipe.WriteAsync(bytes, timeout.Token); await pipe.FlushAsync(timeout.Token); }
            finally { outputLock.Release(); }
        }
        try
        {
            using var connectDeadline = CancellationTokenSource.CreateLinkedTokenSource(watchCancellation.Token); connectDeadline.CancelAfter(30000);
            await pipe.WaitForConnectionAsync(connectDeadline.Token);
            if (!legacyPipe) WirelessGuardPipe.AssertClient(pipe, ownerPid, ownerTicks);
            var hello = await ReadMessage(pipe, connectDeadline.Token);
            if (hello.Op != "hello" || !TokenMatches(token, hello.Token) || !OwnerMatches(ownerPid, ownerTicks)) throw new UnauthorizedAccessException("Wireless-Auftrag konnte nicht bestätigt werden.");
            Volatile.Write(ref connected, true); Interlocked.Exchange(ref lastHeartbeat, Environment.TickCount64);
            // Read heartbeats independently of service transitions and restoration
            // waits. An alive parent must not expire merely because SCM is slow.
            inputTask = Task.Run(async () => {
                try {
                    while (!watchCancellation.IsCancellationRequested) {
                        var message = await ReadMessage(pipe, watchCancellation.Token);
                        if (!TokenMatches(token, message.Token)) throw new UnauthorizedAccessException("Ungültige Wireless-Sitzung.");
                        if (message.Op == "stop") { stops.Writer.TryWrite(true); continue; }
                        if (message.Op != "heartbeat") throw new ArgumentException("Unbekannter Wireless-Sitzungsbefehl.");
                        Interlocked.Exchange(ref lastHeartbeat, Environment.TickCount64); await Emit(new { @event = "heartbeat" });
                    }
                }
                catch (OperationCanceledException) { }
                catch (EndOfStreamException) { reason = "pipe-disconnected"; watchCancellation.Cancel(); }
                catch (IOException) { reason = "pipe-disconnected"; watchCancellation.Cancel(); }
                catch (Exception error) { reason = "error"; try { await Emit(new { @event = "error", code = "WIRELESS_HANDOFF_FAILED", message = error.Message }); } catch { } watchCancellation.Cancel(); }
            });
            if (probe)
            {
                // Genuine elevation/IPC test; never constructs a service or USB
                // object, and shares the production ACL/client authentication.
                Volatile.Write(ref ready, true);
                await Emit(new { @event = "ready", ownerPid, probe = true, services = Array.Empty<object>() });
                await stops.Reader.ReadAsync(watchCancellation.Token);
                await Emit(new { @event = "restored", ok = true, probe = true, services = Array.Empty<object>(), reason = "stop" });
                returned = true;
                return;
            }
            IHandoffService? watcher = new WindowsHandoffService(WatcherName);
            try { lease = new HandoffLease([watcher, new WindowsHandoffService(ServiceName)]); watcher = null; }
            finally { watcher?.Dispose(); }
            await lease.Pause(watchCancellation.Token);
            Interlocked.Exchange(ref lastHeartbeat, Environment.TickCount64); Volatile.Write(ref ready, true);
            await Emit(new { @event = "ready", ownerPid, services = lease.Snapshot() });
            while (!watchCancellation.IsCancellationRequested)
            {
                await stops.Reader.ReadAsync(watchCancellation.Token); reason = "stop";
                var restored = await lease.Restore(); bool ok = restored.All(result => result.Restored);
                await Emit(new { @event = "restored", ok, services = restored, reason });
                if (ok) { returned = true; break; }
                // Failed restoration keeps the authenticated guard alive. The UI
                // can show the failure and request stop again; no fake OFF state.
            }
        }
        catch (EndOfStreamException) { reason = "pipe-disconnected"; }
        catch (IOException) when (!pipe.IsConnected) { reason = "pipe-disconnected"; }
        catch (OperationCanceledException) { if (reason == "error") reason = connected ? "timeout" : "connection-timeout"; }
        catch (Exception error)
        {
            try { await Emit(new { @event = "error", code = "WIRELESS_HANDOFF_FAILED", message = error.Message }); } catch { }
        }
        finally
        {
            watchCancellation.Cancel(); await monitor;
            if (inputTask != null) await inputTask;
            // Restoration uses its own deadline: cancelled owner/heartbeat input
            // must never skip returning the initially running vendor services.
            if (lease != null && !returned)
            {
                var restored = await lease.Restore();
                try { await Emit(new { @event = "restored", ok = restored.All(result => result.Restored), services = restored, reason }); } catch { }
            }
            lease?.Dispose();
        }
    }

    static async Task<(string Op, string? Token)> ReadMessage(Stream input, CancellationToken cancellation)
    {
        var bytes = new List<byte>(128); var one = new byte[1];
        while (bytes.Count < 512)
        {
            int count = await input.ReadAsync(one, cancellation);
            if (count == 0) throw new EndOfStreamException();
            if (one[0] == 10)
            {
                using var json = JsonDocument.Parse(bytes.ToArray(), new JsonDocumentOptions { MaxDepth = 3 });
                var root = json.RootElement;
                if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Count() != 2 || !root.TryGetProperty("op", out var op)
                    || !root.TryGetProperty("token", out var token) || op.ValueKind != JsonValueKind.String || token.ValueKind != JsonValueKind.String)
                    throw new ArgumentException("Ungültiger Wireless-Sitzungsbefehl.");
                return (op.GetString() ?? "", token.GetString());
            }
            bytes.Add(one[0]);
        }
        throw new ArgumentException("Wireless-Sitzungsbefehl ist zu groß.");
    }

    internal static async Task<object> Fixtures()
    {
        var checks = new List<string>();
        void Check(string name, bool passed) { if (!passed) throw new Exception("Handoff fixture failed: " + name); checks.Add(name); }
        Check("pipeAllowlist", ValidPipeName("batto-strimer-" + new string('a', 32)) && !ValidPipeName(@"other\pipe") && !ValidPipeName("batto-strimer-" + new string('a', 32) + "\n"));
        Check("tokenExact", TokenMatches(new string('a', 64), new string('A', 64)) && !TokenMatches(new string('a', 64), new string('b', 64)) && !TokenMatches(new string('a', 64), "short"));
        var hello = await ReadMessage(new MemoryStream(Encoding.UTF8.GetBytes("{\"op\":\"hello\",\"token\":\"" + new string('a', 64) + "\"}\n")), CancellationToken.None);
        Check("boundedPipeMessage", hello.Op == "hello" && TokenMatches(new string('a', 64), hello.Token));
        bool oversized = false; try { await ReadMessage(new MemoryStream(new byte[513]), CancellationToken.None); } catch (ArgumentException) { oversized = true; }
        Check("oversizedPipeRejected", oversized);
        Check("workerIdleExpiry", !WirelessWorkerLease.Expired(10, false, true) && WirelessWorkerLease.Expired(10.1, false, true));
        Check("workerActiveExpiry", !WirelessWorkerLease.Expired(0, true, true, 35) && WirelessWorkerLease.Expired(0, true, true, 35.1) && WirelessWorkerLease.Expired(10.1, true, true, 1));
        Check("workerOwnerExit", WirelessWorkerLease.Expired(0, true, false));
        var programFiles = Path.Combine(Path.GetPathRoot(Environment.CurrentDirectory)!, "Program Files");
        string Image(string name) => '"' + Path.Combine(programFiles, "Lian-Li", "L-Connect 3", ImageName(name)) + '"';
        Check("fixedServiceImage", ValidInstalledImage(ServiceName, Image(ServiceName), "LocalSystem", programFiles));
        Check("otherServiceRejected", !ValidInstalledImage("iCUE", Image(ServiceName), "LocalSystem", programFiles));
        Check("otherAccountRejected", !ValidInstalledImage(ServiceName, Image(ServiceName), "LocalService", programFiles));
        Check("argumentsRejected", !ValidInstalledImage(ServiceName, Image(ServiceName) + " --other", "LocalSystem", programFiles));
        Check("otherImageRejected", !ValidInstalledImage(ServiceName, Image(WatcherName), "LocalSystem", programFiles));
        Check("unquotedRejected", !ValidInstalledImage(ServiceName, Image(ServiceName).Trim('"'), "LocalSystem", programFiles));
        var actions = new List<string>();
        var watcher = new FakeService(WatcherName, true, actions); var service = new FakeService(ServiceName, true, actions);
        using (var lease = new HandoffLease([watcher, service])) { await lease.Pause(CancellationToken.None); Check("pauseOrder", actions.SequenceEqual(["stop:" + WatcherName, "stop:" + ServiceName])); await lease.Restore(); }
        Check("restoreOrder", actions.Skip(2).SequenceEqual(["start:" + ServiceName, "start:" + WatcherName]));
        actions.Clear(); watcher = new FakeService(WatcherName, false, actions); service = new FakeService(ServiceName, true, actions);
        using (var lease = new HandoffLease([watcher, service])) { await lease.Pause(CancellationToken.None); await lease.Restore(); }
        Check("initiallyStoppedPreserved", actions.SequenceEqual(["stop:" + ServiceName, "start:" + ServiceName]) && watcher.State == 1);
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions) { FailStopAfterChange = true }; service = new FakeService(ServiceName, true, actions);
        using (var lease = new HandoffLease([watcher, service])) { try { await lease.Pause(CancellationToken.None); } catch (IOException) { } await lease.Restore(); }
        Check("watcherFailureRestores", actions.SequenceEqual(["stop:" + WatcherName, "start:" + WatcherName]) && watcher.State == 4 && service.State == 4);
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); service = new FakeService(ServiceName, true, actions) { FailStopAfterChange = true };
        using (var lease = new HandoffLease([watcher, service])) { try { await lease.Pause(CancellationToken.None); } catch (IOException) { } await lease.Restore(); }
        Check("serviceFailureRestoresBoth", actions.SequenceEqual(["stop:" + WatcherName, "stop:" + ServiceName, "start:" + ServiceName, "start:" + WatcherName]));
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); service = new FakeService(ServiceName, true, actions) { FailValidation = true };
        using (var lease = new HandoffLease([watcher, service])) { try { await lease.Pause(CancellationToken.None); } catch (IOException) { } await lease.Restore(); }
        Check("validateAllBeforeMutation", actions.Count == 0);
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); service = new FakeService(ServiceName, true, actions) { FailStart = true };
        using (var lease = new HandoffLease([watcher, service])) { await lease.Pause(CancellationToken.None); var result = await lease.Restore(); Check("restoreFailureTruthful", result.Single(x => x.Name == ServiceName).Restored == false); }
        return new { mode = "handoff-fixtures", hardwarePackets = 0, realServiceControls = 0, passed = checks.Count, checks };
    }

    sealed class FakeService(string name, bool running, List<string> actions) : IHandoffService
    {
        public string Name => name; public int State { get; private set; } = running ? 4 : 1;
        public bool FailStopAfterChange, FailValidation, FailStart;
        public void Validate() { if (FailValidation) throw new IOException("Invalid fake service"); }
        public Task Stop(CancellationToken cancellation) { actions.Add("stop:" + name); State = 1; if (FailStopAfterChange) throw new IOException("Stop failure"); return Task.CompletedTask; }
        public Task Start(CancellationToken cancellation) { actions.Add("start:" + name); if (FailStart) throw new IOException("Start failure"); State = 4; return Task.CompletedTask; }
        public void Dispose() { }
    }
}

internal interface IHandoffService : IDisposable { string Name { get; } int State { get; } void Validate(); Task Stop(CancellationToken cancellation); Task Start(CancellationToken cancellation); }
internal sealed record HandoffRestored(string Name, bool WasRunning, string State, bool Restored, string? Error);
internal sealed class HandoffLease(IHandoffService[] services) : IDisposable
{
    readonly Dictionary<string, bool> running = [];
    public async Task Pause(CancellationToken cancellation)
    {
        if (services.Length != 2 || services[0].Name != WirelessHandoff.WatcherName || services[1].Name != WirelessHandoff.ServiceName) throw new ArgumentException("Ungültige Dienstliste.");
        foreach (var service in services) { service.Validate(); if (service.State is not 1 and not 4) throw new IOException("L-Connect-Dienst wechselt gerade seinen Zustand. Bitte später erneut versuchen."); }
        foreach (var service in services) running[service.Name] = service.State == 4;
        foreach (var service in services) if (running[service.Name]) { cancellation.ThrowIfCancellationRequested(); service.Validate(); await service.Stop(cancellation); }
    }
    public object[] Snapshot() => services.Select(service => (object)new { service.Name, wasRunning = running.GetValueOrDefault(service.Name), paused = running.GetValueOrDefault(service.Name) && service.State == 1 }).ToArray();
    public async Task<HandoffRestored[]> Restore()
    {
        var results = new List<HandoffRestored>(); using var deadline = new CancellationTokenSource(20000);
        foreach (var service in services.Reverse())
        {
            bool wasRunning = running.GetValueOrDefault(service.Name); string? error = null; bool restored = false; int state = 0;
            if (!running.ContainsKey(service.Name)) continue;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try { service.Validate(); state = service.State; if (wasRunning && state != 4) await service.Start(deadline.Token); state = service.State; restored = wasRunning ? state == 4 : state == 1; if (restored) { error = null; break; } error = "Dienstzustand entspricht nicht dem ursprünglichen Zustand."; }
                catch (Exception exception) { error = exception.Message; }
                if (deadline.IsCancellationRequested) break;
                try { await Task.Delay(250, deadline.Token); } catch (OperationCanceledException) { break; }
            }
            results.Add(new(service.Name, wasRunning, state == 4 ? "running" : state == 1 ? "stopped" : "unknown", restored, error));
        }
        return results.ToArray();
    }
    public void Dispose() { foreach (var service in services) service.Dispose(); }
}

internal sealed class WindowsHandoffService : IHandoffService
{
    readonly SafeServiceHandle manager, service;
    public string Name { get; }
    public WindowsHandoffService(string name)
    {
        WirelessHandoff.ImageName(name); Name = name;
        manager = HandoffNative.OpenSCManager(null, null, 1);
        if (manager.IsInvalid) { int error = Marshal.GetLastWin32Error(); manager.Dispose(); throw new Win32Exception(error); }
        service = HandoffNative.OpenService(manager, name, 1 | 4 | 16 | 32);
        if (service.IsInvalid) { int error = Marshal.GetLastWin32Error(); service.Dispose(); manager.Dispose(); throw new Win32Exception(error); }
    }
    public int State { get { if (!HandoffNative.QueryServiceStatus(service, out var status)) throw new Win32Exception(Marshal.GetLastWin32Error()); return (int)status.CurrentState; } }
    public void Validate()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("L-Connect-Dienste benötigen Windows.");
        HandoffNative.QueryServiceConfig(service, IntPtr.Zero, 0, out uint needed);
        if (needed < Marshal.SizeOf<ServiceConfiguration>() || needed > 65536) throw new IOException("L-Connect-Dienstkonfiguration ist ungültig.");
        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!HandoffNative.QueryServiceConfig(service, buffer, needed, out _)) throw new Win32Exception(Marshal.GetLastWin32Error());
            var config = Marshal.PtrToStructure<ServiceConfiguration>(buffer);
            string image = Marshal.PtrToStringUni(config.BinaryPath) ?? "", account = Marshal.PtrToStringUni(config.StartName) ?? "";
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{Name}", false);
            if (config.ServiceType != 16 || !WirelessHandoff.ValidInstalledImage(Name, image, account, programFiles)
                || !string.Equals(key?.GetValue("ObjectName") as string, "LocalSystem", StringComparison.OrdinalIgnoreCase)
                || !string.Equals(key?.GetValue("ImagePath") as string, image, StringComparison.OrdinalIgnoreCase))
                throw new IOException("L-Connect-Dienstidentität oder Systemkonto konnte nicht geprüft werden. Kein Dienst wird verändert.");
            var file = new FileInfo(image[1..^1]);
            if (!file.Exists || file.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("L-Connect-Dienstdatei ist nicht vorhanden oder umgeleitet.");
            for (var folder = file.Directory; folder != null; folder = folder.Parent)
            {
                if (folder.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("L-Connect-Dienstordner ist umgeleitet.");
                if (folder.FullName.Equals(programFiles, StringComparison.OrdinalIgnoreCase)) break;
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    public async Task Stop(CancellationToken cancellation)
    {
        Validate(); if (State == 1) return;
        if (!HandoffNative.ControlService(service, 1, out _)) { int error = Marshal.GetLastWin32Error(); if (error != 1062) throw new Win32Exception(error); }
        await WaitFor(1, cancellation);
    }
    public async Task Start(CancellationToken cancellation)
    {
        Validate(); int state = State; if (state == 4) return;
        if (state == 3) await WaitFor(1, cancellation);
        if (State != 2 && !HandoffNative.StartService(service, 0, IntPtr.Zero)) { int error = Marshal.GetLastWin32Error(); if (error != 1056) throw new Win32Exception(error); }
        await WaitFor(4, cancellation);
    }
    async Task WaitFor(int target, CancellationToken cancellation)
    {
        using var wait = CancellationTokenSource.CreateLinkedTokenSource(cancellation); wait.CancelAfter(6000);
        while (State != target) { wait.Token.ThrowIfCancellationRequested(); await Task.Delay(100, wait.Token); }
    }
    public void Dispose() { service.Dispose(); manager.Dispose(); }
}

internal sealed class SafeServiceHandle : SafeHandleZeroOrMinusOneIsInvalid { public SafeServiceHandle() : base(true) { } protected override bool ReleaseHandle() => HandoffNative.CloseServiceHandle(handle); }
[StructLayout(LayoutKind.Sequential)] internal struct ServiceStatus { public uint ServiceType, CurrentState, ControlsAccepted, Win32ExitCode, SpecificExitCode, CheckPoint, WaitHint; }
[StructLayout(LayoutKind.Sequential)] internal struct ServiceConfiguration { public uint ServiceType, StartType, ErrorControl; public IntPtr BinaryPath, LoadOrderGroup; public uint Tag; public IntPtr Dependencies, StartName, DisplayName; }
internal static class HandoffNative
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeServiceHandle OpenSCManager(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeServiceHandle OpenService(SafeServiceHandle manager, string name, uint access);
    [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseServiceHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryServiceStatus(SafeServiceHandle service, out ServiceStatus status);
    [DllImport("advapi32.dll", EntryPoint = "QueryServiceConfigW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryServiceConfig(SafeServiceHandle service, IntPtr buffer, uint size, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ControlService(SafeServiceHandle service, uint control, out ServiceStatus status);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool StartService(SafeServiceHandle service, uint count, IntPtr arguments);
}
