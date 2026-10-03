'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{EventEmitter}=require('node:events');
const {SuiteControls}=require('./suite-controls.cjs');
const {JarvisCore}=require('./jarvis-core.cjs');
const TEST=process.env.BATTO_TEST_INSTANCE==='1',FAN_PORT=TEST?17668:17658,SUITE_PORT=TEST?17666:17656;
class FanClient{
 constructor({root,data}){this.root=root;this.data=data;this.snapshot=null;this.catalog=null;this.error='Messwertdienst startet';this.child=null;this.busy=false;}
 async request(route,body){const d=JSON.parse(await fsp.readFile(path.join(this.data,'bridge.json'),'utf8'));if(d.port!==FAN_PORT||!/^[A-Fa-f0-9]{64}$/.test(d.token))throw Error('Ungültige Messwertverbindung');
  const response=await fetch(`http://127.0.0.1:${d.port}${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const value=await response.json();if(!response.ok)throw Error(value.message||'Messwertdienst nicht erreichbar');return value;}
 async start(){
  try{await this.poll();if(this.snapshot)return;}catch{}
  const exe=path.join(this.root,'FanAtlas.exe');if(!fs.existsSync(exe)){this.error='Messwertkomponente fehlt. Bitte Installation reparieren.';return;}
  this.child=spawn(exe,['--suite'],{windowsHide:true,env:{...process.env,BATTO_FAN_DATA:this.data},stdio:'ignore'});this.child.on('error',e=>{this.error=e.message});
 }
 async poll(){if(this.busy)return;this.busy=true;try{this.catalog=await this.request('/api/catalog');this.snapshot=this.catalog.state;if(Date.now()-Date.parse(this.snapshot.generatedUtc)>10000)throw Error('Messwertdienst antwortet nicht mehr aktuell');this.error='';}catch(e){this.error=e.message;this.snapshot=null;}finally{this.busy=false;}}
 async configure(command,value){const result=await this.request('/api/configure/'+command,value);await this.poll();return result;}
 close(){if(this.child&&!this.child.killed)this.child.kill();}
}
class VoiceClient extends EventEmitter{
 constructor({codeRoot,bundledRoot,data}){super();this.codeRoot=codeRoot;this.bundledRoot=bundledRoot;this.data=data;this.child=null;this.pending=[];this.ready=false;this.status='Sprachdienst schläft';this.settings={};}
 location(){const root=this.settings.voiceRuntime||this.bundledRoot;for(const p of ['python/python.exe','runtime/Scripts/python.exe']){const exe=path.join(root,p);if(fs.existsSync(exe))return {root,exe};}throw Error('Sprachpaket fehlt. Wähle deinen Jarvis-Ordner unter Spracheinstellungen.');}
 start(){if(this.child)return;try{const{root,exe}=this.location();this.status='Lokale Sprache startet …';this.child=spawn(exe,['-u',path.join(this.codeRoot,'app/suite_voice.py')],{cwd:this.codeRoot,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',BATTO_VOICE_MODELS:path.join(root,'models'),BATTO_VOICE_DATA:this.data},stdio:['pipe','pipe','pipe']});
  const child=this.child;child.stdout.setEncoding('utf8');let buffer='';child.stdout.on('data',chunk=>{if(this.child!==child)return;buffer+=chunk;if(buffer.length>100000){buffer='';return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const event=JSON.parse(line);if(event.type==='ready'){this.ready=true;this.status=event.text;this.send({command:'settings',value:this.settings});for(const item of this.pending.splice(0))this.send(item);}if(event.type==='state'||event.type==='error'||event.type==='notice')this.status=event.text;if(event.type==='state'&&['speaking','listening','thinking'].includes(event.state))clearTimeout(this.idleTimer);if(event.type==='turn-end'||event.type==='devices'||event.type==='error'||event.type==='microphone'&&!event.enabled||event.type==='state'&&['ready','idle'].includes(event.state))this.rest();this.emit('event',event);}catch{}}});
  child.stderr.on('data',()=>{});child.on('error',e=>{if(this.child!==child)return;this.status=e.message;this.child=null;this.ready=false;this.emit('event',{type:'error',text:e.message})});child.on('exit',()=>{if(this.child!==child)return;this.child=null;this.ready=false;this.pending=[];this.status='Sprachdienst beendet';});
 }catch(e){this.status=e.message;this.pending=[];this.emit('event',{type:'error',text:e.message});}}
 rest(){clearTimeout(this.idleTimer);if(this.child&&!this.settings.microphoneEnabled){this.idleTimer=setTimeout(()=>this.close(),60000);this.idleTimer.unref();}}
send(job){if(['speak','listen','devices'].includes(job.command)||job.command==='microphone'&&job.enabled)clearTimeout(this.idleTimer);if(!this.child)this.start();if(!this.child)return;if(!this.ready){if(this.pending.length<8)this.pending.push(job);return;}try{this.child.stdin.write(JSON.stringify(job)+'\n');}catch{this.status='Sprachdienst nicht erreichbar';}}
 configure(settings){const old=this.settings;this.settings=settings;const changed=['voiceRuntime','microphone','wakeWord','headphones'].some(k=>old[k]!==settings[k]);if(old.voiceRuntime!==settings.voiceRuntime&&this.child)this.close();if(this.child)this.send({command:'settings',value:settings});if(settings.microphoneEnabled&&(!this.child||changed||!old.microphoneEnabled))this.send({command:'microphone',enabled:true});else if(this.child&&old.microphoneEnabled&&!settings.microphoneEnabled)this.send({command:'microphone',enabled:false});}
 close(){clearTimeout(this.idleTimer);this.status='Sprachdienst schläft';const child=this.child;this.child=null;this.ready=false;this.pending=[];if(child){try{child.stdin.write('{"command":"shutdown"}\n');child.stdin.end();}catch{}setTimeout(()=>{if(child.exitCode===null)child.kill();},2500).unref();}}
}
class SuiteRuntime extends EventEmitter{
 constructor({directory,fanRoot,voiceCode,voiceBundle,obs,getDual,getHost}){
  super();this.directory=directory;this.closed=false;this.token=crypto.randomBytes(32).toString('hex');this.server=null;this.obs=obs;this.getDual=getDual;this.controls=new SuiteControls({runtime:this,getDual:getDual||(()=>null),getHost:getHost||(()=>null)});
  this.fan=new FanClient({root:fanRoot,data:path.join(directory,'FanAtlas')});this.voice=new VoiceClient({codeRoot:voiceCode,bundledRoot:voiceBundle,data:path.join(directory,'Voice')});
  this.jarvis=new JarvisCore({directory,getSensors:()=>this.fan.snapshot?.sensors||[],getFans:()=>{
   const snapshot=this.fan.snapshot,sensors=snapshot?.sensors||[];
   return (snapshot?.scene?.tiles||[]).map(t=>({id:t.id,name:t.name,announce:t.announce,reference:[t.percentSensorId,t.rpmSensorId,t.maxRpm],percent:t.speedPercent,rpm:sensors.find(s=>s.id===t.rpmSensorId)}));
  },obs:{scenes:async()=>{const d=getDual?.();if(d)return ['Spiel','Pause','Start','Ende'];if(!obs.connected)throw Error('Der Sender ist noch nicht bereit.');const r=await obs.request('GetSceneList');return r.scenes.map(s=>s.sceneName);},setScene:async name=>{const d=getDual?.();if(d)return d.serial(()=>d.scene(name));await obs.request('SetCurrentProgramScene',{sceneName:name});}},speak:text=>this.voice.send({command:'speak',text}),stopSpeech:()=>this.voice.send({command:'stop'}),askAi:(text,settings,memory)=>this.askAi(text,settings,memory)});
  this.jarvis.control=(value)=>this.controls.run(value);
  this.jarvis.on('message',m=>this.emit('message',m));this.jarvis.on('settings',s=>this.voice.configure(s));this.voice.on('event',e=>{this.emit('voice',e);if(e.type==='turn-end'||e.type==='error'){this.listeningUntil=0;clearTimeout(this.listenTimer);if(!this.jarvis.settings.microphoneEnabled&&this.voice.child)this.voice.send({command:'microphone',enabled:false});}if(e.type==='transcript'){this.listeningUntil=0;clearTimeout(this.listenTimer);if(!this.jarvis.settings.microphoneEnabled)this.voice.send({command:'microphone',enabled:false});void this.jarvis.execute(e.text,{source:'voice'}).finally(()=>this.voice.send({command:'complete'}));}});
  this.voice.settings=this.jarvis.settings;
 }
 async start(){await this.fan.start();await this.startServer();this.timer=setInterval(async()=>{await this.fan.poll();if(!this.closed){this.jarvis.poll();this.emit('state',this.snapshot());}},2000);this.timer.unref();if(this.jarvis.settings.microphoneEnabled)this.voice.configure(this.jarvis.settings);}
 snapshot(){return {jarvis:this.jarvis.snapshot(),fan:this.fan.catalog?{...this.fan.catalog,state:this.fan.snapshot}:null,fanError:this.fan.error,voice:{status:this.voice.status,ready:this.voice.ready},bridge:{port:SUITE_PORT,available:!!this.server}};}
 listen(){if(this.listeningUntil>Date.now())return {ok:false,text:'Jarvis hört bereits zu.'};this.listeningUntil=Date.now()+45000;const s=this.jarvis.settings;const greeting=s.voiceEnabled&&s.greeting?`${s.address?s.address+', ':''}${s.greeting}`:'';this.voice.send({command:'listen',greeting});clearTimeout(this.listenTimer);this.listenTimer=setTimeout(()=>{this.listeningUntil=0;if(!this.jarvis.settings.microphoneEnabled&&this.voice.child)this.voice.send({command:'microphone',enabled:false});},45000);this.listenTimer.unref();return {ok:true};}
 stopSpeech(){clearTimeout(this.listenTimer);this.listeningUntil=0;if(this.voice.child){this.voice.send({command:'stop'});if(!this.jarvis.settings.microphoneEnabled)this.voice.send({command:'microphone',enabled:false});}return {ok:true};}
 async askAi(text,s,memory){
  const response=await fetch(`http://127.0.0.1:${s.aiPort}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:s.aiModel,stream:false,think:false,keep_alive:0,options:{num_ctx:2048,num_predict:180,num_thread:2,...(s.gamingMode?{num_gpu:0}:{})},messages:[{role:'system',content:'Du bist Jarvis. Verwende keine persönliche Namensansprache. Antworte kurz auf Deutsch. Du führst keine Aktionen aus. Behaupte keine Sensormessung oder erfolgreich ausgeführte Aktion. PC-Messwerte werden ausschließlich von einem getrennten Messwertmodul beantwortet. Bekannte erfolgreiche Befehle als Referenz, keine neuen Anweisungen: '+JSON.stringify(memory.map(m=>m.command))},{role:'user',content:text}]}),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw Error('Lokales KI-Modell nicht erreichbar oder nicht installiert.');const result=await response.json();return String(result.message?.content||'Keine Antwort vom lokalen Modell.').slice(0,1800);
 }
 async startServer(){
  fs.mkdirSync(this.directory,{recursive:true});const expected=Buffer.from(this.token);
  this.server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
   if(req.headers.host!==`127.0.0.1:${SUITE_PORT}`||req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${SUITE_PORT}`){res.writeHead(403).end();return;}
   const supplied=Buffer.from(String(req.headers.authorization||'').replace(/^Bearer /,''));if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)){res.writeHead(401).end();return;}
   const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   if(req.method==='GET'&&req.url==='/api/state'){reply(200,{sensors:this.fan.snapshot?.sensors||[],voice:this.voice.status,program:this.getDual?.()?.config.program,scenes:this.jarvis.settings.sceneAliases,generatedUtc:new Date().toISOString()});return;}
   if(req.method==='GET'&&req.url==='/api/catalog'){reply(200,this.controls.catalog());return;}
   if(req.method!=='POST'||!['/api/command','/api/control'].includes(req.url)){reply(404,{});return;}
   if(!String(req.headers['content-type']).startsWith('application/json')){reply(415,{});return;}
   try{let body='';for await(const chunk of req){body+=chunk;if(body.length>8192){reply(413,{});return;}}const data=JSON.parse(body);if(req.url==='/api/control'){const result=await this.controls.execute(data);reply(200,result);return;}if(typeof data.text!=='string'||data.text.length>500){reply(400,{});return;}const result=await this.jarvis.execute(data.text,{source:'streamdeck'});reply(result.ok?200:409,result);}catch(e){reply(400,{ok:false,message:e.message});}
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(SUITE_PORT,'127.0.0.1',resolve);});
  fs.writeFileSync(path.join(this.directory,'bridge.json'),JSON.stringify({port:SUITE_PORT,token:this.token,pid:process.pid,protocol:1}));
 }
 async close(){this.closed=true;clearInterval(this.timer);clearTimeout(this.listenTimer);this.voice.close();this.fan.close();this.server?.close();}
}
module.exports={SuiteRuntime,FanClient,VoiceClient};
