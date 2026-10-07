'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {RgbService}=require('../src/services/rgb-service.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const calls=[],control={fixture:true},hardware={available:true,request:async(provider,command)=>{calls.push(['native',provider,command]);return {suspended:command==='suspend-corsair',inProcess:true};}};
 const bridge={client:{beginWindowsLightingSuspend(){calls.push(['latch']);},async close(){calls.push(['close']);}},engine:{stop(){}},server:{close(done){done();}},status:()=>({connected:false,deviceCount:0,active:[]}),listen:async()=>({port:4783}),suspendWindowsLighting:async()=>calls.push(['suspend']),resumeWindowsLighting:async()=>calls.push(['resume']),refreshCorsairDirectLighting:async()=>calls.push(['refresh'])};
 const service=new RgbService({root:path.resolve(__dirname,'../../PRISM'),directory:path.join(os.tmpdir(),'absent-batto-fixture-'+process.pid),hardware,corsairDirectControl:control,bridgeFactory:options=>{calls.push(['factory']);assert.equal(options.corsairDirectControl,control);return bridge;}});
 return {service,hardware,bridge,calls};
}

test('RGB startup injects the shared direct controller without enumeration, takeover or a native command',async()=>{
 const f=fixture();assert.deepEqual(f.calls,[]);await f.service.start();assert.deepEqual(f.calls,[['factory']]);await f.service.close();assert.deepEqual(f.calls,[['factory'],['close']]);
});

test('takeover before opening RGB suppresses the native SDK and later UI startup never resumes it',async()=>{
 const f=fixture();await f.service.suspendForCorsairDirect();assert.deepEqual(f.calls,[['native','windows','suspend-corsair']]);assert.equal(f.service.corsairSdkSuppressed,true);await f.service.start();assert.deepEqual(f.calls,[['native','windows','suspend-corsair'],['factory']]);await f.service.stop();assert.equal(f.service.corsairSdkSuppressed,true);assert.equal(f.calls.some(value=>value.includes('resume-corsair')),false);
 await f.service.resumeAfterCorsairDirect();assert.equal(f.service.corsairSdkSuppressed,false);assert.deepEqual(f.calls.at(-1),['native','windows','resume-corsair']);await f.service.close();
});

test('the bridge latches writes immediately and awaits already accepted RGB operations before release',async()=>{
 const f=fixture();await f.service.start();f.calls.length=0;const accepted=deferred();f.service.queue=accepted.promise;const pending=f.service.suspendForCorsairDirect();await settle();assert(f.calls.some(value=>value[0]==='latch'));assert.equal(f.calls.some(value=>value[0]==='suspend'),false);
 accepted.resolve();await pending;assert.equal(f.calls.at(-1)[0],'suspend');await f.service.resumeAfterCorsairDirect();assert.equal(f.calls.at(-1)[0],'resume');await f.service.close();
});

test('a raw-device refresh does not auto-start RGB and updates only an existing bridge',async()=>{
 const f=fixture();await f.service.refreshCorsairDirect();assert.deepEqual(f.calls,[]);await f.service.start();await f.service.refreshCorsairDirect();assert.deepEqual(f.calls,[['factory'],['refresh']]);await f.service.close();
});

test('invalid SDK acknowledgements keep suppression pending so the same restoration can be retried',async()=>{
 const f=fixture();f.hardware.request=async()=>({suspended:false,inProcess:true});await assert.rejects(f.service.suspendForCorsairDirect(),/nicht bestätigt/);assert.equal(f.service.corsairSdkSuppressed,true);
 f.hardware.request=async()=>({suspended:true,inProcess:true});await assert.rejects(f.service.resumeAfterCorsairDirect(),/nicht bestätigt/);assert.equal(f.service.corsairSdkSuppressed,true);
 f.hardware.request=async()=>({suspended:false,inProcess:true});await f.service.resumeAfterCorsairDirect();assert.equal(f.service.corsairSdkSuppressed,false);await f.service.close();
});
