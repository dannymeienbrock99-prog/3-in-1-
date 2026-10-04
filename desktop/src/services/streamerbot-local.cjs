'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
function executable(file){
 if(typeof file!=='string'||file.length>2048||/[\x00-\x1f]/.test(file)||!path.isAbsolute(file)||path.basename(file).toLowerCase()!=='streamer.bot.exe')throw Error('Bitte die Datei Streamer.bot.exe auswählen.');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size<1024)throw Error('Die Streamer.bot-Datei ist ungültig.');return path.resolve(file);
}
function localServer(file){
 try{
  const settings=path.join(path.dirname(file),'data','settings.json');if(fs.statSync(settings).size>4*1024*1024)return null;
  const config=JSON.parse(fs.readFileSync(settings,'utf8').replace(/^\uFEFF/,'')),s=config.websockets;
  if(!s||!Number.isInteger(s.port)||s.port<1024||s.port>65535||!['127.0.0.1','localhost','::1','0.0.0.0',''].includes(String(s.address||'')))return null;
  const endpoint=String(s.endpoint||'/');if(!endpoint.startsWith('/')||endpoint.startsWith('//')||/[\x00-\x20?#]/.test(endpoint))return null;
  return {url:'ws://127.0.0.1:'+s.port+endpoint,autoStart:s.autoStart===true,requiresPassword:s.enableAuth===true};
 }catch{return null;}
}
async function runningProcesses(){
 if(process.platform!=='win32')return [];
 const command="Get-CimInstance Win32_Process -Filter \"Name = 'Streamer.bot.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress";
 const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:8000,maxBuffer:64*1024});
 if(!stdout.trim())return [];const data=JSON.parse(stdout);return (Array.isArray(data)?data:[data]).map(p=>({pid:p.ProcessId,path:typeof p.ExecutablePath==='string'?p.ExecutablePath:''}));
}
class StreamerBotLocal{
 constructor({getConfig,saveConfig,adapter,home=os.homedir(),listProcesses=runningProcesses,launch=spawn}={}){Object.assign(this,{getConfig,saveConfig,adapter,home,listProcesses,launch});this.starting=null;}
 async discover(){
  let running=[],processError='';try{running=await this.listProcesses();}catch{processError='Laufende Programme konnten nicht geprüft werden.';}
  const candidates=new Set([this.getConfig?.().executablePath,...running.map(p=>p.path)]);
  const desktop=path.join(this.home,'Desktop');try{for(const entry of fs.readdirSync(desktop,{withFileTypes:true}))if(entry.isDirectory()&&/^streamer[.]?bot/i.test(entry.name))candidates.add(path.join(desktop,entry.name,'Streamer.bot.exe'));}catch{}
  for(const directory of [desktop,path.join(this.home,'Downloads'),path.join(this.home,'Documents'),process.env.LOCALAPPDATA,process.env.ProgramFiles])if(directory)candidates.add(path.join(directory,'Streamer.bot','Streamer.bot.exe'));
  const installations=[];for(const candidate of candidates){if(!candidate)continue;try{const file=executable(candidate);if(installations.some(p=>p.path.toLowerCase()===file.toLowerCase()))continue;installations.push({path:file,name:path.basename(path.dirname(file)),running:running.some(p=>p.path.toLowerCase()===file.toLowerCase()),server:localServer(file)});}catch{}}
  return {installations,running:running.length>0,processError,selected:this.getConfig?.().executablePath||''};
 }
 async setup(file){
  const inventory=await this.discover();const chosen=file||inventory.installations.find(p=>p.running)?.path||inventory.installations[0]?.path;
  if(!chosen)throw Error('Streamer.bot nicht gefunden. Bitte die vorhandene Streamer.bot.exe auswählen.');
  const validated=executable(chosen),server=localServer(validated),patch={...this.getConfig(),executablePath:validated};
  if(server)patch.url=server.url;
  await this.saveConfig({streamerbot:patch});return {path:validated,server,inventory:await this.discover()};
 }
 start(){
  if(this.starting)return this.starting;
  this.starting=this.startOnce().finally(()=>{this.starting=null;});return this.starting;
 }
 async startOnce(){
  const file=executable(this.getConfig().executablePath);let running;
  try{running=await this.listProcesses();}catch{throw Error('Streamer.bot-Start abgebrochen: laufende Instanzen konnten nicht geprüft werden.');}
  if(running.length)return {alreadyRunning:true,started:false};
  await new Promise((resolve,reject)=>{const child=this.launch(file,[],{cwd:path.dirname(file),windowsHide:true,detached:true,stdio:'ignore',shell:false});child.once('error',()=>reject(Error('Streamer.bot konnte nicht gestartet werden.')));child.once('spawn',()=>{child.unref?.();resolve();});});
  return {started:true,alreadyRunning:false};
 }
}
module.exports={StreamerBotLocal,executable,localServer,runningProcesses};
