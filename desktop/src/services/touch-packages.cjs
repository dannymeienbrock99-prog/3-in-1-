'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const yauzl=require('yauzl');
const LIMITS={archive:256*1024*1024,expanded:512*1024*1024,entry:128*1024*1024,entries:10000,manifest:1024*1024,icons:5000,image:4*1024*1024};
const imageExtensions=new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const clean=(value,max=120)=>typeof value==='string'?value.trim().slice(0,max):'';
function safeId(value){if(typeof value!=='string'||value.length>180||!/[a-zA-Z0-9]/.test(value)||!/^[a-zA-Z0-9._-]+$/.test(value)||['__proto__','constructor','prototype'].includes(value))throw Error('Das Paket enthält eine ungültige Kennung.');relativeName(value);return value;}
function relativeName(value){
 if(typeof value!=='string'||!value||value.length>600||value.includes('\\')||/[\x00-\x1f:]/.test(value)||value.startsWith('/'))throw Error('Das Paket enthält einen ungültigen Dateipfad.');
 const parts=value.replace(/\/$/,'').split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error('Das Paket enthält einen unsicheren Dateipfad.');
 return parts.join('/');
}
function inside(root,relative){const safe=relativeName(relative),file=path.resolve(root,...safe.split('/'));if(!file.startsWith(path.resolve(root)+path.sep))throw Error('Datei liegt außerhalb des Pakets.');return file;}
function readJson(file,max=LIMITS.manifest){const stat=fs.statSync(file);if(!stat.isFile()||stat.size>max)throw Error('Paket-Metadaten sind zu groß.');const data=fs.readFileSync(file);if(data.subarray(0,6).toString()==='ELGATO')throw Error('Dieses Marketplace-Paket ist geschützt und benötigt die Elgato-Laufzeit.');return JSON.parse(data.toString('utf8').replace(/^\uFEFF/,''));}
function saveJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch{}}}
function findAsset(root,relative){
 if(!relative)return null;const file=inside(root,relative);for(const candidate of path.extname(file)?[file]:[file,...[...imageExtensions].map(ext=>file+ext)]){
  try{if(fs.statSync(candidate).isFile()&&fs.realpathSync(candidate).startsWith(fs.realpathSync(root)+path.sep))return candidate;}catch{}
 }return null;
}
async function extract(filename,directory){
 const stat=fs.statSync(filename);if(!stat.isFile()||stat.size>LIMITS.archive)throw Error('Das Paket darf höchstens 256 MB groß sein.');
 const zip=await new Promise((resolve,reject)=>yauzl.open(filename,{lazyEntries:true,autoClose:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z)));
 if(zip.entryCount>LIMITS.entries){zip.close();throw Error('Das Paket enthält zu viele Dateien.');}
 let total=0,written=0;const entries=[],seen=new Set();
 return new Promise((resolve,reject)=>{
  let done=false;const fail=e=>{if(done)return;done=true;zip.close();reject(e);};zip.on('error',fail);zip.on('end',()=>{if(!done){done=true;resolve(entries);}});
  zip.on('entry',entry=>{(async()=>{
   const name=relativeName(entry.fileName),key=name.toLocaleLowerCase('en-US');if(seen.has(key))throw Error('Das Paket enthält doppelte Dateinamen.');seen.add(key);
   const mode=(entry.externalFileAttributes>>>16)&0xf000;
   if(mode===0xa000||(mode!==0&&mode!==0x8000&&mode!==0x4000)||(entry.generalPurposeBitFlag&1))throw Error('Verknüpfte oder verschlüsselte Paketdateien werden nicht unterstützt.');
   total+=entry.uncompressedSize;if(!Number.isSafeInteger(total)||total>LIMITS.expanded||entry.uncompressedSize>LIMITS.entry)throw Error('Das entpackte Paket überschreitet die Größenbegrenzung.');
   if(entry.fileName.endsWith('/')){zip.readEntry();return;}
   const output=inside(directory,name);fs.mkdirSync(path.dirname(output),{recursive:true});
   const source=await new Promise((res,rej)=>zip.openReadStream(entry,(e,s)=>e?rej(e):res(s)));let entryWritten=0;
   const count=new Transform({transform(chunk,encoding,callback){entryWritten+=chunk.length;written+=chunk.length;if(entryWritten>LIMITS.entry||written>LIMITS.expanded)return callback(Error('Paket überschreitet die Größenbegrenzung.'));callback(null,chunk);}});
   await pipeline(source,count,fs.createWriteStream(output,{flags:'wx',mode:0o600}));entries.push(name);zip.readEntry();
  })().catch(fail);});zip.readEntry();
 });
}
function inspect(directory){
 const manifest=readJson(path.join(directory,'manifest.json'));if(!object(manifest))throw Error('Das Manifest ist ungültig.');
 const kind=path.basename(directory).toLowerCase().endsWith('.sdiconpack')?'icons':'plugin';
 const id=safeId(manifest.UUID||path.basename(directory).replace(/\.sd(?:Plugin|IconPack)$/i,''));
 const result={id,kind,name:clean(manifest.Name)||id,version:clean(manifest.Version,40)||'1',author:clean(manifest.Author),directory,manifest};
 if(kind==='icons'){
  const source=readJson(path.join(directory,'icons.json'),4*1024*1024);if(!Array.isArray(source)||source.length>LIMITS.icons)throw Error('Ungültige Icon-Liste.');
  result.icons=source.map((entry,index)=>{if(!object(entry))throw Error('Ungültiger Icon-Eintrag.');const file=findAsset(directory,'icons/'+relativeName(entry.path));if(!file||!imageExtensions.has(path.extname(file).toLowerCase()))throw Error('Ein Icon im Paket fehlt oder hat ein unbekanntes Format.');return {id:String(index),name:clean(entry.name)||path.basename(file),tags:Array.isArray(entry.tags)?entry.tags.map(t=>clean(t,40)).slice(0,30):[],file};});
 }else{
  const raw=manifest.CodePathWin||manifest.CodePath;if(typeof raw!=='string')throw Error('Dieses Plugin hat keinen Windows-Startpfad.');
  result.code=findAsset(directory,raw)||(!path.extname(raw)?findAsset(directory,raw+'.exe'):null);if(!result.code)throw Error('Die Startdatei des Plugins fehlt.');
  const ext=path.extname(result.code).toLowerCase();result.runtime=ext==='.exe'?'exe':['.js','.cjs','.mjs'].includes(ext)?'node':['.html','.htm'].includes(ext)?'html':'unsupported';
  result.compatibility=result.runtime==='unsupported'?'Nicht unterstützter Programmtyp':(manifest.OS?.length&&!manifest.OS.some(os=>os.Platform==='windows'))?'Dieses Plugin unterstützt Windows nicht.':Number(manifest.SDKVersion)>2?'Diese SDK-Version wird noch nicht unterstützt.':'Standard-Tastenaktionen';
  result.supported=result.compatibility==='Standard-Tastenaktionen';
  if(!Array.isArray(manifest.Actions)||manifest.Actions.length>500)throw Error('Die Aktionsliste des Plugins ist ungültig.');
  const ids=new Set();result.actions=manifest.Actions.map(action=>{
   const actionId=safeId(action.UUID);if(ids.has(actionId))throw Error('Plugin enthält doppelte Aktionen.');ids.add(actionId);
   const inspector=action.PropertyInspectorPath||manifest.PropertyInspectorPath;
   return {id:actionId,name:clean(action.Name)||actionId,hasInspector:!!inspector,inspector:inspector?findAsset(directory,inspector):null,supported:!Array.isArray(action.Controllers)||action.Controllers.includes('Keypad'),icon:action.Icon,states:Array.isArray(action.States)?action.States.slice(0,32):[]};
  });
 }
 return result;
}
function checkImage(value){
 if(typeof value!=='string')throw Error('Ungültiges Bild.');
 const data=value.startsWith('data:')?value:null;let bytes,extension;
 if(data){if(data.length>LIMITS.image*1.4)throw Error('Tastenbild ist zu groß.');const match=/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)(;base64)?,([\s\S]+)$/.exec(data);if(!match)throw Error('Nicht unterstütztes Tastenbild.');extension=match[1];bytes=match[2]?Buffer.from(match[3],'base64'):Buffer.from(decodeURIComponent(match[3]));}
 else{extension=path.extname(value).toLowerCase();const stat=fs.statSync(value);if(!stat.isFile()||stat.size>LIMITS.image)throw Error('Tastenbild darf höchstens 4 MB groß sein.');bytes=fs.readFileSync(value);}
 if(bytes.length>LIMITS.image)throw Error('Tastenbild ist zu groß.');
 if(extension.includes('svg')){const svg=bytes.toString('utf8');if(/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|\bon[a-z]+\s*=|@import|url\s*\(\s*['"]?(?!#)|(?:href|src)\s*=\s*['"](?!#|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(svg))throw Error('SVG-Bilder dürfen keine externen Inhalte oder Skripte laden.');}
 return value;
}
class TouchPackages{
 constructor({directory,convertImage}={}){
  if(!directory)throw Error('Paketordner fehlt.');this.directory=path.resolve(directory);this.convertImage=convertImage;this.indexFile=path.join(this.directory,'packages.json');this.packages=new Map();this.cache=new Map();this.importing=false;this.errors=[];
  if(fs.existsSync(this.indexFile))try{const entries=readJson(this.indexFile);if(!Array.isArray(entries)||entries.length>150)throw Error('Ungültiges Paketverzeichnis.');for(const relative of entries)try{const p=inspect(inside(this.directory,relative));this.packages.set(p.id,p);}catch(error){this.errors.push(error.message);}}catch(error){this.errors.push(error.message);}
 }
 list(){return {plugins:[...this.packages.values()].filter(p=>p.kind==='plugin').map(p=>({id:p.id,name:p.name,version:p.version,supported:p.supported,compatibility:p.compatibility,actions:p.actions.map(({id,name,hasInspector,supported})=>({id,name,hasInspector,supported}))})),iconPacks:[...this.packages.values()].filter(p=>p.kind==='icons').map(p=>({id:p.id,name:p.name,version:p.version,count:p.icons.length})),errors:[...this.errors]};}
 getPlugin(id){const p=this.packages.get(id);if(!p||p.kind!=='plugin')throw Error('Dieses Plugin ist nicht installiert.');return p;}
 async importFile(filename){
  if(this.importing)throw Error('Ein Paket wird gerade importiert.');if(!/\.(streamDeckPlugin|streamDeckIconPack)$/i.test(filename))throw Error('Bitte eine .streamDeckPlugin- oder .streamDeckIconPack-Datei wählen.');
  this.importing=true;fs.mkdirSync(this.directory,{recursive:true});const staging=path.join(this.directory,'.import-'+crypto.randomUUID());fs.mkdirSync(staging);let destination;
  try{
   const entries=await extract(filename,staging),manifests=entries.filter(name=>/(?:^|\/)[^/]+\.sd(?:Plugin|IconPack)\/manifest\.json$/i.test(name));
   if(manifests.length!==1)throw Error('Das Archiv muss genau ein Plugin- oder Icon-Paket enthalten.');
   const root=path.dirname(inside(staging,manifests[0])),pkg=inspect(root);if(pkg.kind==='plugin'&&!/\.streamDeckPlugin$/i.test(filename)||pkg.kind==='icons'&&!/\.streamDeckIconPack$/i.test(filename))throw Error('Dateiendung und Paketinhalt passen nicht zusammen.');
   const version=crypto.createHash('sha256').update(JSON.stringify(pkg.manifest)).update(crypto.randomBytes(8)).digest('hex').slice(0,16);
   destination=path.join(this.directory,pkg.id,version,path.basename(root));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(root,destination);
   const installed=inspect(destination),next=new Map(this.packages);next.set(installed.id,installed);if(next.size>150)throw Error('Es sind bereits 150 Pakete installiert.');
   saveJson(this.indexFile,[...next.values()].map(p=>path.relative(this.directory,p.directory).split(path.sep).join('/')));this.packages=next;this.cache.clear();destination=null;return {id:installed.id,kind:installed.kind,...this.list()};
  }finally{this.importing=false;fs.rmSync(staging,{recursive:true,force:true});if(destination)fs.rmSync(destination,{recursive:true,force:true});}
 }
 icons({packId,offset=0,limit=60,query=''}={}){const pkg=this.packages.get(packId);if(!pkg||pkg.kind!=='icons')throw Error('Icon-Paket nicht gefunden.');const search=clean(query,100).toLocaleLowerCase(),items=pkg.icons.filter(i=>!search||(i.name+' '+i.tags.join(' ')).toLocaleLowerCase().includes(search));offset=Number.isInteger(offset)?Math.max(0,offset):0;limit=Number.isInteger(limit)?Math.min(80,Math.max(1,limit)):60;return {total:items.length,offset,items:items.slice(offset,offset+limit).map(({id,name,tags})=>({id,name,tags}))};}
 async convert(value){checkImage(value);const key=value.startsWith('data:')?crypto.createHash('sha256').update(value).digest('hex'):value;if(this.cache.has(key))return this.cache.get(key);let data;if(this.convertImage)data=await this.convertImage(value);else if(!value.startsWith('data:')&&path.extname(value).toLowerCase()==='.png')data='data:image/png;base64,'+fs.readFileSync(value).toString('base64');else if(value.startsWith('data:image/png;base64,'))data=value;else throw Error('Dieses Bildformat benötigt die Batto-Bildkonvertierung.');if(typeof data!=='string'||!data.startsWith('data:image/png;base64,')||data.length>131072)throw Error('Konvertiertes Tastenbild ist zu groß.');this.cache.set(key,data);while(this.cache.size>48)this.cache.delete(this.cache.keys().next().value);return data;}
 async icon({packId,iconId}={}){const pkg=this.packages.get(packId),entry=pkg?.kind==='icons'?pkg.icons.find(i=>i.id===iconId):null;if(!entry)throw Error('Icon nicht gefunden.');return this.convert(entry.file);}
 async actionIcon(pluginId,actionId,state=0){const pkg=this.getPlugin(pluginId),action=pkg.actions.find(a=>a.id===actionId);if(!action)return '';const asset=findAsset(pkg.directory,action.states[state]?.Image||action.icon||pkg.manifest.Icon);return asset?this.convert(asset):'';}
 async pluginImage(pluginId,value){const pkg=this.getPlugin(pluginId);if(!value)return '';const asset=value.startsWith('data:')?value:findAsset(pkg.directory,value);if(!asset)throw Error('Plugin-Bild nicht gefunden.');return this.convert(asset);}
}
module.exports={TouchPackages,LIMITS,relativeName,inside,checkImage,inspect,saveJson};
