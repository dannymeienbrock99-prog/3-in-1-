'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SuiteRuntime}=require('../src/services/suite-runtime.cjs');

test('a failed fan release still closes the suite-owned telemetry and RGB services',async()=>{
 const calls=[],failed=new Error('Fan release not acknowledged');
 const fake={closed:false,jarvis:{cancelPendingModeration:()=>calls.push('jarvis')},voice:{close:()=>calls.push('voice')},fanControl:{close:async()=>{calls.push('fan-release');throw failed;}},fan:{close:()=>calls.push('telemetry')},server:{close:()=>calls.push('server')},rgb:{close:async()=>calls.push('rgb')}};
 await assert.rejects(SuiteRuntime.prototype.close.call(fake),error=>error===failed);
 assert.equal(fake.closed,true);
 assert.deepEqual(calls,['jarvis','voice','fan-release','telemetry','server','rgb']);
});

test('suite shutdown waits for the fan release before closing its other helpers',async()=>{
 const calls=[];let release;
 const fake={jarvis:{cancelPendingModeration(){}},voice:{close(){}},fanControl:{close:()=>new Promise(resolve=>{release=resolve;})},fan:{close:()=>calls.push('telemetry')},server:{close:()=>calls.push('server')},rgb:{close:async()=>calls.push('rgb')}};
 const closing=SuiteRuntime.prototype.close.call(fake);
 await Promise.resolve();assert.deepEqual(calls,[]);
 release();await closing;assert.deepEqual(calls,['telemetry','server','rgb']);
});
