'use strict';
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
const {app,ipcMain,BrowserWindow,dialog,shell}=require('electron');
const windows=require('./touch-windows.cjs');
let deck,packages,host,demand,presentation={},visualRevision=0,visualTimer,closing=false;
const observed=new Set();let copiedButton=null;
function trusted(url){try{return ['index.html','touch-window.html'].some(name=>path.resolve(fileURLToPath(url))===path.resolve(__dirname,'renderer',name));}catch{return false;}}
function broadcast(channel,value){for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.webContents.isDestroyed()&&trusted(win.webContents.getURL()))try{win.webContents.send(channel,value);}catch{}}
function changed(){if(deck&&!closing)broadcast('touch:state',deck.snapshot());}
function visualChanged(){if(closing||visualTimer)return;visualTimer=setTimeout(()=>{visualTimer=null;if(closing)return;const next=host?.visuals()||{};if(JSON.stringify(next)===JSON.stringify(presentation))return;presentation=next;visualRevision++;broadcast('touch:presentation',presentation);},200);}
function getPackages(){if(!packages){const {TouchPackages}=require('./services/touch-packages.cjs');packages=new TouchPackages({directory:path.join(getDeck().directory,'TouchPackages'),convertImage:require('./services/touch-images.cjs').thumbnail});}return packages;}
function getHost(create=true){
 if(!host&&create){const {TouchPluginHost}=require('./services/touch-plugin-host.cjs');host=new TouchPluginHost({packages:getPackages(),nodeExecutable:process.execPath,onVisual:visualChanged,openExternal:url=>shell.openExternal(url),launchHtml:async spec=>{
  const key='inspector:'+spec.buttonId;
  const result=await windows.launchHtml({...spec,onClose:()=>{spec.onClose?.();if(spec.kind==='inspector')void demand.remove(key).catch(()=>{});}});
  if(spec.kind==='inspector')void demand.set(key,'',{buttonId:spec.buttonId}).catch(()=>{});return result;
 }});}return host;
}
function findButton(id){let found;const visit=buttons=>{for(const button of buttons){if(button?.id===id)found=button;if(button?.type==='folder')visit(button.buttons);}};for(const p of getDeck().config.profiles)visit(p.buttons);if(found?.type!=='plugin')throw Error('Bitte zuerst eine Plugin-Taste speichern.');return found;}
async function activateButton(button){await demand.set('press:'+button.id,'',{temporary:true,buttonId:button.id});return getHost();}
function getDeck(){
 if(deck)return deck;
 const runtime=require('./suite-bootstrap.cjs').getRuntime();if(!runtime)throw Error('Batto startet noch. Bitte kurz warten.');
 const {TouchDeck}=require('./services/touch-deck.cjs');
 const audio=runtime.getAudio();
 windows.initialize({directory:runtime.directory,changed});
 deck=new TouchDeck({directory:runtime.directory,controls:runtime.controls,audio,webRoot:path.join(__dirname,'touch-mobile'),getWindowStatus:windows.status,getPresentation:()=>presentation,getVisualRevision:()=>visualRevision,
  pressPlugin:async button=>(await activateButton(button)).press(button.id),
  onRemoteActivity:(id,profileId)=>{void demand?.set('remote:'+id,profileId,{temporary:true}).catch(()=>{});},onRemoteDisconnect:id=>{void demand?.remove('remote:'+id).catch(()=>{});},getSensors:()=>{
   const fan=runtime.fan.snapshot,rules=runtime.jarvis.settings.sensorRules||{};
   const sensors=(fan?.sensors||[]).map(s=>({id:s.id,name:rules[s.id]?.alias||s.name,value:s.fresh&&Number.isFinite(s.value)?s.value:null,unit:s.unit}));
   for(const tile of fan?.scene?.tiles||[])sensors.push({id:'fan:'+tile.id,name:tile.name+' · Drehzahl',value:tile.speedPercent?.fresh&&Number.isFinite(tile.speedPercent.value)?tile.speedPercent.value:null,unit:'%'});return sensors;
  }});
 const {TouchDemand}=require('./services/touch-demand.cjs');demand=new TouchDemand({getConfig:()=>deck.config,getHost,changed:visualChanged});
 deck.on('change',state=>{broadcast('touch:state',state);void demand.sync().catch(()=>{});});return deck;
}
ipcMain.handle('touch:action',async(event,{command,value}={})=>{
 if(!trusted(event.senderFrame?.url)||event.senderFrame!==event.sender.mainFrame)throw Error('Diese Bedienoberfläche ist nicht berechtigt.');
 const current=getDeck();
 switch(command){
  case 'state':return value?.sensorsOnly===true?{sensors:current.sensors()}:current.snapshot();
  case 'catalog':return current.catalog();
  case 'save':return current.save(value);
  case 'press':return current.press(value);
  case 'audio-targets':return current.audio.targets();
  case 'audio-state':return current.audioState(value);
  case 'volume':return current.volume(value);
  case 'presence':{
   const sender=event.sender,id='window:'+sender.id;if(!observed.has(sender.id)){observed.add(sender.id);sender.once('destroyed',()=>{observed.delete(sender.id);void demand.remove(id).catch(()=>{});});}
   await demand.set(id,value?.profileId,{visible:value?.visible===true});return {ok:true};
  }
  case 'detach':await windows.open();return current.snapshot();
  case 'attach':await windows.attach();return current.snapshot();
  case 'edit-main':{
   if(value){const p=current.config.profiles.find(p=>p.id===value.profileId);if(!p||!Number.isInteger(value.index)||value.index<0||value.index>=p.rows*p.columns||!Array.isArray(value.path||[])||(value.path||[]).length>4)throw Error('Ungültige Tastenposition.');let buttons=p.buttons;for(const index of value.path||[]){if(!Number.isInteger(index)||buttons[index]?.type!=='folder')throw Error('Diesen Ordner gibt es nicht mehr.');buttons=buttons[index].buttons;}}
   await windows.showMain();if(value){const win=require('../electron/main21.cjs').getMainWindow();win?.webContents.send('touch:edit',{profileId:value.profileId,path:value.path||[],index:value.index});}return {ok:true};
  }
  case 'clipboard-set':{const data=JSON.stringify(value);if(!value||typeof value!=='object'||Buffer.byteLength(data)>4*1024*1024)throw Error('Diese Taste ist zu groß zum Kopieren.');copiedButton=JSON.parse(data);return {ok:true};}
  case 'clipboard-get':return copiedButton?JSON.parse(JSON.stringify(copiedButton)):null;
  case 'always-on-top':windows.alwaysOnTop(value);return current.snapshot();
  case 'packages':return getPackages().list();
  case 'package-import':{
   const result=await dialog.showOpenDialog({title:'Plugin oder Icon-Paket laden',properties:['openFile'],filters:[{name:'Stream-Deck-Pakete',extensions:['streamDeckPlugin','streamDeckIconPack']}]});if(result.canceled)return {canceled:true};
   await getPackages().importFile(result.filePaths[0]);await demand.sync({force:true});return getPackages().list();
  }
  case 'pack-icons':{
   const page=getPackages().icons({...value,limit:Math.min(24,Math.max(1,Number(value?.limit)||24))}),icons=[];
   for(const item of page.items){try{icons.push({...item,image:await getPackages().icon({packId:value.packId,iconId:item.id})});}catch{icons.push({...item,image:'',error:'Dieses Bild kann nicht angezeigt werden.'});}}
   return {...page,items:undefined,icons};
  }
  case 'pack-icon':return getPackages().icon(value);
  case 'plugin-settings':{const button=findButton(value?.buttonId);return (await activateButton(button)).inspector(button.id);}
  case 'mobile-start':await current.mobileStart();return current.snapshot();
  case 'mobile-stop':await current.mobileStop();return current.snapshot();
  case 'mobile-pin':await current.rotatePin();return current.snapshot();
  case 'icon':{
   const result=await dialog.showOpenDialog({title:'Tastenbild auswählen',properties:['openFile'],filters:[{name:'Bilder',extensions:['png','jpg','jpeg','webp','gif','svg']}]});if(result.canceled)return null;return require('./services/touch-images.cjs').thumbnail(result.filePaths[0]);
  }
  case 'export':{
   const result=await dialog.showSaveDialog({title:'Touch-Deck sichern',defaultPath:'Batto-Touch-Deck.json',filters:[{name:'Touch-Deck',extensions:['json']}]});if(result.canceled)return {ok:false,canceled:true};
   const {version,activeProfile,profiles}=current.snapshot();fs.writeFileSync(result.filePath,JSON.stringify({version,activeProfile,profiles},null,2));return {ok:true};
  }
  case 'import':{
   const result=await dialog.showOpenDialog({title:'Batto Touch-Deck laden',properties:['openFile'],filters:[{name:'Touch-Deck',extensions:['json']}]});if(result.canceled)return {canceled:true};
   const filename=result.filePaths[0];if(fs.statSync(filename).size>4*1024*1024)throw Error('Die Deck-Datei ist zu groß (höchstens 4 MB).');
   const destination=path.join(current.directory,'touch-deck.before-import.json'),{version,activeProfile,profiles}=current.snapshot(),next=JSON.parse(fs.readFileSync(filename,'utf8'));
   fs.writeFileSync(destination,JSON.stringify({version,activeProfile,profiles}));return current.save(next);
  }
  default:throw Error('Unbekannte Touch-Deck-Aktion.');
 }
});
let closePromise;
function close(){if(closePromise)return closePromise;closing=true;clearTimeout(visualTimer);closePromise=(async()=>{await deck?.close();await demand?.close();await host?.close();})();return closePromise;}
app.on('before-quit',()=>{void close();});
module.exports={getDeck,getExistingDeck:()=>deck,getDetachedWindow:windows.existing,close,...(process.env.BATTO_TEST_INSTANCE==='1'?{getPackages,getHost}:{} )};
