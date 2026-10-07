import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InProcessStrimerControl,InProcessLianLiWirelessClient,InProcessWindowsLightingClient} from '../server/in-process-lighting.mjs';
import {LightingClient} from '../server/lighting-client.mjs';
import {strimerControlPresentation,strimerControlRequest} from '../src/strimer-output.mjs';

test('in-process takeover still requires consent and does not start any helper',async()=>{
 const calls=[];const hardware={available:true,request:async(...args)=>{calls.push(args);return {ok:true,active:true,released:false,remaining:[]};}};
 const control=new InProcessStrimerControl(hardware);
 await assert.rejects(control.start(false),error=>error.code==='WIRELESS_CONSENT_REQUIRED');assert.equal(calls.length,0);
 assert.throws(()=>strimerControlRequest(control.status,false),/ausdrücklich/);
 assert.deepEqual(strimerControlRequest(control.status,true),{enabled:true,confirmLConnectPause:true});
 await control.start(true);assert.deepEqual(calls,[['wireless','take-control',{confirmLConnectPause:true}]]);assert.equal(control.status.enabled,true);
});

test('partial restoration keeps OFF retry visible and never reports released',async()=>{
 let failing=true;const hardware={available:true,request:async(provider,command)=>{
  if(command==='take-control')return {ok:true,active:true};
  if(failing)throw Object.assign(Error('Dienst konnte nicht starten'),{state:{ok:false,active:true,retryRequired:true,remaining:['LConnectService']}});
  return {ok:true,active:false,released:true,remaining:[]};
 }};
 const control=new InProcessStrimerControl(hardware);await control.start(true);
 await assert.rejects(control.stop(),/nicht starten/);assert.equal(control.status.enabled,true);
 const view=strimerControlPresentation(control.status);assert.equal(view.phase,'error');assert.equal(view.returnRequired,true);
 assert.deepEqual(strimerControlRequest(control.status,false),{enabled:false});
 failing=false;await control.stop();assert.equal(control.status.enabled,false);assert.equal(control.status.phase,'off');
});

test('wireless adapter forwards real native errors and service lease state',async()=>{
 const actual={active:true,retryRequired:true,remaining:['LConnectService']};
 const client=new InProcessLianLiWirelessClient({available:true,request:async()=>{throw Object.assign(Error('denied'),{code:'WIRELESS_ACCESS_DENIED',state:actual});}},{platform:'win32'});
 await assert.rejects(client.request('enumerate'),error=>error.code==='WIRELESS_ACCESS_DENIED'&&error.state===actual);
});

test('failed takeover is not marked active without a native lease',async()=>{
 const control=new InProcessStrimerControl({available:true,request:async()=>{throw Object.assign(Error('Administratorrechte fehlen'),{state:{ok:false,active:false,released:true,remaining:[]}});}});
 await assert.rejects(control.start(true),/Administratorrechte/);assert.equal(control.status.enabled,false);assert.equal(control.status.phase,'error');
});

test('integrated Windows discovery retains diagnostics and exposes unavailable separate window through combined status',async()=>{
 const calls=[];
 const hardware={available:true,request:async(provider,command)=>{
  calls.push([provider,command]);
  return {devices:[{id:1,name:'Windows light',provider:'windows',ledCount:1}],environment:{windows:{deviceCount:1,available:true}},warnings:['fixture warning']};
 }};
 const client=new InProcessWindowsLightingClient(hardware,{platform:'win32'});
 await client.scan();
 assert.deepEqual(calls,[['windows','enumerate']]);
 assert.deepEqual(client.details.windows,{deviceCount:1,available:true,inProcess:true,showWindowAvailable:false});
 const combined=new LightingClient({clients:[client]});combined.refresh();
 assert.equal(combined.details.windows.showWindowAvailable,false);
 assert.equal(combined.details.windows.deviceCount,1);
 assert.deepEqual(combined.details.warnings,['fixture warning']);
 await assert.rejects(client.showWindow(),error=>error.code==='INTEGRATED_UI');
 assert.equal(calls.length,1);
});
