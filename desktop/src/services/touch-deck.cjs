'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {TouchMobile}=require('./touch-mobile.cjs');
const LIMITS={profiles:20,buttons:600,depth:4,icon:131072,file:4*1024*1024};
const copy=value=>JSON.parse(JSON.stringify(value));
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function short(value,max,fallback=''){return typeof value==='string'?value.trim().slice(0,max):fallback;}
function identifier(value){return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:crypto.randomUUID();}
function pngIcon(value){
 if(value===undefined||value==='')return undefined;
 if(typeof value!=='string'||value.length>LIMITS.icon||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Tastenbilder müssen kleine PNG-Bilder sein (höchstens 128 KB).');
 const bytes=Buffer.from(value.slice(22),'base64');
 if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)throw Error('Tastenbilder dürfen höchstens 512 × 512 Pixel groß sein.');
 return value;
}
function normalizeStep(step,actions){
 if(!record(step)||typeof step.action!=='string'||!actions.has(step.action))throw Error('Diese Tastenaktion wird nicht unterstützt.');
 const definition=actions.get(step.action),result={action:step.action};
 if(definition.choices){if(typeof step.target!=='string'||!step.target.trim()||step.target.length>256)throw Error('Bitte ein Ziel für die Tastenaktion wählen.');result.target=step.target;}
 if(definition.switch){if(!['on','off','toggle'].includes(step.op||'toggle'))throw Error('Ungültiger Schalter.');result.op=step.op||'toggle';}
 if(step.action==='command'){if(typeof step.text!=='string'||!step.text.trim()||step.text.length>500)throw Error('Bitte einen kurzen Jarvis-Befehl eintragen.');result.text=step.text.trim();}
 if(step.action==='scene'){
  if(step.transition!==undefined){if(!['fade','cut'].includes(step.transition))throw Error('Ungültiger Übergang.');result.transition=step.transition;}
  if(step.durationMs!==undefined){if(!Number.isInteger(step.durationMs)||step.durationMs<100||step.durationMs>2000)throw Error('Die Übergangsdauer muss zwischen 100 und 2000 ms liegen.');result.durationMs=step.durationMs;}
 }
 return result;
}
function normalizeConfig(value,catalog){
 if(!record(value)||!Array.isArray(value.profiles)||!value.profiles.length||value.profiles.length>LIMITS.profiles)throw Error('Bitte 1 bis 20 Touch-Deck-Profile anlegen.');
 const actions=new Map((catalog?.actions||[]).map(a=>[a.id,a])),ids=new Set();let count=0;
 const uniqueId=value=>{const id=identifier(value);if(ids.has(id))throw Error('Profile und Tasten benötigen eindeutige Kennungen.');ids.add(id);return id;};
 function buttons(items,size,depth){
  if(!Array.isArray(items)||items.length>size)throw Error('Dieses Tastenraster enthält zu viele Tasten.');
  return Array.from({length:size},(_,i)=>{
   const button=items[i];if(button==null)return null;
   if(!record(button)||!['action','folder','sensor'].includes(button.type))throw Error('Unbekannte Tastenart.');
   if(++count>LIMITS.buttons)throw Error('Das Touch Deck enthält zu viele Tasten.');
   const result={id:uniqueId(button.id),type:button.type,title:short(button.title,80,'Taste')||'Taste',symbol:short(button.symbol,16)};
   const icon=pngIcon(button.icon);if(icon)result.icon=icon;
   if(button.type==='folder'){
    if(depth>=LIMITS.depth)throw Error('Ordner dürfen höchstens vier Ebenen tief sein.');
    result.buttons=buttons(button.buttons||[],size,depth+1);
   }else if(button.type==='sensor'){
    if(typeof button.sensorId!=='string'||!button.sensorId||button.sensorId.length>512)throw Error('Bitte einen PC-Messwert wählen.');result.sensorId=button.sensorId;
   }else{
    if(!Array.isArray(button.steps)||!button.steps.length||button.steps.length>8)throw Error('Eine Taste darf 1 bis 8 Aktionen enthalten.');
    result.steps=button.steps.map(step=>normalizeStep(step,actions));
   }
   return result;
  });
 }
 const profiles=value.profiles.map(profile=>{
  if(!record(profile))throw Error('Ungültiges Touch-Deck-Profil.');
  const columns=profile.columns??5,rows=profile.rows??3;
  if(!Number.isInteger(columns)||columns<2||columns>8||!Number.isInteger(rows)||rows<1||rows>6)throw Error('Das Raster darf 2 bis 8 Spalten und 1 bis 6 Zeilen haben.');
  return {id:uniqueId(profile.id),name:short(profile.name,80,'Mein Deck')||'Mein Deck',columns,rows,buttons:buttons(profile.buttons||[],columns*rows,0)};
 });
 return {version:1,activeProfile:profiles.some(p=>p.id===value.activeProfile)?value.activeProfile:profiles[0].id,profiles};
}
function defaultConfig(){
 const definitions=[['Jarvis fragen','◉',{action:'listen'}],['Jarvis still','◼',{action:'speech-stop'}],['Spiel','▶',{action:'scene',target:'Spiel'}],['Pause','Ⅱ',{action:'scene',target:'Pause'}],['Start','▶',{action:'scene',target:'Start'}],['Ende','■',{action:'scene',target:'Ende'}],['Kameras starten','▶',{action:'start',target:'both'}],['Kameras stoppen','■',{action:'stop',target:'both'}],['Kamera an / aus','◉',{action:'source',target:'camera',op:'toggle'}],['Spiel an / aus','▣',{action:'source',target:'game',op:'toggle'}],['Gaming-Modus','◇',{action:'gaming'}],['Batto öffnen','⌂',{action:'show'}],['Sprache an / aus','♫',{action:'jarvis',target:'voiceEnabled',op:'toggle'}],['Quellen vorbereiten','▧',{action:'prepare'}],['Video ausschalten','○',{action:'release'}]];
 return {version:1,activeProfile:'main',profiles:[{id:'main',name:'Mein Deck',columns:5,rows:3,buttons:definitions.map(([title,symbol,step],index)=>({id:'key-'+index,type:'action',title,symbol,steps:[step]}))}]};
}
class TouchDeck extends EventEmitter{
 constructor({directory,controls,getSensors=()=>[],webRoot,host,port,now}={}){
  super();if(!directory||!controls)throw Error('Touch Deck benötigt einen Speicherort und die Tastensteuerung.');
  Object.assign(this,{directory,controls,getSensors});this.file=path.join(directory,'touch-deck.json');this.loadError='';this.config=defaultConfig();this.revision=1;
  if(fs.existsSync(this.file))try{if(fs.statSync(this.file).size>LIMITS.file)throw Error('Touch-Deck-Datei zu groß.');this.config=normalizeConfig(JSON.parse(fs.readFileSync(this.file,'utf8')),this.catalog());}catch(error){this.loadError='Gespeichertes Touch Deck konnte nicht geladen werden: '+error.message;}
  this.mobile=new TouchMobile({deck:this,webRoot,host,port,now,onChange:()=>this.emit('change',this.snapshot())});
 }
 catalog(){return this.controls.catalog();}
 sensors(){
  try{return (this.getSensors()||[]).slice(0,2048).filter(s=>record(s)&&typeof s.id==='string').map(s=>({id:s.id.slice(0,512),name:short(s.name,100,s.id),value:typeof s.value==='number'&&Number.isFinite(s.value)?s.value:null,unit:short(s.unit,24)}));}catch{return [];}
 }
 snapshot(){return {...copy(this.config),sensors:this.sensors(),mobile:this.mobileStatus(),...(this.loadError?{error:this.loadError}:{})};}
 save(value){
  const config=normalizeConfig(value,this.catalog()),body=JSON.stringify(config,null,2);if(Buffer.byteLength(body)>LIMITS.file)throw Error('Touch-Deck-Datei zu groß.');
  fs.mkdirSync(this.directory,{recursive:true});const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,body,{encoding:'utf8',mode:0o600});fs.renameSync(temporary,this.file);}finally{try{fs.unlinkSync(temporary);}catch{}}
  this.config=config;this.revision++;this.loadError='';const snapshot=this.snapshot();this.emit('change',snapshot);return snapshot;
 }
 locate({profileId,path:folderPath=[],index}={}){
  if(typeof profileId!=='string'||!Array.isArray(folderPath)||folderPath.length>LIMITS.depth||!folderPath.every(i=>Number.isInteger(i)&&i>=0&&i<48)||!Number.isInteger(index)||index<0||index>=48)throw Error('Ungültige Tastenposition.');
  const profile=this.config.profiles.find(p=>p.id===profileId);if(!profile)throw Error('Dieses Profil gibt es nicht mehr.');
  let buttons=profile.buttons;for(const i of folderPath){if(buttons[i]?.type!=='folder')throw Error('Diesen Ordner gibt es nicht mehr.');buttons=buttons[i].buttons;}
  const button=buttons[index];if(!button)throw Error('Diese Taste ist noch nicht belegt.');return button;
 }
 async press(position){
  const button=this.locate(position);
  if(button.type==='folder')return {ok:true,type:'folder',path:[...(position.path||[]),position.index]};
  if(button.type==='sensor'){const sensor=this.sensors().find(s=>s.id===button.sensorId);return {ok:true,type:'sensor',value:sensor?.value??null,unit:sensor?.unit||'',name:sensor?.name||button.title};}
  return this.controls.execute({steps:copy(button.steps)});
 }
 remoteReadings(){
  const sensors=this.sensors(),byId=new Map(sensors.map(s=>[s.id,s])),readings=Object.create(null);
  const visit=buttons=>{for(const button of buttons){if(button?.type==='folder')visit(button.buttons);else if(button?.type==='sensor'){const s=byId.get(button.sensorId);readings[button.id]={value:s?.value??null,unit:s?.unit||'',name:s?.name||button.title};}}};
  for(const profile of this.config.profiles)visit(profile.buttons);return {revision:this.revision,readings};
 }
 remoteState(){
  const render=buttons=>buttons.map(button=>{
   if(!button)return null;const {id,type,title,symbol,icon}=button,result={id,type,title,symbol};if(icon)result.icon=icon;
   if(type==='folder')result.buttons=render(button.buttons);
   return result;
  });
  return {...this.remoteReadings(),version:1,activeProfile:this.config.activeProfile,profiles:this.config.profiles.map(({id,name,columns,rows,buttons})=>({id,name,columns,rows,buttons:render(buttons)}))};
 }
 mobileStatus(){return this.mobile?.status()||{running:false,port:0,urls:[],pin:'',clients:0};}
 mobileStart(){return this.mobile.start();}
 mobileStop(){return this.mobile.stop();}
 rotatePin(){return this.mobile.rotatePin();}
 async close(){await this.mobile.stop();this.removeAllListeners();}
}
module.exports={TouchDeck,normalizeConfig,defaultConfig,LIMITS};
