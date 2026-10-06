import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {LightingClient} from '../server/lighting-client.mjs';
import {createBridge} from '../server/index.mjs';

const device=(id,provider)=>({id,name:`Fixture ${id}`,vendor:'Fixture',provider,directMode:true,effectUpload:provider==='lianli-wireless',ledCount:2,colors:[0,0],leds:[],modes:[],zones:[{id:0,startIndex:0,ledCount:2}]});
class Provider extends EventEmitter {
 constructor(backend,id){super();this.backend=backend;this.devices=[device(id,backend)];this.connected=true;this.calls=[];this.details={[backend]:{status:'ready'}};}
 async scan(){this.calls.push('scan');if(this.fail){this.devices=[];throw Error('USB fixture denied');}this.devices=this.devices.map(value=>({...value}));return this.devices;}
 connect(){return this.scan();}
 async selectDirect(){this.calls.push('direct');}
 async update(){this.calls.push('frame');}
 async applySoftwareEffect(){this.calls.push('upload');return {transmitted:true,confirmed:true,confirmation:'receiver',acknowledgement:'Fixture receiver'};}
 close(){this.calls.push('close');}
}
async function setup(t,{wireless=true}={}){
 const windows=new Provider('windows',10000),radio=wireless?new Provider('lianli-wireless',60000):null;
 const client=new LightingClient({clients:[windows,...(radio?[radio]:[])]});client.refresh();
 const bridge=createBridge({client,port:0});await bridge.listen();
 t.after(async()=>{bridge.engine.stop();await new Promise(resolve=>bridge.server.close(resolve));});
 const post=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${bridge.server.address().port}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {windows,radio,client,bridge,post};
}
test('wireless-only search leaves other device objects and ongoing RGB jobs intact without output commands',async t=>{
 const f=await setup(t);await f.post('apply',{effect:'rainbow',deviceIds:[10000,60000]});
 const original=f.client.devices[0],windowsJob=f.bridge.engine.jobs.get(10000);f.windows.calls=[];f.radio.calls=[];
 const result=await f.post('strimer/refresh',{});
 assert.equal(result.status,200);assert.equal(result.body.autonomousOutputUnchanged,true);
 assert.deepEqual(result.body.devices.map(value=>value.id),[10000,60000]);
 assert.equal(f.client.devices[0],original);assert.equal(f.bridge.engine.jobs.get(10000),windowsJob);
 assert.ok(f.bridge.engine.timer);assert.equal(f.bridge.engine.jobs.has(60000),false);
 assert.deepEqual(f.radio.calls,['scan']);assert.equal(f.windows.calls.includes('scan'),false);assert.equal(f.windows.calls.includes('direct'),false);
});
test('a wireless search failure retains healthy devices and their jobs with a diagnostic',async t=>{
 const f=await setup(t);await f.post('apply',{effect:'static',deviceIds:[10000]});f.radio.fail=true;
 const result=await f.post('strimer/refresh',{});
 assert.equal(result.status,200);assert.deepEqual(result.body.devices.map(value=>value.id),[10000]);
 assert.ok(f.bridge.engine.jobs.has(10000));assert.ok(result.body.status.native.warnings.includes('USB fixture denied'));
 assert.equal(f.client.connected,true);
});
test('invalid wireless refresh input and missing provider fail before opening or resetting another session',async t=>{
 const f=await setup(t);assert.equal((await f.post('strimer/refresh',{brightness:0})).status,400);
 assert.deepEqual(f.radio.calls,[]);assert.deepEqual(f.windows.calls,[]);
 const absent=await setup(t,{wireless:false});assert.equal((await absent.post('strimer/refresh',{})).status,422);assert.deepEqual(absent.windows.calls,[]);
});

test('real upload acknowledgement flags reach the HTTP response required by the cable UI',async t=>{
 const f=await setup(t);const result=await f.post('apply',{effect:'rainbow',deviceIds:[60000]});
 assert.equal(result.status,200);assert.deepEqual(result.body.applied,[60000]);
 assert.deepEqual(result.body.uploads,[{deviceId:60000,transmitted:true,confirmed:true,confirmation:'receiver',acknowledgement:'Fixture receiver'}]);
 assert.equal(f.windows.calls.includes('direct'),false);assert.equal(f.windows.calls.includes('upload'),false);
});
