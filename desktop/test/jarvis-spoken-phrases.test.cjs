'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {resolveCommand}=require('../src/services/jarvis-commands.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');

function setup(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-spoken-phrases-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const executed=[],runtime={voice:{status:'Test'},jarvis:new JarvisCore({directory})};
 runtime.jarvis.settings.voiceEnabled=false;runtime.jarvis.settings.learn=false;
 const controls=new SuiteControls({runtime,getDual:()=>({config:{program:{}},serial:fn=>fn(),scene:target=>{executed.push({action:'scene',target});return {ok:true};}}),getHost:()=>({navigate:target=>{executed.push({action:'navigate',target});return {ok:true};},jarvisSettings:()=>{executed.push({action:'jarvis-settings'});return {ok:true};}})});
 runtime.jarvis.getCommandCatalog=()=>controls.catalog();runtime.jarvis.control=action=>controls.executeFromJarvis(action);
 return {core:runtime.jarvis,catalog:controls.catalog(),executed};
}

test('Javis and punctuation reach the same live scene, navigation and settings routes',async t=>{
 const {core,executed}=setup(t);
 for(const [text,action]of [
  ['Javis, Start Szene öffnen.',{action:'scene',target:'Start'}],
  ['Jarvis. Startszene öffnen!',{action:'scene',target:'Start'}],
  ['Hey, Javis. Multi-Chat öffnen!',{action:'navigate',target:'dashboard'}],
  ['Jarvis, kannst du bitte Multi Chat öffnen?',{action:'navigate',target:'dashboard'}],
  ['Javis, öffne deine Einstellungen.',{action:'jarvis-settings'}]
 ]){assert.equal((await core.execute(text,{source:'voice'})).ok,true,text);assert.deepEqual(executed.at(-1),action,text);}
 assert.equal(executed.length,5);assert.equal(core.commandBusy,false);
});

test('polite commands retain the target article when the verb follows the target',async t=>{
 const {core,executed}=setup(t);
 for(const [text,action]of [
  ['Hey Javis, kannst du mir bitte das Touch Deck öffnen?',{action:'navigate',target:'touchdeck'}],
  ['Kannst du bitte den Multi-Chat öffnen?',{action:'navigate',target:'dashboard'}],
  ['Könntest du mir bitte die Einstellungen öffnen?',{action:'navigate',target:'settings'}],
  ['Javis, kannst du bitte die Start Szene öffnen?',{action:'scene',target:'Start'}],
  ['Kannst du mir bitte die Startszene öffnen?',{action:'scene',target:'Start'}],
  ['Kannst du bitte die Szene Start öffnen?',{action:'scene',target:'Start'}],
  ['Kannst du mir bitte die Jarvis Einstellungen öffnen?',{action:'jarvis-settings'}]
 ]){assert.equal((await core.execute(text,{source:'voice'})).ok,true,text);assert.deepEqual(executed.at(-1),action,text);}
 assert.equal(executed.length,7);assert.equal(core.commandBusy,false);
});

test('article handling does not turn negations, unknown targets or compound commands into actions',t=>{
 const {catalog}=setup(t);
 for(const text of ['Kannst du bitte die Startszene nicht öffnen?','Kannst du bitte das unbekannte Fenster öffnen?','Kannst du bitte den Multi Chat und die Einstellungen öffnen?','Kannst du bitte die fremde Szene öffnen?']){
  assert.notEqual(resolveCommand(text,{catalog})?.kind,'action',text);
 }
});

test('the real reported Chatfarben transcripts route to the existing hologram page',async t=>{
 const {core,executed}=setup(t);
 for(const text of ['Wechsel zu Chatfarben.','Dexel zu Chatfarben.','Eröffne Chatfarben.','Zettfarben.','Schottfarben.','Jarvis, Chatfarben.']){
  assert.equal((await core.execute(text,{source:'voice'})).ok,true,text);
  assert.deepEqual(executed.at(-1),{action:'navigate',target:'hologram'},text);
 }
 assert.equal((await core.execute('Ne Chatfilter.',{source:'voice'})).ok,true);
 assert.deepEqual(executed.at(-1),{action:'navigate',target:'filters'});
  assert.equal((await core.execute('Jarvis öffnet den Chatfilter.',{source:'voice'})).ok,true);
  assert.deepEqual(executed.at(-1),{action:'navigate',target:'filters'});
 for(const text of ['Schottfarben aus','Zettfarben und Pause','Dexel zu unbekannt','Eröffne Chatfarben nicht','Jarvis öffnet den Chatfilter nicht.','Wechsel zu ...']){
  const before=executed.length;assert.equal((await core.execute(text,{source:'voice'})).ok,false,text);assert.equal(executed.length,before,text);
 }
});

test('every visible sidebar label resolves to an existing page, including the injected diagnostics page',t=>{
 const {catalog}=setup(t),renderer=path.join(__dirname,'../src/renderer');
 const html=fs.readFileSync(path.join(renderer,'index.html'),'utf8'),v21=fs.readFileSync(path.join(renderer,'v21-ui.js'),'utf8');
 const nav=[...html.matchAll(/<button[^>]*data-view="([^"]+)"[^>]*><b>.*?<\/b><span>(.*?)<\/span><\/button>/g)].map(m=>({id:m[1],name:m[2]}));
 const panels=new Set([...html.matchAll(/data-view-panel="([^"]+)"/g)].map(m=>m[1]));
 const injectedId=/b\.dataset\.view\s*=\s*'([^']+)'/.exec(v21)?.[1],injectedName=/b\.innerHTML\s*=\s*'<b>.*?<\/b><span>(.*?)<\/span>'/.exec(v21)?.[1];
 assert.equal(injectedId,'diagnostics');assert.equal(injectedName,'Diagnose 2.1');assert.match(v21,/s\.dataset\.viewPanel\s*=\s*'diagnostics'/);
 nav.push({id:injectedId,name:injectedName});panels.add(injectedId);assert(nav.length>20);
 const choices=catalog.actions.find(action=>action.id==='navigate').choices;
 for(const page of nav){
  assert(choices.some(choice=>choice.id===page.id),page.name+' is present in the command catalog');
  // "Start" alone remains intentionally ambiguous with the Start scene.
  const result=resolveCommand('Öffne '+(page.id==='start'?'Startseite':page.name),{catalog});
  assert.deepEqual(result?.action,{action:'navigate',target:page.id},page.name);
 }
 for(const choice of choices)assert(panels.has(choice.id),choice.name+' refers to a real rendered page');
 for(const [name,id]of [['Hologramm','hologram'],['Wunschliste','wishlist'],['Widgets','widgets'],['Live-Center','livecenter'],['Bot-Befehle','commands'],['Ereignisse','events'],['Chat-Stimme','tts'],['Sicherungen','backups'],['Lüfter','fans'],['Diagnose','diagnostics']])assert.deepEqual(resolveCommand('Öffne '+name,{catalog})?.action,{action:'navigate',target:id},'existing alias '+name);
});
