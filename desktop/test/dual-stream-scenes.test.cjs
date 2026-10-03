'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DualStream}=require('../src/dual-stream/service.cjs');
const {defaults,validate}=require('../src/dual-stream/config.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {TouchDeck,defaultConfig}=require('../src/services/touch-deck.cjs');
function collection(){return {version:1,name:'Synthetic OBS collection',sources:[],scenes:[
 {id:'wide',key:'obs:wide',name:'Intermission',label:'Intermission · Twitch',platform:'twitch',width:1920,height:1080,partnerId:'portrait',items:[]},
 {id:'portrait',key:'obs:portrait',name:'Intermission',label:'Intermission · TikTok',platform:'tiktok',width:1080,height:1920,partnerId:'wide',items:[]},
 {id:'credits',key:'obs:credits',name:'Abspann',label:'Abspann',platform:'twitch',width:1920,height:1080,partnerId:'',items:[]}
 ],aliases:{tiktok:{Pause:'portrait'},twitch:{Pause:'wide'}},warnings:[]};}
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-dynamic-scenes-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const dual=new DualStream({directory,executable:'missing',safeStorage:{}});dual.config=validate({...defaults(),obsCollection:collection()});return {directory,dual};}
test('imported scenes remain available after service selection, program save and restart',async t=>{
 const {directory,dual}=fixture(t);assert.equal(dual.snapshot().sceneChoices.length,7);
 await dual.scene('Abspann');assert.equal(dual.config.program.scene,'obs:credits');await dual.program({...dual.config.program,events:false});
 const restored=new DualStream({directory,executable:'missing',safeStorage:{}});assert.equal(restored.config.program.scene,'obs:credits');assert.equal(restored.config.obsCollection.scenes.length,3);
 const list=await restored.obs('GetSceneList');assert.equal(list.scenes.find(x=>x.sceneUuid==='obs:portrait').sceneName,'Intermission · TikTok');assert.equal(list.currentProgramSceneName,'Abspann');
 await restored.obs('SetCurrentProgramScene',{sceneName:'Intermission · TikTok'});assert.equal(restored.config.program.scene,'obs:portrait');await assert.rejects(restored.scene('Intermission'),/mehrfach/);await assert.rejects(restored.scene('missing'),/nicht vorhanden/);
});
test('native scene requests use the canonical imported key and retain transition settings',async t=>{
 const {dual}=fixture(t),calls=[];dual.state={prepared:true,outputs:{}};dual.native={request:async(command,fields)=>{calls.push({command,fields});return {prepared:true,outputs:{}};}};
 await dual.scene('Intermission · Twitch','cut',400);assert.deepEqual(calls,[{command:'scene',fields:{scene:'obs:wide',transition:'cut',durationMs:400}}]);assert.equal(dual.config.program.scene,'obs:wide');
});
test('deleting a default shortcut background detaches only its selected output, preserving imported originals',async t=>{
 const {dual}=fixture(t);await dual.background({scene:'Pause',platform:'tiktok'},null);
 assert.equal(dual.config.obsCollection.aliases.tiktok.Pause,undefined);assert.equal(dual.config.obsCollection.aliases.twitch.Pause,'wide');assert.equal(dual.config.program.platformBackgrounds.tiktok.Pause,null);assert.equal(dual.config.obsCollection.scenes.length,3);
 await assert.rejects(dual.background({scene:'obs:wide',platform:'twitch'},null),/Unbekannte Szene/);await dual.scene('obs:wide');assert.equal(dual.config.program.scene,'obs:wide');
});
test('imported windows can be hidden by controls when the built-in game source is disabled',async t=>{
 const {dual}=fixture(t);dual.config.obsCollection.sources.push({id:'chat-window',name:'Chat window',type:'window_capture',settings:{window:'Synthetic title:class:synthetic.exe'}});dual.config=validate(dual.config);
 const nativeState={prepared:true,outputs:{},sources:[{id:'obs:chat-window',width:640,height:480}]},calls=[];dual.client=async()=>dual.native={request:async(command,value)=>{calls.push({command,value});return nativeState;}};
 await dual.prepare();clearTimeout(dual.idleTimer);assert.equal(dual.sourceState.game,true);assert.equal(dual.config.sources.game.enabled,false);await dual.source('game',false);assert.equal(dual.sourceState.game,false);assert(calls.some(x=>x.command==='source'&&x.value.source==='game'&&x.value.enabled===false));
 await assert.rejects(dual.source('camera',true),/nicht eingeschaltet/);dual.state={prepared:true,outputs:{},sources:[]};await assert.rejects(dual.source('game',true),/nicht eingeschaltet/);
});
test('Jarvis and Touch Deck resolve imported scenes through the same live control catalog',async t=>{
 const {directory,dual}=fixture(t),jarvis=new JarvisCore({directory});jarvis.settings.voiceEnabled=false;jarvis.settings.learn=false;
 const controls=new SuiteControls({runtime:{jarvis,voice:{status:'Test'}},getDual:()=>dual,getHost:()=>({})});jarvis.getCommandCatalog=()=>controls.catalog();jarvis.control=value=>controls.executeFromJarvis(value);
 assert.equal(controls.catalog().actions.find(x=>x.id==='scene').choices.length,7);
 assert.equal((await jarvis.execute('Öffne Szene Abspann')).ok,true);assert.equal(dual.config.program.scene,'obs:credits');
 jarvis.settings.sceneAliases.pause='Intermission · TikTok';assert.equal((await jarvis.execute('Pause')).ok,true);assert.equal(dual.config.program.scene,'obs:portrait');
 const deck=new TouchDeck({directory,controls});t.after(()=>deck.close());const config=defaultConfig();config.profiles[0].buttons[0].steps=[{action:'scene',target:'obs:wide',transition:'cut',durationMs:350}];deck.save(config);await deck.press({profileId:'main',index:0});assert.equal(dual.config.program.scene,'obs:wide');
 const examples=jarvis.snapshot().commandExamples;assert(examples.some(x=>x.phrase.includes('Abspann')));
});
