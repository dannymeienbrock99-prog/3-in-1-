import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { LianLiWirelessClient, wirelessAnimation } from '../server/lianli-wireless.mjs';
import { LightingClient } from '../server/lighting-client.mjs';
import { EffectEngine, validateSettings } from '../server/effects.mjs';
import { BridgeError } from '../server/openrgb.mjs';

const layouts = new Map([[1,116],[2,132],[3,174],[4,88]]);
const cable = (values = {}) => ({ id:60000,name:'Lian Li Strimer Wireless 24-Pin',vendor:'Lian Li',
  provider:'lianli-wireless',vendorId:0x0416,productId:0x8040,receiverVendorId:0x0416,receiverProductId:0x8041,
  receiverType:2,ledCount:132,mac:'010203040506',masterMac:'090807060504',channel:8,rxType:2,
  motherboardSync:false,directMode:true,effectUpload:true, ...values });
const enumeration = devices => ({ devices,environment:{lianliWireless:{status:'ready'}},discovery:[],warnings:[] });
const acknowledgement = (request,values={}) => ({ deviceId:request.deviceId,transmitted:true,confirmed:false,
  effectIndex:'12345678',frameCount:request.frameCount,intervalMs:request.intervalMs,...values });

function mockClient(responder,options={}) {
  const requests=[],spawned=[];
  const client=new LianLiWirelessClient({ platform:'win32',timeout:1000,...options,spawnFn:(executable,args,settings)=>{
    const child=new EventEmitter();spawned.push({executable,args,settings,child});
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.killed=false;
    child.kill=()=>{child.killed=true;child.exitCode=1;child.emit('exit');};
    child.stdin=new Writable({write(chunk,_encoding,done){
      const request=JSON.parse(chunk.toString());requests.push(request);
      Promise.resolve().then(()=>responder(request)).then(result=>{
        if(result!==undefined)child.stdout.write(JSON.stringify({requestId:request.requestId,ok:true,result})+'\n');
      },error=>child.stdout.write(JSON.stringify({requestId:request.requestId,ok:false,error:{message:error.message,code:error.code||'LIANLI_ERROR'}})+'\n'));
      done();
    },final(done){child.exitCode=0;queueMicrotask(()=>child.emit('exit'));done();}});
    return child;
  }});
  return {client,requests,spawned};
}
async function connected(t,{devices=[cable()],respond=acknowledgement,options={}}={}) {
  const mock=mockClient(request=>request.command==='enumerate'?enumeration(devices):respond(request),options);
  t.after(()=>mock.client.close());await mock.client.connect();return mock;
}
const animationRequests = mock => mock.requests.filter(request=>request.command==='animation');
const rgb = request => Buffer.from(request.rgb,'base64');
const staticSettings = values => ({effect:'static',colors:['#123456'],brightness:100,speed:50,direction:'forward',...values});

test('wireless discovery preserves actual V1/V2 Strimer layouts and accepts a reported radio address 41',async t=>{
  const devices=[...layouts].map(([receiverType,ledCount],index)=>cable({id:60000+index,receiverType,ledCount,
    mac:'01020304050'+(6+index),rxType:index===2?41:2,
    ...(index===3?{vendorId:0x1a86,productId:0xe304,receiverVendorId:0x1a86,receiverProductId:0xe305}:{})}));
  const mock=await connected(t,{devices});
  assert.deepEqual(mock.client.devices.map(d=>d.ledCount),[116,132,174,88]);
  assert.deepEqual(mock.client.devices.map(d=>d.strandCount),[8,12,12,8]);
  assert.deepEqual(mock.client.devices.map(d=>d.ledsPerStrand),[null,11,null,11]);
  assert.deepEqual(mock.client.devices.map(d=>d.cableType),['wireless-gpu8','wireless-24pin','wireless-gpu12','wireless-cpu8']);
  assert.equal(mock.client.devices[2].rxType,41);
  for(const device of mock.client.devices){
    assert.equal(device.physicalLedCount,device.ledCount);assert.equal(device.directMode,true);
    assert.equal(device.effectUpload,true);assert.equal(device.zones.length,1);
    assert.equal(device.category,'strip');assert.equal(device.leds.length,device.ledCount);
    assert.equal(device.family,'wireless');assert.equal(device.strimerFamily,'wireless');
    assert.equal(device.ledLayout.kind,'linear');assert.equal(device.ledLayout.linearLedCount,device.ledCount);
    assert.equal(device.ledLayout.strandLedCounts,null);assert.equal(device.ledLayout.physicalStrandMapVerified,false);
    assert.deepEqual(device.nativeEffects,[]);assert.equal(device.wholeControllerOnly,false);
  }
  assert.equal(mock.requests.length,1);assert.deepEqual(mock.spawned[0].args,['--wireless']);
  assert.equal(mock.spawned[0].settings.windowsHide,true);
});

test('malformed wireless identities, counts, routing, future models and duplicate addresses cannot become control targets',async t=>{
  const bad=[null,cable({id:59999}),cable({id:60256}),cable({productId:0xa200}),cable({receiverProductId:0x7372}),
    cable({receiverType:5}),cable({ledCount:133}),cable({mac:'000000000000'}),cable({masterMac:'ffffffffffff'}),
    cable({mac:'not-a-mac'}),cable({channel:0}),cable({channel:40}),cable({rxType:0}),cable({rxType:255}),
    cable({motherboardSync:true}),cable({directMode:false}),cable({effectUpload:false})];
  for(const value of bad){
    const mock=mockClient(()=>enumeration([value]));t.after(()=>mock.client.close());
    await assert.rejects(mock.client.scan(),{code:'WIRELESS_INVALID_DATA'});
    assert.equal(mock.client.connected,false);assert.deepEqual(mock.client.devices,[]);
    assert.equal(animationRequests(mock).length,0);
  }
  for(const devices of [[cable(),cable({mac:'010203040507'})],[cable(),cable({id:60001,mac:'010203040506'.toUpperCase()})]]){
    const mock=mockClient(()=>enumeration(devices));t.after(()=>mock.client.close());
    await assert.rejects(mock.client.scan(),{code:'WIRELESS_INVALID_DATA'});assert.deepEqual(mock.client.devices,[]);
  }
});

test('Stream Deck and Elgato identities remain protected during discovery and after a session is created',async t=>{
  for(const values of [{name:'Stream Deck'},{vendor:'Elgato'},{devicePath:'USB\\VID_0FD9&PID_006C'},{protected:true}]){
    const mock=mockClient(()=>enumeration([cable(values)]));t.after(()=>mock.client.close());
    await assert.rejects(mock.client.scan(),{code:'DEVICE_PROTECTED'});assert.equal(animationRequests(mock).length,0);
  }
  const mock=await connected(t);mock.client.devices[0].name='Stream Deck';
  await assert.rejects(mock.client.update(mock.client.devices[0],Array(132).fill(255)),{code:'DEVICE_PROTECTED'});
  assert.equal(animationRequests(mock).length,0);
});

test('whole-cable static rendering transmits exact RGB bytes and bounded brightness',async t=>{
  const mock=await connected(t);const device=mock.client.devices[0];
  await mock.client.applySoftwareEffect(device,staticSettings(),null);
  const request=animationRequests(mock)[0];assert.equal(request.frameCount,1);assert.equal(request.intervalMs,100);
  assert.deepEqual(rgb(request),Buffer.from(Array.from({length:132},()=>[0x12,0x34,0x56]).flat()));
  assert.equal(device.leds[0].color,'#123456');
  await mock.client.applySoftwareEffect(device,staticSettings({colors:['#ffffff'],brightness:0}));
  assert(rgb(animationRequests(mock)[1]).every(value=>value===0));
  await mock.client.applySoftwareEffect(device,staticSettings({colors:['#ffffff'],brightness:25}),[0]);
  assert(rgb(animationRequests(mock)[2]).every(value=>value===64));
  for(const brightness of [-1,101,Infinity,'25'])await assert.rejects(mock.client.applySoftwareEffect(device,staticSettings({brightness})),{code:'INVALID_SETTINGS'});
  assert.equal(animationRequests(mock).length,3);
});

test('invalid zone selections are rejected before any wireless write; explicit whole-cable zone matches null selection',async t=>{
  const mock=await connected(t);const device=mock.client.devices[0];
  for(const zones of [[],[1],[0,0],[false],{},'all'])await assert.rejects(mock.client.applySoftwareEffect(device,staticSettings(),zones),{code:'INVALID_ZONES'});
  assert.equal(animationRequests(mock).length,0);
  await mock.client.applySoftwareEffect(device,staticSettings(),[0]);
  await mock.client.applySoftwareEffect(device,staticSettings(),null);
  assert.equal(animationRequests(mock)[0].rgb,animationRequests(mock)[1].rgb);
});

test('custom loops retain their duration, palette and finite frame budget during wireless upload',async t=>{
  const mock=await connected(t);const device=mock.client.devices[0];
  const settings=validateSettings({effect:'custom',colors:['#ff0000','#0000ff'],brightness:100,
    custom:{version:1,pattern:'bands',motion:'scroll',repeats:3,cycleSeconds:8,pulse:0}});
  const animation=wirelessAnimation(device,settings,null);
  assert.equal(animation.frameCount,64);assert.equal(animation.intervalMs,125);
  assert.notDeepEqual(animation.frames[0],animation.frames[10]);
  assert(animation.frames.flat().every(color=>color===255||color===0xff0000));
  await mock.client.applySoftwareEffect(device,settings,null);
  assert.equal(animationRequests(mock).length,1);assert.equal(rgb(animationRequests(mock)[0]).length,64*132*3);
});

test('controller memory overflow retries a smaller loop while preserving elapsed duration and the exact selected cable',async t=>{
  const mock=await connected(t,{respond:request=>{
    if(request.frameCount>16)throw new BridgeError('Memory limit','WIRELESS_ANIMATION_TOO_LARGE',422);
    return acknowledgement(request,{confirmed:true});
  }});
  const device=mock.client.devices[0];const result=await mock.client.applySoftwareEffect(device,{effect:'rainbow',speed:50},null);
  const requests=animationRequests(mock);assert.deepEqual(requests.map(r=>r.frameCount),[64,32,16]);
  assert(requests.every(r=>r.deviceId===device.id));
  for(const request of requests)assert(Math.abs(request.frameCount*request.intervalMs-5250)<=request.frameCount/2);
  assert.equal(result.confirmed,true);assert.equal(result.confirmation,'receiver');
  assert.equal(mock.client.animations.get(device.id).frameCount,16);
});

test('a sixty-second custom cycle keeps two animated frames at the final memory fallback and propagates rejection',async t=>{
  const mock=await connected(t,{respond:()=>{throw new BridgeError('Memory limit','WIRELESS_ANIMATION_TOO_LARGE',422);}});
  const device=mock.client.devices[0];
  const settings=validateSettings({effect:'custom',colors:['#ff0000','#0000ff'],brightness:100,
    custom:{version:1,pattern:'bands',motion:'scroll',repeats:3,cycleSeconds:60,pulse:0}});
  for(const requestedFrames of [2,1]){
    const animation=wirelessAnimation(device,settings,null,requestedFrames);
    assert.equal(animation.frameCount,2);assert.equal(animation.intervalMs,30000);
    assert.equal(animation.frameCount*animation.intervalMs,60000);
    assert(animation.intervalMs<=40959);
  }
  await assert.rejects(mock.client.applySoftwareEffect(device,settings,null),{code:'WIRELESS_ANIMATION_TOO_LARGE'});
  const requests=animationRequests(mock);
  assert.deepEqual(requests.map(request=>request.frameCount),[64,32,16,8,4,2]);
  assert.equal(requests.at(-1).intervalMs,30000);
  assert(requests.every(request=>request.frameCount>=2&&request.intervalMs<=40959&&request.deviceId===device.id));
  assert.equal(mock.client.animations.size,0);assert(device.colors.every(color=>color===0));
});

test('a rejected single static frame propagates its memory error without an animation fallback',async t=>{
  const mock=await connected(t,{respond:()=>{throw new BridgeError('Memory limit','WIRELESS_ANIMATION_TOO_LARGE',422);}});
  const device=mock.client.devices[0];
  await assert.rejects(mock.client.applySoftwareEffect(device,staticSettings(),null),{code:'WIRELESS_ANIMATION_TOO_LARGE'});
  assert.deepEqual(animationRequests(mock).map(request=>request.frameCount),[1]);
  assert.equal(mock.client.animations.size,0);assert(device.colors.every(color=>color===0));
});

test('generic controller errors are not retried and cannot overwrite previous accepted device colors',async t=>{
  let fail=false;
  const mock=await connected(t,{respond:request=>{
    if(fail)throw new BridgeError('USB disconnected','LIANLI_ERROR',422);return acknowledgement(request);
  }});
  const device=mock.client.devices[0];await mock.client.applySoftwareEffect(device,staticSettings(),null);
  const before=[...device.colors];const animation=mock.client.animations.get(device.id);fail=true;
  await assert.rejects(mock.client.applySoftwareEffect(device,{effect:'rainbow'},null),{code:'LIANLI_ERROR'});
  assert.equal(animationRequests(mock).length,2);assert.deepEqual(device.colors,before);
  assert.equal(mock.client.animations.get(device.id),animation);
});

test('transport success is described as pending confirmation until the receiver confirms the exact command',async t=>{
  let confirmed=false;
  const mock=await connected(t,{respond:request=>acknowledgement(request,{confirmed,acknowledgement:'untrusted text claiming success'})});
  const device=mock.client.devices[0];
  const pending=await mock.client.update(device,Array(132).fill(255));
  assert.equal(pending.confirmation,'transmitted');assert.equal(pending.confirmed,false);
  assert.match(pending.acknowledgement,/steht aus/);assert.equal(device.uploadConfirmation,'transmitted');
  confirmed=true;const accepted=await mock.client.update(device,Array(132).fill(65280));
  assert.equal(accepted.confirmation,'receiver');assert.match(accepted.acknowledgement,/Funkempfänger bestätigt/);
});

test('wrong, incomplete or malformed acknowledgements do not update the animation cache or colors',async t=>{
  for(const changed of [{deviceId:60001},{transmitted:false},{confirmed:'yes'},{confirmed:undefined},
    {effectIndex:'xyz'},{frameCount:2},{intervalMs:101}]){
    const mock=await connected(t,{respond:request=>acknowledgement(request,changed)});const device=mock.client.devices[0];
    await assert.rejects(mock.client.update(device,Array(132).fill(255)),{code:'WIRELESS_INVALID_DATA'});
    assert(device.colors.every(color=>color===0));assert.equal(mock.client.animations.size,0);
    assert.equal(device.uploadConfirmation,undefined);assert.equal(animationRequests(mock).length,1);
  }
});

test('direct LED updates preserve each RGB triplet and reject malformed colors before transmission',async t=>{
  const mock=await connected(t);const device=mock.client.devices[0];
  const colors=Array.from({length:132},(_,index)=>index===0?0x563412:index===131?0x030201:0);
  await mock.client.update(device,colors);const raw=rgb(animationRequests(mock)[0]);
  assert.deepEqual([...raw.subarray(0,3)],[18,52,86]);assert.deepEqual([...raw.subarray(-3)],[1,2,3]);
  assert.deepEqual(device.colors,colors);assert.equal(device.leds[131].color,'#010203');
  for(const invalid of [null,[],Array(131).fill(0),Array(132).fill(-1),Array(132).fill(0x1000000),Array(132).fill(NaN),Array(132).fill('0')])
    await assert.rejects(mock.client.update(device,invalid),{code:'INVALID_COLORS'});
  assert.equal(animationRequests(mock).length,1);
});

test('freeze uploads the selected cable current frame and blackout leaves a second cable untouched',async t=>{
  const mock=await connected(t,{devices:[cable(),cable({id:60001,mac:'010203040507'})]});
  const [first,second]=mock.client.devices;
  t.mock.method(Date,'now',()=>1000);
  mock.client.animations.set(first.id,{frames:[Array(132).fill(255),Array(132).fill(0xff0000)],frameCount:2,intervalMs:100,started:850});
  mock.client.animations.set(second.id,{frames:[Array(132).fill(65280)],frameCount:1,intervalMs:100,started:900});
  await mock.client.freezeSoftwareEffect(first);
  assert.deepEqual([...rgb(animationRequests(mock)[0]).subarray(0,3)],[0,0,255]);
  await mock.client.update(first,Array(132).fill(0));
  assert(rgb(animationRequests(mock)[1]).every(value=>value===0));
  assert(animationRequests(mock).every(request=>request.deviceId===first.id));
  assert.equal(mock.client.animations.get(second.id).frames[0][0],65280);
});

test('rescans invalidate old object targets and cables do not expose invented fan RPM',async t=>{
  const mock=await connected(t);const old=mock.client.devices[0];await mock.client.scan();
  await assert.rejects(mock.client.update(old,Array(132).fill(255)),{code:'DEVICE_LIST_CHANGED'});
  await assert.rejects(mock.client.selectDirect({...mock.client.devices[0]}),{code:'DEVICE_LIST_CHANGED'});
  assert.deepEqual(await mock.client.readTelemetry(),[]);assert.equal(animationRequests(mock).length,0);
  assert.equal(mock.requests.length,2);
});

test('composite routing and EffectEngine upload one loop per cable while keeping ordinary direct devices independent',async t=>{
  const mock=mockClient(request=>request.command==='enumerate'?enumeration([cable()]):acknowledgement(request));
  const ordinary=new EventEmitter();const writes=[];
  Object.assign(ordinary,{connected:true,details:{},devices:[{id:0,name:'Test Corsair device',type:2,directMode:true,colors:[0,0,0],ledCount:3,zones:[],modes:[]}],
    scan:async()=>ordinary.devices,selectDirect:async device=>assert.equal(device.id,0),
    update:async(device,colors)=>{writes.push({id:device.id,colors});device.colors=colors;},close:async()=>{ordinary.connected=false;}});
  const composite=new LightingClient({clients:[ordinary,mock.client]});t.after(()=>composite.close());await composite.scan();
  const engine=new EffectEngine(composite);t.after(()=>engine.stop());
  await engine.apply({...staticSettings(),deviceIds:[0,60000]});
  assert.equal(animationRequests(mock).length,1);assert.equal(writes.length,1);
  await engine.tick();assert.equal(animationRequests(mock).length,1);assert.equal(writes.length,2);
  assert.equal(engine.jobs.get(60000).uploaded,true);assert.equal(engine.jobs.get(60000).zones,null);
  mock.client.fail(new BridgeError('Wireless unavailable','NATIVE_DISCONNECTED'));
  assert.deepEqual(composite.devices.map(device=>device.id),[0]);assert.equal(composite.connected,true);
  assert.equal(mock.client.animations.size,0);assert.equal(mock.client.details.lianliWireless.status,'unavailable');
});
