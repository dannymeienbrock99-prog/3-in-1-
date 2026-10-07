import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {InProcessWindowsLightingClient} from '../server/in-process-lighting.mjs';
import {CorsairDirectLightingClient} from '../server/corsair-direct-lighting.mjs';
import {LightingClient} from '../server/lighting-client.mjs';
import {createBridge} from '../server/index.mjs';
const {CorsairDirectControl}=createRequire(import.meta.url)('../../desktop/src/services/corsair-direct-control.cjs');

const HUB='corsair-link-0123456789abcdef';
const clone=value=>JSON.parse(JSON.stringify(value));
const idle=()=>({enabled:false,active:false,ownsControl:false,released:true,retryRequired:false,remaining:[],phase:'off',hubs:[],channels:[],sensors:[],devices:[],releaseVerification:'none'});
const active=()=>({...idle(),enabled:true,active:true,ownsControl:true,released:false,phase:'active',hubs:[{id:HUB,serial:'real-fixture',vendorId:0x1b1c,productId:0x0c3f}],devices:[{id:HUB,name:'LINK Hub',ledCount:2,zones:[{id:0,startIndex:0,ledCount:2}]}]});
const rgb=(id,provider)=>({id,name:provider+' fixture',provider,type:21,ledCount:2,colors:[0,0],leds:[{id:0},{id:1}],modes:[],zones:[{id:0,startIndex:0,ledCount:2}],directMode:true});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const guard=()=>Object.assign(new EventEmitter(),{status:{enabled:false,phase:'off'},stop:async()=>{}});
class OtherProvider extends EventEmitter{
 constructor(){super();this.backend='fixture';this.devices=[{...rgb(40000,'fixture'),type:21}];this.connected=true;this.calls=[];}
 async scan(){return this.devices;} async selectDirect(){} async update(device,colors){this.calls.push([...colors]);device.colors=[...colors];} async close(){this.connected=false;}
}

test('an SDK write already in flight drains before native suspension and other provider jobs survive',async t=>{
 const write=deferred(),calls=[];let paused=false,delay=false;
 const hardware={available:true,component:{},request:async(provider,command)=>{calls.push(command);if(command==='enumerate')return {devices:paused?[rgb(20000,'msi')]:[rgb(10000,'corsair'),rgb(20000,'msi')]};if(command==='set'&&delay)await write.promise;if(command==='suspend-corsair'||command==='resume-corsair'){paused=command==='suspend-corsair';return {suspended:paused,inProcess:true};}return {};}};
 const windows=new InProcessWindowsLightingClient(hardware,{platform:'win32'}),other=new OtherProvider(),client=new LightingClient({clients:[windows,other],strimerControl:guard()}),bridge=createBridge({client});
 t.after(()=>bridge.engine.stop());await client.scan();const otherDevice=other.devices[0];await bridge.engine.apply({deviceIds:[10000,40000],effect:'rainbow'});clearInterval(bridge.engine.timer);bridge.engine.timer=null;calls.length=0;delay=true;
 const frame=bridge.engine.tick();await settle();const suspended=bridge.suspendWindowsLighting();await settle();assert.deepEqual(calls,['set']);assert.deepEqual([...bridge.engine.jobs.keys()],[40000]);assert.equal(windows.connected,false);
 write.resolve();await frame;await suspended;assert.deepEqual(calls,['set','suspend-corsair','enumerate']);assert.deepEqual(client.devices.map(device=>device.id),[20000,40000]);assert.equal(other.devices[0],otherDevice);assert.equal(bridge.engine.jobs.has(40000),true);
});

test('a pending old enumeration cannot republish SDK devices after its suspension latch',async()=>{
 const probe=deferred(),calls=[];let first=true;
 const hardware={available:true,component:{},request:async(provider,command)=>{calls.push(command);if(command==='enumerate'){if(first){first=false;await probe.promise;return {devices:[rgb(10000,'corsair')]};}return {devices:[rgb(20000,'msi')]};}return {suspended:true,inProcess:true};}};
 const windows=new InProcessWindowsLightingClient(hardware,{platform:'win32'}),scan=windows.scan(),oldRejected=assert.rejects(scan,error=>error.code==='DEVICE_LIST_CHANGED');await settle();const suspend=windows.suspendCorsair();await settle();assert.deepEqual(calls,['enumerate']);probe.resolve();await oldRejected;await suspend;assert.deepEqual(windows.devices.map(device=>device.id),[20000]);assert.deepEqual(calls,['enumerate','suspend-corsair','enumerate']);
});

test('an unconfirmed SDK suppression keeps new writes blocked and prevents takeover',async()=>{
 const hardware={available:true,component:{},request:async()=>({suspended:false,inProcess:true})},windows=new InProcessWindowsLightingClient(hardware,{platform:'win32'});
 await assert.rejects(windows.suspendCorsair(),error=>error.code==='CORSAIR_SDK_UNCONFIRMED');await assert.rejects(windows.request('set',{deviceId:10000,colors:[0,0]}),error=>error.code==='CORSAIR_SDK_SUSPENDED');assert.equal(windows.connected,false);
});

test('direct takeover removes SDK hubs, routes real effect frames to the shared hub, then resumes SDK after release',async t=>{
 const calls=[];let paused=false,state=idle(),bridge;
 const hardware={available:true,component:{},request:async(provider,command,values)=>{
  calls.push([provider,command]);
  if(provider==='windows'){
   if(command==='enumerate')return {devices:paused?[rgb(20000,'msi')]:[rgb(10000,'corsair'),rgb(20000,'msi')]};
   if(command==='suspend-corsair'||command==='resume-corsair'){paused=command==='suspend-corsair';return {suspended:paused,inProcess:true};}
   if(command==='set'&&state.active)assert.notEqual(values.deviceId,10000,'SDK cannot write the owned hub');return {};
  }
  if(command==='take-control'){assert.equal(paused,true);state=active();return clone(state);}
  if(command==='set')return {applied:true,deviceId:values.deviceId,ledCount:values.colors.length,state:clone(state)};
  if(command==='release-control'){state={...idle(),releaseVerification:'device-ack'};return {ok:true,released:true,state:clone(state)};}
  if(command==='status')return clone(state);throw Error('unexpected command '+command);
 }};
 const control=new CorsairDirectControl({hardware,beforeTakeover:()=>bridge.suspendWindowsLighting(),afterRelease:()=>bridge.resumeWindowsLighting(),schedule:()=>0,unschedule:()=>{}});
 const windows=new InProcessWindowsLightingClient(hardware,{platform:'win32'}),direct=new CorsairDirectLightingClient({control}),other=new OtherProvider(),client=new LightingClient({clients:[windows,direct,other],strimerControl:guard()});bridge=createBridge({client});t.after(()=>bridge.engine.stop());
 await client.scan();assert.deepEqual(calls,[['windows','enumerate']]);const untouched=other.devices[0];
 await control.enable(true,{confirmICuePause:true});await bridge.refreshCorsairDirectLighting();assert.deepEqual(client.devices.map(device=>device.id),[20000,70000,40000]);assert.equal(other.devices[0],untouched);
 await bridge.engine.apply({deviceIds:[70000],effect:'static',colors:['#f27aff'],brightness:100});assert.deepEqual(calls.at(-1),['corsair-direct','set']);assert.equal(bridge.engine.jobs.has(70000),true);
 await control.enable(false);assert.equal(bridge.engine.jobs.has(70000),false);assert.deepEqual(client.devices.map(device=>device.id),[10000,20000,40000]);assert.equal(paused,false);assert.equal(other.devices[0],untouched);
 const release=calls.findIndex(value=>value[1]==='release-control'),resume=calls.findIndex(value=>value[1]==='resume-corsair');assert.ok(release>=0&&resume>release);
});

test('RGB discovery uses only the validated snapshot and cannot wait behind a queued takeover',async()=>{
 const control=new EventEmitter();control.snapshot=()=>({active:false,enabled:false,phase:'starting',devices:[]});control.setColors=async()=>{throw Error('write forbidden');};control.inspect=async()=>{throw Error('queue cycle');};control.ready=false;
 const direct=new CorsairDirectLightingClient({control});assert.deepEqual(await direct.scan(),[]);await direct.close();
});
