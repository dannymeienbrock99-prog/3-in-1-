'use strict';
const {app,ipcMain,BrowserWindow,dialog,safeStorage,clipboard}=require('electron'),fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
const {DualStream}=require('./service.cjs'),windows=require('./windows.cjs');let service,closePromise;
function snapshot(){return {...service.snapshot(),...windows.status()};}
function publish(){if(!service)return;const value=snapshot();for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.webContents.isDestroyed()){try{win.webContents.send('dual:state',value);}catch{}}}
function sender(e){let file='';try{file=fileURLToPath(e.senderFrame.url);}catch{}const main=require('../../electron/main21.cjs').getMainWindow(),detached=windows.existing(),source=path.resolve(file),allowed=(main?.webContents===e.sender&&source===path.resolve(__dirname,'../renderer/index.html'))||(detached?.webContents===e.sender&&source===path.resolve(__dirname,'../renderer/dual-window.html'));if(!allowed||e.senderFrame!==e.sender.mainFrame)throw Error('Diese Oberfläche ist nicht berechtigt.');if(!service)throw Error('Dual Stream startet noch.');return detached?.webContents===e.sender;}
ipcMain.handle('dual:action',async(e,{command,value}={})=>{const detached=sender(e);
 if(command==='state')return snapshot();
 if(command==='detach'){await windows.open();return snapshot();}
 if(command==='attach'){await windows.attach();return snapshot();}
 if(command==='always-on-top'){windows.alwaysOnTop(value);return snapshot();}
 if(command==='companion'||command==='gaming'){await require('../suite-bootstrap.cjs').getRuntime().controls.execute({action:command});return snapshot();}
 if(command==='copy-overlay'){if(!['chat','events'].includes(value))throw Error('Unbekannte Einblendung.');const status=require('../../electron/main21.cjs').getSuiteHost().overlayStatus();if(!status?.running)throw Error('Der Einblendungsdienst ist ausgeschaltet.');clipboard.writeText(`http://127.0.0.1:${status.port}/overlay/${value}`);return {ok:true};}
 if(command==='snapshot'){if(windows.existing()&&!detached)throw Error('Die Vorschau ist im entkoppelten Fenster geöffnet.');const win=BrowserWindow.fromWebContents(e.sender);if(!win?.isVisible()||win.isMinimized())throw Error('Die Vorschau pausiert im ausgeblendeten Fenster.');return service.serial(()=>service.image(value),true,false);}
 const result=await service.serial(async()=>{
 switch(command){
  case 'scene':service.assertRevision(value);return service.scene(value?.scene,value?.transition,value?.durationMs);
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
});return result?.config?snapshot():result;});
app.whenReady().then(()=>{const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../../..');service=new DualStream({directory:process.env.BATTO_SUITE_DATA||path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'CrazyBatto/BattoSuite'),executable:process.env.BATTO_DUAL_HOST||path.join(resources,'FanAtlas/BattoDualStream.exe'),safeStorage,assets:path.join(resources,'FanAtlas/Assets')});windows.initialize({directory:service.directory,changed:publish});service.on('state',publish);});
function close(){return closePromise||(closePromise=Promise.resolve().then(()=>{windows.close();return service?.release();}));}
module.exports={getService:()=>service,getDetachedWindow:windows.existing,close};
