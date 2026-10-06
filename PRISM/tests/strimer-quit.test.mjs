import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {LightingClient} from '../server/lighting-client.mjs';
import {InProcessStrimerControl} from '../server/in-process-lighting.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const off=()=>({ok:true,active:false,released:true,retryRequired:false,remaining:[]});
const active=()=>({ok:true,active:true,released:false,retryRequired:false,remaining:['LConnectService','LConnectServiceWatcher']});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class WirelessFixture extends EventEmitter{
  constructor(order){super();this.backend='lianli-wireless';this.order=order;this.connected=false;this.devices=[];this.details={};}
  async close(){this.order.push('usb-close');this.connected=false;this.devices=[];}
  async connect(){this.order.push('usb-connect');this.connected=true;this.devices=[{id:60000,name:'Fixture Strimer',vendor:'Fixture',provider:'lianli-wireless',type:4,directMode:true,ledCount:2,leds:[],zones:[],modes:[],colors:[0,0]}];}
  async scan(){return this.connect();}
}
function fixture({holdStart=false,provider=true}={}){
  const order=[],started=deferred(),finishStart=deferred();let lease=off(),failRestore=false,statusFailure;
  const hardware={available:true,component:{},request:async(nativeProvider,command)=>{
    assert.equal(nativeProvider,'wireless');order.push(command);
    if(command==='control-status'){if(statusFailure)throw statusFailure;return {...lease,remaining:[...lease.remaining]};}
    if(command==='take-control'){
      lease=active();started.resolve();if(holdStart)await finishStart.promise;return lease;
    }
    if(command==='release-control'){
      if(failRestore){lease={...active(),ok:false,retryRequired:true,remaining:['LConnectService']};throw Object.assign(Error('L-Connect konnte nicht starten'),{code:'WIRELESS_CONTROL_FAILED',state:lease});}
      lease=off();return lease;
    }
    throw Error('Unexpected native command');
  }};
  const control=new InProcessStrimerControl(hardware),wireless=new WirelessFixture(order);
  const client=new LightingClient({clients:provider?[wireless]:[],strimerControl:control,hardware});
  return {client,control,wireless,hardware,order,started,finishStart,set lease(value){lease=value;},get lease(){return lease;},
    set failRestore(value){failRestore=value;},set statusFailure(value){statusFailure=value;}};
}

test('quit waits for a native pause whose JavaScript start reply is pending and blocks new takeovers immediately',async()=>{
  const f=fixture({holdStart:true});
  const taking=f.client.setStrimerControl(true,true);await f.started.promise;
  assert.equal(f.control.status.phase,'starting');assert.equal(f.control.status.enabled,false);assert.equal(f.lease.active,true);
  let finished=false;const quitting=f.client.prepareHardwareQuit().then(()=>{finished=true;});
  await assert.rejects(f.client.setStrimerControl(true,true),{code:'RGB_QUITTING'});
  await tick();assert.equal(finished,false);assert.equal(f.order.includes('control-status'),false);
  f.finishStart.resolve();await taking;await quitting;
  assert.deepEqual(f.order,['usb-close','take-control','usb-connect','control-status','usb-close','release-control','control-status']);
  assert.equal(f.lease.active,false);assert.equal(f.control.status.phase,'off');assert.equal(f.client.quitting,true);
  await assert.rejects(f.client.setStrimerControl(true,true),{code:'RGB_QUITTING'});
});

test('concurrent accepted ON and OFF calls use one queue and quit follows both operations',async()=>{
  const f=fixture({holdStart:true});
  const taking=f.client.setStrimerControl(true,true);await f.started.promise;
  const returning=f.client.setStrimerControl(false),quitting=f.client.prepareHardwareQuit();
  await tick();assert.deepEqual(f.order,['usb-close','take-control']);
  f.finishStart.resolve();await Promise.all([taking,returning,quitting]);
  assert.deepEqual(f.order,['usb-close','take-control','usb-connect','usb-close','release-control','control-status']);
  assert.equal(f.lease.released,true);assert.equal(f.control.status.enabled,false);
});

test('a failed native restoration keeps its identity and OFF retry available instead of permitting quit',async()=>{
  const f=fixture();await f.client.setStrimerControl(true,true);f.failRestore=true;
  const originalControl=f.control;
  await assert.rejects(f.client.prepareHardwareQuit(),{code:'WIRELESS_CONTROL_FAILED'});
  assert.equal(f.client.quitting,false);assert.equal(f.client.hardwareQuitPromise,null);
  assert.equal(f.client.strimerControl,originalControl);assert.equal(f.control.status.enabled,true);assert.equal(f.control.status.phase,'error');
  assert.deepEqual(f.control.status.remaining,['LConnectService']);
  f.failRestore=false;await f.client.setStrimerControl(false);await f.client.prepareHardwareQuit();
  assert.equal(f.lease.released,true);assert.equal(f.control.status.phase,'off');assert.equal(f.client.quitting,true);
});

test('native partial ownership is returned even if the JavaScript switch incorrectly still says OFF',async()=>{
  const f=fixture();f.lease={...active(),ok:false,retryRequired:true,remaining:['LConnectService']};
  assert.equal(f.control.status.enabled,false);
  await f.client.prepareHardwareQuit();
  assert.deepEqual(f.order,['control-status','usb-close','release-control','control-status']);
  assert.equal(f.lease.active,false);assert.equal(f.control.status.enabled,false);
});

test('a cached native failure envelope still supplies the partial lease needed for restoration',async()=>{
  const f=fixture();f.lease={...active(),ok:false,retryRequired:true};
  f.statusFailure=Object.assign(Error('Earlier native operation failed'),{state:f.lease});
  const original=f.hardware.request;f.hardware.request=async(...args)=>{
    if(args[1]==='release-control')f.statusFailure=undefined;
    return original(...args);
  };
  await f.client.prepareHardwareQuit();assert.equal(f.lease.released,true);
});

test('a native owned lease can be restored even after the device provider disappeared',async()=>{
  const f=fixture({provider:false});f.lease=active();
  await f.client.prepareHardwareQuit();
  assert.deepEqual(f.order,['control-status','release-control','control-status']);assert.equal(f.lease.released,true);
});

test('idle quit reads only the cached native lease without scanning, opening USB or changing services',async()=>{
  const f=fixture();const first=f.client.prepareHardwareQuit(),second=f.client.prepareHardwareQuit();
  assert.equal(first,second);await first;
  assert.deepEqual(f.order,['control-status']);assert.equal(f.control.status.phase,'off');
});

test('an unavailable never-loaded native engine cannot own a lease and does not block default OFF shutdown',async()=>{
  const f=fixture();f.hardware.available=false;f.hardware.component=null;
  await f.client.prepareHardwareQuit();assert.deepEqual(f.order,[]);
});

test('status failure without a valid lease and malformed native states block quit with a retryable client',async()=>{
  for(const state of [null,{}, {active:false,released:true,retryRequired:false,remaining:[42]}]){
    const f=fixture();
    if(state===null)f.statusFailure=Object.assign(Error('Native engine unavailable'),{code:'HARDWARE_UNAVAILABLE'});
    else f.lease=state;
    await assert.rejects(f.client.prepareHardwareQuit());assert.equal(f.client.quitting,false);assert.equal(f.client.hardwareQuitPromise,null);
    assert.equal(f.order.includes('take-control'),false);assert.equal(f.order.includes('release-control'),false);
  }
});

test('legacy guards still return their live lease through enabled status without a native engine',async()=>{
  const order=[],guard=new EventEmitter();guard.status={enabled:true,phase:'active'};
  guard.stop=async()=>{order.push('legacy-stop');guard.status={enabled:false,phase:'off'};};
  const client=new LightingClient({clients:[new WirelessFixture(order)],strimerControl:guard});
  await client.prepareHardwareQuit();assert.deepEqual(order,['usb-close','legacy-stop']);assert.equal(guard.status.enabled,false);
});

test('a rejected earlier control job does not poison the quit queue or erase native restoration duties',async()=>{
  const f=fixture();
  await assert.rejects(f.client.setStrimerControl(true,false),{code:'WIRELESS_CONSENT_REQUIRED'});
  f.lease=active();await f.client.prepareHardwareQuit();assert.equal(f.lease.released,true);
});
