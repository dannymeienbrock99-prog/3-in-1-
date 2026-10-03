'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const windows=[],handlers=new Map(),timers=new Map(),messages=[];let serial=0;
 class Window extends EventEmitter{
  constructor(){super();this.destroyed=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.mainFrame={url:'https://dashboard.twitch.tv/popout/u/fixture/stream-manager/chat'};windows.push(this);}
  loadURL(){return Promise.resolve();}isDestroyed(){return this.destroyed;}show(){}close(){this.closeRequested=true;}
  finishClose(){this.destroyed=true;this.emit('closed');}
 }
 const file=path.join(__dirname,'../electron/twitch-popout.cjs');
 const scope={module:{exports:{}},require:name=>name==='electron'?{BrowserWindow:Window,ipcMain:{on:(channel,fn)=>handlers.set(channel,fn)}}:require(name),__dirname:path.dirname(file),URL,Date,
  setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),scope,{filename:file});
 const popout=new scope.module.exports.TwitchPopout({getConfig:()=>({popoutUrl:'https://dashboard.twitch.tv/popout/u/fixture/stream-manager/chat'}),getParent:()=>null,onMessage:message=>messages.push(message)});
 return {popout,windows,timers,handlers,messages};
}
test('reconnecting waits for the old Twitch window to close before creating another',async()=>{
 const {popout,windows,timers}=fixture();await popout.connect();const old=windows[0];let disconnected=false;
 const closing=Promise.resolve(popout.disconnect()).then(()=>{disconnected=true;});
 const reopened=popout.connect();await flush();
 assert.equal(disconnected,false);assert.equal(windows.length,1);
 old.finishClose();await closing;await reopened;
 assert.equal(windows.length,2);assert.equal(popout.window,windows[1]);assert.equal(timers.size,0);
});
test('late load and close callbacks from the old Twitch window cannot overwrite its replacement',async()=>{
 const {popout,windows}=fixture();await popout.connect();const old=windows[0];
 const closing=popout.disconnect();old.finishClose();await closing;await popout.connect();
 popout.setStatus({state:'connected',connected:true,error:null});
 old.webContents.emit('did-fail-load',{},-3,'old cancelled request','',true);old.emit('closed');
 assert.equal(popout.window,windows[1]);assert.equal(popout.status.connected,true);assert.equal(popout.status.error,null);
});
test('Twitch close failures and timeouts are reported without hanging the manager',async()=>{
 const {popout,windows,timers}=fixture();await popout.connect();
 windows[0].close=()=>{throw Error('fixture close failure');};
 await assert.rejects(popout.disconnect(),/fixture close failure/);assert.equal(timers.size,0);
 windows[0].close=()=>{};const closing=popout.disconnect();assert.equal(timers.size,1);
 [...timers.values()][0]();await assert.rejects(closing,/nicht geschlossen/);assert.equal(timers.size,0);
 assert.equal(popout.window,windows[0]);
});
