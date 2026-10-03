// SPDX-License-Identifier: GPL-2.0-or-later
// Pure registration policy regression checks: no real registry changes/devices.
var id="{27B05C2D-93DC-474A-A5DA-9BBA34CB2A9C}";
var installed="E:\\BattoSuite\\resources\\VirtualCam\\x64\\obs-virtualsource.dll";
var old="C:\\old-install\\obs-virtualsource.dll";
var other="C:\\OBS\\obs-virtualsource.dll";
var files=new HashSet<string>(StringComparer.OrdinalIgnoreCase){installed,other};
var tests=0;
void Check(bool condition,string message){if(!condition)throw new Exception(message);tests++;}
CameraEntry Entry(string? path,bool owned=true,string? name="Batto TikTok",string? classId=null)=>new(path,name,classId??id,owned);
bool Ready(CameraEntry e)=>CameraRegistrationPolicy.Ready(e,id,files.Contains);
bool Repair(CameraEntry e)=>CameraRegistrationPolicy.NeedsRepair(e,id,installed,files.Contains);
Check(!Ready(Entry(old)),"A deleted install path is not ready.");
Check(Repair(Entry(old)),"A moved/deleted own registration must be repaired.");
files.Add(old);
Check(Repair(Entry(old)),"A moved own camera must update even while the old copy still exists.");
Check(Ready(Entry(installed)),"The current complete registration is ready.");
Check(!Repair(Entry(installed)),"An unchanged installation must not write the registry on every probe.");
Check(!Repair(Entry(installed.ToUpperInvariant())),"Windows path case is not a move.");
Check(!Repair(Entry(other,false,"OBS-Camera")),"Preserve a working third-party camera.");
Check(Repair(Entry("C:\\removed-OBS\\source.dll",false,"OBS-Camera")),"A missing third-party reader can be shadowed by a working per-user camera.");
Check(!Ready(Entry(installed,name:"")),"A DLL alone without an enumeration name is not ready.");
Check(Repair(Entry(installed,name:"")),"Repair a missing device-category entry.");
Check(!Ready(Entry(installed,classId:Guid.Empty.ToString())),"A mismatched category CLSID is not ready.");
Check(Repair(Entry(installed,classId:Guid.Empty.ToString())),"Repair a mismatched category CLSID.");
Check(Repair(new(null,null,null,false)),"First-time installation must register both class and category.");
Console.WriteLine($"Camera registration: {tests} checks passed; no registry writes or capture.");
