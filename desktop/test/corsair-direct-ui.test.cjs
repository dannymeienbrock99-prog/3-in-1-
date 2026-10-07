'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/corsair-direct-ui.js'),'utf8');
const HUB='corsair-link-0123456789abcdef',FAN=HUB+'/fan/0';
const initial=()=>({enabled:false,active:false,ownsControl:false,released:true,retryRequired:false,remaining:[],phase:'off',error:'',availability:{native:true,inProcess:true,requiresElevation:false},releaseVerification:'none',hubs:[{id:HUB,name:'iCUE LINK System Hub',firmware:'3.0'}],channels:[],sensors:[]});
const active=()=>({...initial(),enabled:true,active:true,ownsControl:true,released:false,phase:'ready',channels:[{id:FAN,hubId:HUB,name:'QX120',kind:'fan',device:'iCUE LINK System Hub',rpm:0,duty:null,minDuty:30,maxDuty:100}]});
function fixture(seed=initial(),respond,administrator=true){
 const calls=[],elements=new Map(),cards=[];let updateListener,suiteListener,current=seed;
 const element=(dataset={})=>({dataset,disabled:false,checked:false,hidden:false,textContent:'',value:'',valueAsNumber:NaN,innerHTML:'',listeners:{},classList:{add(){}},setAttribute(key,value){this[key]=value;},addEventListener(name,fn){this.listeners[name]=fn;},closest(){return null;}});
 const root=element(),channels=element();
 for(const name of ['enabled','toggle-label','consent','phase','hub','enumerate','release','admin-restart','status','error','metrics','release-note'])elements.set(name,element());elements.set('channels',channels);
 root.querySelector=selector=>elements.get(selector.match(/data-corsair-direct="([^"]+)"/)?.[1]);
 let html='';Object.defineProperty(channels,'innerHTML',{get:()=>html,set:value=>{html=value;cards.length=0;for(const block of value.matchAll(/<article[^>]*data-corsair-channel="([^"]*)">([\s\S]*?)<\/article>/g)){
  const card=element({corsairChannel:block[1]}),controls=new Map();
  controls.set('reading:rpm',element());controls.set('reading:duty',element());
  if(block[2].includes('data-corsair-action="manual"')){for(const name of ['confirmed','range','duty'])controls.set('input:'+name,element({corsairInput:name}));controls.set('action:manual',element({corsairAction:'manual'}));}
  card.querySelector=selector=>selector.includes('data-corsair-action')?controls.get('action:manual'):selector.includes('data-corsair-input')?controls.get('input:'+selector.match(/="([^"]*)"/)?.[1]):controls.get('reading:'+(selector.includes('rpm')?'rpm':'duty'));
  card.querySelectorAll=()=>[...controls].filter(([key])=>!key.startsWith('reading:')).map(([,value])=>value);
  for(const control of controls.values())control.closest=selector=>selector==='[data-corsair-channel]'?card:selector==='[data-corsair-action="manual"]'&&control.dataset.corsairAction?control:null;
  card.controls=controls;cards.push(card);
 }}});channels.querySelectorAll=()=>cards;
 const invoke=async(command,value)=>{calls.push({command,value});if(command==='fan-control-state')return {prerequisites:{administrator}};const result=respond?await respond(command,value,current):current;if(result?.phase)current=result;return result;};
 const api={corsairDirectStatus:()=>invoke('status'),corsairDirectEnumerate:()=>invoke('enumerate'),corsairDirectControl:value=>invoke('control',value),corsairDirectManual:value=>invoke('manual',value),onCorsairDirectUpdate:fn=>updateListener=fn,onSuiteState:fn=>suiteListener=fn,suite:(command,value)=>invoke(command,value)};
 vm.runInNewContext(source,{window:{batto:api},document:{querySelector:()=>root,addEventListener(){}},Date,Map,Promise,Number,String,JSON});
 const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
 return {root,calls,elements,cards,settle,publish:value=>{current=value;updateListener(value);},suitePublish:value=>{current=value;suiteListener({corsairDirect:value});},adminPublish:value=>suiteListener({fanControl:{prerequisites:{administrator:value}}}),click:control=>channels.listeners.click({target:control}),change:control=>channels.listeners.change({target:control}),input:control=>channels.listeners.input({target:control})};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('startup uses only cached Corsair and administrator reads; incoming ready updates do not take over or write fan settings',async()=>{
 const f=fixture();await f.settle();assert.deepEqual(f.calls.map(x=>x.command),['status','fan-control-state']);assert.equal(f.elements.get('enabled').checked,false);assert.equal(f.elements.get('enabled').disabled,true);
 f.publish(active());await f.settle();assert.equal(f.calls.length,2);assert.equal(f.cards[0].controls.get('reading:rpm').textContent,'0 RPM');assert.equal(f.cards[0].controls.get('action:manual').disabled,true);
});
test('takeover requires explicit iCUE-pause consent and sends only the selected confirmed controller',async()=>{
 const f=fixture(initial(),command=>command==='control'?active():initial());await f.settle();const toggle=f.elements.get('enabled'),consent=f.elements.get('consent');
 toggle.checked=true;toggle.listeners.change();await f.settle();assert.equal(f.calls.length,2);assert.equal(toggle.checked,false);assert.match(f.elements.get('error').textContent,/Bestätige zuerst/);
 consent.checked=true;consent.listeners.change();assert.equal(toggle.disabled,false);toggle.checked=true;toggle.listeners.change();await f.settle();
 assert.deepEqual(plain(f.calls[2]),{command:'control',value:{enabled:true,confirmICuePause:true,hubId:HUB}});assert.equal(toggle.checked,true);assert.equal(consent.disabled,true);
});
test('enumeration is a separate explicit read, and an admin restart is never invoked automatically',async()=>{
 const f=fixture(initial(),undefined,false);await f.settle();assert.equal(f.elements.get('admin-restart').hidden,false);assert.equal(f.calls.length,2);
 f.elements.get('enumerate').listeners.click();await f.settle();assert.deepEqual(f.calls.map(x=>x.command),['status','fan-control-state','enumerate']);
 f.elements.get('admin-restart').listeners.click();await f.settle();assert.deepEqual(f.calls.map(x=>x.command),['status','fan-control-state','enumerate','hardware-admin-restart']);
 const consent=f.elements.get('consent'),toggle=f.elements.get('enabled');consent.checked=true;consent.listeners.change();assert.equal(toggle.disabled,true);toggle.checked=true;toggle.listeners.change();await f.settle();assert.equal(f.calls.filter(x=>x.command==='control').length,0);
 f.adminPublish(true);assert.equal(f.elements.get('admin-restart').hidden,true);assert.equal(toggle.disabled,false);
});
test('manual cooling excludes pump-named channels, requires fan confirmation and bounds, and targets one current fan',async()=>{
 const seed={...active(),channels:[...active().channels,{id:'pump',name:'AIO Pump',kind:'fan',rpm:2000},{id:'actual-pump',name:'Pump',kind:'pump',rpm:null}]},f=fixture(seed);await f.settle();assert.equal(f.cards.length,3);assert.equal(f.cards[1].controls.has('action:manual'),false);assert.equal(f.cards[2].controls.has('action:manual'),false);assert.equal(f.cards[2].controls.get('reading:rpm').textContent,'— RPM');
 const card=f.cards[0],apply=card.controls.get('action:manual'),confirmed=card.controls.get('input:confirmed'),duty=card.controls.get('input:duty');f.click(apply);await f.settle();assert.equal(f.calls.length,2);
 confirmed.checked=true;f.change(confirmed);assert.equal(apply.disabled,false);
 for(const value of [0,29,100.5,101]){duty.value=String(value);duty.valueAsNumber=value;f.input(duty);f.click(apply);await f.settle();assert.equal(f.calls.length,2);}
 duty.value='55';duty.valueAsNumber=55;f.input(duty);f.click(apply);await f.settle();assert.deepEqual(plain(f.calls[2]),{command:'manual',value:{id:FAN,duty:55,fanConfirmed:true}});
});
test('a failed release keeps OFF retry accessible even if normal availability disappears; success clears old consent',async()=>{
 let releases=0;const open=active(),failed={...open,active:false,enabled:false,ownsControl:true,phase:'error',retryRequired:true,remaining:['CorsairService'],error:'Rückgabe offen',availability:{native:false}};
 const f=fixture(open,command=>command==='control'?(++releases===1?failed:{...initial(),releaseVerification:'api-only'}):open);await f.settle();
 const off=f.elements.get('release');off.listeners.click();await f.settle();assert.equal(f.elements.get('enabled').checked,true);assert.equal(f.elements.get('enabled').disabled,false);assert.equal(off.hidden,false);assert.equal(off.disabled,false);assert.equal(off.textContent,'Ausschalten erneut versuchen');assert.match(f.elements.get('status').textContent,/Rückgabe ist noch offen/);assert.equal(f.cards[0].controls.get('action:manual').disabled,true);
 assert.equal(f.cards[0].controls.get('reading:rpm').textContent,'— RPM');
 off.listeners.click();await f.settle();assert.equal(f.elements.get('enabled').checked,false);assert.equal(off.hidden,true);assert.equal(f.elements.get('consent').checked,false);assert.equal(f.elements.get('release-note').hidden,false);
 assert.deepEqual(f.calls.filter(x=>x.command==='control').map(x=>plain(x.value)),[{enabled:false},{enabled:false}]);
});
test('rejected IPC refreshes actual ownership and never replaces it with an optimistic OFF state',async()=>{
 const open=active(),f=fixture(open,command=>{if(command==='control')throw Error('Dienstantwort fehlgeschlagen');return {...open,phase:'error',retryRequired:true};});await f.settle();f.elements.get('release').listeners.click();await f.settle();assert.equal(f.elements.get('enabled').checked,true);assert.equal(f.elements.get('release').disabled,false);assert.match(f.elements.get('error').textContent,/Dienstantwort fehlgeschlagen/);assert.deepEqual(f.calls.map(x=>x.command),['status','fan-control-state','control','status']);
});
test('release and changed topology discard channel confirmation so another takeover cannot inherit authority',async()=>{
 const f=fixture(active());await f.settle();const confirm=f.cards[0].controls.get('input:confirmed');confirm.checked=true;f.change(confirm);assert.equal(f.cards[0].controls.get('action:manual').disabled,false);
 f.suitePublish(initial());f.publish(active());assert.equal(f.cards[0].controls.get('action:manual').disabled,true);assert.equal(f.calls.length,2);
 const second=f.cards[0].controls.get('input:confirmed');second.checked=true;f.change(second);f.publish({...active(),channels:[{...active().channels[0],name:'Anderer erkannter Lüfter'}]});assert.equal(f.cards[0].controls.get('action:manual').disabled,true);
});
test('multiple discovered controllers require one exact selection, and unconfirmed discovery reasons stay visible',async()=>{
 const SECOND='corsair-link-fedcba9876543210',seed={...initial(),hubs:[...initial().hubs,{id:SECOND,name:'iCUE LINK System Hub',serial:'SECOND'}],probes:[{id:SECOND,readable:false,reason:'Zugriff noch von iCUE belegt.'}]},f=fixture(seed);await f.settle();
 const consent=f.elements.get('consent'),toggle=f.elements.get('enabled'),select=f.elements.get('hub');consent.checked=true;consent.listeners.change();assert.equal(toggle.disabled,true);
 select.value=SECOND;select.listeners.change();assert.equal(toggle.disabled,false);assert.match(f.elements.get('status').textContent,/Zugriff noch von iCUE belegt/);
 toggle.checked=true;toggle.listeners.change();await f.settle();assert.deepEqual(plain(f.calls[2]),{command:'control',value:{enabled:true,confirmICuePause:true,hubId:SECOND}});
});
test('SDK-only restoration failures keep an OFF retry even when native mode is already released and unavailable',async()=>{
 const open={...initial(),sdkSuppressed:true,returnRequired:true,phase:'error',error:'iCUE SDK konnte noch nicht fortgesetzt werden.',availability:{native:false}},f=fixture(open,command=>command==='control'?initial():open,false);await f.settle();
 assert.equal(f.elements.get('enabled').checked,true);assert.equal(f.elements.get('enabled').disabled,false);assert.equal(f.elements.get('release').hidden,false);assert.equal(f.elements.get('release').disabled,false);
 f.elements.get('release').listeners.click();await f.settle();assert.deepEqual(plain(f.calls[2]),{command:'control',value:{enabled:false}});assert.equal(f.elements.get('enabled').checked,false);
});
