'use strict';
const {SETTING_SPECS,validateSetting,applySetting}=require('./jarvis-setting-actions.cjs');
const {sceneChoices}=require('../dual-stream/config.cjs');
const SCENES=['Spiel','Pause','Start','Ende'];
const VIEWS={touchdeck:'Touch Deck',dualstream:'Dual Stream',jarvis:'Jarvis',sensors:'PC-Messwerte',fans:'iCUE LINK Lüfter',start:'Startseite',dashboard:'Multi-Chat',wishlist:'Wunschgeschenke',widgets:'TikFinity-Widgets',livecenter:'TikTok LIVE Center',moderation:'Moderation',chatarchive:'Chatarchiv',filters:'Chat-Filter',hologram:'Chatfarben',platforms:'Plattformen',commands:'Commands',broadcast:'Auto-Broadcast',hotkeys:'Hotkeys / Multi-Action',events:'Events',media:'Medien',pools:'Medien-Pools',tts:'TTS',discord:'Discord',streamerbot:'Streamer.bot',backups:'Backups',settings:'Einstellungen',diagnostics:'Diagnose 2.1'};
async function connectAdapter(adapter,name,op){
 if(!adapter)throw Error('Chat-Verbindung fehlt.');
 const on=op==='on'||op==='toggle'&&!adapter.getStatus().connected;
 const result=await (on?adapter.connect():adapter.disconnect());
 if(result?.ok===false)throw Error(result.error||result.message||'Verbindung fehlgeschlagen.');
 const state=adapter.getStatus(),label={twitch:'Twitch',youtube:'YouTube',tikfinity:'TikFinity'}[name]||name;
 if(on&&!state.connected){if(state.state==='error'||state.error)throw Error(state.error||'Verbindung fehlgeschlagen.');return {ok:true,text:`${label}: Verbindungsaufbau gestartet. Noch nicht verbunden.`};}
 if(!on&&state.connected)throw Error('Die Verbindung wurde noch nicht getrennt.');
 return {ok:true,text:`${label}: ${on?'verbunden':'getrennt'}.`};
}
class SuiteControls{
 constructor({runtime,getDual,getHost}){Object.assign(this,{runtime,getDual,getHost});this.busy=false;this.jarvisDepth=0;}
 catalog(){const host=this.getHost(),legacy=host?.catalog?.()||{},dual=this.getDual(),scenes=sceneChoices(dual?.config).map(({value,label})=>({id:value,name:label}));return {actions:[
  {id:'listen',name:'Jarvis: fragen & zuhören'}, {id:'speech-stop',name:'Jarvis: sofort still'},
  {id:'command',name:'Jarvis: gespeicherten Befehl ausführen',text:true},
  {id:'scene',name:'Szene und Übergang',choices:scenes,transition:true},
  {id:'start',name:'Virtuelle Kamera starten',choices:this.targets()}, {id:'stop',name:'Virtuelle Kamera stoppen',choices:this.targets()},
  {id:'source',name:'Bildquelle an/aus',choices:[['camera','Kamera'],['game','Spiel']].map(([id,name])=>({id,name})),switch:true},
  {id:'overlay',name:'Einblendung an/aus',choices:[{id:'chat',name:'Chat'},{id:'events',name:'Ereignisse'}],switch:true},
  {id:'jarvis',name:'Jarvis-Einstellung an/aus',choices:[['voiceEnabled','Sprachausgabe'],['microphoneEnabled','Dauerhaft zuhören'],['wakeWord','Aktivierungswort'],['headphones','Kopfhörermodus'],['chatEnabled','Chat vorlesen'],['events.enabled','Stream-Ereignisse'],['events.gifts','Geschenke'],['events.follows','Follower'],['events.likes','Likes'],['events.subscriptions','Abo-Danksagungen'],['fanAlerts.enabled','Lüfterwarnungen'],['gamingMode','Gaming-Sparmodus']].map(([id,name])=>({id,name})),switch:true},
  {id:'microphones',name:'Mikrofone neu laden'},
  ...(typeof host?.jarvisSettings==='function'?[{id:'jarvis-settings',name:'Jarvis-Einstellungen öffnen'}]:[]),
  {id:'transition',name:'Szenenübergang wählen',choices:[{id:'fade',name:'Überblendung'},{id:'cut',name:'Schnitt'}]},
  {id:'likes-reset',name:'Jarvis Like-Zähler zurücksetzen'},
  {id:'companion',name:'LIVE-Studio-Sitzung markieren',switch:true},
  {id:'control',name:'Bot / Chat / Auto-Broadcast schalten',choices:legacy.controls||[],switch:true},
  {id:'broadcast-profile',name:'Einzelnen Auto-Broadcast schalten',choices:legacy.broadcastProfiles||[],switch:true},
  ...['chain','event','hotkey','broadcast','media'].map(id=>({id,name:{chain:'Aktionskette ausführen',event:'Ereignis-Aktionen ausführen',hotkey:'Gespeicherten Hotkey ausführen',broadcast:'Gespeicherten Broadcast senden',media:'Medium abspielen'}[id],choices:(legacy.items||[]).filter(x=>x.kind===id)})),
  {id:'cancel',name:'Laufende Automationen abbrechen'},
  {id:'connect',name:'Chat-Verbindung',choices:[{id:'tikfinity',name:'TikFinity / TikTok'},{id:'twitch',name:'Twitch'},{id:'youtube',name:'YouTube'}],switch:true},
  {id:'navigate',name:'Programmbereich öffnen',choices:Object.entries(VIEWS).map(([id,name])=>({id,name}))},
  {id:'tikfinity',name:'TikFinity-Web öffnen'}, {id:'show',name:'Batto-Fenster anzeigen'}, {id:'gaming',name:'Gaming-Modus: Oberfläche schließen, Dienste weiterführen'},
  {id:'prepare',name:'Bildquellen vorbereiten'}, {id:'release',name:'Video-Dienst ausschalten'}
 ],voiceActions:[{id:'jarvis-setting',name:'Jarvis-Einstellung',choices:Object.entries(SETTING_SPECS).map(([id,spec])=>({id,name:spec.name}))},{id:'transition-duration',name:'Übergangsdauer'}],sceneMode:dual?'suite':'obs',scenes:scenes.map(x=>x.name),states:legacy.states||{},program:dual?.config.program||{},voice:this.runtime.voice.status};}
 targets(both=true){return [...(both?[{id:'both',name:'Beide zusammen'}]:[]),{id:'tiktok',name:'TikTok'},{id:'twitch',name:'Twitch'}];}
 validate(steps,{voice=false}={}){
  if(!Array.isArray(steps)||!steps.length||steps.length>8)throw Error('Eine Kombination darf 1 bis 8 Aktionen enthalten.');
  // Validate the complete combination before any side effect.
  const catalog=this.catalog();for(const s of steps){const definition=[...catalog.actions,...(voice?catalog.voiceActions:[])].find(x=>x.id===s?.action);if(!definition)throw Error('Unbekannte Tastenaktion.');if(definition.choices&&!definition.choices.some(x=>x.id===s.target))throw Error('Bitte ein vorhandenes Ziel wählen.');if(definition.switch&&!['on','off','toggle'].includes(s.op||'toggle'))throw Error('Ungültiger Schalter.');if(s.action==='command'&&(typeof s.text!=='string'||!s.text.trim()||s.text.length>500))throw Error('Bitte einen kurzen Befehl eintragen.');if(s.action==='scene'&&(s.transition&&!['fade','cut'].includes(s.transition)||s.durationMs!==undefined&&(!Number.isInteger(s.durationMs)||s.durationMs<100||s.durationMs>2000)))throw Error('Ungültiger Übergang.');if(s.action==='jarvis-setting')validateSetting(s);if(s.action==='transition-duration'&&(!Number.isInteger(s.value)||s.value<100||s.value>2000))throw Error('Die Übergangsdauer muss zwischen 100 und 2000 Millisekunden liegen.');}
 }
 async executeFromJarvis(value){
  if(!value||value.steps||value.action==='command')throw Error('Dieser Sprachbefehl kann sich nicht selbst aufrufen.');
  this.validate([value],{voice:true});
  // A saved deck command already owns the control queue. Its validated inner
  // action belongs to that same turn; unrelated actions still respect the lock.
  if(this.busy&&this.jarvisDepth>0)return this.run(value);
  return this.execute(value,{voice:true});
 }
 async execute(value,{voice=false}={}){
  const steps=value?.steps||[value];this.validate(steps,{voice});
  if(this.busy){if(['speech-stop','cancel','stop'].includes(value?.action)&&!value.steps){const result=await this.run(value);if(result?.ok===false)throw Error(result.text||result.error||'Aktion fehlgeschlagen.');return result||{ok:true};}throw Error('Eine Tastenaktion läuft bereits.');}
  this.busy=true;let completed=0,last;try{for(const step of steps){const result=await this.run(step);if(result?.ok===false)throw Error(result.error||result.message||result.text||'Aktion wurde nicht ausgeführt.');last=result;completed++;}return {ok:true,completed,...(steps.length===1&&last?.text?{text:last.text}:{})};}catch(e){throw Error(`${completed?completed+' Aktionen ausgeführt; danach: ':''}${e.message}`);}finally{this.busy=false;}
 }
 async run(s){const r=this.runtime,d=this.getDual(),host=this.getHost();const enabled=current=>s.op==='on'?true:s.op==='off'?false:!current;
  switch(s.action){
   case 'listen':return r.listen();
   case 'speech-stop':return r.stopSpeech();
   case 'command':this.jarvisDepth++;try{return await r.jarvis.execute(s.text,{source:'streamdeck'});}finally{this.jarvisDepth--;}
   case 'jarvis':{const [key,sub]=s.target.split('.');const change=sub?{[key]:{...r.jarvis.settings[key],[sub]:enabled(r.jarvis.settings[key][sub])}}:{[key]:enabled(r.jarvis.settings[key])};r.jarvis.update(change);return;}
   case 'jarvis-setting':return applySetting(r.jarvis,s);
   case 'jarvis-settings':return host.jarvisSettings();
   case 'microphones':r.voice.send({command:'devices'});return {ok:true,text:'Die Mikrofonliste wird aktualisiert.'};
   case 'transition':case 'transition-duration':{if(!d)throw Error('Dual Stream ist nicht verfügbar.');const result=await d.serial(()=>d.program({...d.config.program,...(s.action==='transition'?{transition:s.target}:{durationMs:s.value})}));if(result?.ok===false)throw Error(result.error||result.text||'Der Übergang wurde nicht gespeichert.');return {ok:true,text:s.action==='transition'?`Szenenübergang: ${s.target==='fade'?'Überblendung':'Schnitt'}.`:`Übergangsdauer: ${s.value} Millisekunden.`};}
   case 'companion':d.companionLive=enabled(d.companionLive);d.emitState();return;
   case 'likes-reset':r.jarvis.events.resetLikes();return;
   case 'scene':return d?d.serial(()=>d.scene(s.target,s.transition,s.durationMs)):r.jarvis.obs.setScene(s.target);
   case 'start':return d.serial(()=>d.start(s.target));
   case 'stop':return d.serial(()=>d.stop(s.target));
   case 'mute':return d.serial(()=>d.mute(s.target,enabled(d.config.destinations[s.target].muted)));
   case 'source':return d.serial(()=>d.source(s.target,enabled(d.sourceState[s.target]??d.config.sources[s.target].enabled)));
   case 'overlay':return d.serial(()=>d.program({...d.config.program,[s.target]:enabled(d.config.program[s.target])}));
   case 'prepare':return d.serial(()=>d.prepare());
   case 'release':return d.serial(async()=>{if(d.running())throw Error('Bitte zuerst die Ausgaben stoppen.');return d.release();});
   case 'control':return host.control({target:s.target,op:s.op||'toggle'});
   case 'broadcast-profile':return host.control({target:'broadcast.profile',op:s.op||'toggle',args:{profileId:s.target}});
   case 'chain':case 'event':case 'hotkey':case 'broadcast':case 'media':return host.run(s.action,s.target);
   case 'connect':return host.connect(s.target,s.op||'toggle');
   case 'cancel':return host.cancel();
   case 'navigate':return host.navigate(s.target);
   case 'show':return host.show();
   case 'gaming':return host.gaming();
   case 'tikfinity':return host.tikfinity();
  }
 }
}
module.exports={SuiteControls,SCENES,VIEWS,connectAdapter};
