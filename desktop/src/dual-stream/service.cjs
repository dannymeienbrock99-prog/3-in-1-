'use strict';
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {defaults,validate,importProject,profile,platforms}=require('./config.cjs');
const {NativeClient}=require('./native-client.cjs');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
class DualStream extends EventEmitter {
 constructor({directory,executable,safeStorage}){super();this.directory=directory;this.executable=executable;this.safeStorage=safeStorage;this.file=path.join(directory,'dual-stream.json');this.keyFile=path.join(directory,'dual-stream-secrets.json');this.config=defaults();this.credentials={};this.native=null;this.state={prepared:false,outputs:{}};this.probeResult=null;this.busy=false;this.error='';this.queue=Promise.resolve();
  if(fs.existsSync(this.file)){try{this.config=validate(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch{this.error='Gespeicherte Dual-Stream-Konfiguration konnte nicht gelesen werden; die Datei wurde erhalten.';}}
  try{this.credentials=JSON.parse(fs.readFileSync(this.keyFile,'utf8'));}catch{}
 }
 root(){return this.config.obsRoot||path.join(process.env.ProgramFiles||'C:\\Program Files','obs-studio');}
 running(){return Object.values(this.state.outputs||{}).some(x=>['live','connecting','test'].includes(x.state));}
 snapshot(){return {config:this.config,profile:profile(this.config),keys:Object.fromEntries(platforms.map(p=>[p,!!this.credentials[p]])),libraryFound:fs.existsSync(path.join(this.root(),'bin','64bit','obs.dll')),engineRunning:!!this.native?.process,state:this.state,probe:this.probeResult,busy:this.busy,error:this.error};}
 emitState(){this.emit('state',this.snapshot());}
 serial(fn,silent=false){const action=this.queue.then(async()=>{this.busy=true;if(!silent)this.emitState();try{return await fn();}catch(e){this.error=e.message;throw e;}finally{this.busy=false;this.emitState();}});this.queue=action.catch(()=>{});return action;}
 async client(){if(this.native?.process)return this.native;if(!fs.existsSync(this.executable))throw Error('Der Video-Dienst fehlt. Bitte den vollständigen Installer verwenden.');const c=new NativeClient(this.executable,this.root());this.native=c;c.on('exit',()=>{if(this.native===c){this.native=null;clearInterval(this.poller);clearTimeout(this.idleTimer);this.state={prepared:false,outputs:{}};this.emitState();}});await c.open();return c;}
 async release(){clearInterval(this.poller);clearTimeout(this.idleTimer);await this.native?.close();this.native=null;this.state={prepared:false,outputs:{}};this.emitState();}
 idle(){clearTimeout(this.idleTimer);if(this.native&&!this.running())this.idleTimer=setTimeout(()=>this.serial(()=>{if(!this.running())return this.release();}).catch(()=>{}),60000);}
 async probe(){if(this.running())throw Error('Geräte während einer laufenden Ausgabe nicht neu prüfen.');await this.release();try{const c=await this.client();this.probeResult=await c.request('probe');this.error='';return this.probeResult;}finally{await this.release();}}
 async save(value){if(this.running())throw Error('Erst die laufenden Ausgaben stoppen, bevor Quellen oder Layout geändert werden.');const config=validate(value);await this.release();atomic(this.file,config);this.config=config;this.error='';return this.snapshot();}
 async import(value){const config=importProject(value);config.obsRoot=this.config.obsRoot;return this.save(config);}
 saveKey(platform,key){if(!platforms.includes(platform)||typeof key!=='string'||key.length>4096||/[\r\n\u0000]/.test(key))throw Error('Ungültiger Stream-Key.');if(!this.safeStorage.isEncryptionAvailable())throw Error('Windows-Verschlüsselung ist zurzeit nicht verfügbar.');const next={...this.credentials};if(key)next[platform]=this.safeStorage.encryptString(key).toString('base64');else delete next[platform];atomic(this.keyFile,next);this.credentials=next;return this.snapshot();}
 getKey(p){try{return this.safeStorage.decryptString(Buffer.from(this.credentials[p],'base64'));}catch{throw Error('Stream-Key bitte erneut direkt im Programm speichern.');}}
 async prepare(){if(this.running())throw Error('Die Ausgabe läuft bereits.');const c=await this.client();this.state=await c.request('prepare',{config:this.config});for(const p of platforms)if(this.config.destinations[p].muted)this.state=await c.request('mute',{platform:p,muted:true});this.error='';this.idle();return this.snapshot();}
 async start(platform){const targets=platform==='both'?platforms:[platform];if(targets.some(p=>!platforms.includes(p)))throw Error('Unbekanntes Sendeziel.');
  // Preflight both destinations before starting either. Keys only travel over the private child pipe.
  const ready=targets.map(p=>{if(!this.config.destinations[p].server||!this.credentials[p])throw Error('Server und Stream-Key für '+p+' fehlen.');if(['live','connecting','test'].includes(this.state.outputs?.[p]?.state))throw Error(p+' ist bereits gestartet.');return {platform:p,server:this.config.destinations[p].server,key:this.getKey(p)};});
  if(!this.state.prepared)await this.prepare();clearTimeout(this.idleTimer);const started=[];
  try{for(const fields of ready){this.state=await this.native.request('start',fields);started.push(fields.platform);}}catch(e){for(const p of started)await this.native?.request('stop',{platform:p}).catch(()=>{});this.state=await this.native?.request('status').catch(()=>({prepared:false,outputs:{}}))||{prepared:false,outputs:{}};this.idle();throw e;}
  this.startPolling();return this.snapshot();
 }
 startPolling(){clearInterval(this.poller);this.poller=setInterval(()=>{if(this.busy||!this.native)return;this.serial(async()=>{this.state=await this.native.request('status');if(!this.running()){clearInterval(this.poller);this.idle();}},true).catch(()=>{});},2000);}
 async stop(platform){if(!['both',...platforms].includes(platform))throw Error('Unbekanntes Sendeziel.');if(this.native)this.state=await this.native.request('stop',{platform});if(!this.running()){clearInterval(this.poller);this.idle();}return this.snapshot();}
 async mute(platform,muted){if(!platforms.includes(platform)||typeof muted!=='boolean')throw Error('Ungültige Ton-Einstellung.');if(this.native&&this.state.prepared)this.state=await this.native.request('mute',{platform,muted});this.config.destinations[platform].muted=muted;atomic(this.file,this.config);return this.snapshot();}
 async image(platform){if(!platforms.includes(platform))throw Error('Unbekannte Leinwand.');if(!this.state.prepared)throw Error('Erst Quellen vorbereiten.');const result=await this.native.request('snapshot',{platform});this.idle();return result;}
}
module.exports={DualStream};
