'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CorsairDirectControl,normalizeSnapshot}=require('../src/services/corsair-direct-control.cjs');
const HUB='corsair-link-0123456789abcdef',FAN=HUB+'/fan/0/fan-serial';
const clone=value=>JSON.parse(JSON.stringify(value));
const idle=()=>({enabled:false,active:false,ownsControl:false,released:true,retryRequired:false,remaining:[],phase:'off',error:'',hubs:[],channels:[],sensors:[],devices:[],releaseVerification:'none'});
const active=()=>({...idle(),enabled:true,active:true,ownsControl:true,released:false,phase:'active',
 hubs:[{id:HUB,name:'iCUE LINK System Hub',serial:'HUB-SERIAL',vendorId:0x1b1c,productId:0x0c3f,firmware:'2.5.1',opened:true}],
 channels:[{id:FAN,hubId:HUB,channel:0,name:'QX120',kind:'fan',provider:'corsair-direct',device:'iCUE LINK System Hub',rpm:1372,duty:null}],
 devices:[{id:HUB,name:'iCUE LINK System Hub',serial:'HUB-SERIAL',ledCount:3,zones:[{id:0,name:'QX120',startIndex:0,ledCount:3}]}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(respond) {
 const calls=[],events=[];let state=idle(),timer;
 const hardware={available:true,component:{},async request(provider,command,values){calls.push({provider,command,values});if(respond){const result=await respond(command,values,()=>state,value=>{state=value;});if(result!==undefined)return result;}
  if(command==='status'||command==='heartbeat')return clone(state);
  if(command==='take-control'){state=active();return clone(state);}
  if(command==='release-control'){state={...idle(),releaseVerification:'device-ack'};return clone(state);}
  if(command==='manual'){state.channels[0].duty=values.duty;return {applied:true,id:values.id,duty:values.duty,state:clone(state)};}
  if(command==='set')return {applied:true,deviceId:values.deviceId,ledCount:values.colors.length,state:clone(state)};
  throw Error('unexpected '+command);
 }};
 const control=new CorsairDirectControl({hardware,beforeTakeover:async()=>events.push('SDK stopped'),afterRelease:async()=>events.push('SDK restored'),schedule:fn=>{timer=fn;return {unref(){}};},unschedule:()=>{timer=null;}});
 return {control,hardware,calls,events,tick:async()=>{timer?.();await settle();await control.queue;}};
}

test('construction and opening the OFF status never take over iCUE or issue RGB/PWM',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.control.snapshot().enabled,false);
 await f.control.inspect();assert.deepEqual(f.calls.map(value=>value.command),['status']);assert.equal(f.events.length,0);
 assert.equal(f.control.snapshot().inProcess,true);assert.equal(f.control.ready,false);
 await assert.rejects(f.control.setManual({id:FAN,duty:50,fanConfirmed:true}),error=>error.code==='CORSAIR_NOT_ACTIVE');
 assert.equal(f.calls.length,1);
});
test('takeover requires explicit iCUE-pause consent and stops SDK writes before the native call',async()=>{
 const f=fixture();await assert.rejects(f.control.enable(true),error=>error.code==='CORSAIR_CONSENT_REQUIRED');assert.equal(f.calls.length,0);
 const state=await f.control.enable(true,{confirmICuePause:true});assert.equal(state.phase,'ready');assert.equal(state.enabled,true);assert.equal(state.channels[0].duty,null);
 assert.deepEqual(f.events,['SDK stopped']);assert.deepEqual(f.calls,[{provider:'corsair-direct',command:'take-control',values:{confirmICuePause:true}}]);
 assert.equal(state.physicalVerification,false);assert.equal(state.curveAvailability.available,false);
});
test('only a confirmed exact fan and integer 30–100 percent can change cooling',async()=>{
 const f=fixture();await f.control.enable(true,{confirmICuePause:true});
 for(const value of [{id:FAN,duty:0,fanConfirmed:true},{id:FAN,duty:50.1,fanConfirmed:true},{id:FAN,duty:50,fanConfirmed:false}])await assert.rejects(f.control.setManual(value),error=>error.code==='CORSAIR_INVALID_FAN');
 await assert.rejects(f.control.setManual({id:'another-fan',duty:50,fanConfirmed:true}),error=>error.code==='CORSAIR_DEVICE_CHANGED');assert.equal(f.calls.length,1);
 await f.control.setManual({id:FAN,duty:55,fanConfirmed:true});assert.deepEqual(f.calls[1],{provider:'corsair-direct',command:'manual',values:{id:FAN,duty:55,fanConfirmed:true}});assert.equal(f.control.snapshot().channels[0].duty,55);
});
test('RGB uses the complete discovered layout and accepts only an exact native acknowledgement',async()=>{
 const f=fixture();await f.control.enable(true,{confirmICuePause:true});
 await assert.rejects(f.control.setColors(HUB,['#ff0000']),error=>error.code==='CORSAIR_INVALID_COLORS');assert.equal(f.calls.length,1);
 const frame=['#ff0000','#00ff00','#0000ff'];const reply=await f.control.setColors(HUB,frame);assert.deepEqual(f.calls[1],{provider:'corsair-direct',command:'set',values:{deviceId:HUB,colors:frame}});assert.equal(reply.applied,true);assert.equal(reply.physicalVerification,false);
 const wrong=fixture((command,values,get)=>command==='set'?{applied:true,deviceId:'wrong-hub',ledCount:3,state:clone(get())}:undefined);
 await wrong.control.enable(true,{confirmICuePause:true});await assert.rejects(wrong.control.setColors(HUB,frame),error=>error.code==='CORSAIR_RGB_UNCONFIRMED');assert.equal(wrong.control.snapshot().enabled,true);assert.equal(wrong.control.snapshot().phase,'error');
});
test('partial native restoration remains visible and restores SDK writing only after OFF retry succeeds',async()=>{
 let failing=true;const f=fixture((command,values,get,set)=>{if(command==='release-control'&&failing){const partial={...get(),enabled:false,active:false,ownsControl:false,released:false,retryRequired:true,remaining:['CorsairService'],phase:'error'};set(partial);throw Object.assign(Error('iCUE restoration failed'),{state:partial});}});
 await f.control.enable(true,{confirmICuePause:true});await assert.rejects(f.control.enable(false),/restoration failed/);
 assert.equal(f.control.snapshot().enabled,true);assert.equal(f.control.snapshot().phase,'error');assert.equal(f.control.returnRequired,true);assert.deepEqual(f.events,['SDK stopped']);
 failing=false;const state=await f.control.enable(false);assert.equal(state.enabled,false);assert.equal(state.releaseVerification,'device-ack');assert.equal(state.physicalVerification,false);assert.deepEqual(f.events,['SDK stopped','SDK restored']);
});
test('the native release result may wrap its complete lease snapshot without losing acknowledgement checks',async()=>{
 const f=fixture((command,values,get,set)=>{if(command==='release-control'){const state={...idle(),releaseVerification:'device-ack'};set(state);return {ok:true,released:true,retryRequired:false,state};}});
 await f.control.enable(true,{confirmICuePause:true});const released=await f.control.enable(false);assert.equal(released.enabled,false);assert.equal(released.releaseVerification,'device-ack');assert.deepEqual(f.events,['SDK stopped','SDK restored']);
});
test('quit waits for an accepted takeover, blocks another takeover, then releases the native lease',async()=>{
 const take=deferred();const f=fixture(async(command,values,get,set)=>{if(command==='take-control'){await take.promise;set(active());return active();}});
 const start=f.control.enable(true,{confirmICuePause:true});await settle();assert.equal(f.control.snapshot().phase,'starting');
 const quit=f.control.prepareHardwareQuit();assert.equal(quit,f.control.prepareHardwareQuit());
 await assert.rejects(f.control.enable(true,{confirmICuePause:true}),error=>error.code==='CORSAIR_QUITTING');assert.deepEqual(f.calls.map(value=>value.command),['take-control']);
 take.resolve();await start;await quit;assert.deepEqual(f.calls.map(value=>value.command),['take-control','status','release-control']);assert.equal(f.control.snapshot().enabled,false);assert.deepEqual(f.events,['SDK stopped','SDK restored']);
});
test('a queued RGB frame cannot write after quit begins while an already-running manual request drains',async()=>{
 const manual=deferred();const f=fixture(async(command,values,get)=>{if(command==='manual'){await manual.promise;return {applied:true,id:values.id,duty:values.duty,state:clone(get())};}});
 await f.control.enable(true,{confirmICuePause:true});const write=f.control.setManual({id:FAN,duty:60,fanConfirmed:true});await settle();
 const rgb=f.control.setColors(HUB,['#111111','#222222','#333333']);const rgbRejected=assert.rejects(rgb,error=>error.code==='CORSAIR_NOT_ACTIVE');const quit=f.control.prepareHardwareQuit();manual.resolve();await write;await rgbRejected;await quit;
 assert.deepEqual(f.calls.map(value=>value.command),['take-control','manual','status','release-control']);
});
test('failed quit preserves the controller, resets the quit latch, and allows the same OFF retry',async()=>{
 let failing=true;const f=fixture((command,values,get)=>{if(command==='release-control'&&failing)throw Object.assign(Error('mode ACK missing'),{state:clone(get())});});
 await f.control.enable(true,{confirmICuePause:true});await assert.rejects(f.control.close(),/ACK missing/);assert.equal(f.control.closed,false);assert.equal(f.control.quitting,false);assert.equal(f.control.snapshot().enabled,true);
 failing=false;await f.control.enable(false);await f.control.close();assert.equal(f.control.closed,true);assert.deepEqual(f.events,['SDK stopped','SDK restored']);
});
test('cached native ownership is released at quit even when JS has no active cooling state',async()=>{
 const f=fixture(command=>command==='status'?active():undefined);await f.control.prepareHardwareQuit();assert.deepEqual(f.calls.map(value=>value.command),['status','release-control']);assert.equal(f.control.returnRequired,false);
});
test('invalid release data cannot erase a potentially owned lease or fabricate quit success',async()=>{
 const f=fixture(command=>command==='release-control'?{released:true}:undefined);await f.control.enable(true,{confirmICuePause:true});await assert.rejects(f.control.prepareHardwareQuit(),error=>error.code==='CORSAIR_INVALID_DATA');assert.equal(f.control.snapshot().enabled,true);assert.equal(f.control.quitting,false);
});
test('one heartbeat updates telemetry without any fan/RGB setting command',async()=>{
 const f=fixture((command,values,get)=>command==='heartbeat'?{...clone(get()),channels:[{...get().channels[0],rpm:1400}]}:undefined);await f.control.enable(true,{confirmICuePause:true});await f.tick();assert.deepEqual(f.calls.map(value=>value.command),['take-control','heartbeat']);assert.equal(f.control.snapshot().channels[0].rpm,1400);
});
test('default OFF with a never-loaded component can close without any native call',async()=>{
 const f=fixture();f.hardware.component=null;await f.control.close();assert.equal(f.calls.length,0);assert.equal(f.control.closed,true);assert.equal(f.control.snapshot().enabled,false);
});
test('only the exact LINK hub identity and complete nonoverlapping topology are accepted',()=>{
 assert.throws(()=>normalizeSnapshot({...active(),hubs:[{...active().hubs[0],productId:0x0c1a}]}),error=>error.code==='CORSAIR_INVALID_DATA');
 const malformed=active();malformed.devices[0].zones=[{id:0,startIndex:0,ledCount:2}];assert.throws(()=>normalizeSnapshot(malformed),error=>error.code==='CORSAIR_INVALID_DATA');
 assert.throws(()=>normalizeSnapshot({...active(),released:true}),error=>error.code==='CORSAIR_INVALID_DATA');
 const pump=active();pump.channels.push({...pump.channels[0],id:'pump',name:'Cooler Pump',kind:'pump'});assert.equal(normalizeSnapshot(pump).channels.length,1);
});

test('explicit enumeration is passive and is unavailable while a control lease is owned',async()=>{
 const f=fixture(command=>command==='enumerate'?{state:{...idle(),hubs:active().hubs.map(hub=>({...hub,opened:false}))},probes:[{id:HUB,readable:true,firmware:'2.9.488',connected:2}],readOnly:true,hardwareModeChanged:false,pwmWrites:0}:undefined);
 const found=await f.control.enumerate();assert.equal(found.hubs[0].id,HUB);assert.equal(found.probes[0].connected,2);assert.equal(found.enabled,false);assert.deepEqual(f.calls.map(value=>value.command),['enumerate']);assert.deepEqual(f.events,[]);
 await f.control.enable(true,{confirmICuePause:true});await assert.rejects(f.control.enumerate(),error=>error.code==='CORSAIR_RELEASE_REQUIRED');assert.deepEqual(f.calls.map(value=>value.command),['enumerate','take-control']);
});

test('passive enumeration requires the explicit no-mode/no-PWM proof',async()=>{
 const f=fixture(command=>command==='enumerate'?{state:idle(),probes:[],readOnly:true,hardwareModeChanged:true,pwmWrites:0}:undefined);
 await assert.rejects(f.control.enumerate(),error=>error.code==='CORSAIR_INVALID_DATA');assert.equal(f.control.ready,false);assert.deepEqual(f.events,[]);
});

test('another provider can cancel the quit latch only after this controller has released successfully',async()=>{
 const f=fixture();await f.control.enable(true,{confirmICuePause:true});assert.equal(f.control.cancelHardwareQuit(),false);
 const quit=f.control.prepareHardwareQuit();assert.equal(f.control.cancelHardwareQuit(),false);await assert.rejects(f.control.enumerate(),error=>error.code==='CORSAIR_QUITTING');await quit;
 assert.equal(f.control.quitting,true);assert.equal(f.control.cancelHardwareQuit(),true);assert.equal(f.control.quitting,false);await f.control.enable(true,{confirmICuePause:true});assert.equal(f.control.ready,true);
});

test('SDK-only suspension failure retains an OFF retry until SDK restoration succeeds without a hardware lease',async()=>{
 const f=fixture();f.hardware.component=null;let resumeFails=true;
 f.control.beforeTakeover=async()=>{throw Error('SDK suspension failed');};
 f.control.afterRelease=async()=>{if(resumeFails)throw Error('SDK resume failed');};
 await assert.rejects(f.control.enable(true,{confirmICuePause:true}),/suspension failed/);assert.deepEqual(f.calls,[]);
 assert.equal(f.control.snapshot().enabled,false);assert.equal(f.control.snapshot().sdkSuppressed,true);assert.equal(f.control.snapshot().returnRequired,true);assert.equal(f.control.cancelHardwareQuit(),false);
 await assert.rejects(f.control.enable(false),/resume failed/);assert.equal(f.control.snapshot().returnRequired,true);
 resumeFails=false;await f.control.enable(false);assert.equal(f.control.snapshot().returnRequired,false);assert.equal(f.control.snapshot().sdkSuppressed,false);assert.deepEqual(f.calls,[]);
});
