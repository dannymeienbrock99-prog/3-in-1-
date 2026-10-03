'use strict';
// Opt-in GPU regression using generated pixels only. No physical input, public
// stream, registration writes or persistent user settings are involved.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PNG}=require('pngjs');
const {NativeClient}=require('../src/dual-stream/native-client.cjs'),{defaults}=require('../src/dual-stream/config.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(file,width,height,color){const png=new PNG({width,height});for(let i=0;i<png.data.length;i+=4){png.data.set(color,i);png.data[i+3]=255;}fs.writeFileSync(file,PNG.sync.write(png));return file;}
function decoded(snapshot){return PNG.sync.read(Buffer.from(snapshot.image.split(',')[1],'base64'));}
function pixel(png,x=.5,y=.5){const i=(Math.floor(png.height*y)*png.width+Math.floor(png.width*x))*4;return Array.from(png.data.subarray(i,i+3));}
function close(actual,expected,tolerance=8){return actual.every((n,i)=>Math.abs(n-expected[i])<=tolerance);}
(async()=>{
 const output=process.env.BATTO_DUAL_TEST_OUTPUT;if(!output)throw Error('Isolated evidence directory required');fs.mkdirSync(output,{recursive:true});
 const host=process.env.BATTO_DUAL_HOST||path.resolve(__dirname,'../../FanAtlas/BattoDualStream.exe'),root=process.env.BATTO_OBS_ROOT||'C:\\Program Files\\obs-studio';
 const client=new NativeClient(host,root,{env:{BATTO_DUAL_TEST:'1'}}),checks=[];
 const red=[200,30,60],blue=[20,170,220],vertical=fixture(path.join(output,'red-portrait.png'),72,128,red),horizontal=fixture(path.join(output,'blue-landscape.png'),128,72,blue);
 function check(condition,label){assert(condition,label);checks.push(label);}
 async function snapshot(platform,mode,label){let s;for(let i=0;i<6;i++){s=await client.request('snapshot',{platform,mode});if(i>0)break;await delay(180);}if(label)fs.writeFileSync(path.join(output,label+'.png'),Buffer.from(s.image.split(',')[1],'base64'));return {snapshot:s,png:decoded(s)};}
 try{
  await client.open();
  const config=defaults();config.program.scene='Pause';config.program.platformBackgrounds={tiktok:{Pause:vertical},twitch:{Pause:horizontal}};
  await client.request('test-prepare',{config});await delay(250);
  for(const [platform,color]of [['tiktok',red],['twitch',blue]]){
   const program=await snapshot(platform,'program',platform+'-pause'),sources=await snapshot(platform,'sources',platform+'-inputs');
   check(close(pixel(program.png),color),platform+' program preview uses its own background');
   check(!close(pixel(sources.png),color),platform+' source preview shows actual inputs instead of the Pause image');
   check(sources.snapshot.mode==='sources'&&sources.snapshot.scene==='Pause',platform+' source preview does not switch the program scene');
  }
  check(Object.values((await client.request('status')).outputs).every(o=>o.scene==='Pause'),'both program scenes stay Pause');
  const blank=defaults();blank.program.scene='Pause';blank.program.backgrounds.Pause=null;
  const cleared=await client.request('prepare',{config:blank});check(cleared.sourceCount===0,'removed background with disabled inputs has no source');
  for(const platform of ['tiktok','twitch']){const {png}=await snapshot(platform,'program',platform+'-removed');let nonBlack=0;for(let i=0;i<png.data.length;i+=4)if(png.data[i]>2||png.data[i+1]>2||png.data[i+2]>2)nonBlack++;check(nonBlack===0,platform+' removed background is black');}
  const shared=defaults();shared.program.scene='Pause';shared.program.backgrounds.Pause=horizontal;
  check((await client.request('prepare',{config:shared})).sourceCount===1,'identical background is shared by both canvases');
  for(let i=0;i<4;i++){check((await client.request('test-prepare',{config:defaults()})).sourceCount===2,'reset '+i+' releases previous background sources');}
  // Record only our generated color source to exercise the local video decoder.
  const video=path.join(output,'generated-background.mkv');
  await client.request('test-record',{platform:'twitch',path:video});await delay(1600);await client.request('stop',{platform:'both'});
  check(fs.existsSync(video)&&fs.statSync(video).size>1000,'generated local background video exists');
  const movie=defaults();movie.program.scene='Pause';movie.program.backgrounds.Pause=video;
  check((await client.request('prepare',{config:movie})).sourceCount===1,'video background decoder shared across both canvases');
  await client.request('camera-start',{platform:'twitch'});await delay(1400);
  const videoShot=await snapshot('twitch','program','video-background');check(pixel(videoShot.png).some(n=>n>30),'local video background decodes colored frames');
  await client.request('stop',{platform:'both'});
  fs.writeFileSync(path.join(output,'background-result.json'),JSON.stringify({ok:true,checks},null,2));console.log(JSON.stringify({ok:true,checks:checks.length}));
 }finally{await client.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
