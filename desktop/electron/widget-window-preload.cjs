'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const invoke=(command,value)=>ipcRenderer.invoke('widget-toolbar:'+command,value);
contextBridge.exposeInMainWorld('widgetWindow',{
 status:()=>invoke('status'),
 select:value=>invoke('select',value),
 reload:()=>invoke('reload'),
 close:()=>invoke('close'),
 alwaysOnTop:value=>invoke('always-on-top',value),
 onUpdate:callback=>{
  const listener=(_event,state)=>callback(state);
  ipcRenderer.on('widget-windows:update',listener);
  return ()=>ipcRenderer.removeListener('widget-windows:update',listener);
 }
});
