'use strict';
process.env.BATTO_TEST_INSTANCE='1';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SuiteRuntime,VoiceClient}=require('../src/services/suite-runtime.cjs');
const {cleanSettings}=require('../src/services/jarvis-core.cjs');
const settled=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(t,{ambient=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-routing-'));
 const calls=[],jobs=[];
 const obs={connected:true,request:async(command,value)=>{
  calls.push({command,value});
  return command==='GetSceneList'?{scenes:[{sceneName:'Pause'},{sceneName:'Spiel'}]}:{};
 }};
 const runtime=new SuiteRuntime({directory,fanRoot:directory,voiceCode:directory,voiceBundle:directory,obs});
 runtime.jarvis.settings=cleanSettings({voiceEnabled:true,microphoneEnabled:ambient,sceneAliases:{pause:'Pause'}});
 runtime.voice.settings=runtime.jarvis.settings;
 // Protocol-level test double: no Python child, model, sound output or microphone.
 runtime.voice.child={stdin:{write(){},end(){}},exitCode:0};
 runtime.voice.send=job=>jobs.push(job);
 t.after(async()=>{await runtime.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {runtime,calls,jobs};
}

test('voice transcript executes a scene exactly once and completes the button listening turn',async t=>{
 const {runtime,calls,jobs}=fixture(t);
 assert.equal(runtime.listen().ok,true);
 runtime.voice.emit('event',{type:'transcript',text:'Pause'});
 await settled();
 assert.equal(calls.filter(c=>c.command==='SetCurrentProgramScene').length,1);
 assert.deepEqual(calls.find(c=>c.command==='SetCurrentProgramScene').value,{sceneName:'Pause'});
 assert.equal(runtime.listeningUntil,0);
 assert.equal(jobs.filter(j=>j.command==='microphone'&&j.enabled===false).length,1);
 assert.equal(jobs.filter(j=>j.command==='complete').length,1);
 assert(jobs.some(j=>j.command==='speak'&&/Pause/.test(j.text)));
});

test('push to talk queues a greeting and rejects a second press while already listening',t=>{
 const {runtime,jobs}=fixture(t);
 assert.equal(runtime.listen().ok,true);
 assert.equal(runtime.listen().ok,false);
 assert.deepEqual(jobs,[{command:'listen',greeting:'Wie kann ich helfen?'}]);
 assert(!jobs.some(j=>j.command==='microphone'&&j.enabled===true));
});

test('ambient wake mode keeps its microphone enabled after a successful command',async t=>{
 const {runtime,calls,jobs}=fixture(t,{ambient:true});
 runtime.voice.emit('event',{type:'transcript',text:'Jarvis Pause'});
 await settled();
 assert.equal(calls.filter(c=>c.command==='SetCurrentProgramScene').length,1);
 assert(!jobs.some(j=>j.command==='microphone'&&j.enabled===false));
 assert.equal(jobs.filter(j=>j.command==='complete').length,1);
});

test('a preserved spoken Jarvis address changes his voice volume through the real audio service',async t=>{
 const {runtime,jobs}=fixture(t,{ambient:true});
 runtime.voice.emit('event',{type:'transcript',text:'Jarvis leiser'});
 await settled();
 assert.equal(runtime.jarvis.settings.speechVolume,95);
 assert.equal(runtime.audio.child,null,'Own-voice volume needs no Windows audio helper');
 assert(jobs.some(job=>job.command==='speak'&&/Jarvis: 95 Prozent/.test(job.text)));
 assert.equal(jobs.filter(job=>job.command==='complete').length,1);
});

test('silence and recognizer errors end a button session without executing a command',t=>{
 const {runtime,calls,jobs}=fixture(t);
 runtime.listen();runtime.voice.emit('event',{type:'turn-end'});
 assert.equal(runtime.listeningUntil,0);
 runtime.listen();runtime.voice.emit('event',{type:'error',text:'Test: kein Mikrofon'});
 assert.equal(runtime.listeningUntil,0);
 assert.equal(calls.length,0);
 assert.equal(jobs.filter(j=>j.command==='microphone'&&j.enabled===false).length,2);
 assert(!jobs.some(j=>j.command==='complete'));
});

test('stopping a button session cancels speech and releases the temporary microphone',t=>{
 const {runtime,jobs}=fixture(t);
 runtime.listen();jobs.length=0;
 runtime.stopSpeech();
 assert.equal(runtime.listeningUntil,0);
 assert.deepEqual(jobs,[{command:'stop'},{command:'microphone',enabled:false}]);
});

test('ordinary settings and idle stop do not start an audio process',t=>{
 const {runtime,jobs}=fixture(t);runtime.voice.child=null;jobs.length=0;
 runtime.stopSpeech();assert.deepEqual(jobs,[]);
 const voice=new VoiceClient({codeRoot:'unused',bundledRoot:'unused',data:'unused'});
 let starts=0;voice.start=()=>starts++;
 voice.configure(cleanSettings({microphoneEnabled:false,speechVolume:35}));
 voice.configure(cleanSettings({microphoneEnabled:false,speechVolume:80}));
 assert.equal(starts,0);assert.equal(voice.child,null);voice.close();
});

test('a failed scene action does not report success and still releases the recognition turn',async t=>{
 const {runtime,jobs}=fixture(t);
 runtime.obs.request=async command=>{
  if(command==='GetSceneList')return {scenes:[{sceneName:'Pause'}]};
  throw Error('Sender ist nicht verbunden.');
 };
 runtime.voice.emit('event',{type:'transcript',text:'Pause'});
 await settled();
 assert(runtime.jarvis.history.some(h=>h.kind==='error'&&/nicht verbunden/.test(h.text)));
 assert(!runtime.jarvis.history.some(h=>/ist ausgewählt/.test(h.text)));
 assert.equal(jobs.filter(j=>j.command==='complete').length,1);
 assert.equal(runtime.jarvis.commandBusy,false);
});

test('malformed recognition payloads are reported without executing or leaving a busy turn',async t=>{
 const {runtime,calls,jobs}=fixture(t);
 runtime.voice.emit('event',{type:'transcript',text:{unexpected:'Pause'}});
 await settled();
 assert.equal(calls.length,0);
 assert(runtime.jarvis.history.some(h=>h.kind==='error'&&/gültigen Befehl/.test(h.text)));
 assert.equal(jobs.filter(j=>j.command==='complete').length,1);
});

test('an action finishing during shutdown cannot restart a speech process',async t=>{
 const {runtime,jobs}=fixture(t);let resolveScene;
 runtime.obs.request=async command=>command==='GetSceneList'?{scenes:[{sceneName:'Pause'}]}:
  new Promise(resolve=>{resolveScene=resolve;});
 runtime.voice.emit('event',{type:'transcript',text:'Pause'});
 await settled();assert.equal(typeof resolveScene,'function');
 await runtime.close();jobs.length=0;
 resolveScene({});await settled();
 assert.deepEqual(jobs,[],'A closed runtime must not send speak/complete and resurrect VoiceClient');
});

test('stopping or closing Jarvis aborts the local model fetch and releases the command lock',async t=>{
 for(const close of [false,true]){
  const {runtime,jobs}=fixture(t);runtime.jarvis.settings.localAi=true;let signal;
  const mocked=t.mock.method(globalThis,'fetch',(_url,options)=>{
   signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });
  const pending=runtime.jarvis.execute('Was ist ein Planet?');
  assert.equal(signal.aborted,false);
  if(close)await runtime.close();else runtime.stopSpeech();
  assert.equal(signal.aborted,true);assert.equal((await pending).ok,false);
  assert.equal(runtime.jarvis.commandBusy,false);assert(!jobs.some(job=>job.command==='speak'));
  mocked.mock.restore();
 }
});

test('an immediate speech startup failure is not reported as a listening session',t=>{
 const {runtime}=fixture(t);runtime.voice.send=()=>false;runtime.voice.status='Sprachpaket fehlt.';
 assert.deepEqual(runtime.listen(),{ok:false,text:'Sprachpaket fehlt.'});assert.equal(runtime.listeningUntil,0);
});
