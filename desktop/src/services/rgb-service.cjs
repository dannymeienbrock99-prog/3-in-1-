'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const EFFECT_NAMES={static:'Statisch',rainbow:'Regenbogen',breathing:'Atmen',wave:'Welle',gradient:'Farbverlauf',sparkle:'Funkeln',colorcycle:'Farbwechsel',comet:'Komet',chase:'Lauflicht',scanner:'Scanner',ripple:'Wasserwelle',fire:'Feuer',aurora:'Nordlicht',stripes:'Farbstreifen'};
const DEFAULT_SETTINGS={effect:'rainbow',colors:['#a78bfa','#f34793','#3278ff','#00c6c9'],brightness:80,speed:50,scale:50,direction:'forward'};
const PROVIDER_NAMES={kingston:'Kingston',msi:'MSI',corsair:'Corsair',lianli:'Lian Li',windows:'Windows'};
const GENERIC_NATIVE={
 kingston:{static:['static_color'],rainbow:['rainbow_1'],breathing:['breath'],colorcycle:['dynamic_color'],comet:['comet'],chase:['running'],fire:['flame']},
 lianli:{static:['Static'],rainbow:['Rainbow'],breathing:['Breathing'],colorcycle:['ColorCycle'],chase:['Runway']}
};
const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,'').trim().slice(0,120):'';
const provider=device=>clean(device.provider||device.backend).toLowerCase();
const nativeModes=device=>(Array.isArray(device.nativeEffects)?device.nativeEffects:[]).filter(effect=>effect&&typeof effect.id==='string'&&effect.id.length>0&&effect.id.length<=80&&typeof effect.name==='string'&&effect.supported!==false&&effect.available!==false);
const nativeChoice=(device,effect)=>({id:`native:${provider(device)}:${effect.id}`,name:`${PROVIDER_NAMES[provider(device)]||clean(device.vendor)||provider(device)} ${clean(effect.name)}`});
function parseNative(value){const match=typeof value==='string'&&/^native:([a-z][a-z0-9_-]{0,31}):(.{1,80})$/.exec(value);return match?{provider:match[1],effectId:match[2]}:null;}
function stateOf(device){
 const current=device.activeNativeEffect;
 if(current&&typeof current==='object'&&!Array.isArray(current)&&typeof current.effectId==='string')return current;
 if(typeof current==='string')return {effectId:current,...(device.nativeSettings||{})};
 return null;
}
function activities(active,devices){
 const records=[];
 for(const item of active||[])if(Number.isInteger(item.deviceId)&&item.settings){const s=item.settings,zones=Array.isArray(item.zones)?[...item.zones]:null;records.push({id:item.deviceId,native:false,zones,stamp:Number.isFinite(item.appliedAt)?item.appliedAt:0,marker:JSON.stringify(['direct',s.effect,s.colors,s.brightness,s.speed,s.scale,s.direction,zones,item.appliedAt||0])});}
 for(const device of devices){const state=stateOf(device);if(state&&nativeModes(device).some(effect=>effect.id===state.effectId))records.push({id:device.id,native:true,zones:null,stamp:Number.isFinite(state.appliedAt)?state.appliedAt:0,marker:JSON.stringify(['native',state.effectId,state.colors,state.brightness,state.speed,state.direction,state.appliedAt||0])});}
 return records;
}
function confirmed(result,ids,effectId){
 const received=Array.isArray(result?.applied)?result.applied:[];
 if(received.length!==ids.length||new Set(received).size!==ids.length||ids.some(id=>!received.includes(id))||(effectId!==undefined&&result.effectId!==effectId))throw Error('Die RGB-Anwendung konnte nicht vollständig bestätigt werden.');
}
class RgbService{
 constructor({root,directory,bridgeFactory,fetchRequest=fetch,onChange=()=>{}}){Object.assign(this,{root,directory,bridgeFactory,fetchRequest,onChange});this.bridge=null;this.starting=null;this.stopping=false;this.closed=false;this.queue=Promise.resolve();this.url=null;this.error='';this.lastSettings={...DEFAULT_SETTINGS,colors:[...DEFAULT_SETTINGS.colors]};this.lastBrightness=80;this.lastTargets=[];this.lastZoneIds={};this.lastNativeSettings=new Map();this.seenSelections=new Map();this.revision=0;}
 softwareEffects(){
  const effects=Object.entries(EFFECT_NAMES).map(([id,name])=>({id,name})),ids=new Set(effects.map(effect=>effect.id));
  try{const supplied=JSON.parse(fs.readFileSync(path.join(this.root,'server/effect-catalog.json'),'utf8'));if(Array.isArray(supplied))for(const effect of supplied){if(effect&&typeof effect.id==='string'&&/^[a-z][a-z0-9]{0,63}$/.test(effect.id)&&typeof effect.name==='string'&&!ids.has(effect.id)){effects.push({id:effect.id,name:clean(effect.name)});ids.add(effect.id);}}}catch{}
  return effects;
 }
 catalog(){
  const effects=this.softwareEffects(),ids=new Set(effects.map(effect=>effect.id));
  if(this.bridge?.client?.connected)for(const device of this.bridge.client.devices||[]){if(device.protected||!provider(device))continue;for(const effect of nativeModes(device)){const choice=nativeChoice(device,effect);if(!ids.has(choice.id)){effects.push(choice);ids.add(choice.id);}}}
  return {effects};
 }
 snapshot(){const s=this.bridge?.status();return {available:!!this.bridgeFactory||fs.existsSync(path.join(this.root,'server/index.mjs')),running:!!this.bridge,url:this.url,connected:!!s?.connected,deviceCount:s?.deviceCount||0,effectRunning:!!s?.effectRunning,active:s?.active||[],nativeActive:s?.nativeActive||[],effects:this.catalog().effects,error:s?.error||this.error,lastSettings:this.lastSettings,revision:this.revision};}
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
  if(!value||!this.softwareEffects().some(effect=>effect.id===value.effect)||!Array.isArray(value.colors)||value.colors.length<1||value.colors.length>8||value.colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('Ungültige RGB-Einstellungen.');
  for(const [key,min,max]of [['brightness',0,100],['speed',1,100],['scale',1,100]])if(!Number.isFinite(value[key])||value[key]<min||value[key]>max)throw Error('Ungültige RGB-Einstellungen.');
  if(!['forward','reverse'].includes(value.direction))throw Error('Ungültige Effektrichtung.');
  return {effect:value.effect,colors:[...value.colors],brightness:value.brightness,speed:value.speed,scale:value.scale,direction:value.direction};
 }
 validate(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['color','effect','brightness','off','on','status'].includes(input.type))throw Error('Unbekannte RGB-Aktion.');
  if(input.type==='color'&&(typeof input.color!=='string'||!/^#[0-9a-f]{6}$/i.test(input.color)))throw Error('Ungültige RGB-Farbe.');
  if(input.type==='effect'&&!this.catalog().effects.some(effect=>effect.id===input.effect))throw Error('Unbekannter RGB-Effekt.');
  if(input.type==='brightness'&&(!Number.isFinite(input.brightness)||input.brightness<0||input.brightness>100))throw Error('RGB-Helligkeit muss zwischen 0 und 100 Prozent liegen.');
 }
 async request(route,body){
  if(!this.bridge||this.closed)throw Error('Die RGB-Steuerung ist nicht bereit.');
  const base=new URL(this.url).origin;
  const response=await this.fetchRequest(base+'/api/'+route,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||result.message||'Die RGB-Aktion wurde nicht ausgeführt.');return result;
 }
 action(input){this.validate(input);const task=this.queue.then(()=>this.perform(input));this.queue=task.catch(()=>{});return task;}
 rememberSelections(){this.seenSelections=new Map(activities(this.bridge?.status()?.active||[],this.bridge?.client?.devices||[]).map(record=>[record.id,record.marker]));}
 chooseTargets(active,devices,input){
  const records=activities(active,devices),changed=records.filter(record=>this.seenSelections.get(record.id)!==record.marker);
  let preferred;
  if(changed.length){const latest=Math.max(...changed.map(record=>record.stamp));preferred=(latest>0?changed.filter(record=>record.stamp===latest):changed).map(record=>record.id);}
  else preferred=this.lastTargets;
  const native=parseNative(input.effect);
  let targets=preferred.length?[...new Set(preferred)]:devices.map(device=>device.id);
  // A manufacturer name narrows an existing selection; it never adds RAM slots
  // or ports the user did not select after a previous action or failure.
  if(native)targets=targets.filter(id=>devices.find(device=>device.id===id)&&provider(devices.find(device=>device.id===id))===native.provider);
  if(!targets.length)throw Error('Kein ausgewähltes RGB-Gerät unterstützt diesen Herstellereffekt. Wähle das Gerät zuerst in der RGB-Steuerung.');
  if(preferred.some(id=>!devices.some(device=>device.id===id))||targets.some(id=>!devices.some(device=>device.id===id)))throw Error('Ein zuletzt verwendetes RGB-Gerät fehlt. Bitte die RGB-Geräte neu suchen und deine Auswahl erneut anwenden.');
  const zones={};
  for(const id of targets){const record=records.find(item=>item.id===id&&!item.native);const value=record?.zones||this.lastZoneIds[id];if(value)zones[id]=[...value];}
  return {deviceIds:targets,zoneIds:zones};
 }
 findNative(device,generic){
  const expected=GENERIC_NATIVE[provider(device)]?.[generic]||(generic==='static'?['Static','static_color']:generic==='off'?['Off','all_off']:[]);
  const matches=nativeModes(device).filter(effect=>expected.some(id=>id.toLowerCase()===effect.id.toLowerCase()));
  if(matches.length!==1)throw Error(`${device.name}: Für ${generic==='off'?'Ausschalten':EFFECT_NAMES[generic]||generic} steht kein eindeutiger Herstellereffekt zur Verfügung.`);
  return matches[0];
 }
 nativeOptions(device,effect,settings){
  const maximum=effect.colorsMax??effect.maxColors??10;
  if(!Number.isInteger(maximum)||maximum<0||maximum>10)throw Error(`${device.name}: Die zulässige Hersteller-Farbpalette ist unbekannt.`);
  const limit=Math.max(1,maximum);
  const options={colors:settings.colors.slice(0,limit),brightness:settings.brightness,speed:settings.speed,direction:effect.controls?.direction===false?'forward':settings.direction};
  if(!options.colors.length||options.colors.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))||!Number.isInteger(options.brightness)||options.brightness<0||options.brightness>100||!Number.isInteger(options.speed)||options.speed<1||options.speed>100||!['forward','reverse'].includes(options.direction))throw Error(`${device.name}: Die Herstellereffekt-Einstellungen sind ungültig.`);
  for(const key of ['background','irDelay','length','width','hue','multicolor','powerSaving'])if(settings[key]!==undefined&&effect.controls?.[key])options[key]=settings[key];
  return options;
 }
 nativePlan(device,input,settings){
  const modes=nativeModes(device),previous=stateOf(device),remembered=this.lastNativeSettings.get(device.id),explicit=parseNative(input.effect);
  const isOff=id=>['off','all_off'].includes(String(id).toLowerCase());
  let effect,source={...settings},resume=null;
  const current=previous&&!isOff(previous.effectId)&&modes.find(mode=>mode.id===previous.effectId);
  if(input.type==='off'||input.type==='brightness'&&input.brightness===0){
   resume=current?{effectId:current.id,...this.nativeOptions(device,current,{...settings,...previous})}:remembered;
   const off=modes.filter(mode=>isOff(mode.id));
   if(off.length===1)effect=off[0];
   else{effect=this.findNative(device,'static');if(effect.controls?.brightness===false)throw Error(`${device.name}: Sicheres Ausschalten wird nicht unterstützt.`);source.brightness=0;}
  }else if(explicit){
   if(provider(device)!==explicit.provider)throw Error(`${device.name}: Dieser Herstellereffekt gehört zu einem anderen Hersteller.`);
   effect=modes.find(mode=>mode.id===explicit.effectId);
   if(!effect)throw Error(`${device.name}: Der gewählte Herstellereffekt ist nicht mehr verfügbar.`);
  }else if(input.type==='color'){
   effect=this.findNative(device,'static');
   if(effect.controls?.colors===false||(effect.colorsMax??effect.maxColors??1)<1)throw Error(`${device.name}: Eine eigene statische RGB-Farbe wird nicht unterstützt.`);
  }else if(input.type==='effect')effect=this.findNative(device,input.effect);
  else{
   const restore=current?{effectId:current.id,...previous}:remembered;
   effect=restore&&modes.find(mode=>mode.id===restore.effectId);
   if(effect)source={...settings,...restore};else effect=this.findNative(device,'static');
   if(input.type==='brightness'){
    if(effect.controls?.brightness===false)throw Error(`${device.name}: Dieser Herstellereffekt erlaubt keine Änderung der Helligkeit.`);
    source.brightness=input.brightness;
   }
   if(input.type==='on')source.brightness=source.brightness>0?source.brightness:this.lastBrightness;
  }
  const body={effectId:effect.id,deviceIds:[device.id],...this.nativeOptions(device,effect,source)};
  return {route:'native-effect',body,device,effect,resume};
 }
 async validatePlan(plan){
  const module=plan.some(step=>step.route==='native-effect')?await import(pathToFileURL(path.join(this.root,'server/native-effects.mjs')).href):null;
  for(const step of plan){
   if(step.route==='native-effect')module.validateNativeEffect(this.bridge.client,step.body);
   else{this.settings(step.body);if(typeof this.bridge.engine.validateTargets==='function')this.bridge.engine.validateTargets(step.body);}
  }
 }
 async perform(input){
  await this.start();
  if(input.type==='status'){const s=this.snapshot(),native=s.nativeActive.length?`Für ${s.nativeActive.length} Geräte sind Herstellereffekte eingestellt.`:'';return {ok:true,text:s.connected?`${s.deviceCount} RGB-Geräte erkannt. ${s.effectRunning?'Ein RGB-Effekt läuft. '+native:native||'Kein bewegter RGB-Effekt aktiv.'}`.trim():'RGB-Steuerung bereit. Noch keine RGB-Geräte verbunden.'};}
  try{
   const before=this.bridge.status(),active=before.active||[];
   if(active[0]?.settings)this.lastSettings=this.settings(active[0].settings);
   if(this.lastSettings.brightness>0)this.lastBrightness=this.lastSettings.brightness;
   if(!before.connected)await this.request('discover',{});
   const {devices}=await this.request('devices');
   if(!Array.isArray(devices))throw Error('Die RGB-Geräteliste ist ungültig.');
   const compatible=devices.filter(d=>(d.directMode||nativeModes(d).length)&&!d.protected);
   if(!compatible.length)throw Error('Keine steuerbaren RGB-Geräte erkannt. Öffne RGB-Steuerung und prüfe die Windows- oder iCUE-Anbindung.');
   const {deviceIds,zoneIds}=this.chooseTargets(active,compatible,input);
   // A failed driver write must not widen the next command to unrelated devices.
   this.lastTargets=deviceIds;this.lastZoneIds=zoneIds;
   const settings={...this.lastSettings,colors:[...this.lastSettings.colors]},native=parseNative(input.effect);
   if(input.type==='color'){settings.effect='static';settings.colors=[input.color.toLowerCase()];}
   if(input.type==='effect'&&!native)settings.effect=input.effect;
   if(input.type==='brightness')settings.brightness=input.brightness;
   if(input.type==='on')settings.brightness=settings.brightness>0?settings.brightness:this.lastBrightness;
   const selected=deviceIds.map(id=>compatible.find(device=>device.id===id));
   const direct=selected.filter(device=>device.directMode&&!native),plan=[];
   if(direct.length){const ids=direct.map(device=>device.id),zones=Object.fromEntries(ids.filter(id=>zoneIds[id]).map(id=>[id,zoneIds[id]]));plan.push({route:'apply',body:{...settings,...(input.type==='off'?{brightness:0}:{}),deviceIds:ids,...(Object.keys(zones).length?{zoneIds:zones}:{})}});}
   for(const device of selected.filter(device=>!device.directMode||native))plan.push(this.nativePlan(device,input,settings));
   // Validate every provider and selected zone before the first write. Hardware
   // failures can still be partial; exact acknowledgements are required below.
   await this.validatePlan(plan);
   for(const step of plan){
    const result=await this.request(step.route,step.body);confirmed(result,step.body.deviceIds,step.route==='native-effect'?step.body.effectId:undefined);
    if(step.route==='native-effect'){
     if(step.resume)this.lastNativeSettings.set(step.device.id,step.resume);
     else if(!['off','all_off'].includes(step.effect.id.toLowerCase())){const {deviceIds:ignored,...saved}=step.body;this.lastNativeSettings.set(step.device.id,{...saved,colors:[...saved.colors]});}
    }
   }
   if(input.type==='off'&&direct.length)await this.request('stop',{deviceIds:direct.map(device=>device.id)});
   if(input.type!=='off'){this.lastSettings=settings;if(settings.brightness>0)this.lastBrightness=settings.brightness;}
   this.lastTargets=deviceIds;this.lastZoneIds=zoneIds;this.error='';this.revision++;
   try{await fsp.mkdir(this.directory,{recursive:true});const file=path.join(this.directory,'voice-settings.json');await fsp.writeFile(file+'.tmp',JSON.stringify({settings:this.lastSettings,lastBrightness:this.lastBrightness}));await fsp.rename(file+'.tmp',file);}catch{this.error='RGB geändert; die Einstellung konnte nicht gespeichert werden.';}
   this.changed();
   this.rememberSelections();
   const text=input.type==='off'?'RGB-Beleuchtung ausgeschaltet.':input.type==='on'?'RGB-Beleuchtung eingeschaltet.':input.type==='color'?'RGB-Farbe angewendet.':input.type==='effect'?`RGB-Effekt ${this.catalog().effects.find(effect=>effect.id===input.effect)?.name||EFFECT_NAMES[input.effect]} angewendet.`:`RGB-Helligkeit auf ${input.brightness} Prozent gestellt.`;
   return {ok:true,text};
  }catch(e){this.rememberSelections();this.error=e.message;this.changed();throw e;}
 }
 async dispose(bridge){bridge.engine.stop();if(bridge.engine.framePromise)await bridge.engine.framePromise.catch(()=>{});await bridge.client.close();await new Promise(resolve=>{bridge.server.close(resolve);bridge.server.closeIdleConnections?.();});}
 async stop(){this.stopping=true;try{if(this.starting)await this.starting.catch(()=>{});await this.queue;const bridge=this.bridge;this.bridge=null;this.url=null;this.lastTargets=[];this.lastZoneIds={};this.seenSelections.clear();this.lastNativeSettings.clear();if(bridge)await this.dispose(bridge);this.changed();return {ok:true};}finally{this.stopping=false;}}
 async close(){this.closed=true;await this.stop();}
}
module.exports={RgbService,EFFECT_NAMES};
