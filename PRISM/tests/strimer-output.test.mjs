import test from 'node:test';
import assert from 'node:assert/strict';
import {strimerConnectionState,strimerTransmissionState,strimerControlPresentation,strimerControlRequest} from '../src/strimer-output.mjs';

const cable={id:60000,name:'Strimer Wireless 24-Pin · AABBCC',provider:'lianli-wireless',directMode:true,ledCount:132};
const result=upload=>({applied:[cable.id],uploads:[{deviceId:cable.id,transmitted:true,confirmed:true,confirmation:'receiver',...upload}]});

test('reported USB receivers without a paired cable remain unavailable output targets',()=>{
 const state=strimerConnectionState({native:{lianliWireless:{status:'ready',message:'Controller geöffnet; keine gekoppelten Kabel.'},discovery:[{provider:'lianli-wireless',name:'L-Wireless Controller',status:'detected'}]}});
 assert.equal(state.phase,'missing');assert.match(state.message,/keine gekoppelten/);assert.equal(state.diagnostics[0].name,'L-Wireless Controller');
 assert.throws(()=>strimerTransmissionState({applied:[]},cable),/Keine Übertragung/);
});

test('concrete access failures take priority over a generic missing cable message',()=>{
 const diagnostic={provider:'lianli-wireless',name:'L-Wireless Controller',status:'unavailable',code:'WIRELESS_ACCESS_DENIED',stage:'open',reason:'Zugriff verweigert (Windows 5).'};
 const state=strimerConnectionState({native:{lianliWireless:{status:'unavailable',message:'Allgemeiner Fehler.',diagnostics:[diagnostic]},discovery:[diagnostic]}});
 assert.equal(state.phase,'blocked');assert.equal(state.title,'Wireless-Zugriff blockiert');assert.equal(state.message,diagnostic.reason);assert.equal(state.diagnostics.length,1);assert.equal(state.diagnostics[0].stage,'open');
});

test('a remembered missing identity never substitutes another connected cable',()=>{
 const state=strimerConnectionState({selectedDevice:cable,rememberedMissing:true});
 assert.equal(state.phase,'missing');assert.match(state.message,/kein anderes Kabel automatisch/);
});

test('readiness requires an actual direct device with a valid LED count',()=>{
 assert.equal(strimerConnectionState({selectedDevice:cable}).phase,'ready');
 for(const patch of [{directMode:false},{ledCount:0},{ledCount:undefined},{ledCount:132.1}])assert.equal(strimerConnectionState({selectedDevice:{...cable,...patch}}).phase,'blocked');
 assert.equal(strimerConnectionState({native:null}).phase,'missing');
});

test('receiver acknowledgement and controller-only transmission are visibly distinct',()=>{
 const confirmed=strimerTransmissionState(result(),cable),pending=strimerTransmissionState(result({confirmed:false,confirmation:'transmitted'}),cable);
 assert.equal(confirmed.phase,'confirmed');assert.match(confirmed.message,/Funkempfänger bestätigt/);
 assert.equal(pending.phase,'pending');assert.match(pending.title,/Funkbestätigung steht aus/);assert.match(pending.message,/noch nicht bestätigt/);
});

test('another cable or a malformed acknowledgement cannot become a success message',()=>{
 for(const data of [undefined,{},result({deviceId:60001}),result({transmitted:false}),result({confirmation:'receiver',confirmed:false}),result({confirmation:'transmitted',confirmed:true}),{applied:[60001],uploads:result().uploads},{applied:[60000],uploads:[]},result({confirmation:'imagined'})])assert.throws(()=>strimerTransmissionState(data,cable));
});

test('ordinary direct cable acknowledgement does not pretend to verify a wireless receiver',()=>{
 const state=strimerTransmissionState({applied:[50000]},{id:50000,name:'Strimer Plus V2',provider:'test'});
 assert.equal(state.phase,'transmitted');assert.match(state.message,/Prüfe das Licht/);assert.doesNotMatch(state.title,/Funkempfänger/);
});

test('handoff starts off and requires fresh explicit service-pause consent',()=>{
 assert.equal(strimerControlPresentation().enabled,false);assert.equal(strimerControlPresentation().returnRequired,false);
 for(const consent of [false,undefined,null,'true',1])assert.throws(()=>strimerControlRequest({enabled:false,phase:'off'},consent),/ausdrücklich bestätigen/);
 assert.deepEqual(strimerControlRequest({enabled:false,phase:'off'},true),{enabled:true,confirmLConnectPause:true});
});

test('handoff and restoration phases prevent overlapping mode requests',()=>{
 for(const phase of ['starting','restoring']){
  assert.equal(strimerControlPresentation({phase}).changing,true);
  assert.throws(()=>strimerControlRequest({phase},true),/gerade umgeschaltet/);
 }
});

test('active mode and unfinished restoration allow return without a new pause consent',()=>{
 for(const control of [{enabled:true,phase:'active'},{enabled:true,phase:'error',message:'Dienstwiederherstellung fehlgeschlagen.'},{enabled:false,phase:'active'}]){
  const view=strimerControlPresentation(control);assert.equal(view.returnRequired,true);assert.match(view.button,/L-Connect wieder/);
  assert.deepEqual(strimerControlRequest(control,false),{enabled:false});
 }
});

test('handoff failure preserves the backend reason and does not claim successful ownership',()=>{
 const view=strimerControlPresentation({enabled:false,phase:'error',message:'Windows-Freigabe abgebrochen.'});
 assert.equal(view.enabled,false);assert.equal(view.phase,'error');assert.equal(view.message,'Windows-Freigabe abgebrochen.');assert.match(view.title,/Aufmerksamkeit/);
 assert.throws(()=>strimerControlRequest({enabled:false,phase:'error'},false),/ausdrücklich/);
});
