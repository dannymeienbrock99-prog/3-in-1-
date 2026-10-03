'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {VoiceClient}=require('../src/services/suite-runtime.cjs');
const {cleanSettings}=require('../src/services/jarvis-core.cjs');
function fixture(t){
 const children=[],events=[],client=new VoiceClient({codeRoot:'.',bundledRoot:'.',data:'.',spawnProcess:()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=0;child.jobs=[];child.killed=false;child.kill=()=>{child.killed=true;};
  child.stdin.on('data',chunk=>{for(const line of String(chunk).trim().split('\n'))if(line)child.jobs.push(JSON.parse(line));});children.push(child);return child;
 }});
 client.location=()=>({root:'.',exe:'fixture-only'});client.settings=cleanSettings({});client.on('event',event=>events.push(event));
 t.after(()=>client.close());return {client,children,events,ready:()=>children.at(-1).stdout.write(JSON.stringify({type:'ready',text:'fixture'})+'\n')};
}
test('stopping a full cold-start queue discards old speech and cannot lose cancellation',t=>{
 const {client,children,ready}=fixture(t);
 for(let n=0;n<8;n++)client.send({command:'speak',text:'Alte Meldung '+n});
 client.send({command:'stop'});ready();
 assert(!children[0].jobs.some(job=>job.command==='speak'));
 assert(children[0].jobs.some(job=>job.command==='stop'));
});
test('cold-start settings are coalesced and only current settings precede queued work',t=>{
 const {client,children,ready}=fixture(t);
 client.send({command:'listen',greeting:''});
 for(let volume=1;volume<=12;volume++)client.configure(cleanSettings({...client.settings,speechVolume:volume}));
 ready();
 const settings=children[0].jobs.filter(job=>job.command==='settings');
 assert.equal(settings.length,1);assert.equal(settings[0].value.speechVolume,12);
 assert.equal(children[0].jobs[0].command,'settings');assert.equal(children[0].jobs[1].command,'listen');
});
test('a microphone-off request during startup cancels an unstarted listening turn',t=>{
 const {client,children,ready}=fixture(t);
 client.send({command:'listen',greeting:''});client.send({command:'microphone',enabled:false});ready();
 assert(!children[0].jobs.some(job=>job.command==='listen'));
 assert(children[0].jobs.some(job=>job.command==='microphone'&&!job.enabled));
});
test('failed or exited voice workers clear pending commands and report a recoverable error',t=>{
 for(const event of ['error','exit']){
  const {client,children,events,ready}=fixture(t);
  client.send({command:'listen',greeting:'alte Begrüßung'});
  if(event==='error')children[0].emit(event,Error('fixture startup failure'));else children[0].emit(event,1);
  assert.equal(client.child,null);assert.deepEqual(client.pending,[]);assert(events.some(value=>value.type==='error'));
  client.send({command:'devices'});ready();
  assert(!children[1].jobs.some(job=>job.command==='listen'),'A failed old command must not run after restart');
 }
});
test('asynchronous stdin pipe errors cannot crash the app or leave the voice client busy',t=>{
 const {client,children,events,ready}=fixture(t);client.send({command:'devices'});ready();
 assert(children[0].stdin.listenerCount('error')>0,'Broken pipe needs an asynchronous error handler');
 children[0].stdin.emit('error',Error('fixture EPIPE'));
 assert.equal(client.child,null);assert.equal(client.ready,false);assert(events.some(value=>value.type==='error'));
});
