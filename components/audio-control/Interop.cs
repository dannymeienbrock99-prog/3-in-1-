using System.Runtime.InteropServices;
using System.Text;
namespace BattoAudio;

internal static class Native {
 public static readonly Guid EndpointVolume=new("5CDF2C82-841E-4546-9722-0CF74078229A"),SessionManager=new("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
 public static void Check(int hr){if(hr<0)Marshal.ThrowExceptionForHR(hr);}
 public static void Release(object? value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
 [DllImport("ole32.dll")] public static extern int PropVariantClear(ref PropVariant value);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint processId);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder name,ref uint size);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static string? ProcessPath(uint id){var handle=OpenProcess(0x1000,false,id);if(handle==IntPtr.Zero)return null;try{var value=new StringBuilder(32768);uint size=32768;return QueryFullProcessImageName(handle,0,value,ref size)?value.ToString():null;}finally{CloseHandle(handle);}}
}
[StructLayout(LayoutKind.Sequential)] internal struct PropertyKey{public Guid Format;public uint Id;}
[StructLayout(LayoutKind.Explicit,Size=24)] internal struct PropVariant{[FieldOffset(0)]public ushort Type;[FieldOffset(8)]public IntPtr Value;}
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] internal class DeviceEnumerator{}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IMMDeviceEnumerator{
 [PreserveSig]int EnumAudioEndpoints(int flow,uint mask,out IMMDeviceCollection devices);
 [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice device);
 [PreserveSig]int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IMMDevice device);
 [PreserveSig]int RegisterEndpointNotificationCallback(IntPtr client);[PreserveSig]int UnregisterEndpointNotificationCallback(IntPtr client);
}
[ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IMMDeviceCollection{
 [PreserveSig]int GetCount(out uint count);[PreserveSig]int Item(uint index,out IMMDevice device);
}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IMMDevice{
 [PreserveSig]int Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object value);
 [PreserveSig]int OpenPropertyStore(uint access,out IPropertyStore store);
 [PreserveSig]int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);[PreserveSig]int GetState(out uint state);
}
[ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IPropertyStore{
 [PreserveSig]int GetCount(out uint count);[PreserveSig]int GetAt(uint index,out PropertyKey key);
 [PreserveSig]int GetValue(ref PropertyKey key,out PropVariant value);[PreserveSig]int SetValue(ref PropertyKey key,ref PropVariant value);[PreserveSig]int Commit();
}
[ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioEndpointVolume{
 [PreserveSig]int RegisterControlChangeNotify(IntPtr notify);[PreserveSig]int UnregisterControlChangeNotify(IntPtr notify);
 [PreserveSig]int GetChannelCount(out uint channels);[PreserveSig]int SetMasterVolumeLevel(float level,ref Guid context);
 [PreserveSig]int SetMasterVolumeLevelScalar(float level,ref Guid context);[PreserveSig]int GetMasterVolumeLevel(out float level);
 [PreserveSig]int GetMasterVolumeLevelScalar(out float level);[PreserveSig]int SetChannelVolumeLevel(uint channel,float level,ref Guid context);
 [PreserveSig]int SetChannelVolumeLevelScalar(uint channel,float level,ref Guid context);[PreserveSig]int GetChannelVolumeLevel(uint channel,out float level);
 [PreserveSig]int GetChannelVolumeLevelScalar(uint channel,out float level);[PreserveSig]int SetMute([MarshalAs(UnmanagedType.Bool)]bool muted,ref Guid context);
 [PreserveSig]int GetMute([MarshalAs(UnmanagedType.Bool)]out bool muted);[PreserveSig]int GetVolumeStepInfo(out uint step,out uint count);
 [PreserveSig]int VolumeStepUp(ref Guid context);[PreserveSig]int VolumeStepDown(ref Guid context);
 [PreserveSig]int QueryHardwareSupport(out uint mask);[PreserveSig]int GetVolumeRange(out float min,out float max,out float increment);
}
[ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioSessionManager2{
 [PreserveSig]int GetAudioSessionControl(ref Guid id,uint flags,[MarshalAs(UnmanagedType.IUnknown)]out object control);
 [PreserveSig]int GetSimpleAudioVolume(ref Guid id,uint flags,out ISimpleAudioVolume volume);
 [PreserveSig]int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
}
[ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioSessionEnumerator{
 [PreserveSig]int GetCount(out int count);[PreserveSig]int GetSession(int index,[MarshalAs(UnmanagedType.IUnknown)]out object session);
}
[ComImport,Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioSessionControl2{
 [PreserveSig]int GetState(out int state);[PreserveSig]int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)]out string name);
 [PreserveSig]int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)]string name,ref Guid context);
 [PreserveSig]int GetIconPath([MarshalAs(UnmanagedType.LPWStr)]out string path);[PreserveSig]int SetIconPath([MarshalAs(UnmanagedType.LPWStr)]string path,ref Guid context);
 [PreserveSig]int GetGroupingParam(out Guid grouping);[PreserveSig]int SetGroupingParam(ref Guid grouping,ref Guid context);
 [PreserveSig]int RegisterAudioSessionNotification(IntPtr notification);[PreserveSig]int UnregisterAudioSessionNotification(IntPtr notification);
 [PreserveSig]int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string identifier);
 [PreserveSig]int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string identifier);
 [PreserveSig]int GetProcessId(out uint id);[PreserveSig]int IsSystemSoundsSession();[PreserveSig]int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)]bool optOut);
}
[ComImport,Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface ISimpleAudioVolume{
 [PreserveSig]int SetMasterVolume(float level,ref Guid context);[PreserveSig]int GetMasterVolume(out float level);
 [PreserveSig]int SetMute([MarshalAs(UnmanagedType.Bool)]bool muted,ref Guid context);[PreserveSig]int GetMute([MarshalAs(UnmanagedType.Bool)]out bool muted);
}
