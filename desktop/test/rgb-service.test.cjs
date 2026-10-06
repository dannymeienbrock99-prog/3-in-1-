'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {RgbService,EFFECT_NAMES}=require('../src/services/rgb-service.cjs');
const root=path.resolve(__dirname,'../../PRISM');
const bridgeModule=import(pathToFileURL(path.join(root,'server/index.mjs')).href);
function device(id=1,extra={}){return {id,name:'Synthetic RGB Controller '+id,vendor:'Test fixture',type:0,directMode:true,protected:false,colorsKnown:true,colors:[0x332211,0x665544,0x998877,0xccbbaa],modes:[],zones:[{id:0,name:'Front',startIndex:0,ledCount:2},{id:1,name:'Rear',startIndex:2,ledCount:2}],...extra};}
function memory(id=40000,extra={}){return device(id,{name:'Synthetic Kingston DDR5 Slot '+(id-40000),vendor:'Kingston',provider:'kingston',type:1,directMode:false,ledCount:0,colors:[],zones:[],nativeEffects:[
 {id:'static_color',name:'Statisch',supported:true,colorsMax:1,controls:{colors:true,brightness:true,speed:false,direction:false}},
 {id:'all_off',name:'Aus',supported:true,colorsMax:0,controls:{colors:false,brightness:false,speed:false,direction:false}},
 {id:'breath',name:'Atmen',supported:true,colorsMax:10,controls:{colors:true,brightness:true,speed:true,direction:false}},
 {id:'racing',name:'Rennen',supported:true,colorsMax:0,controls:{colors:false,brightness:false,speed:false,direction:false}}
 ],...extra});}
class FakeClient extends EventEmitter{
 constructor(devices){super();this.devices=devices;this.connected=false;this.connections=0;this.closes=0;this.direct=[];this.writes=[];this.nativeWrites=[];this.backend='mock-only';}
 async connect(){this.connections++;this.connected=true;return this.devices;}
 async selectDirect(item){this.direct.push(item.id);}
 async update(item,colors){this.writes.push({id:item.id,colors:[...colors]});item.colors=[...colors];}
 async applyNativeEffect(item,effectId,options){this.nativeWrites.push({id:item.id,effectId,...options});return {accepted:true};}
 async close(){this.closes++;this.connected=false;}
}
async function fixture(t,{devices=[device(),device(2)],factoryWrap,replyWrap,ui}={}){
 const {createBridge}=await bridgeModule,directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-rgb-service-')),client=new FakeClient(devices),calls=[],changes=[];
 const uiRoot=path.join(directory,'ui');if(ui==='ready'){fs.mkdirSync(uiRoot);fs.writeFileSync(path.join(uiRoot,'index.html'),'<!doctype html><title>Synthetic RGB UI</title>');}
 let owned,created=0;const bridgeFactory=options=>{created++;assert.equal(options.port,0);assert.equal(options.embedded,true);owned=createBridge({...options,client,...(ui?{dist:uiRoot}:{})});return factoryWrap?factoryWrap(owned):owned;};
 const service=new RgbService({root,directory,bridgeFactory,onChange:s=>changes.push(s),fetchRequest:async(url,options)=>{const call={route:new URL(url).pathname,body:options.body&&JSON.parse(options.body)};calls.push(call);const response=await fetch(url,options);return replyWrap?replyWrap(response,call):response;}});
 t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
 async function seed({brightness=61,effect='static',custom,colors=['#123456','#abcdef'],zoneIds={1:[1]},deviceIds=[1]}={}){
  await service.start();await client.connect();const response=await fetch(new URL(service.url).origin+'/api/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceIds,zoneIds,effect,colors,brightness,speed:23,scale:47,direction:'reverse',...(custom?{custom}:{})})});assert.equal(response.ok,true);await response.json();client.writes.length=0;client.direct.length=0;calls.length=0;
 }
 return {service,client,calls,changes,seed,directory,uiRoot,get bridge(){return owned;},get created(){return created;}};
}

test('the owned Node UI probe opens while null browser origins remain blocked and local HTTP origins work',async t=>{
 const f=await fixture(t,{ui:'ready'});await f.service.start();const requests=[];
 f.bridge.server.prependListener('request',request=>requests.push({path:request.url,origin:request.headers.origin}));
 const opened=await f.service.openUi();assert.equal(opened.running,true);assert.equal(opened.url,f.service.url);
 assert.deepEqual(requests,[{path:'/?embedded=1',origin:undefined}]);
 const blocked=await fetch(opened.url,{headers:{Origin:'null'}});assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,'INVALID_ORIGIN');assert.equal(blocked.headers.get('access-control-allow-origin'),null);
 const sameOrigin=await fetch(opened.url,{headers:{Origin:new URL(opened.url).origin}});assert.equal(sameOrigin.status,200);assert.match(await sameOrigin.text(),/Synthetic RGB UI/);
 assert.equal(f.client.connections,0);assert.deepEqual(f.client.direct,[]);assert.deepEqual(f.client.writes,[]);
});

test('missing UI surfaces its real HTTP reason and a later reload recovers without changing hardware',async t=>{
 const f=await fixture(t,{ui:'missing'});
 await assert.rejects(f.service.openUi(),/Die Oberfläche ist noch nicht gebaut/);assert.equal(f.service.snapshot().running,true);assert.match(f.service.snapshot().error,/Die Oberfläche ist noch nicht gebaut/);
 fs.mkdirSync(f.uiRoot);fs.writeFileSync(path.join(f.uiRoot,'index.html'),'<!doctype html><title>Recovered fixture</title>');
 assert.equal((await f.service.openUi()).error,'');assert.equal(f.created,1);assert.equal(f.client.connections,0);assert.deepEqual(f.client.writes,[]);
});

test('stopping during a successful UI probe rejects the stale open result',async t=>{
 let release,ready;const gate=new Promise(resolve=>release=resolve),readyPromise=new Promise(resolve=>ready=resolve),f=await fixture(t,{ui:'ready',replyWrap:async(response,call)=>{if(call.route==='/'){ready();await gate;}return response;}});
 const opening=f.service.openUi();await readyPromise;await f.service.stop();release();
 await assert.rejects(opening,/RGB-Dienst wurde beendet/);assert.equal(f.service.snapshot().running,false);assert.equal(f.client.connections,0);assert.deepEqual(f.client.writes,[]);
});
test('RGB service rejects invalid actions before starting or contacting any bridge',async t=>{
 const f=await fixture(t);
 for(const input of [null,[],{}, {type:'execute'},{type:'color',color:'red'},{type:'color',color:'#fff'},{type:'effect',effect:'unsupported'},{type:'brightness',brightness:NaN},{type:'brightness',brightness:-1},{type:'brightness',brightness:101}])assert.throws(()=>f.service.action(input));
 assert.equal(f.created,0);assert.deepEqual(f.calls,[]);assert.equal(f.service.snapshot().running,false);assert.equal(f.service.snapshot().available,true);
 for(const id of Object.keys(EFFECT_NAMES))assert(f.service.catalog().effects.some(item=>item.id===id),'original software effect '+id);
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

async function seedNative(f,ids=[40000],effectId='breath',options={}){
 await f.service.start();await f.client.connect();const response=await fetch(new URL(f.service.url).origin+'/api/native-effect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceIds:ids,effectId,colors:['#123456','#abcdef'],brightness:43,speed:23,direction:'forward',...options})});
 assert.equal(response.ok,true);await response.json();f.client.nativeWrites.length=0;f.client.writes.length=0;f.calls.length=0;
}

test('Jarvis native catalog contains actual manufacturer modes and keeps every original software effect',async t=>{
 const f=await fixture(t,{devices:[memory(),memory(40001)]});
 await f.service.start();assert(!f.service.catalog().effects.some(effect=>effect.id.startsWith('native:')));
 await f.client.connect();const effects=f.service.catalog().effects;
 for(const id of Object.keys(EFFECT_NAMES))assert(effects.some(effect=>effect.id===id));
 assert.equal(effects.filter(effect=>effect.id==='native:kingston:breath').length,1,'identical mode across physical slots is one voice choice');
 assert.equal(effects.find(effect=>effect.id==='native:kingston:breath').name,'Kingston Atmen');
 f.client.devices[0].nativeEffects.push({id:'unknown',name:'Ungeprüft',supported:false});
 assert(!f.service.catalog().effects.some(effect=>effect.id==='native:kingston:unknown'));
 assert.throws(()=>f.service.action({type:'effect',effect:'native:kingston:unknown'}),/Unbekannter RGB-Effekt/);
});

test('native-only DDR5 color, brightness, off and on use acknowledged manufacturer effects and retain the selected slot',async t=>{
 const f=await fixture(t,{devices:[memory(),memory(40001),device(1)]});await seedNative(f,[40001]);
 await f.service.action({type:'brightness',brightness:35});
 assert.equal(f.client.nativeWrites.at(-1).effectId,'breath');assert.equal(f.client.nativeWrites.at(-1).brightness,35);
 assert.deepEqual(f.client.nativeWrites.at(-1).colors,['#123456','#abcdef']);
 await f.service.action({type:'color',color:'#FF0000'});assert.equal(f.client.nativeWrites.at(-1).effectId,'static_color');assert.deepEqual(f.client.nativeWrites.at(-1).colors,['#ff0000']);
 await f.service.action({type:'off'});assert.equal(f.client.nativeWrites.at(-1).effectId,'all_off');
 await f.service.action({type:'on'});assert.equal(f.client.nativeWrites.at(-1).effectId,'static_color');assert.equal(f.client.nativeWrites.at(-1).brightness,35);
 assert(f.client.nativeWrites.every(write=>write.id===40001));assert.deepEqual(f.client.writes,[]);assert.deepEqual(f.client.direct,[]);
 assert(f.calls.filter(call=>call.route==='/api/native-effect').every(call=>call.body.zoneIds===undefined));
 const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'voice-settings.json'),'utf8'));assert.equal(saved.settings.effect,'static');assert.equal(saved.settings.brightness,35);assert(!saved.settings.effect.startsWith('native:'));
});

test('explicit native voice effect scopes actual provider modes while software settings keep their original schema',async t=>{
 const f=await fixture(t,{devices:[memory(),memory(40001),device(1)]});await f.service.start();await f.client.connect();
 const before=f.service.snapshot().lastSettings.effect;
 const result=await f.service.action({type:'effect',effect:'native:kingston:breath'});
 assert.match(result.text,/Kingston Atmen/);assert.deepEqual(f.client.nativeWrites.map(write=>write.id),[40000,40001]);assert.deepEqual(f.client.writes,[]);
 assert.equal(f.service.snapshot().lastSettings.effect,before);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'voice-settings.json'),'utf8')).settings.effect,before);
 await f.service.action({type:'brightness',brightness:24});assert.deepEqual(f.client.nativeWrites.slice(-2).map(write=>write.id),[40000,40001]);
 assert(f.client.nativeWrites.slice(-2).every(write=>write.brightness===24));
});

test('generic effects map only unambiguous supported native modes and validate mixed plans before any LED write',async t=>{
 const f=await fixture(t,{devices:[device(1),memory()]});
 await assert.rejects(f.service.action({type:'effect',effect:'scanner'}),/kein eindeutiger Herstellereffekt/);
 assert.deepEqual(f.client.writes,[]);assert.deepEqual(f.client.direct,[]);assert.deepEqual(f.client.nativeWrites,[]);
 await f.service.action({type:'effect',effect:'breathing'});
 assert.equal(f.client.nativeWrites[0].effectId,'breath');assert(f.client.writes.some(write=>write.id===1));
 const nativeCalls=f.calls.filter(call=>call.route==='/api/native-effect');assert.equal(nativeCalls[0].body.deviceIds[0],40000);
 const beforeNative=f.client.nativeWrites.length,beforeDirect=f.client.writes.length;
 await f.service.action({type:'brightness',brightness:31});
 assert(f.client.writes.length>beforeDirect);assert.equal(f.client.nativeWrites.length,beforeNative+1,'remember the whole mixed voice selection despite separate provider timestamps');
 f.bridge.engine.stop();
});

test('a newer UI native selection replaces older native activity and never recruits prior slots',async t=>{
 const f=await fixture(t,{devices:[memory(),memory(40001),memory(40002)]});await seedNative(f,[40000]);
 f.client.devices[0].activeNativeEffect.appliedAt=1000;
 await seedNative(f,[40002]);f.client.devices[2].activeNativeEffect.appliedAt=2000;
 await f.service.action({type:'color',color:'#0000ff'});
 assert.deepEqual(f.client.nativeWrites.map(write=>write.id),[40002]);
 await f.service.action({type:'brightness',brightness:22});assert(f.client.nativeWrites.every(write=>write.id===40002));
});

test('missing native slots and unsupported brightness fail without affecting a different device',async t=>{
 const f=await fixture(t,{devices:[memory(),memory(40001),device(1)]});await seedNative(f,[40001],'racing');
 await assert.rejects(f.service.action({type:'brightness',brightness:30}),/keine Änderung der Helligkeit/);
 assert.deepEqual(f.client.writes,[]);assert.deepEqual(f.client.nativeWrites,[]);
 await f.service.action({type:'color',color:'#00ff00'});f.client.nativeWrites.length=0;f.client.devices=f.client.devices.filter(item=>item.id!==40001);
 await assert.rejects(f.service.action({type:'off'}),/zuletzt verwendetes RGB-Gerät fehlt/);assert.deepEqual(f.client.nativeWrites,[]);assert.deepEqual(f.client.writes,[]);
});

test('incomplete native acknowledgement is a failure and the next queued command keeps every originally selected target',async t=>{
 let incomplete=true;
 const f=await fixture(t,{devices:[memory(),memory(40001),memory(40002)],replyWrap:async(response,call)=>{
  if(incomplete&&call.route==='/api/native-effect'){incomplete=false;const body=await response.json();return {ok:true,json:async()=>({...body,applied:[]})};}return response;
 }});
 await seedNative(f,[40001]); // the seed bypasses the service request wrapper
 await assert.rejects(f.service.action({type:'color',color:'#ff0000'}),/nicht vollständig bestätigt/);assert.equal(f.service.snapshot().revision,0);
 await f.service.action({type:'color',color:'#0000ff'});
 assert(f.client.nativeWrites.every(write=>write.id===40001),'a partial acknowledgement cannot broaden selected slots');assert.deepEqual(f.service.lastTargets,[40001]);
});

test('a native driver rejection after partial success does not narrow or widen the next original multi-slot request',async t=>{
 const {BridgeError}=await import(pathToFileURL(path.join(root,'server/openrgb.mjs')).href);
 const f=await fixture(t,{devices:[memory(),memory(40001),memory(40002)]});await seedNative(f,[40000,40001]);
 const apply=f.client.applyNativeEffect.bind(f.client);let rejectOnce=true;
 f.client.applyNativeEffect=async(item,effectId,options)=>{if(item.id===40001&&rejectOnce){rejectOnce=false;throw new BridgeError('Synthetic native rejection','MOCK_NATIVE_REJECTION',503);}return apply(item,effectId,options);};
 await assert.rejects(f.service.action({type:'color',color:'#ff0000'}),/Synthetic native rejection/);
 f.client.nativeWrites.length=0;await f.service.action({type:'color',color:'#0000ff'});
 assert.deepEqual(f.client.nativeWrites.map(write=>write.id),[40000,40001]);assert.deepEqual(f.service.lastTargets,[40000,40001]);
});

test('additional implemented software effects retain the saved settings schema and reload after restart',async t=>{
 const supplied=JSON.parse(fs.readFileSync(path.join(root,'server/effect-catalog.json'),'utf8'));
 const f=await fixture(t,{devices:[device(1)]});
 assert.equal(f.service.catalog().effects.length,supplied.length);
 const additional=supplied.find(effect=>!Object.hasOwn(EFFECT_NAMES,effect.id));assert(additional,'the shared catalog includes new implemented effects');
 await f.service.action({type:'effect',effect:additional.id});f.bridge.engine.stop();
 const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'voice-settings.json'),'utf8'));
 assert.equal(saved.settings.effect,additional.id);assert.deepEqual(Object.keys(saved.settings).sort(),['effect','colors','brightness','speed','scale','direction'].sort());
 await f.service.stop();await f.service.start();assert.equal(f.service.snapshot().lastSettings.effect,additional.id);
});

test('native-only RGB status reports acknowledged manufacturer settings without claiming measured animation',async t=>{
 const f=await fixture(t,{devices:[memory(),memory(40001)]});await seedNative(f,[40000,40001]);
 const snapshot=f.service.snapshot();assert.equal(snapshot.nativeActive.length,2);assert.equal(snapshot.effectRunning,false);
 const writes=f.client.nativeWrites.length,calls=f.calls.length,result=await f.service.action({type:'status'});
 assert.match(result.text,/Für 2 Geräte sind Herstellereffekte eingestellt/);assert.doesNotMatch(result.text,/Kein bewegter RGB-Effekt aktiv|Ein RGB-Effekt läuft/);
 assert.equal(f.client.nativeWrites.length,writes);assert.equal(f.calls.length,calls);
});

test('voice settings preserve the shared bounded custom schema and reject malformed definitions',async t=>{
 const {DEFAULT_CUSTOM,validateCustomSettings}=await import(pathToFileURL(path.join(root,'server/effect-renderer.mjs')).href),f=await fixture(t);
 const base={effect:'custom',colors:['#ff0000','#00ff00'],brightness:63,speed:40,scale:75,direction:'reverse'};
 assert.deepEqual(f.service.settings(base).custom,DEFAULT_CUSTOM);
 const custom={version:1,pattern:'bands',motion:'bounce',repeats:12,cycleSeconds:59.75,pulse:75};
 assert.deepEqual(f.service.settings({...base,custom}).custom,validateCustomSettings(custom));
 assert.deepEqual(f.service.settings({...base,custom:{...custom,script:'ignored'}}).custom,custom);
 for(const invalid of [null,[],false,{version:2},{pattern:'code'},{motion:'usb'},{repeats:1.2},{repeats:13},{cycleSeconds:.2},{cycleSeconds:Infinity},{cycleSeconds:'4'},{pulse:-1},{pulse:'4'}]){
  assert.throws(()=>validateCustomSettings(invalid));assert.throws(()=>f.service.settings({...base,custom:invalid}),/eigenen RGB-Effekt/);
 }
 assert(!Object.hasOwn(f.service.settings({...base,effect:'wave',custom}),'custom'),'old effect settings keep the released shape');
 assert.throws(()=>f.service.action({type:'speed',speed:40}),/Unbekannte RGB-Aktion/);assert.equal(f.created,0);
});

test('custom brightness, off and on preserve the pattern and selected physical LED zones',async t=>{
 const f=await fixture(t),custom={version:1,pattern:'bands',motion:'still',repeats:3,cycleSeconds:7.25,pulse:0};await f.seed({effect:'custom',custom,brightness:47,zoneIds:{1:[1]}});
 const untouched=f.client.devices[0].colors.slice(0,2),other=f.client.devices[1].colors.slice();
 await f.service.action({type:'brightness',brightness:29});await f.service.action({type:'off'});await f.service.action({type:'on'});
 const calls=f.calls.filter(call=>call.route==='/api/apply');assert.equal(calls.length,3);
 for(const call of calls){assert.equal(call.body.effect,'custom');assert.deepEqual(call.body.custom,custom);assert.deepEqual(call.body.deviceIds,[1]);assert.deepEqual(call.body.zoneIds,{'1':[1]});assert.deepEqual(call.body.colors,['#123456','#abcdef']);}
 assert.deepEqual(calls.map(call=>call.body.brightness),[29,0,29]);assert.deepEqual(f.client.devices[0].colors.slice(0,2),untouched);assert.deepEqual(f.client.devices[1].colors,other);
 assert.deepEqual(f.service.snapshot().lastSettings.custom,custom);
 const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'voice-settings.json'),'utf8'));assert.deepEqual(saved.settings.custom,custom);assert.deepEqual(saved.lastCustomSettings.custom,custom);
});

test('switching away and returning to a custom effect restores its saved palette and pattern',async t=>{
 const f=await fixture(t,{devices:[device(1)]}),custom={version:1,pattern:'bands',motion:'still',repeats:8,cycleSeconds:9.5,pulse:0},colors=['#4000ff','#11ffff','#ff1493'];
 await f.seed({effect:'custom',custom,colors});await f.service.action({type:'effect',effect:'gradient'});
 assert(!Object.hasOwn(f.service.snapshot().lastSettings,'custom'));await f.service.action({type:'color',color:'#ffffff'});await f.service.action({type:'brightness',brightness:36});
 await f.service.action({type:'effect',effect:'custom'});
 const last=f.calls.filter(call=>call.route==='/api/apply').at(-1).body;assert.deepEqual(last.custom,custom);assert.deepEqual(last.colors,colors);assert.equal(last.brightness,36);assert.equal(last.direction,'reverse');assert.deepEqual(last.deviceIds,[1]);assert.deepEqual(last.zoneIds,{'1':[1]});
 await f.service.action({type:'effect',effect:'gradient'});await f.service.stop();await f.service.start();
 assert.equal(f.service.snapshot().lastSettings.effect,'gradient');assert.deepEqual(f.service.lastCustomSettings.custom,custom);
 await f.service.action({type:'effect',effect:'custom'});assert.deepEqual(f.service.snapshot().lastSettings.custom,custom);assert.deepEqual(f.service.snapshot().lastSettings.colors,colors);
});

test('the first custom voice command supplies editable defaults and custom settings survive a restart',async t=>{
 const {DEFAULT_CUSTOM}=await import(pathToFileURL(path.join(root,'server/effect-renderer.mjs')).href),f=await fixture(t,{devices:[device(1)]});
 await f.service.action({type:'effect',effect:'custom'});f.bridge.engine.stop();
 const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'voice-settings.json'),'utf8'));assert.deepEqual(saved.settings.custom,DEFAULT_CUSTOM);
 await f.service.stop();await f.service.start();assert.equal(f.service.snapshot().lastSettings.effect,'custom');assert.deepEqual(f.service.snapshot().lastSettings.custom,DEFAULT_CUSTOM);
});

test('a changed custom marker follows only that device even when timestamps and standard fields are unchanged',async t=>{
 const f=await fixture(t),first={version:1,pattern:'bands',motion:'still',repeats:2,cycleSeconds:8,pulse:0},changed={...first,repeats:9};
 await f.seed({effect:'custom',custom:first,deviceIds:[1,2],zoneIds:{1:[1],2:[0]}});await f.service.action({type:'brightness',brightness:42});
 const job=f.bridge.engine.jobs.get(2);job.settings={...job.settings,custom:changed};const untouched=f.client.devices[0].colors.slice();f.client.writes.length=0;f.client.direct.length=0;f.calls.length=0;
 await f.service.action({type:'brightness',brightness:24});
 const applied=f.calls.find(call=>call.route==='/api/apply').body;assert.deepEqual(applied.deviceIds,[2]);assert.deepEqual(applied.zoneIds,{'2':[0]});assert.deepEqual(applied.custom,changed);assert.deepEqual(f.client.direct,[2]);assert.deepEqual(f.client.devices[0].colors,untouched);
 assert.deepEqual(f.bridge.engine.jobs.get(1).settings.custom,first);
});

test('a failed custom update retains the exact selection and custom definition for the next command',async t=>{
 const {BridgeError}=await import(pathToFileURL(path.join(root,'server/openrgb.mjs')).href);
 const f=await fixture(t),custom={version:1,pattern:'bands',motion:'still',repeats:5,cycleSeconds:12,pulse:0};await f.seed({effect:'custom',custom});
 const update=f.client.update.bind(f.client);let fail=true;f.client.update=async(item,colors)=>{if(fail){fail=false;throw new BridgeError('Synthetic custom failure','MOCK_CUSTOM_REJECTION',503);}return update(item,colors);};
 await assert.rejects(f.service.action({type:'brightness',brightness:33}),/Synthetic custom failure/);
 await f.service.action({type:'brightness',brightness:22});
 assert(f.calls.filter(call=>call.route==='/api/apply').every(call=>JSON.stringify(call.body.deviceIds)==='[1]'&&JSON.stringify(call.body.custom)===JSON.stringify(custom)));assert.deepEqual(f.service.lastTargets,[1]);
});

test('uploaded custom effects are acknowledged as transferred and never generate continuous voice frame writes',async t=>{
 const f=await fixture(t,{devices:[device(60000,{effectUpload:true,provider:'lianli',name:'Synthetic Strimer Wireless'})]}),uploads=[];
 f.client.applySoftwareEffect=async(item,settings,zones)=>{uploads.push({id:item.id,settings,zones});return {confirmation:'transmitted',acknowledgement:'Synthetic Windows HID transfer'};};
 const result=await f.service.action({type:'effect',effect:'custom'});
 assert.match(result.text,/Wireless-Controller übertragen/);assert.equal(uploads.length,1);assert.deepEqual(uploads[0].id,60000);assert.equal(f.bridge.engine.running,true);assert.equal(f.bridge.engine.streaming,false);assert.equal(f.bridge.engine.timer,null);assert.deepEqual(f.client.direct,[]);assert.deepEqual(f.client.writes,[]);
 await f.service.action({type:'brightness',brightness:37});assert.equal(uploads.length,2);assert.equal(uploads[1].settings.brightness,37);assert.deepEqual(uploads[1].settings.custom,uploads[0].settings.custom);assert.deepEqual(f.service.lastTargets,[60000]);assert.deepEqual(f.client.writes,[]);
});
