'use strict';
const {app,ipcMain,BrowserWindow,dialog,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
const {DualStream}=require('./service.cjs');let service,quitting=false;
function sender(e){let file='';try{file=fileURLToPath(e.senderFrame.url);}catch{}if(path.resolve(file)!==path.resolve(__dirname,'../renderer/index.html'))throw Error('Diese Oberfläche ist nicht berechtigt.');if(!service)throw Error('Dual Stream startet noch.');}
ipcMain.handle('dual:action',async(e,{command,value}={})=>{sender(e);if(command==='state')return service.snapshot();const result=await service.serial(async()=>{
 switch(command){
  case 'scene':return service.scene(value?.scene,value?.transition,value?.durationMs);
  case 'program':return service.program(value);
  case 'background':{if(!['Pause','Start','Ende'].includes(value))throw Error('Unbekannte Szene.');if(service.state.prepared)throw Error('Video-Dienst erst ausschalten.');const r=await dialog.showOpenDialog({title:value+' – Hintergrund wählen',properties:['openFile'],filters:[{name:'Bild',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return null;return service.program({...service.config.program,backgrounds:{...service.config.program.backgrounds,[value]:r.filePaths[0]}});}
  case 'save':return service.save(value);
  case 'register-cameras':return service.registerCameras();
  case 'probe':await service.probe();return service.snapshot();
  case 'prepare':return service.prepare();
  case 'release':if(service.running())throw Error('Bitte zuerst die Kameras stoppen.');await service.release();return service.snapshot();
  case 'start':return service.start(value);
  case 'stop':return service.stop(value);
  case 'mute':return service.mute(value?.platform,value?.muted);
  case 'key':return service.saveKey(value?.platform,value?.key);
  case 'snapshot':return service.image(value);
  case 'library':{const r=await dialog.showOpenDialog({title:'OBS-Ordner mit bin, data und obs-plugins wählen',properties:['openDirectory']});if(r.canceled)return null;const root=r.filePaths[0];if(!fs.existsSync(path.join(root,'bin/64bit/obs.dll')))throw Error('Dieser Ordner enthält keine OBS-Bibliotheken.');return service.save({...service.config,obsRoot:root});}
  case 'import':{const r=await dialog.showOpenDialog({title:'Dual-Stream-Projekt importieren',properties:['openFile'],filters:[{name:'Dual-Stream-Konfiguration',extensions:['json']}]});if(r.canceled)return null;if(fs.statSync(r.filePaths[0]).size>128000)throw Error('Projektdatei ist zu groß.');return service.import(JSON.parse(fs.readFileSync(r.filePaths[0],'utf8')));}
  case 'export':{const r=await dialog.showSaveDialog({defaultPath:'Batto-Dual-Stream.json',filters:[{name:'Dual-Stream-Projekt ohne Schlüssel',extensions:['json']}]});if(!r.canceled)fs.writeFileSync(r.filePath,JSON.stringify(service.config,null,2));return {saved:!r.canceled};}
  default:throw Error('Unbekannte Dual-Stream-Aktion.');
 }
});return result?.config?service.snapshot():result;});
app.whenReady().then(()=>{const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../../..');service=new DualStream({directory:process.env.BATTO_SUITE_DATA||path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'CrazyBatto/BattoSuite'),executable:process.env.BATTO_DUAL_HOST||path.join(resources,'FanAtlas/BattoDualStream.exe'),safeStorage,assets:path.join(resources,'FanAtlas/Assets')});service.on('state',value=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('dual:state',value);});});
app.on('before-quit',e=>{if(service?.native&&!quitting){e.preventDefault();quitting=true;service.release().finally(()=>app.quit());}});
module.exports={getService:()=>service};
