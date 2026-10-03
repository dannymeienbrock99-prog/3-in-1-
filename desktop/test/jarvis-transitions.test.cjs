'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DualStream}=require('../src/dual-stream/service.cjs');
const {applyCollection}=require('../src/dual-stream/obs-scene-import.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {resolveCommand}=require('../src/services/jarvis-commands.cjs');
const {TouchDeck,defaultConfig}=require('../src/services/touch-deck.cjs');

function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-transitions-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 // Only file existence is relevant to service validation. No native decoder,
 // camera, stream, microphone or user's configuration is opened by this test.
 const video=path.join(directory,'synthetic-stinger.mp4');fs.writeFileSync(video,'synthetic test fixture');
 const source={uuid:'color',name:'Colour',id:'color_source',settings:{width:1920,height:1080,color:0xff102030}},item=portrait=>({source_uuid:'color',visible:true,pos:{x:0,y:0},scale:{x:1,y:1},scale_ref:{x:portrait?1080:1920,y:portrait?1920:1080}});
 const scenes=['Start','Pause','Spiel mit Chat'].flatMap((name,i)=>[{uuid:'wide-'+i,name,id:'scene',settings:{items:[item(false)],canvas:[{width:1080,height:1920,scene:name+'_tt'}]}},{uuid:'tall-'+i,name:name+'_tt',id:'scene',settings:{items:[item(true)]}}]);
 const dual=new DualStream({directory,executable:'not-used'});
 dual.config=applyCollection({name:'Synthetic collection',resolution:{x:1920,y:1080},sources:[source,...scenes]},{}).config;
 dual.config.transitions=[{id:'obs-transition:synthetic',name:'Stinger',type:'stinger',settings:{path:video}}];
 const calls=[],host={catalog:()=>({}),navigate:async name=>{calls.push({navigate:name});return {ok:true};}};
 const runtime={voice:{status:'idle'}},controls=new SuiteControls({runtime,getDual:()=>dual,getHost:()=>host});
 const jarvis=runtime.jarvis=new JarvisCore({directory,getCommandCatalog:()=>controls.catalog(),control:action=>controls.executeFromJarvis(action)});
 jarvis.settings.voiceEnabled=false;jarvis.settings.learn=false;
 const prepare=()=>{dual.state={prepared:true,outputs:{}};dual.native={request:async(command,value)=>{calls.push({command,...value});return {prepared:true,outputs:{}};}};};
 return {directory,video,dual,calls,controls,jarvis,prepare,parse:input=>resolveCommand(input,{catalog:controls.catalog()}),sceneCalls:()=>calls.filter(call=>call.command==='scene')};
}

test('Jarvis selects an imported transition without preparing capture, then ordinary scene commands inherit it',async t=>{
 const f=fixture(t),before={...f.dual.config.program};
 const chosen=await f.jarvis.execute('Jarvis, Übergang auf Stinger');
 assert.equal(chosen.ok,true);assert.match(chosen.text,/Stinger/);assert.equal(f.dual.native,null);
 assert.deepEqual(f.dual.config.program,{...before,transition:'obs-transition:synthetic'});
 f.prepare();
 for(const phrase of ['TikTok Pause','Twitch Start','Start Szene öffnen'])assert.equal((await f.jarvis.execute(phrase,{source:'voice'})).ok,true,phrase);
 assert.deepEqual(f.sceneCalls().map(call=>[call.scene,call.transition]),[['obs:tall-1','obs-transition:synthetic'],['obs:wide-0','obs-transition:synthetic'],['Start','obs-transition:synthetic']]);
 assert.equal(JSON.parse(fs.readFileSync(f.dual.file,'utf8')).program.transition,'obs-transition:synthetic');
});

test('spoken and typed scene phrases execute selected Stingers through the actual sender service',async t=>{
 const f=fixture(t);f.prepare();
 for(const [phrase,target]of [['TikTok Pause mit Stinger','obs:tall-1'],['Twitch Start mit dem Übergang Stinger','obs:wide-0'],['Jarvis, kannst du bitte die TikTok Start Szene öffnen mit Stinger?','obs:tall-0']]){
  assert.equal((await f.jarvis.execute(phrase)).ok,true,phrase);
  assert.deepEqual(f.sceneCalls().at(-1),{command:'scene',scene:target,transition:'obs-transition:synthetic',durationMs:350});
 }
 assert.equal((await f.jarvis.execute('Twitch Start mit Überblenden von 600 Millisekunden')).ok,true);
 assert.equal(f.sceneCalls().at(-1).transition,'fade');assert.equal(f.sceneCalls().at(-1).durationMs,600);
 assert.equal((await f.jarvis.execute('TikTok Pause mit Schnitt')).ok,true);assert.equal(f.sceneCalls().at(-1).transition,'cut');
});

test('imported transition names and scene names remain literal and do not hijack another command',async t=>{
 const f=fixture(t);
 assert.deepEqual(f.parse('Twitch Spiel mit Chat').action,{action:'scene',target:'obs:wide-2'});
 assert.deepEqual(f.parse('Verbinde dich mit Twitch').action,{action:'connect',target:'twitch',op:'on'});
 f.dual.config.transitions[0].name='Rot und Blau';
 assert.equal((await f.jarvis.execute('Übergang auf Rot und Blau')).ok,true);
 assert.deepEqual(f.parse('TikTok Pause mit Rot und Blau').action,{action:'scene',target:'obs:tall-1',transition:'obs-transition:synthetic'});
 assert.notEqual(f.parse('TikTok Pause mit Rot und Blau und Kamera aus')?.kind,'action');
});

test('unknown, ambiguous or missing-file transitions never change scenes or report success',async t=>{
 const f=fixture(t);f.prepare();let aiCalls=0;f.jarvis.settings.localAi=true;f.jarvis.askAi=async()=>{aiCalls++;return 'unexpected';};
 const before=JSON.stringify(f.dual.config);
 for(const phrase of ['Übergang auf Unbekannt','TikTok Pause mit Unbekannt','TikTok Pause mit Stinger und Kamera aus','Twitch Start mit Stinger von 10 Millisekunden'])assert.equal((await f.jarvis.execute(phrase)).ok,false,phrase);
 f.dual.config.transitions.push({...f.dual.config.transitions[0],id:'obs-transition:duplicate'});
 assert.equal(f.parse('Übergang auf Stinger').kind,'ambiguous');assert.equal(f.parse('Twitch Start mit Stinger').kind,'ambiguous');
 f.dual.config.transitions.pop();fs.unlinkSync(f.video);
 const failure=await f.jarvis.execute('Twitch Start mit Stinger');assert.equal(failure.ok,false);assert.match(failure.text,/Videodatei.*fehlt/);
 assert.equal((await f.jarvis.execute('Übergang auf Stinger')).ok,false);
 assert.deepEqual(f.sceneCalls(),[]);assert.equal(JSON.stringify(f.dual.config),before);assert.equal(aiCalls,0);
});

test('dynamic transition help round-trips exact choices, including quoted ambiguous names and catalog changes',t=>{
 const f=fixture(t);let examples=f.jarvis.commandExamples();
 assert(examples.some(item=>item.phrase==='Übergang auf Stinger'));
 assert(examples.some(item=>item.expectedAction?.transition==='obs-transition:synthetic'));
 f.dual.config.transitions.push({...f.dual.config.transitions[0],id:'obs-transition:duplicate'});
 examples=f.jarvis.commandExamples();
 for(const item of examples.filter(item=>item.expectedAction?.action==='transition'||item.expectedAction?.transition))assert.deepEqual(f.parse(item.phrase)?.action,item.expectedAction,item.phrase);
 assert(examples.filter(item=>item.expectedAction?.action==='transition'&&item.expectedAction.target.startsWith('obs-transition:')).every(item=>item.typedOnly));
 f.dual.config.transitions=[];
 assert(!f.jarvis.commandExamples().some(item=>item.expectedAction?.target?.startsWith('obs-transition:')));
});

test('Touch Deck and saved Stream Deck commands use imported transitions and validate whole combinations before execution',async t=>{
 const f=fixture(t),deck=new TouchDeck({directory:path.join(f.directory,'deck'),controls:f.controls});t.after(()=>deck.close());
 const catalog=f.controls.catalog(),scene=catalog.actions.find(item=>item.id==='scene');
 assert(scene.transitionChoices.some(item=>item.id==='obs-transition:synthetic'));
 const config=defaultConfig();config.profiles[0].buttons[0].steps=[{action:'scene',target:'obs:tall-1',transition:'obs-transition:synthetic'}];
 deck.save(config);f.prepare();assert.equal((await deck.press({profileId:'main',index:0})).ok,true);assert.equal(f.sceneCalls().at(-1).transition,'obs-transition:synthetic');
 assert.equal((await f.controls.execute({action:'command',text:'Twitch Start mit Stinger'})).ok,true);assert.equal(f.sceneCalls().at(-1).scene,'obs:wide-0');
 f.dual.config.transitions=[];f.calls.length=0;
 config.profiles[0].buttons[0].steps.unshift({action:'navigate',target:'jarvis'});deck.save(config);
 await assert.rejects(deck.press({profileId:'main',index:0}),/Übergang/);assert.deepEqual(f.calls,[]);
 const restored=new TouchDeck({directory:deck.directory,controls:f.controls});t.after(()=>restored.close());assert.equal(restored.loadError,'');assert.equal(restored.config.profiles[0].buttons[0].steps[1].transition,'obs-transition:synthetic');
});

test('missing Stinger files fail complete combinations before any preceding action, while explicit cut can replace a broken default',async t=>{
 const f=fixture(t);fs.unlinkSync(f.video);
 for(const last of [{action:'transition',target:'obs-transition:synthetic'},{action:'scene',target:'Pause',transition:'obs-transition:synthetic'}])await assert.rejects(f.controls.execute({steps:[{action:'navigate',target:'jarvis'},last]}),/Videodatei.*fehlt/);
 f.dual.config.program.transition='obs-transition:synthetic';
 await assert.rejects(f.controls.execute({steps:[{action:'navigate',target:'jarvis'},{action:'scene',target:'Pause'}]}),/Videodatei.*fehlt/);
 assert.deepEqual(f.calls,[]);
 assert.equal((await f.controls.execute({steps:[{action:'transition',target:'cut'},{action:'scene',target:'Pause'}]})).ok,true);
 assert.equal(f.dual.config.program.transition,'cut');
});
