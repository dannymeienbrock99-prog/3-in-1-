'use strict';
const assert=require('node:assert/strict');
const {parseAccelerator,normalizeHotkey,InputHotkeys}=require('../src/core/input-hotkeys.cjs');
const {PhysicalInputBackend}=require('../src/core/physical-input.cjs');
const {TikTokWriter}=require('../src/core/broadcast/tiktok-writer.cjs');
const {ActionEngine}=require('../src/core/action-engine.cjs');
const {ChainService}=require('../src/core/chain-service.cjs');
async function main(){
 assert.equal(parseAccelerator('strg+shift+Mouse4').accelerator,'Control+Shift+XButton1');
 for(const key of ['LButton','RButton','MButton','XButton1','XButton2','WheelUp','WheelDown','WheelLeft','WheelRight','NumPad0','NumPadEnter','F24','Oem1','Oem7']){
  const parsed=parseAccelerator('Alt+'+key);assert.equal(parsed.key,key);
 }
 assert.throws(()=>normalizeHotkey({accelerator:'WheelUp',triggerMode:'repeat'}),/Mausrad/);
 assert.throws(()=>parseAccelerator('Control+Alt+Delete'),/Windows/);
 assert.throws(()=>parseAccelerator('Super+L'),/Windows/);
 assert.throws(()=>parseAccelerator('Ctrl+Shift'),/zusätzlich/);
 assert.equal(parseAccelerator('RButton+K').accelerator,'K+RButton');
 assert.equal(normalizeHotkey({accelerator:'Mouse5'}).passthrough,true);
 assert.equal(normalizeHotkey({accelerator:'Mouse5',passthrough:false}).passthrough,false);
 let calls=0,callback,resolveCapture;
 const backend={stop(){},cancelCapture(){},configure:async(items,cb)=>{callback=cb;assert.equal(items.length,2);},capture:()=>new Promise(r=>{resolveCapture=r;})};
 const manager=new InputHotkeys({backend,trigger:()=>calls++,stop:()=>{},onStatus:()=>{}});
 const base={accelerator:'Control+Mouse4',chainId:'c',debounceMs:50};
 manager.configure([{...base,id:'g'},{...base,id:'a',scope:'app'},{...base,id:'duplicate'}]);
 await new Promise(r=>setImmediate(r));assert.equal(manager.states[0].registered,true);assert.equal(manager.states[1].registered,true);assert.match(manager.states[2].error,/doppelt/);
 callback('g');callback('g');assert.equal(calls,1);
 const capture=manager.capture();callback('a');assert.equal(calls,1);resolveCapture({accelerator:'RButton'});await capture;callback('a');assert.equal(calls,2);manager.clear();
 let doActions=0,httpCalls=0;const config={platforms:{tikfinity:{sendEnabled:true,senderUsername:'sender',streamerbotPort:7474}},streamerbot:{tiktokActionId:'real-action-id'}};
 const adapter={status:()=>({connected:true}),execute:async(id,args)=>{doActions++;assert.equal(id,'real-action-id');assert.equal(args.message,'hello');return {ok:true,accepted:true,completed:false};}};
 const writer=new TikTokWriter({getConfig:()=>config,getStreamerBot:()=>adapter,fetchImpl:async()=>{httpCalls++;throw new Error('must not use HTTP');}});
 const result=await writer.send('hello',{source:'broadcast:test'});assert.equal(result.mode,'tiktok-queued');assert.equal(result.completed,false);assert.equal(httpCalls,0);assert.equal(doActions,1);
 adapter.execute=async()=>{doActions++;throw new Error('ambiguous disconnect');};await assert.rejects(writer.send('hello'),e=>e.retryable===false);assert.equal(httpCalls,0);assert.equal(doActions,2);
 config.streamerbot.tiktokActionId='';const legacy=new TikTokWriter({getConfig:()=>config,fetchImpl:async(url,opts)=>{httpCalls++;assert.equal(JSON.parse(opts.body).action.name,'Batto TikTok Broadcast');return {status:204};}});assert.equal((await legacy.send('hello')).mode,'tiktok-queued');
 const cfg={commands:[{id:'cmd',trigger:'!x',roles:['moderator'],userCooldownSeconds:60,actions:[{type:'chat',platform:'same',text:'Hallo {username} {args}'}]}],actionChains:[]},sent=[];
 const engine=new ActionEngine({getConfig:()=>cfg,sendChat:async(p,t)=>{sent.push({p,t});return {ok:true};}});
 await engine.handleMessage({platform:'twitch',username:'first',user:{id:'stable',isBroadcaster:true},message:'!x arg',eventId:'one'});
 await engine.handleMessage({platform:'twitch',username:'renamed',user:{id:'stable',isBroadcaster:true},message:'!x arg',eventId:'two'});
 await engine.handleMessage({platform:'twitch',username:'first',user:{id:'other',isBroadcaster:true},message:'!x arg',eventId:'three'});
 assert.equal(sent.length,2);assert.equal(sent[0].t,'Hallo first arg');
 await engine.handleMessage({platform:'twitch',username:'third',user:{id:'third',isBroadcaster:true},message:'!x arg',eventId:'three'});assert.equal(sent.length,2);
 await engine.handleMessage({platform:'tiktok',username:'unknown-role',user:{id:'u'},message:'!x arg',eventId:'four'});assert.equal(sent.length,2);
 let widget;engine.onChatWidget=async a=>{widget=a;return {ok:true};};
 assert.equal((await engine.execute([{type:'chat-widget',kind:'widget',widgetId:'f',durationMs:8000}],{username:'Sam'})).ok,true);assert.equal(widget.context.username,'Sam');assert.equal(widget.widgetId,'f');
 let sb;engine.onStreamerBot=async(...args)=>{sb=args;return {ok:true,accepted:true,completed:false};};await engine.execute([{type:'streamerbot',actionId:'id',args:{message:'Danke {username}'}}],{username:'Sam'});assert.equal(sb[1].message,'Danke Sam');assert.equal(sb[4].waitForCompletion,false);
 cfg.actionChains=[{id:'c',failurePolicy:'continue',actions:[{type:'unknown'},{type:'delay',ms:1}]}];const chains=new ChainService({getConfig:()=>cfg,engine});const continued=await chains.trigger('c');assert.equal(continued.results.length,2);assert.equal(continued.ok,false);
 const {validateActions,normalizeHotkeyPatch}=require('../src/core/settings/action-schema.cjs');
 assert.throws(()=>normalizeHotkeyPatch([{id:'1',accelerator:'Mouse4'},{id:'2',accelerator:'XButton1'}]),/doppelt/);
 assert.equal(normalizeHotkeyPatch([{id:'1',accelerator:'strg+Mouse5'}])[0].accelerator,'Control+XButton2');
 assert.equal(validateActions({commands:[{actions:[{type:'chat-widget',kind:'widget',widgetId:'f',durationMs:8000}]}]}).length,0);
 assert.ok(validateActions({actionChains:[{id:'x',failurePolicy:'wrong',actions:[{type:'streamerbot',actionId:'',args:[]}]}]}).length>=3);
 const {BroadcastService}=require('../src/core/broadcast/service.cjs');
 let saved={autoBroadcast:{enabled:true,items:[],globalMinGapSeconds:0,platformMinGapSeconds:0}};
 const service=new BroadcastService({store:{get:()=>saved,merge:patch=>{saved={...saved,autoBroadcast:{...saved.autoBroadcast,...patch.autoBroadcast}};return saved;}},send:async()=>({ok:true}),isLive:()=>false});
 const created=service.upsert({id:'new',messages:['x'],targets:['local'],enabled:true,startDelaySeconds:0,chainId:'c'}).item;
 assert.equal(created.onlyWhenLive,true);assert.equal(created.chainId,'c');
 let manual=0;service.scheduler.onActions=async()=>{manual++;return {ok:true};};assert.equal((await service.test('new')).ok,true);assert.equal(manual,1);service.stop();
 const {BroadcastScheduler,normalizeItem}=require('../src/core/broadcast/scheduler.cjs');
 let time=0,tries=0,extras=0,cancelled=false;
 const scheduled=new BroadcastScheduler({now:()=>time,send:async target=>{if(target==='twitch'&&tries++===0)throw Error('temporary');return {ok:true};},onActions:async(item,context)=>{extras++;assert.equal(item.chainId,'c');context.signal.addEventListener('abort',()=>{cancelled=true;});return new Promise(()=>{});}});
 const entry=normalizeItem({id:'b',enabled:true,onlyWhenLive:false,messages:['x'],targets:['local','twitch'],chainId:'c',startDelaySeconds:0,retryOnError:true,retryDelaySeconds:5});
 const settings={enabled:true,items:[entry],globalMinGapSeconds:0,platformMinGapSeconds:0};scheduled.configure(settings);await scheduled.tick();assert.equal(extras,0);time=5000;await scheduled.tick();assert.equal(extras,1);scheduled.configure({...settings,enabled:false});assert.equal(cancelled,true);scheduled.stop();
 cfg.actionChains=[{id:'cancel',queueMode:'queue',actions:[{type:'delay',ms:500}]}];const cancelChains=new ChainService({getConfig:()=>cfg,engine});const runningController=new AbortController(),queuedController=new AbortController();const running=cancelChains.trigger('cancel',{}, {signal:runningController.signal}),queued=cancelChains.trigger('cancel',{}, {signal:queuedController.signal});queuedController.abort();assert.equal((await queued).cancelled,true);assert.equal(cancelChains.status().queued.length,0);runningController.abort();assert.equal((await running).cancelled,true);
 if(process.platform==='win32'){
  const physical=new PhysicalInputBackend();await physical.configure([],()=>{});physical.stop();
  const rapid=new PhysicalInputBackend();const pending=rapid.start();rapid.stop();await assert.rejects(pending,/beendet/);await rapid.configure([],()=>{});rapid.stop();
 }
 console.log('GO actions/input regression PASS: physical handler self-test separately compiled; zero actual messages, bindings or simulated inputs.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
