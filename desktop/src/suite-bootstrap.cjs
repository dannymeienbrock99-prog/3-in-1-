'use strict';
const path=require('node:path'),fs=require('node:fs'),{fileURLToPath}=require('node:url');
const {app,ipcMain,BrowserWindow,dialog,clipboard,shell}=require('electron');
const {SuiteRuntime}=require('./services/suite-runtime.cjs');
const {getObsClient}=require('../electron/main21.cjs');
let runtime;
const directory=process.env.BATTO_SUITE_DATA||path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'CrazyBatto','BattoSuite');
const broadcast=(channel,value)=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.webContents.send(channel,value);};
function checkSender(e){let file='';try{file=fileURLToPath(e.senderFrame.url);}catch{}if(path.resolve(file)!==path.resolve(__dirname,'renderer/index.html'))throw Error('Diese Bedienoberfläche ist nicht berechtigt.');}
function handle(name,fn){ipcMain.handle('suite:'+name,async(e,value)=>{checkSender(e);if(!runtime)throw Error('Batto 3-in-1 startet noch.');return fn(value);});}
handle('state',()=>runtime.snapshot());
handle('command',value=>runtime.jarvis.execute(value));
handle('settings',value=>runtime.jarvis.update(value));
handle('import-status',()=>require('./services/obs-settings-import.cjs').status(app.getPath('userData')));
handle('import-obs-settings',()=>{
 const importer=require('./services/obs-settings-import.cjs');
 importer.prepareImport(path.join(app.getPath('appData'),'batto-obs-tool'),app.getPath('userData'));
 return importer.status(app.getPath('userData'));
});
handle('listen',()=>{runtime.voice.send({command:'listen'});return {ok:true};});
handle('stop',()=>{runtime.voice.send({command:'stop'});return {ok:true};});
handle('devices',()=>{runtime.voice.send({command:'devices'});return {ok:true};});
handle('scenes',async()=>{const obs=getObsClient();if(!obs?.connected)return [];return (await obs.request('GetSceneList')).scenes.map(s=>s.sceneName);});
handle('fan-config',async value=>{if(!['stage','curve','csv'].includes(value?.command))throw Error('Unbekannte Einstellung.');return runtime.fan.configure(value.command,value.value);});
handle('profile',async()=>{const result=await dialog.showOpenDialog({title:'Exportiertes iCUE-Profil wählen',properties:['openFile'],filters:[{name:'iCUE-Profil',extensions:['cueprofile']}]});if(result.canceled)return {canceled:true};return runtime.fan.configure('profile',{path:result.filePaths[0]});});
handle('csv',async()=>{const result=await dialog.showOpenDialog({title:'Laufendes Sensorprotokoll wählen',properties:['openFile','multiSelections'],filters:[{name:'Sensorprotokolle',extensions:['csv','log']}]});if(result.canceled)return {canceled:true};const paths=[...new Set([...(runtime.fan.catalog?.csvPaths||[]),...result.filePaths])];return runtime.fan.configure('csv',{paths});});
handle('voice-folder',async()=>{const result=await dialog.showOpenDialog({title:'Jarvis-Ordner mit Sprachpaket wählen',properties:['openDirectory']});if(result.canceled)return null;const root=result.filePaths[0];if(!fs.existsSync(path.join(root,'models/piper/de_DE-thorsten-medium.onnx')))throw Error('In diesem Ordner fehlt das Piper-Sprachmodell.');return runtime.jarvis.update({voiceRuntime:root});});
handle('copy-obs',()=>{const url=runtime.fan.catalog?.overlayUrl;if(!url)throw Error('OBS-Ansicht noch nicht verfügbar.');clipboard.writeText(url);return {ok:true};});
handle('open-obs',()=>{const url=runtime.fan.catalog?.overlayUrl;if(!url?.startsWith('http://127.0.0.1:17658/overlay?token='))throw Error('OBS-Ansicht noch nicht verfügbar.');return shell.openExternal(url);});
handle('export-layout',async()=>{const result=await dialog.showSaveDialog({title:'Lüfterlayout exportieren',defaultPath:'Batto-Luefterlayout.json',filters:[{name:'Layout',extensions:['json']}]});if(!result.canceled)fs.writeFileSync(result.filePath,JSON.stringify(runtime.fan.snapshot?.scene,null,2));return {ok:!result.canceled};});
handle('import-layout',async()=>{const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Layout',extensions:['json']}]});if(result.canceled)return {canceled:true};const file=result.filePaths[0];if(fs.statSync(file).size>256000)throw Error('Layoutdatei zu groß.');return runtime.fan.configure('stage',JSON.parse(fs.readFileSync(file,'utf8')));});
handle('export-curve',async value=>{const curve=runtime.fan.catalog?.curves?.find(c=>c.id===value);if(!curve)throw Error('Kurve nicht gefunden.');const result=await dialog.showSaveDialog({defaultPath:'Batto-Luefterkurve.json',filters:[{name:'Kurvenentwurf',extensions:['json']}]});if(!result.canceled)fs.writeFileSync(result.filePath,JSON.stringify(curve,null,2));return {ok:!result.canceled};});
handle('plugin',()=>{const file=path.join(app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../../dist'),'Extras/de.crazybatto.suite.streamDeckPlugin');if(!fs.existsSync(file))throw Error('Plugin-Paket noch nicht gebaut.');return shell.openPath(file);});
handle('forget-memory',()=>{runtime.jarvis.memory=[];runtime.jarvis.save('jarvis-memory.json',[]);return {ok:true};});
app.whenReady().then(async()=>{
 const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../..');
 runtime=new SuiteRuntime({directory,fanRoot:process.env.BATTO_FAN_ROOT||path.join(resources,'FanAtlas'),voiceCode:path.join(resources,'jarvis'),voiceBundle:process.env.BATTO_VOICE_ROOT||path.join(resources,'jarvis'),obs:getObsClient()});
 runtime.on('message',value=>broadcast('suite:message',value));runtime.on('voice',value=>broadcast('suite:voice',value));runtime.on('state',value=>broadcast('suite:state',value));
 try{await runtime.start();}catch(e){runtime.jarvis.say('Lokale Verbindung: '+e.message,'error',false);}
}).catch(e=>console.error('Suite:',e.message));
app.on('before-quit',()=>{void runtime?.close();});
module.exports={onChat:batch=>runtime?.jarvis.onChat(batch),getRuntime:()=>runtime};
