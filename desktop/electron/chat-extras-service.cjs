'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {giftId:normalizeGiftId}=require('../src/core/gifts/gift-registry.cjs');
const LIVE_CENTER_URL='https://livecenter.tiktok.com/?enterFrom=profile_hover&lang=de-DE&source=ls_end';
function createChatExtrasService({getConfig,saveConfig,send,dialog,shell,BrowserWindow,getParent,assetsDir,giftRegistry,allowCatalogFetch=true}){
 let liveWindow=null,catalogAttempted=false;
 async function library(payload={}){
  if(giftRegistry&&allowCatalogFetch&&(payload.refreshCatalog||(!catalogAttempted&&!giftRegistry.list().total))){catalogAttempted=true;try{await giftRegistry.refreshCatalog();}catch{}}
  const selected=String(payload.folderPath??getConfig().chatExtras?.wishlist?.folderPath??'');
  const dir=path.resolve(selected||path.join(assetsDir,'gifts'));
  try{
   const entries=await fs.readdir(dir,{withFileTypes:true});
   const pngs=entries.filter(e=>e.isFile()&&/\.png$/i.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).slice(0,3000);
   const items=pngs.map(e=>({key:'file:'+e.name,fileName:e.name,name:e.name.replace(/\.png$/i,'').replace(/^\d+[_ -]*/,'').replace(/_/g,' '),url:pathToFileURL(path.join(dir,e.name)).href,missing:false,giftId:null,coins:null}));
   const catalog=giftRegistry?.list({limit:3000});
   return{ok:true,folderPath:selected,items:giftRegistry?.matchLibrary(items)||items,catalog:catalog?.items||[],catalogStatus:catalog?.status||{}};
  }catch(error){return{ok:false,error:'Geschenkeordner nicht lesbar: '+error.message,folderPath:selected,items:[]};}
 }
 async function chooseFolder(){const picked=await dialog.showOpenDialog(getParent(),{title:'Ordner mit Geschenke-PNGs auswählen',properties:['openDirectory']});if(picked.canceled||!picked.filePaths?.[0])return{ok:false,canceled:true};const result=await library({folderPath:picked.filePaths[0]});if(result.ok)await saveConfig({chatExtras:{wishlist:{folderPath:result.folderPath}}});return result;}
 function resolveItems(payload={}){
  if(!Array.isArray(payload.items)||payload.items.length>797)throw new Error('Ungültige Geschenkeauswahl.');
  const items=payload.items.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Ungültiger Geschenk-Eintrag.');const empty=item.giftId===null||item.giftId===undefined||typeof item.giftId==='string'&&!item.giftId.trim();const id=empty?'':normalizeGiftId(item.giftId);if(!empty&&!id)throw new Error('Eine Geschenk-ID enthält nur positive ganze Ziffern. Das Feld kann für die Anzeige leer bleiben.');return{...item,giftId:id,giftIdVerified:false,coins:null,verificationSource:''};});
  return{ok:true,items:giftRegistry?.matchLibrary(items)||items};
 }
 function observe(event){
  // Learning gift metadata must never interrupt chat or the actual gift action.
  try{
   if(!giftRegistry?.observe(event))return false;
   try{send('gifts:catalog-changed',{});}catch{}
   const before=getConfig().chatExtras?.wishlist?.items||[];
   const after=resolveItems({items:before}).items;
   if(JSON.stringify(before)!==JSON.stringify(after))Promise.resolve(saveConfig({chatExtras:{wishlist:{items:after}}})).catch(()=>{});
   return true;
  }catch{return false;}
 }
 function trigger(payload={}){
  const kind=payload.kind==='wishlist'?'wishlist':'widget',cfg=getConfig().chatExtras||{};
  const id=String(payload.widgetId||payload.id||'');
  const definition=kind==='wishlist'?cfg.wishlist:(cfg.widgets||[]).find(w=>w.id===id);
  if(!definition)throw new Error('Die gewählte Chat-Einblendung existiert nicht.');
  if(definition.enabled===false&&payload.preview!==true)throw new Error('Die gewählte Chat-Einblendung ist deaktiviert.');
  if(kind==='wishlist'&&!(definition.items||[]).some(item=>item&&item.enabled!==false))throw new Error('Zuerst mindestens ein Wunschgeschenk auswählen und aktivieren.');
  if(kind==='widget'){
   let valid=false;try{const url=new URL(definition.url);valid=url.protocol==='https:'&&!url.username&&!url.password;}catch{}
   if(!valid)throw new Error('Für dieses Widget fehlt eine gültige HTTPS-Adresse.');
  }
  const override=Number(payload.durationMs),durationMs=Number.isFinite(override)&&override>0
   ? Math.max(250,Math.min(120000,override))
   : definition.permanent ? 0 : Math.max(250,Math.min(120000,Number(definition.durationMs)||8000));
  const event={kind,id,widgetId:id,visible:payload.visible!==false,durationMs:payload.preview===true?(durationMs||8000):durationMs,triggerId:crypto.randomUUID(),timestamp:Date.now(),...(payload.preview===true?{preview:true,definition:{...definition,enabled:true,permanent:false}}:{})};
  send('chat-widgets:trigger',event);return{ok:true,mode:'local-widget',triggerId:event.triggerId};
 }
 async function external(raw){const url=new URL(String(raw||''));if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Nur Web-Adressen ohne eingebettete Zugangsdaten öffnen.');await shell.openExternal(url.href);return{ok:true};}
 async function openLiveCenter(){
  if(liveWindow&&!liveWindow.isDestroyed()){liveWindow.show();liveWindow.focus();return{ok:true};}
  liveWindow=new BrowserWindow({width:1280,height:900,minWidth:800,minHeight:600,title:'TikTok LIVE Center – Batto',autoHideMenuBar:true,backgroundColor:'#111111',webPreferences:{partition:'persist:batto-tiktok-livecenter',contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  const win=liveWindow;
  win.webContents.setWindowOpenHandler(({url})=>{try{const parsed=new URL(url);if(parsed.protocol==='https:')shell.openExternal(parsed.href).catch(()=>{});}catch{}return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{try{const u=new URL(url);if(u.protocol!=='https:'){event.preventDefault();return;}if(!(u.hostname==='tiktok.com'||u.hostname.endsWith('.tiktok.com'))){event.preventDefault();shell.openExternal(u.href).catch(()=>{});}}catch{event.preventDefault();}});
  win.on('closed',()=>{if(liveWindow===win)liveWindow=null;});
  try{await win.loadURL(LIVE_CENTER_URL);return{ok:true};}catch{return{ok:false,error:'TikTok LIVE Center konnte nicht geladen werden. Du kannst den Link im Browser öffnen.'};}
 }
 function registerIpc(ipc){const wrap=fn=>async(_e,p)=>{try{return await fn(p);}catch(e){return{ok:false,error:e.message};}};ipc.handle('gifts:library',wrap(library));ipc.handle('gifts:resolve',wrap(resolveItems));ipc.handle('gifts:catalog',wrap(p=>giftRegistry?.list(p)||{ok:true,items:[],total:0}));ipc.handle('gifts:folder',wrap(chooseFolder));ipc.handle('chat-widgets:test',wrap(trigger));ipc.handle('external:open',wrap(external));ipc.handle('livecenter:open',wrap(openLiveCenter));}
 return{library,trigger,resolveItems,observe,registerIpc,close(){giftRegistry?.close();liveWindow?.close();}};
}
module.exports={createChatExtrasService,LIVE_CENTER_URL};
