'use strict';
const path=require('node:path'),{fileURLToPath}=require('node:url');
const electron=require('electron');
const {app,ipcMain,BrowserWindow}=electron;
let manager;
const renderer=path.join(__dirname,'renderer');
function localIndex(event){
 try{return event.senderFrame===event.sender.mainFrame&&path.resolve(fileURLToPath(event.senderFrame.url))===path.resolve(renderer,'index.html');}
 catch{return false;}
}
function changed(state){
 for(const win of BrowserWindow.getAllWindows()){
  if(win.isDestroyed()||win.webContents.isDestroyed())continue;
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  if(localIndex(event))
   try{win.webContents.send('widget-windows:update',state);}catch{}
 }
}
function getManager(){
 if(!app.isReady())throw Error('Die Widget-Fenster starten noch.');
 if(!manager){
  const {WidgetWindows}=require('../electron/widget-windows.cjs');
  const directory=process.env.BATTO_SUITE_DATA||path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'CrazyBatto','BattoSuite');
  manager=new WidgetWindows({directory,electron,onChange:changed,uiFile:path.join(renderer,'widget-window.html'),preloadFile:path.resolve(__dirname,'../electron/widget-window-preload.cjs')});
 }
 return manager;
}
function mainHandle(command,action){ipcMain.handle('widget-windows:'+command,async(event,value)=>{
 if(!localIndex(event))throw Error('Diese Webseite darf keine Batto-Fenster bedienen.');
 return action(getManager(),value,event);
});}
mainHandle('status',service=>service.status());
mainHandle('save-slot',(service,value)=>service.saveSlot(value));
mainHandle('open',(service,value)=>service.open(value));
mainHandle('select',(service,value)=>service.selectSlot(value));
mainHandle('close',(service,value)=>service.close(value?.id));
mainHandle('reload',(service,value)=>service.reload(value?.id));
mainHandle('always-on-top',(service,value)=>service.setAlwaysOnTop(value));
mainHandle('choose-background',(service,value,event)=>service.chooseBackground(value,BrowserWindow.fromWebContents(event.sender)));
mainHandle('set-background',(service,value)=>service.setBackground(value));
mainHandle('clear-background',(service,value)=>service.clearBackground(value));
function toolbarHandle(command,action){ipcMain.handle('widget-toolbar:'+command,async(event,value)=>{
 const service=getManager(),id=service.toolbarWindowId(event.sender,event.senderFrame);
 if(!id)throw Error('Dieses Fenster darf keine Widgets bedienen.');
 return action(service,id,value);
});}
toolbarHandle('status',(service,id)=>({...service.status(),windowId:id}));
toolbarHandle('select',(service,id,value)=>service.selectSlot({id,slotId:value?.slotId}));
toolbarHandle('reload',(service,id)=>service.reload(id));
toolbarHandle('close',(service,id)=>service.close(id));
toolbarHandle('always-on-top',(service,id,value)=>service.setAlwaysOnTop({id,value:value?.value}));
module.exports={getOpenCount:()=>manager?.getOpenCount()||0,close:()=>manager?.closeAll(),_testing:{localIndex}};
