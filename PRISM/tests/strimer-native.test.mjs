import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LianLiLightingClient,lianliSupportedEffects,validateLianLiNativeEffect} from '../server/lianli-lighting.mjs';
import {applyNativeEffect,nativeLightingState} from '../server/native-effects.mjs';
const strimer=()=>({id:50000,name:'Lian Li Strimer Plus V2 · Controller',provider:'lianli',vendorId:0x0cf2,productId:0xa200,port:0,ring:'all',interfaceNumber:1,usagePage:0xff72,usage:0xa1,outputReportByteLength:255,featureReportByteLength:7,inputReportByteLength:65,firmwareVerified:true,channel2Count:4,wholeControllerOnly:true,detectedFanIds:[],nativeEffects:lianliSupportedEffects({productId:0xa200})});
function fixtureClient(devices){const requests=[];const client=new LianLiLightingClient({platform:'win32',timeout:1000,spawnFn:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.killed=false;child.kill=()=>{child.killed=true;child.exitCode=1;child.emit('exit');};child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(chunk.toString());requests.push(request);queueMicrotask(()=>child.stdout.write(JSON.stringify({requestId:request.requestId,ok:true,result:request.command==='enumerate'?{devices,environment:{},discovery:[],warnings:[]}:{deviceId:request.deviceId,effectId:request.effectId,transmitted:true}})+'\n'));done();},final(done){child.exitCode=0;queueMicrotask(()=>child.emit('exit'));done();}});return child;}});return{client,requests};}

test('wired Strimer catalog has 25 MIT-derived modes and never grants native direct LEDs',async t=>{
 const {client,requests}=fixtureClient([strimer()]);t.after(()=>client.close());const [device]=await client.scan();
 assert.equal(device.nativeEffects.length,25);assert.equal(device.nativeEffects.find(mode=>mode.id==='Wave').firmwareModeId,24);assert.equal(device.nativeEffects.find(mode=>mode.id==='ColorTransfer').firmwareModeId,39);assert.equal(device.nativeEffects.find(mode=>mode.id==='Static').colorsMax,1);assert.equal(device.nativeEffects.find(mode=>mode.id==='Runway').colorsMax,2);assert.equal(device.directMode,false);assert.equal(device.ledCount,0);assert.equal(device.separateChannelOutput,false);assert.equal(device.wholeControllerOnly,true);assert.equal(device.physicalOutputVerified,false);assert.equal(requests.length,1);
});

test('VID/PID alone or mismatched interface, usage, report, firmware and channel metadata cannot be trusted',async()=>{
 for(const patch of [{interfaceNumber:0},{usagePage:0xff00},{usage:0xa2},{outputReportByteLength:64},{featureReportByteLength:5},{featureReportByteLength:65},{inputReportByteLength:5},{inputReportByteLength:66},{firmwareVerified:false},{channel2Count:5},{channel2Count:undefined},{wholeControllerOnly:false},{port:1},{ring:'inner'}]){
  const {client,requests}=fixtureClient([{...strimer(),...patch}]);try{await assert.rejects(client.scan(),{code:'NATIVE_INVALID_DATA'});assert.equal(requests.length,1);}finally{await client.close();}
 }
});

test('both public native endpoint and provider require one confirmed whole-controller target before any write',async()=>{
 const target=strimer(),other={...target,id:50016};let writes=0,stops=0;const client={connected:true,devices:[target,other],applyNativeEffect:async()=>{writes++;return {transmitted:true};}},engine={stop:()=>stops++};
 const base={deviceIds:[target.id],effectId:'Static',colors:['#010203']};
 for(const patch of [{},{controllerScope:'all'},{controllerScope:'separate',confirmWholeController:true},{controllerScope:'all',confirmWholeController:'yes'},{controllerScope:'all',confirmWholeController:true,deviceIds:[target.id,other.id]}])await assert.rejects(applyNativeEffect(client,engine,{...base,...patch}),{code:'WHOLE_CONTROLLER_REQUIRED'});
 assert.equal(writes,0);assert.equal(stops,0);assert.throws(()=>validateLianLiNativeEffect(target,'Static'),{code:'WHOLE_CONTROLLER_REQUIRED'});
 await applyNativeEffect(client,engine,{...base,controllerScope:'all',confirmWholeController:true});assert.equal(writes,1);assert.equal(stops,1);assert.equal(target.nativeSettings.controllerScope,'all');assert.equal(target.nativeSettings.confirmWholeController,true);assert.equal(nativeLightingState(target).confirmWholeController,true);
});

test('confirmed provider payload keeps whole-controller scope and reports transmission without claiming physical validation',async t=>{
 const {client,requests}=fixtureClient([strimer()]);t.after(()=>client.close());await client.scan();const device=client.devices[0];
 await client.applyNativeEffect(device,'Static',{colors:['#010203'],controllerScope:'all',confirmWholeController:true});assert.equal(requests[1].controllerScope,'all');assert.equal(requests[1].confirmWholeController,true);assert.equal(device.physicalOutputVerified,false);
});

test('compiled native Strimer packet fixtures match upstream RGB wire order, bounds, gates and explicit full-controller bitmaps',()=>{
 const executable=fileURLToPath(new URL('../native-lianli/bin/PRISM-LianLi.exe',import.meta.url));const result=spawnSync(executable,['--strimer-fixtures'],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr||result.error?.message);const fixture=JSON.parse(result.stdout);
 for(const key of ['descriptorAccepted','wrongInterfaceRejected','wrongUsageRejected','wrongReportRejected','wrongFeatureRejected','wrongInputRejected','firmwareValid','firmwareMismatchRejected','count4Accepted','count6Accepted','unknownCountRejected'])assert.equal(fixture[key],true,key);assert.deepEqual(fixture.rejected,['scope','confirmation','count','effect','colors','brightness']);
 const [staticCase,wave,complete]=fixture.cases;
 assert.equal(staticCase.packets.length,21);assert.equal(staticCase.packets[0].bytes,'E01001000000');assert.equal(staticCase.packets[1].bytes,'E030'+'010302'.repeat(27));assert.equal(staticCase.packets.at(-1).bytes,'E02C03FF');
 assert.equal(wave.packets.length,25);assert.equal(wave.packets[0].bytes,'E01018000100');assert.equal(wave.packets[1].bytes,'E030010302040605');assert.equal(wave.packets.at(-1).bytes,'E02C0FFF');
 assert.equal(complete.packets.length,5);assert.equal(complete.packets[0].bytes,'E01027000000');assert.equal(complete.packets[2].bytes,'E01627000000');assert.equal(complete.packets.at(-1).bytes,'E02C0041');
 for(const sample of fixture.cases)for(const packet of sample.packets){const data=Buffer.from(packet.bytes,'hex');assert.equal(data[0],0xe0);assert.ok(data.length<=83);assert.ok(packet.feature?(data[1]>=0x10&&data[1]<=0x1b)||data[1]===0x2c:data[1]>=0x30&&data[1]<=0x3b);}
});
