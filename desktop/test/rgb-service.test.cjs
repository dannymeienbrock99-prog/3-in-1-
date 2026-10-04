'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {RgbService,EFFECT_NAMES}=require('../src/services/rgb-service.cjs');
const root=path.resolve(__dirname,'../../PRISM');
const bridgeModule=import(pathToFileURL(path.join(root,'server/index.mjs')).href);
function device(id=1,extra={}){return {id,name:'Synthetic RGB Controller '+id,vendor:'Test fixture',type:0,directMode:true,protected:false,colorsKnown:true,colors:[0x332211,0x665544,0x998877,0xccbbaa],modes:[],zones:[{id:0,name:'Front',startIndex:0,ledCount:2},{id:1,name:'Rear',startIndex:2,ledCount:2}],...extra};}
class FakeClient extends EventEmitter{
 constructor(devices){super();this.devices=devices;this.connected=false;this.connections=0;this.closes=0;this.direct=[];this.writes=[];this.backend='mock-only';}
 async connect(){this.connections++;this.connected=true;return this.devices;}
 async selectDirect(item){this.direct.push(item.id);}
 async update(item,colors){this.writes.push({id:item.id,colors:[...colors]});item.colors=[...colors];}
 async close(){this.closes++;this.connected=false;}
}
async function fixture(t,{devices=[device(),device(2)],factoryWrap}={}){
 const {createBridge}=await bridgeModule,directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-rgb-service-')),client=new FakeClient(devices),calls=[],changes=[];
 let owned,created=0;const bridgeFactory=options=>{created++;assert.equal(options.port,0);assert.equal(options.embedded,true);owned=createBridge({...options,client});return factoryWrap?factoryWrap(owned):owned;};
 const service=new RgbService({root,directory,bridgeFactory,onChange:s=>changes.push(s),fetchRequest:async(url,options)=>{calls.push({route:new URL(url).pathname,body:options.body&&JSON.parse(options.body)});return fetch(url,options);}});
 t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
 async function seed({brightness=61,effect='static',zoneIds={1:[1]},deviceIds=[1]}={}){
  await service.start();await client.connect();const response=await fetch(new URL(service.url).origin+'/api/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceIds,zoneIds,effect,colors:['#123456','#abcdef'],brightness,speed:23,scale:47,direction:'reverse'})});assert.equal(response.ok,true);await response.json();client.writes.length=0;client.direct.length=0;calls.length=0;
 }
 return {service,client,calls,changes,seed,directory,get bridge(){return owned;},get created(){return created;}};
}
test('RGB service rejects invalid actions before starting or contacting any bridge',async t=>{
 const f=await fixture(t);
 for(const input of [null,[],{}, {type:'execute'},{type:'color',color:'red'},{type:'color',color:'#fff'},{type:'effect',effect:'unsupported'},{type:'brightness',brightness:NaN},{type:'brightness',brightness:-1},{type:'brightness',brightness:101}])assert.throws(()=>f.service.action(input));
 assert.equal(f.created,0);assert.deepEqual(f.calls,[]);assert.equal(f.service.snapshot().running,false);assert.equal(f.service.snapshot().available,true);
 assert.equal(f.service.catalog().effects.length,14);assert.deepEqual(new Set(f.service.catalog().effects.map(item=>item.id)),new Set(Object.keys(EFFECT_NAMES)));
});
test('status starts only its owned local UI and never discovers or writes LEDs',async t=>{
 const f=await fixture(t),result=await f.service.action({type:'status'}),snapshot=f.service.snapshot();
 assert.equal(result.ok,true);assert.match(result.text,/keine RGB-Geräte verbunden/);assert.equal(f.created,1);assert.equal(snapshot.running,true);assert.equal(snapshot.connected,false);assert.equal(snapshot.deviceCount,2);
 assert.equal(new URL(snapshot.url).hostname,'127.0.0.1');assert.equal(new URL(snapshot.url).searchParams.get('embedded'),'1');assert.equal(f.client.connections,0);assert.deepEqual(f.client.direct,[]);assert.deepEqual(f.client.writes,[]);assert.deepEqual(f.calls,[]);
});
test('empty and unsupported device inventories produce a truthful failure without a LED write',async t=>{
 for(const devices of [[],[device(1,{directMode:false})],[device(1,{protected:true})]]){
  const f=await fixture(t,{devices});await assert.rejects(f.service.action({type:'color',color:'#ff0000'}),/Keine steuerbaren RGB-Geräte/);
  assert.equal(f.client.connections,1);assert.deepEqual(f.client.direct,[]);assert.deepEqual(f.client.writes,[]);assert.match(f.service.snapshot().error,/Keine steuerbaren/);assert.equal(f.service.snapshot().revision,0);
 }
});
test('color, effect and brightness commands use the real serialized HTTP backend and preserve selected zones',async t=>{
 const f=await fixture(t);await f.seed();const untouched=f.client.devices[0].colors.slice(0,2),other=f.client.devices[1].colors.slice();
 assert.equal((await f.service.action({type:'color',color:'#FF0000'})).ok,true);
 assert.equal((await f.service.action({type:'effect',effect:'gradient'})).ok,true);
 assert.equal((await f.service.action({type:'brightness',brightness:35})).ok,true);
 const applied=f.calls.filter(call=>call.route==='/api/apply');assert.equal(applied.length,3);
 for(const call of applied){assert.deepEqual(call.body.deviceIds,[1]);assert.deepEqual(call.body.zoneIds,{'1':[1]});assert.equal(call.body.speed,23);assert.equal(call.body.scale,47);assert.equal(call.body.direction,'reverse');}
 assert.equal(applied[0].body.effect,'static');assert.deepEqual(applied[0].body.colors,['#ff0000']);assert.equal(applied[0].body.brightness,61);assert.equal(applied[1].body.effect,'gradient');assert.equal(applied[2].body.brightness,35);
 assert.deepEqual(f.client.devices[0].colors.slice(0,2),untouched);assert.deepEqual(f.client.devices[1].colors,other);assert(f.client.writes.every(write=>write.id===1));
 assert.equal(f.service.snapshot().lastSettings.brightness,35);assert.equal(f.service.snapshot().revision,3);assert.deepEqual(f.service.snapshot().active[0].zones,[1]);
 const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'voice-settings.json'),'utf8'));assert.equal(saved.settings.brightness,35);
});
test('off followed by on restores the previous brightness and device selection',async t=>{
 const f=await fixture(t);await f.seed({zoneIds:{1:[0,1]},brightness:43});await f.service.action({type:'off'});
 assert.equal(f.bridge.status().active.length,0);assert(f.client.devices[0].colors.every(color=>color===0));assert(f.client.writes.every(write=>write.id===1));
 await f.service.action({type:'on'});const applied=f.calls.filter(call=>call.route==='/api/apply').at(-1);assert.equal(applied.body.brightness,43);assert.deepEqual(applied.body.deviceIds,[1]);assert.equal(f.service.snapshot().lastSettings.brightness,43);
 await f.service.action({type:'brightness',brightness:0});assert.equal(f.service.snapshot().lastSettings.brightness,0);await f.service.action({type:'on'});assert.equal(f.service.snapshot().lastSettings.brightness,43);
});
test('off and on keep partial LED zone selections and leave unselected zones unchanged',async t=>{
 const f=await fixture(t);await f.seed({zoneIds:{1:[1]}});const untouched=f.client.devices[0].colors.slice(0,2);
 await f.service.action({type:'off'});assert.deepEqual(f.client.devices[0].colors.slice(0,2),untouched,'off must affect only the selected RGB zones');assert(f.client.devices[0].colors.slice(2).every(color=>color===0));
 await f.service.action({type:'on'});assert.deepEqual(f.service.snapshot().active[0].zones,[1],'on restores the previous zone selection');assert.deepEqual(f.client.devices[0].colors.slice(0,2),untouched);
});
test('concurrent starts share one bridge and queue RGB changes in their requested order',async t=>{
 const f=await fixture(t);const [a,b,c]=await Promise.all([f.service.start(),f.service.start(),f.service.start()]);assert.equal(f.created,1);assert.equal(a.url,b.url);assert.equal(b.url,c.url);
 await f.seed({zoneIds:{1:[0,1]}});await Promise.all([f.service.action({type:'color',color:'#0000ff'}),f.service.action({type:'brightness',brightness:20}),f.service.action({type:'effect',effect:'static'})]);
 const applied=f.calls.filter(call=>call.route==='/api/apply');assert.deepEqual(applied.map(call=>call.body.brightness),[61,20,20]);assert(applied.every(call=>call.body.colors[0]==='#0000ff'));assert.equal(f.created,1);
});
test('a removed selected device fails before changing a different detected device',async t=>{
 const f=await fixture(t);await f.seed();f.client.devices=f.client.devices.filter(item=>item.id!==1);
 await assert.rejects(f.service.action({type:'brightness',brightness:30}),/zuletzt verwendetes RGB-Gerät fehlt/);assert.deepEqual(f.client.writes,[]);assert.deepEqual(f.client.direct,[]);
});
test('closing releases only the service-owned bridge while an independent bridge remains reachable',async t=>{
 const {createBridge}=await bridgeModule,externalClient=new FakeClient([device(9)]),external=createBridge({port:0,client:externalClient});await external.listen();t.after(async()=>{external.engine.stop();await new Promise(resolve=>external.server.close(resolve));});
 const f=await fixture(t);await f.seed({zoneIds:{1:[0,1]}});const ownedPort=f.bridge.server.address().port,externalPort=external.server.address().port;assert.notEqual(ownedPort,externalPort);
 await f.service.close();assert.equal(f.service.snapshot().running,false);assert.equal(f.bridge.server.listening,false);assert.equal(f.bridge.engine.active.length,0);assert(f.client.closes>=1);assert.equal(externalClient.closes,0);
 const response=await fetch('http://127.0.0.1:'+externalPort+'/api/status');assert.equal(response.ok,true);await response.json();await assert.rejects(f.service.start(),/geschlossen/);await assert.rejects(f.service.action({type:'on'}),/geschlossen/);
});
test('closing during bridge startup disposes the pending bridge without publishing it',async t=>{
 let ready,release;const readyPromise=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture(t,{factoryWrap:bridge=>{const listen=bridge.listen;bridge.listen=async()=>{const address=await listen();ready();await gate;return address;};return bridge;}});
 const starting=f.service.start();await readyPromise;const closing=f.service.close();release();await assert.rejects(starting,/geschlossen/);await closing;assert.equal(f.service.snapshot().running,false);assert.equal(f.bridge.server.listening,false);assert(f.client.closes>=1);
});
test('stopping waits for an in-flight RGB frame, rejects restart during disposal and then permits an explicit restart',async t=>{
 const f=await fixture(t);await f.seed({zoneIds:{1:[0,1]}});let ready,release;const readyPromise=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{release=resolve;}),update=f.client.update.bind(f.client);
 f.client.update=async(item,colors)=>{ready();await gate;return update(item,colors);};
 const action=f.service.action({type:'brightness',brightness:24});await readyPromise;const stopping=f.service.stop();
 await assert.rejects(f.service.start(),/geschlossen/);assert.equal(f.client.closes,0);assert.equal(f.bridge.server.listening,true);
 release();assert.equal((await action).ok,true);await stopping;assert.equal(f.bridge.server.listening,false);assert(f.client.closes>=1);assert.equal(f.service.snapshot().running,false);
 await f.service.start();assert.equal(f.created,2);assert.equal(f.service.snapshot().running,true);assert.equal(f.service.snapshot().lastSettings.brightness,24);
});
test('a driver rejection stays a failure and does not poison the next queued RGB command',async t=>{
 const {BridgeError}=await import(pathToFileURL(path.join(root,'server/openrgb.mjs')).href),f=await fixture(t);await f.seed({zoneIds:{1:[1]}});const update=f.client.update.bind(f.client),other=f.client.devices[1].colors.slice(),untouched=f.client.devices[0].colors.slice(0,2);let refused=false;
 f.client.update=async(item,colors)=>{if(!refused){refused=true;throw new BridgeError('Synthetic driver rejected this frame.','MOCK_REJECTION',503);}return update(item,colors);};
 await assert.rejects(f.service.action({type:'color',color:'#ff0000'}),/Synthetic driver rejected/);assert.equal(f.service.snapshot().revision,0);assert.deepEqual(f.client.writes,[]);
 const result=await f.service.action({type:'color',color:'#0000ff'});assert.equal(result.ok,true);assert.equal(f.service.snapshot().revision,1);assert.equal(f.service.snapshot().error,'');assert(f.client.writes.length>0);
 assert(f.client.writes.every(write=>write.id===1),'a failed first command must not broaden the next device selection');assert.deepEqual(f.service.snapshot().active[0].zones,[1]);assert.deepEqual(f.client.devices[1].colors,other);assert.deepEqual(f.client.devices[0].colors.slice(0,2),untouched);
});
