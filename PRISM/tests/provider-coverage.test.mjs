import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCoverage,probeRazerRuntime,createRazerProbe} from '../server/provider-coverage.mjs';

test('Strimer Wireless coverage counts paired RGB cables independently of USB sender names',()=>{
  const result=buildCoverage({native:{connected:true,devices:[{id:60000,name:'Lian Li Strimer Wireless 24-Pin',vendor:'Lian Li',provider:'lianli-wireless',directMode:true}],details:{lianliWireless:{status:'ready',message:'Ein gekoppeltes Kabel'},discovery:[{name:'Lian Li Wireless Sender',vendor:'Lian Li',provider:'lianli-wireless',status:'detected'}]}}});
  const provider=result.providers.find(p=>p.id==='lianli-wireless');assert.equal(provider.deviceCount,1);assert.equal(provider.status,'ready');
  const brand=result.brands.find(b=>b.id==='lianli');assert.equal(brand.controlledNames.length,1);assert.match(brand.devices.find(d=>d.name.includes('Sender')).source,/Strimer Wireless/);
});

test('Manufacturer coverage uses independent PC data and never inserts absent model or vendor entries', () => {
  const inventory={motherboard:[{manufacturer:'Micro-Star International',name:'MAG TEST Z790'}],memory:[{manufacturer:'G.Skill',partNumber:'F5-TEST-6000',capacityGb:16}],devices:[{id:'lian',name:'Lian Li UNI FAN Controller',manufacturer:'Lian Li',category:'usb'},{id:'new',name:'未知 RGB 装置 Ω',manufacturer:'Beispiel-ÖEM',category:'usb'},{id:'generic',name:'USB Input Device',manufacturer:'Microsoft',category:'usb'}]};
  const result=buildCoverage({inventory});
  assert.equal(result.modelSpecific,false);assert.equal(result.readOnly,true);assert.equal(result.scope,'current-pc');
  assert.deepEqual(result.brands.map(b=>b.name).sort(),['Beispiel-ÖEM','G.Skill','Lian Li','MSI'].sort());
  assert.match(JSON.stringify(result.brands),/MAG TEST Z790|F5-TEST-6000|未知 RGB 装置 Ω/);
  assert(result.brands.every(b=>b.status==='detected'&&b.controlledNames.length===0));
  assert.equal(result.brands.find(b=>b.name==='Beispiel-ÖEM').integration.status,'not-verified');
  assert.deepEqual(result.unidentified.map(d=>d.name),['USB Input Device']);
  const generic=buildCoverage({inventory:{devices:[{id:1,name:'Router',manufacturer:'Allgemeiner USB4-Geräterouter',category:'usb'},{id:2,name:'USB',manufacturer:'WinUsb-Gerät',category:'usb'}]}});
  assert.deepEqual(generic.brands,[]);assert.equal(generic.unidentified.length,2);
  const unknownRgb=buildCoverage({native:{connected:true,devices:[{id:0,name:'Microsoft RGB Target',vendor:'Microsoft',provider:'windows',directMode:true},{id:1,name:'Unnamed OEM RGB Model',provider:'windows',directMode:true}]}});
  assert.deepEqual(unknownRgb.brands.flatMap(b=>b.controlledNames).sort(),['Microsoft RGB Target','Unnamed OEM RGB Model'].sort());
});

test('Only active SDK direct targets are controllable, even within the same manufacturer', () => {
  const result=buildCoverage({inventory:{memory:[{manufacturer:'Corsair',partNumber:'UNSUPPORTED RAM',capacityGb:8}]},native:{connected:true,devices:[{id:10000,name:'Corsair SDK RGB target',vendor:'Corsair',provider:'corsair',directMode:true},{id:10001,name:'Corsair no direct LED',vendor:'Corsair',provider:'corsair',directMode:false}],details:{corsair:{status:'connected'},discovery:[{name:'Corsair unavailable target',provider:'corsair'},{name:'Corsair SDK RGB target',provider:'corsair',status:'connected',deviceId:10000},{name:'Corsair no direct LED',provider:'corsair',status:'unsupported',deviceId:10001}]}}});
  const brand=result.brands.find(b=>b.id==='corsair');
  assert.deepEqual(brand.controlledNames,['Corsair SDK RGB target']);assert.equal(brand.status,'controllable');
  assert.equal(brand.devices.length,4);assert.equal(result.providers.find(p=>p.id==='corsair').deviceCount,1);
  const disconnected=buildCoverage({native:{connected:false,devices:[{id:1,name:'Corsair SDK RGB target',vendor:'Corsair',provider:'corsair',directMode:true}]}});
  assert.deepEqual(disconnected.brands,[]);assert(disconnected.providers.every(p=>!p.deviceCount));
});

test('Stream Deck metadata and protected SDK entries never produce controllable names', () => {
  const result=buildCoverage({inventory:{devices:[{id:'usb',name:'Stream Deck MK.2',category:'usb'}]},native:{connected:true,devices:[{id:2,name:'Elgato LED target',vendor:'Elgato',provider:'windows',directMode:true},{id:3,name:'Generic',location:'USB VID_0FD9&PID_0080',provider:'windows',directMode:true}]}});
  const brand=result.brands.find(b=>b.id==='elgato');assert.equal(brand.status,'excluded');assert.equal(brand.integration.status,'excluded');
  assert.deepEqual(brand.controlledNames,[]);assert(brand.devices.every(d=>d.protected));assert.equal(result.providers[0].deviceCount,0);
});

test('Missing SDK and unavailable providers remain separate from recognized hardware', () => {
  const inventory={devices:[{id:1,name:'Corsair Controller',category:'usb'}]};
  assert.equal(buildCoverage({inventory}).brands[0].integration.status,'setup-required');
  assert.equal(buildCoverage({inventory,corsair:{sdkInstalled:true}}).brands[0].integration.status,'provider-required');
  const readyWithoutTarget=buildCoverage({inventory,corsair:{sdkInstalled:true},native:{connected:true,details:{corsair:{status:'connected'}}}});
  assert.equal(readyWithoutTarget.brands[0].integration.status,'no-targets');assert.deepEqual(readyWithoutTarget.brands[0].controlledNames,[]);
});

test('Disconnected native sessions invalidate old provider details and never claim readiness', () => {
  const result=buildCoverage({corsair:{sdkInstalled:true},native:{connected:false,details:{windows:{status:'connected',message:'Old ready'},corsair:{status:'connected',message:'Old ready'}},devices:[{id:1,name:'Old RGB',vendor:'Corsair',directMode:true}]}});
  assert(result.providers.slice(0,2).every(p=>p.status==='disconnected'&&p.deviceCount===0));assert.doesNotMatch(JSON.stringify(result),/Old ready|Old RGB/);
});

test('Partial EDID and SDK diagnostic names remain visible with warnings but cannot control LEDs', () => {
  const result=buildCoverage({inventory:{monitors:[{instanceId:'DISPLAY\\TEST\\ONE_0',manufacturer:'Unknown Monitor OEM',name:'Monitor Ω'}],warnings:['PnP unavailable']},native:{connected:true,details:{warnings:['RGB target unavailable'],discovery:[{name:'Unknown LED Model',vendor:'New OEM',provider:'corsair'}]}}});
  assert.match(JSON.stringify(result.brands),/Monitor Ω|Unknown LED Model/);assert(result.brands.every(b=>b.controlledNames.length===0));assert.deepEqual(result.warnings,['PnP unavailable','RGB target unavailable']);
  const duplicate=buildCoverage({inventory:{monitors:[{instanceId:'DISPLAY\\TEST\\ONE_0',manufacturer:'OEM',name:'Monitor Ω'}],devices:[{id:'pnp-monitor',instanceId:'DISPLAY\\TEST\\ONE',manufacturer:'OEM',name:'Monitor Ω',category:'monitor'}]}});
  assert.equal(duplicate.brands[0].devices.length,1);
});

test('Razer runtime detection creates no fake model, device target or control support', () => {
  const razer={status:'available',version:'4.0.0'};
  const empty=buildCoverage({razer});assert.deepEqual(empty.brands,[]);assert.equal(empty.providers[2].status,'available');
  const withDevice=buildCoverage({razer,inventory:{devices:[{id:1,name:'Razer Test Keyboard',category:'keyboard'}]}});
  assert.equal(withDevice.brands[0].integration.status,'runtime-only');assert.equal(withDevice.brands[0].status,'detected');assert.deepEqual(withDevice.brands[0].controlledNames,[]);
});

test('A new PC metadata snapshot removes all previous PC names and retains partial warnings', () => {
  const first=buildCoverage({inventory:{devices:[{id:1,name:'Lian Li Old Controller',category:'usb'}]}});
  const second=buildCoverage({inventory:{devices:[{id:2,name:'NZXT New Controller',category:'usb'}],warnings:['RAM partially unavailable']}});
  assert.match(JSON.stringify(first),/Lian Li Old/);assert.doesNotMatch(JSON.stringify(second),/Lian Li Old/);assert.deepEqual(second.warnings,['RAM partially unavailable']);
});

test('Chroma detection performs a single bounded fixed loopback GET, with no registration or LED calls', async () => {
  const calls=[];
  const result=await probeRazerRuntime({fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({version:{core:'4.0.0'}}));}});
  assert.equal(result.status,'available');assert.equal(result.version,'4.0.0');assert.equal(calls.length,1);
  assert.equal(calls[0].url,'http://127.0.0.1:54235/razer/chromasdk');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');assert(calls[0].options.signal instanceof AbortSignal);assert.equal(calls[0].options.body,undefined);
});

test('Malformed, oversized, HTTP failures and missing Chroma services return unavailable', async () => {
  for (const factory of [()=>new Response('{'),()=>new Response(JSON.stringify({uri:'http://localhost:1234'})),()=>new Response(JSON.stringify({version:'4.0.0',padding:'x'.repeat(4096)})),()=>new Response('{}',{status:503}),()=>{throw new Error('Connection refused');}]) {
    const result=await probeRazerRuntime({fetchImpl:async()=>factory()});assert.equal(result.status,'unavailable');assert.equal(result.version,null);
  }
  for (const body of [{version:'4.0.0'},{core:'3.7.0'}]) assert.equal((await probeRazerRuntime({fetchImpl:async()=>new Response(JSON.stringify(body))})).status,'available');
});

test('Read-only Chroma status caches concurrent reads and retries expired or failed calls', async () => {
  let reads=0,time=0,fail=false;
  const read=createRazerProbe(async()=>{reads++;if(fail)throw new Error('Test failure');return {status:'unavailable'};},()=>time);
  await Promise.all([read(),read(),read()]);assert.equal(reads,1);time=9999;await read();assert.equal(reads,1);
  time=10001;fail=true;await assert.rejects(read());assert.equal(reads,2);fail=false;await read();assert.equal(reads,3);
});
