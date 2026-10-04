import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBridge } from '../server/index.mjs';
import { BridgeError } from '../server/openrgb.mjs';

async function fixture(t) {
  const calls=[],client=new EventEmitter();
  const devices=[60000,60001].map(id=>({id,name:`Test Strimer ${id}`,vendor:'Lian Li',provider:'lianli-wireless',effectUpload:true,directMode:true,ledCount:4,colors:[0,0,0,0],zones:[{id:0,startIndex:0,ledCount:4}]}));
  let failedId=null,pendingId=null;
  const result=device=>{if(device.id===failedId)throw new BridgeError('Mock USB failure','NATIVE_DISCONNECTED',503);return {confirmed:device.id!==pendingId,confirmation:device.id===pendingId?'transmitted':'receiver'};};
  Object.assign(client,{connected:true,devices,async applySoftwareEffect(){return {confirmation:'receiver'};},async selectDirect(device){calls.push(['direct',device.id]);},async update(device,colors){calls.push(['black',device.id,colors]);return result(device);},async freezeSoftwareEffect(device){calls.push(['freeze',device.id]);return result(device);},close(){}});
  const bridge=createBridge({client,port:0});await bridge.listen();
  t.after(async()=>{bridge.engine.stop();await new Promise(resolve=>bridge.server.close(resolve));});
  const base=`http://127.0.0.1:${bridge.server.address().port}`;
  const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const apply=async()=>{assert.equal((await post('/api/apply',{effect:'rainbow',deviceIds:[60000,60001]})).status,200);calls.length=0;};
  return {bridge,calls,post,apply,fail:id=>{failedId=id;},pending:id=>{pendingId=id;}};
}

test('wireless pause only freezes selected cables and removes jobs after acknowledgement',async t=>{
  const f=await fixture(t);await f.apply();
  assert.equal((await f.post('/api/stop',{deviceIds:[60000]})).status,200);
  assert.deepEqual(f.calls,[['freeze',60000]]);assert.deepEqual(f.bridge.engine.active.map(j=>j.deviceId),[60001]);
  assert.equal((await f.post('/api/stop',{})).status,200);assert.equal(f.bridge.engine.active.length,0);
});

test('failed or pending wireless pause preserves active status and partial success',async t=>{
  const f=await fixture(t);await f.apply();f.fail(60001);
  assert.equal((await f.post('/api/stop',{})).status,503);
  assert.deepEqual(f.bridge.engine.active.map(j=>j.deviceId),[60001]);
  f.fail(null);f.pending(60001);
  const pending=await f.post('/api/stop',{});assert.equal(pending.status,409);assert.equal(pending.body.code,'WIRELESS_ACK_PENDING');assert.equal(f.bridge.engine.active.length,1);
  f.pending(null);assert.equal((await f.post('/api/stop',{})).status,200);assert.equal(f.bridge.engine.active.length,0);
});

test('wireless blackout validates all targets before writes and keeps unacknowledged jobs',async t=>{
  const f=await fixture(t);await f.apply();
  assert.equal((await f.post('/api/stop',{blackout:true,deviceIds:[60000,999]})).status,404);assert.deepEqual(f.calls,[]);assert.equal(f.bridge.engine.active.length,2);
  f.pending(60001);
  assert.equal((await f.post('/api/stop',{blackout:true})).status,409);
  assert.deepEqual(f.bridge.engine.active.map(j=>j.deviceId),[60001]);
  assert.deepEqual(f.calls.filter(c=>c[0]==='black'),[['black',60000,[0,0,0,0]],['black',60001,[0,0,0,0]]]);
});
