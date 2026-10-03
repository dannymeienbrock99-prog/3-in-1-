'use strict';
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {defaults,validate,importProject,profile,platforms}=require('./config.cjs');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {NativeClient}=require('./native-client.cjs');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
class DualStream extends EventEmitter {
 constructor({directory,executable,safeStorage,assets}){super();this.assets=assets||path.resolve(__dirname,'../renderer/assets');this.directory=directory;this.executable=executable;this.safeStorage=safeStorage;this.file=path.join(directory,'dual-stream.json');this.keyFile=path.join(directory,'dual-stream-secrets.json');this.config=defaults();this.revision=1;this.credentials={};this.native=null;this.state={prepared:false,outputs:{}};this.probeResult=null;this.busy=false;this.error='';this.queue=Promise.resolve();this.companionLive=false;this.sourceState={};this.chatLines=[];this.eventText="";
  if(fs.existsSync(this.file)){try{this.config=validate(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch{this.error='Gespeicherte Dual-Stream-Konfiguration konnte nicht gelesen werden; die Datei wurde erhalten.';}}
  try{this.credentials=JSON.parse(fs.readFileSync(this.keyFile,'utf8'));}catch{}
 }
 root(){return this.config.obsRoot||path.join(process.env.ProgramFiles||'C:\\Program Files','obs-studio');}
 running(){return Object.values(this.state.outputs||{}).some(x=>['camera','live','connecting','test'].includes(x.state));}
 live(){return Object.values(this.state.outputs||{}).some(x=>['live','connecting'].includes(x.state));}
 async registerCameras(){
  if(this.running())throw Error('Kameras erst stoppen.');await this.release();
  try{await promisify(execFile)(this.executable,['--setup-cameras'],{windowsHide:true,timeout:180000});}
  catch(error){throw Error(String(error.stderr||'Kameraeinrichtung nicht abgeschlossen. Bitte die Windows-Administratorbestätigung für die virtuellen Kameras bestätigen.').trim());}
  await this.probe();return this.snapshot();
 }
 snapshot(){return {revision:this.revision,companionLive:this.companionLive,config:this.config,profile:profile(this.config),keys:Object.fromEntries(platforms.map(p=>[p,!!this.credentials[p]])),libraryFound:fs.existsSync(path.join(this.root(),'bin','64bit','obs.dll')),engineRunning:!!this.native?.process,state:this.state,probe:this.probeResult,busy:this.busy,error:this.error};}
 emitState(){this.emit('state',this.snapshot());}
 serial(fn,silent=false,publish=true){const action=this.queue.then(async()=>{this.busy=true;if(!silent)this.emitState();try{return await fn();}catch(e){this.error=e.message;throw e;}finally{this.busy=false;if(publish)this.emitState();}});this.queue=action.catch(()=>{});return action;}
 async client(){if(this.native?.process)return this.native;if(!fs.existsSync(this.executable))throw Error('Der Video-Dienst fehlt. Bitte den vollständigen Installer verwenden.');const c=new NativeClient(this.executable,this.root());this.native=c;c.on('exit',()=>{if(this.native===c){this.native=null;clearInterval(this.poller);clearTimeout(this.idleTimer);this.state={prepared:false,outputs:{}};this.emitState();}});await c.open();return c;}
 async release(){clearInterval(this.poller);clearTimeout(this.idleTimer);clearTimeout(this.overlayTimer);this.overlayTimer=null;clearTimeout(this.eventTimer);this.chatLines=[];this.eventText="";await this.native?.close();this.native=null;this.state={prepared:false,outputs:{}};this.emitState();}
 idle(){clearTimeout(this.idleTimer);if(this.native&&!this.running()&&!this.mediaBusy)this.idleTimer=setTimeout(()=>this.serial(()=>{if(!this.running())return this.release();}).catch(()=>{}),60000);}
 async probe(){if(this.running())throw Error('Geräte während einer laufenden Ausgabe nicht neu prüfen.');await this.release();try{const c=await this.client();this.probeResult=await c.request('probe');this.error='';return this.probeResult;}finally{await this.release();}}
 assertRevision(value){if(value?.baseRevision!==undefined&&value.baseRevision!==this.revision)throw Error('Dual Stream wurde inzwischen in einem anderen Fenster oder über eine Taste geändert. Bitte den aktuellen Stand neu laden.');}
 async save(value){this.assertRevision(value);if(this.running())throw Error('Erst die laufenden Ausgaben stoppen, bevor Quellen oder Layout geändert werden.');const config=validate(value);await this.release();atomic(this.file,config);this.config=config;this.revision++;this.error='';return this.snapshot();}
 async import(value){const config=importProject(value);config.obsRoot=this.config.obsRoot;return this.save(config);}
 async background(value,file){
  const request=typeof value==='string'?{scene:value}:value;this.assertRevision(request);
  if(!request||!['Pause','Start','Ende'].includes(request.scene)||request.platform!==undefined&&!platforms.includes(request.platform))throw Error('Unbekannte Szene oder Leinwand.');
  if(this.running())throw Error('Bitte zuerst die virtuellen Kameras stoppen, bevor du den Hintergrund änderst.');
  if(file!==null&&(typeof file!=='string'||!fs.existsSync(file)))throw Error('Hintergrunddatei nicht gefunden.');
  const next=JSON.parse(JSON.stringify(this.config)),wasPrepared=this.state.prepared;
  if(request.platform){next.program.platformBackgrounds||={};next.program.platformBackgrounds[request.platform]||={};next.program.platformBackgrounds[request.platform][request.scene]=file;}
  else{next.program.backgrounds[request.scene]=file;for(const platform of platforms)if(next.program.platformBackgrounds?.[platform])delete next.program.platformBackgrounds[platform][request.scene];}
  await this.save(next);if(wasPrepared)await this.prepare();return this.snapshot();
 }
 saveKey(platform,key){if(!platforms.includes(platform)||typeof key!=='string'||key.length>4096||/[\r\n\u0000]/.test(key))throw Error('Ungültiger Stream-Key.');if(!this.safeStorage.isEncryptionAvailable())throw Error('Windows-Verschlüsselung ist zurzeit nicht verfügbar.');const next={...this.credentials};if(key)next[platform]=this.safeStorage.encryptString(key).toString('base64');else delete next[platform];atomic(this.keyFile,next);this.credentials=next;return this.snapshot();}
 getKey(p){try{return this.safeStorage.decryptString(Buffer.from(this.credentials[p],'base64'));}catch{throw Error('Stream-Key bitte erneut direkt im Programm speichern.');}}
 async prepare(){if(this.running())throw Error('Die Ausgabe läuft bereits.');const c=await this.client();this.state=await c.request('prepare',{config:this.nativeConfig()});this.sourceState=Object.fromEntries(Object.entries(this.config.sources).map(([k,v])=>[k,v.enabled]));await this.flushOverlay();for(const p of platforms)if(this.config.destinations[p].muted)this.state=await c.request('mute',{platform:p,muted:true});this.error='';this.idle();return this.snapshot();}
 nativeConfig(){const config=JSON.parse(JSON.stringify(this.config));config.sources.microphone.enabled=false;config.sources.desktop.enabled=false;if(config.sources.camera.enabled&&/27b05c2d-93dc-474a-a5da-9bba34cb2a9[cd]/i.test(config.sources.camera.target))throw Error('Bitte eine echte Kamera wählen, nicht eine der beiden eigenen Ausgaben.');const assets=this.assets;const pictures={Pause:'bin-gleich-zurueck.jpg',Start:'stream-startet.jpg',Ende:'crazy-batto.png'};for(const [name,file]of Object.entries(pictures))if(config.program.backgrounds[name]!==null&&!config.program.backgrounds[name])config.program.backgrounds[name]=path.join(assets,file);return config;}
 async scene(name,transition=this.config.program.transition,durationMs=this.config.program.durationMs){if(!['Spiel','Pause','Start','Ende'].includes(name)||!['fade','cut'].includes(transition)||!Number.isInteger(durationMs)||durationMs<100||durationMs>2000)throw Error('Ungültige Szene oder Übergang.');if(this.state.prepared)this.state=await this.native.request('scene',{scene:name,transition,durationMs});this.config.program={...this.config.program,scene:name,transition,durationMs};atomic(this.file,this.config);this.revision++;return this.snapshot();}
 async program(value){this.assertRevision(value);const next=validate({...this.config,program:value});if(this.state.prepared&&(next.program.scene!==this.config.program.scene))await this.scene(next.program.scene,next.program.transition,next.program.durationMs);this.config.program=next.program;atomic(this.file,this.config);this.revision++;await this.flushOverlay();return this.snapshot();}
 async source(source,enabled){if(['microphone','desktop'].includes(source))throw Error('Ton bitte in LIVE Studio einstellen. Virtuelle Kameras übertragen nur Bild.');if(!['game','camera'].includes(source)||typeof enabled!=='boolean')throw Error('Ungültige Quelle.');if(!this.state.prepared)throw Error('Erst die Bildquellen vorbereiten.');if(!this.config.sources[source].enabled)throw Error('Diese Quelle wurde beim Vorbereiten nicht eingeschaltet.');this.state=await this.native.request('source',{source,enabled});this.sourceState[source]=enabled;return this.snapshot();}
 overlayChat(m){if(!this.config.program.chat||!this.state.prepared)return;const clean=x=>String(x||'').replace(/[\x00-\x1f]/g,' ').slice(0,200);this.chatLines.push(clean(m.username)+': '+clean(m.message));this.chatLines=this.chatLines.slice(-4);this.scheduleOverlay();}
 overlayEvent(e){if(!this.config.program.events||!this.state.prepared)return;const name=String(e.user?.displayName||e.user?.username||'Zuschauer').slice(0,60);const texts={follow:name+' folgt jetzt',gift:name+' · '+(e.gift?.count||1)+' × '+String(e.gift?.name||'Geschenk').slice(0,80),sub:name+' hat abonniert',raid:name+' startet einen Raid'};if(!texts[e.type])return;this.eventText=texts[e.type];this.scheduleOverlay();clearTimeout(this.eventTimer);this.eventTimer=setTimeout(()=>{this.eventText='';this.scheduleOverlay();},10000);this.eventTimer.unref();}
 scheduleOverlay(){this.overlayDirty=true;if(this.overlayTimer||this.overlayQueued)return;this.overlayTimer=setTimeout(()=>{this.overlayTimer=null;this.overlayDirty=false;if(this.state.prepared){this.overlayQueued=true;this.serial(()=>this.flushOverlay(),true).catch(()=>{}).finally(()=>{this.overlayQueued=false;if(this.overlayDirty)this.scheduleOverlay();});}},500);this.overlayTimer.unref();}
 async flushOverlay(){if(!this.state.prepared||!this.native)return;await this.native.request('overlay',{chat:this.chatLines.join('\n'),events:this.eventText,chatVisible:this.config.program.chat,eventsVisible:this.config.program.events});}
 async media(file,{volume=1,durationSeconds=0,signal}={}){
  if(this.mediaBusy)throw Error('Ein Stream-Medium läuft bereits.');if(!this.state.prepared)throw Error('Bildquellen erst vorbereiten.');
  this.mediaBusy=true;clearTimeout(this.idleTimer);let started=false;try{
   if(signal?.aborted)throw Error('Medienaktion abgebrochen.');await this.serial(()=>this.native.request('media',{path:file,volume,duration:Math.max(1,Math.min(120,Math.round(durationSeconds||(/\.(png|jpe?g|webp|bmp)$/i.test(file)?8:120))))}));started=true;
   for(let i=0;i<245;i++){await new Promise(r=>setTimeout(r,500));if(signal?.aborted||!this.native)throw Error('Medienaktion abgebrochen.');const state=await this.serial(()=>this.native.request('media-state'),true);if(!state.active)return {ok:true,completed:true};}throw Error('Medienzeit überschritten.');
  }finally{if(started&&this.native)await this.serial(()=>this.native.request('media-stop'),true).catch(()=>{});this.mediaBusy=false;this.idle();}
 }
 async obs(request,data={}){switch(request){
  case 'GetSceneList':return {scenes:['Spiel','Pause','Start','Ende'].map(sceneName=>({sceneName})),currentProgramSceneName:this.config.program.scene};
  case 'SetCurrentProgramScene':return this.serial(()=>this.scene(data.sceneName));
  case 'GetCurrentProgramScene':return {currentProgramSceneName:this.config.program.scene};
  case 'SetCurrentSceneTransition':return this.serial(()=>this.program({...this.config.program,transition:/cut|schnitt/i.test(data.transitionName)?'cut':'fade'}));
  case 'SetCurrentSceneTransitionDuration':return this.serial(()=>this.program({...this.config.program,durationMs:data.transitionDuration}));
  case 'GetSceneTransitionList':return {transitions:[{transitionName:'Überblendung'},{transitionName:'Schnitt'}]};
  case 'StopStream':return this.serial(()=>this.stop('both'));
  case 'StartStream':return this.serial(()=>this.start('both'));
  case 'GetStreamStatus':return {outputActive:this.live()||this.companionLive};
  default:throw Error('Diese frühere OBS-Aktion hat kein direktes Gegenstück im eigenen Sender. Bitte eine Batto-Tastenaktion auswählen.');}}
 async start(platform){const targets=platform==='both'?platforms:[platform];if(targets.some(p=>!platforms.includes(p)))throw Error('Unbekanntes Sendeziel.');
  if(!this.state.prepared)await this.prepare();
  const cameras=this.state.virtualCameras||this.probeResult?.virtualCameras;
  const ready=targets.map(p=>{if(!cameras?.[p]?.ready)throw Error('Bitte zuerst die virtuellen Kameras einrichten.');if(['camera','live','connecting','test'].includes(this.state.outputs?.[p]?.state))throw Error(p+' ist bereits gestartet.');return {platform:p};});
  clearTimeout(this.idleTimer);const started=[];
  try{for(const fields of ready){this.state=await this.native.request('camera-start',fields);started.push(fields.platform);}}catch(e){for(const p of started)await this.native?.request('stop',{platform:p}).catch(()=>{});this.state=await this.native?.request('status').catch(()=>({prepared:false,outputs:{}}))||{prepared:false,outputs:{}};this.idle();throw e;}
  this.startPolling();return this.snapshot();
 }
 startPolling(){clearInterval(this.poller);this.poller=setInterval(()=>{if(this.busy||!this.native)return;this.serial(async()=>{this.state=await this.native.request('status');if(!this.running()){clearInterval(this.poller);this.idle();}},true).catch(()=>{});},2000);}
 async stop(platform){if(!['both',...platforms].includes(platform))throw Error('Unbekanntes Sendeziel.');if(this.native)this.state=await this.native.request('stop',{platform});if(!this.running()){clearInterval(this.poller);this.idle();}return this.snapshot();}
 async mute(platform,muted){if(!platforms.includes(platform)||typeof muted!=='boolean')throw Error('Ungültige Ton-Einstellung.');if(this.native&&this.state.prepared)this.state=await this.native.request('mute',{platform,muted});this.config.destinations[platform].muted=muted;atomic(this.file,this.config);this.revision++;return this.snapshot();}
 async image(value){const platform=typeof value==='string'?value:value?.platform,mode=typeof value==='string'?'program':value?.mode||'program';if(!platforms.includes(platform)||!['program','sources'].includes(mode))throw Error('Unbekannte Leinwand oder Vorschau.');if(!this.state.prepared)throw Error('Erst Quellen vorbereiten.');const result=await this.native.request('snapshot',{platform,mode});this.idle();return result;}
}
module.exports={DualStream};
