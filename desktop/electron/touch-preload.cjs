'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const on=(channel,cb)=>{const listener=(_event,value)=>cb(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);};
const commands=['state','catalog','save','press','detach','attach','edit-main','always-on-top','presence'];
contextBridge.exposeInMainWorld('batto',{
 touch:(command,value)=>{if(!commands.includes(command))throw Error('Bitte diese Einstellung im Hauptfenster öffnen.');return ipcRenderer.invoke('touch:action',{command,value});},
 onTouchState:cb=>on('touch:state',cb),onTouchPresentation:cb=>on('touch:presentation',cb)
});
