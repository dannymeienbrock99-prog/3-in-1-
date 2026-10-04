'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const EFFECT_NAMES={static:'Statisch',rainbow:'Regenbogen',breathing:'Atmen',wave:'Welle',gradient:'Farbverlauf',sparkle:'Funkeln',colorcycle:'Farbwechsel',comet:'Komet',chase:'Lauflicht',scanner:'Scanner',ripple:'Wasserwelle',fire:'Feuer',aurora:'Nordlicht',stripes:'Farbstreifen'};
const DEFAULT_SETTINGS={effect:'rainbow',colors:['#a78bfa','#f34793','#3278ff','#00c6c9'],brightness:80,speed:50,scale:50,direction:'forward'};
class RgbService{
 constructor({root,directory,bridgeFactory,fetchRequest=fetch,onChange=()=>{}}){Object.assign(this,{root,directory,bridgeFactory,fetchRequest,onChange});this.bridge=null;this.starting=null;this.stopping=false;this.closed=false;this.queue=Promise.resolve();this.url=null;this.error='';this.lastSettings={...DEFAULT_SETTINGS,colors:[...DEFAULT_SETTINGS.colors]};this.lastBrightness=80;this.lastTargets=[];this.lastZoneIds={};this.revision=0;}
 catalog(){return {effects:Object.entries(EFFECT_NAMES).map(([id,name])=>({id,name}))};}
 snapshot(){const s=this.bridge?.status();return {available:!!this.bridgeFactory||fs.existsSync(path.join(this.root,'server/index.mjs')),running:!!this.bridge,url:this.url,connected:!!s?.connected,deviceCount:s?.deviceCount||0,effectRunning:!!s?.effectRunning,active:s?.active||[],effects:this.catalog().effects,error:s?.error||this.error,lastSettings:this.lastSettings,revision:this.revision};}
 changed(){this.onChange(this.snapshot());}
 async start(){
  if(this.closed||this.stopping)throw Error('Die RGB-Steuerung ist geschlossen.');
  if(this.bridge)return this.snapshot();
  if(this.starting)return this.starting;
  this.starting=(async()=>{
   let bridge;
   try{
    const factory=this.bridgeFactory||(await import(pathToFileURL(path.join(this.root,'server/index.mjs')).href)).createBridge;
    bridge=factory({port:0,embedded:true,profileDirectory:this.directory});
    const address=await bridge.listen();
    if(this.closed){await this.dispose(bridge);throw Error('Die RGB-Steuerung ist geschlossen.');}
    this.bridge=bridge;this.url=`http://127.0.0.1:${address.port}/?embedded=1`;this.error='';
    try{const saved=JSON.parse(await fsp.readFile(path.join(this.directory,'voice-settings.json'),'utf8'));this.lastSettings=this.settings(saved.settings);if(Number.isFinite(saved.lastBrightness)&&saved.lastBrightness>0&&saved.lastBrightness<=100)this.lastBrightness=saved.lastBrightness;}catch{}
    this.changed();return this.snapshot();
   }catch(e){this.error=e.message;this.changed();throw e;}
   finally{this.starting=null;}
  })();return this.starting;
 }
 settings(value){
  if(!value||!Object.hasOwn(EFFECT_NAMES,value.effect)||!Array.isArray(value.colors)||value.colors.length<1||value.colors.length>8||value.colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('Ungültige RGB-Einstellungen.');
  for(const [key,min,max]of [['brightness',0,100],['speed',1,100],['scale',1,100]])if(!Number.isFinite(value[key])||value[key]<min||value[key]>max)throw Error('Ungültige RGB-Einstellungen.');
  if(!['forward','reverse'].includes(value.direction))throw Error('Ungültige Effektrichtung.');
  return {effect:value.effect,colors:[...value.colors],brightness:value.brightness,speed:value.speed,scale:value.scale,direction:value.direction};
 }
 validate(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['color','effect','brightness','off','on','status'].includes(input.type))throw Error('Unbekannte RGB-Aktion.');
  if(input.type==='color'&&(typeof input.color!=='string'||!/^#[0-9a-f]{6}$/i.test(input.color)))throw Error('Ungültige RGB-Farbe.');
  if(input.type==='effect'&&!Object.hasOwn(EFFECT_NAMES,input.effect))throw Error('Unbekannter RGB-Effekt.');
  if(input.type==='brightness'&&(!Number.isFinite(input.brightness)||input.brightness<0||input.brightness>100))throw Error('RGB-Helligkeit muss zwischen 0 und 100 Prozent liegen.');
 }
 async request(route,body){
  if(!this.bridge||this.closed)throw Error('Die RGB-Steuerung ist nicht bereit.');
  const base=new URL(this.url).origin;
  const response=await this.fetchRequest(base+'/api/'+route,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||result.message||'Die RGB-Aktion wurde nicht ausgeführt.');return result;
 }
 action(input){this.validate(input);const task=this.queue.then(()=>this.perform(input));this.queue=task.catch(()=>{});return task;}
 async perform(input){
  await this.start();
  if(input.type==='status'){const s=this.snapshot();return {ok:true,text:s.connected?`${s.deviceCount} RGB-Geräte erkannt. ${s.effectRunning?'Ein RGB-Effekt läuft.':'Kein bewegter RGB-Effekt aktiv.'}`:'RGB-Steuerung bereit. Noch keine RGB-Geräte verbunden.'};}
  try{
   const before=this.bridge.status(),active=before.active||[];
   if(active[0]?.settings)this.lastSettings=this.settings(active[0].settings);
   if(this.lastSettings.brightness>0)this.lastBrightness=this.lastSettings.brightness;
   if(!before.connected)await this.request('discover',{});
   const {devices}=await this.request('devices');
   const compatible=devices.filter(d=>d.directMode&&!d.protected);
   if(!compatible.length)throw Error('Keine steuerbaren RGB-Geräte erkannt. Öffne RGB-Steuerung und prüfe die Windows- oder iCUE-Anbindung.');
   const preferred=active.length?active.map(x=>x.deviceId):this.lastTargets;
   const deviceIds=preferred.length?[...new Set(preferred)]:compatible.map(d=>d.id);
   if(deviceIds.some(id=>!compatible.some(d=>d.id===id)))throw Error('Ein zuletzt verwendetes RGB-Gerät fehlt. Bitte die RGB-Geräte neu suchen und deine Auswahl erneut anwenden.');
   const zoneIds=active.length?Object.fromEntries(active.filter(x=>Array.isArray(x.zones)&&x.zones.length).map(x=>[x.deviceId,[...x.zones]])):this.lastZoneIds;
   // A failed driver write must not widen the next command to unrelated devices.
   this.lastTargets=deviceIds;this.lastZoneIds=zoneIds;
   if(input.type==='off'){
    const result=await this.request('apply',{...this.lastSettings,brightness:0,deviceIds,...(Object.keys(zoneIds).length?{zoneIds}:{})});
    if(!Array.isArray(result.applied)||result.applied.length!==deviceIds.length)throw Error('Das Ausschalten konnte nicht vollständig bestätigt werden.');
    await this.request('stop',{deviceIds});
   }
   else{
    const settings={...this.lastSettings,colors:[...this.lastSettings.colors]};
    if(input.type==='color'){settings.effect='static';settings.colors=[input.color.toLowerCase()];}
    if(input.type==='effect')settings.effect=input.effect;
    if(input.type==='brightness')settings.brightness=input.brightness;
    if(input.type==='on')settings.brightness=settings.brightness>0?settings.brightness:this.lastBrightness;
    // Preserve active LED zone selections when a spoken command changes the light.
    const result=await this.request('apply',{...settings,deviceIds,...(Object.keys(zoneIds).length?{zoneIds}:{})});
    if(!Array.isArray(result.applied)||result.applied.length!==deviceIds.length)throw Error('Die RGB-Anwendung konnte nicht vollständig bestätigt werden.');
    this.lastSettings=settings;if(settings.brightness>0)this.lastBrightness=settings.brightness;
   }
   this.lastTargets=deviceIds;this.lastZoneIds=zoneIds;this.error='';this.revision++;
   try{await fsp.mkdir(this.directory,{recursive:true});const file=path.join(this.directory,'voice-settings.json');await fsp.writeFile(file+'.tmp',JSON.stringify({settings:this.lastSettings,lastBrightness:this.lastBrightness}));await fsp.rename(file+'.tmp',file);}catch{this.error='RGB geändert; die Einstellung konnte nicht gespeichert werden.';}
   this.changed();
   const text=input.type==='off'?'RGB-Beleuchtung ausgeschaltet.':input.type==='on'?'RGB-Beleuchtung eingeschaltet.':input.type==='color'?'RGB-Farbe angewendet.':input.type==='effect'?`RGB-Effekt ${EFFECT_NAMES[input.effect]} angewendet.`:`RGB-Helligkeit auf ${input.brightness} Prozent gestellt.`;
   return {ok:true,text};
  }catch(e){this.error=e.message;this.changed();throw e;}
 }
 async dispose(bridge){bridge.engine.stop();if(bridge.engine.framePromise)await bridge.engine.framePromise.catch(()=>{});await bridge.client.close();await new Promise(resolve=>{bridge.server.close(resolve);bridge.server.closeIdleConnections?.();});}
 async stop(){this.stopping=true;try{if(this.starting)await this.starting.catch(()=>{});await this.queue;const bridge=this.bridge;this.bridge=null;this.url=null;this.lastTargets=[];this.lastZoneIds={};if(bridge)await this.dispose(bridge);this.changed();return {ok:true};}finally{this.stopping=false;}}
 async close(){this.closed=true;await this.stop();}
}
module.exports={RgbService,EFFECT_NAMES};
