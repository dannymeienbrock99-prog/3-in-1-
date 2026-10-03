// SPDX-License-Identifier: GPL-2.0-or-later
using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;

internal sealed record CameraEntry(string? Path,string? Name,string? ClassId,bool Owned,bool HasFilterData=false,string? InstallPath=null,bool ActivationVerified=false);
internal static class CameraRegistrationPolicy {
 internal static bool Ready(CameraEntry entry,string id,Func<string,bool> exists)=>
  !string.IsNullOrWhiteSpace(entry.Path)&&exists(entry.Path)&&
  !string.IsNullOrWhiteSpace(entry.Name)&&string.Equals(entry.ClassId,id,StringComparison.OrdinalIgnoreCase);
 internal static bool NeedsRepair(CameraEntry entry,string id,string dll,Func<string,bool> exists)=>
  !Ready(entry,id,exists)||entry.Owned&&(!string.Equals(entry.Path,dll,StringComparison.OrdinalIgnoreCase)||!entry.HasFilterData);
 internal static bool SystemReady(CameraEntry entry,string id,string dll,Func<string,bool> exists)=>
  entry.Owned&&entry.HasFilterData&&entry.ActivationVerified&&Ready(entry,id,exists)&&string.Equals(entry.Path,dll,StringComparison.OrdinalIgnoreCase);
 internal static bool CanRegisterSystem(CameraEntry entry,string id,Func<string,bool> exists)=>entry.Owned||!Ready(entry,id,exists);
 internal static bool CanUnregister(CameraEntry entry,string dll,string installPath)=>
  entry.Owned&&string.Equals(entry.Path,dll,StringComparison.OrdinalIgnoreCase)&&string.Equals(entry.InstallPath,installPath,StringComparison.OrdinalIgnoreCase);
}

// Windows serializes the DirectShow metadata in memory, without registering any
// extra cameras/audio devices or writing through the merged HKCR registry view.
internal static class CameraFilterData {
 [StructLayout(LayoutKind.Sequential)] struct Filter {public uint Version,Merit,Pins;public nint Pin;}
 [StructLayout(LayoutKind.Sequential)] struct Pin {public uint Flags,Instances,Types;public nint Type;public uint Mediums;public nint Medium,Category;}
 [StructLayout(LayoutKind.Sequential)] struct MediaType {public nint Major,Minor;}
 [ComImport,Guid("97F7C4D4-547B-4A5F-8332-536430AD2E4D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IFilterData {
  [PreserveSig] int ParseFilterData(nint data,uint length,out nint filter);
  [PreserveSig] int CreateFilterData(ref Filter filter,out nint data,out uint length);
 }
 internal static byte[] Create(){
  var allocated=new List<nint>();object? mapper=null;nint bytes=0;
  nint Alloc<T>(T value)where T:struct{var p=Marshal.AllocCoTaskMem(Marshal.SizeOf<T>());allocated.Add(p);Marshal.StructureToPtr(value,p,false);return p;}
  try{
   var type=new MediaType{Major=Alloc(new Guid("73646976-0000-0010-8000-00AA00389B71")),Minor=Alloc(new Guid("32595559-0000-0010-8000-00AA00389B71"))};
   var pin=new Pin{Flags=8,Instances=1,Types=1,Type=Alloc(type)}; // One Video / YUY2 output pin.
   var filter=new Filter{Version=2,Merit=0x200000,Pins=1,Pin=Alloc(pin)};
   mapper=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("CDA42200-BD88-11D0-BD4E-00A0C911CE86"),true)!)!;
   Marshal.ThrowExceptionForHR(((IFilterData)mapper).CreateFilterData(ref filter,out bytes,out var length));
   if(bytes==0||length<32||length>4096)throw new InvalidOperationException("Windows konnte die Kameradaten nicht erstellen.");
   var result=new byte[length];Marshal.Copy(bytes,result,0,result.Length);return result;
  }finally{if(bytes!=0)Marshal.FreeCoTaskMem(bytes);foreach(var p in allocated)Marshal.FreeCoTaskMem(p);if(mapper!=null&&Marshal.IsComObject(mapper))Marshal.FinalReleaseComObject(mapper);}
 }
}

internal static class CameraRegistration {
 const string Category="{860BB310-5D01-11D0-BD3B-00A0C911CE86}";
 const string ClassesPrefix="Software\\Classes\\";
 static readonly string[] ReaderFiles={"obs-virtualsource.dll","avutil-58.dll","swscale-7.dll"};
 static string repairError="";
 public static string Id(int slot)=>"{27B05C2D-93DC-474A-A5DA-9BBA34CB2A"+(slot==1?"9C":"9D")+"}";
 public static string Root=>Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../VirtualCam/x64"));
 public static string SystemRoot=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonProgramFiles),"CrazyBatto","VirtualCam","x64");
 static string Dll=>Path.Combine(Root,ReaderFiles[0]);
 static string SystemDll=>Path.Combine(SystemRoot,ReaderFiles[0]);
 static string InstallPath=>Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
 static string ClassPath(int slot)=>ClassesPrefix+"CLSID\\"+Id(slot);
 static string InstancePath(int slot)=>ClassesPrefix+"CLSID\\"+Category+"\\Instance\\"+Id(slot);
 static RegistryKey Hive(bool system)=>RegistryKey.OpenBaseKey(system?RegistryHive.LocalMachine:RegistryHive.CurrentUser,RegistryView.Registry64);
 static CameraEntry Read(RegistryKey hive,string classPath,string instancePath){
  using var server=hive.OpenSubKey(classPath+"\\InprocServer32");using var instance=hive.OpenSubKey(instancePath);
  return new(server?.GetValue(null) as string,instance?.GetValue("FriendlyName") as string,instance?.GetValue("CLSID") as string,
   Equals(server?.GetValue("BattoSuite"),1),instance?.GetValue("FilterData") is byte[] data&&data.Length>=32,server?.GetValue("BattoInstallPath") as string,Equals(server?.GetValue("ActivationVerified"),1));
 }
 static CameraEntry Existing(int slot,bool system){using var hive=Hive(system);return Read(hive,ClassPath(slot),InstancePath(slot));}
 static CameraEntry Merged(int slot){
  using var classes=RegistryKey.OpenBaseKey(RegistryHive.ClassesRoot,RegistryView.Registry64);
  return Read(classes,ClassPath(slot)[ClassesPrefix.Length..],InstancePath(slot)[ClassesPrefix.Length..]);
 }
 static bool ReaderFilesReady(string directory)=>ReaderFiles.All(file=>File.Exists(Path.Combine(directory,file)));
 public static bool Ready(int slot)=>CameraRegistrationPolicy.SystemReady(Existing(slot,true),Id(slot),SystemDll,File.Exists)&&ReaderFilesReady(SystemRoot);
 static bool UserReady(int slot){var entry=Merged(slot);return CameraRegistrationPolicy.Ready(entry,Id(slot),File.Exists)&&(!entry.Owned||ReaderFilesReady(Path.GetDirectoryName(entry.Path!)!));}
 public static string Name(int slot)=>Ready(slot)?Existing(slot,true).Name!:(Merged(slot).Name??(slot==1?"Batto TikTok":"Batto Twitch"));
 static object SlotStatus(int slot){var ready=Ready(slot);return new{ready,systemReady=ready,userReady=UserReady(slot),name=Name(slot),error=ready?"":repairError.Length>0?repairError:"Kameras für LIVE Studio noch nicht systemweit eingerichtet. Bitte Kameras einrichten und die Windows-Abfrage bestätigen."};}
 public static object Status()=>new{tiktok=SlotStatus(1),twitch=SlotStatus(2)};
 public static void TryRepair(){try{Register();}catch(Exception e) when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or InvalidOperationException or COMException){repairError=e is InvalidOperationException?e.Message:"Virtuelle Kameras konnten nicht eingerichtet werden. Bitte unter Dual Stream erneut einrichten.";}}
 static void Write(int slot,bool system,string dll,byte[] data){
  using var hive=Hive(system);string name=slot==1?"Batto TikTok":"Batto Twitch";
  using(var key=hive.CreateSubKey(ClassPath(slot)+"\\InprocServer32")){if(system)key.SetValue("ActivationVerified",0,RegistryValueKind.DWord);key.SetValue(null,dll);key.SetValue("ThreadingModel","Both");key.SetValue("BattoSuite",1,RegistryValueKind.DWord);key.SetValue("BattoInstallPath",InstallPath);}
  using(var key=hive.CreateSubKey(InstancePath(slot))){key.SetValue("CLSID",Id(slot));key.SetValue("FriendlyName",name);key.SetValue("FilterData",data,RegistryValueKind.Binary);}
 }
 public static void Register(){
  repairError="";byte[]? data=null;
  for(int slot=1;slot<=2;slot++){
   var entry=Merged(slot);
   if(!CameraRegistrationPolicy.NeedsRepair(entry,Id(slot),Dll,File.Exists)&&(!entry.Owned||ReaderFilesReady(Root)))continue;
   if(!ReaderFilesReady(Root))throw new InvalidOperationException("VirtualCam-Komponente fehlt. Bitte Installation reparieren.");
   Write(slot,false,Dll,data??=CameraFilterData.Create());
  }
 }
 static bool IsAdministrator()=>new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
 static void RequireAdministrator(){if(!IsAdministrator())throw new InvalidOperationException("Die systemweite Kameraeinrichtung benötigt einmalig die Windows-Administratorbestätigung.");}
 static bool SameFile(string source,string target){if(!File.Exists(target))return false;using var a=File.OpenRead(source);using var b=File.OpenRead(target);return SHA256.HashData(a).AsSpan().SequenceEqual(SHA256.HashData(b));}
 static bool SystemCurrent()=>ReaderFilesReady(Root)&&Enumerable.Range(1,2).All(slot=>Ready(slot)&&string.Equals(Existing(slot,true).InstallPath,InstallPath,StringComparison.OrdinalIgnoreCase))&&ReaderFiles.All(file=>SameFile(Path.Combine(Root,file),Path.Combine(SystemRoot,file)));
 static void InstallReader(){
  if(!ReaderFilesReady(Root))throw new InvalidOperationException("VirtualCam-Komponente fehlt. Bitte Installation reparieren.");
  // CommonProgramFiles inherits protected Windows ACLs; a privileged consumer
  // must never load the machine COM server from a user-writable app directory.
  Directory.CreateDirectory(SystemRoot);
  var changed=ReaderFiles.Where(file=>!SameFile(Path.Combine(Root,file),Path.Combine(SystemRoot,file))).ToArray();
  try{
   foreach(var file in changed){var target=Path.Combine(SystemRoot,file);if(File.Exists(target)){using var probe=new FileStream(target,FileMode.Open,FileAccess.ReadWrite,FileShare.None);}}
  }catch(IOException){throw new InvalidOperationException("Die Kameradateien werden noch verwendet. Bitte LIVE Studio und andere Kamera-Programme schließen und erneut einrichten.");}
  foreach(var file in changed)File.Copy(Path.Combine(Root,file),Path.Combine(SystemRoot,file),true);
 }
 static void VerifyActivation(int slot){
  object? camera=null;
  try{camera=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid(Id(slot)),true)!)!;}
  catch(COMException e){throw new InvalidOperationException($"Windows konnte {Name(slot)} aus {SystemDll} nicht laden (COM 0x{e.HResult:X8}). Bitte Kameraeinrichtung reparieren.",e);}
  finally{if(camera!=null&&Marshal.IsComObject(camera))Marshal.FinalReleaseComObject(camera);}
 }
 sealed record SetupResult(Guid RequestId,bool Success,string? Error);
 static string SetupResultPath=>Path.Combine(SystemRoot,"last-setup.json");
 static void WriteSetupResult(Guid? requestId,bool success,string? error){
  if(requestId==null)return;
  try{Directory.CreateDirectory(SystemRoot);File.WriteAllText(SetupResultPath,JsonSerializer.Serialize(new SetupResult(requestId.Value,success,error)));}
  catch(Exception e)when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException){/* The parent retains a clear generic fallback. */}
 }
 static string? ReadSetupError(Guid requestId){
  try{var result=JsonSerializer.Deserialize<SetupResult>(File.ReadAllText(SetupResultPath));return result?.RequestId==requestId&&!result.Success?result.Error:null;}
  catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException or System.Security.SecurityException){return null;}
 }
 public static void RegisterSystem(string? resultId=null){
  Guid? requestId=null;if(resultId!=null){if(!Guid.TryParseExact(resultId,"D",out var id))throw new InvalidOperationException("Ungültige Kameraeinrichtung-Anfrage.");requestId=id;}
  RequireAdministrator();
  try{
   for(int slot=1;slot<=2;slot++)if(!CameraRegistrationPolicy.CanRegisterSystem(Existing(slot,true),Id(slot),File.Exists))
    throw new InvalidOperationException("Ein anderes Programm belegt diesen virtuellen Kamera-Anschluss. Dessen Kameraeinrichtung bleibt unverändert.");
   var data=CameraFilterData.Create();InstallReader();for(int slot=1;slot<=2;slot++)Write(slot,true,SystemDll,data);
   VerifyActivation(1);VerifyActivation(2);
   // Publish readiness only after both elevated COM activations succeeded.
   for(int slot=1;slot<=2;slot++){using var hive=Hive(true);using var key=hive.OpenSubKey(ClassPath(slot)+"\\InprocServer32",true)!;key.SetValue("ActivationVerified",1,RegistryValueKind.DWord);}
   if(!Ready(1)||!Ready(2))throw new InvalidOperationException("Die Windows-Kameraeinrichtung konnte nicht bestätigt werden.");
   WriteSetupResult(requestId,true,null);
  }catch(Exception e){WriteSetupResult(requestId,false,e.Message);throw;}
 }
 public static void Setup(){
  Register();if(SystemCurrent())return;if(IsAdministrator()){RegisterSystem();return;}
  try{
   var requestId=Guid.NewGuid();
   using var child=Process.Start(new ProcessStartInfo{FileName=Environment.ProcessPath??throw new InvalidOperationException("Kameraeinrichtung konnte nicht gestartet werden."),Arguments="--register-cameras-system "+requestId.ToString("D"),UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden});
   if(child==null)throw new InvalidOperationException("Kameraeinrichtung konnte nicht gestartet werden.");
   if(!child.WaitForExit(180000))throw new InvalidOperationException("Die Windows-Kameraeinrichtung ist noch nicht abgeschlossen. Bitte die Windows-Abfrage prüfen und danach erneut einrichten.");
   if(child.ExitCode!=0||!SystemCurrent())throw new InvalidOperationException(ReadSetupError(requestId)??"Die systemweite Kameraeinrichtung wurde nicht abgeschlossen. Bitte LIVE Studio schließen und Kameras erneut einrichten.");
  }catch(Win32Exception e)when(e.NativeErrorCode==1223){throw new InvalidOperationException("Kameraeinrichtung abgebrochen: Die Windows-Administratorbestätigung wurde nicht erteilt. Die Kameras sind für LIVE Studio noch nicht eingerichtet.");}
 }
 public static void Unregister(bool system=false){
  if(system)RequireAdministrator();
  for(int slot=1;slot<=2;slot++){
   var entry=Existing(slot,system);var dll=system?SystemDll:Dll;
   // Old per-user entries had no install marker; machine removal always requires
   // the exact install owner, so an old uninstaller cannot remove a newer copy.
   bool owned=CameraRegistrationPolicy.CanUnregister(entry,dll,InstallPath)||!system&&entry.Owned&&entry.InstallPath==null&&string.Equals(entry.Path,Dll,StringComparison.OrdinalIgnoreCase);
   if(!owned)continue;using var hive=Hive(system);hive.DeleteSubKeyTree(ClassPath(slot),false);hive.DeleteSubKeyTree(InstancePath(slot),false);
  }
 }
}
