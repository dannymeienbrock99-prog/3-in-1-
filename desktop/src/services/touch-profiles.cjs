'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),yauzl=require('yauzl');
const {relativeName,checkImage}=require('./touch-packages.cjs');
const {normalizeConfig}=require('./touch-deck.cjs');
const LIMITS={archive:64*1024*1024,expanded:128*1024*1024,entry:16*1024*1024,entries:5000,manifest:1024*1024,images:4*1024*1024,nested:8,settings:4*1024*1024};
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=80)=>typeof value==='string'?value.trim().slice(0,max):'';
const key=value=>value.toLocaleLowerCase('en-US');
function json(bytes){if(bytes.length>LIMITS.manifest)throw Error('Profil-Metadaten sind zu groß.');if(bytes.subarray(0,6).toString()==='ELGATO')throw Error('Dieses Profil ist geschützt und benötigt die originale Elgato-Laufzeit.');let value;try{value=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('Das Profil enthält beschädigte Metadaten.');}if(!record(value))throw Error('Ungültige Profil-Metadaten.');return value;}
async function readArchive(source,budget){
 if(Buffer.isBuffer(source)){if(source.length>LIMITS.archive)throw Error('Profilarchiv ist zu groß.');}else{const stat=fs.statSync(source);if(!stat.isFile()||stat.size>LIMITS.archive)throw Error('Das Profilarchiv darf höchstens 64 MB groß sein.');}
 const archive=await new Promise((resolve,reject)=>(Buffer.isBuffer(source)?yauzl.fromBuffer:yauzl.open)(source,{lazyEntries:true,autoClose:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>error?reject(Error('Das Profilarchiv ist beschädigt oder hat ein unbekanntes Format.')):resolve(zip)));
 const files=new Map(),seen=new Set();
 return new Promise((resolve,reject)=>{
  let done=false;const fail=error=>{if(done)return;done=true;archive.close();reject(error);};archive.on('error',fail);archive.on('end',()=>{if(!done){done=true;resolve(files);}});
  archive.on('entry',entry=>{(async()=>{
   const name=relativeName(entry.fileName),normalized=key(name),mode=(entry.externalFileAttributes>>>16)&0xf000;
   if(seen.has(normalized))throw Error('Das Profilarchiv enthält doppelte Dateinamen.');seen.add(normalized);
   if(mode===0xa000||(mode!==0&&mode!==0x8000&&mode!==0x4000)||(entry.generalPurposeBitFlag&1))throw Error('Verknüpfte oder verschlüsselte Profildateien werden nicht unterstützt.');
   budget.entries++;budget.expanded+=entry.uncompressedSize;if(budget.entries>LIMITS.entries||!Number.isSafeInteger(budget.expanded)||budget.expanded>LIMITS.expanded||entry.uncompressedSize>LIMITS.entry)throw Error('Das Profilarchiv überschreitet die Größenbegrenzung.');
   const wanted=/manifest\.json$|\.(png|jpg|jpeg|gif|webp|svg|streamDeckProfile)$/i.test(name);
   if(!wanted||entry.fileName.endsWith('/')){archive.readEntry();return;}
   if(/manifest\.json$/i.test(name)&&entry.uncompressedSize>LIMITS.manifest)throw Error('Profil-Metadaten sind zu groß.');
   const stream=await new Promise((res,rej)=>archive.openReadStream(entry,(error,value)=>error?rej(error):res(value))),chunks=[];let length=0;
   for await(const chunk of stream){length+=chunk.length;if(length>LIMITS.entry)throw Error('Eine Profildatei ist zu groß.');chunks.push(chunk);}files.set(normalized,{name,bytes:Buffer.concat(chunks)});archive.readEntry();
  })().catch(fail);});archive.readEntry();
 });
}
async function importStreamDeckProfiles(filename,{packages,convertImage,catalog={actions:[]}}={}){
 if(typeof filename!=='string'||!(/\.(streamDeckProfile|zip)$/i.test(filename)))throw Error('Bitte eine .streamDeckProfile- oder Profil-ZIP-Datei wählen.');
 const budget={entries:0,expanded:0,nested:0},outer=await readArchive(filename,budget),archives=[],warnings=[],settingsByButton=Object.create(null),profiles=[];let buttons=0;
 const warn=value=>{if(warnings.length<600)warnings.push(value);};
 const nested=[...outer.values()].filter(entry=>/\.streamDeckProfile$/i.test(entry.name));
 if(nested.length){const windows=nested.filter(entry=>/(?:^|\/)(?:windows|win)(?:\/|_)/i.test(entry.name));for(const entry of windows.length?windows:nested){if(++budget.nested>LIMITS.nested)throw Error('Das ZIP enthält zu viele Profile.');archives.push(await readArchive(entry.bytes,budget));}if(windows.length&&windows.length<nested.length)warn('Die Windows-Profile wurden gewählt; zusätzliche macOS-Varianten wurden ausgelassen.');}
 else archives.push(outer);
 for(const files of archives){
  const roots=[...files.values()].filter(entry=>/(?:^|\/)[^/]+\.sdProfile\/manifest\.json$/i.test(entry.name));
  if(!roots.length)throw Error('Das Archiv enthält kein unterstütztes Stream-Deck-Profil.');
  for(const root of roots){
   const metadata=json(root.bytes),directory=path.posix.dirname(root.name),prefix=key(directory+'/Profiles/'),pages=new Map();
   for(const entry of files.values())if(key(entry.name).startsWith(prefix)&&/^[^/]+\/manifest\.json$/i.test(entry.name.slice(prefix.length))){const id=key(entry.name.slice(prefix.length).split('/')[0]);pages.set(id,{...entry,data:json(entry.bytes)});}
   if(!pages.size&&Array.isArray(metadata.Controllers))pages.set('main',{...root,data:metadata});
   if(!pages.size)throw Error('Im Profil fehlen die Tastenseiten.');
   const pageKeys=page=>{const result=[];if(!Array.isArray(page.data.Controllers))throw Error('Ungültige Profil-Bedienflächen.');for(const controller of page.data.Controllers){if(!record(controller))throw Error('Ungültige Profil-Bedienfläche.');if(controller.Type!=='Keypad'){if(Object.keys(controller.Actions||{}).length)warn('Drehregler aus „'+(text(metadata.Name)||'Profil')+'“ benötigen die Elgato-Laufzeit und wurden ausgelassen.');continue;}const actions=controller.Actions??{};if(!record(actions))throw Error('Ungültige Tastenliste im Profil.');for(const [coordinate,action]of Object.entries(actions)){const match=/^([0-7]),([0-5])$/.exec(coordinate);if(!match||!record(action))throw Error('Das Profil enthält eine ungültige Tastenposition.');result.push({column:Number(match[1]),row:Number(match[2]),action});}}return result;};
   const keyLists=new Map([...pages].map(([id,page])=>[id,pageKeys(page)]));let columns=2,rows=1;for(const keys of keyLists.values())for(const position of keys){columns=Math.max(columns,position.column+1);rows=Math.max(rows,position.row+1);}const capacity=columns*rows;
   const declared=metadata.Pages,order=[];for(const id of [declared?.Default,...(Array.isArray(declared?.Pages)?declared.Pages:[])])if(typeof id==='string'&&!order.includes(key(id))){if(pages.has(key(id)))order.push(key(id));else warn('Eine im Profil referenzierte Seite fehlt; verfügbare Seiten bleiben erhalten.');}
   if(!order.length)order.push(...pages.keys());
   const nonempty=order.filter(id=>keyLists.get(id).length);if(nonempty.length&&nonempty.length!==order.length){warn('Leere Startseiten wurden ausgelassen; die belegten Seiten bleiben in ihrer Reihenfolge.');order.splice(0,order.length,...nonempty);}
   const current=declared?.Current;if(typeof current==='string'&&!pages.has(key(current)))warn('Die zuletzt gewählte Elgato-Seite fehlt. Eine vorhandene Seite wurde übernommen.');
   async function imageFor(action,page){const state=action.States?.[Number.isInteger(action.State)?action.State:0]||action.States?.[0],image=state?.Image;if(typeof image!=='string'||!image)return '';try{const relative=relativeName(image),entry=files.get(key(path.posix.dirname(page.name)+'/'+relative))||files.get(key(directory+'/'+relative));if(!entry||entry.bytes.length>LIMITS.images)throw Error('Bild fehlt oder ist zu groß.');const extension=path.extname(relative).slice(1).toLowerCase(),mime={png:'png',jpg:'jpeg',jpeg:'jpeg',gif:'gif',webp:'webp',svg:'svg+xml'}[extension];if(!mime)throw Error('Bildformat nicht unterstützt.');const data='data:image/'+mime+';base64,'+entry.bytes.toString('base64');checkImage(data);return convertImage?await convertImage(data):packages?.convert?await packages.convert(data):mime==='png'&&data.length<=131072?data:'';}catch{warn('Ein Tastenbild konnte nicht übernommen werden.');return '';}}
   async function convertPage(id,ancestors=[]){if(ancestors.includes(id))throw Error('Das Profil enthält einen Ordnerkreis.');if(ancestors.length>4)throw Error('Profilordner dürfen höchstens vier Ebenen tief sein.');const page=pages.get(id);if(!page)throw Error('Ein Profilordner fehlt.');const result=Array(capacity).fill(null);
    for(const {column,row,action}of keyLists.get(id)){const index=row*columns+column;if(result[index])throw Error('Das Profil belegt eine Position mehrfach.');const actionId=action.UUID;if(typeof actionId!=='string'||!/^[a-zA-Z0-9_.-]{1,200}$/.test(actionId))throw Error('Ungültige Profilaktion.');if(actionId==='com.elgato.streamdeck.profile.backtoparent'){warn('Die Elgato-Zurücktaste wird durch die Batto-Ordnerleiste ersetzt.');continue;}
     if(++buttons>600)throw Error('Das Profil enthält zu viele Tasten.');const state=action.States?.[Number.isInteger(action.State)?action.State:0]||action.States?.[0],button={id:crypto.randomUUID(),type:'plugin',title:text(state?.Title)||text(action.Name)||'Importierte Taste',symbol:'◆'},icon=await imageFor(action,page);if(icon)button.icon=icon;
     if(actionId==='com.elgato.streamdeck.profile.openchild'){const target=action.Settings?.ProfileUUID;if(typeof target!=='string'||!pages.has(key(target)))throw Error('Ein importierter Ordner verweist auf eine fehlende Seite.');button.type='folder';button.symbol='📁';button.buttons=await convertPage(key(target),[...ancestors,id]);}
     else{const pluginId=action.Plugin?.UUID||actionId;if(typeof pluginId!=='string'||!/^[a-zA-Z0-9_.-]{1,150}$/.test(pluginId))throw Error('Ungültige Plugin-Kennung im Profil.');button.pluginId=pluginId;button.actionId=actionId;let installed,definition;try{installed=packages?.getPlugin(pluginId);definition=installed?.actions.find(item=>item.id===actionId);}catch{}
      if(!installed?.supported||!definition?.supported)warn('„'+button.title+'“: '+(actionId.startsWith('com.elgato.streamdeck.')?'Diese integrierte Elgato-Aktion benötigt die originale Stream-Deck-Laufzeit.':'Das zugehörige Plugin ist im Batto Touch Deck nicht ausführbar oder noch nicht installiert.'));
      if(action.Actions)warn('„'+button.title+'“: Die Elgato-Kombination benötigt die originale Laufzeit; Teilaktionen wurden nicht einzeln ausgeführt.');
      if(action.Settings!==undefined){if(!record(action.Settings)||Buffer.byteLength(JSON.stringify(action.Settings))>131072)throw Error('Plugin-Einstellungen im Profil sind ungültig oder zu groß.');settingsByButton[button.id]={pluginId,actionId,settings:JSON.parse(JSON.stringify(action.Settings))};if(Buffer.byteLength(JSON.stringify(settingsByButton))>LIMITS.settings)throw Error('Die Plugin-Einstellungen im Profil sind zu groß.');}}
     result[index]=button;
    }return result;
   }
   for(let index=0;index<order.length;index++){if(profiles.length>=20)throw Error('Das Archiv enthält zu viele Profile.');const page=pages.get(order[index]),name=text(metadata.Name)||'Elgato-Profil';profiles.push({id:crypto.randomUUID(),name:text(name+(order.length>1?' · '+(text(page.data.Name)||'Seite '+(index+1)):'')),columns,rows,keySize:'auto',buttons:await convertPage(order[index])});}
  }
 }
 const validated=normalizeConfig({version:1,activeProfile:profiles[0]?.id,profiles},catalog);if(Buffer.byteLength(JSON.stringify(validated))>4*1024*1024)throw Error('Die importierten Profile mit Tastenbildern sind zu groß.');
 return {profiles:validated.profiles,warnings:[...new Set(warnings)],settingsByButton};
}
module.exports={importStreamDeckProfiles,LIMITS};
