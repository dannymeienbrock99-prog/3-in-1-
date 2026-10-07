'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const sourcePath=path.resolve(__dirname,'../src/widget-bootstrap.cjs');
function fixture({ready=true}={}){
 const handlers=new Map(),calls=[],sent=[],windows=[];
 let service,created=0;
 class WidgetWindows{
  constructor(options){this.options=options;service=this;created++;this.count=0;}
  status(){calls.push(['status']);return {ok:true,slots:[],windows:[]};}
  saveSlot(value){calls.push(['save-slot',value]);return this.status();}
  open(value){calls.push(['open',value]);return this.status();}
  selectSlot(value){calls.push(['select',value]);return this.status();}
  close(id){calls.push(['close',id]);return this.status();}
  reload(id){calls.push(['reload',id]);return this.status();}
  setAlwaysOnTop(value){calls.push(['always-on-top',value]);return this.status();}
  getOpenCount(){return this.count;}
  closeAll(){calls.push(['close-all']);return this.status();}
  toolbarWindowId(sender,frame){return sender===toolbar.sender&&frame===sender.mainFrame?'widget-1':null;}
 }
 function surface(url){const sender={mainFrame:{url},isDestroyed:()=>false,send:(channel,state)=>sent.push({sender,channel,state})};return {sender,senderFrame:sender.mainFrame};}
 const main=surface(pathToFileURL(path.resolve(__dirname,'../src/renderer/index.html')).href);
 const toolbar=surface(pathToFileURL(path.resolve(__dirname,'../src/renderer/widget-window.html')).href);
 const remote=surface('https://example.org/widget');
 for(const event of [main,toolbar,remote])windows.push({isDestroyed:()=>false,webContents:event.sender});
 const electron={app:{isReady:()=>ready,getPath:()=>'/unused'},ipcMain:{handle:(name,action)=>handlers.set(name,action)},BrowserWindow:{getAllWindows:()=>windows}};
 const sandbox={module:{exports:{}},__dirname:path.dirname(sourcePath),process:{env:{BATTO_SUITE_DATA:'fixture-only'}},require:name=>name==='electron'?electron:name==='../electron/widget-windows.cjs'?{WidgetWindows}:require(name)};
 vm.runInNewContext(fs.readFileSync(sourcePath,'utf8'),sandbox,{filename:sourcePath});
 const invoke=(channel,event,value)=>handlers.get(channel)(event,value);
 return {main,toolbar,remote,handlers,calls,sent,invoke,get service(){return service;},get created(){return created;},api:sandbox.module.exports};
}
const normalized=value=>JSON.parse(JSON.stringify(value));
test('bootstrap remains passive; lifecycle count and close do not instantiate or open a remote page',()=>{
 const f=fixture();assert.equal(f.created,0);assert.equal(f.api.getOpenCount(),0);assert.equal(f.api.close(),undefined);assert.equal(f.created,0);assert.deepEqual(f.calls,[]);
});
test('all main commands reject remote documents and iframes before creating the manager',async()=>{
 const f=fixture();const subframe={sender:f.main.sender,senderFrame:{url:f.main.senderFrame.url}};
 for(const channel of [...f.handlers.keys()].filter(name=>name.startsWith('widget-windows:'))){
  for(const event of [f.remote,subframe])await assert.rejects(f.invoke(channel,event,{id:'widget-1'}),/keine Batto-Fenster/);
 }
 assert.equal(f.created,0);assert.deepEqual(f.calls,[]);
});
test('trusted main renderer uses one lazily created manager and preserves explicit identifiers',async()=>{
 const f=fixture();await f.invoke('widget-windows:status',f.main);
 const data={id:'slot-1',name:'My widget',url:'https://example.org'};
 await f.invoke('widget-windows:save-slot',f.main,data);
 await f.invoke('widget-windows:open',f.main,{id:'widget-2',slotId:'slot-1'});
 await f.invoke('widget-windows:select',f.main,{id:'widget-2',slotId:'slot-3'});
 await f.invoke('widget-windows:reload',f.main,{id:'widget-2'});
 await f.invoke('widget-windows:close',f.main,{id:'widget-2'});
 await f.invoke('widget-windows:always-on-top',f.main,{id:'widget-2',value:true});
 assert.equal(f.created,1);assert.equal(f.service.options.directory,'fixture-only');
 assert.deepEqual(normalized(f.calls.filter(call=>call[0]!=='status')),[['save-slot',data],['open',{id:'widget-2',slotId:'slot-1'}],['select',{id:'widget-2',slotId:'slot-3'}],['reload','widget-2'],['close','widget-2'],['always-on-top',{id:'widget-2',value:true}]]);
});
test('toolbar commands derive the window from trusted sender rather than a spoofed payload id',async()=>{
 const f=fixture();const status=await f.invoke('widget-toolbar:status',f.toolbar);assert.equal(status.windowId,'widget-1');
 await f.invoke('widget-toolbar:select',f.toolbar,{id:'widget-2',slotId:'slot-4'});
 await f.invoke('widget-toolbar:reload',f.toolbar,{id:'widget-2'});
 await f.invoke('widget-toolbar:always-on-top',f.toolbar,{id:'widget-2',value:true});
 await f.invoke('widget-toolbar:close',f.toolbar,{id:'widget-2'});
 assert.deepEqual(normalized(f.calls.filter(call=>call[0]!=='status')),[['select',{id:'widget-1',slotId:'slot-4'}],['reload','widget-1'],['always-on-top',{id:'widget-1',value:true}],['close','widget-1']]);
});
test('no remote view, main page, or toolbar subframe can invoke the restricted toolbar API',async()=>{
 const f=fixture();const subframe={sender:f.toolbar.sender,senderFrame:{url:f.toolbar.senderFrame.url}};
 for(const channel of [...f.handlers.keys()].filter(name=>name.startsWith('widget-toolbar:'))){
  for(const event of [f.remote,f.main,subframe])await assert.rejects(f.invoke(channel,event,{id:'widget-1'}),/keine Widgets/);
 }
 assert.deepEqual(f.calls,[]);
});
test('status broadcasts reach only the local main renderer; toolbar gets its own manager event with identity',async()=>{
 const f=fixture();await f.invoke('widget-windows:status',f.main);const state={ok:true,slots:[],windows:[]};f.service.options.onChange(state);
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].sender,f.main.sender);assert.equal(f.sent[0].channel,'widget-windows:update');assert.equal(f.sent[0].state,state);
});
test('early readiness failures and service errors propagate without claiming a successful change',async()=>{
 const early=fixture({ready:false});await assert.rejects(early.invoke('widget-windows:status',early.main),/starten noch/);assert.equal(early.created,0);
 const f=fixture();await f.invoke('widget-windows:status',f.main);f.service.saveSlot=()=>{throw Error('Disk unavailable');};await assert.rejects(f.invoke('widget-windows:save-slot',f.main,{}),/Disk unavailable/);
});
test('open-count and orderly shutdown query only the existing widget manager',async()=>{
 const f=fixture();await f.invoke('widget-windows:status',f.main);f.service.count=2;assert.equal(f.api.getOpenCount(),2);f.api.close();assert.equal(f.calls.filter(call=>call[0]==='close-all').length,1);
});
