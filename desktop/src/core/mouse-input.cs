using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.IO;
public static class BattoMouseInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort Vk,Scan; public uint Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Data { [FieldOffset(0)] public Mouse Mouse; [FieldOffset(0)] public Keyboard Keyboard; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public Data Data; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window,ref Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code,uint mapType);
  static Input Key(int key,bool up) { var i=new Input(); i.Type=1; i.Data.Keyboard.Scan=(ushort)MapVirtualKey((uint)key,0); i.Data.Keyboard.Flags=0x0008u|(up?0x0002u:0); return i; }
  public static Input[] BuildInputs(int key) { return key==0?new[]{Event(0x0008),Event(0x0010)}:new[]{Key(key,false),Event(0x0008),Event(0x0010),Key(key,true)}; }
  static Input Event(uint flags) { var i=new Input(); i.Type=0; i.Data.Mouse.Flags=flags; return i; }
  public static int TimedClick(int key,Func<Input[],uint> send,Action<int> wait,Func<int> check,bool tap=false,int gap=600) {
    bool keyboardDown=false,mouseDown=false;int status=check();
    try {
      if(status==0&&key!=0){keyboardDown=send(new[]{Key(key,false)})==1;if(!keyboardDown)status=10;else wait(120);}
      if(status==0&&tap&&keyboardDown){if(send(new[]{Key(key,true)})==1){keyboardDown=false;if(gap>0)wait(gap);}else status=10;}
      if(status==0)status=check();
      if(status==0){mouseDown=send(new[]{Event(0x0008)})==1;if(!mouseDown)status=10;else wait(180);}
      if(status==0)status=check();
    } finally {
      var release=new System.Collections.Generic.List<Input>();
      if(mouseDown)release.Add(Event(0x0010));
      if(keyboardDown)release.Add(Key(key,true));
      if(release.Count>0&&send(release.ToArray())!=(uint)release.Count)status=10;
    }
    return status;
  }
  public static bool TestTiming() {
    var log=new System.Collections.Generic.List<string>();
    Func<Input[],uint> send=items=>{foreach(var i in items)log.Add(i.Type==1?(i.Data.Keyboard.Flags==8?"Kdown":"Kup"):(i.Data.Mouse.Flags==8?"Rdown":"Rup"));return (uint)items.Length;};
    if(TimedClick(75,send,ms=>log.Add(ms.ToString()),()=>0)!=0||String.Join(",",log)!="Kdown,120,Rdown,180,Rup,Kup")return false;
    log.Clear();
    if(TimedClick(75,send,ms=>log.Add(ms.ToString()),()=>0,true,600)!=0||String.Join(",",log)!="Kdown,120,Kup,600,Rdown,180,Rup")return false;
    log.Clear();
    if(TimedClick(75,send,ms=>log.Add(ms.ToString()),()=>0,true,0)!=0||String.Join(",",log)!="Kdown,120,Kup,Rdown,180,Rup")return false;
    log.Clear();int checks=0;
    if(TimedClick(75,send,ms=>{},()=>++checks==2?14:0)!=14||String.Join(",",log)!="Kdown,Kup")return false;
    log.Clear();
    try{TimedClick(75,send,ms=>{if(ms==180)throw new Exception("cancel");},()=>0);return false;}catch{}
    return String.Join(",",log)=="Kdown,Rdown,Rup,Kup";
  }
  public static int Click(string target,long deadline,int holdKey,string cancelPath,bool tap=false,int gap=600) {
    if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=deadline)return 9;
    if(!String.IsNullOrEmpty(cancelPath)&&File.Exists(cancelPath))return 14;
    // Match keyboard actions: select the requested game before sending any input.
    IntPtr targetWindow=IntPtr.Zero;
    foreach(var process in Process.GetProcessesByName(target)) {
      using(process) { if(process.MainWindowHandle!=IntPtr.Zero) {
        if(targetWindow!=IntPtr.Zero)return 18;
        targetWindow=process.MainWindowHandle;
      } }
    }
    if(targetWindow==IntPtr.Zero)return 18;
    if(GetForegroundWindow()!=targetWindow) {
      if(IsIconic(targetWindow))ShowWindow(targetWindow,9);
      SetForegroundWindow(targetWindow);
      for(int attempt=0;attempt<20&&GetForegroundWindow()!=targetWindow;attempt++) {
        if(!String.IsNullOrEmpty(cancelPath)&&File.Exists(cancelPath))return 14;
        if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=deadline)return 9;
        Thread.Sleep(20);
      }
      if(GetForegroundWindow()!=targetWindow)return 7;
    }
    uint pid; var window=GetForegroundWindow(); GetWindowThreadProcessId(window,out pid);
    if(pid==0)return 7;
    try { if(!String.Equals(Process.GetProcessById((int)pid).ProcessName,target,StringComparison.OrdinalIgnoreCase))return 7; } catch { return 7; }
    Point point; if(!GetCursorPos(out point))return 8;
    uint under; GetWindowThreadProcessId(WindowFromPoint(point),out under);
    if(under!=pid) {
      Rect rect; if(!GetClientRect(window,out rect)||GetForegroundWindow()!=window)return 8;
      point.X=(rect.Right-rect.Left)/2;point.Y=(rect.Bottom-rect.Top)/2;
      if(!ClientToScreen(window,ref point)||!SetCursorPos(point.X,point.Y))return 8;
      GetWindowThreadProcessId(WindowFromPoint(point),out under);if(under!=pid)return 8;
    }
    foreach(int key in new[]{1,2,4,16,17,18,91,92})if((GetAsyncKeyState(key)&0x8000)!=0)return 11;
    if(holdKey!=0&&(GetAsyncKeyState(holdKey)&0x8000)!=0)return 11;
    if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=deadline)return 9;
    if(GetForegroundWindow()!=window)return 7;
    if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+350+(tap?gap:0)>=deadline)return 9;
    return TimedClick(holdKey,inputs=>SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(Input))),Thread.Sleep,()=>{
      if(!String.IsNullOrEmpty(cancelPath)&&File.Exists(cancelPath))return 14;
      if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=deadline)return 9;
      return GetForegroundWindow()==window?0:7;
    },tap,gap);
  }
}
public class Program {
 public static int Main(string[] args) {
  if(args.Length==1&&args[0]=="--self-test")return BattoMouseInput.TestTiming()&&System.Runtime.InteropServices.Marshal.SizeOf(typeof(BattoMouseInput.Input))==(System.IntPtr.Size==8?40:28)?0:15;
  long deadline;int key,gap;
  if(args.Length!=6||!long.TryParse(args[1],out deadline)||!int.TryParse(args[2],out key)||!int.TryParse(args[5],out gap)||gap<0||gap>3000||!(key==0||key>=48&&key<=57||key>=65&&key<=90))return 16;
  try{return BattoMouseInput.Click(args[0],deadline,key,args[3],args[4]=="tap",gap);}catch{return 17;}
 }
}
