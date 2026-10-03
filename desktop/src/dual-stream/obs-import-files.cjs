'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const MAX_BYTES=4*1024*1024,MAX_COLLECTIONS=100,MAX_ENTRIES=1000;
const label=file=>path.basename(file).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,180);
const idFor=name=>createHash('sha256').update(name).digest('hex');
function entries(directory){
 let dir;try{dir=fs.opendirSync(directory);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return {rows:[],truncated:false};throw Error('Der OBS-Szenenordner kann nicht gelesen werden. Bitte eine exportierte JSON-Datei auswählen.');}
 const rows=[];let count=0,truncated=false;
 try{for(let entry;(entry=dir.readSync());){if(++count>MAX_ENTRIES){truncated=true;break;}if(!entry.isFile()||!/^.+\.json$/i.test(entry.name))continue;
   if(rows.length===MAX_COLLECTIONS){truncated=true;break;}rows.push({id:idFor(entry.name),name:label(entry.name).replace(/\.json$/i,''),file:path.join(directory,entry.name)});
  }}finally{dir.closeSync();}
 rows.sort((a,b)=>a.name.localeCompare(b.name,'de'));
 return {rows,truncated};
}
function listCollections(directory){const {rows,truncated}=entries(directory);return {collections:rows.map(({id,name})=>({id,name})),truncated};}
function localCollectionFile(directory,value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string'||!/^[a-f0-9]{64}$/.test(value.id))throw Error('Bitte eine vorhandene OBS-Szenensammlung aus der Liste auswählen.');
 const selected=entries(directory).rows.find(row=>row.id===value.id);
 if(!selected)throw Error('Die OBS-Szenensammlung ist nicht mehr vorhanden. Bitte die Liste erneut öffnen.');
 return selected.file;
}
function readCollectionFile(file){
 const prefix='„'+label(file)+'“: ';let fd;
 try{
  // Refuse directories and symbolic links; never allocate from an untrusted size.
  if(!fs.lstatSync(file).isFile())throw Error('Bitte eine normale OBS-JSON-Datei auswählen.');
  fd=fs.openSync(file,'r');const stat=fs.fstatSync(fd);
  if(!stat.isFile())throw Error('Bitte eine normale OBS-JSON-Datei auswählen.');
  if(stat.size>MAX_BYTES)throw Error('Die OBS-Szenensammlung ist zu groß (maximal 4 MB).');
  const buffer=Buffer.allocUnsafe(stat.size+1);let length=0,read;
  while(length<buffer.length&&(read=fs.readSync(fd,buffer,length,buffer.length-length,null))>0)length+=read;
  if(length>MAX_BYTES)throw Error('Die OBS-Szenensammlung ist zu groß (maximal 4 MB).');
  if(length>stat.size)throw Error('Die OBS-Datei wurde gerade geändert. Bitte erneut auswählen.');
  let data;try{data=JSON.parse(buffer.subarray(0,length).toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('Die Datei enthält keine lesbare OBS-Szenensammlung. In OBS unter „Szenensammlung → Exportieren“ eine JSON-Datei speichern.');}
  if(data?.document_type==='project_configuration_specification'||(data?.version===1&&data?.layouts&&data?.sources&&!Array.isArray(data.sources)))throw Error('Das ist ein Batto-Dual-Stream-Projekt. Dafür bitte „Projekt importieren“ verwenden. Für OBS-Szenen „Direkt aus OBS“ wählen oder in OBS unter „Szenensammlung → Exportieren“ speichern.');
  return data;
 }catch(error){if(error.code)throw Error(prefix+'Die Datei kann nicht gelesen werden. Bitte erneut auswählen.');throw Error(prefix+error.message);}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
module.exports={listCollections,localCollectionFile,readCollectionFile,MAX_BYTES};
