'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {applyCollection}=require('../src/dual-stream/obs-scene-import.cjs');
const {validate}=require('../src/dual-stream/config.cjs');
const {DualStream}=require('../src/dual-stream/service.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {resolveCommand,commandExamples}=require('../src/services/jarvis-commands.cjs');

function importedConfig(){
 const source={uuid:'background',name:'Local colour',id:'color_source',settings:{width:1920,height:1080,color:0xff102030}};
 const item=portrait=>({source_uuid:'background',visible:true,pos:{x:0,y:0},scale:{x:1,y:1},scale_ref:{x:portrait?1080:1920,y:portrait?1920:1080}});
 const names=['Start','Spiel','Pause','Chat','Ende','Offline','Pc'];
 const scenes=names.flatMap((name,index)=>{
  const portraitName=name==='Chat'?'chat_tt':name;
  return [{uuid:'wide-'+index,name,id:'scene',settings:{items:[item(false)],canvas:[{width:1080,height:1920,scene:portraitName}]}},
   {uuid:'tall-'+index,name:portraitName,id:'scene',settings:{items:[item(true)]}}];
 });
 scenes.push({uuid:'wide-only',name:'Szene 2',id:'scene',settings:{items:[item(false)]}});
 return applyCollection({name:'Synthetic platform collection',resolution:{x:1920,y:1080},sources:[source,...scenes]},{}).config;
}
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-platform-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const dual=new DualStream({directory,executable:'unused'}),calls=[];
 dual.config=importedConfig();dual.state={prepared:true,outputs:{}};
 dual.native={request:async(command,value)=>{calls.push({command,...value});return {prepared:true,outputs:{}};}};
 const runtime={voice:{status:'Test'}},controls=new SuiteControls({runtime,getDual:()=>dual,getHost:()=>({})});
 const jarvis=new JarvisCore({directory,getCommandCatalog:()=>controls.catalog(),control:action=>controls.executeFromJarvis(action)});
 runtime.jarvis=jarvis;jarvis.settings.voiceEnabled=false;jarvis.settings.learn=false;
 return {dual,calls,controls,jarvis,catalog:()=>controls.catalog(),parse:phrase=>resolveCommand(phrase,{catalog:controls.catalog()})};
}

test('qualified spoken and typed phrases execute exact imported IDs through the real catalog, controls and sender service',async t=>{
 const f=fixture(t);assert.equal(f.dual.config.obsCollection.scenes.length,15);
 const phrases=[
  ['TikTok Pause','obs:tall-2'],['Twitch Start','obs:wide-0'],
  ['Jarvis, schalte auf TikTok Pause','obs:tall-2'],['Pause auf Twitch','obs:wide-2'],
  ['Öffne die Szene Chat auf Twitch','obs:wide-3'],['TikTok Chat','obs:tall-3'],
  ['Jarvis, TikTok chat tt','obs:tall-3'],['Tik Tok Start','obs:tall-0'],
  ['Jarvis, kannst du bitte die TikTok Start Szene öffnen?','obs:tall-0'],
  ['Twitch Pausenszene','obs:wide-2'],['Wechsle zur Szene TikTok Spiel','obs:tall-1'],
  ['Szene Pause · TikTok öffnen','obs:tall-2'],['Twitch Szene 2','obs:wide-only']
 ];
 for(let index=0;index<phrases.length;index++){
  const [phrase,key]=phrases[index],result=await f.jarvis.execute(phrase,{source:index%2?'voice':'typed'});
  assert.equal(result.ok,true,phrase+': '+result.text);assert.equal(f.dual.config.program.scene,key,phrase);
  assert.deepEqual(f.calls.at(-1),{command:'scene',scene:key,transition:'fade',durationMs:350},phrase);
  assert.equal(JSON.parse(fs.readFileSync(f.dual.file,'utf8')).program.scene,key,phrase);
 }
 assert.equal(f.calls.length,phrases.length,'one native command per request, no output start');
 const paired=await f.jarvis.execute('TikTok Chat');assert.match(paired.text,/TikTok chat_tt/);assert.match(paired.text,/Twitch Chat/);assert.match(paired.text,/Szenenpaar/);
 const single=await f.jarvis.execute('Twitch Szene 2');assert.match(single.text,/beide Ausgaben/);
});

test('generic shortcuts, qualified scenes and transition choices remain distinct',async t=>{
 const f=fixture(t);
 for(const name of ['Start','Spiel','Pause','Ende']){
  const result=await f.jarvis.execute(name);assert.equal(result.ok,true,name);assert.equal(f.dual.config.program.scene,name);
 }
 f.jarvis.settings.sceneAliases.pause='Ende';
 assert.equal((await f.jarvis.execute('Pause')).ok,true);assert.equal(f.dual.config.program.scene,'Ende');
 assert.equal((await f.jarvis.execute('TikTok Pause mit Überblendung von 600 Millisekunden')).ok,true);
 assert.deepEqual(f.calls.at(-1),{command:'scene',scene:'obs:tall-2',transition:'fade',durationMs:600});
 assert.equal((await f.jarvis.execute('Twitch Start mit Schnitt')).ok,true);assert.equal(f.calls.at(-1).transition,'cut');
 assert.equal(f.dual.config.program.scene,'obs:wide-0');
});

test('platform qualifiers never fall back to another platform or a default shortcut when no scene exists',async t=>{
 const f=fixture(t),before=JSON.stringify(f.dual.config);let aiCalls=0;
 f.jarvis.settings.localAi=true;f.jarvis.askAi=async()=>{aiCalls++;return 'unexpected';};
 for(const phrase of ['TikTok Szene 2','Twitch Fehlend','Öffne die Szene Fehlend auf TikTok','TikTok Pause und Kamera aus']){
  assert.notEqual(f.parse(phrase)?.kind,'action',phrase);assert.equal((await f.jarvis.execute(phrase)).ok,false,phrase);
 }
 f.jarvis.settings.localAi=false;
 for(const phrase of ['Nicht Twitch Start','Wenn TikTok Pause']){assert.notEqual(f.parse(phrase)?.kind,'action',phrase);assert.equal((await f.jarvis.execute(phrase)).ok,false,phrase);}
 assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(f.dual.config),before);assert.equal(aiCalls,0);
 const empty={actions:[{id:'scene',choices:['Start','Pause'].map(id=>({id,name:id}))}]};
 assert.equal(resolveCommand('TikTok Pause',{catalog:empty}).kind,'ambiguous');
});

test('existing navigation, output start/stop, audio and connection phrases keep their original routing',t=>{
 const f=fixture(t);
 for(const [phrase,expected]of [
  ['Öffne TikTok LIVE Center',{action:'navigate',target:'livecenter'}],
  ['TikTok LIVE Center öffnen',{action:'navigate',target:'livecenter'}],
  ['Verbinde dich mit Twitch',{action:'connect',target:'twitch',op:'on'}],
  ['Trenne die Verbindung zu Twitch',{action:'connect',target:'twitch',op:'off'}],
  ['TikTok Chat verbinden',{action:'connect',target:'tikfinity',op:'on'}],
  ['Twitch Verbindung aus',{action:'connect',target:'twitch',op:'off'}],
  ['Starte Twitch',{action:'start',target:'twitch'}],['Stoppe TikTok',{action:'stop',target:'tiktok'}],
  ['TikTok virtuelle Kamera starten',{action:'start',target:'tiktok'}],
  ['Twitch stoppen',{action:'stop',target:'twitch'}],
  ['Starte TikTok LIVE Studio',{action:'companion',op:'on'}]
 ])assert.deepEqual(f.parse(phrase)?.action,expected,phrase);
 assert.deepEqual(f.parse('Twitch leiser'),{kind:'audio',targetQuery:'twitch',delta:-5});
 assert.deepEqual(f.parse('Blockiere Nutzer auf Twitch'),{kind:'moderation',operation:'ban',userName:'Nutzer',platform:'twitch'});
});

test('custom punctuation is normalized but colliding names and partner aliases require disambiguation',t=>{
 const f=fixture(t),scenes=f.dual.config.obsCollection.scenes;
 const change=(id,name)=>{const s=scenes.find(s=>s.id===id);s.name=name;s.label=name+' · '+(s.platform==='tiktok'?'TikTok':'Twitch');};
 change('tall-5','Nacht – Regen #2');change('wide-5','Nacht – Regen #2');
 assert.deepEqual(f.parse('Jarvis, TikTok NACHT - Regen #2!')?.action,{action:'scene',target:'obs:tall-5'});
 change('tall-4','Punkt!');change('tall-6','Punkt?');
 assert.equal(f.parse('TikTok Punkt').kind,'ambiguous');
 assert.deepEqual(f.parse('Öffne Szene "Punkt? · TikTok"')?.action,{action:'scene',target:'obs:tall-6'});
 change('wide-4','Gespräch');change('wide-6','Gespräch');
 assert.equal(f.parse('TikTok Gespräch').kind,'ambiguous','two partner aliases must not pick the first scene');
 assert.equal(f.parse('Twitch Gespräch').kind,'ambiguous');
 const examples=commandExamples(f.catalog());
 for(const example of examples.filter(e=>e.expectedAction?.action==='scene')){
  assert.deepEqual(f.parse(example.phrase)?.action,example.expectedAction,example.phrase);
  if(example.phrase.includes('"')){assert.equal(example.typedOnly,true);assert.match(example.description,/Textvariante/);}
 }
});

test('older label-only catalogs still accept explicit platform scene commands without guessing partner metadata',()=>{
 const catalog={actions:[{id:'scene',choices:[{id:'obs:pause',name:'Pause · TikTok'},{id:'obs:start',name:'Start · Twitch'}]}]};
 assert.deepEqual(resolveCommand('TikTok Pause',{catalog}).action,{action:'scene',target:'obs:pause'});
 assert.deepEqual(resolveCommand('Start auf Twitch',{catalog}).action,{action:'scene',target:'obs:start'});
 assert.match(resolveCommand('TikTok Pause',{catalog}).reply,/beide Ausgaben/);
});

test('Jarvis help separates platform scenes, describes paired switching and updates after a scene rename or removal',t=>{
 const f=fixture(t),first=f.jarvis.commandExamples(),sceneExamples=first.filter(e=>e.expectedAction?.action==='scene');
 assert.equal(sceneExamples.filter(e=>e.category==='TikTok-Szenen').length,7);
 assert.equal(sceneExamples.filter(e=>e.category==='Twitch-Szenen').length,8);
 assert(sceneExamples.some(e=>e.phrase==='TikTok Pause'&&e.description.includes('beide Ausgaben')));
 assert(sceneExamples.some(e=>e.phrase==='Twitch Start'));
 for(const example of sceneExamples){assert.deepEqual(f.parse(example.phrase)?.action,example.expectedAction,example.phrase);for(const prefix of ['Nicht ','Wenn '])assert.notEqual(f.parse(prefix+example.phrase)?.kind,'action');}
 assert.strictEqual(f.jarvis.commandExamples(),first,'normal updates reuse the help list');
 const original=f.dual.config.obsCollection.scenes.find(s=>s.id==='wide-only');original.name='Spezial';original.label='Spezial · Twitch';
 const renamed=f.jarvis.commandExamples();assert.notStrictEqual(renamed,first);assert(renamed.some(e=>e.phrase==='Twitch Spezial'));
 f.dual.config.obsCollection.scenes=f.dual.config.obsCollection.scenes.filter(s=>s.id!=='wide-only');f.dual.config=validate(f.dual.config);
 assert(!f.jarvis.commandExamples().some(e=>e.expectedAction?.target==='obs:wide-only'));
 assert.equal(f.parse('Twitch Spezial').kind,'ambiguous');
});

test('a native scene-switch failure does not persist or announce the requested scene',async t=>{
 const f=fixture(t),before=JSON.stringify(f.dual.config);f.dual.native.request=async()=>{throw Error('Szenenwechsel fehlgeschlagen');};
 const result=await f.jarvis.execute('Jarvis, TikTok Pause');
 assert.equal(result.ok,false);assert.match(result.text,/fehlgeschlagen/);assert.doesNotMatch(result.text,/ausgewählt/);
 assert.equal(JSON.stringify(f.dual.config),before);assert.equal(fs.existsSync(f.dual.file),false);
});
