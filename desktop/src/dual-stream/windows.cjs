'use strict';
const fs=require('node:fs'),path=require('node:path'),{BrowserWindow,screen}=require('electron');
let detached,opening,options={},preferences={};
function initialize(value){options=value;try{const saved=JSON.parse(fs.readFileSync(path.join(options.directory,'dual-window.json'),'utf8'));if(saved&&typeof saved==='object'&&!Array.isArray(saved))preferences=saved;}catch{}}
function existing(){return detached&&!detached.isDestroyed()?detached:null;}
function status(){return {detached:!!existing(),alwaysOnTop:!!existing()?.isAlwaysOnTop()};}
function remember(){if(!existing())return;preferences={bounds:detached.getNormalBounds(),alwaysOnTop:detached.isAlwaysOnTop()};try{fs.mkdirSync(options.directory,{recursive:true});fs.writeFileSync(path.join(options.directory,'dual-window.json'),JSON.stringify(preferences));}catch{}}
async function open(){
 if(opening)await opening;
 if(existing()){if(detached.isMinimized())detached.restore();detached.show();detached.focus();return;}
 const b=preferences.bounds||{},display=Number.isFinite(b.x)&&Number.isFinite(b.y)&&screen.getAllDisplays().find(d=>b.x>=d.workArea.x&&b.y>=d.workArea.y&&b.x<d.workArea.x+d.workArea.width&&b.y<d.workArea.y+d.workArea.height),area=(display||screen.getPrimaryDisplay()).workArea;
 const width=Math.min(area.width,Math.max(540,Number.isFinite(b.width)?Math.round(b.width):1120)),height=Math.min(area.height,Math.max(500,Number.isFinite(b.height)?Math.round(b.height):850));
 const position=display?{x:Math.round(Math.max(area.x,Math.min(b.x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(b.y,area.y+area.height-height)))}:{};
 const win=new BrowserWindow({width,height,minWidth:Math.min(540,area.width),minHeight:Math.min(500,area.height),...position,title:'Batto Dual Stream',backgroundColor:'#151411',autoHideMenuBar:true,show:false,alwaysOnTop:preferences.alwaysOnTop===true,icon:path.join(__dirname,'../assets/app-icon.png'),webPreferences:{preload:path.join(__dirname,'../../electron/dual-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});detached=win;
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('will-attach-webview',event=>event.preventDefault());
 win.on('close',remember);win.on('closed',()=>{if(detached===win)detached=null;options.changed?.();});
 options.changed?.();
 opening=(async()=>{try{await win.loadFile(path.join(__dirname,'../renderer/dual-window.html'));if(!win.isDestroyed()){win.show();options.changed?.();}}catch(error){if(!win.isDestroyed())win.destroy();throw error;}})();
 try{await opening;}finally{opening=null;}
}
async function attach(){const host=require('../../electron/main21.cjs').getSuiteHost();await host.show();await host.navigate('dualstream');existing()?.close();}
function alwaysOnTop(value){if(typeof value!=='boolean')throw Error('Ungültige Fenstereinstellung.');if(!existing())throw Error('Bitte zuerst Dual Stream entkoppeln.');detached.setAlwaysOnTop(value);remember();options.changed?.();}
function close(){existing()?.close();}
module.exports={initialize,existing,status,open,attach,alwaysOnTop,close};
