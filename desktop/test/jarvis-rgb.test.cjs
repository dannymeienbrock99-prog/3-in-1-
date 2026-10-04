'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {resolveCommand,commandExamples}=require('../src/services/jarvis-commands.cjs');
const effects=Object.entries({static:'Statisch',rainbow:'Regenbogen',breathing:'Atmen',wave:'Welle',gradient:'Farbverlauf',sparkle:'Funkeln',colorcycle:'Farbwechsel',comet:'Komet',chase:'Lauflicht',scanner:'Scanner',ripple:'Wasserwelle',fire:'Feuer',aurora:'Nordlicht',stripes:'Farbstreifen'}).map(([id,name])=>({id,name}));
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-rgb-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const calls=[],runtime={voice:{status:'idle'},rgb:{catalog:()=>({effects}),action:async payload=>{calls.push(payload);return {ok:true,text:'Bestätigt vom RGB-Dienst.'};}}};
 let view;const controls=new SuiteControls({runtime,getDual:()=>null,getHost:()=>({catalog:()=>({}),navigate:async target=>{view=target;return {ok:true};}})});
 const jarvis=new JarvisCore({directory,control:value=>controls.executeFromJarvis(value),getCommandCatalog:()=>controls.catalog()});
 runtime.jarvis=jarvis;jarvis.settings.voiceEnabled=false;return {jarvis,runtime,controls,calls,get view(){return view;}};
}
test('RGB commands select bounded values and only effects from the live catalog',t=>{
 const f=fixture(t),catalog=f.controls.catalog(),resolve=phrase=>resolveCommand(phrase,{catalog});
 for(const [phrase,action]of [
  ['Javis, RGB öffnen',{action:'navigate',target:'rgb'}],['Öffne RGB-Steuerung',{action:'navigate',target:'rgb'}],
  ['Jarvis RGB rot',{action:'rgb-color',target:'#ff0000'}],['Stelle RGB Farbe auf blau',{action:'rgb-color',target:'#0000ff'}],
  ['RGB Farbe grün',{action:'rgb-color',target:'#00ff00'}],['RGB Farbe violett',{action:'rgb-color',target:'#8000ff'}],
  ['Javis Farbe rot',{action:'rgb-color',target:'#ff0000'}],
  ['RGB Helligkeit fünfzig Prozent',{action:'rgb-brightness',value:50}],['RGB Helligkeit 0 %',{action:'rgb-brightness',value:0}],
  ['RGB Helligkeit auf 100 Prozent',{action:'rgb-brightness',value:100}],['RGB aus',{action:'rgb-power',target:'off'}],
  ['Schalte die RGB Beleuchtung ein',{action:'rgb-power',target:'on'}],['RGB Status',{action:'rgb-status'}]
 ])assert.deepEqual(resolve(phrase)?.action,action,phrase);
 for(const effect of effects)assert.deepEqual(resolve('RGB Effekt '+effect.name)?.action,{action:'rgb-effect',target:effect.id});
 assert.deepEqual(resolve('RGB Effekt pulsieren')?.action,{action:'rgb-effect',target:'breathing'});
 assert.equal(resolve('RGB Effekt Fremder Effekt').kind,'ambiguous');
 f.runtime.rgb.catalog=()=>({effects:effects.filter(item=>item.id!=='comet')});
 assert.equal(resolveCommand('RGB Effekt Komet',{catalog:f.controls.catalog()}).kind,'ambiguous');
});
test('RGB help advertises only executable commands, and absence of RGB cannot claim a color change',t=>{
 const f=fixture(t),catalog=f.controls.catalog(),examples=commandExamples(catalog);
 for(const example of examples.filter(item=>item.expectedAction?.action.startsWith('rgb-')))assert.deepEqual(resolveCommand(example.phrase,{catalog})?.action,example.expectedAction,example.phrase);
 for(const definition of catalog.voiceActions.filter(item=>item.id.startsWith('rgb-')))for(const item of definition.choices||[{id:undefined}])assert(examples.some(e=>e.expectedAction?.action===definition.id&&e.expectedAction.target===item.id),definition.id+':'+item.id);
 delete f.runtime.rgb;
 assert.equal(resolveCommand('RGB rot',{catalog:f.controls.catalog()}).kind,'ambiguous');
 assert(!commandExamples(f.controls.catalog()).some(item=>item.expectedAction?.action.startsWith('rgb-')));
});
test('negative, compound and out-of-range RGB requests never make a partial hardware call',async t=>{
 const f=fixture(t);
 for(const phrase of ['RGB nicht aus','Wenn RGB rot','RGB rot und Kamera aus','RGB Helligkeit 101 Prozent','RGB Helligkeit minus 1 Prozent','RGB Helligkeit 1.5 Prozent','RGB Farbe process exit 0','RGB umschalten'])assert.equal((await f.jarvis.execute(phrase)).ok,false,phrase);
 assert.deepEqual(f.calls,[]);
 await assert.rejects(f.controls.executeFromJarvis({action:'rgb-brightness',value:100.1}),/RGB-Helligkeit/);
 await assert.rejects(f.controls.executeFromJarvis({action:'rgb-effect',target:'deleted'}),/vorhandenes/);
});
test('voice and saved deck commands reach the real shared RGB control adapter and use its actual reply',async t=>{
 const f=fixture(t);
 for(const phrase of ['RGB Farbe blau','RGB Effekt Komet','RGB Helligkeit 35 Prozent','RGB aus','RGB an','RGB Status'])assert.equal((await f.jarvis.execute(phrase)).text,'Bestätigt vom RGB-Dienst.');
 assert.deepEqual(f.calls,[{type:'color',color:'#0000ff'},{type:'effect',effect:'comet'},{type:'brightness',brightness:35},{type:'off'},{type:'on'},{type:'status'}]);
 assert.equal((await f.jarvis.execute('RGB öffnen')).ok,true);assert.equal(f.view,'rgb');
 await f.controls.execute({action:'command',text:'RGB Effekt Atmen'});
 assert.deepEqual(f.calls.at(-1),{type:'effect',effect:'breathing'});assert.equal(f.controls.busy,false);
});
test('failed and unconfirmed RGB operations report failure and do not learn successful actions',async t=>{
 const f=fixture(t);
 f.runtime.rgb.action=async()=>{throw Error('Kein unterstütztes RGB-Gerät verbunden.');};
 assert.match((await f.jarvis.execute('RGB rot')).text,/Kein unterstütztes/);
 f.runtime.rgb.action=async()=>({ok:false,text:'Treiber hat abgelehnt.'});
 assert.equal((await f.jarvis.execute('RGB aus')).ok,false);
 f.runtime.rgb.action=async()=>undefined;
 const missing=await f.jarvis.execute('RGB Helligkeit 30 Prozent');assert.equal(missing.ok,false);assert.match(missing.text,/nicht bestätigt/);
 assert.equal(f.jarvis.memory.length,0);
 f.jarvis.control=async()=>({text:'Unbestätigt'});
 assert.equal((await f.jarvis.execute('RGB Effekt Regenbogen')).ok,false);
});
test('unrecognized RGB requests cannot be answered by a model as if hardware changed',async t=>{
 const f=fixture(t);let asked=0;f.jarvis.settings.localAi=true;f.jarvis.askAi=async()=>{asked++;return 'RGB verändert.';};
 for(const phrase of ['RGB Helligkeit 35','RGB an jetzt','PRISM wildes Licht'])assert.equal((await f.jarvis.execute(phrase)).ok,false,phrase);
 assert.equal(asked,0);assert.deepEqual(f.calls,[]);
});
function rpm(id,name,value,extra={}){return {id,name,value,unit:'RPM',fresh:true,updatedUtc:new Date().toISOString(),...extra};}
test('RPM queries include raw ordinary fans, preserve mapped names and distinguish LINK fans',async t=>{
 const f=fixture(t),link=rpm('link-rpm','iCUE QX120',1300,{isLinkFan:true}),normal=rpm('case-rpm','Mainboard Lüfter 2',900),cpu=rpm('cpu-rpm','CPU Lüfter',800);
 f.jarvis.getSensors=()=>[link,normal,cpu];f.jarvis.getFans=()=>[{id:'normal-tile',kind:'normal',name:'Rechts oben',rpm:normal},{id:'link-tile',kind:'link',name:'Rückwand',rpm:link}];
 const all=await f.jarvis.execute('Wie schnell laufen meine Lüfter');assert.match(all.text,/Rechts oben: 900/);assert.match(all.text,/Rückwand: 1.300/);assert.match(all.text,/CPU Lüfter: 800/);assert.doesNotMatch(all.text,/Mainboard Lüfter 2/);
 const ordinary=await f.jarvis.execute('Normale Lüfter RPM');assert.match(ordinary.text,/Rechts oben: 900/);assert.match(ordinary.text,/CPU Lüfter: 800/);assert.doesNotMatch(ordinary.text,/Rückwand/);
 const icue=await f.jarvis.execute('iCUE LINK Lüfterdrehzahl');assert.match(icue.text,/Rückwand: 1.300/);assert.doesNotMatch(icue.text,/Rechts oben|CPU Lüfter/);
});
test('stale RPM and disabled readings stay unavailable, and RPM is never invented as a percentage',async t=>{
 const f=fixture(t),current=rpm('current','Gehäuse Lüfter',1200),stale=rpm('stale','Alter Lüfter',9999,{updatedUtc:new Date(Date.now()-16000).toISOString()}),hidden=rpm('hidden','Privater Lüfter',8888);
 f.jarvis.getSensors=()=>[current,stale,hidden];f.jarvis.settings.sensorRules.hidden={readable:false};
 const result=await f.jarvis.execute('Normale Lüfter RPM');assert.match(result.text,/1.200/);assert.match(result.text,/keine aktuellen Werte/);assert.doesNotMatch(result.text,/9.999|8.888|Privater/);
 const percent=await f.jarvis.execute('Normale Lüfter in Prozent');assert.match(percent.text,/keine aktuellen Messwerte/);assert.doesNotMatch(percent.text,/1.200|Prozent/);
});
test('mixed fan warnings use a generic fan description',t=>{
 const f=fixture(t),now=Date.now();f.jarvis.clock=()=>now;
 f.jarvis.getFans=()=>Array.from({length:4},(_,i)=>({id:'fan-'+i,name:'Lüfter '+i,kind:i===0?'link':'normal',announce:true,percent:{value:90,fresh:true,updatedUtc:new Date(now).toISOString()},rpm:rpm('rpm-'+i,'Lüfter '+i,1500)}));
 f.jarvis.poll();const warning=f.jarvis.history.find(item=>item.kind==='alert');assert.match(warning.text,/4 Lüfter/);assert.doesNotMatch(warning.text,/iCUE-LINK/);
});

test('manufacturer RGB names resolve from the dynamic catalog and never select guessed or removed native modes',async t=>{
 const f=fixture(t),native=[{id:'native:kingston:breath',name:'Kingston Atmen'},{id:'native:kingston:static_color',name:'Kingston Statisch'},{id:'native:lianli:Meteor',name:'Lian Li Meteor'}];
 f.runtime.rgb.catalog=()=>({effects:[...effects,...native]});
 const catalog=f.controls.catalog();
 assert.deepEqual(resolveCommand('Javis, RGB Effekt Kingston Atmen',{catalog})?.action,{action:'rgb-effect',target:'native:kingston:breath'});
 assert.deepEqual(resolveCommand('RGB Effekt Lian Li Meteor',{catalog})?.action,{action:'rgb-effect',target:'native:lianli:Meteor'});
 for(const example of commandExamples(catalog).filter(example=>example.expectedAction?.target?.startsWith('native:')))assert.deepEqual(resolveCommand(example.phrase,{catalog})?.action,example.expectedAction);
 assert.equal((await f.jarvis.execute('Javis, RGB Effekt Kingston Atmen')).ok,true);
 assert.deepEqual(f.calls.at(-1),{type:'effect',effect:'native:kingston:breath'});
 f.runtime.rgb.catalog=()=>({effects});
 const calls=f.calls.length;
 assert.equal((await f.jarvis.execute('RGB Effekt Kingston Atmen')).ok,false);
 await assert.rejects(f.controls.executeFromJarvis({action:'rgb-effect',target:'native:kingston:breath'}),/vorhandenes/);
 assert.equal((await f.jarvis.execute('RGB Effekt Kingston Unbekannt')).ok,false);
 assert.equal(f.calls.length,calls);
 f.runtime.rgb.catalog=()=>({effects:[...effects,...[{id:'native:unknown:breath',name:'Unknown Atmen'},{id:'native:kingston:bad mode',name:'Bad Atmen'},{id:'native:msi:style:1',name:'MSI Statisch'}]]});
 const permitted=f.controls.catalog().voiceActions.find(action=>action.id==='rgb-effect').choices;
 assert(!permitted.some(effect=>effect.id==='native:unknown:breath'||effect.id==='native:kingston:bad mode'));
 assert(permitted.some(effect=>effect.id==='native:msi:style:1'));
});

test('the shared software catalog exposes every additional implemented RGB effect to Jarvis',async t=>{
 const f=fixture(t),root=path.resolve(__dirname,'../../PRISM');
 const supplied=JSON.parse(fs.readFileSync(path.join(root,'server/effect-catalog.json'),'utf8'));
 f.runtime.rgb.catalog=()=>({effects:supplied});
 assert(supplied.length>=14);
 for(const id of effects.map(effect=>effect.id))assert(supplied.some(effect=>effect.id===id));
 for(const effect of supplied)assert.deepEqual(resolveCommand('RGB Effekt '+effect.name,{catalog:f.controls.catalog()})?.action,{action:'rgb-effect',target:effect.id},effect.name);
});
