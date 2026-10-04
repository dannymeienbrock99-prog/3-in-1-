'use strict';
const {BrowserWindow,ipcMain}=require('electron');
const path=require('path'),crypto=require('crypto');
const failure=message=>{const error=new Error(message);error.retryable=false;return error;};
const DEFAULT_URL='https://dashboard.twitch.tv/popout/u/crazy_batto/stream-manager/chat?uuid=2b809876919445b3ac2c8911f881016b';
function canonicalLogin(value){return typeof value==='string'&&/^[a-z0-9_]{1,25}$/i.test(value)?value.toLowerCase():'';}
function channelFromUrl(value){
  try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return '';const m=u.hostname==='dashboard.twitch.tv'?u.pathname.match(/^\/popout\/u\/([a-zA-Z0-9_]+)\/stream-manager\/chat\/?$/):u.hostname==='www.twitch.tv'?u.pathname.match(/^\/popout\/([a-zA-Z0-9_]+)\/chat\/?$/):null;return m?canonicalLogin(m[1]):'';}catch{return '';}
}
class TwitchPopout {
  constructor({getConfig,getParent,onMessage,onStatus}){
    Object.assign(this,{getConfig,getParent,onMessage,onStatus});this.seen=new Set();this.pending=new Map();this.echoes=[];this.status={name:'twitch',state:'idle',connected:false,readOnly:false,capabilities:{readChat:true,sendChat:false,events:false}};
    this.listen=(channel,fn)=>ipcMain.on(channel,(event,payload)=>{if(!this.closing&&event.sender===this.window?.webContents&&event.senderFrame===this.window.webContents.mainFrame){let u;try{u=new URL(event.senderFrame.url);}catch{return;}if(['dashboard.twitch.tv','www.twitch.tv'].includes(u.hostname))fn(payload);}});
    this.listen('twitch-popout:status',p=>this.setStatus({...p,capabilities:{readChat:true,sendChat:!!p.connected,events:false}}));
    this.listen('twitch-popout:sent',p=>{const q=this.pending.get(p.id);if(!q)return;if(!p.ok){clearTimeout(q.timer);this.pending.delete(p.id);this.forgetEcho(p.id);q.reject(failure(p.error));}else if(p.phase==='compose'&&!q.composing){q.composing=true;this.window.webContents.insertText(q.text).then(()=>{if(this.pending.has(p.id))this.window?.webContents.send('twitch-popout:submit',{id:p.id});}).catch(error=>{clearTimeout(q.timer);this.pending.delete(p.id);this.forgetEcho(p.id);error.retryable=false;q.reject(error);});}});
    this.listen('twitch-popout:message',p=>{
      if(!p||typeof p.id!=='string'||!p.id||p.id.length>512||typeof p.message!=='string'||p.message.length>10000||this.seen.has(p.id))return;
      this.seen.add(p.id);if(this.seen.size>20000)this.seen.delete(this.seen.values().next().value);
      const channel=channelFromUrl(this.window?.webContents.getURL());
      const login=canonicalLogin(p.canonicalLogin),cfg=this.getConfig();
      const sender=canonicalLogin(cfg.senderUsername)||canonicalLogin(cfg.channel)||channel;
      const own=!!login&&login===sender;
      const echo=own?this.echoes.find(x=>x.text===p.message&&x.until>Date.now()):null;
      if(echo)this.forgetEcho(echo.id);
      if(echo){const q=this.pending.get(echo.id);if(q){clearTimeout(q.timer);this.pending.delete(echo.id);q.resolve({ok:true,mode:'twitch-popout',messageId:p.id,confirmed:true});}}
      // DOM login/badges are enough to select narration, never to authorize a
      // moderation action or claim a verified numeric platform identity.
      const narration=channel&&login?(login===channel?{role:'owner',method:'channel-login'}:echo?.source==='manual'?{role:'self',method:'manual-echo'}:p.moderatorBadge===true?{role:'moderator',method:'badge'}:null):null;
      const evidence=narration?{...narration,transport:'twitch-popout',canonicalLogin:login,channel,messageId:p.id}:null;
      const message={...p,username:login||p.username,platform:'twitch',channel,channelId:channel?'login:'+channel:'',identityVerified:false,moderator:false,isModerator:false,isBroadcaster:false,badges:[],raw:{...p,channel,source:echo?.source,narration:evidence}};
      this.onMessage(message,echo?.source||'twitch-popout');
    });
  }
  getStatus(){return {...this.status,url:this.getConfig().popoutUrl||DEFAULT_URL};}
  setStatus(p){this.status={...this.status,...p};this.onStatus?.(this.getStatus());}
  updateConfig(){this.setStatus({});}
  healthCheck(){return Promise.resolve({ok:this.status.connected,status:this.getStatus()});}
  async connect(){
    if(this.closing)await this.closing;
    if(this.window&&!this.window.isDestroyed()){this.window.show();return {ok:true,status:this.getStatus()};}
    const url=this.getConfig().popoutUrl||DEFAULT_URL,u=new URL(url);
    if(u.protocol!=='https:'||u.hostname!=='dashboard.twitch.tv'||!/^\/popout\/u\/[^/]+\/stream-manager\/chat/.test(u.pathname))throw new Error('Gültigen Twitch-Dashboard-Popout verwenden.');
    this.setStatus({state:'loading',connected:false,error:null});
    const window=this.window=new BrowserWindow({parent:this.getParent(),title:'Batto – Twitch Popout',width:520,height:780,webPreferences:{partition:'persist:batto-twitch-popout',preload:path.join(__dirname,'twitch-popout-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    this.window.webContents.on('will-navigate',(event,next)=>{try{const n=new URL(next);if(n.protocol!=='https:'||!(n.hostname==='twitch.tv'||n.hostname.endsWith('.twitch.tv')))event.preventDefault();}catch{event.preventDefault();}});
    this.window.webContents.on('did-fail-load',(_e,code,description,_url,isMain)=>{if(this.window===window&&!this.closing&&isMain)this.setStatus({state:'error',connected:false,error:`Twitch-Seite: ${description} (${code})`});});
    this.window.on('closed',()=>{if(this.window!==window)return;this.window=null;this.setStatus({state:'stopped',connected:false,error:null});this.rejectPending();});
    await this.window.loadURL(url);return {ok:true,status:this.getStatus()};
  }
  forgetEcho(id){this.echoes=this.echoes.filter(entry=>entry.id!==id);}
  sendChat(text,{source='manual'}={}){
    text=String(text||'').trim();if(!text||text.length>500)return Promise.reject(failure('Nachricht muss 1 bis 500 Zeichen haben.'));
    this.echoes=this.echoes.filter(entry=>entry.until>Date.now());
    if(this.echoes.some(entry=>entry.ambiguous&&entry.text===text))return Promise.reject(failure('Der vorige Twitch-Versand dieses Textes ist noch ungeklärt. Den Popout prüfen und auf die Bestätigung warten; es wird nicht erneut gesendet.'));
    if(this.closing||!this.window||this.window.isDestroyed())return Promise.reject(new Error('Twitch-Popout öffnen und anmelden.'));
    if(this.pending.size)return Promise.reject(new Error('Ein Twitch-Sendeversuch läuft bereits. Bitte dessen Ergebnis abwarten.'));
    // Twitch defers rendering new chat rows while its document is minimized.
    // Restore without taking keyboard focus so the delivery echo can be observed.
    if(this.window.isMinimized()){this.window.restore();this.window.showInactive();}
    const id=crypto.randomUUID();this.echoes=this.echoes.filter(x=>x.until>Date.now());this.echoes.push({id,text,source,until:Date.now()+120000});
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);const entry=this.echoes.find(x=>x.id===id);if(entry)entry.ambiguous=true;reject(failure('Twitch-Nachricht wurde nicht bestätigt. Popout prüfen; nicht automatisch erneut senden.'));},10000);this.pending.set(id,{resolve,reject,timer,text});this.window.webContents.send('twitch-popout:send',{id,text});});
  }
  rejectPending(){for(const [id,p] of this.pending){clearTimeout(p.timer);const entry=this.echoes.find(x=>x.id===id);if(entry&&p.composing)entry.ambiguous=true;else this.forgetEcho(id);p.reject(failure('Twitch-Popout geschlossen; Versandstatus nicht bestätigt.'));}this.pending.clear();}
  async disconnect(){
    if(this.closing)return this.closing;
    const window=this.window;this.rejectPending();
    if(!window||window.isDestroyed()){this.window=null;this.setStatus({state:'stopped',connected:false,error:null});return {ok:true};}
    const stopped=new Promise((resolve,reject)=>{
      let finished=false,timer;
      const complete=error=>{if(finished)return;finished=true;clearTimeout(timer);window.removeListener('closed',closed);if(error)reject(error);else resolve({ok:true});};
      const closed=()=>complete();
      window.once('closed',closed);
      timer=setTimeout(()=>complete(new Error('Das Twitch-Fenster wurde nicht geschlossen. Bitte das Fenster prüfen und erneut trennen.')),5000);
      try{window.close();}catch(error){complete(error);}
    });
    this.closing=stopped;
    try{return await stopped;}finally{if(this.closing===stopped)this.closing=null;}
  }
}
module.exports={TwitchPopout,DEFAULT_URL,channelFromUrl};
