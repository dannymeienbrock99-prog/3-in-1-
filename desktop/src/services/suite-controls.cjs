'use strict';
const SCENES=['Spiel','Pause','Start','Ende'];
const VIEWS={dualstream:'Dual Stream',jarvis:'Jarvis',sensors:'PC-Messwerte',fans:'Lüfter',start:'Startseite',dashboard:'Multi-Chat',wishlist:'Wunschliste',widgets:'Widgets',livecenter:'Live-Center',moderation:'Moderation',chatarchive:'Chatarchiv',filters:'Filter',hologram:'Hologramm',platforms:'Plattformen',commands:'Bot-Befehle',broadcast:'Auto-Broadcast',hotkeys:'Hotkeys',events:'Ereignisse',media:'Medien',pools:'Medien-Pools',tts:'Chat-Stimme',discord:'Discord',streamerbot:'Streamer.bot',backups:'Sicherungen',settings:'Einstellungen',diagnostics:'Diagnose'};
class SuiteControls{
 constructor({runtime,getDual,getHost}){Object.assign(this,{runtime,getDual,getHost});this.busy=false;}
 catalog(){const host=this.getHost(),legacy=host?.catalog?.()||{};return {actions:[
  {id:'listen',name:'Jarvis: fragen & zuhören'}, {id:'speech-stop',name:'Jarvis: sofort still'},
  {id:'command',name:'Jarvis: gespeicherten Befehl ausführen',text:true},
  {id:'scene',name:'Szene und Übergang',choices:SCENES.map(id=>({id,name:id})),transition:true},
  {id:'start',name:'Stream starten',choices:this.targets()}, {id:'stop',name:'Stream stoppen',choices:this.targets()},
  {id:'mute',name:'Stream-Ton an/aus',choices:this.targets(false),switch:true},
  {id:'source',name:'Bildquelle / Mikrofon / PC-Ton',choices:[['camera','Kamera'],['game','Spiel'],['microphone','Mikrofon'],['desktop','PC-Ton']].map(([id,name])=>({id,name})),switch:true},
  {id:'overlay',name:'Einblendung an/aus',choices:[{id:'chat',name:'Chat'},{id:'events',name:'Ereignisse'}],switch:true},
  {id:'jarvis',name:'Jarvis-Einstellung an/aus',choices:[['voiceEnabled','Sprachausgabe'],['microphoneEnabled','Dauerhaft zuhören'],['chatEnabled','Chat vorlesen'],['events.enabled','Stream-Ereignisse'],['events.gifts','Geschenke'],['events.follows','Follower'],['events.likes','Likes'],['gamingMode','Gaming-Sparmodus']].map(([id,name])=>({id,name})),switch:true},
  {id:'likes-reset',name:'Jarvis Like-Zähler zurücksetzen'},
  {id:'companion',name:'LIVE-Studio-Sitzung markieren',switch:true},
  {id:'control',name:'Bot / Chat / Auto-Broadcast schalten',choices:legacy.controls||[],switch:true},
  {id:'broadcast-profile',name:'Einzelnen Auto-Broadcast schalten',choices:legacy.broadcastProfiles||[],switch:true},
  ...['chain','event','hotkey','broadcast','media'].map(id=>({id,name:{chain:'Aktionskette ausführen',event:'Ereignis-Aktionen ausführen',hotkey:'Gespeicherten Hotkey ausführen',broadcast:'Gespeicherten Broadcast senden',media:'Medium abspielen'}[id],choices:(legacy.items||[]).filter(x=>x.kind===id)})),
  {id:'cancel',name:'Laufende Automationen abbrechen'},
  {id:'connect',name:'Chat-Verbindung',choices:[{id:'tikfinity',name:'TikFinity / TikTok'},{id:'twitch',name:'Twitch'},{id:'youtube',name:'YouTube'}],switch:true},
  {id:'navigate',name:'Programmbereich öffnen',choices:Object.entries(VIEWS).map(([id,name])=>({id,name}))},
  {id:'tikfinity',name:'TikFinity-Web öffnen'}, {id:'show',name:'Batto-Fenster anzeigen'},
  {id:'prepare',name:'Bildquellen vorbereiten'}, {id:'release',name:'Video-Dienst ausschalten'}
 ],scenes:SCENES,states:legacy.states||{},program:this.getDual()?.config.program||{},voice:this.runtime.voice.status};}
 targets(both=true){return [...(both?[{id:'both',name:'Beide zusammen'}]:[]),{id:'tiktok',name:'TikTok'},{id:'twitch',name:'Twitch'}];}
 async execute(value){
  if(this.busy){if(['speech-stop','cancel','stop'].includes(value?.action)&&!value.steps)return this.run(value).then(()=>({ok:true}));throw Error('Eine Tastenaktion läuft bereits.');}
  const steps=value?.steps||[value];if(!Array.isArray(steps)||!steps.length||steps.length>8)throw Error('Eine Kombination darf 1 bis 8 Aktionen enthalten.');
  // Validate the complete combination before any side effect.
  const catalog=this.catalog();for(const s of steps){const definition=catalog.actions.find(x=>x.id===s?.action);if(!definition)throw Error('Unbekannte Tastenaktion.');if(definition.choices&&!definition.choices.some(x=>x.id===s.target))throw Error('Bitte ein vorhandenes Ziel wählen.');if(definition.switch&&!['on','off','toggle'].includes(s.op||'toggle'))throw Error('Ungültiger Schalter.');if(s.action==='command'&&(typeof s.text!=='string'||!s.text.trim()||s.text.length>500))throw Error('Bitte einen kurzen Befehl eintragen.');if(s.action==='scene'&&(s.transition&&!['fade','cut'].includes(s.transition)||s.durationMs!==undefined&&(!Number.isInteger(s.durationMs)||s.durationMs<100||s.durationMs>2000)))throw Error('Ungültiger Übergang.');}
  this.busy=true;let completed=0;try{for(const step of steps){const result=await this.run(step);if(result?.ok===false)throw Error(result.error||result.message||result.text||'Aktion wurde nicht ausgeführt.');completed++;}return {ok:true,completed};}catch(e){throw Error(`${completed?completed+' Aktionen ausgeführt; danach: ':''}${e.message}`);}finally{this.busy=false;}
 }
 async run(s){const r=this.runtime,d=this.getDual(),host=this.getHost();const enabled=current=>s.op==='on'?true:s.op==='off'?false:!current;
  switch(s.action){
   case 'listen':return r.listen();
   case 'speech-stop':return r.stopSpeech();
   case 'command':return r.jarvis.execute(s.text,{source:'streamdeck'});
   case 'jarvis':{const [key,sub]=s.target.split('.');const change=sub?{[key]:{...r.jarvis.settings[key],[sub]:enabled(r.jarvis.settings[key][sub])}}:{[key]:enabled(r.jarvis.settings[key])};r.jarvis.update(change);return;}
   case 'companion':d.companionLive=enabled(d.companionLive);d.emitState();return;
   case 'likes-reset':r.jarvis.events.resetLikes();return;
   case 'scene':return d.serial(()=>d.scene(s.target,s.transition,s.durationMs));
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
   case 'tikfinity':return host.tikfinity();
  }
 }
}
module.exports={SuiteControls,SCENES,VIEWS};
