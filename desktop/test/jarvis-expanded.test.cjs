'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {resolveCommand,commandExamples}=require('../src/services/jarvis-commands.cjs');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-expanded-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const calls=[];
 const runtime={voice:{status:'idle',send:job=>calls.push(job)},listen:()=>{calls.push('listen');return {ok:true};}};
 const dual={config:{program:{scene:'Spiel',transition:'fade',durationMs:350,chat:true,events:false}},serial:fn=>fn(),program:async value=>{if(dual.fail)throw Error('Speichern fehlgeschlagen');dual.config.program=value;return {ok:true};},scene:async(...args)=>{calls.push(args);return {ok:true};}};
 const host={catalog:()=>({}),jarvisSettings:async()=>{calls.push('settings');return {ok:true,text:'Jarvis-Einstellungen geöffnet.'};},navigate:async view=>calls.push(view)};
 const controls=new SuiteControls({runtime,getHost:()=>host,getDual:()=>dual});
 const jarvis=runtime.jarvis=new JarvisCore({directory,control:a=>controls.executeFromJarvis(a),getCommandCatalog:()=>controls.catalog()});
 jarvis.settings.voiceEnabled=false;
 return {directory,calls,runtime,dual,host,controls,jarvis,parse:text=>resolveCommand(text,{catalog:controls.catalog()})};
}
test('chat role and source commands persist, enable reading and preserve platform restrictions and templates',async t=>{
 const f=fixture(t);
 f.jarvis.update({chatEnabled:false,chatPlatforms:['twitch'],chatTemplate:'{username}: {message}',chatAllowlist:['twitch:123']});
 for(const [command,mode] of [['Lies alle Chatnachrichten vor','all'],['Lies nur Moderatoren vor','moderators'],['Lies nur die Freigabeliste vor','allowlist']]){
  assert.equal((await f.jarvis.execute(command)).ok,true,command);assert.equal(f.jarvis.settings.chatMode,mode);assert.equal(f.jarvis.settings.chatEnabled,true);
 }
 for(const [command,source] of [['Lies aus verbundenen Chats vor','connected'],['Lies aus dem Chatfenster vor','window']]){
  assert.equal((await f.jarvis.execute(command)).ok,true);assert.equal(f.jarvis.settings.chatSource,source);
 }
 const saved=JSON.parse(fs.readFileSync(path.join(f.directory,'jarvis-settings.json')));
 assert.deepEqual(saved.chatPlatforms,['twitch']);assert.deepEqual(saved.chatAllowlist,['twitch:123']);assert.equal(saved.chatTemplate,'{username}: {message}');assert.deepEqual(f.calls,[]);
});
test('gift selection, subscription thanks and like settings keep user event templates intact',async t=>{
 const f=fixture(t),templates={...f.jarvis.settings.events.templates,gift:'Danke {username}: {giftname}',subscription:'Danke {username}'};
 f.jarvis.update({events:{templates}});
 for(const [phrase,mode] of [['Geschenk-Ansage auf Geschenkname und Coins','both'],['Geschenk-Ansage auf Coins','coins'],['Sage den Geschenknamen vor','gift']]){
  assert.equal((await f.jarvis.execute(phrase)).ok,true,phrase);assert.equal(f.jarvis.settings.events.giftAnnouncement,mode);
 }
 for(const phrase of ['Like-Schwelle auf 10.000','Lies Likes ab 10k vor','Like-Schwelle auf zehntausend']){
  assert.equal((await f.jarvis.execute(phrase)).ok,true,phrase);assert.equal(f.jarvis.settings.events.likeThreshold,10000);
 }
 for(const phrase of ['Likes ab 1000 ansagen','Likes ab eintausend ansagen']){
  assert.equal((await f.jarvis.execute(phrase)).ok,true,phrase);assert.equal(f.jarvis.settings.events.likeThreshold,1000);
 }
 assert.equal((await f.jarvis.execute('Bedanke dich nicht mehr für Abos')).ok,true);assert.equal(f.jarvis.settings.events.subscriptions,false);
 assert.equal((await f.jarvis.execute('Bedanke dich für Abos')).ok,true);assert.equal(f.jarvis.settings.events.subscriptions,true);
 assert.equal((await f.jarvis.execute('Bedanke dich für neue Follower')).ok,true);assert.equal(f.jarvis.settings.events.follows,true);
 assert.deepEqual(f.jarvis.settings.events.templates,templates);
});
test('numeric settings are validated in both parser and execution layer without saving partial commands',async t=>{
 const f=fixture(t);const before=JSON.stringify(f.jarvis.settings);
 for(const phrase of ['Sprechtempo auf 500','Lüfterwarnung ab 101 Prozent','Lüfterwarnung ab null Prozent','Like-Schwelle auf 0','Like-Schwelle auf Infinity','Geschenk-Ansage auf unbekannt','Chat-Länge auf 20 Zeichen','Übergangsdauer auf 5 Millisekunden','Lies alle Chatnachrichten vor und Kamera aus','Geschenk-Ansage auf Geschenkname und Coins und Kamera aus','Wenn ich sage Sprechtempo auf 190']){
  assert.notEqual(f.parse(phrase)?.kind,'action',phrase);assert.equal((await f.jarvis.execute(phrase)).ok,false,phrase);
 }
 for(const action of [
  {action:'jarvis-setting',target:'events.likeThreshold',value:NaN},
  {action:'jarvis-setting',target:'speechRate',value:Infinity},
  {action:'jarvis-setting',target:'speechRate',value:160.5},
  {action:'jarvis-setting',target:'speechRate',delta:1000},
  {action:'jarvis-setting',target:'chatMode',value:'anything'},
  {action:'jarvis-setting',target:'localAi',value:true},
  {action:'jarvis-setting',target:'__proto__.enabled',value:true},
  {action:'transition-duration',value:0}
 ])await assert.rejects(f.controls.executeFromJarvis(action));
 assert.equal(JSON.stringify(f.jarvis.settings),before);assert.deepEqual(f.calls,[]);
});
test('relative speaking pace clamps at supported bounds and does not start the microphone',async t=>{
 const f=fixture(t);
 for(const [phrase,wanted] of [['Sprechtempo auf einhundertsechzig',160],['Sprich langsamer',150],['Sprich etwas schneller',160],['Sprechtempo auf 210 Wörter pro Minute',210],['Sprich schneller',210],['Sprechtempo auf 120',120],['Sprich langsamer',120]]){
  const result=await f.jarvis.execute(phrase);assert.equal(result.ok,true,phrase);assert.equal(f.jarvis.settings.speechRate,wanted);assert.match(result.text,new RegExp(String(wanted)));
 }
 assert.deepEqual(f.calls,[]);
});
test('fan warning settings persist a single threshold and preserve hysteresis and cooldown',async t=>{
 const f=fixture(t);f.jarvis.update({fanAlerts:{threshold:80,hysteresis:7,cooldown:150}});
 assert.equal((await f.jarvis.execute('Lüfterwarnung ab fünfundsiebzig Prozent')).ok,true);
 assert.deepEqual(f.jarvis.settings.fanAlerts,{enabled:true,threshold:75,hysteresis:7,cooldown:150});
 assert.equal((await f.jarvis.execute('Lüfterwarnungen aus')).ok,true);
 const result=await f.jarvis.execute('Lüfterwarnung ab 90 Prozent');assert.match(result.text,/ausgeschaltet/);assert.equal(f.jarvis.settings.fanAlerts.enabled,false);
});
test('transition commands operate on the actual program and preserve current scene and overlays',async t=>{
 const f=fixture(t);
 assert.equal((await f.jarvis.execute('Übergang auf Schnitt')).ok,true);
 assert.equal((await f.jarvis.execute('Übergangsdauer auf 500 Millisekunden')).ok,true);
 assert.deepEqual(f.dual.config.program,{scene:'Spiel',transition:'cut',durationMs:500,chat:true,events:false});
 assert.equal((await f.jarvis.execute('Wechsle zur Pause mit Überblendung von 600 Millisekunden')).ok,true);
 assert.deepEqual(f.calls,[['Pause','fade',600]]);
 f.dual.fail=true;assert.equal((await f.jarvis.execute('Übergang auf Überblendung')).ok,false);assert.equal(f.dual.config.program.transition,'cut');
});
test('microphone reload enumerates only, microphone test listens explicitly, and settings open actual panel',async t=>{
 const f=fixture(t);
 assert.equal((await f.jarvis.execute('Mikrofone neu laden')).ok,true);assert.deepEqual(f.calls,[{command:'devices'}]);
 assert.equal(f.jarvis.settings.microphoneEnabled,false);
 assert.equal((await f.jarvis.execute('Mikrofon testen')).ok,true);assert.deepEqual(f.calls,[{command:'devices'},'listen']);
 for(const phrase of ['Jarvis Einstellungen öffnen','Öffne deine Einstellungen','Öffne Jarvis Einstellungen'])assert.equal((await f.jarvis.execute(phrase)).ok,true,phrase);
 assert.deepEqual(f.calls.slice(2),['settings','settings','settings']);
});
test('internal value actions stay out of deck fields but saved command buttons use them without deadlock',async t=>{
 const f=fixture(t);assert.equal(f.controls.catalog().actions.some(a=>a.id==='jarvis-setting'),false);
 await assert.rejects(f.controls.execute({action:'jarvis-setting',target:'chatMode',value:'all'}),/Unbekannte/);
 assert.equal((await f.controls.execute({action:'command',text:'Lies alle Chatnachrichten vor'})).ok,true);
 assert.equal(f.jarvis.settings.chatMode,'all');assert.equal(f.controls.busy,false);assert.equal(f.controls.jarvisDepth,0);
});
test('help examples use real available settings and remain valid commands',t=>{
 const f=fixture(t),examples=commandExamples(f.controls.catalog());
 for(const example of examples){if(example.template||example.expectedKind==='sensor')continue;const result=f.parse(example.phrase);if(example.expectedAction)assert.deepEqual(result?.action,example.expectedAction,example.phrase);else assert.equal(result?.kind,example.expectedKind,example.phrase);}
 assert(examples.some(e=>e.phrase==='Lies alle Chatnachrichten vor'));
 assert(examples.some(e=>e.phrase==='Geschenk-Ansage auf Geschenkname und Coins'));
 assert(examples.length>100);
});
test('connection and source aliases remain anchored to catalog targets',t=>{
 const f=fixture(t);
 for(const [phrase,action] of [
  ['Verbinde dich mit Twitch',{action:'connect',target:'twitch',op:'on'}],
  ['Trenne die Verbindung zu YouTube',{action:'connect',target:'youtube',op:'off'}],
  ['Blende die Webcam ein',{action:'source',target:'camera',op:'on'}],
  ['Verstecke das Kamerabild',{action:'source',target:'camera',op:'off'}]
 ])assert.deepEqual(f.parse(phrase).action,action,phrase);
});
