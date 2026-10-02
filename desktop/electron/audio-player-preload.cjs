'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('batto',{
 audioReady:()=>ipcRenderer.send('audio:ready'),
 audioResult:value=>ipcRenderer.send('audio:result',value),
 onAudioPlay:fn=>ipcRenderer.on('audio:play',(_event,value)=>fn(value)),
 onAudioCancel:fn=>ipcRenderer.on('audio:cancel',(_event,value)=>fn(value))
});
