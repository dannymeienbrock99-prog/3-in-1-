'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('preload exposes only fixed Corsair status, enumerate, control and manual IPC channels plus a disposable update subscription',async()=>{
 const calls=[],listeners=new Map();let api;
 const ipcRenderer={invoke:(channel,value)=>{calls.push({channel,value});return Promise.resolve({ok:true});},on:(channel,listener)=>listeners.set(channel,listener),removeListener:(channel,listener)=>{assert.equal(listeners.get(channel),listener);listeners.delete(channel);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'batto');api=value;}},ipcRenderer};}});
 assert.equal(calls.length,0);
 await api.corsairDirectStatus();await api.corsairDirectEnumerate();
 const control={enabled:true,confirmICuePause:true,hubId:'corsair-link-0123456789abcdef'},manual={id:'corsair-fan-1',duty:55,fanConfirmed:true};
 await api.corsairDirectControl(control);await api.corsairDirectManual(manual);
 assert.deepEqual(calls,[{channel:'suite:corsair-direct:status',value:undefined},{channel:'suite:corsair-direct:enumerate',value:undefined},{channel:'suite:corsair-direct:control',value:control},{channel:'suite:corsair-direct:manual',value:manual}]);
 let received;const unsubscribe=api.onCorsairDirectUpdate(value=>received=value),payload={active:false,retryRequired:true};
 listeners.get('corsair-direct:update')({},payload);assert.equal(received,payload);unsubscribe();assert.equal(listeners.size,0);
 assert.throws(()=>api.suite('corsair-direct:manual',manual),/Unbekannte Aktion/);
 assert.equal(api.hardware,undefined);assert.equal(api.corsairDirectRequest,undefined);
});
