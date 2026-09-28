'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {PhysicalInputBackend}=require('../src/core/physical-input.cjs');
const {InputHotkeys}=require('../src/core/input-hotkeys.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const child=new EventEmitter(),commands=[];
 Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){throw new Error('Fake helper should stop gracefully');}});
 child.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n'))if(line)commands.push(JSON.parse(line));});
 child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('exit',0)));
 const backend=new PhysicalInputBackend({executable:__filename,spawnImpl:()=>child});
 return {backend,commands,ready:()=>child.stdout.write(JSON.stringify({type:'ready'})+'\n'),reply:value=>child.stdout.write(JSON.stringify(value)+'\n'),close:()=>backend.stop()};
}
async function main(){
 let f=fixture();try{
  const capture=f.backend.capture(),rejected=assert.rejects(capture,/Aufnahme beendet/);f.backend.cancelCapture();
  // This settles without receiving ready; no hidden capture may be queued later.
  await rejected;assert.equal(f.backend.pending.size,0);f.ready();await tick();
  assert.equal(f.commands.filter(x=>x.type==='capture').length,0);assert.equal(f.backend.pending.size,0);
 }finally{f.close();}
 f=fixture();try{
  const first=f.backend.capture(),firstRejected=assert.rejects(first,/Aufnahme beendet/);
  const second=f.backend.capture();await firstRejected;f.ready();await tick();
  const sent=f.commands.filter(x=>x.type==='capture');assert.equal(sent.length,1);
  f.reply({id:sent[0].id,type:'capture',ok:true,accelerator:'A+B'});
  assert.equal((await second).accelerator,'A+B');assert.equal(f.backend.pending.size,0);assert.equal(f.backend.cancelStartingCapture,null);
 }finally{f.close();}
 f=fixture();try{
  const started=f.backend.start();f.ready();await started;
  const capture=f.backend.capture(),rejected=assert.rejects(capture,/Aufnahme beendet/);await tick();
  const sent=f.commands.find(x=>x.type==='capture');assert.ok(sent);f.backend.cancelCapture();await rejected;
  f.reply({id:sent.id,type:'capture',ok:true,accelerator:'RButton'});await tick();assert.equal(f.backend.pending.size,0);
  const next=f.backend.capture();await tick();const latest=f.commands.filter(x=>x.type==='capture').at(-1);f.reply({id:latest.id,type:'capture',ok:true,accelerator:'Control+LButton'});assert.equal((await next).accelerator,'Control+LButton');
 }finally{f.close();}
 f=fixture();try{
  const capture=f.backend.capture(),rejected=assert.rejects(capture,/beendet/);f.backend.stop();await rejected;await tick();assert.equal(f.commands.filter(x=>x.type==='capture').length,0);
 }finally{f.close();}
 f=fixture();let calls=0;const manager=new InputHotkeys({backend:f.backend,trigger:()=>{calls++;},stop:()=>{calls++;}});
 try{
  const first=manager.capture(),rejected=assert.rejects(first,/beendet/);const second=manager.capture();
  await rejected;assert.equal(manager.capturing,true);manager.run({id:'blocked',chainId:'test',debounceMs:50});assert.equal(calls,0);
  f.ready();await tick();const sent=f.commands.filter(x=>x.type==='capture');assert.equal(sent.length,1);
  manager.run({id:'still-blocked',chainId:'test',debounceMs:50});assert.equal(calls,0);
  f.reply({id:sent[0].id,type:'capture',ok:true,accelerator:'A+B'});await second;assert.equal(manager.capturing,false);
  manager.run({id:'allowed-after-capture',chainId:'test',debounceMs:50});assert.equal(calls,1);
 }finally{manager.clear();f.close();}
 console.log('PASS capture startup race: immediate cancel before ready, replacement capture, late result, next capture, stop during startup and parallel manager capture guard. Fake streams only; no native input.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
