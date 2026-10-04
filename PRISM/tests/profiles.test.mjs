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
