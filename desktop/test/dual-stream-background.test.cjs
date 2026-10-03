'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DualStream}=require('../src/dual-stream/service.cjs');
const {validate}=require('../src/dual-stream/config.cjs');
function service(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-background-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return new DualStream({directory,executable:'unused',safeStorage:{},assets:directory});}
test('removing one canvas background persists and never becomes the factory background again',async t=>{
 const d=service(t);await d.background({scene:'Pause',platform:'tiktok',baseRevision:d.revision},null);
 const loaded=new DualStream({directory:d.directory,executable:'unused',safeStorage:{},assets:d.directory});
 assert.equal(loaded.config.program.platformBackgrounds.tiktok.Pause,null);assert.equal(loaded.nativeConfig().program.platformBackgrounds.tiktok.Pause,null);
 assert.equal(loaded.nativeConfig().program.backgrounds.Pause,path.join(d.directory,'bin-gleich-zurueck.jpg'));
 assert.equal(loaded.config.program.platformBackgrounds.twitch.Pause,undefined);
 assert.equal(loaded.native,null);
 await loaded.background({scene:'Pause',baseRevision:loaded.revision},null);
 assert.equal(loaded.nativeConfig().program.backgrounds.Pause,null);assert.equal(loaded.config.program.platformBackgrounds.tiktok.Pause,undefined);
});
test('background replacement updates a prepared sender but cannot interrupt running cameras or stale drafts',async t=>{
 const d=service(t),image=path.join(d.directory,'fixture.png');fs.writeFileSync(image,'fixture');
 d.state={prepared:true,outputs:{}};let prepared=0;d.prepare=async()=>{prepared++;d.state={prepared:true,outputs:{}};return d.snapshot();};
 await d.background({scene:'Start',platform:'twitch',baseRevision:1},image);assert.equal(prepared,1);assert.equal(d.config.program.platformBackgrounds.twitch.Start,image);
 await assert.rejects(d.background({scene:'Start',platform:'twitch',baseRevision:1},null),/neu laden/);
 d.state.outputs.tiktok={state:'camera'};await assert.rejects(d.background({scene:'Start',platform:'twitch',baseRevision:d.revision},null),/stoppen/);
 assert.equal(d.config.program.platformBackgrounds.twitch.Start,image);assert.equal(prepared,1);
});
test('source inspection requests an auxiliary frame without changing the selected program scene',async t=>{
 const d=service(t);d.config.program.scene='Pause';d.state.prepared=true;const calls=[];d.native={request:async(command,value)=>{calls.push({command,value});return {mode:value.mode,scene:'Pause'};}};
 try{assert.equal((await d.image({platform:'tiktok',mode:'sources'})).mode,'sources');assert.equal(d.config.program.scene,'Pause');await d.image('twitch');assert.deepEqual(calls,[{command:'snapshot',value:{platform:'tiktok',mode:'sources'}},{command:'snapshot',value:{platform:'twitch',mode:'program'}}]);await assert.rejects(d.image({platform:'tiktok',mode:'unknown'}),/Unbekannte/);assert.equal(calls.length,2);}finally{clearTimeout(d.idleTimer);}
});
test('imported per-platform backgrounds survive validation including explicit empty backgrounds',t=>{
 const d=service(t);d.config.program.platformBackgrounds={tiktok:{Start:'C:/local/portrait.mp4',Pause:null},twitch:{Start:'C:/local/landscape.mp4'}};
 const c=validate(d.config);assert.equal(c.program.platformBackgrounds.tiktok.Start,'C:/local/portrait.mp4');assert.equal(c.program.platformBackgrounds.tiktok.Pause,null);assert.equal(c.program.platformBackgrounds.twitch.Start,'C:/local/landscape.mp4');
});
