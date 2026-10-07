import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {CorsairDirectLightingClient} from '../server/corsair-direct-lighting.mjs';
import {EffectEngine,EFFECTS} from '../server/effects.mjs';

const HUB='corsair-link-0123456789abcdef',SECOND='corsair-link-abcdef0123456789';
const rgb=id=>({id,name:'iCUE LINK System Hub',serial:'actual-hub-serial',ledCount:4,zones:[{id:0,name:'QX120',startIndex:0,ledCount:2},{id:1,name:'QX120 2',startIndex:2,ledCount:2}]});
class Control extends EventEmitter {
  constructor(enabled=false){super();this.state={active:enabled,enabled,phase:enabled?'ready':'off',devices:enabled?[rgb(HUB)]:[],releaseVerification:'none'};this.calls=[];this.response=null;}
  get ready(){return this.state.active&&this.state.enabled&&this.state.phase==='ready';}
  snapshot(){return JSON.parse(JSON.stringify(this.state));}
  async inspect(){this.calls.push(['status']);this.emit('state',this.snapshot());return this.snapshot();}
  async setColors(deviceId,colors){this.calls.push(['set',deviceId,[...colors]]);return this.response?this.response(deviceId,colors):{applied:true,deviceId,ledCount:colors.length};}
  publish(patch){this.state={...this.state,...patch};this.emit('state',this.snapshot());}
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('opening an OFF RGB provider reads cached status and never initiates takeover or writes',async()=>{
 const control=new Control(),client=new CorsairDirectLightingClient({control});assert.equal(control.calls.length,0);assert.equal(client.connected,false);
 assert.deepEqual(await client.connect(),[]);assert.deepEqual(control.calls,[]);assert.equal(client.connected,false);assert.deepEqual(client.devices,[]);await client.close();assert.deepEqual(control.calls,[]);
});
test('active topology gets stable numeric public IDs while keeping the native hub identity separate',async()=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});let devices=await client.scan();assert.equal(devices[0].id,70000);assert.equal(devices[0].nativeId,HUB);assert.equal(devices[0].serial,'actual-hub-serial');assert.equal(devices[0].colorsKnown,false);assert.equal(client.connected,true);
 control.publish({devices:[rgb(SECOND),rgb(HUB)]});devices=await client.scan();assert.deepEqual(devices.map(value=>value.id),[70001,70000]);assert.equal(devices[1].nativeId,HUB);assert.equal(devices[1].zones.length,2);await client.dispose();
});
test('RGB frames use packed-RGB byte order and an exact acknowledged native target',async()=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.connect();const device=client.devices[0];await client.selectDirect(device);assert.deepEqual(control.calls,[]);
 await client.update(device,[0x0000ff,0x00ff00,0xff0000,0x563412]);assert.deepEqual(control.calls[0],['set',HUB,['#ff0000','#00ff00','#0000ff','#123456']]);assert.equal(device.colorsKnown,true);assert.equal(device.leds[3].color,'#123456');assert.equal(device.physicalVerification,false);await client.close();
});
test('unknown prior colors prevent a partial zone from overwriting unselected outputs',async t=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.scan();const engine=new EffectEngine(client);t.after(()=>engine.stop());t.after(()=>client.close());
 await assert.rejects(engine.apply({deviceIds:[70000],zoneIds:{70000:[0]},effect:'static',colors:['#ff0000']}),error=>error.code==='CURRENT_COLORS_UNAVAILABLE');assert.deepEqual(control.calls,[]);
 await engine.apply({deviceIds:[70000],effect:'static',colors:['#112233'],brightness:100});await engine.apply({deviceIds:[70000],zoneIds:{70000:[0]},effect:'static',colors:['#ff0000'],brightness:100});assert.deepEqual(control.calls.at(-1),['set',HUB,['#ff0000','#ff0000','#112233','#112233']]);
});
test('all 31 existing software effects retain the common renderer and real set transport',async t=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.scan();const engine=new EffectEngine(client,{now:()=>1000});t.after(()=>engine.stop());t.after(()=>client.close());
 assert.equal(EFFECTS.length,31);
 for(const effect of EFFECTS){await engine.apply({deviceIds:[70000],effect,colors:['#f27aff','#128bff'],brightness:80,speed:50,scale:40});engine.stop();const request=control.calls.at(-1);assert.equal(request[0],'set');assert.equal(request[1],HUB);assert.equal(request[2].length,4);assert.ok(request[2].every(color=>/^#[a-f0-9]{6}$/.test(color)));}
 assert.equal(control.calls.filter(value=>value[0]==='set').length,31);
});
test('telemetry updates preserve device object identity and already applied frame colors',async()=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.scan();const device=client.devices[0];await client.update(device,[1,2,3,4]);let changes=0;client.on('devicesChanged',()=>changes++);
 control.publish({channels:[{rpm:1400}]});assert.equal(client.devices[0],device);assert.deepEqual(device.colors,[1,2,3,4]);assert.equal(device.colorsKnown,true);assert.equal(changes,0);await client.close();
});
test('actual topology change invalidates old objects before another write',async()=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.scan();const device=client.devices[0];let changes=0;client.on('devicesChanged',()=>changes++);
 control.publish({devices:[{...rgb(HUB),ledCount:5,zones:[{id:0,startIndex:0,ledCount:5}]}]});assert.equal(changes,1);assert.equal(client.connected,false);await assert.rejects(client.update(device,[1,2,3,4]),error=>error.code==='CORSAIR_DEVICE_CHANGED');assert.deepEqual(control.calls,[]);await client.close();
});
test('RGB close detaches state listeners without releasing the shared fan lease and can reconnect',async()=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.scan();assert.equal(control.listenerCount('state'),1);await client.close();assert.equal(control.listenerCount('state'),0);assert.equal(control.ready,true);assert.deepEqual(control.calls,[]);await client.scan();assert.equal(control.listenerCount('state'),1);assert.equal(client.connected,true);await client.close();
});
test('a delayed old RGB response cannot update a closed and reopened client',async()=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.scan();const old=client.devices[0],done=deferred();control.response=async(deviceId,colors)=>{await done.promise;return {applied:true,deviceId,ledCount:colors.length};};const pending=client.update(old,[1,2,3,4]);await client.close();await client.scan();const current=client.devices[0];done.resolve();await assert.rejects(pending,error=>error.code==='CORSAIR_DEVICE_CHANGED');assert.equal(current.colorsKnown,false);assert.deepEqual(current.colors,[0,0,0,0]);await client.close();
});
test('returning the control lease stops software effects and removes direct RGB availability',async t=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});await client.scan();const engine=new EffectEngine(client);t.after(()=>engine.stop());t.after(()=>client.close());await engine.apply({deviceIds:[70000],effect:'rainbow'});assert.equal(engine.jobs.size,1);control.publish({enabled:false,active:false,phase:'off',devices:[]});assert.equal(engine.jobs.size,0);assert.equal(client.connected,false);assert.equal(client.devices.length,0);
});
test('malformed topology and unacknowledged writes never become reported colors',async()=>{
 const control=new Control(true),client=new CorsairDirectLightingClient({control});control.state.devices=[{...rgb(HUB),zones:[{id:0,startIndex:0,ledCount:2}]}];await assert.rejects(client.scan(),error=>error.code==='CORSAIR_INVALID_DATA');assert.equal(client.connected,false);
 control.state.devices=[rgb(HUB)];await client.scan();const device=client.devices[0];control.response=()=>({applied:true,deviceId:SECOND,ledCount:4});await assert.rejects(client.update(device,[1,2,3,4]),error=>error.code==='CORSAIR_RGB_UNCONFIRMED');assert.equal(device.colorsKnown,false);assert.deepEqual(device.colors,[0,0,0,0]);await client.close();
});
