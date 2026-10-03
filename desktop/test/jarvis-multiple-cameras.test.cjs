'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {resolveCommand,commandExamples}=require('../src/services/jarvis-commands.cjs');
const {DualStream}=require('../src/dual-stream/service.cjs');
const {normalizeConfig}=require('../src/services/touch-deck.cjs');
const cameraIds=['camera','camera2','camera3'];
function controls(){return new SuiteControls({runtime:{voice:{status:'Test'}},getDual:()=>({config:{program:{}}}),getHost:()=>({})});}
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-cameras-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const dual=new DualStream({directory,executable:'unused'}),calls=[];
 for(const [index,id] of cameraIds.entries())dual.config.sources[id]={enabled:true,target:'synthetic-'+id,name:'Kamera '+(index+1)};
 dual.state={prepared:true,outputs:{}};
 dual.sourceState={camera:true,camera2:true,camera3:true};
 dual.native={request:async(command,value)=>{calls.push({command,...value});return {prepared:true,outputs:{}};}};
 const runtime={voice:{status:'Test'}},suite=new SuiteControls({runtime,getDual:()=>dual,getHost:()=>({})});
 const jarvis=new JarvisCore({directory,getCommandCatalog:()=>suite.catalog(),control:action=>suite.executeFromJarvis(action)});
 runtime.jarvis=jarvis;jarvis.settings.voiceEnabled=false;jarvis.settings.learn=false;
 return {suite,jarvis,dual,calls};
}

test('catalog exposes all three camera slots while retaining the original camera identity',()=>{
 const catalog=controls().catalog(),source=catalog.actions.find(x=>x.id==='source');
 assert.deepEqual(source.choices,[{id:'camera',name:'Kamera'},{id:'camera2',name:'Kamera 2'},{id:'camera3',name:'Kamera 3'},{id:'game',name:'Spiel'}]);
 for(const id of cameraIds)assert.doesNotThrow(()=>controls().validate([{action:'source',target:id,op:'toggle'}]));
 assert.throws(()=>controls().validate([{action:'source',target:'camera4',op:'toggle'}]),/vorhandenes/);
});

test('numbered and ordinal spoken camera names resolve to distinct source slots',()=>{
 const catalog=controls().catalog();
 const phrases=[
  ['Kamera an','camera','on'],['Kamera 1 an','camera','on'],['Die erste Kamera einschalten','camera','on'],['Kamera eins aus','camera','off'],
  ['Kamera 2 an','camera2','on'],['Jarvis, Kamera zwei aus','camera2','off'],['Zweite Kamera einschalten','camera2','on'],
  ['Schalte die zweite Webcam um','camera2','toggle'],['Blende die Cam zwei ein','camera2','on'],
  ['Kamera drei aus','camera3','off'],['Schalte bitte die dritte Kamera ein','camera3','on'],['Deaktiviere Webcam 3','camera3','off'],
  ['Bildquelle Kamera drei ausschalten','camera3','off']
 ];
 for(const [phrase,target,op]of phrases)assert.deepEqual(resolveCommand(phrase,{catalog})?.action,{action:'source',target,op},phrase);
 for(const phrase of ['Kamera 4 an','Vierte Kamera an','Kamera 2 nicht einschalten','Wenn Kamera 2 an','Kamera 2 an und Kamera 3 aus'])assert.notEqual(resolveCommand(phrase,{catalog})?.kind,'action',phrase);
 const oldCatalog=structuredClone(catalog);oldCatalog.actions.find(x=>x.id==='source').choices=[{id:'camera',name:'Kamera'}];
 assert.notEqual(resolveCommand('Kamera zwei an',{catalog:oldCatalog})?.kind,'action');
});

test('camera switches do not intercept named scenes, virtual camera outputs, or chat connections',()=>{
 const catalog=controls().catalog();
 catalog.actions.find(x=>x.id==='scene').choices.push({id:'custom-camera-scene',name:'Kamera 2'});
 for(const [phrase,expected]of [
  ['Szene Kamera 2 öffnen',{action:'scene',target:'custom-camera-scene'}],
  ['Starte beide virtuelle Kameras',{action:'start',target:'both'}],
  ['Twitch virtuelle Kamera stoppen',{action:'stop',target:'twitch'}],
  ['Starte TikTok Kamera',{action:'start',target:'tiktok'}],
  ['Verbinde Twitch',{action:'connect',target:'twitch',op:'on'}]
 ])assert.deepEqual(resolveCommand(phrase,{catalog})?.action,expected,phrase);
});

test('camera help provides executable on/off/toggle examples and explains preparation',()=>{
 const catalog=controls().catalog(),examples=commandExamples(catalog);
 for(const id of cameraIds)for(const op of ['on','off','toggle']){
  const entry=examples.find(x=>x.expectedAction?.action==='source'&&x.expectedAction.target===id&&x.expectedAction.op===op);
  assert(entry,id+':'+op);assert.match(entry.description,/vorbereiten/);
  assert.deepEqual(resolveCommand(entry.phrase,{catalog})?.action,entry.expectedAction);
 }
});

test('typed and spoken camera commands reach the sender service independently through the real controls',async t=>{
 const f=fixture(t);
 for(const [text,id,enabled]of [['Kamera zwei aus','camera2',false],['Kamera drei aus','camera3',false],['Kamera an','camera',true],['Zweite Kamera einschalten','camera2',true]]){
  assert.equal((await f.jarvis.execute(text,{source:'voice'})).ok,true,text);
  assert.deepEqual(f.calls.at(-1),{command:'source',source:id,enabled},text);
 }
 assert.deepEqual(f.dual.sourceState,{camera:true,camera2:true,camera3:false});
 assert(cameraIds.every(id=>f.dual.config.sources[id].enabled),'source switches must not rewrite capture configuration');
});

test('saved deck commands toggle added cameras without recursion and direct combinations validate',async t=>{
 const f=fixture(t);
 assert.equal((await f.suite.execute({action:'command',text:'Schalte Kamera drei um'})).ok,true);
 assert.deepEqual(f.calls.at(-1),{command:'source',source:'camera3',enabled:false});
 const steps=[{action:'source',target:'camera2',op:'off'},{action:'source',target:'camera3',op:'on'}];
 const deck=normalizeConfig({profiles:[{id:'cameras',name:'Kameras',columns:2,rows:1,buttons:[{id:'pair',type:'action',title:'Kameras',steps}]}]},f.suite.catalog());
 assert.deepEqual(deck.profiles[0].buttons[0].steps,steps);
 assert.equal((await f.suite.execute({steps})).completed,2);
 assert.deepEqual(f.calls.slice(-2),[{command:'source',source:'camera2',enabled:false},{command:'source',source:'camera3',enabled:true}]);
 assert.equal(f.suite.busy,false);assert.equal(f.suite.jarvisDepth,0);
});

test('unprepared or disabled camera requests fail without capturing another device or reporting success',async t=>{
 const f=fixture(t);f.dual.state.prepared=false;
 const unprepared=await f.jarvis.execute('Kamera 2 an');assert.equal(unprepared.ok,false);assert.match(unprepared.text,/vorbereiten/i);assert.equal(f.calls.length,0);
 f.dual.state.prepared=true;f.dual.config.sources.camera3.enabled=false;
 const disabled=await f.jarvis.execute('Kamera drei an');assert.equal(disabled.ok,false);assert.match(disabled.text,/nicht eingeschaltet/i);assert.equal(f.calls.length,0);
 f.dual.native.request=async()=>{throw Error('Kameragerät getrennt');};
 const failed=await f.jarvis.execute('Kamera zwei aus');assert.equal(failed.ok,false);assert.match(failed.text,/getrennt/);assert.equal(f.dual.sourceState.camera2,true);
});
