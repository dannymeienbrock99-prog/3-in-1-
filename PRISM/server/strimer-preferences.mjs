import path from 'node:path';
import {readFile,writeFile,mkdir,rename,unlink,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {BridgeError} from './openrgb.mjs';
import {validateSettings} from './effects.mjs';
import {normalizeStrimerDraft} from './strimer-draft.mjs';
const LIMIT=64*1024;
export async function readStrimerPreferences(directory){
 try{const file=path.join(directory,'strimer-preview.json');if((await stat(file)).size>LIMIT)throw Error();return normalizeStrimerDraft(JSON.parse(await readFile(file,'utf8')),validateSettings);}
 catch(error){if(error.code==='ENOENT')return null;throw new BridgeError('Gespeicherte Kabelvorschau konnte nicht gelesen werden.','STRIMER_DRAFT_UNAVAILABLE',500);}
}
export async function saveStrimerPreferences(directory,value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>LIMIT)throw new BridgeError('Die Kabelvorschau ist ungültig oder zu groß.','INVALID_STRIMER_DRAFT',400);
 const draft=normalizeStrimerDraft(value,validateSettings),data=JSON.stringify(draft);
 if(Buffer.byteLength(data)>LIMIT)throw new BridgeError('Die gespeicherte Kabelvorschau ist zu groß (maximal 64 KB).','INVALID_STRIMER_DRAFT',400);
 await mkdir(directory,{recursive:true});const file=path.join(directory,'strimer-preview.json'),temporary=file+'.tmp-'+randomUUID();
 try{await writeFile(temporary,data,{encoding:'utf8',flag:'wx',mode:0o600});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}
 return draft;
}
