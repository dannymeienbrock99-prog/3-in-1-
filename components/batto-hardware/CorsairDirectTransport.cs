using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using HidSharp;

namespace Batto.Hardware;

internal sealed record CorsairDirectIdentity(string Id, string Path, string Serial, string Name, int VendorId, int ProductId);
internal interface ICorsairDirectTransport : IDisposable
{
    CorsairDirectIdentity Identity { get; }
    IDisposable BeginTransaction();
    byte[] Exchange(byte[] command, byte[] data, ushort? dataType = null);
    bool SameIdentity();
}

internal sealed class CorsairDirectTransport : ICorsairDirectTransport
{
    readonly HidDevice device;
    readonly HidStream stream;
    readonly Mutex transactionGuard;
    public CorsairDirectIdentity Identity { get; }
    bool disposed;
    internal static bool Supported(HidDevice device) => device.VendorID == CorsairDirectProtocol.Vid && device.ProductID == CorsairDirectProtocol.Pid
        && device.GetMaxOutputReportLength() == 513 && device.GetMaxInputReportLength() is 512 or 513
        && System.Text.RegularExpressions.Regex.IsMatch(device.DevicePath, @"&mi_00(?:&|#)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
        && CorrectUsage(device.DevicePath);
    static bool CorrectUsage(string path)
    {
        using var handle = CreateFile(path, 0, 3, 0, 3, 0, 0); if (handle.IsInvalid || !HidD_GetPreparsedData(handle, out var data)) return false;
        try { return HidP_GetCaps(data, out var caps) == 0x110000 && caps.UsagePage == 0xff42 && caps.Usage == 1; }
        finally { HidD_FreePreparsedData(data); }
    }
    internal static CorsairDirectIdentity Identify(HidDevice device)
    {
        string serial = device.GetSerialNumber() ?? "", name = device.GetProductName() ?? "iCUE LINK System Hub";
        if (serial.Length is < 1 or > 120 || serial.Any(char.IsControl)) throw new IOException("Der Corsair-Hub meldet keine sichere Seriennummer.");
        string id = "corsair-link-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(device.DevicePath + "|" + serial)))[..16].ToLowerInvariant();
        return new(id, device.DevicePath, serial, name, device.VendorID, device.ProductID);
    }
    internal static CorsairDirectIdentity[] Discover()
    {
        var result = new List<CorsairDirectIdentity>();
        foreach (var device in DeviceList.Local.GetHidDevices(CorsairDirectProtocol.Vid, CorsairDirectProtocol.Pid).Take(16))
        {
            try { if (Supported(device)) result.Add(Identify(device)); } catch { }
        }
        if (result.Count > 4 || result.Select(r => r.Id).Distinct().Count() != result.Count) throw new IOException("Die Corsair-Hub-Zuordnung ist mehrdeutig.");
        return result.ToArray();
    }
    internal CorsairDirectTransport(CorsairDirectIdentity identity)
    {
        device = DeviceList.Local.GetHidDevices(CorsairDirectProtocol.Vid, CorsairDirectProtocol.Pid)
            .SingleOrDefault(candidate => string.Equals(candidate.DevicePath, identity.Path, StringComparison.OrdinalIgnoreCase))
            ?? throw new IOException("Der gewählte Corsair-Hub ist nicht mehr verbunden.");
        if (!Supported(device) || Identify(device) != identity) throw new IOException("Die Corsair-Hub-Identität hat sich verändert.");
        Identity = identity;
        transactionGuard = new Mutex(false, @"Global\CorsairLinkReadWriteGuardMutex");
        try
        {
            if (!device.TryOpen(out var opened)) throw new IOException("Der Corsair-Hub ist belegt oder nicht lesbar.");
            stream = opened; stream.ReadTimeout = 500; stream.WriteTimeout = 500;
        }
        catch { transactionGuard.Dispose(); throw; }
    }
    public bool SameIdentity()
    {
        try { return !disposed && Discover().Any(candidate => candidate == Identity); } catch { return false; }
    }
    public IDisposable BeginTransaction()
    {
        if (disposed) throw new ObjectDisposedException(nameof(CorsairDirectTransport));
        bool owned; try { owned = transactionGuard.WaitOne(500); } catch (AbandonedMutexException) { owned = true; }
        if (!owned) throw new CorsairDirectException("CORSAIR_BUSY", "Der Corsair-Hub wird gerade von einer anderen Anwendung verwendet.");
        return new Transaction(transactionGuard);
    }
    sealed class Transaction(Mutex mutex) : IDisposable
    {
        bool ended;
        public void Dispose() { if (!ended) { mutex.ReleaseMutex(); ended = true; } }
    }
    public byte[] Exchange(byte[] command, byte[] data, ushort? dataType = null)
    {
        if (disposed) throw new ObjectDisposedException(nameof(CorsairDirectTransport));
        bool locked = false;
        try
        {
            try { locked = transactionGuard.WaitOne(500); } catch (AbandonedMutexException) { locked = true; }
            if (!locked) throw new CorsairDirectException("CORSAIR_BUSY", "Eine andere Anwendung greift gerade auf den Corsair-Hub zu.");
            // Bounded drain: stale replies never count as the acknowledgement of a new command.
            int original = stream.ReadTimeout; stream.ReadTimeout = 1;
            try { for (int index = 0; index < 16; index++) { var stale = new byte[513]; try { stream.Read(stale); } catch (TimeoutException) { break; } if (index == 15) throw new IOException("Corsair-Hub liefert fremde Daten; Zugriff nicht übernommen."); } }
            finally { stream.ReadTimeout = original; }
            var packet = CorsairDirectProtocol.Packet(command, data); stream.Write(packet);
            var raw = new byte[513]; int count = stream.Read(raw, 0, raw.Length);
            // The 500 ms read timeout bounds this call. A mismatched packet fails immediately.
            return CorsairDirectProtocol.Reply(raw.AsSpan(0, count), command, dataType);
        }
        finally { if (locked) transactionGuard.ReleaseMutex(); }
    }
    public void Dispose()
    {
        if (disposed) return;
        stream.Dispose(); transactionGuard.Dispose(); disposed = true;
    }
    [StructLayout(LayoutKind.Sequential)] struct Caps
    {
        internal ushort Usage, UsagePage, InputLength, OutputLength, FeatureLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] internal ushort[] Reserved;
        internal ushort LinkNodes, InputButtons, InputValues, InputIndices, OutputButtons, OutputValues, OutputIndices, FeatureButtons, FeatureValues, FeatureIndices;
    }
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, nint security, uint creation, uint flags, nint template);
    [DllImport("hid.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool HidD_GetPreparsedData(SafeFileHandle handle, out nint data);
    [DllImport("hid.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool HidD_FreePreparsedData(nint data);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(nint data, out Caps caps);
}
