'use strict';
// Opt-in end-to-end libobs rendering regression. Fixtures are generated colors;
// no user OBS export, physical devices, public output or registry writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PNG}=require('pngjs');
const {NativeClient}=require('../src/dual-stream/native-client.cjs'),{defaults}=require('../src/dual-stream/config.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(file,width,height,color){const p=new PNG({width,height});for(let i=0;i<p.data.length;i+=4)p.data.set([...color,255],i);fs.writeFileSync(file,PNG.sync.write(p));return file;}
function layer(source,x=0,y=0,scale=1,extra={}){return {source,visible:true,pos:{x,y},scale:{x:scale,y:scale},rot:0,align:5,bounds_type:0,bounds_align:0,bounds:{x:0,y:0},crop_left:0,crop_right:0,crop_top:0,crop_bottom:0,...extra};}
function scene(id,platform,items,extra={}){return {id,key:'obs:'+id,name:'Fixture '+id,label:'Fixture '+id,platform,width:platform==='tiktok'?720:1280,height:platform==='tiktok'?1280:720,items,...extra};}
function pixel(png,x,y,width=1280,height=720){const i=(Math.floor(y/height*png.height)*png.width+Math.floor(x/width*png.width))*4;return Array.from(png.data.subarray(i,i+3));}
function close(a,b,t=8){return a.every((n,i)=>Math.abs(n-b[i])<=t);}
(async()=>{
 const output=process.env.BATTO_DUAL_TEST_OUTPUT;if(!output)throw Error('Isolated evidence directory required');fs.mkdirSync(output,{recursive:true});
 const host=process.env.BATTO_DUAL_HOST||path.resolve(__dirname,'../../FanAtlas/BattoDualStream.exe'),root=process.env.BATTO_OBS_ROOT||'C:\\Program Files\\obs-studio';
 const client=new NativeClient(host,root,{env:{BATTO_DUAL_TEST:'1'}}),checks=[];
 const red=[210,25,40],blue=[20,140,220],green=[20,150,40],black=[0,0,0];
 const redFile=fixture(path.join(output,'red.png'),200,100,red),blueFile=fixture(path.join(output,'blue.png'),80,80,blue);
 function check(condition,label){assert(condition,label);checks.push(label);}
 async function shot(platform,label,mode='program'){await client.request('snapshot',{platform,mode});await delay(180);const s=await client.request('snapshot',{platform,mode});if(label)fs.writeFileSync(path.join(output,label+'.png'),Buffer.from(s.image.split(',')[1],'base64'));return {data:s,png:PNG.sync.read(Buffer.from(s.image.split(',')[1],'base64'))};}
 async function switchTo(key){return client.request('scene',{scene:key,transition:'cut',durationMs:100});}
 try{
  await client.open();
  const config=defaults();config.profile='efficient_720p30';
  // Use whichever current default profile the product specifies; its canvas
  // aspect ratio remains 16:9 / 9:16 and pixel assertions are normalized.
  config.profile=defaults().profile;
  config.obsCollection={version:1,name:'Generated fixture',warnings:[],sources:[
   {id:'red',name:'Red',type:'image_source',settings:{file:redFile}},
   {id:'redCopy',name:'Red shared',type:'image_source',settings:{file:redFile}},
   {id:'blue',name:'Blue',type:'image_source',settings:{file:blueFile}},
   {id:'green',name:'Green canvas',type:'color_source',settings:{color:0xFF289614,width:1280,height:720}},
   {id:'portraitBlue',name:'Portrait canvas',type:'color_source',settings:{color:0xFFDC8C14,width:720,height:1280}},
   {id:'cam1',name:'Historical camera one',type:'dshow_input',shared:'camera',settings:{video_device_id:'MUST NOT OPEN'}},
   {id:'cam2',name:'Historical camera two',type:'dshow_input',shared:'camera',settings:{video_device_id:'MUST NOT OPEN EITHER'}},
   {id:'windowA',name:'Original window A',type:'window_capture',settings:{window:'Fixture A:Impossible import fixture:batto-import-fixture-never-running.exe',priority:0}},
   {id:'windowAcopy',name:'Repeated original window A',type:'window_capture',settings:{window:'Fixture A:Impossible import fixture:batto-import-fixture-never-running.exe',priority:0}},
   {id:'windowB',name:'Original window B',type:'window_capture',settings:{window:'Fixture B:Impossible import fixture:batto-import-fixture-never-running.exe',priority:0}},
   {id:'windowAclient',name:'Window A different client area',type:'window_capture',settings:{window:'Fixture A:Impossible import fixture:batto-import-fixture-never-running.exe',priority:0,client_area:false}},
   {id:'unsupported',name:'Unsupported fixture',type:'unsupported',settings:{}}
  ],scenes:[
   scene('L','twitch',[layer('green'),layer('red',128,72,2),layer('blue',200,100),layer('cam1',800,0,1,{bounds_type:2,bounds:{x:240,y:180}}),layer('cam2',1040,0,1,{bounds_type:2,bounds:{x:240,y:180}})],{partnerId:'P'}),
   scene('P','tiktok',[layer('portraitBlue'),layer('redCopy',72,360,2)],{partnerId:'L'}),
   scene('transform','twitch',[layer('red',100,100,1,{crop_left:100}),layer('blue',600,100,1,{rot:90})]),
   scene('nested','twitch',[layer('group',128,72,2)]),
   scene('group','twitch',[layer('red')],{width:200,height:100,internal:true}),
   scene('blank','twitch',[layer('unsupported')]),
   scene('capture-targets','twitch',[layer('windowA'),layer('windowAcopy'),layer('windowB'),layer('windowAclient')])
  ],aliases:{tiktok:{Spiel:'P',Start:'P',Pause:'P',Ende:'P'},twitch:{Spiel:'L',Start:'L',Pause:'L',Ende:'L'}}};
  config.program.scene='obs:L';
  let state=await client.request('test-prepare',{config});
  check(state.sourceCount===9,'duplicate media and explicit shared cameras share sources while distinct windows stay independent');
  check(state.sources.some(s=>s.id==='obs:windowA')&&state.sources.some(s=>s.id==='obs:windowB')&&!state.sources.some(s=>s.id==='obs:windowAcopy'),'independent window captures cache by original target');
  check(state.sources.some(s=>s.id==='obs:windowAclient'),'same window with different client area keeps distinct source settings');
  check(state.importWarnings.some(x=>x.includes('Unsupported fixture')),'unsupported input is reported instead of aborting the import');
  const landscape=(await shot('twitch','layers-landscape')).png,portrait=(await shot('tiktok','paired-portrait')).png;
  check(close(pixel(landscape,50,300),green),'landscape background layer fills its canvas');
  check(close(pixel(landscape,150,90),red),'native media width with scale 2 preserves original position');
  check(close(pixel(landscape,600,130),green),'bounds type none does not stretch media to a guessed full canvas');
  check(close(pixel(landscape,240,140),blue),'later OBS item stays above the preceding image');
  check(close(pixel(portrait,10,900,720,1280),blue),'portrait counterpart selected on TikTok');
  check(close(pixel(portrait,100,400,720,1280),red),'portrait counterpart preserves its distinct transform');
  check((await client.request('status')).outputs.tiktok.sceneLabel==='Fixture P','status reports the resolved portrait scene');
  for(const alias of ['Spiel','Start','Pause','Ende']){await switchTo(alias);check(close(pixel((await shot('twitch')).png,240,140),blue),alias+' shortcut resolves to imported scene');}
  const sourcePreview=await shot('twitch','source-inspection','sources');check(!close(pixel(sourcePreview.png,240,140),blue),'source inspection uses shared inputs independent of the imported Spiel alias');
  await switchTo('obs:L');await client.request('source',{source:'camera',enabled:false});let hidden=(await shot('twitch','camera-hidden')).png;
  check(close(pixel(hidden,900,90),green)&&close(pixel(hidden,1160,90),green),'camera toggle hides every imported camera layer');
  await client.request('source',{source:'camera',enabled:true});let shown=(await shot('twitch')).png;
  check(!close(pixel(shown,900,90),green)&&!close(pixel(shown,1160,90),green),'camera toggle restores every imported camera layer');
  await switchTo('obs:transform');const transform=(await shot('twitch','crop-rotation')).png;
  check(close(pixel(transform,125,125),red)&&close(pixel(transform,225,125),black),'crop is applied before item placement without invented bounds');
  check(close(pixel(transform,550,140),blue)&&close(pixel(transform,630,140),black),'rotation preserves OBS item origin and clockwise orientation');
  const letterbox=(await shot('tiktok','unpaired-letterbox')).png;check(close(pixel(letterbox,10,10,720,1280),black),'unpaired landscape keeps aspect ratio on portrait output');
  await switchTo('obs:nested');const nested=(await shot('twitch','nested')).png;
  check(close(pixel(nested,200,120),red)&&close(pixel(nested,600,120),black),'nested internal scene preserves group transform');
  await assert.rejects(switchTo('obs:group'),/Ungültige Szene/);checks.push('internal groups are not exposed as program scenes');
  const sceneCount=(await client.request('status')).sceneCount;
  await switchTo('obs:capture-targets');check(close(pixel((await shot('twitch','independent-windows')).png,640,360),black),'unavailable original windows never substitute the unrelated shared game');
  for(let i=0;i<4;i++){state=await client.request('test-prepare',{config});check(state.sourceCount===9&&state.sceneCount===sceneCount,'prepare/reset '+i+' keeps source and scene ownership bounded');}
  const cycle=structuredClone(config);cycle.obsCollection.scenes[0].items.push(layer('L'));await assert.rejects(client.request('test-prepare',{config:cycle}),/Szenenkreis/);check(!(await client.request('status')).prepared,'cyclic scene graph is rejected and partial preparation is released');
  await client.request('test-prepare',{config:defaults()});const movie=path.join(output,'generated-video.mkv');await client.request('test-record',{platform:'twitch',path:movie});await delay(1600);await client.request('stop',{platform:'both'});
  config.obsCollection.sources.push({id:'movieFile',name:'Generated movie',type:'ffmpeg_source',settings:{local_file:movie,is_local_file:true,looping:true}});
  config.obsCollection.scenes.push(scene('movie','twitch',[layer('movieFile',0,0,1,{bounds_type:2,bounds:{x:1280,y:720}})]));
  config.program.scene='obs:blank';state=await client.request('test-prepare',{config});check(state.sources.find(x=>x.id==='obs:movieFile').active===false,'imported video stays inactive while another scene is selected');
  await switchTo('obs:movie');await client.request('snapshot',{platform:'twitch'});await delay(700);
  check(pixel((await shot('twitch','video-preview-without-output')).png,100,100).some(n=>n>30),'video preview warms up and decodes without a running output');
  const before=(await client.request('test-media-state')).find(x=>x.id==='obs:movieFile').milliseconds;await delay(300);
  const after=(await client.request('test-media-state')).find(x=>x.id==='obs:movieFile').milliseconds;
  check(after>before,'video preview playback clock advances between snapshots');
  check((await client.request('status')).sources.find(x=>x.id==='obs:movieFile').active===true,'preview lease retains the selected decoder between one-second snapshots');
  await delay(2700);check((await client.request('status')).sources.find(x=>x.id==='obs:movieFile').active===false,'preview lease expires without incoming commands');
  await client.request('snapshot',{platform:'twitch'});await client.request('snapshot',{platform:'twitch',mode:'sources'});
  check((await client.request('status')).sources.find(x=>x.id==='obs:movieFile').active===false,'switching preview mode releases the previous program graph');
  await client.request('snapshot',{platform:'twitch'});await client.request('stop',{platform:'both'});
  check((await client.request('status')).sources.find(x=>x.id==='obs:movieFile').active===false,'stop releases preview activation immediately');
  await client.request('test-record',{platform:'twitch',path:path.join(output,'rendered-video.mkv')});await delay(1200);
  check((await client.request('status')).sources.find(x=>x.id==='obs:movieFile').active===true,'selected imported video activates only when output is running');
  check(pixel((await shot('twitch','video-scene')).png,100,100).some(n=>n>30),'imported video supplies real decoded frames');
  await switchTo('obs:blank');await delay(300);check((await client.request('status')).sources.find(x=>x.id==='obs:movieFile').active===false,'switching away deactivates the video decoder');
  await client.request('stop',{platform:'both'});
  check((await client.request('test-prepare',{config:defaults()})).sourceCount===2,'reset after video releases every imported source');
  fs.writeFileSync(path.join(output,'obs-collection-result.json'),JSON.stringify({ok:true,checks},null,2));console.log(JSON.stringify({ok:true,checks:checks.length}));
 }finally{await client.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
