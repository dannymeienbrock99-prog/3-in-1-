'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {createDeckControls}=require('../src/core/deck-controls.cjs');
const {controlAudio}=require('../src/services/jarvis-audio.cjs');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-voice-control-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let config={filters:{enabled:true},autoBroadcast:{enabled:false,items:[]}},view='',scene='Spiel',fail=false;
 const legacy=createDeckControls({getConfig:()=>config,saveConfig:async patch=>{config={...config,...patch};},isDetached:()=>false,setDetached:async()=>{}});
 const host={catalog:()=>({...legacy.snapshot(),items:[]}),control:legacy.control,navigate:async value=>{if(fail)throw Error('Fenster nicht verfügbar');view=value;return value;}};
 const dual={config:{program:{}},serial:fn=>fn(),scene:async value=>{scene=value;return {ok:true};}};
 const runtime={voice:{status:'idle'}};
 const controls=new SuiteControls({runtime,getHost:()=>host,getDual:()=>dual});
 runtime.jarvis=new JarvisCore({directory,control:a=>controls.executeFromJarvis(a),getCommandCatalog:()=>controls.catalog()});
 runtime.jarvis.settings.voiceEnabled=false;
 return {jarvis:runtime.jarvis,controls,host,get config(){return config;},get view(){return view;},get scene(){return scene;},set fail(value){fail=value;}};
}
test('exact reported failures route through the real catalog into scene and view controls',async t=>{
 const f=fixture(t);
 assert.equal((await f.jarvis.execute('Start Szene öffnen')).ok,true);assert.equal(f.scene,'Start');
 assert.equal((await f.jarvis.execute('Multi Chat öffnen')).ok,true);assert.equal(f.view,'dashboard');
 assert.equal((await f.jarvis.execute('Chat Filter öffnen')).ok,true);assert.equal(f.view,'filters');
 assert.equal((await f.jarvis.execute('Chat Filter aus')).ok,true);assert.equal(f.config.filters.enabled,false);
 assert.equal((await f.jarvis.execute('Schalte Auto Broadcast ein')).ok,true);assert.equal(f.config.autoBroadcast.enabled,true);
});
test('saved Stream Deck speech commands use the same validated controls without deadlock',async t=>{
 const f=fixture(t);
 assert.equal((await f.controls.execute({action:'command',text:'Start Szene öffnen'})).ok,true);
 assert.equal(f.scene,'Start');assert.equal(f.controls.busy,false);assert.equal(f.controls.jarvisDepth,0);
 assert.equal(f.jarvis.history[0].source,'streamdeck');
});
test('deleted targets, unrelated active operations, recursion and host failures cannot report success',async t=>{
 const f=fixture(t);f.controls.busy=true;
 assert.equal((await f.jarvis.execute('Start Szene öffnen')).ok,false);assert.equal(f.scene,'Spiel');
 f.controls.busy=false;
 await assert.rejects(f.controls.executeFromJarvis({action:'command',text:'Pause'}),/selbst/);
 await assert.rejects(f.controls.executeFromJarvis({action:'navigate',target:'missing'}),/vorhandenes/);
 f.fail=true;assert.equal((await f.jarvis.execute('Multi Chat öffnen')).ok,false);assert.equal(f.view,'');
 assert.equal(f.jarvis.memory.length,0);
});
test('moderation requires a separate exact confirmation, expires, and is cleared by another command',async t=>{
 const f=fixture(t);let now=1000,prepared=0,executed=0;
 f.jarvis.clock=()=>now;
 f.jarvis.moderation={prepareModeration:async()=>({ok:true,description:'Testnutzer auf Twitch dauerhaft sperren?',prepared:{id:++prepared,expiresAt:now+45000}}),executePrepared:async()=>{executed++;return {ok:true,text:'Twitch hat die Sperre bestätigt.'};}};
 await f.jarvis.execute('Blockiere Testnutzer auf Twitch');assert.equal(executed,0);
 assert.equal((await f.jarvis.execute('Bestätigen')).ok,true);assert.equal(executed,1);
 assert.equal((await f.jarvis.execute('Bestätigen')).ok,false);assert.equal(executed,1);
 await f.jarvis.execute('Blockiere Testnutzer auf Twitch');now+=45001;
 assert.equal((await f.jarvis.execute('Bestätigen')).ok,false);assert.equal(executed,1);
 await f.jarvis.execute('Blockiere Testnutzer auf Twitch');await f.jarvis.execute('Multi Chat öffnen');
 assert.equal((await f.jarvis.execute('Bestätigen')).ok,false);assert.equal(executed,1);
 await f.jarvis.execute('Blockiere Testnutzer auf Twitch');await f.jarvis.execute('Abbrechen');
 assert.equal((await f.jarvis.execute('Bestätigen')).ok,false);assert.equal(executed,1);
});
test('spoken filter words use the filter adapter and report failure rather than success',async t=>{
 const f=fixture(t);const calls=[];
 f.jarvis.moderation={filter:async value=>{calls.push(value);return {ok:false,text:'Filter konnte nicht gespeichert werden.'};}};
 const result=await f.jarvis.execute('Filterwort Beispiel hinzufügen');
 assert.equal(result.ok,false);assert.equal(calls[0].word,'Beispiel');assert.equal(f.jarvis.memory.length,0);
});
test('stopping during a slow identity lookup cannot restore a cancelled pending ban',async t=>{
 const f=fixture(t);let release;
 f.jarvis.moderation={prepareModeration:()=>new Promise(resolve=>{release=resolve;})};
 const slow=f.jarvis.execute('Blockiere Testnutzer auf Twitch');
 await f.jarvis.execute('Stopp');
 release({ok:true,description:'Testnutzer sperren',prepared:{id:'cancelled',expiresAt:Date.now()+45000}});
 assert.equal((await slow).ok,false);assert.equal(f.jarvis.pendingModeration,null);
 assert.equal((await f.jarvis.execute('Bestätigen')).ok,false);
});
test('chat text is read only and can never confirm or execute moderation',async t=>{
 const f=fixture(t);let calls=0;f.jarvis.moderation={prepareModeration:async()=>{calls++;}};
 f.jarvis.onChat([{platform:'twitch',role:'moderator',id:'one',message:'Blockiere Beispiel auf Twitch',username:'Moderator'}]);
 assert.equal(calls,0);assert.equal(f.jarvis.history[0].kind,'chat');
});
test('Jarvis volume shares existing service, no native target enumeration, and respects native failures',async()=>{
 const calls=[];const audio={targets:async()=>{throw Error('native helper must stay asleep');},state:async()=>({jarvis:{available:true,volume:55}}),set:async(id,patch)=>{calls.push({id,patch});return {available:true,volume:patch.volume,muted:false};}};
 assert.equal((await controlAudio(audio,{targetQuery:'Jarvis',delta:-5})).ok,true);
 assert.deepEqual(calls,[{id:'jarvis',patch:{volume:50}}]);
 audio.set=async()=>({available:false});await assert.rejects(controlAudio(audio,{targetQuery:'Windows',patch:{volume:20}}),/nicht bestätigt/);
});
test('ambiguous app names never change a different audio session',async()=>{
 let changed=false;const audio={targets:async()=>[{id:'app:a',name:'Game',available:true},{id:'app:b',name:'Game',available:true}],set:async()=>{changed=true;}};
 assert.equal((await controlAudio(audio,{targetQuery:'Game',patch:{volume:25}})).ok,false);assert.equal(changed,false);
});
