using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Physical input listener only. It never injects keyboard or mouse events.
public static class BattoPhysicalInput {
 delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int type,Hook callback,IntPtr module,uint thread);
 [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
 [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
 [DllImport("kernel32.dll",CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [StructLayout(LayoutKind.Sequential)] struct Kbd { public uint vk,scan,flags,time;public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y;public uint data,flags,time;public UIntPtr extra; }
 public sealed class Rule { public string id,key,scope,triggerMode;public string[] keys;public int modifierMask,debounceMs;public bool passthrough=true; }
 public sealed class Command { public string type,id;public int appPid;public Rule[] rules; }
 sealed class Held { public Rule rule;public long last;public bool block; }
 static IntPtr keyboard,mouse;
 static readonly Hook keyboardCallback=Keyboard,mouseCallback=MouseEvent;
 static readonly Dictionary<string,Held> held=new Dictionary<string,Held>();
 static readonly Dictionary<string,Held> matches=new Dictionary<string,Held>();
 static readonly HashSet<string> captureKeys=new HashSet<string>();static int captureModifiers;
 static readonly Dictionary<int,bool> modifierHeld=new Dictionary<int,bool>();static readonly HashSet<int> blockedModifiers=new HashSet<int>();
 static readonly BlockingCollection<object> output=new BlockingCollection<object>(1024);
 static readonly object gate=new object();
 static Rule[] rules=new Rule[0];static string capture;static int appPid;static bool active=true;
 static ApplicationContext context;
 static void Emit(object value){output.TryAdd(value);}
 static bool IsDown(int key){return (GetAsyncKeyState(key)&0x8000)!=0;}
 static Func<int,bool> readKeyDown=IsDown;
 static bool ModifierDown(int key){bool down;return modifierHeld.TryGetValue(key,out down)?down:readKeyDown(key);}
 static int Modifiers(){return ((ModifierDown(162)||ModifierDown(163))?1:0)|((ModifierDown(164)||ModifierDown(165))?2:0)|((ModifierDown(160)||ModifierDown(161))?4:0)|((ModifierDown(91)||ModifierDown(92))?8:0);}
 static bool AppForeground(){uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);return appPid>0&&pid==(uint)appPid;}
 static Func<int> readModifiers=Modifiers; static Func<bool> appForeground=AppForeground;
 static bool Scope(Rule rule){return rule.scope!="app"||appForeground();}
 static long Now(){return Stopwatch.GetTimestamp()*1000/Stopwatch.Frequency;}
 public static string Name(int vk){
  if(vk>=65&&vk<=90)return ((char)vk).ToString();if(vk>=48&&vk<=57)return ((char)vk).ToString();
  if(vk>=112&&vk<=135)return "F"+(vk-111);if(vk>=96&&vk<=105)return "NumPad"+(vk-96);
  if(vk==16||vk==17||vk==18||vk==91||vk==92||vk>=160&&vk<=165)return null;
  switch(vk){case 8:return "Back";case 9:return "Tab";case 13:return "Return";case 27:return "Escape";case 32:return "Space";case 33:return "Prior";case 34:return "Next";case 35:return "End";case 36:return "Home";case 37:return "Left";case 38:return "Up";case 39:return "Right";case 40:return "Down";case 45:return "Insert";case 46:return "Delete";case 106:return "Multiply";case 107:return "Add";case 109:return "Subtract";case 110:return "Decimal";case 111:return "Divide";case 186:return "Oem1";case 187:return "Oemplus";case 188:return "Oemcomma";case 189:return "OemMinus";case 190:return "OemPeriod";case 191:return "OemQuestion";case 192:return "Oemtilde";case 219:return "OemOpenBrackets";case 220:return "Oem5";case 221:return "Oem6";case 222:return "Oem7";case 226:return "OemBackslash";default:return null;}
 }
 static string Combination(string key,int mods){return ((mods&1)!=0?"Control+":"")+((mods&2)!=0?"Alt+":"")+((mods&4)!=0?"Shift+":"")+((mods&8)!=0?"Super+":"")+key;}
 static string[] KeysOf(Rule r){return r.keys!=null&&r.keys.Length>0?r.keys:new[]{r.key};}
 static bool Matches(Rule r,int mods,string wheel=null){if(!Scope(r)||r.modifierMask!=mods)return false;foreach(string k in KeysOf(r))if(k!=wheel&&!held.ContainsKey(k))return false;return true;}
 static void EndReleased(int mods){var remove=new List<string>();foreach(var item in matches){if(!Matches(item.Value.rule,mods)){if(item.Value.rule.triggerMode=="up"&&Scope(item.Value.rule))Emit(new{type="trigger",id=item.Key});remove.Add(item.Key);}}foreach(string id in remove)matches.Remove(id);}
 static void BeginCapture(string id){capture=id;captureKeys.Clear();captureModifiers=0;matches.Clear();foreach(var h in held.Values)h.rule=null;}
 static void FinishCapture(){if(capture==null||captureKeys.Count==0)return;var list=new List<string>(captureKeys);list.Sort(StringComparer.Ordinal);string id=capture;capture=null;Emit(new{type="capture",id,ok=true,accelerator=Combination(String.Join("+",list),captureModifiers)});captureKeys.Clear();}
 static bool Handle(string key,bool up,bool wheel){
  if(key==null)return false;lock(gate){
   Held previous;int mods=readModifiers();
   if(up){bool blocked=held.TryGetValue(key,out previous)&&previous.block;held.Remove(key);if(capture!=null){if(held.Count==0)FinishCapture();return blocked;}EndReleased(mods);return blocked;}
   if(capture!=null){if(!wheel)held[key]=new Held();captureKeys.Add(key);captureModifiers|=mods;if(wheel&&held.Count==0)FinishCapture();return false;}
   if(!wheel&&held.TryGetValue(key,out previous))return previous.block;
   if(!wheel)held[key]=new Held();EndReleased(mods);
   Rule match=null;foreach(var r in rules){if(Array.IndexOf(KeysOf(r),key)<0||!Matches(r,mods,wheel?key:null))continue;if(match==null||KeysOf(r).Length>KeysOf(match).Length||KeysOf(r).Length==KeysOf(match).Length&&r.scope=="app")match=r;}
   if(match==null)return false;
   if(!wheel){held[key].block=!match.passthrough;if(matches.ContainsKey(match.id))return held[key].block;matches[match.id]=new Held{rule=match,last=Now()};}
   if(match.triggerMode!="up")Emit(new{type="trigger",id=match.id});
   return !match.passthrough;
  }
 }
 static bool ModifierChanged(Kbd input,bool up){
  int vk=(int)input.vk;if(vk==17)vk=(input.flags&1)!=0?163:162;if(vk==18)vk=(input.flags&1)!=0?165:164;if(vk==16)vk=input.scan==54?161:160;
  int mask=vk==162||vk==163?1:vk==164||vk==165?2:vk==160||vk==161?4:vk==91||vk==92?8:0;if(mask==0)return false;
  lock(gate){bool blocked=blockedModifiers.Contains(vk);bool previous;bool repeat=!up&&modifierHeld.TryGetValue(vk,out previous)&&previous;modifierHeld[vk]=!up;
   if(up)blockedModifiers.Remove(vk);int mods=readModifiers();
   if(capture!=null){captureModifiers|=mods;return blocked;}EndReleased(mods);if(up||repeat)return blocked;
   Rule match=null;foreach(var r in rules)if(Matches(r,mods)&&(match==null||KeysOf(r).Length>KeysOf(match).Length||KeysOf(r).Length==KeysOf(match).Length&&r.scope=="app"))match=r;
   if(match!=null){if(!matches.ContainsKey(match.id)){matches[match.id]=new Held{rule=match,last=Now()};if(match.triggerMode!="up")Emit(new{type="trigger",id=match.id});}if(!match.passthrough){blockedModifiers.Add(vk);blocked=true;}}
   return blocked;
  }
 }
 static string KeyboardName(Kbd input){
  bool extended=(input.flags&1)!=0;int vk=(int)input.vk;
  if(vk==13&&extended)return "NumPadEnter";
  if(!extended){switch(vk){case 45:return "NumPad0";case 35:return "NumPad1";case 40:return "NumPad2";case 34:return "NumPad3";case 37:return "NumPad4";case 12:return "NumPad5";case 39:return "NumPad6";case 36:return "NumPad7";case 38:return "NumPad8";case 33:return "NumPad9";case 46:return "Decimal";}}
  return Name(vk);
 }
 static IntPtr Keyboard(int code,IntPtr message,IntPtr data){
  if(code>=0&&active){var input=(Kbd)Marshal.PtrToStructure(data,typeof(Kbd));if((input.flags&0x10)==0){int msg=message.ToInt32();if(msg==0x100||msg==0x104||msg==0x101||msg==0x105){bool up=msg==0x101||msg==0x105;string name=KeyboardName(input);if(name==null){if(ModifierChanged(input,up))return (IntPtr)1;}else if(Handle(name,up,false))return (IntPtr)1;}}}
  return CallNextHookEx(keyboard,code,message,data);
 }
 static IntPtr MouseEvent(int code,IntPtr message,IntPtr data){
  if(code>=0&&active){var input=(Mouse)Marshal.PtrToStructure(data,typeof(Mouse));if((input.flags&1)==0){string key=null;bool up=false,wheel=false;switch(message.ToInt32()){
    case 0x201:key="LButton";break;case 0x202:key="LButton";up=true;break;case 0x204:key="RButton";break;case 0x205:key="RButton";up=true;break;
    case 0x207:key="MButton";break;case 0x208:key="MButton";up=true;break;case 0x20b:key=((input.data>>16)&0xffff)==1?"XButton1":"XButton2";break;case 0x20c:key=((input.data>>16)&0xffff)==1?"XButton1":"XButton2";up=true;break;
    case 0x20a:key=unchecked((short)(input.data>>16))>0?"WheelUp":"WheelDown";wheel=true;break;case 0x20e:key=unchecked((short)(input.data>>16))>0?"WheelRight":"WheelLeft";wheel=true;break;
   }if(key!=null&&Handle(key,up,wheel))return (IntPtr)1;}}
  return CallNextHookEx(mouse,code,message,data);
 }
 static void Repeat(){lock(gate){if(capture!=null)return;long now=Now();EndReleased(readModifiers());foreach(var item in matches.Values){var r=item.rule;if(r.triggerMode=="repeat"&&Matches(r,readModifiers())&&now-item.last>=Math.Max(50,r.debounceMs)){item.last=now;Emit(new{type="trigger",id=r.id});}}}}
 static void ReadCommands(){var serializer=new JavaScriptSerializer();try{string line;while((line=Console.ReadLine())!=null){Command command;try{command=serializer.Deserialize<Command>(line);}catch{continue;}
   lock(gate){if(command.type=="configure"){rules=command.rules??new Rule[0];appPid=command.appPid;foreach(var h in held.Values)h.rule=null;matches.Clear();captureKeys.Clear();capture=null;Emit(new{id=command.id,ok=true});}
   else if(command.type=="capture"){BeginCapture(command.id);}
   else if(command.type=="cancelCapture"){capture=null;captureKeys.Clear();}
   else if(command.type=="stop")break;}
  }}finally{active=false;context.ExitThread();}}
 public static bool SelfTest(){
  if(Name(65)!="A"||Name(112)!="F1"||Name(96)!="NumPad0"||Name(17)!=null||Combination("XButton1",3)!="Control+Alt+XButton1")return false;
  readModifiers=()=>1;appForeground=()=>true;object value;
  rules=new[]{new Rule{id="single",key="RButton",modifierMask=1,scope="global",passthrough=false,triggerMode="down",debounceMs=50}};
  if(!Handle("RButton",false,false)||output.Count!=1)return false;
  if(!Handle("RButton",false,false)||output.Count!=1)return false;
  readModifiers=()=>0;if(!Handle("RButton",true,false))return false;output.TryTake(out value);
  rules=new[]{new Rule{id="chord",keys=new[]{"K","RButton"},modifierMask=0,scope="global",passthrough=false,triggerMode="down",debounceMs=50}};
  if(Handle("K",false,false)||output.Count!=0)return false;
  if(!Handle("RButton",false,false)||output.Count!=1)return false;
  if(!Handle("RButton",false,false)||output.Count!=1)return false;
  if(Handle("K",true,false)||!Handle("RButton",true,false))return false;output.TryTake(out value);
  rules[0].triggerMode="up";Handle("RButton",false,false);Handle("K",false,false);if(output.Count!=0)return false;Handle("RButton",true,false);if(output.Count!=1)return false;Handle("K",true,false);output.TryTake(out value);
  rules[0].triggerMode="repeat";Handle("K",false,false);Handle("RButton",false,false);output.TryTake(out value);matches["chord"].last=0;Repeat();if(output.Count!=1)return false;output.TryTake(out value);Handle("K",true,false);Repeat();if(output.Count!=0)return false;Handle("RButton",true,false);
  BeginCapture("capture-test");Handle("K",false,false);if(output.Count!=0||capture==null)return false;Handle("RButton",false,false);if(output.Count!=0)return false;Handle("K",true,false);if(output.Count!=0)return false;Handle("RButton",true,false);if(output.Count!=1)return false;output.TryTake(out value);var json=new JavaScriptSerializer().Serialize(value);if(!json.Contains("K+RButton")||!json.Contains("capture-test"))return false;
  BeginCapture("wheel-test");Handle("WheelUp",false,true);if(output.Count!=1)return false;output.TryTake(out value);
  rules[0].scope="app";appForeground=()=>false;Handle("K",false,false);Handle("RButton",false,false);if(output.Count!=0)return false;Handle("K",true,false);Handle("RButton",true,false);
  readModifiers=Modifiers;readKeyDown=vk=>false;appForeground=()=>true;modifierHeld.Clear();blockedModifiers.Clear();
  rules=new[]{new Rule{id="ctrl",keys=new[]{"A"},modifierMask=1,scope="global",passthrough=false,triggerMode="up",debounceMs=50}};
  Handle("A",false,false);if(!ModifierChanged(new Kbd{vk=162},false))return false;
  if(!ModifierChanged(new Kbd{vk=163},false))return false;if(ModifierChanged(new Kbd{vk=162},true)!=true||output.Count!=0||!matches.ContainsKey("ctrl"))return false;
  if(!ModifierChanged(new Kbd{vk=163},true)||output.Count!=1||matches.Count!=0)return false;output.TryTake(out value);Handle("A",true,false);
  rules[0].triggerMode="down";Handle("A",false,false);if(!ModifierChanged(new Kbd{vk=17},false)||output.Count!=1)return false;output.TryTake(out value);
  if(!ModifierChanged(new Kbd{vk=17},false)||output.Count!=0||!ModifierChanged(new Kbd{vk=17},true))return false;Handle("A",true,false);
  modifierHeld.Clear();blockedModifiers.Clear();return output.Count==0;
 }
 [STAThread] public static int Main(string[] args){
  if(args.Length==1&&args[0]=="--self-test")return SelfTest()&&BattoKeyboardOutput.SelfTest()?0:5;
  if(args.Length>0&&args[0]=="--send"){try{return BattoKeyboardOutput.Run(args);}catch{return 17;}}
  Console.InputEncoding=System.Text.Encoding.UTF8;Console.OutputEncoding=new System.Text.UTF8Encoding(false);
  var writer=new Thread(()=>{var serializer=new JavaScriptSerializer();try{foreach(var value in output.GetConsumingEnumerable()){Console.WriteLine(serializer.Serialize(value));Console.Out.Flush();}}catch{context.ExitThread();}});writer.IsBackground=true;writer.Start();
  context=new ApplicationContext();keyboard=SetWindowsHookEx(13,keyboardCallback,GetModuleHandle(null),0);mouse=SetWindowsHookEx(14,mouseCallback,GetModuleHandle(null),0);
  if(keyboard==IntPtr.Zero||mouse==IntPtr.Zero){Emit(new{type="error",error="Windows-Eingabeüberwachung konnte nicht gestartet werden ("+Marshal.GetLastWin32Error()+")."});if(keyboard!=IntPtr.Zero)UnhookWindowsHookEx(keyboard);if(mouse!=IntPtr.Zero)UnhookWindowsHookEx(mouse);output.CompleteAdding();writer.Join(500);return 2;}
  var reader=new Thread(ReadCommands);reader.IsBackground=true;reader.Start();var timer=new System.Windows.Forms.Timer();timer.Interval=25;timer.Tick+=(s,e)=>Repeat();timer.Start();Emit(new{type="ready"});
  try{Application.Run(context);}finally{active=false;timer.Stop();timer.Dispose();UnhookWindowsHookEx(keyboard);UnhookWindowsHookEx(mouse);output.CompleteAdding();writer.Join(500);}return 0;
 }
}
