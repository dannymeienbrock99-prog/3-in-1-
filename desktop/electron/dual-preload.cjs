'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const on=(channel,cb)=>{const listener=(_event,value)=>cb(value);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);};
const commands=['register-cameras','program','scene','background','state','save','probe','prepare','release','start','stop','snapshot','library','import','export','detach','attach','always-on-top','companion','gaming','copy-overlay'];
contextBridge.exposeInMainWorld('batto',{
 dual:(command,value)=>{if(!commands.includes(command))throw Error('Unbekannte Dual-Stream-Aktion.');return ipcRenderer.invoke('dual:action',{command,value});},
 onDualState:cb=>on('dual:state',cb)
});
