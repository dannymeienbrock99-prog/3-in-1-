'use strict';
const {BrowserWindow}=require('electron'),path=require('node:path');
// Small, on-demand playback surface. Never loads the dashboard or external pages.
class AudioPlayer{
 constructor(){this.window=null;this.pending=null;this.waiting=0;}
 async ensure(){this.waiting++;clearTimeout(this.idleTimer);try{return await this.open();}finally{this.waiting--;}}
 open(){if(this.pending)return this.pending;if(this.window&&!this.window.isDestroyed())return Promise.resolve();
  const win=this.window=new BrowserWindow({width:1,height:1,show:false,skipTaskbar:true,webPreferences:{preload:path.join(__dirname,'audio-player-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  this.pending=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;this.readyTimer=setTimeout(()=>{reject(Error('Tonausgabe startet nicht.'));this.dispose();},10000);});
  win.once('closed',()=>{if(this.window===win){clearTimeout(this.readyTimer);this.reject?.(Error('Tonausgabe geschlossen.'));this.window=null;this.pending=null;this.resolve=this.reject=null;}});
  win.loadFile(path.join(__dirname,'../src/renderer/audio-player.html')).catch(error=>{this.reject?.(error);this.dispose();});return this.pending;
 }
 ready(sender){if(sender!==this.window?.webContents)return;clearTimeout(this.readyTimer);this.resolve?.();this.resolve=this.reject=null;this.pending=null;}
 players(){return this.window&&!this.window.isDestroyed()?[this.window.webContents]:[];}
 idle(){clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>{if(!this.waiting)this.dispose();},5000);this.idleTimer.unref();}
 dispose(){clearTimeout(this.idleTimer);clearTimeout(this.readyTimer);this.window?.destroy();}
}
module.exports={AudioPlayer};
