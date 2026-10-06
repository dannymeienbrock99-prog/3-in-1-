using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Prism.LianLi;

internal readonly record struct WirelessPipe(byte Id, byte Type, ushort MaximumPacketSize);

// Lian Li's radio dongles use the existing Windows WinUSB driver, not HID.
// Enumeration reads SetupAPI/registry metadata only. No driver is installed,
// interface is claimed, radio packet is sent, or device handle is opened here.
internal sealed class WinUsbDevice : IDisposable
{
    const int IoTimeoutMs = 1500;
    const int CancellationDrainMs = 500;
    const byte OutputPipe = 0x01, InputPipe = 0x81;
    internal int Vid { get; }
    internal int Pid { get; }
    internal string Product { get; }
    readonly SafeFileHandle file;
    readonly SafeWinUsbHandle usb;
    readonly SemaphoreSlim transfers = new(1, 1);
    int disposed;
    bool faulted;

    internal static bool IsSupported(int vid, int pid, bool? transmitter = null)
    {
        bool tx = vid == 0x0416 && pid == 0x8040 || vid == 0x1a86 && pid == 0xe304;
        bool rx = vid == 0x0416 && pid == 0x8041 || vid == 0x1a86 && pid == 0xe305;
        return transmitter == true ? tx : transmitter == false ? rx : tx || rx;
    }

    static readonly Regex Identity = new(@"^\\\\\?\\usb#(?<hardware>vid_(?<vid>[0-9a-f]{4})&pid_(?<pid>[0-9a-f]{4})(?:&mi_[0-9a-f]{2})?)#(?<instance>[^#\\]{1,256})#\{(?<guid>[0-9a-f-]{36})\}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    static readonly (int Vid, int Pid)[] Devices = [(0x0416, 0x8040), (0x0416, 0x8041), (0x1a86, 0xe304), (0x1a86, 0xe305)];
    static readonly Guid V1Interface = new("1D4B2365-4749-48EA-B38A-7C6FDDDD7E26");

    internal static bool AllowedHardwareKey(string key) => Devices.Any(device =>
        Regex.IsMatch(key, $@"^VID_{device.Vid:X4}&PID_{device.Pid:X4}(?:&MI_[0-9A-F]{{2}})?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));

    // All registry paths come from the allowlisted device's own USB identity.
    static bool InstalledIdentity(string path, out int vid, out int pid, out string product)
    {
        vid = pid = 0; product = "";
        if (!OperatingSystem.IsWindows()) return false;
        var identity = Identity.Match(path);
        if (!identity.Success || !Guid.TryParse(identity.Groups["guid"].Value, out _)) return false;
        vid = Convert.ToInt32(identity.Groups["vid"].Value, 16);
        pid = Convert.ToInt32(identity.Groups["pid"].Value, 16);
        if (!IsSupported(vid, pid)) return false;
        using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Enum\USB\{identity.Groups["hardware"].Value}\{identity.Groups["instance"].Value}", false);
        if (key == null || !string.Equals(key.GetValue("Service") as string, "WINUSB", StringComparison.OrdinalIgnoreCase)) return false;
        var hardwareIds = key.GetValue("HardwareID") as string[];
        string expected = $@"USB\VID_{vid:X4}&PID_{pid:X4}";
        if (hardwareIds == null || !hardwareIds.Any(id => string.Equals(id, expected, StringComparison.OrdinalIgnoreCase) || id.StartsWith(expected + "&", StringComparison.OrdinalIgnoreCase))) return false;
        product = (key.GetValue("FriendlyName") as string ?? key.GetValue("DeviceDesc") as string ?? "").Split(';').Last().Trim();
        if (product.Length > 256) product = product[..256];
        if (product.Length == 0) product = $"Lian Li Wireless {(IsSupported(vid, pid, true) ? "Sender" : "Empfänger")}";
        return true;
    }

    static IEnumerable<Guid> InterfaceGuids()
    {
        if (!OperatingSystem.IsWindows()) return [];
        var guids = new HashSet<Guid> { V1Interface };
        using var usbDevices = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\USB", false);
        foreach (var hardwareKey in (usbDevices?.GetSubKeyNames() ?? []).Take(4096).Where(AllowedHardwareKey))
        {
            using var device = usbDevices!.OpenSubKey(hardwareKey, false);
            if (device == null) continue;
            foreach (var instance in device.GetSubKeyNames().Take(128))
            {
                using var key = device.OpenSubKey(instance, false);
                if (!string.Equals(key?.GetValue("Service") as string, "WINUSB", StringComparison.OrdinalIgnoreCase)) continue;
                using var parameters = key?.OpenSubKey("Device Parameters", false);
                var values = parameters?.GetValue("DeviceInterfaceGUIDs") as string[] ?? [];
                foreach (var value in values.Take(16)) if (Guid.TryParse(value, out var guid)) guids.Add(guid);
                if (parameters?.GetValue("DeviceInterfaceGUID") is string single && Guid.TryParse(single, out var singleGuid)) guids.Add(singleGuid);
            }
        }
        return guids.Take(64);
    }

    internal static IEnumerable<(string Path, int Vid, int Pid, string Product)> Enumerate(bool transmitter)
    {
        if (!OperatingSystem.IsWindows()) return [];
        var found = new List<(string Path, int Vid, int Pid, string Product)>();
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidateGuid in InterfaceGuids())
        {
            var guid = candidateGuid;
            var list = WinUsbNative.SetupDiGetClassDevs(ref guid, null, IntPtr.Zero, 0x12);
            if (list == new IntPtr(-1)) continue;
            try
            {
                for (uint index = 0; index < 128; index++)
                {
                    var info = new WirelessInterfaceData { Size = Marshal.SizeOf<WirelessInterfaceData>() };
                    if (!WinUsbNative.SetupDiEnumDeviceInterfaces(list, IntPtr.Zero, ref guid, index, ref info)) break;
                    WinUsbNative.SetupDiGetDeviceInterfaceDetail(list, ref info, IntPtr.Zero, 0, out uint required, IntPtr.Zero);
                    if (required < 8 || required > 8192) continue;
                    var detail = Marshal.AllocHGlobal((int)required);
                    string? path = null;
                    try
                    {
                        Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                        if (WinUsbNative.SetupDiGetDeviceInterfaceDetail(list, ref info, detail, required, out _, IntPtr.Zero)) path = Marshal.PtrToStringUni(detail + 4);
                    }
                    finally { Marshal.FreeHGlobal(detail); }
                    if (path == null || path.Length > 4096 || !paths.Add(path)) continue;
                    if (!InstalledIdentity(path, out int vid, out int pid, out string product) || !IsSupported(vid, pid, transmitter)) continue;
                    found.Add((path, vid, pid, product));
                }
            }
            finally { WinUsbNative.SetupDiDestroyDeviceInfoList(list); }
        }
        return found;
    }

    // Explicit troubleshooting only: no WinUsb_Initialize, USB transfers,
    // descriptor requests, ACL changes or driver changes. Each bare handle is
    // immediately closed. A successful zero-access open is not RGB capability.
    internal static object AccessDiagnostics()
    {
        var results = new List<object>();
        foreach (var device in Enumerate(false).Concat(Enumerate(true)).DistinctBy(d => d.Path, StringComparer.OrdinalIgnoreCase).Take(8))
        {
            var checks = new List<object>(); string? security = null; int? securityError = null;
            foreach (var (name, access) in new (string Name, uint Access)[] {
                ("metadata", 0), ("readControl", 0x20000), ("read", 0x80000000), ("write", 0x40000000), ("readWrite", 0xc0000000) })
            {
                using var handle = WinUsbNative.CreateFile(device.Path, access, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
                int? error = handle.IsInvalid ? Marshal.GetLastWin32Error() : null;
                checks.Add(new { access = name, opened = !handle.IsInvalid, win32Error = error });
                if (name != "readControl" || handle.IsInvalid) continue;
                WinUsbNative.GetKernelObjectSecurity(handle, 4, null, 0, out uint required);
                if (required == 0 || required > 65536) { securityError = Marshal.GetLastWin32Error(); continue; }
                var bytes = new byte[required];
                if (!WinUsbNative.GetKernelObjectSecurity(handle, 4, bytes, required, out _)) { securityError = Marshal.GetLastWin32Error(); continue; }
                if (!WinUsbNative.ConvertSecurityDescriptorToStringSecurityDescriptor(bytes, 1, 4, out var value, out uint length)) { securityError = Marshal.GetLastWin32Error(); continue; }
                try { if (length <= 32768) security = Marshal.PtrToStringUni(value); }
                finally { WinUsbNative.LocalFree(value); }
            }
            results.Add(new { name = device.Product, vendorId = device.Vid, productId = device.Pid,
                role = IsSupported(device.Vid, device.Pid, true) ? "transmitter" : "receiver", checks, securityDescriptor = security, securityError,
                installedProperties = InstalledProperties(device.Path) });
        }
        return new { mode = "access-diagnostics", hardwarePackets = 0, devices = results };
    }

    static object InstalledProperties(string path)
    {
        // SetupAPI properties are metadata. They can describe installed policy
        // when the live device denies READ_CONTROL; absent properties are unknown.
        var identity = Identity.Match(path);
        if (!InstalledIdentity(path, out _, out _, out _) || !Guid.TryParse(identity.Groups["guid"].Value, out var guid))
            return new { error = "identity" };
        var list = WinUsbNative.SetupDiGetClassDevs(ref guid, null, IntPtr.Zero, 0x12);
        if (list == new IntPtr(-1)) return new { error = "device-list" };
        try
        {
            var info = new WirelessInterfaceData { Size = Marshal.SizeOf<WirelessInterfaceData>() };
            if (!WinUsbNative.SetupDiOpenDeviceInterface(list, path, 0, ref info)) return new { win32Error = Marshal.GetLastWin32Error() };
            WinUsbNative.SetupDiGetDeviceInterfaceDetail(list, ref info, IntPtr.Zero, 0, out uint required, IntPtr.Zero);
            if (required < 8 || required > 8192) return new { error = "detail-size" };
            var detail = Marshal.AllocHGlobal((int)required);
            var data = new WirelessDeviceInfoData { Size = Marshal.SizeOf<WirelessDeviceInfoData>() };
            try
            {
                Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                if (!WinUsbNative.SetupDiGetDeviceInterfaceDetailWithDevice(list, ref info, detail, required, out _, ref data)) return new { win32Error = Marshal.GetLastWin32Error() };
            }
            finally { Marshal.FreeHGlobal(detail); }
            byte[]? Property(uint key, out int? error)
            {
                WinUsbNative.SetupDiGetDeviceRegistryProperty(list, ref data, key, out _, null, 0, out uint size);
                if (size == 0 || size > 65536) { error = Marshal.GetLastWin32Error(); return null; }
                var bytes = new byte[size];
                if (!WinUsbNative.SetupDiGetDeviceRegistryProperty(list, ref data, key, out _, bytes, size, out uint actual)) { error = Marshal.GetLastWin32Error(); return null; }
                error = null; return actual > size ? null : bytes[..(int)actual];
            }
            // SPDRP_SECURITY (0x17) is readable binary form. The SDK marks
            // SPDRP_SECURITY_SDS (0x18) as write-only; never use it for reads.
            var securityBytes = Property(0x17, out var securityError);
            string? securityDescriptor = null;
            if (securityBytes != null)
            {
                if (!WinUsbNative.ConvertSecurityDescriptorToStringSecurityDescriptor(securityBytes, 1, 4, out var value, out uint length)) securityError = Marshal.GetLastWin32Error();
                else
                {
                    try { if (length <= 32768) securityDescriptor = Marshal.PtrToStringUni(value); }
                    finally { WinUsbNative.LocalFree(value); }
                }
            }
            var exclusive = Property(0x1a, out var exclusiveError);
            return new { securityDescriptor, securityError,
                exclusive = exclusive?.Length >= 4 ? (bool?)(BitConverter.ToUInt32(exclusive, 0) != 0) : null, exclusiveError };
        }
        finally { WinUsbNative.SetupDiDestroyDeviceInfoList(list); }
    }

    internal WinUsbDevice(string path, int vid, int pid, string product)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Lian Li Wireless benötigt Windows.");
        if (!InstalledIdentity(path, out int installedVid, out int installedPid, out _) || installedVid != vid || installedPid != pid)
            throw new IOException("Die Wireless-Schnittstelle ist nicht als bekannter WinUSB-Controller installiert. Kein Treiber wird ersetzt.");
        Vid = vid; Pid = pid; Product = product;
        file = WinUsbNative.CreateFile(path, 0xc0000000, 3, IntPtr.Zero, 3, 0x40000000, IntPtr.Zero);
        if (file.IsInvalid) { int error = Marshal.GetLastWin32Error(); file.Dispose(); throw new WirelessUsbException("open", error); }
        try
        {
            if (!WinUsbNative.WinUsb_Initialize(file, out usb!)) throw new WirelessUsbException("initialize", Marshal.GetLastWin32Error());
            try
            {
                var descriptor = new byte[18];
                if (!WinUsbNative.WinUsb_GetDescriptor(usb, 1, 0, 0, descriptor, descriptor.Length, out int descriptorLength))
                    throw new WirelessUsbException("descriptor", Marshal.GetLastWin32Error());
                if (descriptorLength != 18) throw new IOException("Der Wireless-USB-Gerätedeskriptor ist nicht vollständig.");
                if (!WinUsbNative.WinUsb_QueryInterfaceSettings(usb, 0, out var settings))
                    throw new WirelessUsbException("interface-descriptor", Marshal.GetLastWin32Error());
                if (settings.Endpoints is < 2 or > 16)
                    throw new IOException("Der Wireless-USB-Schnittstellendeskriptor ist nicht passend.");
                var pipes = new List<WirelessPipe>();
                for (byte index = 0; index < settings.Endpoints; index++)
                {
                    if (!WinUsbNative.WinUsb_QueryPipe(usb, 0, index, out var pipe)) throw new WirelessUsbException("endpoints", Marshal.GetLastWin32Error());
                    pipes.Add(new(pipe.PipeId, (byte)pipe.PipeType, pipe.MaximumPacketSize));
                }
                ValidateDescriptor(vid, pid, descriptor, pipes.ToArray(), settings.InterfaceClass, settings.SubClass, settings.Protocol);
                uint timeout = IoTimeoutMs;
                foreach (byte pipe in new[] { OutputPipe, InputPipe })
                    if (!WinUsbNative.WinUsb_SetPipePolicy(usb, pipe, 0x03, 4, ref timeout)) throw new WirelessUsbException("timeout-policy", Marshal.GetLastWin32Error());
            }
            catch { usb.Dispose(); throw; }
        }
        catch { file.Dispose(); throw; }
    }

    // Pure validation is also used by fixtures; it never calls native APIs.
    internal static void ValidateDescriptor(int vid, int pid, byte[] descriptor, WirelessPipe[] pipes, byte interfaceClass = 0xff, byte interfaceSubClass = 0, byte interfaceProtocol = 0)
    {
        if (!IsSupported(vid, pid) || descriptor.Length != 18 || descriptor[0] != 18 || descriptor[1] != 1
            || (descriptor[8] | descriptor[9] << 8) != vid || (descriptor[10] | descriptor[11] << 8) != pid
            || descriptor[17] < 1 || interfaceClass != 0xff || interfaceSubClass != 0 || interfaceProtocol != 0)
            throw new IOException("USB-Kennung und Wireless-Schnittstelle stimmen nicht überein.");
        foreach (byte id in new[] { OutputPipe, InputPipe })
        {
            var matches = pipes.Where(p => p.Id == id).ToArray();
            if (matches.Length != 1 || matches[0].Type is not (2 or 3) || matches[0].MaximumPacketSize is < 64 or > 512)
                throw new IOException("Die Wireless-Endpunkte OUT 01 und IN 81 sind nicht passend.");
        }
    }

    internal async Task WritePacket(byte[] packet, CancellationToken cancellationToken = default)
    {
        if (packet.Length != 64) throw new ArgumentException("Wireless-Pakete müssen genau 64 Bytes lang sein.", nameof(packet));
        var copy = (byte[])packet.Clone();
        var result = await Transfer(OutputPipe, copy, cancellationToken);
        if (result.Length != 64) throw new IOException("Das Wireless-Paket wurde nicht vollständig übertragen.");
    }

    // A radio reply is one full USB packet. Requesting 512 bytes can wait for
    // eight full 64-byte packets even when the command returns just one.
    // Multi-page replies are read explicitly by the protocol layer.
    internal Task<byte[]> ReadPacket(CancellationToken cancellationToken = default) => Transfer(InputPipe, new byte[64], cancellationToken);

    internal void FlushInput()
    {
        transfers.Wait();
        try
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
            if (faulted) throw new IOException("Die Wireless-Übertragung wurde unterbrochen. Bitte erneut suchen.");
            // Flush only WinUSB's cached input data. Never resets the USB pipe,
            // aborts another operation or sends a radio configuration command.
            if (!WinUsbNative.WinUsb_FlushPipe(usb, InputPipe)) throw new WirelessUsbException("flush-input", Marshal.GetLastWin32Error());
        }
        finally { transfers.Release(); }
    }

    async Task<byte[]> Transfer(byte pipe, byte[] buffer, CancellationToken cancellationToken)
    {
        await transfers.WaitAsync(cancellationToken);
        PendingTransfer? pending = null;
        try
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
            if (faulted) throw new IOException("Die Wireless-Übertragung wurde unterbrochen. Bitte erneut suchen.");
            cancellationToken.ThrowIfCancellationRequested();
            pending = new PendingTransfer(file, usb, buffer);
            bool completed = pipe == InputPipe
                ? WinUsbNative.WinUsb_ReadPipe(usb, pipe, pending.Buffer, buffer.Length, IntPtr.Zero, pending.Overlapped)
                : WinUsbNative.WinUsb_WritePipe(usb, pipe, pending.Buffer, buffer.Length, IntPtr.Zero, pending.Overlapped);
            if (!completed && Marshal.GetLastWin32Error() != 997) throw new WirelessUsbException(pipe == InputPipe ? "read" : "write", Marshal.GetLastWin32Error());
            if (!completed)
            {
                using (cancellationToken.Register(pending.Cancel))
                {
                    bool signalled = await Task.Run(() => pending.Completed.WaitOne(IoTimeoutMs));
                    if (!signalled)
                    {
                        pending.Cancel();
                        signalled = await Task.Run(() => pending.Completed.WaitOne(CancellationDrainMs));
                        if (!signalled)
                        {
                            // Keep the handles, event and buffers alive until the kernel
                            // completes cancellation. A faulty driver cannot cause use
                            // after free or block the helper's response indefinitely.
                            faulted = true; pending.DeferCleanup(); pending = null;
                            cancellationToken.ThrowIfCancellationRequested();
                            throw new TimeoutException("Die Wireless-Schnittstelle antwortet nicht rechtzeitig.");
                        }
                        cancellationToken.ThrowIfCancellationRequested();
                        throw new TimeoutException("Die Wireless-Schnittstelle antwortet nicht rechtzeitig.");
                    }
                }
            }
            if (!WinUsbNative.WinUsb_GetOverlappedResult(usb, pending.Overlapped, out uint count, false))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == 996) { faulted = true; pending.Cancel(); pending.DeferCleanup(); pending = null; }
                cancellationToken.ThrowIfCancellationRequested();
                throw new WirelessUsbException(pipe == InputPipe ? "read-result" : "write-result", error);
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (count > buffer.Length) throw new IOException("Ungültige Wireless-Antwortlänge.");
            var result = new byte[count]; Marshal.Copy(pending.Buffer, result, 0, result.Length); return result;
        }
        finally { pending?.Dispose(); transfers.Release(); }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        transfers.Wait();
        try { usb.Dispose(); file.Dispose(); }
        finally { transfers.Release(); }
    }

    sealed class PendingTransfer : IDisposable
    {
        readonly SafeFileHandle file;
        readonly SafeWinUsbHandle usb;
        readonly object lifetime = new();
        bool fileReference, usbReference;
        int cleaned;
        RegisteredWaitHandle? deferred;
        internal EventWaitHandle Completed { get; } = new(false, EventResetMode.ManualReset);
        internal IntPtr Buffer { get; }
        internal IntPtr Overlapped { get; }
        internal PendingTransfer(SafeFileHandle file, SafeWinUsbHandle usb, byte[] bytes)
        {
            this.file = file; this.usb = usb;
            try
            {
                file.DangerousAddRef(ref fileReference); usb.DangerousAddRef(ref usbReference);
                Buffer = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, Buffer, bytes.Length);
                Overlapped = Marshal.AllocHGlobal(Marshal.SizeOf<WirelessOverlapped>());
                Marshal.StructureToPtr(new WirelessOverlapped { Event = Completed.SafeWaitHandle.DangerousGetHandle() }, Overlapped, false);
            }
            catch { Dispose(); throw; }
        }
        internal void Cancel() { lock (lifetime) { if (cleaned == 0) WinUsbNative.CancelIoEx(file, Overlapped); } }
        internal void DeferCleanup() => deferred = ThreadPool.RegisterWaitForSingleObject(Completed, static (state, _) => ((PendingTransfer)state!).Dispose(), this, Timeout.Infinite, true);
        public void Dispose()
        {
            lock (lifetime)
            {
                if (cleaned != 0) return;
                cleaned = 1;
                deferred?.Unregister(null);
                if (Overlapped != IntPtr.Zero) Marshal.FreeHGlobal(Overlapped);
                if (Buffer != IntPtr.Zero) Marshal.FreeHGlobal(Buffer);
                Completed.Dispose();
                if (usbReference) usb.DangerousRelease();
                if (fileReference) file.DangerousRelease();
            }
        }
    }
}

internal sealed class SafeWinUsbHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    public SafeWinUsbHandle() : base(true) { }
    protected override bool ReleaseHandle() => WinUsbNative.WinUsb_Free(handle);
}

[StructLayout(LayoutKind.Sequential)] internal struct WirelessInterfaceData { public int Size; public Guid Guid; public int Flags; public IntPtr Reserved; }
[StructLayout(LayoutKind.Sequential)] internal struct WirelessDeviceInfoData { public int Size; public Guid Guid; public uint DevInst; public IntPtr Reserved; }
[StructLayout(LayoutKind.Sequential, Pack = 1)] internal struct WirelessInterfaceDescriptor
{
    public byte Length, DescriptorType, Number, AlternateSetting, Endpoints, InterfaceClass, SubClass, Protocol, DescriptionIndex;
}
[StructLayout(LayoutKind.Sequential)] internal struct WirelessPipeInformation { public uint PipeType; public byte PipeId; public ushort MaximumPacketSize; public byte Interval; }
[StructLayout(LayoutKind.Sequential)] internal struct WirelessOverlapped { public IntPtr Internal, InternalHigh; public uint Offset, OffsetHigh; public IntPtr Event; }

internal static class WinUsbNative
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CancelIoEx(SafeFileHandle file, IntPtr overlapped);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetKernelObjectSecurity(SafeFileHandle file, uint information, byte[]? descriptor, uint length, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(byte[] descriptor, uint revision, uint information, out IntPtr text, out uint length);
    [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_Initialize(SafeFileHandle file, out SafeWinUsbHandle handle);
    [DllImport("winusb.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_Free(IntPtr handle);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_GetDescriptor(SafeWinUsbHandle handle, byte descriptorType, byte index, ushort language, byte[] buffer, int bufferLength, out int length);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_QueryInterfaceSettings(SafeWinUsbHandle handle, byte alternate, out WirelessInterfaceDescriptor descriptor);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_QueryPipe(SafeWinUsbHandle handle, byte alternate, byte index, out WirelessPipeInformation pipe);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_SetPipePolicy(SafeWinUsbHandle handle, byte pipe, uint policy, uint length, ref uint value);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_WritePipe(SafeWinUsbHandle handle, byte pipe, IntPtr buffer, int length, IntPtr transferred, IntPtr overlapped);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_ReadPipe(SafeWinUsbHandle handle, byte pipe, IntPtr buffer, int length, IntPtr transferred, IntPtr overlapped);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_GetOverlappedResult(SafeWinUsbHandle handle, IntPtr overlapped, out uint transferred, [MarshalAs(UnmanagedType.Bool)] bool wait);
    [DllImport("winusb.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WinUsb_FlushPipe(SafeWinUsbHandle handle, byte pipe);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr SetupDiGetClassDevs(ref Guid guid, string? enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiEnumDeviceInterfaces(IntPtr list, IntPtr device, ref Guid guid, uint index, ref WirelessInterfaceData data);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr list, ref WirelessInterfaceData data, IntPtr details, uint size, out uint required, IntPtr device);
    [DllImport("setupapi.dll", EntryPoint = "SetupDiGetDeviceInterfaceDetailW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiGetDeviceInterfaceDetailWithDevice(IntPtr list, ref WirelessInterfaceData data, IntPtr details, uint size, out uint required, ref WirelessDeviceInfoData device);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiOpenDeviceInterface(IntPtr list, string path, uint flags, ref WirelessInterfaceData data);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiGetDeviceRegistryProperty(IntPtr list, ref WirelessDeviceInfoData data, uint property, out uint type, byte[]? buffer, uint size, out uint required);
    [DllImport("setupapi.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetupDiDestroyDeviceInfoList(IntPtr list);
}
