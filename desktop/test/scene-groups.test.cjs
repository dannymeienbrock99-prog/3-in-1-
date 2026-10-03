'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {defaults,validate,sceneChoices}=require('../src/dual-stream/config.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');

function scene(id,name,platform,partnerId='',extra={}){
 return {id,key:'obs:'+id,name,label:name+' · '+(platform==='tiktok'?'TikTok':'Twitch'),platform,width:platform==='tiktok'?1080:1920,height:platform==='tiktok'?1920:1080,partnerId,items:[],...extra};
}
function config(scenes){return validate({...defaults(),obsCollection:{version:1,name:'Synthetic grouped scenes',sources:[],scenes,aliases:{tiktok:{},twitch:{}},warnings:[]}});}
function imported(c){return sceneChoices(c).filter(s=>s.platform);}
function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}

test('scene choices keep the standard shortcuts and group imported scenes by TikTok and Twitch',()=>{
 const c=config([scene('wide-pause','Pause','twitch'),scene('tall-start','Start','tiktok'),scene('wide-start','Start','twitch'),scene('tall-pause','Pause','tiktok')]);
 const choices=sceneChoices(c);
 assert.deepEqual(choices.slice(0,4),['Spiel','Start','Pause','Ende'].map(value=>({value,label:value})));
 assert.deepEqual(choices.slice(4).map(s=>[s.platform,s.name]),[['tiktok','Start'],['tiktok','Pause'],['twitch','Start'],['twitch','Pause']]);
 assert.deepEqual(sceneChoices(undefined),choices.slice(0,4));
});

test('scene grouping uses a stream-friendly order followed by natural numeric order',()=>{
 const names=['Szene 10','Offline','Pause','Ende','Szene 2','PC','Chat','Spiel','Start'];
 const c=config(names.flatMap((name,i)=>[scene('w'+i,name,'twitch'),scene('t'+i,name,'tiktok')]));
 for(const platform of ['tiktok','twitch'])assert.deepEqual(imported(c).filter(s=>s.platform===platform).map(s=>s.name),['Start','Spiel','Pause','Chat','Ende','Offline','PC','Szene 2','Szene 10']);
});

test('semantic aliases and platform suffixes have the same presentation rank',()=>{
 const names=['Setup','OFFLINE Twitch','Abspann','Just Chatting','Bin gleich zurück','Gaming','STREAM STARTET'];
 const c=config(names.map((name,i)=>scene('scene'+i,name,'twitch')));
 assert.deepEqual(imported(c).map(s=>s.name),['STREAM STARTET','Gaming','Bin gleich zurück','Just Chatting','Abspann','OFFLINE Twitch','Setup']);
});

test('portrait partners retain the landscape order even when their original names differ',()=>{
 const c=config([
  scene('t-chat','chat_tt','tiktok','w-chat'),scene('w-2','Szene 2','twitch','t-2'),
  scene('t-10','A special portrait','tiktok','w-10'),scene('w-chat','Chat','twitch','t-chat'),
  scene('t-2','Z special portrait','tiktok','w-2'),scene('w-10','Szene 10','twitch','t-10'),
  scene('w-start','Start','twitch','t-start'),scene('t-start','Begrüßung','tiktok','w-start')
 ]);
 const choices=imported(c),portrait=choices.filter(s=>s.platform==='tiktok'),landscape=choices.filter(s=>s.platform==='twitch');
 assert.deepEqual(landscape.map(s=>s.name),['Start','Chat','Szene 2','Szene 10']);
 assert.deepEqual(portrait.map(s=>s.name),['Begrüßung','chat_tt','Z special portrait','A special portrait']);
 assert.deepEqual(portrait.map(s=>s.partnerKey),landscape.map(s=>s.value));
 assert.deepEqual(landscape.map(s=>s.partnerKey),portrait.map(s=>s.value));
});

test('scene metadata exposes original names, spoken names and stable partner IDs without renaming sources',()=>{
 const c=config([scene('land','Chat','twitch','port'),scene('port','chat_tt','tiktok','land'),scene('single','Scene 2','twitch')]);
 const choices=imported(c),portrait=choices.find(s=>s.value==='obs:port'),landscape=choices.find(s=>s.value==='obs:land'),single=choices.find(s=>s.value==='obs:single');
 assert.deepEqual(portrait,{value:'obs:port',label:'chat_tt · TikTok',name:'chat_tt',platform:'tiktok',spokenName:'TikTok chat_tt',order:0,partnerKey:'obs:land',partnerName:'Chat',partnerLabel:'Chat · Twitch'});
 assert.equal(landscape.spokenName,'Twitch Chat');assert.equal(landscape.partnerKey,'obs:port');
 assert.equal(single.partnerKey,undefined);assert.equal(single.partnerName,undefined);assert.equal(single.partnerLabel,undefined);
 assert.deepEqual(choices.map(s=>s.order),[0,1,2]);
});

test('duplicate landscape names keep their differently named portrait partners in matching order',()=>{
 const c=config([
  scene('w-b','Chat','twitch','t-a'),scene('t-a','A portrait','tiktok','w-b'),
  scene('t-z','Z portrait','tiktok','w-a'),scene('w-a','Chat','twitch','t-z')
 ]);
 const choices=imported(c),portrait=choices.filter(s=>s.platform==='tiktok'),landscape=choices.filter(s=>s.platform==='twitch');
 assert.deepEqual(landscape.map(s=>s.value),['obs:w-a','obs:w-b']);
 assert.deepEqual(portrait.map(s=>s.name),['Z portrait','A portrait']);
 assert.deepEqual(portrait.map(s=>s.partnerKey),landscape.map(s=>s.value));
 c.obsCollection.scenes.reverse();
 assert.deepEqual(imported(c).map(s=>s.value),choices.map(s=>s.value));
});

test('sorting a frozen saved graph does not mutate scene order, selected scene, aliases or transforms',()=>{
 const c=config([scene('z','Scene 10','twitch'),scene('a','Scene 2','tiktok')]);
 c.obsCollection.scenes[0].items.push({source:'a',visible:false,pos:{x:-20,y:37},scale:{x:1.5,y:2},rot:25});
 c.obsCollection.aliases.twitch.Pause='z';c.program.scene='obs:z';
 const before=structuredClone(c);freeze(c);
 const first=sceneChoices(c),second=sceneChoices(c);
 assert.deepEqual(first,second);assert.deepEqual(c,before);
 assert.notEqual(first,second);assert.notEqual(first[4],second[4]);
});

test('internal OBS groups are absent from the scene catalog and never exposed as selectable partners',()=>{
 const c=config([scene('public','Custom','tiktok','group'),scene('group','Nested group','twitch','public',{internal:true})]);
 const choices=imported(c);
 assert.deepEqual(choices.map(s=>s.value),['obs:public']);assert.equal(choices[0].partnerKey,undefined);
});

test('live controls retain all grouping metadata and execute saved scene IDs after presentation sorting',async()=>{
 const calls=[],dual={config:config([scene('ten','Scene 10','twitch'),scene('two','Scene 2','twitch'),scene('wide','Chat','twitch','tall'),scene('tall','chat_tt','tiktok','wide')]),serial:run=>run(),scene:async(...args)=>{calls.push(args);return {ok:true};}};
 const controls=new SuiteControls({runtime:{voice:{status:'Test'}},getDual:()=>dual,getHost:()=>({})});
 const catalog=controls.catalog(),choices=catalog.actions.find(a=>a.id==='scene').choices,portrait=choices.find(c=>c.id==='obs:tall');
 assert.deepEqual(portrait,{id:'obs:tall',name:'chat_tt · TikTok',sceneName:'chat_tt',platform:'tiktok',spokenName:'TikTok chat_tt',order:0,partnerKey:'obs:wide',partnerName:'Chat',partnerLabel:'Chat · Twitch'});
 assert.deepEqual(choices.filter(c=>c.platform==='twitch').map(c=>c.id),['obs:wide','obs:two','obs:ten']);
 assert.deepEqual(catalog.scenes,choices.map(c=>c.name));assert.equal(catalog.sceneMode,'suite');
 await controls.execute({action:'scene',target:'obs:ten',transition:'cut',durationMs:350});
 assert.deepEqual(calls,[['obs:ten','cut',350]]);
 dual.config=config([scene('new','Start','twitch'),scene('ten','Scene 10','twitch')]);
 assert.deepEqual(controls.catalog().actions.find(a=>a.id==='scene').choices.filter(c=>c.platform).map(c=>c.id),['obs:new','obs:ten']);
 await assert.rejects(controls.execute({action:'scene',target:'obs:two'}),/vorhandenes Ziel/);
 assert.equal(calls.length,1);
});
