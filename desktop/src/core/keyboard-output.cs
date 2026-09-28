using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// Bounded output helper. It sends only to the requested foreground window and
// releases every key it pressed on completion, cancellation and focus changes.
public static class BattoKeyboardOutput {
 [StructLayout(LayoutKind.Sequential)] public struct Mouse {public int x,y;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct Keyboard {public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit)] public struct Data {[FieldOffset(0)] public Mouse mouse;[FieldOffset(0)] public Keyboard key;}
 [StructLayout(LayoutKind.Sequential)] public struct Input {public uint type;public Data data;}
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
 [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
 static bool CursorOnWindow(IntPtr window){Point point;return GetCursorPos(out point)&&GetAncestor(WindowFromPoint(point),2)==window;}
 static int Vk(string name){if(name=="Control")return 17;if(name=="Alt")return 18;if(name=="Shift")return 16;if(name=="Super")return 91;if(name=="NumPadEnter")return 13;for(int vk=0;vk<256;vk++)if(BattoPhysicalInput.Name(vk)==name)return vk;switch(name){case "LButton":return 1;case "RButton":return 2;case "MButton":return 4;case "XButton1":return 5;case "XButton2":return 6;default:return 0;}}
 public static Input Build(string name,bool up){
  var i=new Input();uint down=0,release=0,data=0;
  if(name.StartsWith("Unicode")){i.type=1;i.data.key.scan=Convert.ToUInt16(name.Substring(7),16);i.data.key.flags=4u|(up?2u:0u);return i;}
  switch(name){case "LButton":down=2;release=4;break;case "RButton":down=8;release=16;break;case "MButton":down=32;release=64;break;case "XButton1":down=128;release=256;data=1;break;case "XButton2":down=128;release=256;data=2;break;case "WheelUp":down=0x800;data=120;break;case "WheelDown":down=0x800;data=unchecked((uint)-120);break;case "WheelLeft":down=0x1000;data=unchecked((uint)-120);break;case "WheelRight":down=0x1000;data=120;break;}
  if(down!=0){i.type=0;i.data.mouse.flags=up?release:down;i.data.mouse.data=data;return i;}
  int vk=Vk(name);if(vk==0)throw new ArgumentException("Unbekannte Taste: "+name);
  i.type=1;i.data.key.vk=(ushort)vk;i.data.key.flags=up?2u:0u;
  if(name=="NumPadEnter"||name=="Super"||name=="Divide"||name=="Insert"||name=="Delete"||name=="Home"||name=="End"||name=="Prior"||name=="Next"||name=="Left"||name=="Right"||name=="Up"||name=="Down")i.data.key.flags|=1;
  return i;
 }
 public static int SendChord(string[] names,int duration,Func<Input,uint> send,Action<int> wait,Func<int> check){
  // A wheel pulse is instantaneous, so its partner keys must already be down.
  var ordered=new List<string>();foreach(string name in names)if(!name.StartsWith("Wheel"))ordered.Add(name);foreach(string name in names)if(name.StartsWith("Wheel"))ordered.Add(name);
  var pressed=new List<string>();int status=0;
  try{foreach(string name in ordered){status=check();if(status!=0)break;if(send(Build(name,false))!=1){status=10;break;}if(!name.StartsWith("Wheel"))pressed.Add(name);}
   for(int ms=0;status==0&&ms<duration;ms+=10){status=check();if(status==0)wait(Math.Min(10,duration-ms));}
   if(status==0)status=check();
  }finally{for(int n=pressed.Count-1;n>=0;n--)if(send(Build(pressed[n],true))!=1)status=10;}
  return status;
 }
 public static bool HasPhysicalConflict(IEnumerable<string[]> steps,Func<int,bool> down){
  // Never release a modifier/key which was already held by the user.
  foreach(int key in new[]{17,18,16,91,92})if(down(key))return true;
  foreach(var names in steps)foreach(string name in names){int vk=Vk(name);if(vk!=0&&down(vk))return true;}return false;
 }
 public static bool SelfTest(){
  var log=new List<Input>();int checks=0;Func<Input,uint> send=i=>{log.Add(i);return 1;};
  if(SendChord(new[]{"Control","A","B","RButton"},20,send,ms=>{},()=>0)!=0||log.Count!=8)return false;
  if(log[0].data.key.vk!=17||log[3].data.mouse.flags!=8||log[4].data.mouse.flags!=16||log[7].data.key.vk!=17||(log[7].data.key.flags&2)==0)return false;
  log.Clear();if(SendChord(new[]{"A","RButton"},20,send,ms=>{},()=>++checks==3?14:0)!=14||log.Count!=4)return false;
  if(log[2].data.mouse.flags!=16||log[3].data.key.vk!=65||(log[3].data.key.flags&2)==0)return false;
  log.Clear();if(SendChord(new[]{"WheelDown"},0,send,ms=>{},()=>0)!=0||log.Count!=1||log[0].data.mouse.data!=unchecked((uint)-120))return false;
  log.Clear();if(SendChord(new[]{"WheelUp","XButton1"},10,send,ms=>{},()=>0)!=0||log.Count!=3||log[0].data.mouse.flags!=128||log[1].data.mouse.flags!=0x800||log[2].data.mouse.flags!=256)return false;
  if(!HasPhysicalConflict(new[]{new[]{"Control","A"},new[]{"Return"}},vk=>vk==17)||!HasPhysicalConflict(new[]{new[]{"A"}},vk=>vk==65)||!HasPhysicalConflict(new[]{new[]{"A"}},vk=>vk==16)||HasPhysicalConflict(new[]{new[]{"A"}},vk=>false))return false;
  return Marshal.SizeOf(typeof(Input))==(IntPtr.Size==8?40:28);
 }
 public static int Run(string[] args){
  long deadline;int duration;if(args.Length!=7||!long.TryParse(args[2],out deadline)||!int.TryParse(args[6],out duration)||duration<10||duration>3000)return 16;
  string target=args[1],cancel=args[3],mode=args[4],value=args[5];
  var steps=new List<string[]>();bool hasMouse=false;
  if(mode=="sequence"){
   var serialized=new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<string[]>(value);if(serialized==null||serialized.Length==0||serialized.Length>200)return 16;
   foreach(string step in serialized){if(step==null)return 16;steps.Add(step.Split('+'));}
  }else if(mode=="chord")steps.Add(value.Split('+'));else return 16;
  foreach(var names in steps){if(names.Length==0||names.Length>10)return 16;foreach(string name in names){if(Build(name,false).type==0)hasMouse=true;}}
  Func<int> cancelled=()=>File.Exists(cancel)?14:DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=deadline?9:0;
  if(cancelled()!=0)return cancelled();IntPtr window=IntPtr.Zero;
  foreach(var p in Process.GetProcessesByName(target)){using(p){if(p.MainWindowHandle==IntPtr.Zero)continue;if(window!=IntPtr.Zero)return 18;window=p.MainWindowHandle;}}
  if(window==IntPtr.Zero)return 18;
  if(HasPhysicalConflict(steps,vk=>(GetAsyncKeyState(vk)&0x8000)!=0))return 11;
  if(GetForegroundWindow()!=window){SetForegroundWindow(window);for(int n=0;n<25&&GetForegroundWindow()!=window;n++){if(cancelled()!=0)return cancelled();Thread.Sleep(20);}}
  Func<int> check=()=>cancelled()!=0?cancelled():GetForegroundWindow()!=window?7:hasMouse&&!CursorOnWindow(window)?19:0;
  if(check()!=0)return check();
  if(HasPhysicalConflict(steps,vk=>(GetAsyncKeyState(vk)&0x8000)!=0))return 11;
  foreach(var names in steps){int status=SendChord(names,mode=="sequence"?Math.Min(duration,30):duration,i=>SendInput(1,new[]{i},Marshal.SizeOf(typeof(Input))),Thread.Sleep,check);if(status!=0)return status;}
  return check();
 }
}
