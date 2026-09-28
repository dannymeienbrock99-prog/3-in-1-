'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {FanAlertEngine}=require('./fan-alerts.cjs');
const normalize=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9%]+/g,' ').trim();
const DEFAULTS={address:'Sir Crazy',voiceEnabled:true,microphoneEnabled:false,wakeWord:true,headphones:false,speechRate:160,
 chatEnabled:true,chatMode:'moderators',chatPlatforms:['twitch','youtube','tiktok','cng'],chatAllowlist:[],chatMaxLength:280,chatCooldown:5,
 fanAlerts:{enabled:true,threshold:80,hysteresis:5,cooldown:90},sceneAliases:{pause:'',spiel:'',start:'',ende:''},sensorRules:{},learn:true,localAi:false,aiPort:11435,aiModel:'qwen3:8b',voiceRuntime:''};
function finite(value,min,max,fallback){return typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;}
function cleanSettings(input={}){
 const s={...DEFAULTS};
 for(const key of ['voiceEnabled','microphoneEnabled','wakeWord','headphones','chatEnabled','learn','localAi']) if(typeof input[key]==='boolean')s[key]=input[key];
 s.address=String(input.address||s.address).slice(0,40);s.speechRate=finite(input.speechRate,120,210,160);s.chatMaxLength=finite(input.chatMaxLength,40,500,280);s.chatCooldown=finite(input.chatCooldown,2,60,5);
 s.chatMode=['moderators','allowlist','all'].includes(input.chatMode)?input.chatMode:'moderators';
 s.chatPlatforms=Array.isArray(input.chatPlatforms)?input.chatPlatforms.filter(p=>DEFAULTS.chatPlatforms.includes(p)):s.chatPlatforms;
 s.chatAllowlist=Array.isArray(input.chatAllowlist)?input.chatAllowlist.filter(x=>typeof x==='string'&&/^(twitch|youtube|tiktok|cng):[^\s:]{1,160}$/.test(x)).slice(0,100):[];
 for(const k of Object.keys(s.sceneAliases))s.sceneAliases={...s.sceneAliases,[k]:String(input.sceneAliases?.[k]||'').slice(0,150)};
 s.sensorRules={}; for(const [id,r] of Object.entries(input.sensorRules||{}).slice(0,1000)){
   if(!r||typeof r!=='object'||id.length>160)continue;
   s.sensorRules[id]={alias:String(r.alias||'').slice(0,80),visible:r.visible!==false,readable:r.readable!==false,alert:r.alert===true,mode:['above','below','change'].includes(r.mode)?r.mode:'above',threshold:finite(r.threshold,-100000,1e9,80),delta:finite(r.delta,0.01,1e8,5),hysteresis:finite(r.hysteresis,0,1e6,2),cooldown:finite(r.cooldown,10,3600,60)};
 }
 s.fanAlerts={enabled:input.fanAlerts?.enabled!==false,threshold:finite(input.fanAlerts?.threshold,1,100,80),hysteresis:finite(input.fanAlerts?.hysteresis,1,30,5),cooldown:finite(input.fanAlerts?.cooldown,10,3600,90)};
 s.aiPort=Math.round(finite(input.aiPort,1024,65535,11435));s.aiModel=/^[\w.:/-]{1,80}$/.test(input.aiModel||'')?input.aiModel:'qwen3:8b';s.voiceRuntime=String(input.voiceRuntime||'').slice(0,1000);s.microphone=Number.isInteger(input.microphone)&&input.microphone>=0?input.microphone:null;
 return s;
}
function isModerator(m){return ['moderator','mod','broadcaster','owner'].includes(String(m.role).toLowerCase())||(m.badges||[]).some(b=>['moderator','broadcaster'].includes(String(b).toLowerCase()));}
function allowedChat(m,s){
 if(!s.chatEnabled||!s.chatPlatforms.includes(m.platform)||typeof m.message!=='string'||!m.message.trim())return false;
 if(s.chatMode==='all')return true;
 if(s.chatMode==='moderators')return isModerator(m);
 // Only stable platform IDs can be allowlisted; display names are not identities.
 return !!m.userId&&s.chatAllowlist.includes(`${m.platform}:${m.userId}`);
}
function fresh(s,now=Date.now()){const age=now-Date.parse(s?.updatedUtc);return s?.fresh===true&&Number.isFinite(s.value)&&age>=-5000&&age<15000;}
function spoken(s,rule={}){
 const units={'°C':'Grad Celsius','RPM':'Umdrehungen pro Minute','%':'Prozent','V':'Volt','A':'Ampere','W':'Watt','MHz':'Megahertz','GB':'Gigabyte','MB':'Megabyte','GB/s':'Gigabyte pro Sekunde'};
 return `${rule.alias||s.name}: ${s.value.toLocaleString('de-DE',{maximumFractionDigits:['V','A'].includes(s.unit)?2:1})} ${units[s.unit]||s.unit}`;
}
class AlertEngine{
 constructor(){this.states=new Map();}
 evaluate(sensors,rules,now=Date.now()){
  const messages=[];
  for(const s of sensors){const r=rules[s.id];if(!r?.alert)continue;
   const previous=this.states.get(s.id);if(!fresh(s,now)){this.states.delete(s.id);continue;}
   const state=previous||{last:0,baseline:s.value,armed:true};let trigger=false;
   if(r.mode==='change')trigger=!!previous&&Math.abs(s.value-state.baseline)>=r.delta;
   else if(r.mode==='below'){if(s.value>=r.threshold+r.hysteresis)state.armed=true;trigger=state.armed&&s.value<r.threshold;}
   else {if(s.value<=r.threshold-r.hysteresis)state.armed=true;trigger=state.armed&&s.value>r.threshold;}
   if(trigger&&now-state.last>=r.cooldown*1000){messages.push({sensorId:s.id,text:`${spoken(s,r)}. ${r.mode==='change'?'Der Wert hat sich verändert.':r.mode==='below'?'Dein unterer Grenzwert wurde unterschritten.':'Dein oberer Grenzwert wurde überschritten.'}`});state.last=now;state.armed=false;state.baseline=s.value;}
   this.states.set(s.id,state);
  }return messages;
 }
}
class JarvisCore extends EventEmitter{
 constructor({directory,getSensors=()=>[],getFans=()=>[],obs,speak=()=>{},stopSpeech=()=>{},clock=Date.now,askAi}){
  super();this.directory=directory;this.getSensors=getSensors;this.getFans=getFans;this.obs=obs;this.speak=speak;this.stopSpeech=stopSpeech;this.clock=clock;this.askAi=askAi;
  this.settings=cleanSettings(this.read('jarvis-settings.json',{}));this.memory=this.read('jarvis-memory.json',[]);if(!Array.isArray(this.memory))this.memory=[];
  this.history=[];this.alerts=new AlertEngine();this.fanAlerts=new FanAlertEngine(this.read('jarvis-fan-alert-state.json',{}));this.lastFanState=JSON.stringify(this.fanAlerts.snapshot());this.chatSeen=new Map();this.lastChat=-Infinity;this.commandBusy=false;
 }
 read(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(this.directory,name),'utf8'));}catch{return fallback;}}
 save(name,value){fs.mkdirSync(this.directory,{recursive:true});const file=path.join(this.directory,name);fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
 update(settings){const previous=this.settings;this.settings=cleanSettings({...this.settings,...settings});if(JSON.stringify(previous.sensorRules)!==JSON.stringify(this.settings.sensorRules))this.alerts=new AlertEngine();this.save('jarvis-settings.json',this.settings);this.emit('settings',this.settings);return this.settings;}
 say(text,kind='answer',speech=true){const entry={id:crypto.randomUUID(),time:this.clock(),kind,text};this.history.push(entry);this.history=this.history.slice(-100);this.emit('message',entry);if(speech&&this.settings.voiceEnabled)this.speak(text,{priority:kind==='alert'?2:kind==='chat'?0:1});return {ok:true,text,kind};}
 remember(command,intent){if(!this.settings.learn)return;const key=normalize(command).slice(0,200);const old=this.memory.find(m=>m.command===key);if(old){old.count++;old.last=this.clock();}else this.memory.push({command:key,intent,count:1,last:this.clock()});this.memory=this.memory.sort((a,b)=>b.last-a.last).slice(0,200);this.save('jarvis-memory.json',this.memory);}
 onChat(batch){for(const m of batch){if(!allowedChat(m,this.settings))continue;const key=m.platform+':'+(m.id||crypto.createHash('sha256').update(m.userId+'|'+m.message+'|'+m.timestamp).digest('hex'));if(this.chatSeen.has(key))continue;this.chatSeen.set(key,this.clock());
  if(this.clock()-this.lastChat<this.settings.chatCooldown*1000)continue;this.lastChat=this.clock();
  const body=m.message.replace(/https?:\/\/\S+/gi,'Link').replace(/[\x00-\x1f]/g,' ').slice(0,this.settings.chatMaxLength);
  this.say(`${this.settings.address}, ${isModerator(m)?'Moderator ':''}${String(m.username||'Chat').slice(0,60)} sagt: ${body}`,'chat');
 }for(const [key,time]of this.chatSeen)if(this.clock()-time>300000)this.chatSeen.delete(key);}
 poll(){
  const alerts=this.alerts.evaluate(this.getSensors(),this.settings.sensorRules,this.clock());
  for(const a of alerts.slice(0,3))this.say(`${this.settings.address}, ${a.text}`,'alert');
  const high=this.fanAlerts.evaluate(this.getFans(),this.settings.fanAlerts,this.clock());
  const saved=JSON.stringify(this.fanAlerts.snapshot());if(saved!==this.lastFanState){this.save('jarvis-fan-alert-state.json',this.fanAlerts.snapshot());this.lastFanState=saved;}
  if(high.length){
   const describe=f=>`${f.name}: ${Math.round(f.percent.value)} Prozent${f.percent.basis==='rpm-reference'?' der eingestellten Maximaldrehzahl':''}${fresh(f.rpm,this.clock())?', '+Math.round(f.rpm.value).toLocaleString('de-DE')+' Umdrehungen pro Minute':''}`;
   const detail=high.length<=3?high.map(describe).join('. '):`${high.length} iCUE-LINK-Lüfter haben die Meldeschwelle erreicht. Höchster Wert: ${describe(high.reduce((a,b)=>a.percent.value>b.percent.value?a:b))}`;
   this.say(`${this.settings.address}, hohe Lüfterdrehzahl. ${detail}.`,'alert');
  }
  return [...alerts,...high.map(f=>({fanId:f.id}))];
 }
 resolveSensors(text){
  const q=normalize(text), all=this.getSensors().filter(s=>this.settings.sensorRules[s.id]?.readable!==false);
  const fans=this.getFans();
  const namedFans=fans.filter(f=>{const n=normalize(f.name);return n.length>2&&q.includes(n);});
  if((/lufter|\bfan\b|icue link/.test(q)||namedFans.length)&&!/gpu|grafikkarte|pin|spannung|strom|temperatur|warm/.test(q)){
   const wanted=namedFans.length?namedFans:fans;
   const percent=/prozent|%|leistung|wie schnell|geschwindigkeit/.test(q);
   return wanted.slice(0,32).map(f=>({...((percent?f.percent:f.rpm)||{}),id:'fan/'+f.id+(percent?'/percent':'/rpm'),name:f.name,unit:percent?'%':'RPM'}));
  }
  const connector=/\b(pin|pins|anschluss|stecker)\b|12v.?2.?6|12vhpwr|16.?pin/.test(q);
  const exact=all.filter(s=>{const name=normalize(this.settings.sensorRules[s.id]?.alias||s.name);return name.length>2&&q.includes(name)&&(!connector||/pin|12v.?2.?6|12vhpwr|16.?pin/.test(normalize(s.name+' '+s.device)));});if(exact.length)return exact.slice(0,8);
  let group=/\b(gpu|grafikkarte|grafik)\b/.test(q)?'gpu':/\b(cpu|prozessor)\b/.test(q)?'cpu':/\b(ram|arbeitsspeicher)\b/.test(q)?'ram':/\b(pin|pins|anschluss|stecker)\b/.test(q)?'pin':'';
  if(connector)group='pin';
  let unit=/temperatur|warm|heiss/.test(q)?'°C':/spannung|volt/.test(q)?'V':/strom|ampere/.test(q)?'A':/leistung|watt/.test(q)?'W':/auslastung|last/.test(q)?'%':/drehzahl|umdrehung/.test(q)?'RPM':/takt|mhz/.test(q)?'MHz':'';
  const pin=q.match(/\bpin\s*([1-6])\b/);if(pin)group='pin';
  let matched=all.filter(s=>{const name=normalize(s.name+' '+s.device);if(unit&&s.unit!==unit)return false;
    if(group==='gpu'&&!/gpu|nvidia|geforce|radeon|grafik/.test(name))return false;
    if(group==='cpu'&&(!/cpu|prozessor|ryzen|intel core/.test(name)||/gpu|grafik/.test(name)))return false;
    if(group==='ram'&&(!/ram|arbeitsspeicher|physical memory/.test(name)||/gpu|vram/.test(name)))return false;
    if(group==='pin'&&!/pin|12v.?2.?6|12vhpwr|16.?pin/.test(name))return false;
    if(pin&&!new RegExp('pin\\s*'+pin[1]+'\\b').test(name))return false;
    return !!(group||unit);
  });
  if(!unit&&group==='gpu')matched=matched.filter(s=>s.unit==='°C'||s.name==='GPU-Auslastung');
  if(!unit&&group==='cpu')matched=matched.filter(s=>s.unit==='°C'||s.name==='CPU-Auslastung');
  return matched.slice(0,8);
 }
 async execute(input,{source='typed'}={}){
  if(typeof input!=='string'||input.length>1500)throw Error('Befehl zu lang.');
  const text=input.trim().replace(/^(?:hey\s+)?jarvis[,!:.\s]*/i,'');const q=normalize(text);const prefix=this.settings.address+', ';
  if(!q)return this.say(prefix+'ich höre. Frage zum Beispiel nach der GPU-Temperatur.');
  if(/^(stopp|stop|ruhe|sei still|schweigen)$/.test(q)){this.stopSpeech();return this.say('Sprachausgabe gestoppt.','status',false);}
  if(this.commandBusy)return {ok:false,text:'Ein Befehl wird gerade verarbeitet.'};this.commandBusy=true;
  try{
   const alias=/^(pause|spiel|weiter|start|ende)(?: szene)?$/.exec(q)?.[1];
   const explicit=/^(?:szene|wechsle (?:zu|zur szene)|schalte auf)\s+(.+)$/.exec(q)?.[1];
   if(alias||explicit){const key=alias==='weiter'?'spiel':alias;const list=await this.obs.scenes();let name=key?this.settings.sceneAliases[key]:'';
    if(!name){const wanted=explicit||key;name=list.find(s=>normalize(s)===wanted)|| (key==='pause'?list.find(s=>/pause|bin gleich|zuruck/.test(normalize(s))):'');}
    if(!name||!list.includes(name))return this.say(prefix+'für diesen Befehl ist noch keine vorhandene OBS-Szene zugeordnet. Wähle sie in den Jarvis-Einstellungen.');
    await this.obs.setScene(name);this.remember(text,'scene:'+name);return this.say(prefix+`OBS zeigt jetzt die Szene ${name}.`);
   }
   if(/^(befehle|hilfe|was kannst du)$/.test(q))return this.say(prefix+'ich kann gewünschte Messwerte nennen, konfigurierte Grenzwerte melden und OBS-Szenen wechseln. Zum Beispiel: GPU-Temperatur, CPU-Auslastung oder Pause.');
   const selected=this.resolveSensors(text);
   if(selected.length){const available=selected.filter(s=>fresh(s,this.clock()));this.remember(text,'sensors:'+selected.map(s=>s.id).join(','));return this.say(prefix+(available.length?available.map(s=>spoken(s,this.settings.sensorRules[s.id])).join('. ')+'.'+(available.length<selected.length?' Weitere passende Sensoren liefern gerade keine aktuellen Werte.':''):'dafür liegen gerade keine aktuellen Messwerte vor.'));}
   if(/temperatur|spannung|strom|volt|ampere|watt|\bpin|gpu|cpu|arbeitsspeicher|\bram\b|lufter|messwert|pc werte/.test(q))return this.say(prefix+'dafür finde ich keinen passenden verfügbaren Sensor. Wähle die Messquelle oder gib dem Sensor einen Sprachnamen.');
   if(this.settings.localAi&&this.askAi){const answer=await this.askAi(text,this.settings,this.memory.slice(0,20));this.remember(text,'conversation');return this.say(prefix+answer);}
   return this.say(prefix+'diesen Befehl kenne ich noch nicht. Allgemeine Fragen kannst du mit dem optionalen lokalen KI-Modell beantworten lassen.');
  }catch(e){this.say(prefix+String(e.message||'Die Aktion ist fehlgeschlagen.'),'error');return {ok:false,text:String(e.message)};}finally{this.commandBusy=false;}
 }
 snapshot(){return {settings:this.settings,history:this.history,memory:this.memory,knownSensors:this.getSensors().length};}
}
module.exports={JarvisCore,AlertEngine,allowedChat,isModerator,cleanSettings,DEFAULTS,normalize,fresh,spoken};
