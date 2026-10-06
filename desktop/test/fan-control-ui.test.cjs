'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/renderer/fan-control-ui.js'),'utf8');
const initial = () => ({enabled:false,phase:'off',platform:{kind:'desktop',brand:'asus',manufacturer:'ASUSTeK',model:'ROG CROSSHAIR TEST'},availability:{native:true,reason:''},channels:[],sensors:[],error:''});
function fixture(next = initial(), respond) {
  const calls = [], elements = new Map(), events = {}, cards = [];
  function element(dataset = {}) {
    return {dataset,disabled:false,checked:false,hidden:false,textContent:'',value:'',valueAsNumber:NaN,innerHTML:'',listeners:{},classList:{add(){}},setAttribute(key,value){this[key]=value;},addEventListener(name,fn){this.listeners[name]=fn;},closest(){return null;}};
  }
  const root = element(), channelHost = element();
  for (const name of ['enabled','brand','model','platform','phase','refresh','status','error','toggle-label','release-note','curve-availability']) elements.set(name,element());
  elements.set('channels',channelHost);
  root.querySelector = selector => elements.get(selector.match(/data-pc-fan="([^"]+)"/)?.[1]);
  root.querySelectorAll = () => [];
  let html = '';
  Object.defineProperty(channelHost,'innerHTML',{get:()=>html,set:value=>{
    html=value;cards.length=0;
    for (const block of value.matchAll(/<article[^>]*data-fan-channel="([^"]*)">([\s\S]*?)<\/article>/g)) {
      const card=element({fanChannel:block[1]}), controls=new Map();
      for (const name of ['confirmed','range','duty','sensor']) controls.set('input:'+name,element({fanInput:name}));
      for (const name of ['manual','curve']) controls.set('action:'+name,element({fanAction:name}));
      for (const name of ['rpm','duty']) controls.set('reading:'+name,element());
      const duty=block[2].match(/data-fan-input="duty"[^>]*value="([^"]*)"/);controls.get('input:duty').value=duty?.[1]||'';
      card.querySelector=selector=>selector.includes('data-fan-action')?controls.get('action:'+selector.match(/="([^"]*)"/)?.[1]):selector.includes('data-fan-input')?controls.get('input:'+selector.match(/="([^"]*)"/)?.[1]):controls.get('reading:'+(selector.includes('rpm')?'rpm':'duty'));
      card.querySelectorAll=()=>[...controls].filter(([key])=>!key.startsWith('reading:')).map(([,value])=>value);
      for (const control of controls.values()) control.closest=selector=>selector==='[data-fan-channel]'?card:selector==='[data-fan-action]'&&control.dataset.fanAction?control:null;
      card.controls=controls;cards.push(card);
    }
  }});
  channelHost.querySelectorAll=()=>cards;
  const document={querySelector:()=>root,addEventListener:(name,fn)=>events[name]=fn};
  let suiteListener;
  const window={batto:{async suite(command,value){calls.push({command,value});return respond?respond(command,value,next):next;},onSuiteState(fn){suiteListener=fn;}}};
  vm.runInNewContext(source,{window,document,Date,Map,Promise,Number,String,JSON},{filename:'fan-control-ui.js'});
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
  return {calls,root,elements,channelHost,cards,settle,publish:value=>suiteListener({fanControl:value}),click:control=>channelHost.listeners.click({target:control}),change:control=>channelHost.listeners.change({target:control}),input:control=>channelHost.listeners.input({target:control})};
}
test('opening desktop fan controls only reads state, and publishing a ready state never applies cooling settings',async()=>{
  const f=fixture();await f.settle();assert.deepEqual(f.calls.map(x=>x.command),['fan-control-state']);assert.equal(f.elements.get('enabled').checked,false);assert.equal(f.elements.get('enabled').disabled,false);assert.equal(f.elements.get('brand').textContent,'ASUS');assert.equal(f.elements.get('model').textContent,'ROG CROSSHAIR TEST');
  f.publish({...initial(),enabled:true,phase:'ready'});await f.settle();assert.equal(f.calls.length,1);assert.equal(f.elements.get('enabled').checked,true);
});
test('portable and unconfirmed chassis cannot request activation even if a synthetic native flag is present',async()=>{
  for (const kind of ['portable','unknown']) {
    const f=fixture({...initial(),platform:{kind,brand:'msi',model:'Test'}});await f.settle();const toggle=f.elements.get('enabled');assert.equal(toggle.disabled,true);toggle.checked=true;toggle.listeners.change();await f.settle();assert.equal(f.calls.length,1);assert.equal(toggle.checked,false);assert.equal(f.elements.get('error').hidden,false);
  }
});
test('manual control requires a confirmed fan, enforces the duty floor, and sends only the exact chosen channel',async()=>{
  const state={...initial(),enabled:true,phase:'ready',channels:[{id:'superio/one/chassis1',kind:'fan',name:'CHA_FAN1',provider:'Native',device:'Test',rpm:0,minDuty:30,maxDuty:100},{id:'pump',kind:'pump',name:'AIO_PUMP',rpm:1200}]}, f=fixture(state);await f.settle();assert.equal(f.cards.length,1);
  const card=f.cards[0], apply=card.controls.get('action:manual'), confirmed=card.controls.get('input:confirmed'), duty=card.controls.get('input:duty');assert.equal(apply.disabled,true);assert.equal(card.controls.get('reading:rpm').textContent,'0 RPM');f.click(apply);await f.settle();assert.equal(f.calls.length,1);
  confirmed.checked=true;f.change(confirmed);assert.equal(apply.disabled,false);duty.value='0';duty.valueAsNumber=0;f.input(duty);f.click(apply);await f.settle();assert.equal(f.calls.length,1);assert.match(f.elements.get('error').textContent,/30 und 100/);
  duty.value='50.1';duty.valueAsNumber=50.1;f.input(duty);f.click(apply);await f.settle();assert.equal(f.calls.length,1);assert.match(f.elements.get('error').textContent,/ganze Prozentzahl/);
  duty.value='55';duty.valueAsNumber=55;f.input(duty);f.click(apply);await f.settle();assert.equal(f.calls[1].command,'fan-control-manual');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].value)),{id:'superio/one/chassis1',duty:55,fanConfirmed:true});
});
test('stale temperature sources cannot run a curve; a fresh selected source sends explicitly confirmed points',async()=>{
  const state={...initial(),enabled:true,phase:'ready',channels:[{id:'cpu1',kind:'fan',name:'CPU_FAN',rpm:null}],sensors:[{id:'cpu-temp',name:'CPU',celsius:45,updatedUtc:new Date(Date.now()-60000).toISOString()}]},f=fixture(state);await f.settle();const card=f.cards[0], confirmed=card.controls.get('input:confirmed'),select=card.controls.get('input:sensor'),apply=card.controls.get('action:curve');confirmed.checked=true;f.change(confirmed);select.value='cpu-temp';f.change(select);assert.equal(apply.disabled,true);f.click(apply);await f.settle();assert.equal(f.calls.length,1);assert.match(f.elements.get('error').textContent,/aktuelle Temperaturquelle/);
  f.publish({...state,sensors:[{...state.sensors[0],updatedUtc:new Date().toISOString()}]});assert.equal(apply.disabled,false);f.click(apply);await f.settle();assert.equal(f.calls[1].command,'fan-control-curve');const value=JSON.parse(JSON.stringify(f.calls[1].value));assert.equal(value.id,'cpu1');assert.equal(value.sensorId,'cpu-temp');assert.equal(value.fanConfirmed,true);assert.deepEqual(value.points,[{temperature:30,duty:30},{temperature:50,duty:50},{temperature:70,duty:80},{temperature:85,duty:100}]);assert.equal(card.controls.get('reading:rpm').textContent,'— RPM');
});
test('a failed release retains the real enabled state and does not claim that cooling was returned',async()=>{
  const state={...initial(),enabled:true,phase:'ready'}, f=fixture(state,command=>command==='fan-control-enable'?{...state,phase:'error',error:'Rückgabe noch nicht bestätigt'}:state);await f.settle();const toggle=f.elements.get('enabled');toggle.checked=false;toggle.listeners.change();await f.settle();assert.equal(toggle.checked,true);assert.equal(toggle.disabled,false);assert.equal(f.elements.get('error').textContent,'Rückgabe noch nicht bestätigt');assert.doesNotMatch(f.elements.get('status').textContent,/Steuerung wurde zurückgegeben/);
});
test('a driver-only release reports the request instead of claiming physical BIOS restoration',async()=>{
  const state={...initial(),enabled:true,phase:'ready'}, f=fixture(state,command=>command==='fan-control-enable'?{...initial(),releaseVerification:'api-only'}:state);await f.settle();const toggle=f.elements.get('enabled');toggle.checked=false;toggle.listeners.change();await f.settle();assert.equal(toggle.checked,false);assert.equal(f.elements.get('release-note').hidden,false);assert.equal(f.elements.get('status').textContent,'Batto steuert keine Lüfter. Hardware-Regelung angefordert.');
});
test('an unavailable native curve shows its limit and remains blocked even with a fresh fixture sensor',async()=>{
  const state={...initial(),enabled:true,phase:'ready',curveAvailability:{available:false,reason:'Kein bestätigter Messzeitpunkt'},channels:[{id:'cpu1',kind:'fan',name:'CPU_FAN',rpm:1000}],sensors:[{id:'cpu-temp',name:'CPU',celsius:45,updatedUtc:new Date().toISOString()}]},f=fixture(state);await f.settle();assert.equal(f.elements.get('curve-availability').hidden,false);const card=f.cards[0],confirmed=card.controls.get('input:confirmed'),select=card.controls.get('input:sensor'),apply=card.controls.get('action:curve');confirmed.checked=true;f.change(confirmed);select.value='cpu-temp';f.change(select);assert.equal(apply.disabled,true);f.click(apply);await f.settle();assert.equal(f.calls.length,1);assert.match(f.elements.get('error').textContent,/manuelle Steuerung/);
});
