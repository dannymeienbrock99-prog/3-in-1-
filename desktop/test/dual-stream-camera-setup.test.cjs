'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const childProcess=require('node:child_process');

function fixture(t,execute){
 const file=require.resolve('../src/dual-stream/service.cjs'),cached=require.cache[file],original=childProcess.execFile;
 const calls=[];let DualStream;
 childProcess.execFile=(executable,args,options,callback)=>{
  calls.push({executable,args,options});
  queueMicrotask(()=>execute(callback));
 };
 delete require.cache[file];
 try{({DualStream}=require(file));}finally{
  childProcess.execFile=original;
  delete require.cache[file];if(cached)require.cache[file]=cached;
 }
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-camera-setup-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const service=new DualStream({directory,executable:path.join(directory,'BattoDualStream.exe'),safeStorage:{}});
 return {service,calls};
}

test('camera setup refuses active outputs without releasing or launching a process',async t=>{
 const {service,calls}=fixture(t,()=>assert.fail('setup must not run'));
 service.release=async()=>assert.fail('active cameras must not be released');
 service.probe=async()=>assert.fail('active cameras must not be probed');
 for(const state of ['camera','live','connecting','test']){
  service.state.outputs={tiktok:{state}};
  await assert.rejects(service.registerCameras());
 }
 assert.equal(calls.length,0);
});

test('camera setup waits for release and setup completion before probing fresh camera status',async t=>{
 let releaseDone,setupDone;
 const {service,calls}=fixture(t,callback=>{setupDone=callback;});
 const released=new Promise(resolve=>{releaseDone=resolve;});let probes=0;
 service.release=()=>released;
 const fresh={virtualCameras:{tiktok:{ready:true},twitch:{ready:true}}};
 service.probe=async()=>{probes++;service.probeResult=fresh;};
 const pending=service.registerCameras();
 assert.equal(calls.length,0);
 releaseDone();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);assert.equal(calls[0].executable,service.executable);
 assert.deepEqual(calls[0].args,['--setup-cameras']);assert.equal(calls[0].options.windowsHide,true);
 assert.equal(probes,0);
 setupDone(null,'','');
 const result=await pending;
 assert.equal(probes,1);assert.equal(result.probe,fresh);
});

test('cancelled Windows setup preserves its German explanation and never returns success or probes',async t=>{
 const stderr='Die Windows-Kameraeinrichtung wurde abgebrochen.\r\n';
 const failure=Object.assign(new Error('Command failed'),{code:1223,stderr});
 const {service,calls}=fixture(t,callback=>callback(failure,'',stderr));
 let releases=0;service.release=async()=>{releases++;};
 service.probe=async()=>assert.fail('cancelled setup must not probe');
 service.snapshot=()=>assert.fail('cancelled setup must not return a success snapshot');
 await assert.rejects(service.registerCameras(),error=>error.message===stderr.trim());
 assert.equal(releases,1);assert.equal(calls.length,1);
});

test('a native setup error with no stderr still rejects with an actionable explanation',async t=>{
 const {service}=fixture(t,callback=>callback(Object.assign(new Error('spawn ENOENT'),{code:'ENOENT'})));
 service.release=async()=>{};
 service.probe=async()=>assert.fail('failed setup must not probe');
 await assert.rejects(service.registerCameras(),error=>{
  assert.ok(error.message.trim().length>0);assert.notEqual(error.message,'spawn ENOENT');return true;
 });
});
