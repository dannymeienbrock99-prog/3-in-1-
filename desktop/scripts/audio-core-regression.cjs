'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { ConfigStore, DEFAULT_AUDIO_OUTPUT, migrateConfig } = require('../src/core/config-store.cjs');
const { validateConfig } = require('../src/core/settings/schema.cjs');
const { BroadcastScheduler, normalizeItem } = require('../src/core/broadcast/scheduler.cjs');
const { BroadcastService } = require('../src/core/broadcast/service.cjs');
const { OverlayServer } = require('../src/core/overlay-server-base.cjs');

const make = (extra = {}) => normalizeItem({ id:'sound-test', enabled:true, messages:['Audio test'], targets:['local','twitch'], soundMediaId:'miau-audio', startDelaySeconds:0, intervalSeconds:30, ...extra });
const configure = (scheduler, item = make()) => scheduler.configure({ enabled:true, items:[item], globalMinGapSeconds:0, platformMinGapSeconds:0 });

function overlayHarness() {
  const sent = [], elements = [], timers = new Map();
  const ws = { send: value => sent.push(JSON.parse(value)) };
  const stage = { append: element => elements.push(element), innerHTML:'' };
  const context = {
    document: {
      getElementById: () => stage,
      createElement: tag => ({tagName:tag.toUpperCase(), volume:1, muted:false, play:() => Promise.resolve(), pause(){}, remove(){}})
    },
    connectBatto: () => ws,
    setTimeout: fn => { const id=Symbol(); timers.set(id,fn); return id; },
    clearTimeout: id => timers.delete(id)
  };
  const html = new OverlayServer({configStore:{get:()=>({})}}).mediaHtml();
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(source, context);
  return { sent, elements, timers, play: data => ws.onmessage({data:JSON.stringify({type:'event',data:{event:'media',data}})}) };
}

(async () => {
  const migrated = migrateConfig({schemaVersion:6,general:{displayName:'Existing stream'},tts:{volume:.3},events:[]});
  assert.deepEqual(migrated.audioOutput, DEFAULT_AUDIO_OUTPUT);
  assert.equal(migrated.general.displayName,'Existing stream');
  assert.equal(migrated.tts.volume,.3,'new output must preserve separate TTS settings');
  assert.equal(normalizeItem({...make(),soundMediaId:undefined}).soundMediaId,'','old broadcasts stay silent');
  assert.throws(() => normalizeItem({...make(),soundMediaId:123}),/Audiodatei/);
  for (const [field, value] of [['volume',-1],['volume',1.01],['volume','0.5'],['volume',null],['mode','unavailable'],['deviceId',{}],['deviceId',''],['deviceLabel',false]]) {
    const config=structuredClone(migrated);
    config.audioOutput[field]=value;
    assert.ok(validateConfig(config).errors.some(error => error.path===`audioOutput.${field}`),`${field} rejects ${JSON.stringify(value)}`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'batto-audio-core-'));
  try {
    const store = new ConfigStore(dir);
    const selection = {mode:'app',deviceId:'speaker-id',deviceLabel:'Headset',volume:.37};
    store.merge({audioOutput:selection});
    const service = new BroadcastService({store,send:async()=>({ok:true}),onSound:async item=>({ok:true,mediaId:item.soundMediaId})});
    service.upsert(make());
    const reloaded = new ConfigStore(dir);
    assert.deepEqual(reloaded.get().audioOutput,selection);
    assert.equal(reloaded.get().autoBroadcast.items[0].soundMediaId,'miau-audio');
    assert.throws(()=>store.merge({audioOutput:{volume:2}}));
    assert.deepEqual(new ConfigStore(dir).get().audioOutput,selection,'invalid audio settings must not overwrite saved device');
    const result=await service.test('sound-test');
    assert.equal(result.soundResult.mediaId,'miau-audio','service must wire sound callback');
    store.merge({audioOutput:{mode:'obs',volume:0}});
    assert.equal(new ConfigStore(dir).get().audioOutput.volume,0,'explicit mute must persist');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }

  let clock=0,sounds=0,twitchAttempts=0;
  const sends=[];
  const retry = new BroadcastScheduler({now:()=>clock,send:async target=>{
    sends.push(target);
    if(target==='twitch' && twitchAttempts++===0)throw new Error('offline');
    return {ok:true};
  },onSound:async(item,context)=>{
    sounds++;
    assert.equal(item.soundMediaId,'miau-audio');
    assert.equal(context.source,'broadcast:sound-test');
    return {ok:false,error:'Headset disconnected'};
  }});
  configure(retry,make({retryOnError:true,retryDelaySeconds:5}));
  await retry.tick();
  assert.equal(sounds,1);
  assert.equal(retry.status().items[0].lastSoundError,'Headset disconnected');
  clock=5000;await retry.tick();
  assert.deepEqual(sends,['local','twitch','twitch'],'sound failures cannot resend successful chats');
  assert.equal(sounds,1,'retry of failed chat target cannot play sound twice');
  assert.equal(retry.status().items[0].lastSoundError,'Headset disconnected','later chat success cannot hide audio error');
  clock=35000;await retry.tick();
  assert.equal(sounds,2,'new scheduled message gets one sound');
  retry.stop();

  let testSounds=0;
  const manual = new BroadcastScheduler({send:async()=>({ok:true}),onSound:async()=>{testSounds++;throw new Error('Missing audio file');}});
  const manualResult = await manual.test(make());
  assert.equal(testSounds,1,'multi-target test plays audio once');
  assert.equal(manualResult.ok,false,'failed audio makes the whole requested broadcast incomplete');
  assert.equal(manualResult.results.length,2);
  assert.ok(manualResult.results.every(result=>result.ok),'successful chat targets remain explicitly successful');
  assert.deepEqual(manualResult.soundResult,{ok:false,error:'Missing audio file'});
  await manual.test(make({soundMediaId:''}));
  assert.equal(testSounds,1,'no selected audio stays silent');
  const unavailable = new BroadcastScheduler({send:async()=>({ok:false,error:'No connection'}),onSound:async()=>{throw new Error('Must not be called');}});
  configure(unavailable);
  await unavailable.tick();
  assert.equal(unavailable.status().items[0].lastSoundError,'');
  const unavailableResult=await unavailable.test(make());
  assert.equal(unavailableResult.ok,false);
  assert.equal(unavailableResult.soundResult,undefined,'no sound if no target succeeded');
  unavailable.stop();

  let releaseSound, soundSignal;
  const uninterruptedTargets=[];
  const uninterrupted = new BroadcastScheduler({send:async target=>{uninterruptedTargets.push(target);return {ok:true};},onSound:(_item,context)=>{
    soundSignal=context.signal;
    return new Promise(resolve=>{releaseSound=resolve;});
  }});
  configure(uninterrupted);
  const uninterruptedTick=uninterrupted.tick();
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(uninterruptedTargets,['local','twitch'],'pending sound must not hold the second chat destination');
  await uninterruptedTick;
  assert.equal(uninterrupted.ticking,false,'pending sound must not keep the scheduler tick busy');
  uninterrupted.configure({enabled:false,items:[make()],globalMinGapSeconds:0,platformMinGapSeconds:0});
  assert.equal(soundSignal.aborted,true,'disabling broadcasts cancels an active broadcast sound');
  releaseSound({ok:false,error:'Cancelled old sound'});await Promise.resolve();await Promise.resolve();
  assert.equal(uninterrupted.status().items[0].lastSoundError,'','cancelled sounds cannot overwrite current status');
  uninterrupted.stop();

  for(const cancelMethod of ['delete','stop']) {
    let signal;
    const cancelSound = new BroadcastScheduler({send:async()=>({ok:true}),onSound:(_item,context)=>{
      signal=context.signal;
      return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:false,error:'Cancelled'}),{once:true}));
    }});
    configure(cancelSound);await cancelSound.tick();
    if(cancelMethod==='delete')cancelSound.configure({enabled:true,items:[]});else cancelSound.stop();
    assert.equal(signal.aborted,true,`${cancelMethod} cancels owned scheduled sound`);
    cancelSound.stop();
  }

  const overlay=overlayHarness();
  overlay.play({mediaId:'miau',mediaType:'ogg',audioOwner:'app',overlayActionId:'app-audio'});
  assert.equal(overlay.elements.length,0,'app-owned audio must not echo in OBS');
  overlay.play({mediaId:'movie',mediaType:'mp4',audioOwner:'app',overlayActionId:'app-video',durationSeconds:2});
  assert.equal(overlay.elements[0].tagName,'VIDEO');
  assert.equal(overlay.elements[0].muted,true,'app-owned video stays visually available and silent');
  overlay.play({mediaId:'second',mediaType:'mp4',audioOwner:'app',overlayActionId:'app-busy'});
  assert.deepEqual(overlay.sent,[],'overlay cannot reject app-owned playback when busy');
  for(const callback of [...overlay.timers.values()])callback();
  assert.deepEqual(overlay.sent,[],'overlay timeout cannot acknowledge app-owned playback');
  overlay.play({mediaId:'movie-error',mediaType:'mp4',audioOwner:'app',overlayActionId:'app-error'});
  overlay.elements.at(-1).onerror();
  assert.deepEqual(overlay.sent,[],'overlay failure cannot reject app-owned playback');
  overlay.play({mediaId:'obs-audio',mediaType:'ogg',muted:true,volume:.42,overlayActionId:'obs-audio'});
  assert.equal(overlay.elements.at(-1).volume,.42);
  assert.equal(overlay.elements.at(-1).muted,true,'explicit muted payload is respected');
  overlay.elements.at(-1).onended();
  assert.deepEqual(overlay.sent,[{type:'action:ack',id:'obs-audio',ok:true}],'OBS-owned playback still acknowledges completion');
  for(const mediaType of ['m4a','aac','flac']) {
    const formats=overlayHarness();
    formats.play({mediaId:'audio',mediaType,audioOwner:'app',overlayActionId:'app-format'});
    assert.equal(formats.elements.length,0,`${mediaType} must not echo in app mode`);
    formats.play({mediaId:'audio',mediaType,overlayActionId:'obs-format'});
    assert.equal(formats.elements[0].tagName,'AUDIO',`${mediaType} must use the audio element in OBS mode`);
  }
  console.log('Audio core regression: persisted device/volume, validation, once per broadcast, chat retry isolation, and overlay audio ownership: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
