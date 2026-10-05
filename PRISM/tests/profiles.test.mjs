import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createBridge} from '../server/index.mjs';
import {readProfiles,saveProfiles} from '../server/profiles.mjs';
const profile={id:'saved-white',name:'Mein White Build',config:{effect:'rainbow',colors:['#ffffff','#3288ff'],brightness:60,speed:40,scale:50,direction:'forward'}};
test('embedded light profiles survive a new store and invalid saves preserve the previous file',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-profiles-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 assert.deepEqual(await readProfiles(directory),[]);await saveProfiles(directory,[profile]);assert.deepEqual(await readProfiles(directory),[profile]);
 await assert.rejects(saveProfiles(directory,[profile,profile]),/ungültig/);await assert.rejects(saveProfiles(directory,[{...profile,config:{...profile.config,brightness:101}}]),/Helligkeit/);
 assert.deepEqual(await readProfiles(directory),[profile]);
 await writeFile(path.join(directory,'profiles.json'),'corrupt');await assert.rejects(readProfiles(directory),/nicht gelesen/);assert.equal(await readFile(path.join(directory,'profiles.json'),'utf8'),'corrupt');
});

test('versioned scene metadata survives persistence and old array files remain readable',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-scene-meta-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'profiles.json'),scene={...profile,category:'Studio',favorite:true,targetDevices:[50001,60003]};
 await writeFile(file,JSON.stringify([profile]));assert.deepEqual(await readProfiles(directory),[profile]);
 await saveProfiles(directory,[scene]);const document=JSON.parse(await readFile(file,'utf8'));assert.equal(document.app,'PRISM');assert.equal(document.version,2);assert.deepEqual(await readProfiles(directory),[scene]);
 await writeFile(file,JSON.stringify({app:'PRISM',version:1,profiles:[profile]}));assert.deepEqual(await readProfiles(directory),[profile]);
 await writeFile(file,JSON.stringify({app:'PRISM',version:3,profiles:[profile]}));await assert.rejects(readProfiles(directory),/nicht gelesen/);
});

test('invalid metadata and oversized scenes cannot overwrite the last valid library',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-scene-guard-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await saveProfiles(directory,[profile]);const file=path.join(directory,'profiles.json'),previous=await readFile(file,'utf8');
 for(const patch of [{category:5},{category:'x'.repeat(41)},{favorite:'yes'},{targetDevices:[2,2]},{targetDevices:[-1]},{targetDevices:[2.5]},{targetDevices:'all'},{name:'Bad\nName'}])await assert.rejects(saveProfiles(directory,[{...profile,...patch}]),error=>error.code==='INVALID_PROFILES');
 const oversized=Array.from({length:100},(_,i)=>({...profile,id:`p-${i}`,targetDevices:Array.from({length:128},(_,id)=>2_000_000_000+id)}));await assert.rejects(saveProfiles(directory,oversized),/zu groß/);
 assert.equal(await readFile(file,'utf8'),previous);
 const unsafe=JSON.parse('{"id":"safe","name":"Safe","__proto__":{"polluted":true},"arbitrary":"discard"}');const saved=await saveProfiles(directory,[{...unsafe,config:profile.config}]);assert.equal(Object.hasOwn(saved[0],'__proto__'),false);assert.equal(Object.hasOwn(saved[0],'arbitrary'),false);assert.equal({}.polluted,undefined);
});
test('profile API is local, explicitly enabled, and independent of RGB hardware',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-profile-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const client=new EventEmitter();Object.assign(client,{devices:[],connected:false,close(){}});
 const bridge=createBridge({port:0,client,embedded:true,profileDirectory:directory});const address=await bridge.listen();t.after(()=>new Promise(resolve=>{bridge.server.close(resolve);bridge.server.closeIdleConnections();}));
 const url=`http://127.0.0.1:${address.port}/api/profiles`;
 assert.deepEqual(await (await fetch(url)).json(),{profiles:[]});
 const saved=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profiles:[profile]})});assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{profiles:[profile]});
 const denied=await fetch(url,{headers:{Origin:'https://unrelated.example'}});assert.equal(denied.status,403);
 const invalid=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profiles:[{...profile,name:'x'.repeat(61)}]})});assert.equal(invalid.status,400);assert.deepEqual(await readProfiles(directory),[profile]);
});
