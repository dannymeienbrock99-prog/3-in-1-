'use strict';
// Opt-in native regression: generated scenes and a short transparent PNG video.
// No real camera, audio capture, registry changes or live output is accessed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {PNG}=require('pngjs');
const {NativeClient}=require('../src/dual-stream/native-client.cjs'),{defaults}=require('../src/dual-stream/config.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pixel=(png,x,y)=>[...png.data.subarray((Math.floor(y*png.height)*png.width+Math.floor(x*png.width))*4,(Math.floor(y*png.height)*png.width+Math.floor(x*png.width))*4+3)];
const close=(actual,expected)=>actual.every((value,index)=>Math.abs(value-expected[index])<14);
(async()=>{
 const output=process.env.BATTO_DUAL_TEST_OUTPUT,ffmpeg=process.env.BATTO_FFMPEG;
 if(!output||!ffmpeg)throw Error('Set isolated BATTO_DUAL_TEST_OUTPUT and local BATTO_FFMPEG.');fs.mkdirSync(output,{recursive:true});
 const checks=[],check=(condition,label)=>{assert(condition,label);checks.push(label);};
 const image=new PNG({width:160,height:90}),green=[30,240,70];
 for(let y=30;y<60;y++)for(let x=55;x<105;x++){const i=(y*image.width+x)*4;image.data[i]=green[0];image.data[i+1]=green[1];image.data[i+2]=green[2];image.data[i+3]=255;}
 const pngFile=path.join(output,'generated-alpha.png'),movie=path.join(output,'generated-alpha.mov');fs.writeFileSync(pngFile,PNG.sync.write(image));
 execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-loop','1','-i',pngFile,'-t','2.4','-r','30','-c:v','png','-pix_fmt','rgba',movie],{windowsHide:true,stdio:'pipe'});
 const cfg=defaults();cfg.profile='economy_720p30';cfg.program.scene='obs:AL';
 const layer=source=>({source,visible:true,pos:{x:0,y:0},scale:{x:1,y:1},rot:0,align:5,bounds_type:1,bounds_align:0,bounds:{x:1280,y:1280}});
 const scene=(id,platform,source,partnerId)=>({id,name:id,platform,partnerId,width:platform==='tiktok'?720:1280,height:platform==='tiktok'?1280:720,items:[{...layer(source),bounds:{x:platform==='tiktok'?720:1280,y:platform==='tiktok'?1280:720}}]});
 const red=[220,35,25],blue=[20,90,220];
 cfg.obsCollection={version:1,name:'Synthetic transition fixture',sources:[{id:'red',name:'Red',type:'color_source',settings:{color:0xFF1923DC,width:1280,height:1280}},{id:'blue',name:'Blue',type:'color_source',settings:{color:0xFFDC5A14,width:1280,height:1280}}],scenes:[scene('AL','twitch','red','AP'),scene('AP','tiktok','red','AL'),scene('BL','twitch','blue','BP'),scene('BP','tiktok','blue','BL')],aliases:{tiktok:{},twitch:{}}};
 cfg.transitions=[{id:'obs-transition:fixture',name:'Generated alpha Stinger',type:'stinger',settings:{path:movie,transition_point:1000,tp_type:0,preload:true,enable_monitoring:true}},{id:'obs-transition:missing',name:'Missing fixture',type:'stinger',settings:{path:path.join(output,'missing.mov')}}];
 const client=new NativeClient(process.env.BATTO_DUAL_HOST||path.resolve(__dirname,'../../FanAtlas/BattoDualStream.exe'),process.env.BATTO_OBS_ROOT||'C:\\Program Files\\obs-studio',{env:{BATTO_DUAL_TEST:'1'}});
 async function shot(platform,label){const data=await client.request('snapshot',{platform});const buffer=Buffer.from(data.image.split(',')[1],'base64');if(label)fs.writeFileSync(path.join(output,label+'.png'),buffer);return PNG.sync.read(buffer);}
 async function change(scene,transition='obs-transition:fixture',platform='both'){return client.request('scene',{scene,transition,durationMs:300,platform});}
 try{
  await client.open();let state=await client.request('test-prepare',{config:cfg});
  check(state.encoder==='','preparation loads no encoder');check(Object.values(state.outputs).every(x=>x.transition==='fade'),'import stores definitions without preloading every Stinger');
  for(const platform of ['tiktok','twitch']){await shot(platform);await delay(120);check(close(pixel(await shot(platform),.1,.1),red),platform+' starts on old scene');}
  await assert.rejects(change('obs:BL','obs-transition:missing'),/Videodatei.*fehlt/);checks.push('missing Stinger video clearly rejects before switching');
  state=await client.request('status');check(Object.values(state.outputs).every(x=>x.scene==='obs:AL'&&x.transition==='fade'),'missing file changes neither output nor transition');
  state=await change('obs:BL');check(Object.values(state.outputs).every(x=>x.scene==='obs:BL'&&x.transition==='obs-transition:fixture'),'both canvases start the imported Stinger');
  await assert.rejects(change('obs:AL'),/läuft noch/);checks.push('overlapping paired transition is rejected');
  await delay(280);
  for(const platform of ['tiktok','twitch']){const during=await shot(platform,'stinger-before-point-'+platform);check(close(pixel(during,.5,.5),green),platform+' displays decoded transition video');check(close(pixel(during,.1,.1),red),platform+' preserves old scene through transparent pixels before switch point');}
  await delay(950);
  for(const platform of ['tiktok','twitch']){const afterPoint=await shot(platform,'stinger-after-point-'+platform);check(close(pixel(afterPoint,.5,.5),green),platform+' Stinger remains visible after switch point');check(close(pixel(afterPoint,.1,.1),blue),platform+' shows new scene through alpha after switch point');}
  await delay(1700);
  for(const platform of ['tiktok','twitch'])check(close(pixel(await shot(platform,'stinger-finished-'+platform),.5,.5),blue),platform+' ends on new scene without overlay residue');
  let transitions=await client.request('test-transition-state');check(Object.values(transitions).every(value=>value.children.length===0),'finished Stinger releases all decoder references');
  state=await change('obs:BL');check(Object.values(state.outputs).every(x=>x.scene==='obs:BL'),'selecting the same scene is a successful no-op');
  transitions=await client.request('test-transition-state');check(Object.values(transitions).every(value=>value.children.length===0),'selecting the same scene keeps Stinger decoders released');
  await change('obs:AL');await delay(280);for(const platform of ['tiktok','twitch']){const replay=await shot(platform);check(close(pixel(replay,.5,.5),green)&&close(pixel(replay,.1,.1),blue),platform+' reloads the selected Stinger and restarts at the old scene');}await delay(2600);
  state=await change('obs:AL','fade');check(Object.values(state.outputs).every(x=>x.transition==='fade'),'switching back to fade releases imported transition resources');await delay(450);
  transitions=await client.request('test-transition-state');check(Object.values(transitions).every(value=>value.children.length===0),'fade releases all Stinger decoder references');
  state=await change('obs:BL');await delay(180);await shot('twitch');state=await change('obs:AL','cut');
  check(Object.values(state.outputs).every(x=>x.scene==='obs:AL'&&!x.transitionActive),'cut interrupts an in-progress Stinger on both canvases');await delay(120);
  for(const platform of ['tiktok','twitch'])check(close(pixel(await shot(platform),.5,.5),red),platform+' cut contains no old Stinger video');
  const count=state.sceneCount;for(let i=0;i<3;i++){state=await client.request('test-prepare',{config:cfg});check(state.sceneCount===count&&Object.values(state.outputs).every(x=>x.transition==='fade'),'reset '+i+' releases transition resources and preserves bounded scene count');}
  await client.request('stop',{platform:'both'});state=await client.request('status');check(Object.values(state.outputs).every(x=>x.state==='stopped')&&state.encoder==='','tests never start output or encoder');
  fs.writeFileSync(path.join(output,'transition-native-result.json'),JSON.stringify({ok:true,checks},null,2));console.log(JSON.stringify({ok:true,checks:checks.length}));
 }finally{await client.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
