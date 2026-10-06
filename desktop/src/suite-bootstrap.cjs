'use strict';
const path=require('node:path'),fs=require('node:fs'),{fileURLToPath}=require('node:url');
const {app,ipcMain,BrowserWindow,dialog,clipboard,shell}=require('electron');
const {SuiteRuntime}=require('./services/suite-runtime.cjs');
const {getObsClient}=require('../electron/main21.cjs');
let runtime;
const directory=process.env.BATTO_SUITE_DATA||path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'CrazyBatto','BattoSuite');
const broadcast=(channel,value)=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed()&&!w.webContents.isDestroyed()){try{w.webContents.send(channel,value);}catch{}}};
function checkSender(e){let file='';try{file=fileURLToPath(e.senderFrame.url);}catch{}if(path.resolve(file)!==path.resolve(__dirname,'renderer/index.html'))throw Error('Diese Bedienoberfläche ist nicht berechtigt.');}
function handle(name,fn){ipcMain.handle('suite:'+name,async(e,value)=>{checkSender(e);if(!runtime)throw Error('Batto 3-in-1 startet noch.');return fn(value);});}
handle('state',()=>runtime.snapshot());
handle('fan-control-state',()=>runtime.fanControl.snapshot());
handle('fan-control-refresh',()=>runtime.fanControl.inspect());
handle('fan-control-enable',value=>{if(typeof value?.enabled!=='boolean')throw Error('Bitte den Lüftermodus ein- oder ausschalten.');return runtime.fanControl.enable(value.enabled);});
handle('fan-control-manual',value=>runtime.fanControl.setManual(value));
handle('fan-control-curve',value=>runtime.fanControl.setCurve(value));
let restartingAsAdmin=false;
handle('hardware-admin-restart',async()=>{
 if(restartingAsAdmin)throw Error('Der Neustart wird bereits vorbereitet.');
 if(!app.isPackaged||process.platform!=='win32')throw Error('Der Administrator-Neustart ist in der installierten Windows-Version verfügbar.');
 const check=()=>{if(runtime.getDual?.()?.running())throw Error('Beende zuerst die Kameraausgaben unter Dual Stream.');const fan=runtime.fanControl.snapshot();if(fan.enabled||fan.phase!=='off')throw Error('Schalte die PC-Lüftersteuerung vor dem Neustart aus.');const strimer=runtime.rgb.bridge?.client?.strimerControl?.status;if(strimer?.enabled||['starting','restoring','active'].includes(strimer?.phase))throw Error('Gib vor dem Neustart die Strimer-Steuerung zurück.');};
 check();restartingAsAdmin=true;
 try{
  const result=await dialog.showMessageBox({type:'question',title:'Direkten Gerätezugriff freigeben',message:'Batto als Administrator neu starten?',detail:'Windows zeigt eine Freigabe für Batto. Dadurch kann Batto Mainboardlüfter direkt prüfen und die bestätigte Strimer-Übernahme ausführen. Die Steuerung bleibt nach dem Neustart aus.',buttons:['Batto neu starten','Abbrechen'],defaultId:0,cancelId:1});
  if(result.response!==0)return {ok:false,canceled:true};check();
  app.releaseSingleInstanceLock();
  try{const launched=await require('./services/admin-restart.cjs').launchOwnAsAdministrator({executable:process.execPath,pid:process.pid});if(launched?.accepted!==true){app.requestSingleInstanceLock();return {ok:false,canceled:true};}}
  catch(error){app.requestSingleInstanceLock();throw error;}
  try{check();}catch(error){app.requestSingleInstanceLock();throw error;}
  app.quit();return {ok:true,restarting:true};
 }finally{restartingAsAdmin=false;}
});
handle('fan-control-link',value=>{const links={fancontrol:'https://github.com/Rem0o/FanControl.Releases',corsair:'https://github.com/EvanMulawski/FanControl.CorsairLink',asus:'https://github.com/Karmel0x/AsusFanControl'};const url=links[value?.kind];if(!url)throw Error('Unbekannte Lüfterhilfe.');return shell.openExternal(url);});
handle('rgb-start',()=>runtime.rgb.openUi());
handle('rgb-state',()=>runtime.rgb.snapshot());
handle('rgb-stop',()=>runtime.rgb.stop());
handle('command',value=>runtime.jarvis.execute(value));
handle('settings',value=>runtime.jarvis.update(value));
handle('preview-event',value=>runtime.jarvis.previewEvent(value));
handle('preview-voice',value=>runtime.jarvis.previewVoice(value));
handle('import-status',()=>require('./services/obs-settings-import.cjs').status(app.getPath('userData')));
handle('import-obs-settings',()=>{
 const importer=require('./services/obs-settings-import.cjs');
 importer.prepareImport(path.join(app.getPath('appData'),'batto-obs-tool'),app.getPath('userData'));
 return importer.status(app.getPath('userData'));
});
handle('listen',()=>runtime.listen());
handle('control',value=>runtime.controls.execute(value));
handle('catalog',()=>runtime.controls.catalog());
handle('reset-likes',()=>{runtime.jarvis.events.resetLikes();return {ok:true};});
handle('stop',()=>runtime.stopSpeech());
handle('devices',()=>{runtime.voice.send({command:'devices'});return {ok:true};});
handle('scenes',()=>runtime.jarvis.obs.scenes());
handle('fan-config',async value=>{if(!['stage','curve','csv'].includes(value?.command))throw Error('Unbekannte Einstellung.');return runtime.fan.configure(value.command,value.value);});
handle('profile',async()=>{const result=await dialog.showOpenDialog({title:'Exportiertes iCUE-Profil wählen',properties:['openFile'],filters:[{name:'iCUE-Profil',extensions:['cueprofile']}]});if(result.canceled)return {canceled:true};return runtime.fan.configure('profile',{path:result.filePaths[0]});});
handle('csv',async()=>{const result=await dialog.showOpenDialog({title:'Laufendes Sensorprotokoll wählen',properties:['openFile','multiSelections'],filters:[{name:'Sensorprotokolle',extensions:['csv','log']}]});if(result.canceled)return {canceled:true};const paths=[...new Set([...(runtime.fan.catalog?.csvPaths||[]),...result.filePaths])];return runtime.fan.configure('csv',{paths});});
handle('voice-folder',async()=>{const result=await dialog.showOpenDialog({title:'Jarvis-Ordner mit Sprachpaket wählen',properties:['openDirectory']});if(result.canceled)return null;const root=result.filePaths[0];if(!fs.existsSync(path.join(root,'models/piper/de_DE-thorsten-medium.onnx')))throw Error('In diesem Ordner fehlt das Piper-Sprachmodell.');return runtime.jarvis.update({voiceRuntime:root});});
handle('copy-obs',()=>{const url=runtime.fan.catalog?.overlayUrl;if(!url)throw Error('OBS-Ansicht noch nicht verfügbar.');clipboard.writeText(url);return {ok:true};});
handle('open-obs',()=>{const url=runtime.fan.catalog?.overlayUrl;if(!url?.startsWith('http://127.0.0.1:17658/overlay?token='))throw Error('OBS-Ansicht noch nicht verfügbar.');return shell.openExternal(url);});
handle('export-layout',async()=>{const result=await dialog.showSaveDialog({title:'Lüfterlayout exportieren',defaultPath:'Batto-Luefterlayout.json',filters:[{name:'Layout',extensions:['json']}]});if(!result.canceled)fs.writeFileSync(result.filePath,JSON.stringify(runtime.fan.snapshot?.scene,null,2));return {ok:!result.canceled};});
handle('import-layout',async()=>{const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Layout',extensions:['json']}]});if(result.canceled)return {canceled:true};const file=result.filePaths[0];if(fs.statSync(file).size>256000)throw Error('Layoutdatei zu groß.');return runtime.fan.configure('stage',JSON.parse(fs.readFileSync(file,'utf8')));});
handle('export-curve',async value=>{const curve=require('./services/fan-curves.cjs').curveForExport(value,runtime.fan.catalog?.curves);const result=await dialog.showSaveDialog({title:'Batto-Kurvenentwurf exportieren',defaultPath:'Batto-Luefterkurve.json',filters:[{name:'Batto-Kurvenentwurf (keine iCUE-Profildatei)',extensions:['json']}]});if(!result.canceled)fs.writeFileSync(result.filePath,JSON.stringify(curve,null,2));return {ok:!result.canceled};});
handle('copy-curve',value=>{const helper=require('./services/fan-curves.cjs'),curve=helper.curveForExport(value,runtime.fan.catalog?.curves);clipboard.writeText(helper.curveTable(curve));return {ok:true,hardwareApplied:false};});
handle('open-icue',async()=>{const file=require('./services/fan-curves.cjs').icueExecutable();const error=await shell.openPath(file);if(error)throw Error('iCUE konnte nicht geöffnet werden. Bitte über das Startmenü öffnen.');return {ok:true};});
handle('plugin',()=>{const file=path.join(app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../../dist'),'Extras/de.crazybatto.suite.streamDeckPlugin');if(!fs.existsSync(file))throw Error('Plugin-Paket noch nicht gebaut.');return shell.openPath(file);});
handle('forget-memory',()=>{runtime.jarvis.memory=[];runtime.jarvis.save('jarvis-memory.json',[]);return {ok:true};});
app.whenReady().then(async()=>{
 const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../..');
 runtime=new SuiteRuntime({directory,fanRoot:process.env.BATTO_FAN_ROOT||path.join(resources,'FanAtlas'),hardwareRoot:app.isPackaged?path.join(resources,'BattoHardware'):path.resolve(resources,'../components/batto-hardware/publish'),rgbRoot:path.join(resources,'PRISM'),voiceCode:path.join(resources,'jarvis'),voiceBundle:process.env.BATTO_VOICE_ROOT||path.join(resources,'jarvis'),obs:getObsClient(),getDual:()=>require('./dual-stream/bootstrap.cjs').getService(),getHost:()=>require('../electron/main21.cjs').getSuiteHost()});
 runtime.on('message',value=>broadcast('suite:message',value));runtime.on('voice',value=>broadcast('suite:voice',value));runtime.on('state',value=>broadcast('suite:state',value));
 try{await runtime.start();}catch(e){runtime.jarvis.say('Lokale Verbindung: '+e.message,'error',false);}
}).catch(e=>console.error('Suite:',e.message));
let closePromise;
function close(){return closePromise||(closePromise=Promise.resolve().then(()=>runtime?.close()));}
async function releaseHardwareForQuit(){
 if(!runtime)return;
 try{
  await runtime.fanControl.prepareHardwareQuit();
  const bridge=runtime.rgb.bridge;
  if(bridge?.client?.prepareHardwareQuit){bridge.engine.stop();if(bridge.engine.framePromise)await bridge.engine.framePromise.catch(()=>{});await bridge.client.prepareHardwareQuit();}
 }catch(error){
  runtime.fanControl.cancelHardwareQuit();
  throw error;
 }
}
module.exports={close,releaseHardwareForQuit,onAcceptedEvent:event=>runtime?.jarvis.onEvent(event),onEvent:event=>{require('./dual-stream/bootstrap.cjs').getService()?.overlayEvent(event);},onChat:batch=>{runtime?.jarvis.onChat(batch);for(const m of batch)require('./dual-stream/bootstrap.cjs').getService()?.overlayChat(m);},getRuntime:()=>runtime};
