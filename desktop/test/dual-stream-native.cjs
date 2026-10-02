'use strict';
// Opt-in local native acceptance test. Synthetic sources; no camera, mic or public RTMP connection.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeClient}=require('../src/dual-stream/native-client.cjs'),{defaults}=require('../src/dual-stream/config.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const output=process.env.BATTO_DUAL_TEST_OUTPUT;if(!output)throw Error('Set BATTO_DUAL_TEST_OUTPUT outside the repository.');fs.mkdirSync(output,{recursive:true});
 const client=new NativeClient(process.env.BATTO_DUAL_HOST||path.resolve(__dirname,'../../work/dual-host/BattoDualStream.exe'),process.env.BATTO_OBS_ROOT||'C:\\Program Files\\obs-studio',{env:{BATTO_DUAL_TEST:'1'}});
 try{
  await client.open();const probe=await client.request('probe');assert.equal(probe.encoder,'','camera mode must not load hardware encoders');const cfg=defaults();
  await client.request('test-prepare',{config:cfg});
  await client.request('test-record',{platform:'tiktok',path:path.join(output,'tiktok.mkv')});
  await client.request('test-record',{platform:'twitch',path:path.join(output,'twitch.mkv')});await delay(8000);
  const state=await client.request('status');assert.equal(state.sourceCount,2,'two shared sources, not four');
  for(const p of ['tiktok','twitch']){assert.equal(state.outputs[p].state,'test');assert(state.outputs[p].frames>100,JSON.stringify(state));const img=await client.request('snapshot',{platform:p});fs.writeFileSync(path.join(output,p+'.png'),Buffer.from(img.image.split(',')[1],'base64'));}
  const muted=await client.request('mute',{platform:'tiktok',muted:true});assert.equal(muted.outputs.tiktok.muted,true);assert.equal(muted.outputs.twitch.muted,false);
  const after=await client.request('stop',{platform:'tiktok'});assert.equal(after.outputs.tiktok.state,'stopped');assert.equal(after.outputs.twitch.state,'test');
  await delay(1000);await client.request('stop',{platform:'both'});
  const restart=await client.request('test-record',{platform:'tiktok',path:path.join(output,'tiktok-restart.mkv')});await delay(2500);assert.equal((await client.request('status')).outputs.tiktok.state,'test');await client.request('stop',{platform:'both'});
  cfg.program.backgrounds.Pause=path.resolve(__dirname,'../src/renderer/assets/bin-gleich-zurueck.jpg');assert(fs.existsSync(cfg.program.backgrounds.Pause));const prepared=await client.request('test-prepare',{config:cfg});assert.equal(prepared.sourceCount,3);
  await client.request('overlay',{chat:'Moderator: Lokaler Einblendungstest',events:'Testnutzer · 3 × Rose',chatVisible:true,eventsVisible:true});
  const scene=await client.request('scene',{scene:'Pause',transition:'fade',durationMs:350});assert.equal(scene.outputs.tiktok.scene,'Pause');assert.equal(scene.outputs.twitch.scene,'Pause');await delay(650);assert((await client.request('status')).overlays.twitch.chatWidth>0,'native text renderer exists');
  for(const p of ['tiktok','twitch']){const img=await client.request('snapshot',{platform:p});fs.writeFileSync(path.join(output,'pause-'+p+'.png'),Buffer.from(img.image.split(',')[1],'base64'));}
  await client.request('scene',{scene:'Spiel',transition:'cut',durationMs:100});await client.request('source',{source:'camera',enabled:false});await delay(200);
  const hidden=await client.request('snapshot',{platform:'twitch'});fs.writeFileSync(path.join(output,'camera-hidden.png'),Buffer.from(hidden.image.split(',')[1],'base64'));
  await client.request('media',{path:cfg.program.backgrounds.Pause,volume:0,duration:2});await delay(300);assert.equal((await client.request('media-state')).active,true);await client.request('media-stop');assert.equal((await client.request('media-state')).active,false);
  cfg.profile='fullhd_1080p30';await client.request('test-prepare',{config:cfg});for(const p of ['tiktok','twitch'])await client.request('test-record',{platform:p,path:path.join(output,p+'-fullhd.mkv')});await delay(4000);const hd=await client.request('status');assert.equal(hd.outputs.tiktok.width,1080);assert.equal(hd.outputs.twitch.width,1920);for(const p of ['tiktok','twitch'])assert(hd.outputs[p].frames>70);await client.request('stop',{platform:'both'});
  fs.writeFileSync(path.join(output,'native-result.json'),JSON.stringify({ok:true,encoder:state.encoder,version:probe.version,state,fullHd:hd,independentStop:true,independentMute:true,restart:true,scenes:true,transition:true,chatOverlay:true,sourceVisibility:true},null,2));
 }finally{await client.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
