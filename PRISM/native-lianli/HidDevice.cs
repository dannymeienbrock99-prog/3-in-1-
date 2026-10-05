using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Prism.LianLi;

// Standard Windows HID access. Never replaces a driver, claims arbitrary USB
// devices or opens any device outside the two exact controller allowlists.
internal sealed class HidDevice : IDisposable
{
    internal int Vid { get; }
    internal int Pid { get; }
    internal string Product { get; }
    internal HidCaps Caps { get; }
    readonly SafeFileHandle handle;
    readonly FileStream stream;
    internal HidDevice(string path, int vid, int pid, string product, HidCaps caps)
    {
        if (!Protocol.IsEne(vid, pid) && !Protocol.IsTl(vid, pid) && !StrimerProtocol.IsController(vid,pid)) throw new ArgumentException("Controller is not allowed");
        if(StrimerProtocol.IsController(vid,pid)&&!StrimerProtocol.ValidDescriptor(path,caps))throw new ArgumentException("Strimer HID-Interface oder Reportgrößen passen nicht zur geprüften Schnittstelle.");
        Vid = vid; Pid = pid; Product = product; Caps = caps;
        handle = Native.CreateFile(path, 0xc0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        stream = new FileStream(handle, FileAccess.ReadWrite, 1024, true);
    }
    internal void Feature(byte[] data)
    {
        if (data.Length == 0 || Caps.FeatureReportByteLength < data.Length || Caps.FeatureReportByteLength > 1024) throw new IOException("Unsupported feature report size");
        var report = new byte[Caps.FeatureReportByteLength]; data.CopyTo(report, 0);
        if (!Native.HidD_SetFeature(handle, report, report.Length)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    internal byte[] Input(byte reportId, int payloadLength)
    {
        if (Caps.InputReportByteLength < payloadLength + 1 || Caps.InputReportByteLength > 1024) throw new IOException("Unsupported input report size");
        var report = new byte[Caps.InputReportByteLength]; report[0] = reportId;
        if (!Native.HidD_GetInputReport(handle, report, report.Length)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (report[0] != reportId) throw new IOException("Unexpected input report identity");
        return report.Skip(1).Take(payloadLength).ToArray();
    }
    internal async Task Output(byte[] data)
    {
        if (data.Length == 0 || Caps.OutputReportByteLength < data.Length || Caps.OutputReportByteLength > 1024) throw new IOException("Unsupported output report size");
        var report = new byte[Caps.OutputReportByteLength]; data.CopyTo(report, 0);
        using var timeout = new CancellationTokenSource(1500);
        await stream.WriteAsync(report, timeout.Token); await stream.FlushAsync(timeout.Token);
    }
    internal async Task<byte[]> TlQuery(byte command)
    {
        if (!Protocol.IsTl(Vid, Pid) || Caps.InputReportByteLength is < 64 or > 65 || Caps.OutputReportByteLength is < 64 or > 65) throw new IOException("Unsupported TL HID descriptor");
        Native.HidD_FlushQueue(handle);
        await Output(Protocol.TlPacket(command, []));
        for (int attempt = 0; attempt < 5; attempt++)
        {
            var report = new byte[Caps.InputReportByteLength];
            using var timeout = new CancellationTokenSource(1200);
            var n = await stream.ReadAsync(report, timeout.Token);
            if (n < 6) throw new IOException("Incomplete TL reply");
            if (report[0] == 1 && report[1] == command) return report.Take(n).ToArray();
        }
        throw new IOException("No matching TL reply");
    }
    internal static IEnumerable<(string Path, int Vid, int Pid, string Product, HidCaps Caps)> Enumerate()
    {
        Native.HidD_GetHidGuid(out var guid);
        var list = Native.SetupDiGetClassDevs(ref guid, null, IntPtr.Zero, 0x12);
        if (list == new IntPtr(-1)) yield break;
        try
        {
            for (uint index = 0; index < 512; index++)
            {
                var info = new InterfaceData { Size = Marshal.SizeOf<InterfaceData>() };
                if (!Native.SetupDiEnumDeviceInterfaces(list, IntPtr.Zero, ref guid, index, ref info)) break;
                Native.SetupDiGetDeviceInterfaceDetail(list, ref info, IntPtr.Zero, 0, out uint required, IntPtr.Zero);
                if (required < 8 || required > 8192) continue;
                var details = Marshal.AllocHGlobal((int)required);
                string? path = null;
                try
                {
                    Marshal.WriteInt32(details, IntPtr.Size == 8 ? 8 : 6);
                    if (Native.SetupDiGetDeviceInterfaceDetail(list, ref info, details, required, out _, IntPtr.Zero)) path = Marshal.PtrToStringUni(details + 4);
                }
                finally { Marshal.FreeHGlobal(details); }
                if (path == null || path.Length > 4096) continue;
                // The identity must already match before opening even a query handle.
                var identity = System.Text.RegularExpressions.Regex.Match(path, @"vid_([0-9a-f]{4})&pid_([0-9a-f]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                if (!identity.Success) continue;
                int vid = Convert.ToInt32(identity.Groups[1].Value, 16), pid = Convert.ToInt32(identity.Groups[2].Value, 16);
                if (!Protocol.IsEne(vid, pid) && !Protocol.IsTl(vid, pid) && !StrimerProtocol.IsController(vid,pid)) continue;
                if(StrimerProtocol.IsController(vid,pid)&&!System.Text.RegularExpressions.Regex.IsMatch(path,@"&mi_01(?:&|#)",System.Text.RegularExpressions.RegexOptions.IgnoreCase))continue;
                using var query = Native.CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                if (query.IsInvalid) continue;
                var attributes = new HidAttributes { Size = Marshal.SizeOf<HidAttributes>() };
                if (!Native.HidD_GetAttributes(query, ref attributes) || attributes.VendorId != vid || attributes.ProductId != pid) continue;
                if (!Native.HidD_GetPreparsedData(query, out var preparsed)) continue;
                HidCaps caps;
                try { if (Native.HidP_GetCaps(preparsed, out caps) != 0x110000) continue; }
                finally { Native.HidD_FreePreparsedData(preparsed); }
                if(StrimerProtocol.IsController(vid,pid)&&!StrimerProtocol.ValidDescriptor(path,caps))continue;
                var buffer = new byte[512];
                string product = Native.HidD_GetProductString(query, buffer, buffer.Length) ? System.Text.Encoding.Unicode.GetString(buffer).TrimEnd('\0') : "";
                if (System.Text.RegularExpressions.Regex.IsMatch(product, "stream[\\s_-]*deck|elgato", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) continue;
                yield return (path, vid, pid, product, caps);
            }
        }
        finally { Native.SetupDiDestroyDeviceInfoList(list); }
    }
    public void Dispose() { stream.Dispose(); handle.Dispose(); }
}

[StructLayout(LayoutKind.Sequential)] internal struct InterfaceData { public int Size; public Guid Guid; public int Flags; public IntPtr Reserved; }
[StructLayout(LayoutKind.Sequential)] internal struct HidAttributes { public int Size; public ushort VendorId, ProductId, VersionNumber; }
[StructLayout(LayoutKind.Sequential)] internal struct HidCaps
{
    public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices, NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices, NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
}
internal static class Native
{
    [DllImport("hid.dll")] internal static extern void HidD_GetHidGuid(out Guid guid);
    [DllImport("hid.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_GetAttributes(SafeFileHandle handle, ref HidAttributes attributes);
    [DllImport("hid.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_GetPreparsedData(SafeFileHandle handle, out IntPtr data);
    [DllImport("hid.dll")] [return: MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] internal static extern int HidP_GetCaps(IntPtr data, out HidCaps caps);
    [DllImport("hid.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_GetProductString(SafeFileHandle handle, byte[] buffer, int length);
    [DllImport("hid.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_SetFeature(SafeFileHandle handle, byte[] buffer, int length);
    [DllImport("hid.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_GetInputReport(SafeFileHandle handle, byte[] buffer, int length);
    [DllImport("hid.dll")] [return: MarshalAs(UnmanagedType.U1)] internal static extern bool HidD_FlushQueue(SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("setupapi.dll", EntryPoint = "SetupDiGetClassDevsW", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr SetupDiGetClassDevs(ref Guid guid, string? enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiEnumDeviceInterfaces(IntPtr list, IntPtr device, ref Guid guid, uint index, ref InterfaceData data);
    [DllImport("setupapi.dll", EntryPoint = "SetupDiGetDeviceInterfaceDetailW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr list, ref InterfaceData data, IntPtr details, uint size, out uint required, IntPtr device);
    [DllImport("setupapi.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiDestroyDeviceInfoList(IntPtr list);
}
