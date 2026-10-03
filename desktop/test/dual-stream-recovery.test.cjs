'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NativeClient}=require('../src/dual-stream/native-client.cjs'),{DualStream}=require('../src/dual-stream/service.cjs');
test('failed native executable start clears the process reference and pending work',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-native-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const client=new NativeClient(path.join(directory,'does-not-exist.exe'),directory);let exited=0;client.on('exit',()=>exited++);
 await assert.rejects(client.open(),/nicht gestartet|beim Start/);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(client.process,null);assert.equal(client.pending.size,0);assert.equal(exited,1);
 await client.close();
});
test('failed reprepare clears obsolete source state and closes the idle native process',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-prepare-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const service=new DualStream({directory,executable:'unused',safeStorage:{}});let closed=0;
 service.state={prepared:true,outputs:{tiktok:{state:'stopped'}}};service.sourceState={camera:true};
 service.native={request:async()=>{throw Error('Synthetic prepare failure');},close:async()=>{closed++;}};service.client=async()=>service.native;
 await assert.rejects(service.prepare(),/Synthetic prepare failure/);
 assert.equal(service.state.prepared,false);assert.equal(service.native,null);assert.deepEqual(service.sourceState,{});assert.equal(closed,1);
});
test('unexpected native exit rejects pending requests and clears stale source indicators',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-native-exit-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const script=path.join(directory,'fake-host.cjs');fs.writeFileSync(script,"process.stdout.write('BATTO_JSON:{\"ready\":true}\\n');process.stdin.once('data',()=>process.exit(0));");
 const service=new DualStream({directory,executable:process.execPath,safeStorage:{}});service.config.obsRoot=script;
 const client=await service.client();service.state={prepared:true,outputs:{}};service.sourceState={camera:true};
 await assert.rejects(client.request('simulate-exit'),/beendet/);
 assert.equal(client.pending.size,0);assert.equal(service.native,null);assert.equal(service.state.prepared,false);assert.deepEqual(service.sourceState,{});
});
test('successful explicit retry clears obsolete video error without a background poll masking it',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-scene-recovery-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const service=new DualStream({directory,executable:'unused',safeStorage:{}});
 await assert.rejects(service.serial(()=>service.scene('missing')),/nicht vorhanden/);assert(service.error);
 await service.serial(async()=>{},true);assert(service.error,'silent status polling must retain the actionable error');
 await service.serial(()=>service.scene('Pause'));assert.equal(service.error,'');assert.equal(service.config.program.scene,'Pause');
});
