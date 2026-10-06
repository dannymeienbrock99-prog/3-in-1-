using System.Buffers.Binary;
using System.ComponentModel;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Batto.Hardware;

/// <summary>Bounded, read-only Windows inventory in Batto. Construction and idle commands perform no OS inspection.</summary>
internal sealed class InventoryModule : IDisposable
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    readonly object gate = new();
    readonly Func<object> platformReader;
    readonly Func<object> kingstonReader;
    object? platformCache, kingstonCache;

    internal InventoryModule() : this(ReadPlatform, ReadKingston) { }
    internal InventoryModule(Func<object> platformReader, Func<object> kingstonReader)
    {
        this.platformReader = platformReader;
        this.kingstonReader = kingstonReader;
    }

    internal object Dispatch(JsonElement request)
    {
        lock (gate)
        {
            string command = request.GetProperty("command").GetString() ?? "";
            return command switch
            {
                // Each explicit read is fresh. The cache is only used to report idle status.
                "platform" => platformCache = platformReader(),
                "kingston" => kingstonCache = kingstonReader(),
                "status" => Status(false),
                "close" => Close(),
                _ => throw new ArgumentException("Unbekannter Windows-Inventarbefehl.")
            };
        }
    }
    object Status(bool closed) => new { inProcess = true, processId = Environment.ProcessId,
        platformCached = platformCache != null, kingstonCached = kingstonCache != null, closed };
    object Close() { platformCache = null; kingstonCache = null; return Status(true); }
    public void Dispose() { lock (gate) Close(); }

    static object ReadPlatform()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Die PC-Erkennung benötigt Windows.");
        var boardRows = Query("SELECT Manufacturer, Product FROM Win32_BaseBoard", ["Manufacturer", "Product"], 1);
        var systemRows = Query("SELECT PCSystemType FROM Win32_ComputerSystem", ["PCSystemType"], 1);
        var enclosureRows = Query("SELECT ChassisTypes FROM Win32_SystemEnclosure", ["ChassisTypes"], 16);
        var chassis = new List<int>();
        foreach (var row in enclosureRows)
            if (row["ChassisTypes"] is Array values)
                foreach (object? value in values)
                {
                    if (chassis.Count >= 64) throw new IOException("Zu viele Gehäusetypen in der Windows-Erkennung.");
                    chassis.Add(Convert.ToInt32(value));
                }
        bool? administrator = null, pawnIO = null;
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            administrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { }
        try
        {
            using var registry = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using var key = registry.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO", false);
            pawnIO = key != null && Version.TryParse(Convert.ToString(key.GetValue("DisplayVersion")), out _);
        }
        catch { }
        return new { board = boardRows.FirstOrDefault(), system = systemRows.FirstOrDefault(),
            chassisTypes = chassis.ToArray(), prerequisites = new { administrator, pawnIO } };
    }

    internal sealed record KingstonProof(string ServiceName, string ServicePath, string ProcessPath, int ProcessId,
        string StartTime, string SignatureStatus, string Signer, string ListenerAddress, int ListenerPort, string[] ProgramFiles);
    const int FuryPort = 55599;
    static readonly HashSet<string> ServiceNames = new(StringComparer.OrdinalIgnoreCase)
        { "FuryController_Service", "FuryContorller_Service" };
    static readonly HashSet<string> ServiceFiles = new(StringComparer.OrdinalIgnoreCase)
        { "furycontroller_service.exe", "furycontorller_service.exe" };
    static readonly string[] InstallFolders = [@"Kingston\FURYCTRL", @"Kingston\FURYCTRL_SDK", "FURYCTRL", "FURYCTRL_SDK"];
    static readonly Regex SignerName = new(@"^Kingston Technology(?: Company)?(?:,? Inc\.?)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    static readonly Regex QuotedImage = new("^\\s*\"([^\"]+)\"\\s*$", RegexOptions.CultureInvariant);
    static readonly Regex PlainImage = new("^\\s*([^\"\\r\\n]+\\.exe)\\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    static object ReadKingston()
    {
        // Preserve the original inspector's unavailable sentinel. No vendor service is launched or changed here.
        try
        {
            if (!OperatingSystem.IsWindows()) return new { unavailable = true };
            var owners = ReadFuryListenerOwners();
            var services = Query("SELECT Name, State, ProcessId, PathName FROM Win32_Service WHERE Name='FuryController_Service' OR Name='FuryContorller_Service'",
                ["Name", "State", "ProcessId", "PathName"], 2);
            var matches = services.Where(row => string.Equals(Text(row["State"]), "Running", StringComparison.OrdinalIgnoreCase)
                && Convert.ToUInt32(row["ProcessId"]) is var pid && pid > 0 && owners.Contains(pid)).ToArray();
            if (matches.Length != 1) return new { unavailable = true };
            var service = matches[0];
            string serviceName = Text(service["Name"]), servicePath = Text(service["PathName"]);
            int processId = checked((int)Convert.ToUInt32(service["ProcessId"]));
            var process = ReadProcess(processId);
            string processPath = Path.GetFullPath(Text(process["ExecutablePath"]));
            string startTime = Text(process["CreationDate"]);
            var roots = new[] { Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
                Environment.GetEnvironmentVariable("ProgramW6432") }.Where(value => !string.IsNullOrWhiteSpace(value) && Path.IsPathFullyQualified(value))
                .Select(value => Path.GetFullPath(value!)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            // Match the existing JS protected-folder/image checks before opening a file for trust verification.
            var candidate = new KingstonProof(serviceName, servicePath, processPath, processId, startTime, "Valid", "Kingston Technology", "127.0.0.1", FuryPort, roots);
            ValidateProof(candidate);
            using (var registry = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
            using (var key = registry.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\" + serviceName, false))
            {
                string registeredImage = Text(key?.GetValue("ImagePath", null, RegistryValueOptions.DoNotExpandEnvironmentNames));
                if (!SamePath(ImagePath(registeredImage), processPath)) throw new IOException("Die Kingston-Dienstregistrierung stimmt nicht mit dem laufenden Prozess überein.");
            }
            RejectReparse(processPath);
            // Deny concurrent file replacement/writes while WinVerifyTrust reads this exact opened executable.
            using var file = new FileStream(processPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            string signer = VerifySigner(processPath, file.SafeFileHandle.DangerousGetHandle());
            var proof = candidate with { Signer = signer };
            ValidateProof(proof);
            var finalProcess = ReadProcess(processId);
            var finalService = Query("SELECT Name, State, ProcessId, PathName FROM Win32_Service WHERE Name='" + serviceName + "'",
                ["Name", "State", "ProcessId", "PathName"], 1).SingleOrDefault();
            if (finalService == null || Text(finalService["State"]) != "Running" || Convert.ToUInt32(finalService["ProcessId"]) != (uint)processId
                || !SamePath(ImagePath(Text(finalService["PathName"])), processPath)
                || !SamePath(Text(finalProcess["ExecutablePath"]), processPath) || Text(finalProcess["CreationDate"]) != startTime
                || !ReadFuryListenerOwners().Contains((uint)processId)) throw new IOException("Die Kingston-Dienstidentität hat sich während der Prüfung verändert.");
            return proof;
        }
        catch { return new { unavailable = true }; }
    }
    static Dictionary<string, object?> ReadProcess(int pid) => Query("SELECT ExecutablePath, CreationDate FROM Win32_Process WHERE ProcessId=" + pid.ToString(System.Globalization.CultureInfo.InvariantCulture),
        ["ExecutablePath", "CreationDate"], 1).SingleOrDefault() ?? throw new IOException("Die Kingston-Prozessidentität ist nicht lesbar.");
    static string Text(object? value) => Convert.ToString(value)?.Trim() ?? "";
    static string ImagePath(string image)
    {
        var quoted = QuotedImage.Match(image);
        var plain = PlainImage.Match(image);
        if (!quoted.Success && !plain.Success) throw new IOException("Ungültiger Kingston-Dienstpfad.");
        return Path.GetFullPath((quoted.Success ? quoted : plain).Groups[1].Value);
    }
    static bool SamePath(string first, string second) => string.Equals(Path.GetFullPath(first), Path.GetFullPath(second), StringComparison.OrdinalIgnoreCase);
    internal static void ValidateProof(KingstonProof proof)
    {
        if (!ServiceNames.Contains(proof.ServiceName) || proof.ProcessId < 1 || proof.ListenerAddress != "127.0.0.1" || proof.ListenerPort != FuryPort
            || proof.SignatureStatus != "Valid" || !SignerName.IsMatch(proof.Signer) || string.IsNullOrWhiteSpace(proof.StartTime))
            throw new IOException("Die Kingston-Dienstidentität konnte nicht bestätigt werden.");
        string file = Path.GetFullPath(proof.ProcessPath);
        if (!Path.IsPathFullyQualified(proof.ProcessPath) || !SamePath(ImagePath(proof.ServicePath), file) || !ServiceFiles.Contains(Path.GetFileName(file)))
            throw new IOException("Die Kingston-Dienstdatei stimmt nicht mit dem Prozess überein.");
        bool allowed = proof.ProgramFiles.Any(root => Path.IsPathFullyQualified(root) && InstallFolders.Any(folder =>
            file.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.Combine(root, folder))) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)));
        if (!allowed) throw new IOException("Kingston FURY CTRL liegt nicht in einem bekannten geschützten Installationsordner.");
    }
    static void RejectReparse(string file)
    {
        for (string? current = file; current != null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Umgeleitete Kingston-Dienstpfade werden nicht übernommen.");
    }
    static List<Dictionary<string, object?>> Query(string query, string[] fields, int maximum)
    {
        using var searcher = new ManagementObjectSearcher(new ManagementScope(@"\\.\root\cimv2"), new ObjectQuery(query),
            new System.Management.EnumerationOptions { Timeout = TimeSpan.FromSeconds(5), ReturnImmediately = true, Rewindable = false });
        using var rows = searcher.Get();
        var output = new List<Dictionary<string, object?>>();
        foreach (ManagementBaseObject row in rows)
        {
            using (row)
            {
                if (output.Count >= maximum) throw new IOException("Windows hat unerwartet viele Inventardatensätze geliefert.");
                var copy = new Dictionary<string, object?>();
                foreach (string field in fields) copy[field] = row[field];
                output.Add(copy);
            }
        }
        return output;
    }

    // GetExtendedTcpTable only reads the IPv4 listener owner table; it opens no network connection.
    static HashSet<uint> ReadFuryListenerOwners()
    {
        int size = 0;
        uint error = GetExtendedTcpTable(0, ref size, false, 2, 3, 0);
        for (int attempt = 0; attempt < 3; attempt++)
        {
            if (error != 122 && error != 0) throw new Win32Exception((int)error);
            if (size < 4 || size > 1024 * 1024) throw new IOException("Ungültige Größe der Windows-Verbindungstabelle.");
            nint buffer = Marshal.AllocHGlobal(size);
            try
            {
                int capacity = size;
                error = GetExtendedTcpTable(buffer, ref size, false, 2, 3, 0);
                if (error == 122) continue;
                if (error != 0) throw new Win32Exception((int)error);
                if (size < 4 || size > capacity) throw new IOException("Die Windows-Verbindungstabelle ist beschädigt.");
                var bytes = new byte[size]; Marshal.Copy(buffer, bytes, 0, size);
                return ParseFuryListenerOwners(bytes);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        throw new IOException("Die Windows-Verbindungstabelle hat sich während der Prüfung verändert.");
    }
    internal static HashSet<uint> ParseFuryListenerOwners(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 4) throw new IOException("Verbindungstabelle ist abgeschnitten.");
        uint count = BinaryPrimitives.ReadUInt32LittleEndian(bytes);
        if (count > (bytes.Length - 4) / 24) throw new IOException("Verbindungstabelle ist abgeschnitten.");
        var owners = new HashSet<uint>();
        for (int i = 0; i < count; i++)
        {
            var row = bytes.Slice(4 + i * 24, 24);
            uint state = BinaryPrimitives.ReadUInt32LittleEndian(row);
            int port = BinaryPrimitives.ReadUInt16BigEndian(row.Slice(8, 2));
            if (state == 2 && row[4] == 127 && row[5] == 0 && row[6] == 0 && row[7] == 1 && port == FuryPort)
            {
                uint pid = BinaryPrimitives.ReadUInt32LittleEndian(row.Slice(20, 4));
                if (pid > 0) owners.Add(pid);
            }
        }
        return owners;
    }
    [DllImport("iphlpapi.dll", ExactSpelling = true)]
    static extern uint GetExtendedTcpTable(nint table, ref int size, [MarshalAs(UnmanagedType.Bool)] bool order, uint family, uint tableClass, uint reserved);

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
            if (status != 0 || data.StateData == 0) throw new IOException("Die Kingston-Dateisignatur konnte nicht bestätigt werden.");
            nint provider = WTHelperProvDataFromStateData(data.StateData);
            nint signerPointer = provider != 0 ? WTHelperGetProvSignerFromChain(provider, 0, false, 0) : 0;
            if (signerPointer == 0) throw new IOException("Kein bestätigter Kingston-Unterzeichner.");
            var signer = Marshal.PtrToStructure<ProviderSigner>(signerPointer);
            if (signer.Error != 0 || signer.Certificates == 0 || signer.CertificateChain == 0) throw new IOException("Der Kingston-Unterzeichner ist nicht vertrauenswürdig.");
            var certificate = Marshal.PtrToStructure<ProviderCertificatePrefix>(signer.CertificateChain);
            if (certificate.Context == 0) throw new IOException("Das Kingston-Unterzeichnerzertifikat fehlt.");
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
        void Check(bool condition, string name) { if (!condition) throw new InvalidOperationException("Inventar-Fixture fehlgeschlagen: " + name); checks.Add(name); }
        void Reject(Action action, string name) { try { action(); } catch (IOException) { checks.Add(name); return; } throw new InvalidOperationException("Inventar-Fixture akzeptierte: " + name); }
        JsonElement Element(object value) => JsonSerializer.SerializeToElement(value, Json);
        object Call(InventoryModule module, string command) => module.Dispatch(Element(new { command }));
        int platformReads = 0, kingstonReads = 0;
        var platform = new { board = new { Manufacturer = "ASUSTeK COMPUTER INC.", Product = "ROG CROSSHAIR X870E GLACIAL" },
            system = new { PCSystemType = 1 }, chassisTypes = new[] { 3 }, prerequisites = new { administrator = false, pawnIO = true } };
        using var module = new InventoryModule(() => { platformReads++; return platform; }, () => { kingstonReads++; return new { unavailable = true }; });
        var idle = Element(Call(module, "status"));
        Check(platformReads == 0 && kingstonReads == 0 && !idle.GetProperty("platformCached").GetBoolean() && !idle.GetProperty("kingstonCached").GetBoolean(), "constructor and status have no readers");
        Call(module, "close"); Check(platformReads == 0 && kingstonReads == 0, "idle close has no readers");
        Check(ReferenceEquals(Call(module, "platform"), platform), "platform metadata returned without classification changes");
        Call(module, "platform"); Check(platformReads == 2, "explicit platform inspection is fresh");
        Check(Element(Call(module, "kingston")).GetProperty("unavailable").GetBoolean(), "unavailable sentinel preserved");
        var cached = Element(Call(module, "status"));
        Check(cached.GetProperty("platformCached").GetBoolean() && cached.GetProperty("kingstonCached").GetBoolean() && platformReads == 2 && kingstonReads == 1, "cached status never rereads OS");
        var closed = Element(Call(module, "close"));
        Check(closed.GetProperty("closed").GetBoolean() && !closed.GetProperty("platformCached").GetBoolean() && !closed.GetProperty("kingstonCached").GetBoolean(), "close clears cached metadata");
        var table = new byte[4 + 4 * 24]; BinaryPrimitives.WriteUInt32LittleEndian(table, 4);
        void Row(int index, uint state, byte[] address, int port, uint pid)
        {
            var row = table.AsSpan(4 + index * 24, 24); BinaryPrimitives.WriteUInt32LittleEndian(row, state); address.CopyTo(row.Slice(4));
            BinaryPrimitives.WriteUInt16BigEndian(row.Slice(8), (ushort)port); BinaryPrimitives.WriteUInt32LittleEndian(row.Slice(20), pid);
        }
        Row(0, 2, [127, 0, 0, 1], FuryPort, 123); Row(1, 2, [0, 0, 0, 0], FuryPort, 456);
        Row(2, 5, [127, 0, 0, 1], FuryPort, 789); Row(3, 2, [127, 0, 0, 1], 55598, 999);
        Check(ParseFuryListenerOwners(table).SetEquals([123u]), "TCP parser accepts exact IPv4 loopback listener only");
        Reject(() => ParseFuryListenerOwners(table.AsSpan(0, table.Length - 1)), "truncated TCP table rejected");
        Reject(() => ParseFuryListenerOwners([255, 255, 255, 255]), "oversized TCP row count rejected");
        string root = @"C:\Program Files", file = @"C:\Program Files\Kingston\FURYCTRL\FuryController_Service.exe";
        var proof = new KingstonProof("FuryController_Service", "\"" + file + "\"", file, 123, "20261007150000.000000+000", "Valid", "Kingston Technology Company, Inc.", "127.0.0.1", FuryPort, [root]);
        ValidateProof(proof); Check(true, "original Kingston proof accepted");
        string typoFile = @"C:\Program Files\FURYCTRL_SDK\FuryContorller_Service.exe";
        ValidateProof(proof with { ServiceName = "FuryContorller_Service", ServicePath = typoFile, ProcessPath = typoFile }); Check(true, "original misspelled service alias accepted");
        Reject(() => ValidateProof(proof with { ServiceName = "FURYCTR_SVC" }), "unverified service alias rejected");
        Reject(() => ValidateProof(proof with { Signer = "Unknown Publisher" }), "wrong signer rejected");
        Reject(() => ValidateProof(proof with { SignatureStatus = "NotSigned" }), "unsigned executable rejected");
        Reject(() => ValidateProof(proof with { ListenerAddress = "0.0.0.0" }), "wildcard listener rejected");
        Reject(() => ValidateProof(proof with { ListenerPort = 55600 }), "wrong port rejected");
        Reject(() => ValidateProof(proof with { ServicePath = "\"" + file + "\" --extra" }), "service arguments rejected");
        Reject(() => ValidateProof(proof with { ProcessPath = @"C:\Users\Batto\FuryController_Service.exe", ServicePath = @"C:\Users\Batto\FuryController_Service.exe" }), "unprotected install root rejected");
        Reject(() => ValidateProof(proof with { ProcessId = 0 }), "missing PID rejected");
        Reject(() => ValidateProof(proof with { StartTime = "" }), "missing process start rejected");
        var encoded = Element(proof);
        Check(encoded.GetProperty("startTime").ValueKind == JsonValueKind.String && encoded.GetProperty("serviceName").GetString() == proof.ServiceName
            && encoded.GetProperty("programFiles").GetArrayLength() == 1, "Kingston proof JSON matches JS inspector");
        Check(Marshal.SizeOf<TrustData>() == (IntPtr.Size == 8 ? 88 : 52) && Marshal.OffsetOf<ProviderSigner>(nameof(ProviderSigner.CertificateChain)).ToInt32() == 16,
            "WinTrust native structure alignment");
        return new { ok = true, passed = checks.Count, checks = checks.ToArray(), hardwarePackets = 0, realServiceControls = 0, childProcesses = 0 };
    }
}
