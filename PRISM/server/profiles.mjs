import path from 'node:path';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { BridgeError } from './openrgb.mjs';
import { validateSettings } from './effects.mjs';
export function validateProfiles(value){
 if(!Array.isArray(value)||value.length>100)throw new BridgeError('Maximal 100 gültige Lichtprofile erwartet.','INVALID_PROFILES',400);
 const ids=new Set();
 return value.map(p=>{
  if(!p||typeof p!=='object'||typeof p.id!=='string'||!p.id||p.id.length>80||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60)throw new BridgeError('Ein Lichtprofil ist ungültig.','INVALID_PROFILES',400);
  ids.add(p.id);return {id:p.id,name:p.name.trim(),config:validateSettings(p.config)};
 });
}
export async function readProfiles(directory){try{const data=await readFile(path.join(directory,'profiles.json'),'utf8');if(Buffer.byteLength(data)>128*1024)throw Error('Profildatei zu groß.');return validateProfiles(JSON.parse(data));}catch(e){if(e.code==='ENOENT')return [];throw new BridgeError('Gespeicherte Lichtprofile konnten nicht gelesen werden.','PROFILES_UNAVAILABLE',500);}}
export async function saveProfiles(directory,value){const profiles=validateProfiles(value);await mkdir(directory,{recursive:true});const file=path.join(directory,'profiles.json');await writeFile(file+'.tmp',JSON.stringify(profiles),'utf8');await rename(file+'.tmp',file);return profiles;}
