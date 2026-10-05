import path from 'node:path';
import { readFile, writeFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { BridgeError } from './openrgb.mjs';
import { validateSettings } from './effects.mjs';
import { MAX_LIGHT_PROFILES, MAX_PROFILE_BYTES, profileMetadata, profileDocumentItems, profileDocument } from './profile-schema.mjs';
export function validateProfiles(value){
 if(!Array.isArray(value)||value.length>MAX_LIGHT_PROFILES)throw new BridgeError('Maximal 100 gültige Lichtprofile erwartet.','INVALID_PROFILES',400);
 const ids=new Set();
 return value.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!p.id||p.id.length>80||/[\u0000-\u001f]/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||/[\u0000-\u001f]/.test(p.name))throw new BridgeError('Ein Lichtprofil ist ungültig.','INVALID_PROFILES',400);
  let metadata;try{metadata=profileMetadata(p);}catch(error){throw new BridgeError(error.message,'INVALID_PROFILES',400);}
  ids.add(p.id);return {id:p.id,name:p.name.trim(),config:validateSettings(p.config),...metadata};
 });
}
export async function readProfiles(directory){try{const file=path.join(directory,'profiles.json');if((await stat(file)).size>MAX_PROFILE_BYTES)throw Error('Profildatei zu groß.');const data=await readFile(file,'utf8');if(Buffer.byteLength(data)>MAX_PROFILE_BYTES)throw Error('Profildatei zu groß.');return validateProfiles(profileDocumentItems(JSON.parse(data)));}catch(e){if(e.code==='ENOENT')return [];throw new BridgeError('Gespeicherte Lichtprofile konnten nicht gelesen werden.','PROFILES_UNAVAILABLE',500);}}
export async function saveProfiles(directory,value){
 const profiles=validateProfiles(value),data=JSON.stringify(profileDocument(profiles));
 if(Buffer.byteLength(data)>MAX_PROFILE_BYTES)throw new BridgeError('Die Szenenbibliothek ist zu groß (maximal 128 KB).','INVALID_PROFILES',400);
 await mkdir(directory,{recursive:true});const file=path.join(directory,'profiles.json'),temporary=file+'.tmp-'+randomUUID();
 try{await writeFile(temporary,data,{encoding:'utf8',flag:'wx',mode:0o600});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}
 return profiles;
}
