'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {ActionEngine}=require('../src/core/action-engine.cjs');
const source=fs.readFileSync(require.resolve('../electron/main21.cjs'),'utf8');
const begin=source.indexOf("  ipcMain.handle('automation:testSequence'");
const end=source.indexOf("  ipcMain.handle('welcome:reset'",begin);
assert.ok(begin>0&&end>begin);
const cfg={rules:{maxConcurrentRuns:25},keyActions:[{id:'qa-output',name:'QA',process:'Own Test',keys:'K+LButton',keyFormat:'chord',holdMs:100,enabled:true}]};
const engine=new ActionEngine({getConfig:()=>cfg}),handlers=new Map();
// Execute the actual two IPC registrations with only their explicit dependencies.
// Electron and the Windows helper are never started.
vm.runInNewContext(source.slice(begin,end),{actionEngine:engine,crypto,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}});
const action={type:'key-action',keyActionId:'qa-output'},tick=()=>new Promise(resolve=>setImmediate(resolve));
async function main(){
 const signals=[];
 engine.hotkey=(_action,signal)=>new Promise((_resolve,reject)=>{signals.push(signal);const aborted=()=>{const error=new Error('Isolated output cancelled');error.code='ACTION_CANCELLED';reject(error);};signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();});
 const first=handlers.get('automation:testAction')(null,action);
 const second=handlers.get('automation:testSequence')(null,{actions:[action]});
 await tick();assert.equal(engine.active().length,2);assert.equal(signals.length,2);assert.ok(signals.every(signal=>!signal.aborted));
 const stopped=engine.cancelAll();assert.equal(stopped.cancelled.length,2);
 const cancelled=await Promise.all([first,second]);assert.ok(cancelled.every(result=>result.ok===false));assert.ok(signals.every(signal=>signal.aborted));assert.equal(engine.active().length,0);
 assert.equal(engine.ruleCooldowns.size,0,'Unique manual test IDs must not retain zero-cooldown entries');
 let calls=0;engine.hotkey=async()=>{calls++;return{ok:true,inputSent:true,confirmed:false};};
 const success=await handlers.get('automation:testAction')(null,action);assert.equal(success.ok,true);assert.equal(success.results[0].type,'key-action');assert.equal(success.results[0].result.keyActionId,action.keyActionId);
 const continued=await handlers.get('automation:testSequence')(null,{actions:[{...action,keyActionId:'missing'},action],failurePolicy:'continue',context:{platform:'tiktok',user:'QA'}});assert.equal(continued.ok,false);assert.equal(continued.results.length,2);assert.equal(calls,2);
 const stoppedOnFailure=await handlers.get('automation:testSequence')(null,{actions:[{...action,keyActionId:'missing'},action]});assert.equal(stoppedOnFailure.ok,false);assert.equal(stoppedOnFailure.results.length,1);assert.equal(calls,2);
 assert.equal((await handlers.get('automation:testSequence')(null,{actions:[]})).ok,false);assert.equal(engine.active().length,0);assert.equal(engine.ruleCooldowns.size,0);
 let timeoutSignal;engine.hotkey=(_action,signal)=>{timeoutSignal=signal;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:false,error:'Timed output cancelled'}),{once:true}));};
 const timeout=await handlers.get('automation:testSequence')(null,{actions:[action],timeoutMs:250});assert.equal(timeout.ok,false);assert.match(timeout.error,/Timeout/);assert.equal(timeoutSignal.aborted,true);assert.equal(engine.active().length,0);
 const normal=await engine.executeRule({id:'normal-cooldown',cooldownSeconds:10,actions:[{type:'delay',ms:0}]},{},'event');assert.equal(normal.ok,true);assert.ok(engine.ruleCooldowns.has('normal-cooldown'));assert.equal((await engine.executeRule({id:'normal-cooldown',cooldownSeconds:10,actions:[{type:'delay',ms:0}]},{},'event')).skipped,'cooldown');
 console.log('PASS actual manual-test IPC: action and sequence registered/cancellable together, native boundary receives abort, unchanged result/failure policy, timeout releases, zero-cooldown cleanup and normal cooldown preserved. No Electron startup, external calls or OS input.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
