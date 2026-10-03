'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),{pathToFileURL}=require('node:url');
test('OBS import IPC previews without mutation, rejects stale/replayed changes, and backs up before applying',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-obs-ipc-')),previous=process.env.BATTO_SUITE_DATA,load=Module._load,handlers=new Map();let ready;
 const frame={url:pathToFileURL(path.resolve(__dirname,'../src/renderer/index.html')).href},sender={mainFrame:frame},event={sender,senderFrame:frame};
 const input=path.join(directory,'collection.json'),media=path.join(directory,'background.png');fs.writeFileSync(media,'synthetic path fixture');
 const item={source_uuid:'image',name:'Background',visible:true,align:5,scale_ref:{x:1920,y:1080},pos:{x:0,y:0},bounds_type:2,bounds:{x:1920,y:1080}};
 fs.writeFileSync(input,JSON.stringify({name:'Synthetic collection',sources:[{uuid:'image',name:'Background',id:'image_source',settings:{file:media}},{uuid:'pause',name:'Pause',id:'scene',settings:{items:[item]}}]}));
 const electron={app:{isPackaged:false,whenReady:()=>({then:fn=>{ready=fn;}}),getPath:()=>directory},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showOpenDialog:async()=>({filePaths:[input],canceled:false})},BrowserWindow:{getAllWindows:()=>[]},safeStorage:{},clipboard:{}};
 process.env.BATTO_SUITE_DATA=directory;
 Module._load=function(request,parent,main){if(request==='electron')return electron;if(request==='../../electron/main21.cjs')return {getMainWindow:()=>({webContents:sender})};return load.call(this,request,parent,main);};
 let bootstrap;
 try{
  bootstrap=require('../src/dual-stream/bootstrap.cjs');ready();const service=bootstrap.getService(),invoke=(command,value,e=event)=>handlers.get('dual:action')(e,{command,value});
  await service.save(service.config);const before=fs.readFileSync(service.file,'utf8'),revision=service.revision;
  const preview=await invoke('obs-import-preview');assert.equal(preview.scenes.length,1);assert(preview.token);assert.equal(fs.readFileSync(service.file,'utf8'),before);assert.equal(preview.baseRevision,revision);
  const request={token:preview.token,baseRevision:revision,mapping:{twitch:{Pause:'pause'}},sources:{camera:'',game:''}};
  await assert.rejects(invoke('obs-import-apply',{...request,token:'wrong'}),/erneut auswählen/);
  await assert.rejects(invoke('obs-import-preview',null,{...event,senderFrame:{url:frame.url}}),/nicht berechtigt/);
  await service.scene('Start');await assert.rejects(invoke('obs-import-apply',request),/inzwischen/);
  const fresh=await invoke('obs-import-preview');const preImport=fs.readFileSync(service.file,'utf8');const result=await invoke('obs-import-apply',{...request,token:fresh.token,baseRevision:fresh.baseRevision});
  assert.equal(result.config.program.platformBackgrounds.twitch.Pause,media);assert.deepEqual(result.importWarnings,[]);assert.match(result.importSummary,/1 OBS-Szenen/);assert.equal(result.engineRunning,false);
  assert.equal(result.config.obsCollection.scenes.length,1);assert(result.sceneChoices.some(x=>x.value==='obs:pause'));assert.equal(result.config.obsCollection.sources[0].settings.file,media);
  const backup=fs.readdirSync(directory).find(n=>n.startsWith('dual-stream.before-obs-import-'));assert(backup);assert.equal(fs.readFileSync(path.join(directory,backup),'utf8'),preImport);
  await assert.rejects(invoke('obs-import-apply',{...request,token:fresh.token,baseRevision:result.revision}),/erneut auswählen/);
  service.state.outputs={tiktok:{state:'camera'}};await assert.rejects(invoke('obs-import-preview'),/stoppen/);service.state.outputs={};
  await invoke('background-clear',{platform:'twitch',scene:'Pause',baseRevision:service.revision});assert.equal(service.config.program.platformBackgrounds.twitch.Pause,null);assert.equal(fs.existsSync(media),true);assert.equal(service.config.obsCollection.aliases.twitch.Pause,undefined);assert.equal(service.config.obsCollection.scenes.length,1);
 }finally{await bootstrap?.close();Module._load=load;if(previous===undefined)delete process.env.BATTO_SUITE_DATA;else process.env.BATTO_SUITE_DATA=previous;fs.rmSync(directory,{recursive:true,force:true});}
});
