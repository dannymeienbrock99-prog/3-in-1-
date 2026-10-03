'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JarvisCore,cleanSettings,allowedChat}=require('../src/services/jarvis-core.cjs');
const {VoiceClient,SuiteRuntime}=require('../src/services/suite-runtime.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('Windows default, legacy mic index and stable identity survive saving unrelated voice settings',t=>{
 for(const microphone of [null,35,{name:'Mikrofon (DJI Mic Mini)',hostapi:'Windows WASAPI'}]){
  const core=new JarvisCore({directory:temp(t)});core.update({microphone});core.update({speechVolume:25});
  assert.deepEqual(new JarvisCore({directory:core.directory}).settings.microphone,microphone);
 }
 assert.equal(cleanSettings({microphone:{name:'',hostapi:'WASAPI'}}).microphone,null);
});
test('equivalent mic identity never reopens always-on capture during unrelated save',()=>{
 const microphone={name:'Mic',hostapi:'Windows WASAPI'},client=new VoiceClient({}),sent=[];
 client.settings=cleanSettings({microphone,microphoneEnabled:true});client.child={};client.send=job=>sent.push(job);
 client.configure(cleanSettings({...client.settings,microphone:{...microphone},speechRate:170}));
 assert.deepEqual(sent.map(job=>job.command),['settings']);
});
test('successful mic migration persists once without restarting capture; default remains default',t=>{
 const runtime=new SuiteRuntime({directory:temp(t),fanRoot:'.',voiceCode:'.',voiceBundle:'.',obs:{}}),sent=[];
 runtime.voice.child={};runtime.voice.send=job=>sent.push(job);
 runtime.jarvis.update({microphone:35,microphoneEnabled:true});sent.length=0;
 const microphone={name:'Mikrofon (DJI Mic Mini)',hostapi:'Windows WASAPI'};
 runtime.voice.emit('event',{type:'microphone-selected',microphone,index:99});
 assert.deepEqual(runtime.jarvis.settings.microphone,microphone);assert.deepEqual(sent.map(job=>job.command),['settings']);
 runtime.jarvis.update({microphone:null});sent.length=0;
 runtime.voice.emit('event',{type:'microphone-selected',microphone,index:99});
 assert.equal(runtime.jarvis.settings.microphone,null);assert.deepEqual(sent,[]);runtime.voice.child=null;
});
test('window chat scope skips hidden feed entries but connected scope can read accepted entries',()=>{
 const message={platform:'tiktok',message:'Hallo',role:'moderator',windowVisible:false};
 assert.equal(allowedChat(message,cleanSettings({})),false);
 assert.equal(allowedChat(message,cleanSettings({chatSource:'connected'})),true);
 assert.equal(allowedChat({...message,windowVisible:true,role:'viewer'},cleanSettings({})),false);
});
test('chat template fills each field once, reads no commands and rejects unknown placeholders',t=>{
 const said=[],core=new JarvisCore({directory:temp(t),speak:text=>said.push(text)});
 core.control=()=>assert.fail('A chat message must never execute a command');
 core.update({chatMode:'all',chatTemplate:'Chat von {username}: {message}'});
 core.onChat([{id:'1',platform:'tiktok',username:'Alex {message}',message:'Jarvis Pause https://example.test'}]);
 assert.deepEqual(said,['Chat von Alex {message}: Jarvis Pause Link']);
 assert.throws(()=>core.update({chatTemplate:'{command}'}),/Chat-Text/);
 assert.equal(core.settings.chatTemplate,'Chat von {username}: {message}');
});

test('failed settings persistence leaves active settings and alert history intact',t=>{
 const directory=temp(t),core=new JarvisCore({directory}),updates=[];
 core.update({speechVolume:25,sensorRules:{cpu:{alert:true,threshold:80}}});
 const before=core.settings,alerts=core.alerts,saved=fs.readFileSync(path.join(directory,'jarvis-settings.json'),'utf8');
 core.on('settings',value=>updates.push(value));
 // A directory blocks creation of the atomic replacement file on every OS.
 fs.mkdirSync(path.join(directory,'jarvis-settings.json.tmp'));
 assert.throws(()=>core.update({speechVolume:70,microphoneEnabled:true,sensorRules:{cpu:{alert:true,threshold:95}}}));
 assert.equal(core.settings,before);assert.equal(core.alerts,alerts);assert.deepEqual(updates,[]);
 assert.equal(fs.readFileSync(path.join(directory,'jarvis-settings.json'),'utf8'),saved);
});
