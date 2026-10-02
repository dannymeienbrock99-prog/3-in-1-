'use strict';
// Opt-in native test: only generated color sources and our virtual camera devices.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeClient}=require('../src/dual-stream/native-client.cjs'),{defaults}=require('../src/dual-stream/config.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const output=process.env.BATTO_DUAL_TEST_OUTPUT;if(!output)throw Error('Isolated evidence directory required');fs.mkdirSync(output,{recursive:true});
 const host=process.env.BATTO_DUAL_HOST||path.resolve(__dirname,'../../FanAtlas/BattoDualStream.exe'),root='C:\\Program Files\\obs-studio';
 const producer=new NativeClient(host,root,{env:{BATTO_DUAL_TEST:'1'}}),consumer=new NativeClient(host,root);
 try{await producer.open();const config=defaults();await producer.request('test-prepare',{config});for(const p of ['tiktok','twitch'])await producer.request('camera-start',{platform:p});await delay(3000);
  const state=await producer.request('status');for(const p of ['tiktok','twitch']){assert.equal(state.outputs[p].state,'camera');assert(state.outputs[p].frames>10,JSON.stringify(state));}
  await consumer.open();const devices=(await consumer.request('probe')).devices.camera;
  for(const p of ['tiktok','twitch']){const name=state.outputs[p].cameraName,target=devices.find(d=>d.name===name);assert(target,'registered virtual camera '+name);const c=defaults();c.sources.camera={enabled:true,target:target.id,name};for(const out of ['tiktok','twitch'])c.layouts[out]=[{source:'game',x:0,y:0,width:1,height:1,visible:false,fit:'contain'},{source:'camera',x:0,y:0,width:1,height:1,visible:true,fit:'contain'}];await consumer.request('prepare',{config:c});await delay(2400);const snapshot=await consumer.request('snapshot',{platform:p});fs.writeFileSync(path.join(output,p+'-received.png'),Buffer.from(snapshot.image.split(',')[1],'base64'));}
  await producer.request('stop',{platform:'tiktok'});const after=await producer.request('status');assert.equal(after.outputs.tiktok.state,'stopped');assert.equal(after.outputs.twitch.state,'camera');await producer.request('stop',{platform:'both'});await delay(1000);await producer.request('camera-start',{platform:'tiktok'});await delay(300);assert.equal((await producer.request('status')).outputs.tiktok.state,'camera');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,state,independentStop:true,restart:true,devices:devices.filter(d=>/^Batto |^OBS-Camera/.test(d.name)).map(d=>d.name)},null,2));
 }finally{await consumer.close();await producer.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
