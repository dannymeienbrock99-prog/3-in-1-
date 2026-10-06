import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {createBridge} from '../server/index.mjs';
import {strimerIdentity,normalizeStrimerDraft} from '../server/strimer-draft.mjs';
import {validateSettings} from '../server/effects.mjs';
import {readStrimerPreferences,saveStrimerPreferences} from '../server/strimer-preferences.mjs';
import {createStrimerStore} from '../src/strimer-store.mjs';
const config={effect:'wave',colors:['#123456'],brightness:68,speed:32,scale:50,direction:'reverse'};
test('defaults cannot expand a small submitted draft beyond the saved-file limit',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-strimer-size-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await saveStrimerPreferences(directory,{offlineConfig:config});const previous=await readFile(path.join(directory,'strimer-preview.json'),'utf8');
 const wirelessChannels={};for(let i=0;i<32;i++)wirelessChannels[String(i).padStart(160,'x')]=Object.fromEntries(Array.from({length:12},(_,id)=>[id,{effect:'custom'}]));
 const draft={wirelessChannels};assert(Buffer.byteLength(JSON.stringify(draft))<64*1024);
 await assert.rejects(saveStrimerPreferences(directory,draft),error=>error.code==='INVALID_STRIMER_DRAFT');assert.equal(await readFile(path.join(directory,'strimer-preview.json'),'utf8'),previous);assert.deepEqual((await readStrimerPreferences(directory)).offlineConfig,config);
});
test('remount draft reads wait for delayed prior saves and never overwrite newer slider settings',async()=>{
 let release,stored=null;const gate=new Promise(resolve=>release=resolve),calls=[];
 const store=createStrimerStore(async(route,body)=>{calls.push(body?'save':'load');if(body){if(calls.length===1)await gate;stored=structuredClone(body.draft);return{draft:stored};}return{draft:structuredClone(stored)};});
 const first=store.save({offlineConfig:{...config,brightness:20}}),last=store.save({offlineConfig:{...config,brightness:80}}),remount=store.load();
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['save']);release();await Promise.all([first,last]);
 const restored=await remount;assert.equal(restored.draft.offlineConfig.brightness,80);assert.deepEqual(calls,['save','save','load']);
 await store.save(restored.draft);assert.equal(stored.offlineConfig.brightness,80);
});
test('a cable choice follows its MAC when session IDs change and never guesses from a model name',()=>{
 const cable={id:60000,provider:'lianli-wireless',mac:'AA1122334455',name:'Strimer Wireless'};
 assert.equal(strimerIdentity(cable),strimerIdentity({...cable,id:60001}));
 assert.notEqual(strimerIdentity(cable),strimerIdentity({...cable,mac:'BB1122334455'}));
 assert.equal(strimerIdentity({id:50000,provider:'lianli',name:'Strimer Plus V2'}),null);
 const draft=normalizeStrimerDraft({deviceChoice:'60000',wirelessCable:'bad',channels:{0:config,15:config},offlineConfig:{...config,brightness:150}},validateSettings);
 assert.equal(draft.deviceChoice,undefined);assert.equal(draft.offlineConfig,undefined);assert.deepEqual(Object.keys(draft.channels),['0']);assert.equal(draft.wirelessCable,'wireless-24pin');
});
test('embedded cable drafts survive a different HTTP port without opening or writing hardware',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-strimer-prefs-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let hardwareCalls=0;
 const start=async()=>{const client=new EventEmitter();Object.assign(client,{devices:[],connected:false,connect(){hardwareCalls++;throw Error('hardware must remain untouched');},update(){hardwareCalls++;},close(){}});const bridge=createBridge({port:0,client,embedded:true,profileDirectory:directory});const address=await bridge.listen();return{bridge,url:`http://127.0.0.1:${address.port}/api/strimer-preview`};};
 const close=async value=>new Promise(resolve=>{value.bridge.server.close(resolve);value.bridge.server.closeIdleConnections();});
 const first=await start();const draft={previewFamily:'wireless',wirelessCable:'wireless-cpu8',deviceChoice:'lianli-wireless:aa1122334455',offlineConfig:config,wirelessChannels:{'lianli-wireless:aa1122334455:wireless-cpu8':{0:config}}};
 try{
  assert.deepEqual(await(await fetch(first.url)).json(),{draft:null});
  const saved=await fetch(first.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft})});assert.equal(saved.status,200);assert.deepEqual((await saved.json()).draft.offlineConfig,config);
  assert.equal((await fetch(first.url,{headers:{Origin:'https://unrelated.example'}})).status,403);
  const previous=await readFile(path.join(directory,'strimer-preview.json'),'utf8');
  assert.equal((await fetch(first.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:[]})})).status,400);
  assert.equal(await readFile(path.join(directory,'strimer-preview.json'),'utf8'),previous);
 }finally{await close(first);}
 const second=await start();try{assert.notEqual(first.url,second.url);const restored=(await(await fetch(second.url)).json()).draft;assert.deepEqual(restored.offlineConfig,config);assert.equal(restored.deviceChoice,draft.deviceChoice);assert.deepEqual(restored.wirelessChannels,draft.wirelessChannels);}finally{await close(second);}
 assert.equal(hardwareCalls,0);assert.deepEqual((await readStrimerPreferences(directory)).offlineConfig,config);
});
