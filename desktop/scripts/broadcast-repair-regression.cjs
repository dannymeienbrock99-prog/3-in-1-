'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const {BroadcastScheduler}=require('../src/core/broadcast/scheduler.cjs');
const {BroadcastService}=require('../src/core/broadcast/service.cjs');
const {ConfigStore}=require('../src/core/config-store.cjs');
const {createDeckTests}=require('../src/core/deck-tests.cjs');

(async()=>{
 const handlers=new Map(),timers=[];
 const file=path.join(__dirname,'../electron/twitch-popout.cjs');
 const box={module:{exports:{}},require:name=>name==='electron'?{BrowserWindow:class{},ipcMain:{on:(name,fn)=>handlers.set(name,fn)}}:require(name),__dirname:path.dirname(file),setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},Date,URL};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),box,{filename:file});
 const {TwitchPopout}=box.module.exports,seen=[],requests=[];
 const popout=new TwitchPopout({getConfig:()=>({channel:'fixture'}),onMessage:(message,source)=>seen.push({message,source}),onStatus:()=>{}});
 const contents={mainFrame:{url:'https://dashboard.twitch.tv/popout/u/fixture/stream-manager/chat'},send:(name,payload)=>requests.push({name,payload}),getURL:()=> 'https://dashboard.twitch.tv/popout/u/fixture/stream-manager/chat'};
 popout.window={webContents:contents,isDestroyed:()=>false,isMinimized:()=>false};
 const envelope={sender:contents,senderFrame:contents.mainFrame};
 const echo=id=>handlers.get('twitch-popout:message')(envelope,{id,username:'fixture',message:'Repeated text'});
 let first=popout.sendChat('Repeated text',{source:'broadcast-run:one'});echo('provider1');assert.equal((await first).confirmed,true);
 let second=popout.sendChat('Repeated text',{source:'broadcast-run:two'});echo('provider2');assert.equal((await second).confirmed,true);assert.equal(popout.pending.size,0);
 echo('provider-manual');assert.deepEqual(seen.map(x=>x.source),['broadcast-run:one','broadcast-run:two','twitch-popout'],'identical posts consume separate send entries; later manual post is ordinary');
 const unknown=popout.sendChat('Repeated text',{source:'broadcast-run:unknown'});unknown.catch(()=>{});timers.at(-1)();await assert.rejects(unknown,e=>e.retryable===false);
 const count=requests.length;await assert.rejects(popout.sendChat('Repeated text'),e=>e.retryable===false);assert.equal(requests.length,count,'unconfirmed post is not silently resent');
 echo('provider-late');const next=popout.sendChat('Repeated text',{source:'broadcast-run:after-late'});echo('provider-next');assert.equal((await next).confirmed,true);
 const rejected=popout.sendChat('Repeated text',{source:'broadcast-run:rejected'});const request=requests.at(-1).payload;handlers.get('twitch-popout:sent')(envelope,{id:request.id,ok:false,error:'fixture blocked editor'});await assert.rejects(rejected);echo('provider-after-rejection');assert.equal(seen.at(-1).source,'twitch-popout');
 let clock=0,sends=0;const scheduler=new BroadcastScheduler({now:()=>clock,send:async()=>{sends++;const e=Error('unknown delivery');e.retryable=false;throw e;}});
 scheduler.configure({enabled:true,globalMinGapSeconds:0,platformMinGapSeconds:0,items:[{id:'retry',enabled:true,messages:['fixture'],targets:['twitch'],startDelaySeconds:0,intervalSeconds:600,retryOnError:true,retryDelaySeconds:5}]});await scheduler.tick();clock=5000;await scheduler.tick();assert.equal(sends,1);scheduler.stop();
 const sound=new BroadcastScheduler({send:async()=>({ok:true,mode:'local'}),onSound:async()=>({ok:false,error:'fixture audio output missing'})});
 const item={id:'sound',messages:['fixture'],targets:['local'],soundMediaId:'fixture-audio'};
 const result=await sound.test(item);assert.equal(result.ok,false);assert.equal(result.soundResult.ok,false);
 const deck=createDeckTests({getConfig:()=>({autoBroadcast:{items:[item]}}),broadcast:{test:x=>sound.test(x)}});const deckResult=await deck.test('broadcast','sound');assert.equal(deckResult.ok,false);assert.equal(deckResult.error,'fixture audio output missing');sound.stop();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-broadcast-setting-'));
 try{const store=new ConfigStore(dir),service=new BroadcastService({store,send:async()=>({ok:true})});assert.equal(store.get().autoBroadcast.showInMultiChat,true);service.master({enabled:false,showInMultiChat:false,globalMinGapSeconds:3,platformMinGapSeconds:5});assert.equal(new ConfigStore(dir).get().autoBroadcast.showInMultiChat,false);assert.equal(store.get().autoBroadcast.enabled,false);service.stop();}finally{fs.rmSync(dir,{recursive:true,force:true});}
 const ui=fs.readFileSync(path.join(__dirname,'../src/renderer/broadcast-ui.js'),'utf8');const read=ui.slice(ui.indexOf('  function read() {'),ui.indexOf('  function renderEditor() {'));
 const uiBox={draft:{messages:['fixture'],chainId:'old-chain'},root:{querySelectorAll:selector=>selector.includes('target')?[{dataset:{bcTarget:'local'}}]:[{value:'fixture'}]},$:selector=>({value:selector==='#bcChain'?'selected-chain':selector==='#bcSound'?'':selector==='#bcName'?'Fixture':'30',checked:false})};vm.runInNewContext(read+'\nread();',uiBox);assert.equal(uiBox.draft.chainId,'selected-chain','real form reader carries the selected shared chain to save and test');
 console.log('PASS broadcast repairs: repeated Twitch acknowledgements, one-use echoes, unknown-send retry prevention, sound failure/Deck error, persisted visibility without activation, action-chain form selection. No external messages.');
})().catch(e=>{console.error(e);process.exitCode=1;});
