import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {StrimerControl} from '../server/strimer-control.mjs';
import {LightingClient} from '../server/lighting-client.mjs';
import {createBridge} from '../server/index.mjs';
import {BridgeError,publicController} from '../server/openrgb.mjs';

class FakeSocket extends EventEmitter{
 constructor({restoreOk=true,throwOps=[],helloMessages}={}){super();this.destroyed=false;this.requests=[];this.restoreOk=restoreOk;this.throwOps=new Set(throwOps);this.helloMessages=helloMessages;this.holdRestore=false;}
 setEncoding(value){assert.equal(value,'utf8');}
 write(chunk){
  const request=JSON.parse(chunk);this.requests.push(request);
  if(this.throwOps.has(request.op))throw new BridgeError('Simulierter Transportfehler.','FAKE_TRANSPORT_ERROR',422);
  if(request.op==='heartbeat')this.emit('heartbeat-request');
  if(request.op==='stop'){this.emit('stop-request');if(this.holdRestore)return true;}
  if(request.op==='hello'&&this.helloMessages){queueMicrotask(()=>this.emit('data',this.helloMessages.map(value=>JSON.stringify(value)+'\n').join('')));return true;}
  const response=request.op==='hello'?{event:'ready'}:request.op==='heartbeat'?{event:'heartbeat'}:request.op==='stop'?{event:'restored',ok:this.restoreOk}:null;
  if(response)queueMicrotask(()=>{if(!this.destroyed)this.emit('data',JSON.stringify(response)+'\n');});
  return true;
 }
 end(){this.destroyed=true;queueMicrotask(()=>this.emit('close'));}
 destroy(){this.destroyed=true;queueMicrotask(()=>this.emit('close'));}
}
function protocolFixture(options={}){
 const launches=[],connects=[],socket=new FakeSocket(options);
 const guard=new StrimerControl({platform:'test',available:true,heartbeatMs:10,readyTimeout:200,stopTimeout:200,
  launch:async(pipe,token)=>{launches.push({pipe,token});if(options.rejectLaunch)throw new BridgeError('Administratorabfrage abgebrochen.','WIRELESS_CONTROL_DENIED',422);},
  connect:async pipe=>{connects.push(pipe);return socket;}});
 return {guard,socket,launches,connects};
}

test('constructing the guard is read-only and starts off without a launch or connection',async()=>{
 const fixture=protocolFixture();assert.deepEqual(fixture.guard.status,{available:true,enabled:false,phase:'off',message:'Strimer-Übernahme ist ausgeschaltet.'});
 assert.equal(fixture.launches.length,0);assert.equal(fixture.connects.length,0);assert.equal(fixture.socket.requests.length,0);
 await fixture.guard.stop();assert.equal(fixture.launches.length,0);assert.equal(fixture.socket.requests.length,0);
});

test('explicit guard handshake keeps a heartbeat lease and stops only after restoration acknowledgement',async t=>{
 const fixture=protocolFixture(),phases=[];fixture.guard.on('change',value=>phases.push(value.phase));t.after(()=>fixture.guard.stop());
 const status=await fixture.guard.start();assert.equal(status.enabled,true);assert.equal(status.phase,'active');
 assert.equal(fixture.launches.length,1);assert.deepEqual(fixture.connects,[fixture.launches[0].pipe]);
 assert.equal(fixture.socket.requests[0].op,'hello');assert.equal(fixture.socket.requests[0].token,fixture.launches[0].token);
 await once(fixture.socket,'heartbeat-request');
 assert(fixture.socket.requests.some(value=>value.op==='heartbeat'));assert(fixture.socket.requests.every(value=>value.token===fixture.launches[0].token));
 await fixture.guard.start();assert.equal(fixture.launches.length,1);
 fixture.socket.holdRestore=true;const stopRequested=once(fixture.socket,'stop-request'),restoring=fixture.guard.stop();await stopRequested;
 let heartbeatDuringRestore=false;try{await once(fixture.socket,'heartbeat-request',{signal:AbortSignal.timeout(100)});heartbeatDuringRestore=true;}catch{}finally{fixture.socket.emit('data',JSON.stringify({event:'restored',ok:true})+'\n');fixture.socket.holdRestore=false;}
 const stopped=await restoring;assert.equal(heartbeatDuringRestore,true,'An alive parent must renew the guard lease while SCM restoration is pending.');assert.equal(stopped.enabled,false);assert.equal(stopped.phase,'off');assert.equal(fixture.guard.timer,null);assert.equal(fixture.guard.waiters.size,0);assert(fixture.socket.requests.some(value=>value.op==='stop'));
 assert.deepEqual(phases,['starting','active','restoring','off']);
});

test('rejected Windows approval never creates an active service lease or a socket connection',async()=>{
 const fixture=protocolFixture({rejectLaunch:true}),phases=[];fixture.guard.on('change',value=>phases.push(value.phase));
 await assert.rejects(fixture.guard.start(),{code:'WIRELESS_CONTROL_DENIED'});
 assert.equal(fixture.guard.status.enabled,false);assert.equal(fixture.guard.status.phase,'error');assert.match(fixture.guard.status.message,/abgebrochen/);
 assert.equal(fixture.connects.length,0);assert.equal(fixture.socket.requests.length,0);assert(!phases.includes('active'));assert.equal(fixture.guard.timer,null);
});

test('a failed restoration keeps the guard alive for an explicit retry and never claims off',async t=>{
 const fixture=protocolFixture({restoreOk:false});t.after(async()=>{fixture.socket.restoreOk=true;await fixture.guard.stop();});await fixture.guard.start();
 await assert.rejects(fixture.guard.stop(),{code:'WIRELESS_RESTORE_FAILED'});
 assert.equal(fixture.guard.status.phase,'error');assert.equal(fixture.guard.status.enabled,true);assert.match(fixture.guard.status.message,/nicht vollständig/);assert.notEqual(fixture.guard.timer,null);assert.equal(fixture.guard.waiters.size,0);assert.equal(fixture.socket.destroyed,false);
 fixture.socket.restoreOk=true;await fixture.guard.stop();assert.equal(fixture.guard.status.enabled,false);assert.equal(fixture.guard.status.phase,'off');assert.equal(fixture.guard.timer,null);
});

test('a synchronous stop-write failure cleans its waiter and permits restoration retry',async t=>{
 const fixture=protocolFixture();t.after(async()=>{fixture.socket.throwOps.clear();await fixture.guard.stop();});await fixture.guard.start();fixture.socket.throwOps.add('stop');
 await assert.rejects(fixture.guard.stop(),{code:'FAKE_TRANSPORT_ERROR'});
 assert.equal(fixture.guard.waiters.size,0);assert.equal(fixture.guard.status.phase,'error');assert.equal(fixture.guard.status.enabled,true);assert.equal(fixture.socket.destroyed,false);
 fixture.socket.throwOps.clear();await fixture.guard.stop();assert.equal(fixture.guard.status.phase,'off');assert.equal(fixture.guard.timer,null);
});

test('a synchronous handshake-write failure cannot leak a pending ready waiter',async t=>{
 const fixture=protocolFixture({throwOps:['hello']});t.after(()=>fixture.guard.stop());
 await assert.rejects(fixture.guard.start(),{code:'FAKE_TRANSPORT_ERROR'});
 assert.equal(fixture.guard.waiters.size,0);assert.equal(fixture.guard.status.enabled,false);assert.equal(fixture.guard.status.phase,'error');assert.equal(fixture.guard.timer,null);
});

test('startup error followed by restored-ok with no services never becomes successful ownership',async t=>{
 const fixture=protocolFixture({helloMessages:[{event:'error',code:'WIRELESS_HANDOFF_FAILED',message:'Dienstidentität konnte nicht geprüft werden.'},{event:'restored',ok:true,services:[],reason:'error'}]}),phases=[];
 fixture.guard.on('change',value=>phases.push(value.phase));t.after(()=>fixture.guard.stop());
 await assert.rejects(fixture.guard.start(),{code:'WIRELESS_HANDOFF_FAILED'});
 assert.equal(fixture.guard.status.enabled,false);assert.equal(fixture.guard.status.phase,'error');assert.match(fixture.guard.status.message,/Dienstidentität/);assert.equal(fixture.guard.waiters.size,0);assert.equal(fixture.guard.timer,null);assert(!phases.includes('active'));
});

const device=(id,provider)=>({id,name:provider==='lianli-wireless'?'Strimer Wireless fixture':'Windows RGB fixture',vendor:'Fixture',provider,type:4,ledCount:4,directMode:true,colors:[0,0,0,0],leds:[0,1,2,3].map(id=>({id})),modes:[],zones:[{id:0,startIndex:0,ledCount:4}]});
class FakeProvider extends EventEmitter{
 constructor(backend,id,order,{connected=true,failConnect=false}={}){super();this.backend=backend;this.savedDevice=device(id,backend);this.devices=connected?[this.savedDevice]:[];this.alive=connected;this.order=order;this.calls=[];this.failConnect=failConnect;this.details={};}
 get connected(){return this.alive;}
 record(op){this.calls.push(op);this.order.push(`${this.backend}.${op}`);}
 async connect(){this.record('connect');if(this.failConnect)throw new BridgeError('WinUSB nicht erreichbar.','WIRELESS_ACCESS_DENIED',422);this.alive=true;this.devices=[this.savedDevice];return this.devices.map(publicController);}
 async scan(){this.record('scan');return this.devices.map(publicController);}
 async close(){this.record('close');this.alive=false;this.devices=[];}
 async selectDirect(){this.record('selectDirect');}
 async update(){this.record('update');}
 async applySoftwareEffect(){this.record('apply');return {deviceId:this.savedDevice.id,transmitted:true,confirmed:true,confirmation:'receiver'};}
}
class FakeGuard extends EventEmitter{
 constructor(order){super();this.order=order;this.calls=[];this.status={available:true,enabled:false,phase:'off',message:'Testguard ausgeschaltet.'};}
 async start(){this.calls.push('start');this.order.push('guard.start');this.status={...this.status,enabled:true,phase:'active',message:'Testguard übernommen.'};return this.status;}
 async stop(){this.calls.push('stop');this.order.push('guard.stop');this.status={...this.status,enabled:false,phase:'off',message:'Testguard wiederhergestellt.'};return this.status;}
}
function compositeFixture(options={}){
 const order=[],windows=new FakeProvider('windows',20000,order),wireless=new FakeProvider('lianli-wireless',60000,order,options),guard=new FakeGuard(order);
 const client=new LightingClient({clients:[windows,wireless],strimerControl:guard});client.refresh();return {order,windows,wireless,guard,client};
}

test('composite construction and invalid pause consent do not close a provider or start the guard',async()=>{
 const fixture=compositeFixture();assert.equal(fixture.guard.status.enabled,false);assert.equal(fixture.order.length,0);
 for(const consent of [undefined,false,'true',1])await assert.rejects(fixture.client.setStrimerControl(true,consent),{code:'WIRELESS_CONSENT_REQUIRED'});
 assert.equal(fixture.order.length,0);assert.equal(fixture.windows.connected,true);assert.equal(fixture.wireless.connected,true);
});

test('failed discovery closes WinUSB before rollback restores the paused services',async()=>{
 const fixture=compositeFixture({connected:false,failConnect:true});
 await assert.rejects(fixture.client.setStrimerControl(true,true),{code:'WIRELESS_HANDOFF_NO_CABLES'});
 assert.deepEqual(fixture.order,['lianli-wireless.close','guard.start','lianli-wireless.connect','lianli-wireless.close','guard.stop']);
 assert.equal(fixture.guard.status.enabled,false);assert.equal(fixture.guard.status.phase,'off');assert.equal(fixture.windows.calls.length,0);assert.deepEqual(fixture.client.devices.map(value=>value.id),[20000]);
});

test('rollback still attempts guard restoration when releasing the failed provider rejects',async()=>{
 const fixture=compositeFixture({connected:false,failConnect:true});let closes=0;
 fixture.wireless.close=async()=>{fixture.wireless.record('close');fixture.wireless.alive=false;fixture.wireless.devices=[];if(++closes===2)throw new BridgeError('Simulierte Freigabe fehlgeschlagen.','FAKE_CLOSE_FAILED',422);};
 await assert.rejects(fixture.client.setStrimerControl(true,true),{code:'FAKE_CLOSE_FAILED'});
 assert.deepEqual(fixture.order,['lianli-wireless.close','guard.start','lianli-wireless.connect','lianli-wireless.close','guard.stop']);
 assert.equal(fixture.guard.status.enabled,false);assert.equal(fixture.guard.status.phase,'off');assert.equal(fixture.windows.calls.length,0);assert.deepEqual(fixture.client.devices.map(value=>value.id),[20000]);
});

async function post(url,body){const response=await fetch(url+'/api/strimer/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
test('HTTP handoff touches only Wireless, preserves an existing Windows RGB job and applies no cable effect',async t=>{
 const fixture=compositeFixture(),bridge=createBridge({client:fixture.client,port:0,inventory:async()=>({})});
 const address=await bridge.listen(),url=`http://127.0.0.1:${address.port}`;
 t.after(async()=>{bridge.engine.stop();await fixture.client.close();await new Promise(resolve=>bridge.server.close(resolve));});
 await bridge.engine.apply({effect:'static',colors:['#123456'],deviceIds:[20000]});const windowsJob=bridge.engine.jobs.get(20000);fixture.windows.calls=[];fixture.order=[];
 for(const body of [{enabled:'true',confirmLConnectPause:true},{enabled:true,confirmLConnectPause:false},{enabled:true,confirmLConnectPause:true,deviceIds:[60000]}]){const reply=await post(url,body);assert.equal(reply.status,400);}
 assert.equal(fixture.guard.calls.length,0);assert.equal(fixture.wireless.calls.length,0);
 const active=await post(url,{enabled:true,confirmLConnectPause:true});assert.equal(active.status,200);assert.equal(active.body.status.strimerControl.enabled,true);assert.equal(active.body.status.strimerControl.phase,'active');assert.deepEqual(active.body.devices.map(value=>value.id),[20000,60000]);
 assert.equal(bridge.engine.jobs.get(20000),windowsJob);assert.equal(bridge.engine.jobs.has(60000),false);assert.equal(fixture.windows.calls.length,0);assert.deepEqual(fixture.wireless.calls,['close','connect']);
 const restored=await post(url,{enabled:false});assert.equal(restored.status,200);assert.equal(restored.body.status.strimerControl.enabled,false);assert.equal(restored.body.status.strimerControl.phase,'off');assert.deepEqual(restored.body.devices.map(value=>value.id),[20000]);
 assert.equal(bridge.engine.jobs.get(20000),windowsJob);assert.equal(fixture.windows.calls.length,0);assert.deepEqual(fixture.guard.calls,['start','stop']);assert.deepEqual(fixture.wireless.calls,['close','connect','close']);
});
