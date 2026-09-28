'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');

function fakeTimers(){
  const tasks=new Map();let next=1;
  return {tasks,setTimeout(fn,ms){const id=next++;tasks.set(id,{fn,ms});return id;},clearTimeout(id){tasks.delete(id);},expire(){for(const [id,task] of [...tasks]){tasks.delete(id);task.fn();}}};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class FakePlayer extends EventEmitter {
  constructor(id){super();this.id=id;this.messages=[];this.destroyed=false;this.throwChannel='';}
  isDestroyed(){return this.destroyed;}
  send(channel,payload){if(channel===this.throwChannel)throw new Error('IPC closed');this.messages.push({channel,payload});}
  messagesFor(channel){return this.messages.filter(value=>value.channel===channel);}
}
function serviceHarness(){
  const timers=fakeTimers(),module={exports:{}};
  const source=fs.readFileSync(path.join(__dirname,'../src/core/audio-output-service.cjs'),'utf8');
  const existing=new Set(['C:\\fixtures\\miau.ogg','C:\\fixtures\\movie.mp4','C:\\fixtures\\picture.png']);
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='node:fs'?{existsSync:value=>existing.has(value)}:require(name),setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout});
  const config={audioOutput:{mode:'app',deviceId:'headset-1',volume:.4},media:[
    {id:'miau',path:'C:\\fixtures\\miau.ogg',type:'ogg',name:'Miau'},
    {id:'movie',path:'C:\\fixtures\\movie.mp4',type:'mp4',name:'Movie'},
    {id:'picture',path:'C:\\fixtures\\picture.png',type:'png',name:'Picture'}
  ]};
  const main=new FakePlayer(1),detached=new FakePlayer(2),outsider=new FakePlayer(3),calls=[],broadcasts=[],warnings=[];
  const overlay={runAction:async(event,options)=>{calls.push({event,options});return {ok:true,completed:true};},broadcast:event=>broadcasts.push(event)};
  const service=new module.exports.AudioOutputService({getConfig:()=>config,getPlayers:()=>[main,detached],overlay,onWarning:message=>warnings.push(message)});
  return {service,config,main,detached,outsider,calls,broadcasts,warnings,timers,overlay};
}

function rendererHarness({sinkError,playError,sinkWait,playWait,noSink=false}={}){
  const timers=fakeTimers(),handlers={},audio=[],results=[],revoked=[],created=[],toasts=[],windowEvents={};let ready=0;
  class FakeAudio {
    constructor(){this.steps=[];this.volume=1;this.sinkId='';this.src='';audio.push(this);if(noSink)this.setSinkId=undefined;}
    async setSinkId(id){this.steps.push(['sink',id]);if(sinkWait)await sinkWait.promise;if(sinkError){const error=sinkError(id);if(error)throw error;}this.sinkId=id;}
    async play(){this.steps.push(['play',this.sinkId,this.volume,this.src]);if(playWait)await playWait.promise;if(playError)throw playError;}
    pause(){this.steps.push(['pause']);}
    removeAttribute(name){this.steps.push(['remove',name]);if(name==='src')this.src='';}
    load(){this.steps.push(['load']);}
  }
  const api={onAudioPlay:fn=>handlers.play=fn,onAudioCancel:fn=>handlers.cancel=fn,audioReady:()=>ready++,audioResult:result=>results.push(result)};
  const context={window:{batto:api,addEventListener:(name,fn)=>windowEvents[name]=fn},Audio:FakeAudio,Blob,
    URL:{createObjectURL:blob=>{created.push(blob);return 'blob:test-tone';},revokeObjectURL:url=>revoked.push(url)},
    setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,toast:(message,error)=>toasts.push({message,error})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/audio-playback.js'),'utf8'),context);
  return {handlers,audio,results,revoked,created,toasts,timers,windowEvents,get ready(){return ready;}};
}
const payload=(id='job',extra={})=>({id,url:'file:///C:/fixtures/miau.ogg',volume:.2,deviceId:'headset-1',...extra});
const mouseFreeEvent=(id='miau',volume=.5)=>({type:'media',data:{mediaId:id,mediaType:id==='movie'?'mp4':'ogg',volume}});

(async()=>{
  const h=serviceHarness();
  h.service.registerPlayer(h.outsider);
  await assert.rejects(h.service.run(mouseFreeEvent()),/nicht bereit/);
  h.service.registerPlayer(h.main);h.service.registerPlayer(h.detached);
  const run=h.service.run(mouseFreeEvent());
  const first=h.main.messagesFor('audio:play')[0].payload;
  assert.equal(first.volume,.2,'event volume is multiplied by global volume');
  assert.equal(first.deviceId,'headset-1');
  assert.match(first.url,/miau\.ogg$/);
  assert.equal(h.detached.messages.length,0,'detached window cannot duplicate main playback');
  assert.equal(h.broadcasts.length,0,'app audio does not also play in OBS');
  h.service.acknowledge(h.detached,{id:first.id,ok:true});
  h.service.acknowledge(h.outsider,{id:first.id,ok:false,error:'wrong owner'});
  assert.equal(h.service.active.size,1,'only selected player can finish an audio job');
  h.service.acknowledge(h.main,{id:first.id,ok:true,deviceId:'default',warning:'Device fallback'});
  assert.equal((await run).warning,'Device fallback');
  assert.equal(h.warnings.length,1);
  assert.equal(h.service.active.size,0);assert.equal(h.timers.tasks.size,0);
  assert.equal(h.main.messagesFor('audio:cancel').length,1,'completion clears renderer resources');

  const movie=h.service.run(mouseFreeEvent('movie'));
  const movieMessage=h.main.messagesFor('audio:play').at(-1).payload;
  assert.equal(h.broadcasts.at(-1).data.data.audioOwner,'app');
  assert.equal(h.broadcasts.at(-1).data.data.muted,true);
  assert.equal(h.calls.length,0,'app-owned video does not create an OBS completion waiter');
  h.service.acknowledge(h.main,{id:movieMessage.id,ok:true});await movie;
  assert.equal(h.broadcasts.at(-1).type,'action:cancel');
  assert.equal(h.broadcasts.at(-1).id,movieMessage.id);

  h.config.audioOutput.mode='obs';
  await h.service.run(mouseFreeEvent());
  assert.equal(h.calls.at(-1).event.data.volume,.2,'OBS receives the same combined volume');
  assert.equal(h.main.messagesFor('audio:play').length,2,'OBS mode does not also play in the app');
  h.config.audioOutput.volume=0;await h.service.run(mouseFreeEvent());
  assert.equal(h.calls.at(-1).event.data.volume,0,'zero global volume stays muted');
  await h.service.run({type:'media',data:{mediaId:'picture',mediaType:'png'}});
  assert.equal(h.calls.at(-1).event.data.mediaType,'png','visual-only media remains on its overlay route');
  h.config.audioOutput.mode='app';h.config.audioOutput.volume=.4;
  await assert.rejects(h.service.run(mouseFreeEvent('missing')),/nicht gefunden/);

  const abort=new AbortController();
  const cancelled=h.service.run(mouseFreeEvent(),{signal:abort.signal});
  abort.abort();await assert.rejects(cancelled,/abgebrochen/);
  assert.equal(h.service.active.size,0);assert.equal(h.timers.tasks.size,0);
  const plays=h.main.messagesFor('audio:play').length;
  await assert.rejects(h.service.run(mouseFreeEvent(),{signal:abort.signal}),/abgebrochen/);
  assert.equal(h.main.messagesFor('audio:play').length,plays,'pre-aborted action never starts sound');
  const timed=h.service.run(mouseFreeEvent(),{timeoutMs:250});
  h.timers.expire();await assert.rejects(timed,/nicht rechtzeitig/);
  assert.equal(h.service.active.size,0);assert.equal(h.timers.tasks.size,0);

  const simultaneous=Array.from({length:16},()=>h.service.run(mouseFreeEvent()));
  await assert.rejects(h.service.run(mouseFreeEvent()),/Zu viele/);
  assert.equal(h.service.active.size,16);
  const settling=Promise.allSettled(simultaneous);
  h.main.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false},'https://widget.example/',false,false);
  h.main.emit('did-start-loading');
  h.main.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true},'file:///app.html#chat',true,true);
  assert.equal(h.service.active.size,16,'widget/iframe load and same-page navigation cannot interrupt audio');
  h.main.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false},'file:///app.html',false,true);
  assert.ok((await settling).every(value=>value.status==='rejected'));
  assert.equal(h.service.active.size,0);assert.equal(h.timers.tasks.size,0);
  const detachedRun=h.service.run(mouseFreeEvent());
  assert.equal(h.detached.messagesFor('audio:play').length,1,'ready detached window owns a new job after main reload');
  const detachedId=h.detached.messagesFor('audio:play')[0].payload.id;
  h.service.acknowledge(h.main,{id:detachedId,ok:true});assert.equal(h.service.active.size,1);
  h.service.acknowledge(h.detached,{id:detachedId,ok:true});await detachedRun;
  for(let reload=0;reload<5;reload++) {
    h.service.registerPlayer(h.main);
    assert.equal(h.main.listenerCount('destroyed'),1,'reload must not accumulate destroyed listeners');
    assert.equal(h.main.listenerCount('did-start-navigation'),1);
    h.main.emit('did-start-navigation',{},'file:///app.html',false,true);
    assert.equal(h.service.ready.has(h.main.id),false,'legacy positional navigation signature remains supported');
  }
  h.service.registerPlayer(h.main);h.service.stop();assert.equal(h.service.ready.size,0);
  assert.equal(h.main.listenerCount('destroyed'),0);assert.equal(h.detached.listenerCount('did-start-navigation'),0,'stop releases player lifecycle listeners');

  const closed=serviceHarness();closed.service.registerPlayer(closed.main);
  const closedRun=closed.service.run(mouseFreeEvent());
  closed.main.throwChannel='audio:cancel';
  closed.service.acknowledge(closed.main,{id:closed.main.messagesFor('audio:play')[0].payload.id,ok:true});
  assert.equal((await closedRun).ok,true,'cleanup IPC race cannot strand a completed job');
  assert.equal(closed.service.active.size,0);assert.equal(closed.timers.tasks.size,0);
  const broken=serviceHarness();broken.service.registerPlayer(broken.main);
  broken.main.throwChannel='audio:play';
  await assert.rejects(broken.service.run(mouseFreeEvent()),/IPC closed/);
  assert.equal(broken.service.active.size,0);assert.equal(broken.timers.tasks.size,0);
  const visualFailure=serviceHarness();visualFailure.service.registerPlayer(visualFailure.main);
  const visualRun=visualFailure.service.run(mouseFreeEvent('movie'));
  visualFailure.overlay.broadcast=()=>{throw new Error('Overlay closed');};
  visualFailure.service.acknowledge(visualFailure.main,{id:visualFailure.main.messagesFor('audio:play')[0].payload.id,ok:true});
  assert.equal((await visualRun).ok,true,'visual cleanup failure cannot strand local audio');
  const warningFailure=serviceHarness();warningFailure.service.registerPlayer(warningFailure.main);
  const warningRun=warningFailure.service.run(mouseFreeEvent());
  warningFailure.service.onWarning=()=>{throw new Error('Logger closed');};
  warningFailure.service.acknowledge(warningFailure.main,{id:warningFailure.main.messagesFor('audio:play')[0].payload.id,ok:true,warning:'Fallback'});
  assert.equal((await warningRun).ok,true,'warning logger failure cannot strand local audio');

  const r=rendererHarness();assert.equal(r.ready,1);
  await r.handlers.play(payload());
  assert.deepEqual(r.audio[0].steps.slice(0,2),[['sink','headset-1'],['play','headset-1',.2,'file:///C:/fixtures/miau.ogg']],'device selection finishes before playback');
  await r.handlers.play(payload());assert.equal(r.audio.length,1,'duplicate active ID cannot play twice');
  r.audio[0].onended();
  assert.equal(r.results[0].ok,true);assert.equal(r.audio[0].src,'');assert.equal(r.audio[0].onended,null);
  assert.deepEqual(r.audio[0].steps.slice(-3),[['pause'],['remove','src'],['load']]);

  const missing=rendererHarness({sinkError:id=>id==='headset-1'?Object.assign(new Error('Missing'),{name:'NotFoundError'}):null});
  await missing.handlers.play(payload());
  assert.deepEqual(missing.audio[0].steps.slice(0,3),[['sink','headset-1'],['sink',''],['play','',.2,'file:///C:/fixtures/miau.ogg']]);
  missing.audio[0].onended();assert.equal(missing.results[0].deviceId,'default');assert.match(missing.results[0].warning,/Systemstandard/);
  const denied=rendererHarness({sinkError:()=>Object.assign(new Error('Permission denied'),{name:'NotAllowedError'})});
  await denied.handlers.play(payload());
  assert.equal(denied.audio[0].steps.filter(value=>value[0]==='play').length,0,'permission failure cannot silently fall back');
  assert.equal(denied.results[0].ok,false);assert.match(denied.results[0].error,/Permission denied/);
  const unsupported=rendererHarness({noSink:true});await unsupported.handlers.play(payload());
  assert.equal(unsupported.results[0].ok,false);assert.equal(unsupported.audio[0].steps.some(value=>value[0]==='play'),false);
  const decode=rendererHarness({playError:new Error('Unsupported codec')});await decode.handlers.play(payload());
  assert.equal(decode.results[0].ok,false);assert.match(decode.results[0].error,/Unsupported codec/);

  const pendingSink=deferred(),duringSink=rendererHarness({sinkWait:pendingSink});
  const sinkRun=duringSink.handlers.play(payload());duringSink.handlers.cancel({id:'job'});pendingSink.resolve();await sinkRun;
  assert.equal(duringSink.audio[0].steps.some(value=>value[0]==='play'),false,'cancel during device selection prevents later playback');
  assert.equal(duringSink.results.length,0,'cancel is reported by main, not acknowledged twice');
  const pendingPlay=deferred(),duringPlay=rendererHarness({playWait:pendingPlay});
  const playRun=duringPlay.handlers.play(payload('play-race',{deviceId:'default'}));duringPlay.handlers.cancel({id:'play-race'});pendingPlay.reject(new Error('Playback cancelled'));await playRun;
  assert.equal(duringPlay.results.length,0);assert.equal(duringPlay.audio[0].src,'');

  const concurrent=rendererHarness();await Promise.all([concurrent.handlers.play(payload('one',{durationSeconds:1})),concurrent.handlers.play(payload('two',{durationSeconds:1}))]);
  assert.equal(concurrent.audio.length,2);assert.equal(concurrent.timers.tasks.size,2);
  concurrent.handlers.cancel({id:'one'});assert.equal(concurrent.timers.tasks.size,1);
  concurrent.timers.expire();assert.equal(concurrent.results.length,1);assert.equal(concurrent.results[0].id,'two');assert.equal(concurrent.results[0].ok,true);
  const tone=rendererHarness();await tone.handlers.play(payload('tone',{testTone:true,deviceId:'default',volume:0}));
  assert.equal(tone.created.length,1);assert.equal(tone.audio[0].volume,0);
  tone.windowEvents.beforeunload();assert.deepEqual(tone.revoked,['blob:test-tone']);assert.equal(tone.results.length,0);
  console.log('Audio playback regression: output gain, single owner, concurrent playback, ACK sender, cancellation/timeouts, device selection/fallback, cleanup races: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
