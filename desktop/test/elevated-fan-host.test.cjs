'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Duplex}=require('node:stream');
const {ElevatedFanHost,launchFan}=require('../src/services/elevated-fan-host.cjs');
class PipeFixture extends Duplex {
  constructor({ready=true}={}){super();this.frames=[];this.readyReply=ready;this.on('finish',()=>this.destroy());}
  _read(){}
  _write(chunk,_encoding,callback){const value=JSON.parse(chunk.toString().trim());this.frames.push(value);setImmediate(()=>{
    if(value.command==='hello'&&this.readyReply)this.push('{"event":"ready"}\n');
    else if(value.requestId)this.push(JSON.stringify({requestId:value.requestId,ok:true,state:{enabled:value.command!=='disable',channels:[],sensors:[]},released:value.command==='disable'})+'\n');
  });callback();}
}
function fixture(){const pipe=new PipeFixture(),launches=[],connections=[];const host=new ElevatedFanHost({helperPath:'C:/Batto/DesktopFanControl/BattoFanControl.exe',launch:async value=>{launches.push(value);return {launched:true};},connect:options=>{connections.push(options);setImmediate(()=>pipe.emit('connect'));return pipe;},randomBytes:size=>Buffer.alloc(size,7),ownerPid:123});return {host,pipe,launches,connections};}
test('the elevated fan host authenticates one random local pipe before any hardware request',async()=>{
  const f=fixture();assert.equal(f.launches.length,0);await f.host.start();
  assert.equal(f.launches.length,1);assert.equal(f.launches[0].ownerPid,123);assert.match(f.launches[0].pipeName,/^batto-fan-[a-f0-9]{32}$/);assert.match(f.launches[0].token,/^[a-f0-9]{64}$/);
  assert.equal(f.connections[0].path,'\\\\.\\pipe\\'+f.launches[0].pipeName);assert.deepEqual(f.pipe.frames.map(v=>v.command),['hello']);
  await f.host.request('scan');await f.host.request('enable');assert.deepEqual(f.pipe.frames.map(v=>v.command),['hello','scan','enable']);
  await f.host.request('disable');await f.host.close();assert(f.pipe.destroyed);
});
test('an elevated fan launch denial performs no scan, fan write, or secondary program action',async()=>{
  let connected=0;const host=new ElevatedFanHost({launch:async()=>{throw Error('UAC denied');},connect:()=>{connected++;throw Error('must not connect');}});
  await assert.rejects(host.start(),/UAC denied/);assert.equal(connected,0);await host.close();
});
test('fan UAC launcher uses one fixed local executable, private arguments and a bounded Windows prompt',async()=>{
  let call;const value=await launchFan({helperPath:'C:/Batto/DesktopFanControl/BattoFanControl.exe',pipeName:'batto-fan-'+ 'a'.repeat(32),token:'b'.repeat(64),ownerPid:123,
    env:{SystemRoot:'C:/Windows'},exec:async(...args)=>{call=args;return {stdout:'{"launched":true,"ownerStartUtcTicks":"639006300000000000"}'};}});
  assert.equal(value.launched,true);assert.match(call[0],/powershell\.exe$/);assert.equal(call[2].windowsHide,true);assert.equal(call[2].timeout,120_000);assert.match(call[1][6],/DesktopFanControl[\\/]fan-control-launch\.ps1$/);
  assert(!call[1].includes('-Command'));
});
test('unconfirmed elevation response is sanitized and never leaks its token into the error',async()=>{
  const token='c'.repeat(64);await assert.rejects(launchFan({helperPath:'C:/Batto/DesktopFanControl/BattoFanControl.exe',ownerPid:123,pipeName:'batto-fan-'+ 'a'.repeat(32),token,exec:async()=>({stdout:JSON.stringify({token,launched:false})})}),error=>!error.message.includes(token)&&/Windows-Abfrage/.test(error.message));
});

test('a silent pipe candidate is destroyed within its bound and cannot bypass the connect deadline',async()=>{
  let clock=0;const sockets=[];
  const host=new ElevatedFanHost({launch:async()=>({launched:true}),now:()=>clock,delay:async()=>{clock=20_000;},connect:()=>{const socket=new PipeFixture();sockets.push(socket);return socket;}});
  await assert.rejects(host.start(),/nicht erreichbar/);assert.equal(sockets.length,2);assert(sockets.every(socket=>socket.destroyed));assert(sockets.every(socket=>socket.frames.length===0));await host.close();
});

test('an elevated helper close timeout can be retried after its eventual exit',async()=>{
  const socket=new PipeFixture();socket.removeAllListeners('finish');
  const host=new ElevatedFanHost({closeTimeoutMs:5});host.socket=socket;host.ready=true;host.starting=false;
  await assert.rejects(host.close(),/Beenden nicht bestätigt/);assert.equal(host.closePromise,null);
  socket.destroy();host.ended=true;await host.close();
});
