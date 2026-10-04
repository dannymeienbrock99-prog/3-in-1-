import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WindowsLightingClient} from '../server/windows-lighting.mjs';
import {EffectEngine} from '../server/effects.mjs';

const fixture=path.join(path.dirname(fileURLToPath(import.meta.url)),'fixtures/msi-helper.mjs');
test('MSI SDK endpoints preserve real names, LED areas, native styles and protect Stream Deck',async()=>{
  const client=new WindowsLightingClient({executable:process.execPath,args:[fixture],platform:'win32',timeout:2000});
  try{
    const devices=await client.connect();
    assert.deepEqual(devices.map(d=>d.id),[20000,20001,20002]);
    assert.equal(client.details.msi.status,'connected');
    assert.equal(devices[1].name,'Kingston FURY Beast RGB · DIMM 1');
    assert.equal(devices[1].typeName,'Arbeitsspeicher');
    assert.equal(devices[1].ledGranularity,'area');
    assert.equal(devices[0].leds[0].name,'Dragon LED');
    assert.deepEqual(devices[0].modes.map(m=>m.name),['Direct Lighting Control','Rainbow']);
    assert.equal(devices[0].nativeEffects[1].id,'msi:style:8fced00b6ce28145');
    assert.equal(devices[2].directMode,false);
    const engine=new EffectEngine(client);
    await engine.apply({deviceIds:[20001],effect:'static',colors:['#ff0080'],brightness:100});
    assert.deepEqual(client.devices[1].colors,[0x8000ff]);
    const result=await client.applyNativeEffect(client.devices[1],'msi:style:8fced00b6ce28145',{brightness:50,speed:60,colors:['#ff0080'],direction:'forward'});
    assert.equal(result.modeId,1); assert.equal(result.deviceId,20001);
    assert.equal(client.devices[1].colorsKnown,false);
    await assert.rejects(()=>engine.apply({deviceIds:[20002],effect:'static'}),{code:'DIRECT_UNSUPPORTED'});
    engine.stop();
  }finally{await client.close();}
});
test('MSI native effect validation rejects unsupported, stale and invalid requests before helper writes',async()=>{
  const client=new WindowsLightingClient({executable:process.execPath,args:[fixture],platform:'win32',timeout:2000});
  try{
    await client.connect(); let writes=0; let last; client.request=async(command,args)=>{writes++; last=args; return {updated:true,deviceId:args.deviceId,modeId:args.modeId};};
    const ram=client.devices[1];
    const rainbow='msi:style:8fced00b6ce28145',steady='msi:style:57e1f047b30bdadc';
    await assert.rejects(()=>client.applyNativeEffect(ram,'msi:style:deadbeefdeadbeef'),{code:'NATIVE_EFFECT_UNSUPPORTED'});
    await client.applyNativeEffect(ram,steady,{brightness:50});
    assert.equal(last.brightness,undefined,'shared unsupported brightness is omitted from SDK request');
    writes=0;
    await assert.rejects(()=>client.applyNativeEffect(ram,rainbow,{brightness:101}),{code:'INVALID_EFFECT'});
    await assert.rejects(()=>client.applyNativeEffect(ram,rainbow,{colors:['bad']}),{code:'INVALID_COLORS'});
    await assert.rejects(()=>client.applyNativeEffect(ram,rainbow,{direction:'reverse'}),{code:'NATIVE_EFFECT_UNSUPPORTED'});
    await assert.rejects(()=>client.applyNativeEffect({...ram},rainbow),{code:'DEVICE_LIST_CHANGED'});
    assert.equal(writes,0);
  }finally{await client.close();}
});
test('MSI requires confirmation for the exact selected area and SDK mode',async()=>{
  const client=new WindowsLightingClient({executable:process.execPath,args:[fixture],platform:'win32',timeout:2000});
  try{
    await client.connect(); const ram=client.devices[1],rainbow='msi:style:8fced00b6ce28145';
    client.request=async()=>({updated:true,deviceId:20000,modeId:1});
    await assert.rejects(()=>client.applyNativeEffect(ram,rainbow),{code:'NATIVE_EFFECT_FAILED'});
    client.request=async()=>({updated:true,deviceId:ram.id,modeId:0});
    await assert.rejects(()=>client.applyNativeEffect(ram,rainbow),{code:'NATIVE_EFFECT_FAILED'});
  }finally{await client.close();}
});
