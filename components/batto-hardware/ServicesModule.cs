using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Batto.Hardware;

internal sealed record ServiceLeaseError(string? Name, string Operation, string Message);
internal sealed record ServiceLeaseState(string Name, bool WasRunning, bool StopRequested,
    bool ActuallyStopped, string State, bool RestorePending);
internal sealed record ServiceLeaseReply(bool Ok, bool Active, bool Released, bool RetryRequired,
    bool ConfirmationRequired, string[] Paused, string[] Remaining, ServiceLeaseState[] Services,
    ServiceLeaseError[] Errors, bool InProcess = true);

// An explicit, in-process lease of exactly the two installed L-Connect services.
// Status, construction and idle release do not open SCM or query services.
internal sealed class ServicesModule : IDisposable
{
    internal const string ServiceName = "LConnectService";
    internal const string WatcherName = "LConnectServiceWatcher";
    const int Stopped = 1, StartPending = 2, StopPending = 3, Running = 4;
    readonly object gate = new();
    readonly Func<string, IService> factory;
    readonly Action<CancellationToken> retryWait;
    List<Entry>? lease;
    ServiceLeaseError[] errors = [];
    bool ready;

    internal ServicesModule() : this(name => new WindowsService(name)) { }
    internal ServicesModule(Func<string, IService> factory, Action<CancellationToken>? retryWait = null)
    {
        this.factory = factory ?? throw new ArgumentNullException(nameof(factory));
        this.retryWait = retryWait ?? (token => { if (token.WaitHandle.WaitOne(250)) token.ThrowIfCancellationRequested(); });
    }

    internal ServiceLeaseReply Status()
    {
        lock (gate) return Reply(errors.Length == 0, confirmationRequired: false);
    }

    internal ServiceLeaseReply TakeControl(bool confirmed)
    {
        lock (gate)
        {
            if (!confirmed)
                return Reply(false, true, [new(null, "confirm", "Die Pause der beiden L-Connect-Dienste muss ausdrücklich bestätigt werden.")]);
            // A failed return retains these exact handles and obligations. It
            // cannot be hidden by starting a second lease with a new snapshot.
            if (lease != null)
                return Reply(ready && errors.Length == 0, false);

            errors = []; ready = false;
            var opened = new List<Entry>(2);
            try
            {
                foreach (string name in new[] { WatcherName, ServiceName })
                {
                    var service = factory(name);
                    if (service == null) throw new IOException("L-Connect-Dienst konnte nicht geöffnet werden.");
                    if (!string.Equals(service.Name, name, StringComparison.Ordinal))
                    {
                        service.Dispose();
                        throw new IOException("Die Dienstliste entspricht nicht den zwei erlaubten L-Connect-Diensten.");
                    }
                    opened.Add(new Entry(service));
                }
                // Verify every identity and capture every initial state before
                // the first stop. A partially validated list never changes SCM.
                foreach (var entry in opened)
                {
                    entry.Service.Validate();
                    entry.State = entry.Service.ReadState();
                    if (entry.State is not Stopped and not Running)
                        throw new IOException("L-Connect wechselt gerade seinen Zustand. Bitte später erneut versuchen.");
                    entry.WasRunning = entry.State == Running;
                }
                lease = opened;
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
                foreach (var entry in lease.Where(x => x.WasRunning))
                {
                    deadline.Token.ThrowIfCancellationRequested();
                    entry.Service.Validate();
                    // RequestStop only returns true for an accepted own stop.
                    // Record that obligation before any polling can time out.
                    if (entry.Service.RequestStop())
                    {
                        entry.StopRequested = true;
                        entry.RestorePending = true;
                    }
                    entry.State = entry.Service.ReadState();
                    if (entry.StopRequested && entry.State == Stopped) entry.ActuallyStopped = true;
                    if (entry.StopRequested)
                    {
                        entry.Service.WaitFor(Stopped, deadline.Token);
                        entry.State = entry.Service.ReadState();
                        if (entry.State != Stopped) throw new IOException("Die L-Connect-Pause wurde nicht bestätigt.");
                        entry.ActuallyStopped = true;
                    }
                    else if (entry.State != Stopped)
                        throw new IOException("L-Connect wurde nicht durch Batto angehalten. Keine Übernahme bestätigt.");
                }
                ready = true;
                return Reply(true, false);
            }
            catch (Exception error)
            {
                var failures = new List<ServiceLeaseError> { new(null, "take-control", error.Message) };
                if (lease != null) failures.AddRange(Restore());
                else foreach (var entry in opened) entry.Service.Dispose();
                errors = failures.ToArray();
                ready = false;
                return Reply(false, false);
            }
        }
    }

    internal ServiceLeaseReply ReleaseControl()
    {
        lock (gate)
        {
            if (lease == null)
            {
                // No service factory, polling, or Windows access while OFF.
                errors = []; ready = false;
                return Reply(true, false);
            }
            errors = Restore();
            ready = false;
            return Reply(errors.Length == 0 && lease == null, false);
        }
    }

    ServiceLeaseError[] Restore()
    {
        if (lease == null) return [];
        var failures = new List<ServiceLeaseError>();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        // Start the main service before its watcher. Never start a service that
        // was initially stopped or whose stop request did not belong to Batto.
        foreach (var entry in lease.AsEnumerable().Reverse().Where(x => x.RestorePending))
        {
            string? failure = null;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    deadline.Token.ThrowIfCancellationRequested();
                    entry.Service.Validate();
                    entry.State = entry.Service.ReadState();
                    // An accepted stop can return while the service still says
                    // Running. Until Stopped was actually observed, that is an
                    // unresolved stop, not a successful return to L-Connect.
                    if (!entry.ActuallyStopped && entry.State != Stopped)
                    {
                        entry.Service.WaitFor(Stopped, deadline.Token);
                        entry.State = entry.Service.ReadState();
                        if (entry.State != Stopped)
                            throw new IOException("Die angenommene L-Connect-Stopanfrage wurde noch nicht als angehalten bestätigt. Ausschalten erneut versuchen.");
                    }
                    if (entry.State == StopPending)
                    {
                        entry.Service.WaitFor(Stopped, deadline.Token);
                        entry.State = entry.Service.ReadState();
                    }
                    if (entry.State == Stopped)
                    {
                        entry.ActuallyStopped = true;
                        if (!entry.WasRunning || !entry.StopRequested)
                            throw new IOException("Für diesen Dienst besteht keine eigene Wiederherstellungszuständigkeit.");
                        entry.Service.RequestStart();
                        entry.Service.WaitFor(Running, deadline.Token);
                    }
                    else if (entry.State == StartPending)
                        entry.Service.WaitFor(Running, deadline.Token);
                    else if (entry.State != Running)
                        throw new IOException("Der L-Connect-Dienst hat einen unbekannten Übergangszustand.");
                    entry.State = entry.Service.ReadState();
                    if (entry.State != Running) throw new IOException("Der Neustart des L-Connect-Dienstes wurde nicht bestätigt.");
                    entry.RestorePending = false; failure = null;
                    break;
                }
                catch (Exception error) { failure = error.Message; }
                if (deadline.IsCancellationRequested) break;
                if (attempt < 2)
                    try { retryWait(deadline.Token); } catch (OperationCanceledException) { break; }
            }
            if (entry.RestorePending)
                failures.Add(new(entry.Service.Name, "restore", failure ?? "L-Connect konnte nicht wieder gestartet werden."));
        }
        if (!lease.Any(x => x.RestorePending))
        {
            foreach (var entry in lease) entry.Service.Dispose();
            lease = null;
        }
        return failures.ToArray();
    }

    ServiceLeaseReply Reply(bool ok, bool confirmationRequired, ServiceLeaseError[]? responseErrors = null)
    {
        var entries = lease?.ToArray() ?? [];
        var currentErrors = responseErrors ?? errors;
        return new(ok, lease != null, lease == null, lease != null && currentErrors.Length > 0,
            confirmationRequired,
            entries.Where(x => x.StopRequested && x.ActuallyStopped && x.State == Stopped).Select(x => x.Service.Name).ToArray(),
            entries.Where(x => x.RestorePending).Select(x => x.Service.Name).ToArray(),
            entries.Select(x => new ServiceLeaseState(x.Service.Name, x.WasRunning, x.StopRequested,
                x.ActuallyStopped, x.State == Running ? "running" : x.State == Stopped ? "stopped" : "transition", x.RestorePending)).ToArray(),
            currentErrors);
    }

    public void Dispose()
    {
        var result = ReleaseControl();
        if (!result.Ok || result.Active)
            throw new IOException("Die Rückgabe der L-Connect-Dienste ist noch offen. Ausschalten erneut versuchen: "
                + string.Join("; ", result.Errors.Select(x => x.Message)));
    }

    sealed class Entry(IService service)
    {
        internal readonly IService Service = service;
        internal bool WasRunning, StopRequested, ActuallyStopped, RestorePending;
        internal int State;
    }

    internal interface IService : IDisposable
    {
        string Name { get; }
        void Validate();
        int ReadState();
        bool RequestStop();
        void RequestStart();
        void WaitFor(int target, CancellationToken cancellation);
    }

    static string ImageName(string name) => name switch
    {
        ServiceName => "L-Connect-Service.exe",
        WatcherName => "L-Connect-Service-Watcher.exe",
        _ => throw new ArgumentException("Unbekannter L-Connect-Dienst.")
    };
    internal static bool ValidInstalledImage(string name, string image, string account, string programFiles)
    {
        if (name is not ServiceName and not WatcherName || !Path.IsPathFullyQualified(programFiles)
            || !account.Equals("LocalSystem", StringComparison.OrdinalIgnoreCase)
            || image.Length < 3 || image[0] != '"' || image[^1] != '"' || image[1..^1].Contains('"')) return false;
        try { return Path.GetFullPath(image[1..^1]).Equals(Path.GetFullPath(Path.Combine(programFiles, "Lian-Li", "L-Connect 3", ImageName(name))), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    sealed class WindowsService : IService
    {
        readonly ServiceHandle manager, service;
        public string Name { get; }
        internal WindowsService(string name)
        {
            _ = ImageName(name); Name = name;
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("L-Connect-Dienste benötigen Windows.");
            manager = Scm.OpenSCManager(null, null, 1);
            if (manager.IsInvalid) { int error = Marshal.GetLastWin32Error(); manager.Dispose(); throw new Win32Exception(error); }
            service = Scm.OpenService(manager, name, 1 | 4 | 16 | 32);
            if (service.IsInvalid) { int error = Marshal.GetLastWin32Error(); service.Dispose(); manager.Dispose(); throw new Win32Exception(error); }
        }
        public int ReadState()
        {
            if (!Scm.QueryServiceStatus(service, out var status)) throw new Win32Exception(Marshal.GetLastWin32Error());
            return (int)status.CurrentState;
        }
        public void Validate()
        {
            Scm.QueryServiceConfig(service, IntPtr.Zero, 0, out uint needed);
            if (needed < Marshal.SizeOf<ServiceConfiguration>() || needed > 65536) throw new IOException("L-Connect-Dienstkonfiguration ist ungültig.");
            var buffer = Marshal.AllocHGlobal((int)needed);
            try
            {
                if (!Scm.QueryServiceConfig(service, buffer, needed, out _)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var config = Marshal.PtrToStructure<ServiceConfiguration>(buffer);
                string image = Marshal.PtrToStringUni(config.BinaryPath) ?? "", account = Marshal.PtrToStringUni(config.StartName) ?? "";
                string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{Name}", false);
                if (config.ServiceType != 16 || !ValidInstalledImage(Name, image, account, programFiles)
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
        public bool RequestStop()
        {
            Validate(); int state = ReadState();
            if (state == Stopped) return false;
            if (state != Running) throw new IOException("L-Connect wechselt gerade seinen Zustand.");
            if (!Scm.ControlService(service, 1, out _))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == 1062) return false;
                throw new Win32Exception(error);
            }
            return true;
        }
        public void RequestStart()
        {
            Validate(); int state = ReadState();
            if (state == Running) return;
            if (state != Stopped) throw new IOException("L-Connect ist noch nicht vollständig angehalten.");
            if (!Scm.StartService(service, 0, IntPtr.Zero))
            {
                int error = Marshal.GetLastWin32Error();
                if (error != 1056) throw new Win32Exception(error);
            }
        }
        public void WaitFor(int target, CancellationToken cancellation)
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(TimeSpan.FromSeconds(6));
            while (ReadState() != target)
            {
                deadline.Token.ThrowIfCancellationRequested();
                deadline.Token.WaitHandle.WaitOne(100);
            }
        }
        public void Dispose() { service.Dispose(); manager.Dispose(); }
    }

    sealed class ServiceHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public ServiceHandle() : base(true) { }
        protected override bool ReleaseHandle() => Scm.CloseServiceHandle(handle);
    }
    [StructLayout(LayoutKind.Sequential)] struct ServiceStatus
    {
        internal uint ServiceType, CurrentState, ControlsAccepted, Win32ExitCode, SpecificExitCode, CheckPoint, WaitHint;
    }
    [StructLayout(LayoutKind.Sequential)] struct ServiceConfiguration
    {
        internal uint ServiceType, StartType, ErrorControl;
        internal IntPtr BinaryPath, LoadOrderGroup;
        internal uint Tag;
        internal IntPtr Dependencies, StartName, DisplayName;
    }
    static class Scm
    {
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern ServiceHandle OpenSCManager(string? machine, string? database, uint access);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern ServiceHandle OpenService(ServiceHandle manager, string name, uint access);
        [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseServiceHandle(IntPtr handle);
        [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryServiceStatus(ServiceHandle service, out ServiceStatus status);
        [DllImport("advapi32.dll", EntryPoint = "QueryServiceConfigW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryServiceConfig(ServiceHandle service, IntPtr buffer, uint size, out uint needed);
        [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ControlService(ServiceHandle service, uint control, out ServiceStatus status);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool StartService(ServiceHandle service, uint count, IntPtr arguments);
    }

    internal static object Fixtures()
    {
        var checks = new List<string>();
        void Check(string name, bool passed) { if (!passed) throw new InvalidOperationException("Dienst-Selbsttest: " + name); checks.Add(name); }
        var programFiles = Path.Combine(Path.GetPathRoot(Environment.CurrentDirectory)!, "Program Files");
        string Image(string name) => '"' + Path.Combine(programFiles, "Lian-Li", "L-Connect 3", ImageName(name)) + '"';
        Check("fixedIdentity", ValidInstalledImage(ServiceName, Image(ServiceName), "LocalSystem", programFiles));
        Check("foreignServiceRejected", !ValidInstalledImage("CorsairService", Image(ServiceName), "LocalSystem", programFiles));
        Check("wrongAccountRejected", !ValidInstalledImage(ServiceName, Image(ServiceName), "LocalService", programFiles));
        Check("argumentsRejected", !ValidInstalledImage(ServiceName, Image(ServiceName) + " --other", "LocalSystem", programFiles));
        Check("unquotedRejected", !ValidInstalledImage(ServiceName, Image(ServiceName).Trim('"'), "LocalSystem", programFiles));
        Check("swappedImageRejected", !ValidInstalledImage(ServiceName, Image(WatcherName), "LocalSystem", programFiles));
        var actions = new List<string>(); int opened = 0;
        var watcher = new FakeService(WatcherName, true, actions);
        var main = new FakeService(ServiceName, true, actions);
        ServicesModule Module() => new(name => { opened++; return name == WatcherName ? watcher : main; }, _ => { });
        using (var module = Module())
        {
            Check("constructionAndStatusIdle", opened == 0 && !module.Status().Active);
            var denied = module.TakeControl(false);
            Check("confirmationBeforeOpen", !denied.Ok && denied.ConfirmationRequired && opened == 0 && actions.Count == 0);
            Check("idleReleaseNoScm", module.ReleaseControl().Ok && opened == 0 && watcher.Reads == 0 && main.Reads == 0);
            Check("explicitPause", module.TakeControl(true).Ok && module.Status().Active && opened == 2);
            Check("pauseOrder", actions.SequenceEqual(["stop:" + WatcherName, "stop:" + ServiceName]));
            int reads = watcher.Reads + main.Reads;
            module.Status(); module.Status(); module.TakeControl(true);
            Check("activeStatusAndDuplicateTakeCached", reads == watcher.Reads + main.Reads && opened == 2 && actions.Count == 2);
            Check("explicitReturn", module.ReleaseControl() is { Ok: true, Active: false, Released: true });
            Check("restoreOrder", actions.Skip(2).SequenceEqual(["start:" + ServiceName, "start:" + WatcherName]));
        }
        actions.Clear(); watcher = new FakeService(WatcherName, false, actions); main = new FakeService(ServiceName, true, actions);
        using (var module = Module()) { module.TakeControl(true); module.ReleaseControl(); }
        Check("initiallyStoppedPreserved", actions.SequenceEqual(["stop:" + ServiceName, "start:" + ServiceName]) && watcher.State == Stopped);
        actions.Clear(); watcher = new FakeService(WatcherName, false, actions); main = new FakeService(ServiceName, false, actions);
        using (var module = Module())
        {
            Check("bothStoppedNoCommands", module.TakeControl(true).Ok && actions.Count == 0);
            int reads = watcher.Reads + main.Reads;
            Check("unownedReleaseNoQueries", module.ReleaseControl().Ok && reads == watcher.Reads + main.Reads && actions.Count == 0);
        }
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); main = new FakeService(ServiceName, true, actions) { FailValidation = true };
        using (var module = Module()) Check("validateAllBeforeMutation", !module.TakeControl(true).Ok && actions.Count == 0 && !module.Status().Active);
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions) { FailStopWait = true }; main = new FakeService(ServiceName, true, actions);
        using (var module = Module()) Check("watcherFailureRollback", !module.TakeControl(true).Ok && !module.Status().Active && watcher.State == Running && main.State == Running);
        Check("watcherOnlyRollback", actions.SequenceEqual(["stop:" + WatcherName, "start:" + WatcherName]));
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); main = new FakeService(ServiceName, true, actions) { FailStopWait = true };
        using (var module = Module()) Check("mainFailureRollback", !module.TakeControl(true).Ok && !module.Status().Active && watcher.State == Running && main.State == Running);
        Check("mainFailureRollbackOrder", actions.SequenceEqual(["stop:" + WatcherName, "stop:" + ServiceName, "start:" + ServiceName, "start:" + WatcherName]));
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); main = new FakeService(ServiceName, true, actions) { FailStart = true };
        using (var module = Module())
        {
            module.TakeControl(true);
            var failed = module.ReleaseControl();
            Check("returnFailureRetainsExactLease", !failed.Ok && failed.Active && failed.RetryRequired && failed.Remaining.SequenceEqual([ServiceName]));
            int requests = actions.Count, factories = opened;
            Check("pendingLeaseCannotBeReplaced", !module.TakeControl(true).Ok && actions.Count == requests && opened == factories);
            main.FailStart = false;
            Check("offRetryRestoresRemaining", module.ReleaseControl() is { Ok: true, Active: false, Released: true } && main.State == Running);
            Check("watcherNotStartedTwice", actions.Count(x => x == "start:" + WatcherName) == 1);
        }
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); main = new FakeService(ServiceName, true, actions) { StopOccurredElsewhere = true };
        using (var module = Module()) { Check("externalStopIsNotOwned", module.TakeControl(true).Ok); module.ReleaseControl(); }
        Check("externalStopIsNotRestarted", main.State == Stopped && !actions.Contains("start:" + ServiceName));
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); main = new FakeService(ServiceName, true, actions) { FailStopWait = true, FailStart = true };
        using (var module = Module())
        {
            var failed = module.TakeControl(true);
            Check("rollbackFailureRetained", !failed.Ok && failed.Active && failed.RetryRequired && failed.Remaining.SequenceEqual([ServiceName]));
            main.FailStart = false;
            Check("rollbackRetry", module.ReleaseControl() is { Ok: true, Active: false });
        }
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions); main = new FakeService(ServiceName, true, actions) { FailReadAfterStop = true };
        using (var module = Module())
        {
            var failed = module.TakeControl(true);
            Check("stopAcceptedBeforeQueryFailure", !failed.Ok && failed.Active && failed.Remaining.SequenceEqual([ServiceName])
                && failed.Services.Single(x => x.Name == ServiceName) is { StopRequested: true, ActuallyStopped: false });
            Check("noStartWhileStoppedUnverified", !actions.Contains("start:" + ServiceName));
            main.FailReadAfterStop = false;
            Check("queryFailureRetryRestores", module.ReleaseControl() is { Ok: true, Active: false } && main.State == Running);
        }
        actions.Clear(); watcher = new FakeService(WatcherName, true, actions) { SlowAcceptedStop = true }; main = new FakeService(ServiceName, true, actions);
        using (var module = Module())
        {
            var failed = module.TakeControl(true);
            Check("acceptedSlowStopRemainsUncertain", !failed.Ok && failed.Active && failed.RetryRequired
                && failed.Remaining.SequenceEqual([WatcherName]) && failed.Services.Single(x => x.Name == WatcherName) is { StopRequested: true, ActuallyStopped: false, State: "running" });
            Check("uncertainRunningNotReleasedOrRestarted", !module.ReleaseControl().Ok && module.Status().Active
                && !actions.Any(x => x.StartsWith("start:", StringComparison.Ordinal)));
            watcher.SlowAcceptedStop = false; watcher.State = Stopped;
            Check("lateStopThenConfirmedReturn", module.ReleaseControl() is { Ok: true, Active: false, Released: true } && watcher.State == Running);
        }
        return new { ok = true, passed = checks.Count, checks, hardwarePackets = 0, realServiceControls = 0, childProcesses = 0 };
    }

    sealed class FakeService(string name, bool running, List<string> actions) : IService
    {
        public string Name => name;
        internal int State = running ? Running : Stopped, Reads;
        internal bool FailValidation, FailStopWait, FailStart, StopOccurredElsewhere, FailReadAfterStop, SlowAcceptedStop;
        bool ownStop;
        public void Validate() { if (FailValidation) throw new IOException("Fake service identity mismatch"); }
        public int ReadState() { Reads++; if (ownStop && FailReadAfterStop) throw new IOException("Fake query failed after accepted stop"); return State; }
        public bool RequestStop()
        {
            if (StopOccurredElsewhere) { State = Stopped; return false; }
            actions.Add("stop:" + name); ownStop = true; if (!SlowAcceptedStop) State = Stopped; return true;
        }
        public void RequestStart() { actions.Add("start:" + name); if (FailStart) throw new IOException("Fake start failed"); State = Running; }
        public void WaitFor(int target, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            if (target == Stopped && FailStopWait) throw new IOException("Fake stop wait failed after accepted stop");
            if (State != target) throw new IOException("Fake target not reached");
        }
        public void Dispose() { }
    }
}
