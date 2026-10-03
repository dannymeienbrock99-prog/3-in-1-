'use strict';
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
const {app,ipcMain,BrowserWindow,dialog,nativeImage}=require('electron');
let deck;
function getDeck(){
 if(deck)return deck;
 const runtime=require('./suite-bootstrap.cjs').getRuntime();
 if(!runtime)throw Error('Batto startet noch. Bitte kurz warten.');
 const {TouchDeck}=require('./services/touch-deck.cjs');
 deck=new TouchDeck({directory:runtime.directory,controls:runtime.controls,webRoot:path.join(__dirname,'touch-mobile'),getSensors:()=>{
  const fan=runtime.fan.snapshot,rules=runtime.jarvis.settings.sensorRules||{};
  const sensors=(fan?.sensors||[]).map(s=>({id:s.id,name:rules[s.id]?.alias||s.name,value:s.fresh&&Number.isFinite(s.value)?s.value:null,unit:s.unit}));
  for(const tile of fan?.scene?.tiles||[])sensors.push({id:'fan:'+tile.id,name:tile.name+' · Drehzahl',value:tile.speedPercent?.fresh&&Number.isFinite(tile.speedPercent.value)?tile.speedPercent.value:null,unit:'%'});
  return sensors;
 }});
 deck.on('change',state=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&&!win.webContents.isDestroyed())try{win.webContents.send('touch:state',state);}catch{}});
 return deck;
}
ipcMain.handle('touch:action',async(event,{command,value}={})=>{
 let file='';try{file=fileURLToPath(event.senderFrame.url);}catch{}
 if(path.resolve(file)!==path.resolve(__dirname,'renderer/index.html'))throw Error('Diese Bedienoberfläche ist nicht berechtigt.');
 const current=getDeck();
 switch(command){
  case 'state':return value?.sensorsOnly===true?{sensors:current.sensors()}:current.snapshot();
  case 'catalog':return current.catalog();
  case 'save':return current.save(value);
  case 'press':return current.press(value);
  case 'mobile-start':await current.mobileStart();return current.snapshot();
  case 'mobile-stop':await current.mobileStop();return current.snapshot();
  case 'mobile-pin':await current.rotatePin();return current.snapshot();
  case 'icon':{
   const result=await dialog.showOpenDialog({title:'Tastenbild auswählen',properties:['openFile'],filters:[{name:'Bilder',extensions:['png','jpg','jpeg','webp','gif']}]});
   if(result.canceled)return null;
   const imagePath=result.filePaths[0];if(fs.statSync(imagePath).size>10*1024*1024)throw Error('Bitte ein Bild unter 10 MB wählen.');
   const image=nativeImage.createFromPath(imagePath);if(image.isEmpty())throw Error('Das Bild konnte nicht gelesen werden.');
   // Fixed thumbnails keep phone payloads and idle memory bounded. GIFs use a still frame.
   return image.resize({width:144,height:144,quality:'good'}).toDataURL();
  }
  case 'export':{
   const result=await dialog.showSaveDialog({title:'Touch-Deck sichern',defaultPath:'Batto-Touch-Deck.json',filters:[{name:'Touch-Deck',extensions:['json']}]});
   if(result.canceled)return {ok:false,canceled:true};
   const {version,activeProfile,profiles}=current.snapshot();
   fs.writeFileSync(result.filePath,JSON.stringify({version,activeProfile,profiles},null,2));return {ok:true};
  }
  case 'import':{
   const result=await dialog.showOpenDialog({title:'Batto Touch-Deck laden',properties:['openFile'],filters:[{name:'Touch-Deck',extensions:['json']}]});
   if(result.canceled)return {canceled:true};
   const filename=result.filePaths[0];if(fs.statSync(filename).size>4*1024*1024)throw Error('Die Deck-Datei ist zu groß (höchstens 4 MB).');
   // A backup stays outside the imported document and never contains app credentials.
   const destination=path.join(current.directory||require('./suite-bootstrap.cjs').getRuntime().directory,'touch-deck.before-import.json');
   const {version,activeProfile,profiles}=current.snapshot();
   const next=JSON.parse(fs.readFileSync(filename,'utf8'));
   fs.writeFileSync(destination,JSON.stringify({version,activeProfile,profiles}));return current.save(next);
  }
  default:throw Error('Unbekannte Touch-Deck-Aktion.');
 }
});
app.on('before-quit',()=>{void deck?.close();});
module.exports={getDeck,getExistingDeck:()=>deck};
