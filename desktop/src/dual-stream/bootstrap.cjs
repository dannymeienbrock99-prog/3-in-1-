'use strict';
const {app,ipcMain,BrowserWindow,dialog,safeStorage,clipboard}=require('electron'),fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url'),{randomUUID}=require('node:crypto');
const {DualStream}=require('./service.cjs'),windows=require('./windows.cjs');let service,closePromise;const pendingImports=new WeakMap();
const obsFiles=require('./obs-import-files.cjs');
const {EditorSettings}=require('./editor-settings.cjs');let editorStore;
function obsDirectory(){return path.join(app.getPath('appData'),'obs-studio','basic','scenes');}
function previewCollection(sender,file){
 pendingImports.delete(sender);const data=obsFiles.readCollectionFile(file);let preview;
 try{preview=require('./obs-scene-import.cjs').inspectCollection(data);}catch(error){throw Error('„'+path.basename(file).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,180)+'“: '+error.message);}
 const token=randomUUID();pendingImports.set(sender,{data,token,revision:service.revision,expires:Date.now()+15*60*1000});
 return {...preview,token,baseRevision:service.revision};
}
function snapshot(){editorStore??=new EditorSettings(service.directory);return {...service.snapshot(),editor:editorStore.snapshot(),...windows.status()};}
function publish(){if(!service)return;const value=snapshot();for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.webContents.isDestroyed()){try{win.webContents.send('dual:state',value);}catch{}}}
function sender(e){let file='';try{file=fileURLToPath(e.senderFrame.url);}catch{}const main=require('../../electron/main21.cjs').getMainWindow(),detached=windows.existing(),source=path.resolve(file),allowed=(main?.webContents===e.sender&&source===path.resolve(__dirname,'../renderer/index.html'))||(detached?.webContents===e.sender&&source===path.resolve(__dirname,'../renderer/dual-window.html'));if(!allowed||e.senderFrame!==e.sender.mainFrame)throw Error('Diese Oberfläche ist nicht berechtigt.');if(!service)throw Error('Dual Stream startet noch.');return detached?.webContents===e.sender;}
ipcMain.handle('dual:action',async(e,{command,value}={})=>{const detached=sender(e);
 if(command==='state')return snapshot();
 if(command==='editor'){editorStore??=new EditorSettings(service.directory);const editor=editorStore.update(value);publish();return editor;}
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
  case 'background':{const request=typeof value==='string'?{scene:value}:value;service.assertRevision(request);if(!['Pause','Start','Ende'].includes(request?.scene))throw Error('Unbekannte Szene.');if(service.running())throw Error('Bitte zuerst die virtuellen Kameras stoppen.');const r=await dialog.showOpenDialog({title:request.scene+' – Hintergrund wählen',properties:['openFile'],filters:[{name:'Bild oder Video',extensions:['png','jpg','jpeg','webp','bmp','gif','mp4','webm','mkv','mov','m4v','avi']}]});if(r.canceled)return null;return service.background(request,r.filePaths[0]);}
  case 'background-clear':return service.background(value,null);
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
  case 'import':{const r=await dialog.showOpenDialog({title:'Dual-Stream-Projekt importieren',properties:['openFile'],filters:[{name:'Dual-Stream-Konfiguration',extensions:['json']}]});if(r.canceled)return null;if(fs.statSync(r.filePaths[0]).size>16*1024*1024)throw Error('Projektdatei ist zu groß (maximal 16 MB).');return service.import(JSON.parse(fs.readFileSync(r.filePaths[0],'utf8').replace(/^\uFEFF/,'')));}
  case 'obs-import-list':if(service.running())throw Error('Bitte zuerst die virtuellen Kameras stoppen.');return obsFiles.listCollections(obsDirectory());
  case 'obs-import-local-preview':{
   if(service.running())throw Error('Bitte zuerst die virtuellen Kameras stoppen.');
   pendingImports.delete(e.sender);return previewCollection(e.sender,obsFiles.localCollectionFile(obsDirectory(),value));
  }
  case 'obs-import-preview':{
   if(service.running())throw Error('Bitte zuerst die virtuellen Kameras stoppen.');pendingImports.delete(e.sender);
   const r=await dialog.showOpenDialog({title:'OBS-Szenensammlung importieren',defaultPath:obsDirectory(),properties:['openFile'],filters:[{name:'OBS-Szenensammlung',extensions:['json']}]});if(r.canceled)return null;
   return previewCollection(e.sender,r.filePaths[0]);
  }
  case 'obs-import-apply':{
   const pending=pendingImports.get(e.sender);if(!pending||pending.token!==value?.token||pending.expires<Date.now())throw Error('Bitte die OBS-Datei erneut auswählen; die Importvorschau ist abgelaufen.');
   service.assertRevision(value);service.assertRevision({baseRevision:pending.revision});if(service.running())throw Error('Bitte zuerst die virtuellen Kameras stoppen.');
   if(value.transitionsOnly!==undefined&&typeof value.transitionsOnly!=='boolean')throw Error('Ungültige Importauswahl.');
   const importer=require('./obs-scene-import.cjs');
   const imported=(value.transitionsOnly?importer.applyTransitions:importer.applyCollection)(pending.data,{config:service.config,mapping:value.mapping,sources:value.sources,devices:service.probeResult?.devices});
   if(fs.existsSync(service.file))fs.copyFileSync(service.file,path.join(service.directory,'dual-stream.before-obs-import-'+Date.now()+'.json'));
   await service.save(imported.config);pendingImports.delete(e.sender);return {...snapshot(),importWarnings:imported.warnings,importSummary:imported.summary};
  }
  case 'obs-import-remove':{
   service.assertRevision(value);if(service.running())throw Error('Bitte zuerst die virtuellen Kameras stoppen.');
   const next=require('./obs-collection.cjs').removeObsImport(service.config,value);
   if(fs.existsSync(service.file))fs.copyFileSync(service.file,path.join(service.directory,'dual-stream.before-obs-remove-'+Date.now()+'.json'));
   await service.save(next);pendingImports.delete(e.sender);return snapshot();
  }
  case 'export':{const r=await dialog.showSaveDialog({defaultPath:'Batto-Dual-Stream.json',filters:[{name:'Dual-Stream-Projekt ohne Schlüssel',extensions:['json']}]});if(!r.canceled)fs.writeFileSync(r.filePath,JSON.stringify(service.config,null,2));return {saved:!r.canceled};}
  default:throw Error('Unbekannte Dual-Stream-Aktion.');
 }
});return result?.config?{...result,...snapshot()}:result;});
app.whenReady().then(()=>{const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../../..');service=new DualStream({directory:process.env.BATTO_SUITE_DATA||path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'CrazyBatto/BattoSuite'),executable:process.env.BATTO_DUAL_HOST||path.join(resources,'FanAtlas/BattoDualStream.exe'),safeStorage,assets:path.join(resources,'FanAtlas/Assets')});windows.initialize({directory:service.directory,changed:publish});service.on('state',publish);});
function close(){return closePromise||(closePromise=Promise.resolve().then(()=>{windows.close();return service?.release();}));}
module.exports={getService:()=>service,getDetachedWindow:windows.existing,close};
