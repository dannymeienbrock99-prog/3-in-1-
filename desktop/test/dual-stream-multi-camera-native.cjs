'use strict';
// Opt-in libobs regression: synthetic colors only. No physical camera, registry
// changes, live output or user's settings are accessed by this test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PNG}=require('pngjs');
const {NativeClient}=require('../src/dual-stream/native-client.cjs'),{defaults}=require('../src/dual-stream/config.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const colors={game:[176,60,96],camera:[238,197,53],camera2:[40,200,65],camera3:[73,73,240]};
function pixel(png,x,y){const i=(Math.floor(y*png.height)*png.width+Math.floor(x*png.width))*4;return [...png.data.subarray(i,i+3)];}
function close(a,b){return a.every((value,i)=>Math.abs(value-b[i])<10);}
function layer(source,x){return {source,visible:true,pos:{x,y:0},scale:{x:1,y:1},rot:0,align:5,bounds_type:2,bounds_align:0,bounds:{x:320,y:240},crop_left:0,crop_right:0,crop_top:0,crop_bottom:0};}
(async()=>{
 const output=process.env.BATTO_DUAL_TEST_OUTPUT;if(!output)throw Error('Isolated evidence directory required.');fs.mkdirSync(output,{recursive:true});
 const host=process.env.BATTO_DUAL_HOST||path.resolve(__dirname,'../../FanAtlas/BattoDualStream.exe');
 const client=new NativeClient(host,process.env.BATTO_OBS_ROOT||'C:\\Program Files\\obs-studio',{env:{BATTO_DUAL_TEST:'1'}}),checks=[];
 function check(condition,label){assert(condition,label);checks.push(label);}
 async function shot(platform,label,mode='program'){
  await client.request('snapshot',{platform,mode});await delay(120);const snapshot=await client.request('snapshot',{platform,mode});
  const buffer=Buffer.from(snapshot.image.split(',')[1],'base64');if(label)fs.writeFileSync(path.join(output,label+'.png'),buffer);
  return {snapshot,png:PNG.sync.read(buffer)};
 }
 async function prepare(config){return client.request('test-prepare',{config});}
 async function toggle(source,enabled){return client.request('source',{source,enabled});}
 try{
  await client.open();
  const config=defaults();config.profile='economy_720p30';
  for(const [index,id] of ['camera','camera2','camera3'].entries())config.sources[id]={enabled:true,target:'synthetic-camera-'+(index+1),name:'Generated camera '+(index+1)};
  config.layouts={
   twitch:[{source:'game',x:0,y:0,width:1,height:1,fit:'contain',visible:true},...['camera','camera2','camera3'].map((source,i)=>({source,x:i/3,y:0,width:1/3,height:.4,fit:'cover',visible:true}))],
   tiktok:[{source:'game',x:0,y:0,width:1,height:1,fit:'cover',visible:true},...['camera','camera2','camera3'].map((source,i)=>({source,x:0,y:i/4,width:1,height:.25,fit:'cover',visible:true}))]
  };
  let state=await prepare(config);
  check(state.sourceCount===4,'three cameras and game are shared across both canvases');
  check(['camera','camera2','camera3'].every(id=>state.sources.some(source=>source.id===id)),'status exposes all three camera identifiers');
  check(Object.values(state.outputs).every(output=>output.state==='stopped'),'preparing cameras does not start an output');
  check(state.encoder==='','camera mode does not initialize hardware encoders');
  const landscape=await shot('twitch','three-cameras-twitch'),portrait=await shot('tiktok','three-cameras-tiktok');
  for(const [i,id] of ['camera','camera2','camera3'].entries()){
   check(close(pixel(landscape.png,(i+.5)/3,.2),colors[id]),id+' renders at its Twitch position');
   check(close(pixel(portrait.png,.5,(i+.5)/4),colors[id]),id+' renders at its TikTok position');
  }
  check(landscape.snapshot.sources.filter(source=>/^camera/.test(source.id)).length===3,'snapshot source metadata includes all cameras');
  for(const [i,id] of ['camera','camera2','camera3'].entries()){
   await toggle(id,false);const hidden=await shot('twitch');
   check(close(pixel(hidden.png,(i+.5)/3,.2),colors.game),id+' can be hidden independently');
   for(const [j,other] of ['camera','camera2','camera3'].entries())if(other!==id)check(close(pixel(hidden.png,(j+.5)/3,.2),colors[other]),id+' toggle leaves '+other+' visible');
   await toggle(id,true);
  }
  // Legacy OBS exports carry shared:camera. Device matching must still resolve
  // an explicitly configured extra slot, with a primary fallback for old IDs.
  config.obsCollection={version:1,name:'Generated multiple cameras',sources:[
   {id:'primary',name:'Legacy camera',type:'dshow_input',shared:'camera',settings:{video_device_id:'historical-unavailable-device'}},
   {id:'second',name:'Second matched camera',type:'dshow_input',shared:'camera',settings:{video_device_id:'SYNTHETIC-CAMERA-2'}},
   {id:'third',name:'Third explicit camera',type:'dshow_input',shared:'camera3',settings:{video_device_id:'do-not-open-this-device'}}
  ],scenes:[{id:'imported',key:'obs:imported',name:'Imported fixture',label:'Imported fixture',platform:'twitch',width:1280,height:720,items:[layer('primary',0),layer('second',320),layer('third',640)]}],aliases:{tiktok:{},twitch:{}}};
  config.program.scene='obs:imported';state=await prepare(config);
  check(state.sourceCount===4,'imported camera layers reuse the three selected captures');
  const imported=await shot('twitch','imported-three-cameras');
  for(const [i,id] of ['camera','camera2','camera3'].entries())check(close(pixel(imported.png,(i+.5)/4,1/6),colors[id]),'imported '+id+' preserves its transform and resolves its selected device');
  await toggle('camera2',false);const hiddenImported=await shot('twitch');
  check(close(pixel(hiddenImported.png,.375,1/6),[0,0,0]),'camera2 control hides its matched imported layer');
  check(close(pixel(hiddenImported.png,.125,1/6),colors.camera)&&close(pixel(hiddenImported.png,.625,1/6),colors.camera3),'camera2 control leaves other imported cameras intact');
  await toggle('camera2',true);
  const sourcePreview=await shot('twitch','source-preview-three-cameras','sources');
  check(close(pixel(sourcePreview.png,5/6,.2),colors.camera3),'source inspection uses the shared three-camera layout while an OBS scene is selected');
  const count=state.sceneCount;
  for(let i=0;i<3;i++){state=await prepare(config);check(state.sourceCount===4&&state.sceneCount===count,'reset '+i+' retains bounded scene and capture ownership');}
  config.sources.camera3.enabled=false;state=await prepare(config);
  check(!state.sources.some(source=>source.id==='camera3'),'disabled extra camera is not created');
  check(state.importWarnings.some(warning=>warning.includes('Kamera 3')),'imported explicit disabled slot reports the missing camera');
  check(close(pixel((await shot('twitch')).png,.625,1/6),[0,0,0]),'disabled imported camera3 does not fall back to the primary camera');
  const legacy=defaults();delete legacy.sources.camera2;delete legacy.sources.camera3;
  for(const platform of ['tiktok','twitch'])legacy.layouts[platform]=legacy.layouts[platform].filter(item=>['game','camera'].includes(item.source));
  check((await prepare(legacy)).sourceCount===2,'legacy one-camera configurations remain usable without extra captures');
  const invalid=structuredClone(config);invalid.sources.camera3.enabled=true;invalid.sources.camera2.target=invalid.sources.camera.target.toUpperCase();
  await assert.rejects(prepare(invalid),/anderes Gerät/);checks.push('duplicate enabled camera devices are rejected before capture');
  check(!(await client.request('status')).prepared,'failed preparation releases all captures');
  invalid.sources.camera2.target='';await assert.rejects(prepare(invalid),/Gerät auswählen/);checks.push('enabled camera with no selected device is rejected');
  for(const target of ['Batto TikTok:synthetic','@device:sw:{27B05C2D-93DC-474A-A5DA-9BBA34CB2A9D}']){
   invalid.sources.camera2.target=target;await assert.rejects(prepare(invalid),/virtuellen Batto-Kameras/);checks.push('own virtual output rejected: '+(target.startsWith('Batto')?'name':'class ID'));
  }
  await prepare(config);await shot('twitch');await client.request('stop',{platform:'both'});
  check((await client.request('status')).sources.filter(source=>/^camera/.test(source.id)).every(source=>!source.active),'stopping releases camera preview activation');
  fs.writeFileSync(path.join(output,'multi-camera-native-result.json'),JSON.stringify({ok:true,checks},null,2));console.log(JSON.stringify({ok:true,checks:checks.length}));
 }finally{await client.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
