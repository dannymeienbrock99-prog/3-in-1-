'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SuiteRuntime}=require('../src/services/suite-runtime.cjs');

test('a failed fan release retains the suite so the user can retry returning hardware',async()=>{
 const calls=[],failed=new Error('Fan release not acknowledged');
 const fake={closed:false,corsairDirect:{close:async()=>calls.push('corsair-release')},jarvis:{cancelPendingModeration:()=>calls.push('jarvis')},voice:{close:()=>calls.push('voice')},fanControl:{close:async()=>{calls.push('fan-release');throw failed;}},fan:{close:()=>calls.push('telemetry')},server:{close:()=>calls.push('server')},rgb:{close:async()=>calls.push('rgb')}};
 await assert.rejects(SuiteRuntime.prototype.close.call(fake),error=>error===failed);
 assert.equal(fake.closed,false);
 assert.deepEqual(calls,['corsair-release','fan-release']);
});

test('suite shutdown waits for the fan release before closing its other helpers',async()=>{
 const calls=[];let release;
 const fake={corsairDirect:{close:async()=>{}},hardware:{close:async()=>calls.push('hardware')},jarvis:{cancelPendingModeration(){}},voice:{close(){}},fanControl:{close:()=>new Promise(resolve=>{release=resolve;})},fan:{close:()=>calls.push('telemetry')},server:{close:()=>calls.push('server')},rgb:{close:async()=>calls.push('rgb')}};
 const closing=SuiteRuntime.prototype.close.call(fake);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[]);
 release();await closing;assert.deepEqual(calls,['rgb','telemetry','server','hardware']);
});
