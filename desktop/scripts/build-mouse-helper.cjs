'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),core=path.join(root,'src/core');
const ps=fs.readFileSync(path.join(core,'mouse-action.ps1'),'utf8');
const cs=ps.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/)[1]+`
public class Program {
 public static int Main(string[] args) {
  if(args.Length==1&&args[0]=="--self-test")return BattoMouseInput.TestTiming()&&System.Runtime.InteropServices.Marshal.SizeOf(typeof(BattoMouseInput.Input))==(System.IntPtr.Size==8?40:28)?0:15;
  long deadline;int key,gap;
  if(args.Length!=6||!long.TryParse(args[1],out deadline)||!int.TryParse(args[2],out key)||!int.TryParse(args[5],out gap)||gap<0||gap>3000||!(key==0||key>=48&&key<=57||key>=65&&key<=90))return 16;
  try{return BattoMouseInput.Click(args[0],deadline,key,args[3],args[4]=="tap",gap);}catch{return 17;}
 }
}
`;
const source=path.join(core,'mouse-input.cs'),output=path.join(core,'mouse-input.exe');fs.writeFileSync(source,cs);
const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const r=spawnSync(compiler,['/nologo','/target:exe','/optimize+','/out:'+output,source],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error(r.stdout||r.stderr||r.error?.message);
const test=spawnSync(output,['--self-test'],{windowsHide:true});if(test.status!==0)throw Error('Maushelfer-Selbsttest fehlgeschlagen.');console.log('Native Eingabehilfe gebaut: Halten, K-Tipp vor Rechtsklick und Abbruchfreigabe geprüft.');
