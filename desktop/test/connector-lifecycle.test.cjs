'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ConnectorManager}=require('../src/core/connectors/connector-manager.cjs');
const {BaseConnector}=require('../src/core/connectors/base-connector.cjs');
const {HealthService}=require('../src/core/health/health-service.cjs');
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(options={}){
 const manager=new ConnectorManager({connectTimeoutMs:1000});
 let status={state:'idle',connected:false},connects=0,stops=0;
 const adapter={getStatus:()=>status,connect(){connects++;status={state:'connected',connected:true};},disconnect(){stops++;status={state:'stopped',connected:false};}};
 manager.register('chat',adapter,options);
 return {manager,adapter,connects:()=>connects,stops:()=>stops};
}
test('unused configured connectors are idle, not a core failure',()=>{
 const {manager}=fixture();assert.equal(manager.status('chat').state,'IDLE');
 assert.equal(new BaseConnector({name:'test'}).state,'IDLE');
 const health=new HealthService({getConnectors:()=>manager.statuses(),getOverlay:()=>({running:true})});
 assert.equal(health.snapshot().overall,'HEALTHY');
});
test('concurrent connect clicks share one attempt; reconnect after disconnect works',async()=>{
 const f=fixture();assert.deepEqual((await Promise.all([f.manager.connect('chat'),f.manager.connect('chat')])).map(x=>x.ok),[true,true]);
 assert.equal(f.connects(),1);await f.manager.disconnect('chat');assert.equal(f.stops(),1);
 assert.equal((await f.manager.connect('chat')).ok,true);assert.equal(f.connects(),2);await f.manager.stopAll();
});
test('disconnect cancels a pending start promptly and prevents late failure retry',async()=>{
 const f=fixture();let reject;f.adapter.connect=()=>new Promise((_,r)=>{reject=r;});
 const pending=f.manager.connect('chat');await flush();await f.manager.disconnect('chat');
 assert.equal((await pending).cancelled,true);reject(Error('late network failure'));await flush();
 const entry=f.manager.entries.get('chat');assert.equal(entry.timer,null);assert.equal(entry.pending,null);assert.equal(entry.state,'DISABLED');
 f.manager.observeAdapterStatus('chat',{connected:true,state:'connected'});assert.equal(f.manager.status('chat').connected,false);
});
test('disabling a running connector closes it and blocks startup until enabled',async()=>{
 const f=fixture();await f.manager.connect('chat');f.manager.configure('chat',{enabled:false});await flush();
 assert.equal(f.stops(),1);assert.equal((await f.manager.connect('chat')).disabled,true);
 f.manager.configure('chat',{enabled:true});assert.equal(f.manager.status('chat').state,'IDLE');
 assert.equal((await f.manager.connect('chat')).ok,true);await f.manager.stopAll();
});
test('new connection waits for previous asynchronous disconnect to finish',async()=>{
 const f=fixture();await f.manager.connect('chat');let finish;
 f.adapter.disconnect=()=>new Promise(r=>{finish=r;});
 const stopped=f.manager.disconnect('chat');const restarted=f.manager.connect('chat');await flush();assert.equal(f.connects(),1);
 finish();await stopped;assert.equal((await restarted).ok,true);assert.equal(f.connects(),2);
});
test('successful connects release their start timeout immediately',async t=>{
 const original=global.setTimeout;const handles=[];
 t.mock.method(global,'setTimeout',(...args)=>{const handle=original(...args);handles.push(handle);return handle;});
 const f=fixture();await f.manager.connect('chat');assert.equal(handles.length,1);assert.equal(handles[0]._destroyed,true);await f.manager.stopAll();
});
test('stop failures are not reported as successful disconnects',async()=>{
 const f=fixture();f.adapter.disconnect=()=>{throw Error('cannot close');};
 assert.equal((await f.manager.disconnect('chat')).ok,false);
});

test('resolved adapter failures cannot be acknowledged from a stale connected status',async()=>{
 const f=fixture({autoReconnect:false});
 f.adapter.getStatus=()=>({connected:true,state:'connected'});
 f.adapter.connect=async()=>({ok:false,error:'connection refused'});
 const connected=await f.manager.connect('chat');
 assert.equal(connected.ok,false);assert.match(connected.error,/connection refused/);assert.equal(connected.status.state,'ERROR');
 f.adapter.disconnect=async()=>({ok:false,error:'close refused'});
 const disconnected=await f.manager.disconnect('chat');
 assert.equal(disconnected.ok,false);assert.match(disconnected.error,/close refused/);assert.equal(disconnected.status.state,'ERROR');
});

test('reconnect does not open a second connection when an outstanding stop fails',async()=>{
 const f=fixture({autoReconnect:false});await f.manager.connect('chat');let finish;
 f.adapter.disconnect=()=>new Promise(resolve=>{finish=resolve;});
 const stopped=f.manager.disconnect('chat'),restarted=f.manager.connect('chat');await flush();
 finish({ok:false,error:'close refused'});
 assert.equal((await stopped).ok,false);assert.equal((await restarted).ok,false);assert.equal(f.connects(),1);
});
