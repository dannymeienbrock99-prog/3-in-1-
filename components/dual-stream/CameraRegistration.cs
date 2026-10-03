// SPDX-License-Identifier: GPL-2.0-or-later
using Microsoft.Win32;
using System.IO;

// The video reader is 64-bit. Explicit views avoid accidentally checking a stale
// 32-bit OBS entry and reporting it as the camera used by LIVE Studio.
internal sealed record CameraEntry(string? Path,string? Name,string? ClassId,bool Owned);
internal static class CameraRegistrationPolicy {
 internal static bool Ready(CameraEntry entry,string id,Func<string,bool> exists)=>
  !string.IsNullOrWhiteSpace(entry.Path)&&exists(entry.Path)&&
  !string.IsNullOrWhiteSpace(entry.Name)&&string.Equals(entry.ClassId,id,StringComparison.OrdinalIgnoreCase);
 internal static bool NeedsRepair(CameraEntry entry,string id,string dll,Func<string,bool> exists)=>
  !Ready(entry,id,exists)||entry.Owned&&!string.Equals(entry.Path,dll,StringComparison.OrdinalIgnoreCase);
}

internal static class CameraRegistration {
 const string Category="{860BB310-5D01-11D0-BD3B-00A0C911CE86}";
 static string repairError="";
 public static string Id(int slot)=>"{27B05C2D-93DC-474A-A5DA-9BBA34CB2A"+(slot==1?"9C":"9D")+"}";
 public static string Root=>Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../VirtualCam/x64"));
 static string Dll=>Path.Combine(Root,"obs-virtualsource.dll");
 static string ClassPath(int slot)=>"CLSID\\"+Id(slot);
 static string InstancePath(int slot)=>"CLSID\\"+Category+"\\Instance\\"+Id(slot);
 static RegistryKey Classes()=>RegistryKey.OpenBaseKey(RegistryHive.ClassesRoot,RegistryView.Registry64);
 static RegistryKey User()=>RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64);
 static CameraEntry Existing(int slot){
  using var classes=Classes();using var server=classes.OpenSubKey(ClassPath(slot)+"\\InprocServer32");using var instance=classes.OpenSubKey(InstancePath(slot));
  using var user=User();using var owner=user.OpenSubKey("Software\\Classes\\"+ClassPath(slot)+"\\InprocServer32");
  return new(server?.GetValue(null) as string,instance?.GetValue("FriendlyName") as string,instance?.GetValue("CLSID") as string,Equals(owner?.GetValue("BattoSuite"),1));
 }
 static bool FilesReady()=>new[]{"obs-virtualsource.dll","avutil-58.dll","swscale-7.dll"}.All(file=>File.Exists(Path.Combine(Root,file)));
 static bool ReaderFilesReady(string file)=>new[]{"obs-virtualsource.dll","avutil-58.dll","swscale-7.dll"}.All(name=>File.Exists(Path.Combine(Path.GetDirectoryName(file)!,name)));
 public static bool Ready(int slot){var entry=Existing(slot);return CameraRegistrationPolicy.Ready(entry,Id(slot),File.Exists)&&(!entry.Owned||ReaderFilesReady(entry.Path!));}
 public static string Name(int slot)=>Existing(slot).Name??(slot==1?"Batto TikTok":"Batto Twitch");
 static object SlotStatus(int slot){var ready=Ready(slot);return new{ready,name=Name(slot),error=ready?"":repairError.Length>0?repairError:"Virtuelle Kamera fehlt oder zeigt auf einen alten Installationsordner. Kameras bitte einrichten."};}
 public static object Status()=>new{tiktok=SlotStatus(1),twitch=SlotStatus(2)};
 public static void TryRepair(){try{Register();}catch(Exception e) when(e is IOException or UnauthorizedAccessException or System.Security.SecurityException or InvalidOperationException){repairError=e is InvalidOperationException?e.Message:"Virtuelle Kameras konnten nicht eingerichtet werden. Bitte unter Dual Stream erneut einrichten.";}}
 public static void Register(){
  repairError="";
  for(int slot=1;slot<=2;slot++){
   var entry=Existing(slot);
   // A moved Batto installation must follow its DLL. Valid third-party cameras
   // keep their owner/name; a broken registration is only shadowed for this user.
   if(!CameraRegistrationPolicy.NeedsRepair(entry,Id(slot),Dll,File.Exists)&&(!entry.Owned||FilesReady()))continue;
   if(!FilesReady())throw new InvalidOperationException("VirtualCam-Komponente fehlt. Bitte Installation reparieren.");
   string id=Id(slot),name=slot==1?"Batto TikTok":"Batto Twitch";
   using var user=User();
   using(var key=user.CreateSubKey("Software\\Classes\\"+ClassPath(slot)+"\\InprocServer32")){key.SetValue(null,Dll);key.SetValue("ThreadingModel","Both");key.SetValue("BattoSuite",1,RegistryValueKind.DWord);}
   using(var key=user.CreateSubKey("Software\\Classes\\"+InstancePath(slot))){key.SetValue("CLSID",id);key.SetValue("FriendlyName",name);}
  }
 }
 public static void Unregister(){
  for(int slot=1;slot<=2;slot++){
   using var user=User();var path="Software\\Classes\\"+ClassPath(slot);
   using var key=user.OpenSubKey(path+"\\InprocServer32");
   // An old installation must never unregister a newer installed copy.
   if(!Equals(key?.GetValue("BattoSuite"),1)||!string.Equals(key?.GetValue(null) as string,Dll,StringComparison.OrdinalIgnoreCase))continue;
   key?.Dispose();user.DeleteSubKeyTree(path,false);user.DeleteSubKeyTree("Software\\Classes\\"+InstancePath(slot),false);
  }
 }
}
