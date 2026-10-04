import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EffectEngine,validateSettings,renderFrame} from '../server/effects.mjs';
import {DEFAULT_CUSTOM,validateCustomSettings,isAnimatedEffect} from '../server/effect-renderer.mjs';
import {validConfig} from '../src/data.js';
import {readProfiles,saveProfiles,validateProfiles} from '../server/profiles.mjs';

const settings=(custom={},overrides={})=>validateSettings({effect:'custom',colors:['#ff0000','#00ff00'],brightness:100,speed:50,scale:40,direction:'forward',custom:{...DEFAULT_CUSTOM,...custom},...overrides});
const channels=packed=>[packed&255,packed>>>8&255,packed>>>16&255];

test('custom defaults and validation are shared by the preview, hardware and profile import',()=>{
 assert.deepEqual(validateSettings({effect:'custom'}).custom,DEFAULT_CUSTOM);
 const value=settings({pattern:'bands',motion:'bounce',repeats:7,cycleSeconds:.25,pulse:45});
 assert.deepEqual(validConfig(value),value);
 assert.deepEqual(validateCustomSettings({...value.custom,unknown:true}),value.custom);
 const copied=validateSettings(value);copied.custom.repeats=2;copied.colors[0]='#ffffff';
 assert.equal(value.custom.repeats,7);assert.equal(value.colors[0],'#ff0000');
 assert.ok(!Object.hasOwn(validateSettings({...value,effect:'wave'}),'custom'),'old effects keep their released profile schema');
});

test('malformed custom profiles are rejected before any device changes',async()=>{
 const invalid=[null,[],false,'x',{version:2},{pattern:'script'},{motion:'reset'},{repeats:0},{repeats:13},{repeats:1.5},{repeats:'2'},{cycleSeconds:0},{cycleSeconds:61},{cycleSeconds:NaN},{cycleSeconds:Infinity},{cycleSeconds:'4'},{pulse:-1},{pulse:101},{pulse:'0'}];
 for(const custom of invalid){assert.throws(()=>validateSettings({...settings(),custom}),{code:'INVALID_SETTINGS'});assert.throws(()=>validConfig({...settings(),custom}));}
 const client=new EventEmitter();Object.assign(client,{connected:true,devices:[],selectDirect:()=>{throw Error('must not write');}});
 const engine=new EffectEngine(client);await assert.rejects(engine.apply({...settings(),custom:{pulse:101},deviceIds:[0]}),{code:'INVALID_SETTINGS'});
 assert.equal(engine.jobs.size,0);
});

test('own gradients mix chosen colors while blocks use only the selected palette',()=>{
 const gradient=renderFrame(5,settings({motion:'still'}),0);
 assert.deepEqual(gradient,[0x0000ff,0x008080,0x00ff00,0x008080,0x0000ff]);
 const blocks=renderFrame(9,settings({pattern:'bands',motion:'still'}),0);
 assert.deepEqual(blocks,[255,255,255,255,65280,65280,65280,65280,255]);
 assert.deepEqual(renderFrame(9,settings({pattern:'bands',motion:'still'}),24),blocks);
 const mono=settings({pattern:'bands',motion:'bounce',repeats:12,pulse:30},{colors:['#0000ff']});
 assert.ok(renderFrame(47,mono,3.14).every(color=>(color&0xffff)===0));
});

test('custom movement follows its own duration, loops and mirrors the selected direction',()=>{
 for(const pattern of ['gradient','bands'])for(const motion of ['scroll','bounce']){
  const config=settings({pattern,motion,cycleSeconds:8,repeats:3});
  assert.notDeepEqual(renderFrame(97,config,1.371),renderFrame(97,config,2.219));
  assert.deepEqual(renderFrame(97,config,1.371),renderFrame(97,config,9.371));
  assert.deepEqual(renderFrame(97,{...config,direction:'reverse'},1.371),renderFrame(97,config,1.371).toReversed());
  assert.deepEqual(renderFrame(97,{...config,speed:1,scale:100},1.371),renderFrame(97,config,1.371),'released speed/scale fields do not override an explicit custom pattern');
 }
 const bounce=settings({motion:'bounce',cycleSeconds:8});
 assert.deepEqual(renderFrame(97,bounce,2),renderFrame(97,bounce,6),'a round trip returns through the same positions');
 const slow=settings({cycleSeconds:8}),fast=settings({cycleSeconds:4});
 assert.deepEqual(renderFrame(97,slow,2),renderFrame(97,fast,1));
});

test('repeats controls independent spatial detail and the pulse can reach real darkness',()=>{
 const countTransitions=frame=>frame.slice(1).filter((color,index)=>color!==frame[index]).length;
 assert.ok(countTransitions(renderFrame(241,settings({pattern:'bands',motion:'still',repeats:8}),0))>countTransitions(renderFrame(241,settings({pattern:'bands',motion:'still',repeats:1}),0)));
 const pulse=settings({motion:'still',cycleSeconds:4,pulse:100},{colors:['#ffffff']});
 assert.equal(renderFrame(1,pulse,0)[0],0xffffff);
 assert.equal(renderFrame(1,pulse,1)[0],0x808080);
 assert.equal(renderFrame(1,pulse,2)[0],0);
 assert.ok(renderFrame(50,{...pulse,brightness:0},.51).every(color=>color===0));
 assert.deepEqual(renderFrame(0,pulse,0),[]);
 assert.ok(channels(renderFrame(1,settings({pulse:75},{brightness:17}),.7)[0]).every(value=>value<=Math.round(255*.17)));
});

test('still custom patterns finish after one real update while motion or pulse keeps streaming',async t=>{
 const sent=[],selected=[];
 const device={id:4,name:'Test direct strip',directMode:true,colors:[1,2,3,4,5,6],zones:[{id:0,name:'Selected area',startIndex:1,ledCount:3}],provider:'test'};
 const other={...device,id:5,name:'Unselected test strip',colors:[7,8,9,10,11,12]};
 const client=new EventEmitter();Object.assign(client,{connected:true,devices:[device,other],async selectDirect(target){selected.push(target.id);},async update(target,frame){sent.push({id:target.id,frame});}});
 const engine=new EffectEngine(client,{now:()=>2000});t.after(()=>engine.stop());
 const result=await engine.apply({...settings({pattern:'bands',motion:'still'}),deviceIds:[4],zoneIds:{4:[0]}});
 assert.deepEqual(result.applied,[4]);assert.deepEqual(selected,[4]);assert.equal(engine.running,false);assert.equal(engine.timer,null);
 assert.deepEqual(sent,[{id:4,frame:[1,255,65280,255,5,6]}]);assert.deepEqual(other.colors,[7,8,9,10,11,12]);
 assert.equal(isAnimatedEffect(settings({motion:'still',pulse:1})),true);
 assert.equal(isAnimatedEffect(settings({motion:'scroll',pulse:0})),true);
 await engine.apply({...settings({motion:'still',pulse:20}),deviceIds:[4]});assert.equal(engine.running,true);assert.ok(engine.timer);engine.stop([4]);assert.equal(engine.timer,null);
});

test('own patterns survive save, load and profile exports without changing old profiles',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-custom-profile-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const profiles=[{id:'custom-preset',name:'Mein Strimer-Muster',config:settings({pattern:'bands',motion:'bounce',repeats:6,cycleSeconds:7.25,pulse:53},{direction:'reverse',brightness:63})},{id:'old-preset',name:'Alte Welle',config:validateSettings({effect:'wave',colors:['#abcdef'],speed:66})}];
 await saveProfiles(directory,profiles);
 const saved=await readProfiles(directory);assert.deepEqual(saved,profiles);
 const imported=JSON.parse(JSON.stringify({app:'PRISM',version:1,profiles:saved}));
 assert.deepEqual(validateProfiles(imported.profiles),profiles);
 for(const profile of imported.profiles)assert.deepEqual(validConfig(profile.config),profile.config);
 await assert.rejects(saveProfiles(directory,[{...profiles[0],config:{...profiles[0].config,custom:{motion:'unsupported'}}}]),{code:'INVALID_SETTINGS'});
 assert.deepEqual(await readProfiles(directory),profiles);
});

test('one hundred bounded custom profiles with long Unicode names remain readable',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'prism-custom-profile-limit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const profiles=Array.from({length:100},(_,index)=>({id:'界'.repeat(75)+index,name:'界'.repeat(60),config:settings({repeats:12,cycleSeconds:59.75,pulse:100},{colors:Array(8).fill('#abcdef')})}));
 assert.ok(Buffer.byteLength(JSON.stringify(profiles))>64*1024);
 await saveProfiles(directory,profiles);assert.deepEqual(await readProfiles(directory),profiles);
});

const uploadDevice=id=>({id,name:`Test Wireless strip ${id}`,directMode:true,effectUpload:true,colors:[1,2,3,4],zones:[{id:0,name:'Selected light area',startIndex:0,ledCount:4}],provider:'test'});

test('wireless effects upload once and never receive individual software frames',async t=>{
 const calls=[],device=uploadDevice(8),client=new EventEmitter();
 Object.assign(client,{connected:true,devices:[device],async selectDirect(){throw Error('wireless does not use selectDirect');},async update(){throw Error('wireless must not be flooded with frames');},async applySoftwareEffect(target,config,zones){calls.push({id:target.id,config,zones});return {confirmation:'transmitted',acknowledgement:'Windows HID transfer'};}});
 const engine=new EffectEngine(client);t.after(()=>engine.stop());
 const config=settings({motion:'bounce',repeats:4,cycleSeconds:7,pulse:38});
 const result=await engine.apply({...config,deviceIds:[8],zoneIds:{8:[0]}});
 assert.deepEqual(calls,[{id:8,config,zones:[0]}]);
 assert.equal(result.streamed,false);assert.deepEqual(result.uploads,[{deviceId:8,confirmation:'transmitted',acknowledgement:'Windows HID transfer'}]);
 assert.equal(engine.running,true);assert.equal(engine.streaming,false);assert.equal(engine.timer,null);assert.equal(engine.active[0].uploaded,true);
 await engine.tick();await engine.tick();assert.equal(calls.length,1);
});

test('mixed wired and uploaded effects keep a timer only for the wired device',async t=>{
 const writes=[],direct=uploadDevice(3);delete direct.effectUpload;
 const wireless=uploadDevice(8),client=new EventEmitter();
 Object.assign(client,{connected:true,devices:[direct,wireless],async selectDirect(target){assert.equal(target.id,3);},async update(target){writes.push(target.id);},async applySoftwareEffect(){return {confirmation:'transmitted'};}});
 const engine=new EffectEngine(client);t.after(()=>engine.stop());
 const result=await engine.apply({...settings(),deviceIds:[3,8]});
 assert.equal(result.streamed,true);assert.deepEqual(writes,[3]);assert.ok(engine.timer);assert.equal(engine.streaming,true);
 await engine.tick();assert.deepEqual(writes,[3,3]);
 engine.stop([3]);assert.equal(engine.running,true);assert.equal(engine.streaming,false);assert.equal(engine.timer,null);
 await engine.tick();assert.deepEqual(writes,[3,3]);
});

test('uploaded targets and zones are validated before any write, and partial uploads retain confirmed status',async t=>{
 const calls=[],client=new EventEmitter();
 Object.assign(client,{connected:true,devices:[uploadDevice(8),uploadDevice(9)],async applySoftwareEffect(target){calls.push(target.id);if(target.id===9)throw new Error('Second wireless transfer failed');return {confirmation:'transmitted'};}});
 const engine=new EffectEngine(client);t.after(()=>engine.stop());
 await assert.rejects(engine.apply({...settings(),deviceIds:[8,9],zoneIds:{9:[99]}}),{code:'INVALID_ZONES'});assert.deepEqual(calls,[]);
 await assert.rejects(engine.apply({...settings(),deviceIds:[8,9]}),error=>error.message==='Second wireless transfer failed'&&JSON.stringify(error.appliedDeviceIds)==='[8]');
 assert.deepEqual(calls,[8,9]);assert.deepEqual(engine.active.map(value=>value.deviceId),[8]);assert.equal(engine.active[0].confirmation,'transmitted');assert.equal(engine.timer,null);
 delete client.applySoftwareEffect;
 await assert.rejects(engine.apply({...settings(),deviceIds:[9]}),{code:'DIRECT_UNSUPPORTED'});
 assert.deepEqual(engine.active.map(value=>value.deviceId),[8]);
});

test('a rejected replacement upload retains the previously uploaded loop and its confirmation',async t=>{
 const device=uploadDevice(8),client=new EventEmitter();let reject=false;
 Object.assign(client,{connected:true,devices:[device],async applySoftwareEffect(){if(reject)throw Error('Replacement rejected');return {confirmation:'receiver',acknowledgement:'Receiver accepted first loop'};}});
 const engine=new EffectEngine(client);t.after(()=>engine.stop());
 await engine.apply({...settings({repeats:3}),deviceIds:[8]});const previous=engine.jobs.get(8);reject=true;
 await assert.rejects(engine.apply({...settings({repeats:9}),deviceIds:[8]}),error=>error.message==='Replacement rejected'&&error.appliedDeviceIds===undefined);
 assert.equal(engine.jobs.get(8),previous);assert.equal(engine.active[0].settings.custom.repeats,3);assert.equal(engine.active[0].confirmation,'receiver');assert.equal(engine.running,true);assert.equal(engine.timer,null);
});

test('partial replacement keeps the newly confirmed first loop and the failed targets earlier loop',async t=>{
 const client=new EventEmitter();let replace=false;
 Object.assign(client,{connected:true,devices:[uploadDevice(8),uploadDevice(9)],async applySoftwareEffect(device){if(replace&&device.id===9)throw Error('Second replacement rejected');return {confirmation:'receiver',acknowledgement:replace?'New loop':'Previous loop'};}});
 const engine=new EffectEngine(client);t.after(()=>engine.stop());
 await engine.apply({...settings({repeats:2}),deviceIds:[8,9]});const second=engine.jobs.get(9);replace=true;
 await assert.rejects(engine.apply({...settings({repeats:7}),deviceIds:[8,9]}),error=>error.message==='Second replacement rejected'&&JSON.stringify(error.appliedDeviceIds)==='[8]');
 assert.equal(engine.active.find(item=>item.deviceId===8).settings.custom.repeats,7);assert.equal(engine.jobs.get(9),second);assert.equal(engine.active.find(item=>item.deviceId===9).settings.custom.repeats,2);assert.equal(engine.timer,null);
});

test('a disconnected upload target never regains a stale earlier job after a failed replacement',async t=>{
 const device=uploadDevice(8),client=new EventEmitter();let disconnect=false;
 Object.assign(client,{connected:true,devices:[device],async applySoftwareEffect(){if(disconnect){client.connected=false;client.devices=[];client.emit('providerDisconnected',{deviceIds:[8],message:'Synthetic receiver lost'});throw Error('Receiver lost');}return {confirmation:'receiver'};}});
 const engine=new EffectEngine(client);t.after(()=>engine.stop());await engine.apply({...settings(),deviceIds:[8]});disconnect=true;
 await assert.rejects(engine.apply({...settings({repeats:4}),deviceIds:[8]}),/Receiver lost/);assert.equal(engine.active.length,0);assert.equal(engine.timer,null);
});
