'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const {CONTROLS}=require('../src/core/deck-controls.cjs');
const {resolveCommand,commandExamples}=require('../src/services/jarvis-commands.cjs');
const {SETTING_SPECS}=require('../src/services/jarvis-setting-actions.cjs');
function catalog(){return new SuiteControls({runtime:{voice:{status:''}},getDual:()=>({config:{program:{}}}),getHost:()=>({jarvisSettings(){},catalog:()=>({controls:CONTROLS.map(([id,name])=>({id,name})),broadcastProfiles:[{id:'p1',name:'Discord und Twitch'},{id:'p2',name:'Ohne Werbung'}],items:['chain','event','hotkey','broadcast','media'].flatMap(kind=>[
 {kind,id:kind+'-normal',name:'Streamstart'}, {kind,id:kind+'-and',name:'Bild und Ton'},
 {kind,id:kind+'-no',name:'Kein OBS'}, {kind,id:kind+'-please',name:'Bitte Pause'}, {kind,id:kind+'-pause',name:'Pause'},
 {kind,id:kind+'-wake',name:'Jarvis bitte'}, {kind,id:kind+'-quotes',name:'Name "mit Zitat"'},
 {kind,id:kind+'-duplicate1',name:'Doppelt'}, {kind,id:kind+'-duplicate2',name:'Doppelt'},
 {kind,id:kind+'-punct1',name:'Punkt!'}, {kind,id:kind+'-punct2',name:'Punkt?'}
])})})}).catalog();}
const resolve=(text,c)=>resolveCommand(text,{catalog:c});

test('every supported catalog action and choice has an exact executable example without a default cutoff',()=>{
 const c=catalog(),examples=commandExamples(c),covered=new Set();
 assert(examples.length>200);assert.equal(commandExamples(c,{limit:3}).length,3);
 assert.deepEqual(examples.slice(0,6).map(e=>e.phrase),['Start Szene öffnen','Multi Chat öffnen','Mach bitte Pause','Öffne Touch Deck','Öffne Dual Stream','Öffne Einstellungen']);
 for(const e of examples){
  assert(e.category&&e.description,e.phrase);if(e.template){assert(e.requiresInput.length);continue;}
  if(e.expectedAction){const result=resolve(e.phrase,c);assert.deepEqual(result?.action,e.expectedAction,e.phrase);covered.add(e.expectedAction.action+'|'+(e.expectedAction.target||''));}
  else if(e.expectedIntent)assert.deepEqual(resolve(e.phrase,c),e.expectedIntent,e.phrase);
  else if(e.expectedKind==='sensor')assert.equal(resolve(e.phrase,c),null,e.phrase);
  else assert.equal(resolve(e.phrase,c)?.kind,e.expectedKind,e.phrase);
 }
 for(const a of [...c.actions,...c.voiceActions]){if(a.id==='command')continue;for(const choice of a.choices||[{id:''}])assert(covered.has(a.id+'|'+choice.id),a.id+':'+choice.id);}
 for(const a of c.actions.filter(a=>a.switch))for(const choice of a.choices||[{id:undefined}])for(const op of ['on','off','toggle'])assert(examples.some(e=>e.expectedAction?.action===a.id&&e.expectedAction.target===choice.id&&e.expectedAction.op===op),a.id+':'+choice.id+':'+op);
 for(const [target,spec]of Object.entries(SETTING_SPECS))for(const value of spec.values||[])assert(examples.some(e=>e.expectedAction?.target===target&&e.expectedAction.value===value),target+':'+value);
 assert(!examples.some(e=>e.expectedAction?.action==='command'));
});

test('every ordinary spoken example works without quote characters; exceptional names have explicit text guidance',()=>{
 const c=catalog(),examples=commandExamples(c);
 for(const e of examples.filter(e=>e.expectedAction)){
  if(e.typedOnly){assert.match(e.description,/Textvariante/);continue;}
  assert.deepEqual(resolve(e.phrase.replace(/["„“]/g,''),c)?.action,e.expectedAction,e.phrase);
 }
 for(const [id,name]of [['source','Kamera'],['jarvis','Sprachausgabe'],['control','Auto-Broadcast']])assert(examples.some(e=>e.phrase===`Schalte ${name} ein`&&e.expectedAction?.action===id));
 for(const phrase of ['Bildquelle Kamera einschalten','Einblendung Chat einschalten','Funktion Schnee einschalten','Jarvis-Schalter Sprachausgabe einschalten'])assert.equal(resolve(phrase,c)?.kind,'action',phrase);
});

test('quoted literal names and duplicate identities never normalize into another saved action',()=>{
 const c=catalog();
 assert.deepEqual(resolve('Starte Aktionskette Bitte Pause',c)?.action,{action:'chain',target:'chain-please'});
 assert.deepEqual(resolve('Starte Aktionskette "Jarvis bitte"',c)?.action,{action:'chain',target:'chain-wake'});
 assert.deepEqual(resolve('Starte Aktionskette "Kein OBS"',c)?.action,{action:'chain',target:'chain-no'});
 assert.deepEqual(resolve('Starte Aktionskette "Punkt?"',c)?.action,{action:'chain',target:'chain-punct2'});
 assert.notEqual(resolve('Starte Aktionskette Doppelt',c)?.kind,'action');
 assert.notEqual(resolve('Starte Aktionskette Bitte Fehlend',c)?.kind,'action');
 assert.notEqual(resolve('Starte Aktionskette mit Kennung "unbekannt"',c)?.kind,'action');
 assert.deepEqual(resolve('Auto-Broadcast Discord und Twitch an',c)?.action,{action:'broadcast-profile',target:'p1',op:'on'});
});

test('catalog examples never execute when negated, conditional, or followed by a second action',()=>{
 const c=catalog();
 for(const e of commandExamples(c).filter(e=>e.expectedAction||e.expectedIntent))for(const phrase of ['Nicht '+e.phrase,'Wenn '+e.phrase,e.phrase+' und Kamera aus']){
  assert(!['action','audio','moderation','filter'].includes(resolve(phrase,c)?.kind),phrase);
 }
 assert.equal(resolve('Ich falte Auto-Broadcast ein.',c)?.kind,'ambiguous');
 assert.match(resolve('Ich falte Auto-Broadcast ein.',c).text,/erneut/);
});

test('common German requests and actual harmless transcripts resolve with scene priority over page rejection',()=>{
 const c=catalog();
 for(const [phrase,action]of [
  ['Wechsel zu Pause.',{action:'scene',target:'Pause'}],['Könntest du bitte zur Pause wechseln?',{action:'scene',target:'Pause'}],
  ['Die Start Szene wechseln',{action:'scene',target:'Start'}],['Macht bitte Pause.',{action:'scene',target:'Pause'}],
  ['Nach bitte Pause.',{action:'scene',target:'Pause'}],['Ach, bitte Pause.',{action:'scene',target:'Pause'}],['So Pause wechseln.',{action:'scene',target:'Pause'}],['Marspiel.',{action:'scene',target:'Spiel'}],
  ['Jarvis, ich möchte die Einstellungen öffnen.',{action:'navigate',target:'settings'}],['Öffene Einstellungen.',{action:'navigate',target:'settings'}],
  ['Öffne Kommands.',{action:'navigate',target:'commands'}],['Öffne Comands.',{action:'navigate',target:'commands'}],['Wechsle zum Multi Chat',{action:'navigate',target:'dashboard'}],
  ['Die Kamera aktivieren',{action:'source',target:'camera',op:'on'}],['Ich möchte bitte die Kamera ausschalten',{action:'source',target:'camera',op:'off'}],
  ['Stopp beide virtuelle Kameras',{action:'stop',target:'both'}],['Chatfenster entkoppeln',{action:'control',target:'chatWindow.detached',op:'on'}],['Kopple das Chatfenster',{action:'control',target:'chatWindow.detached',op:'off'}],
  ['Den Broadcast Streamstart senden',{action:'broadcast',target:'broadcast-normal'}],['Die Aktionskette Streamstart ausführen',{action:'chain',target:'chain-normal'}]
 ])assert.deepEqual(resolve(phrase,c)?.action,action,phrase);
 assert.notEqual(resolve('Öffne Chatform.',c)?.kind,'action');
});
