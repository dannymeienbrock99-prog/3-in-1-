'use strict';
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url'),{createHash}=require('node:crypto');
const {BrowserWindow,screen,shell}=require('electron');
let detached,opening,options={},preferences={};
function initialize(value){options=value;preferences={};try{const stored=JSON.parse(fs.readFileSync(path.join(options.directory,'touch-window.json'),'utf8'));if(stored&&typeof stored==='object'&&!Array.isArray(stored))preferences=stored;}catch{}}
function existing(){return detached&&!detached.isDestroyed()?detached:null;}
function status(){return {detached:!!existing(),alwaysOnTop:!!existing()?.isAlwaysOnTop()};}
function remember(){if(!existing())return;preferences={bounds:detached.getNormalBounds(),alwaysOnTop:detached.isAlwaysOnTop()};try{fs.mkdirSync(options.directory,{recursive:true});fs.writeFileSync(path.join(options.directory,'touch-window.json'),JSON.stringify(preferences));}catch{}}
async function showMain(){const host=require('../electron/main21.cjs').getSuiteHost();await host.show();await host.navigate('touchdeck');}
async function open(){
 if(opening){await opening;if(existing()){detached.restore();detached.show();detached.focus();}return;}
 if(existing()){detached.restore();detached.show();detached.focus();return;}
 const b=preferences.bounds&&typeof preferences.bounds==='object'?preferences.bounds:{};
 const display=Number.isFinite(b.x)&&Number.isFinite(b.y)&&screen.getAllDisplays().find(d=>b.x>=d.workArea.x&&b.y>=d.workArea.y&&b.x<d.workArea.x+d.workArea.width&&b.y<d.workArea.y+d.workArea.height);
 const area=(display||screen.getPrimaryDisplay()).workArea;
 const width=Math.min(area.width,Math.max(420,Number.isFinite(b.width)?Math.round(b.width):1000)),height=Math.min(area.height,Math.max(360,Number.isFinite(b.height)?Math.round(b.height):650));
 const position=display?{x:Math.round(Math.max(area.x,Math.min(b.x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(b.y,area.y+area.height-height)))}:{};
 const win=new BrowserWindow({width,height,minWidth:Math.min(420,area.width),minHeight:Math.min(360,area.height),...position,title:'Batto Touch Deck',backgroundColor:'#151411',autoHideMenuBar:true,show:false,alwaysOnTop:preferences.alwaysOnTop===true,icon:path.join(__dirname,'assets/icon.png'),webPreferences:{preload:path.join(__dirname,'../electron/touch-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});detached=win;
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
 win.on('close',remember);win.on('closed',()=>{if(detached===win)detached=null;options.changed?.();});
 opening=(async()=>{try{await win.loadFile(path.join(__dirname,'renderer/touch-window.html'));if(!win.isDestroyed()){win.show();options.changed?.();}}catch(error){if(!win.isDestroyed())win.destroy();throw error;}})();
 try{await opening;}finally{opening=null;}
}
async function attach(){await showMain();existing()?.close();}
function alwaysOnTop(value){if(typeof value!=='boolean')throw Error('Ungültige Fenstereinstellung.');if(!existing())throw Error('Bitte zuerst das Touch Deck entkoppeln.');detached.setAlwaysOnTop(value);remember();options.changed?.();}
async function launchHtml({file,kind,port,uuid,registerEvent,info,actionInfo,pluginDirectory,onClose}){
 const inspector=kind==='inspector',root=fs.realpathSync(pluginDirectory);
 const inside=filePath=>{const relative=path.relative(root,fs.realpathSync(filePath));return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
 if(!inside(file)||!fs.statSync(file).isFile())throw Error('Plugin-Fenster liegt außerhalb des Pakets.');
 const win=new BrowserWindow({width:540,height:740,minWidth:360,minHeight:350,title:inspector?'Plugin-Einstellungen':'Touch-Deck-Plugin',show:false,autoHideMenuBar:true,backgroundColor:inspector?'#ffffff':'#202020',webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,partition:'touch-plugin-'+createHash('sha256').update(root.toLowerCase()).digest('hex')}});
 win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 win.webContents.session.setPermissionCheckHandler(()=>false);
 win.webContents.on('will-attach-webview',event=>event.preventDefault());
 win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))void shell.openExternal(url).catch(()=>{});return {action:'deny'};});
 win.webContents.on('will-navigate',(event,url)=>{try{if(!inside(fileURLToPath(url)))event.preventDefault();}catch{event.preventDefault();}});
 win.on('closed',()=>onClose?.());
 try{
  await win.loadFile(file);
  const args=[String(port),uuid,registerEvent,JSON.stringify(info||{}),...(actionInfo?[JSON.stringify(actionInfo)]:[])];
  const started=await win.webContents.executeJavaScript(`(()=>{if(typeof connectElgatoStreamDeckSocket!=='function')return {ok:false,error:'Das Plugin stellt keinen Stream-Deck-Anschluss bereit.'};try{connectElgatoStreamDeckSocket(...${JSON.stringify(args)});return {ok:true};}catch(error){return {ok:false,error:String(error?.message||error).slice(0,500)};}})()`);
  if(!started?.ok)throw Error(started?.error||'Das Plugin konnte nicht gestartet werden.');
  if(inspector)win.show();return {close:()=>{if(!win.isDestroyed())win.destroy();}};
 }catch(error){win.destroy();throw error;}
}
module.exports={initialize,existing,status,open,attach,alwaysOnTop,showMain,launchHtml};
