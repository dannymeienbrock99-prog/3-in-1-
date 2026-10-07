using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Batto.Hardware;

// Independent of the L-Connect lease. Never stop iCUE.exe, CPUID,
// updater, device lister, or any service outside this fixed allowlist.
// An explicit, in-process lease of exactly the three fixed Corsair hardware services.
// Status, construction and idle release do not open SCM or query services.
internal sealed class CorsairOwnership : IDisposable
{
    internal const string ServiceName = "CorsairService";
    internal const string PluginName = "iCUEDevicePluginHost";
    internal const string ControlName = "CorsairDeviceControlService";
    const int Stopped = 1, StartPending = 2, StopPending = 3, Running = 4;
    readonly object gate = new();
    readonly Func<string, IService> factory;
    readonly Action<CancellationToken> retryWait;
    List<Entry>? lease;
    ServiceLeaseError[] errors = [];
    bool ready;

    internal CorsairOwnership() : this(name => new WindowsService(name)) { }
    internal CorsairOwnership(Func<string, IService> factory, Action<CancellationToken>? retryWait = null)
    {
        this.factory = factory ?? throw new ArgumentNullException(nameof(factory));
        this.retryWait = retryWait ?? (token => { if (token.WaitHandle.WaitOne(250)) token.ThrowIfCancellationRequested(); });
    }

    internal ServiceLeaseReply Status()
    {
        lock (gate) return Reply(errors.Length == 0, confirmationRequired: false);
    }

    internal ServiceLeaseReply Take(bool confirmed)
    {
        lock (gate)
        {
            if (!confirmed)
                return Reply(false, true, [new(null, "confirm", "Die Pause der drei Corsair-Dienste muss ausdrücklich bestätigt werden.")]);
            // A failed return retains these exact handles and obligations. It
            // cannot be hidden by starting a second lease with a new snapshot.
            if (lease != null)
                return Reply(ready && errors.Length == 0, false);

            errors = []; ready = false;
            var opened = new List<Entry>(3);
            try
            {
                foreach (string name in new[] { PluginName, ControlName, ServiceName })
                {
                    var service = factory(name);
                    if (service == null) throw new IOException("Corsair-Dienst konnte nicht geöffnet werden.");
                    if (!string.Equals(service.Name, name, StringComparison.Ordinal))
                    {
                        service.Dispose();
                        throw new IOException("Die Dienstliste entspricht nicht den drei erlaubten Corsair-Diensten.");
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
                        throw new IOException("Corsair wechselt gerade seinen Zustand. Bitte später erneut versuchen.");
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
                        if (entry.State != Stopped) throw new IOException("Die Corsair-Pause wurde nicht bestätigt.");
                        entry.ActuallyStopped = true;
                    }
                    else if (entry.State != Stopped)
                        throw new IOException("Corsair wurde nicht durch Batto angehalten. Keine Übernahme bestätigt.");
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

    internal ServiceLeaseReply Release()
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
                    // unresolved stop, not a successful return to Corsair.
                    if (!entry.ActuallyStopped && entry.State != Stopped)
                    {
                        entry.Service.WaitFor(Stopped, deadline.Token);
                        entry.State = entry.Service.ReadState();
                        if (entry.State != Stopped)
                            throw new IOException("Die angenommene Corsair-Stopanfrage wurde noch nicht als angehalten bestätigt. Ausschalten erneut versuchen.");
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
                        throw new IOException("Der Corsair-Dienst hat einen unbekannten Übergangszustand.");
                    entry.State = entry.Service.ReadState();
                    if (entry.State != Running) throw new IOException("Der Neustart des Corsair-Dienstes wurde nicht bestätigt.");
                    entry.RestorePending = false; failure = null;
                    break;
                }
                catch (Exception error) { failure = error.Message; }
                if (deadline.IsCancellationRequested) break;
                if (attempt < 2)
                    try { retryWait(deadline.Token); } catch (OperationCanceledException) { break; }
            }
            if (entry.RestorePending)
                failures.Add(new(entry.Service.Name, "restore", failure ?? "Corsair konnte nicht wieder gestartet werden."));
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
        var result = Release();
        if (!result.Ok || result.Active)
            throw new IOException("Die Rückgabe der Corsair-Dienste ist noch offen. Ausschalten erneut versuchen: "
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
        PluginName => Path.Combine("Corsair", "Corsair iCUE5 Software", "iCUEDevicePluginHost.exe"),
        ControlName => Path.Combine("Corsair", "Corsair Device Control Service", "bin", "CorsairDeviceControlService.exe"),
        ServiceName => Path.Combine("Corsair", "Corsair iCUE5 Software", "clink", "Corsair.Service.exe"),
        _ => throw new ArgumentException("Unbekannter Corsair-Hardwaredienst.")
    };
    internal static bool ValidInstalledImage(string name, string image, string account, string programFiles)
    {
        if (name is not ServiceName and not PluginName and not ControlName || !Path.IsPathFullyQualified(programFiles)
            || !account.Equals("LocalSystem", StringComparison.OrdinalIgnoreCase)
            || image.Length < 3 || image[0] != '"' || image[^1] != '"' || image[1..^1].Contains('"')) return false;
        try { return Path.GetFullPath(image[1..^1]).Equals(Path.GetFullPath(Path.Combine(programFiles, ImageName(name))), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }
    static bool ValidSigner(string signer) => signer.Equals("Corsair Memory, Inc.", StringComparison.OrdinalIgnoreCase);

    sealed class WindowsService : IService
    {
        readonly ServiceHandle manager, service;
        public string Name { get; }
        internal WindowsService(string name)
        {
            _ = ImageName(name); Name = name;
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Corsair-Dienste benötigen Windows.");
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
            if (needed < Marshal.SizeOf<ServiceConfiguration>() || needed > 65536) throw new IOException("Corsair-Dienstkonfiguration ist ungültig.");
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
                    throw new IOException("Corsair-Dienstidentität oder Systemkonto konnte nicht geprüft werden. Kein Dienst wird verändert.");
                var file = new FileInfo(image[1..^1]);
                if (!file.Exists || file.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Corsair-Dienstdatei ist nicht vorhanden oder umgeleitet.");
                for (var folder = file.Directory; folder != null; folder = folder.Parent)
                {
                    if (folder.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Corsair-Dienstordner ist umgeleitet.");
                    if (folder.FullName.Equals(programFiles, StringComparison.OrdinalIgnoreCase)) break;
                }
                // Hold the exact protected executable against replacement or
                // writing while Windows evaluates Authenticode on its handle.
                using var lockedFile = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (!ValidSigner(VerifySigner(file.FullName, lockedFile.SafeFileHandle.DangerousGetHandle())))
                    throw new IOException("Der Corsair-Hardwaredienst hat keinen bestätigten Corsair-Unterzeichner.");
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        public bool RequestStop()
        {
            Validate(); int state = ReadState();
            if (state == Stopped) return false;
            if (state != Running) throw new IOException("Corsair wechselt gerade seinen Zustand.");
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
            if (state != Stopped) throw new IOException("Corsair ist noch nicht vollständig angehalten.");
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

    // Authenticode trust is evaluated by Windows against the opened file. Read the leaf of that verified signer, not an unrelated embedded certificate.
    static string VerifySigner(string path, nint fileHandle)
    {
        var fileInfo = new TrustFile { Size = (uint)Marshal.SizeOf<TrustFile>(), FilePath = Marshal.StringToHGlobalUni(path), FileHandle = fileHandle };
        nint filePointer = Marshal.AllocHGlobal(Marshal.SizeOf<TrustFile>());
        var data = new TrustData { Size = (uint)Marshal.SizeOf<TrustData>(), UiChoice = 2, UnionChoice = 1,
            FileInfo = filePointer, StateAction = 1, ProviderFlags = 0x1000 };
        var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
        try
        {
            Marshal.StructureToPtr(fileInfo, filePointer, false);
            int status = WinVerifyTrust(new nint(-1), ref action, ref data);
            if (status != 0 || data.StateData == 0) throw new IOException("Die Corsair-Dateisignatur konnte nicht bestätigt werden.");
            nint provider = WTHelperProvDataFromStateData(data.StateData);
            nint signerPointer = provider != 0 ? WTHelperGetProvSignerFromChain(provider, 0, false, 0) : 0;
            if (signerPointer == 0) throw new IOException("Kein bestätigter Corsair-Unterzeichner.");
            var signer = Marshal.PtrToStructure<ProviderSigner>(signerPointer);
            if (signer.Error != 0 || signer.Certificates == 0 || signer.CertificateChain == 0) throw new IOException("Der Corsair-Unterzeichner ist nicht vertrauenswürdig.");
            var certificate = Marshal.PtrToStructure<ProviderCertificatePrefix>(signer.CertificateChain);
            if (certificate.Context == 0) throw new IOException("Das Corsair-Unterzeichnerzertifikat fehlt.");
            using var leaf = new X509Certificate2(certificate.Context);
            return leaf.GetNameInfo(X509NameType.SimpleName, false);
        }
        finally
        {
            try { if (data.StateData != 0) { data.StateAction = 2; WinVerifyTrust(new nint(-1), ref action, ref data); } }
            finally { Marshal.FreeHGlobal(filePointer); Marshal.FreeHGlobal(fileInfo.FilePath); }
        }
    }
    [StructLayout(LayoutKind.Sequential)] struct TrustFile { internal uint Size; internal nint FilePath, FileHandle, KnownSubject; }
    [StructLayout(LayoutKind.Sequential)] struct TrustData
    {
        internal uint Size; internal nint PolicyCallback, SipClient; internal uint UiChoice, RevocationChecks, UnionChoice;
        internal nint FileInfo; internal uint StateAction; internal nint StateData, UrlReference;
        internal uint ProviderFlags, UiContext; internal nint SignatureSettings;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProviderSigner
    {
        internal uint Size; internal System.Runtime.InteropServices.ComTypes.FILETIME VerifiedAt; internal uint Certificates;
        internal nint CertificateChain; internal uint Type; internal nint Signer; internal uint Error, CounterSigners;
        internal nint CounterSignerChain, ChainContext;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProviderCertificatePrefix { internal uint Size; internal nint Context; }
    [DllImport("wintrust.dll", ExactSpelling = true)] static extern int WinVerifyTrust(nint window, ref Guid action, ref TrustData data);
    [DllImport("wintrust.dll", ExactSpelling = true)] static extern nint WTHelperProvDataFromStateData(nint state);
    [DllImport("wintrust.dll", ExactSpelling = true)] static extern nint WTHelperGetProvSignerFromChain(nint provider, uint index, [MarshalAs(UnmanagedType.Bool)] bool counterSigner, uint counterIndex);

    internal static object Fixtures()
    {
        var checks = new List<string>();
        void Check(string name, bool passed) { if (!passed) throw new InvalidOperationException("Corsair ownership fixture: " + name); checks.Add(name); }
        string programFiles = Path.Combine(Path.GetPathRoot(Environment.CurrentDirectory)!, "Program Files");
        string Image(string name) => '"' + Path.Combine(programFiles, ImageName(name)) + '"';
        foreach (string name in new[] { PluginName, ControlName, ServiceName })
            Check("fixed identity " + name, ValidInstalledImage(name, Image(name), "LocalSystem", programFiles));
        Check("updater excluded", !ValidInstalledImage("iCUEUpdateService", Image(PluginName), "LocalSystem", programFiles));
        Check("CPUID excluded", !ValidInstalledImage("CorsairCpuIdService", Image(ServiceName), "LocalSystem", programFiles));
        Check("lister excluded", !ValidInstalledImage("CorsairDeviceListerService", Image(ServiceName), "LocalSystem", programFiles));
        Check("L-Connect excluded", !ValidInstalledImage("LConnectService", Image(ServiceName), "LocalSystem", programFiles));
        Check("wrong account rejected", !ValidInstalledImage(ServiceName, Image(ServiceName), "LocalService", programFiles));
        Check("arguments rejected", !ValidInstalledImage(ServiceName, Image(ServiceName) + " --other", "LocalSystem", programFiles));
        Check("unquoted path rejected", !ValidInstalledImage(ServiceName, Image(ServiceName).Trim('"'), "LocalSystem", programFiles));
        Check("swapped executable rejected", !ValidInstalledImage(PluginName, Image(ServiceName), "LocalSystem", programFiles));
        Check("protected folder required", !ValidInstalledImage(ServiceName, '"' + Path.Combine(Path.GetTempPath(), "Corsair.Service.exe") + '"', "LocalSystem", programFiles));
        Check("exact Corsair publisher", ValidSigner("Corsair Memory, Inc.") && !ValidSigner("Unknown Publisher") && !ValidSigner("Corsair Memory, Inc. Example"));
        Check("WinTrust ABI layout", Marshal.SizeOf<TrustData>() == (IntPtr.Size == 8 ? 88 : 52)
            && Marshal.OffsetOf<ProviderSigner>(nameof(ProviderSigner.CertificateChain)).ToInt32() == 16);
        var actions = new List<string>(); int opened = 0;
        var plugin = new FakeService(PluginName, true, actions);
        var control = new FakeService(ControlName, true, actions);
        var service = new FakeService(ServiceName, true, actions);
        CorsairOwnership Module() => new(name => { opened++; return name switch { PluginName => plugin, ControlName => control, ServiceName => service, _ => throw new InvalidOperationException() }; }, _ => { });
        using (var module = Module())
        {
            Check("construction status OFF no SCM", opened == 0 && !module.Status().Active);
            Check("confirmation before any open", module.Take(false) is { Ok: false, ConfirmationRequired: true } && opened == 0 && actions.Count == 0);
            Check("idle release no SCM", module.Release().Ok && opened == 0);
            Check("explicit three-service pause", module.Take(true) is { Ok: true, Active: true } && opened == 3);
            Check("fixed pause order", actions.SequenceEqual(["stop:" + PluginName, "stop:" + ControlName, "stop:" + ServiceName]));
            int reads = plugin.Reads + control.Reads + service.Reads;
            module.Status(); module.Take(true);
            Check("status and duplicate take cached", reads == plugin.Reads + control.Reads + service.Reads && opened == 3 && actions.Count == 3);
            Check("explicit return confirmed", module.Release() is { Ok: true, Active: false, Released: true });
            Check("reverse restoration order", actions.Skip(3).SequenceEqual(["start:" + ServiceName, "start:" + ControlName, "start:" + PluginName]));
        }
        actions.Clear(); plugin = new(PluginName, true, actions); control = new(ControlName, false, actions); service = new(ServiceName, true, actions);
        using (var module = Module()) { module.Take(true); module.Release(); }
        Check("initially stopped preserved", control.State == Stopped && !actions.Any(x => x.EndsWith(ControlName, StringComparison.Ordinal)));
        actions.Clear(); plugin = new(PluginName, false, actions); control = new(ControlName, false, actions); service = new(ServiceName, false, actions);
        using (var module = Module()) { Check("all stopped no writes", module.Take(true).Ok && actions.Count == 0); module.Release(); }
        Check("all stopped stay stopped", actions.Count == 0 && plugin.State == Stopped && control.State == Stopped && service.State == Stopped);
        actions.Clear(); plugin = new(PluginName, true, actions); control = new(ControlName, true, actions); service = new(ServiceName, true, actions) { FailValidation = true };
        using (var module = Module()) Check("validate ALL before first stop", !module.Take(true).Ok && actions.Count == 0 && !module.Status().Active);
        actions.Clear(); plugin = new(PluginName, true, actions); control = new(ControlName, true, actions) { FailStopWait = true }; service = new(ServiceName, true, actions);
        using (var module = Module()) Check("partial pause rolls back", !module.Take(true).Ok && !module.Status().Active && plugin.State == Running && control.State == Running && service.State == Running);
        Check("partial pause leaves unvisited service", !actions.Any(x => x.EndsWith(ServiceName, StringComparison.Ordinal)));
        actions.Clear(); plugin = new(PluginName, true, actions); control = new(ControlName, true, actions); service = new(ServiceName, true, actions) { FailStart = true };
        using (var module = Module())
        {
            module.Take(true);
            Check("restore failure retained", module.Release() is { Ok: false, Active: true, RetryRequired: true } && module.Status().Remaining.SequenceEqual([ServiceName]));
            Check("best effort other restores", plugin.State == Running && control.State == Running);
            int factories = opened, writes = actions.Count;
            Check("failed lease cannot be replaced", !module.Take(true).Ok && factories == opened && writes == actions.Count);
            service.FailStart = false;
            Check("OFF retry restores remaining", module.Release() is { Ok: true, Active: false, Released: true } && service.State == Running);
            Check("other services not restarted twice", actions.Count(x => x == "start:" + PluginName) == 1 && actions.Count(x => x == "start:" + ControlName) == 1);
        }
        actions.Clear(); plugin = new(PluginName, true, actions); control = new(ControlName, true, actions); service = new(ServiceName, true, actions) { ExternalStop = true };
        using (var module = Module()) { module.Take(true); module.Release(); }
        Check("external stop not owned or restarted", service.State == Stopped && !actions.Contains("start:" + ServiceName));
        actions.Clear(); plugin = new(PluginName, true, actions); control = new(ControlName, true, actions); service = new(ServiceName, true, actions) { FailReadAfterStop = true };
        using (var module = Module())
        {
            Check("accepted stop query failure retained", !module.Take(true).Ok && module.Status().Active && module.Status().Remaining.SequenceEqual([ServiceName]));
            Check("no start before stopped verified", !actions.Contains("start:" + ServiceName));
            service.FailReadAfterStop = false;
            Check("query failure OFF retry", module.Release() is { Ok: true, Active: false } && service.State == Running);
        }
        actions.Clear(); plugin = new(PluginName, true, actions) { SlowAcceptedStop = true }; control = new(ControlName, true, actions); service = new(ServiceName, true, actions);
        using (var module = Module())
        {
            Check("slow accepted stop stays uncertain", !module.Take(true).Ok && module.Status().Active && module.Status().Remaining.SequenceEqual([PluginName]));
            Check("running is not presumed restored", !module.Release().Ok && module.Status().Active && !actions.Any(x => x.StartsWith("start:", StringComparison.Ordinal)));
            plugin.SlowAcceptedStop = false; plugin.State = Stopped;
            Check("late stop confirmed then restored", module.Release() is { Ok: true, Active: false, Released: true } && plugin.State == Running);
        }
        return new { ok = true, passed = checks.Count, checks, hardwarePackets = 0, realServiceControls = 0, childProcesses = 0 };
    }
    sealed class FakeService(string name, bool running, List<string> actions) : IService
    {
        public string Name => name;
        internal int State = running ? Running : Stopped, Reads;
        internal bool FailValidation, FailStopWait, FailStart, ExternalStop, FailReadAfterStop, SlowAcceptedStop;
        bool ownStop;
        public void Validate() { if (FailValidation) throw new IOException("Fake validation failure"); }
        public int ReadState() { Reads++; if (ownStop && FailReadAfterStop) throw new IOException("Fake query failed after stop"); return State; }
        public bool RequestStop() { if (ExternalStop) { State = Stopped; return false; } actions.Add("stop:" + name); ownStop = true; if (!SlowAcceptedStop) State = Stopped; return true; }
        public void RequestStart() { if (FailStart) throw new IOException("Fake restore failure"); actions.Add("start:" + name); State = Running; }
        public void WaitFor(int target, CancellationToken cancellation) { if (target == Stopped && (FailStopWait || SlowAcceptedStop)) throw new IOException("Fake stop not confirmed"); if (State != target) throw new IOException("Fake state mismatch"); }
        public void Dispose() { }
    }
}

