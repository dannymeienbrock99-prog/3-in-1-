'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
function core(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-catalog-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const jarvis=new JarvisCore({directory,...options});jarvis.settings.voiceEnabled=false;jarvis.settings.learn=false;return jarvis;
}
test('suite scene commands use the own sender even with imported OBS aliases',async t=>{
 const selected=[],jarvis=core(t),dual={config:{program:{}},serial:fn=>fn(),scene:name=>{selected.push(name);return {ok:true};}};
 const controls=new SuiteControls({runtime:{jarvis,voice:{status:'Test'}},getDual:()=>dual,getHost:()=>({})});
 jarvis.getCommandCatalog=()=>controls.catalog();jarvis.control=action=>controls.executeFromJarvis(action);
 Object.assign(jarvis.settings.sceneAliases,{pause:'Alte OBS Pause',spiel:'Altes OBS Spiel',start:'Alter OBS Start',ende:'Altes OBS Ende'});
 for(const name of ['Pause','Spiel','Start','Ende']){assert.equal((await jarvis.execute(name)).ok,true,name);assert.equal(selected.at(-1),name);}
 assert.equal(jarvis.settings.sceneAliases.pause,'Alte OBS Pause','saved import preferences remain intact');
 jarvis.settings.sceneAliases.pause='Ende';assert.equal((await jarvis.execute('Pause')).ok,true);assert.equal(selected.at(-1),'Ende','valid own-sender assignments remain effective');
});
test('an OBS-only host still honors the configured scene alias',async t=>{
 const selected=[],jarvis=core(t,{obs:{scenes:async()=>['Meine Pause'],setScene:async name=>{selected.push(name);return {ok:true};}}});
 jarvis.settings.sceneAliases.pause='Meine Pause';
 assert.equal((await jarvis.execute('Pause')).ok,true);assert.deepEqual(selected,['Meine Pause']);
});
test('command list is reused for telemetry updates and refreshed for renamed or removed actions',t=>{
 const catalog={actions:[{id:'navigate',choices:[{id:'dashboard',name:'Multi-Chat'}]},{id:'chain',name:'Aktionskette',choices:[{id:'one',name:'Streamstart'}]}],states:{enabled:true},program:{scene:'Pause'}};
 const jarvis=core(t,{getCommandCatalog:()=>structuredClone(catalog)}),first=jarvis.snapshot().commandExamples;
 assert(first.some(item=>item.phrase==='Starte Aktionskette Streamstart'));
 catalog.states.enabled=false;catalog.program.scene='Spiel';
 assert.strictEqual(jarvis.snapshot().commandExamples,first);
 catalog.actions[1].choices[0].name='Streamende';const renamed=jarvis.snapshot().commandExamples;
 assert.notStrictEqual(renamed,first);assert(renamed.some(item=>item.phrase==='Starte Aktionskette Streamende'));
 catalog.actions.pop();assert(!jarvis.snapshot().commandExamples.some(item=>item.phrase.includes('Streamende')));
});
test('the advertised PC overview reads at most one current CPU, GPU and RAM value',async t=>{
 const now=Date.now(),sample=(id,name,unit,value,device)=>({id,name,unit,value,device,fresh:true,updatedUtc:new Date(now).toISOString()});
 const readings=[sample('cpu','CPU-Auslastung','%',20,'CPU'),sample('gpu-old','GPU-Temperatur','°C',99,'GPU'),sample('gpu','GPU-Temperatur','°C',42,'GPU'),sample('ram','RAM-Auslastung','%',35,'RAM'),sample('pin','12V-2x6 Pin 1','V',12,'GPU')];
 readings[1].updatedUtc=new Date(now-60000).toISOString();
 const jarvis=core(t,{getSensors:()=>readings,clock:()=>now});
 assert.deepEqual(jarvis.resolveSensors('PC Werte').map(value=>value.id),['cpu','gpu','ram']);
 const result=await jarvis.execute('PC Werte');assert.match(result.text,/20 Prozent/);assert.match(result.text,/42 Grad/);assert.match(result.text,/35 Prozent/);assert.doesNotMatch(result.text,/99|Volt/);
 jarvis.settings.sensorRules.ram={readable:false};assert.deepEqual(jarvis.resolveSensors('PC Werte').map(value=>value.id),['cpu','gpu']);
});
