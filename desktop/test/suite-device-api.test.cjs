'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const sourcePath=path.resolve(__dirname,'../src/services/suite-runtime.cjs'),relativeRequire=createRequire(sourcePath),token='a'.repeat(64),port=17666;
const routes=['/api/corsair-direct/enumerate','/api/corsair-direct/control','/api/corsair-direct/manual','/api/fan-control/inspect','/api/fan-control/control'];
async function fixture(){
 let handler;const calls=[],files=[],server=Object.assign(new EventEmitter(),{listen(actualPort,host,ready){assert.equal(actualPort,port);assert.equal(host,'127.0.0.1');ready();}}),sandbox={module:{exports:{}},Buffer,JSON,process:{env:{BATTO_TEST_INSTANCE:'1'},pid:12345},require:name=>name==='node:http'?{createServer:fn=>{handler=fn;return server;}}:name==='node:fs'?{mkdirSync(){},writeFileSync(...args){files.push(args);}}:relativeRequire(name)};
 vm.runInNewContext(fs.readFileSync(sourcePath,'utf8'),sandbox,{filename:sourcePath});
 const runtime={directory:'fixture-only',token,corsairDirect:{enumerate:async()=>{calls.push(['enumerate']);return {enabled:false,active:false,hubs:[{id:'exact-hub'}]};},enable:async(enabled,options)=>{calls.push(['enable',enabled,options]);return {enabled,active:enabled,phase:enabled?'ready':'off'};},setManual:async value=>{calls.push(['manual',value]);return {enabled:true,applied:true};}},fanControl:{inspect:async()=>{calls.push(['inspect']);return {enabled:false,platform:{brand:'msi'}};},enable:async enabled=>{calls.push(['fan-enable',enabled]);return {enabled,phase:enabled?'ready':'off'};}},rgb:{refreshCorsairDirect:async()=>calls.push(['refresh'])},controls:{execute:async value=>{calls.push(['existing-control',value]);return {ok:true};}},jarvis:{execute:async(text,options)=>{calls.push(['command',text,JSON.parse(JSON.stringify(options))]);return {ok:true};}}};
 await sandbox.module.exports.SuiteRuntime.prototype.startServer.call(runtime);
 async function request(route,{method='POST',data={},body,headers={}}={}){
  const response={status:0,headers:{},setHeader(name,value){this.headers[name]=value;},writeHead(code,values){this.status=code;Object.assign(this.headers,values);return this;},end(value){this.raw=value;return this;}};
  const request={method,url:route,headers:{host:'127.0.0.1:'+port,authorization:'Bearer '+token,'content-type':'application/json',...headers},async *[Symbol.asyncIterator](){yield Buffer.from(body===undefined?JSON.stringify(data):body);}};
  await handler(request,response);return {...response,value:response.raw?JSON.parse(response.raw):null};
 }
 return {runtime,calls,files,request};
}

test('every new route keeps token, loopback Host, Origin, JSON and bounded-body checks before the shared control is called',async()=>{
 const f=await fixture();assert.equal(f.files.length,1);assert.deepEqual(f.calls,[]);
 for(const route of routes){
  for(const headers of [{authorization:''},{authorization:'Bearer wrong'}])assert.equal((await f.request(route,{headers})).status,401);
  for(const headers of [{host:'example.com:'+port},{origin:'https://example.com'},{origin:'null'}])assert.equal((await f.request(route,{headers})).status,403);
  assert.equal((await f.request(route,{headers:{'content-type':'text/plain'}})).status,415);
  assert.equal((await f.request(route,{body:'x'.repeat(8193)})).status,413);
  for(const body of ['{broken','null','[]'])assert.equal((await f.request(route,{body})).status,400);
  assert.equal((await f.request(route,{method:'GET'})).status,404);
 }
 assert.deepEqual(f.calls,[]);assert.equal((await f.request('/api/corsair-direct/shell')).status,404);
});

test('passive Corsair enumeration and mainboard inspection call only their read-only shared methods',async()=>{
 const f=await fixture();const enumeration=await f.request(routes[0]);assert.equal(enumeration.status,200);assert.equal(enumeration.value.enabled,false);assert.deepEqual(enumeration.value.hubs,[{id:'exact-hub'}]);
 const inspection=await f.request(routes[3]);assert.equal(inspection.status,200);assert.equal(inspection.value.enabled,false);assert.equal(inspection.value.platform.brand,'msi');assert.deepEqual(f.calls,[['enumerate'],['inspect']]);
});

test('control requires a real boolean and passes the existing explicit consent unchanged, then refreshes only after successful ownership',async()=>{
 const f=await fixture();for(const enabled of [undefined,1,'true',null])assert.equal((await f.request(routes[1],{data:{enabled,confirmICuePause:true}})).status,400);assert.deepEqual(f.calls,[]);
 const input={enabled:true,confirmICuePause:true,hubId:'exact-hub'},enabled=await f.request(routes[1],{data:input});assert.equal(enabled.status,200);assert.equal(enabled.value.active,true);assert.deepEqual(f.calls,[['enable',true,input],['refresh']]);
 const disabled=await f.request(routes[1],{data:{enabled:false}});assert.equal(disabled.status,200);assert.equal(disabled.value.active,false);assert.deepEqual(f.calls.at(-1),['enable',false,{enabled:false}]);assert.equal(f.calls.filter(value=>value[0]==='refresh').length,1);
});

test('manual fan validation and genuine acknowledgement are delegated unchanged to the same controller as the UI',async()=>{
 const f=await fixture(),manual={id:'exact-fan',duty:55,fanConfirmed:true};const result=await f.request(routes[2],{data:manual});assert.equal(result.status,200);assert.equal(result.value.applied,true);assert.deepEqual(f.calls,[['manual',manual]]);
 f.runtime.corsairDirect.setManual=async()=>{throw Object.assign(Error('Fan identity changed'),{code:'CORSAIR_DEVICE_CHANGED'});};const failed=await f.request(routes[2],{data:manual});assert.equal(failed.status,400);assert.equal(failed.value.ok,false);assert.equal(failed.value.code,'CORSAIR_DEVICE_CHANGED');
});

test('a failed takeover cannot trigger RGB refresh or turn a partial failure into success',async()=>{
 const f=await fixture();f.runtime.corsairDirect.enable=async()=>{throw Object.assign(Error('iCUE pause refused'),{code:'CORSAIR_CONSENT_REQUIRED'});};const result=await f.request(routes[1],{data:{enabled:true}});assert.equal(result.status,400);assert.equal(result.value.ok,false);assert.equal(result.value.code,'CORSAIR_CONSENT_REQUIRED');assert.deepEqual(f.calls,[]);
});

test('existing authenticated commands and controls retain their shared execution path',async()=>{
 const f=await fixture();assert.equal((await f.request('/api/control',{data:{action:'fixture'}})).status,200);assert.equal((await f.request('/api/command',{data:{text:'fixture'}})).status,200);assert.deepEqual(f.calls,[['existing-control',{action:'fixture'}],['command','fixture',{source:'streamdeck'}]]);
});

test('mainboard control accepts only a boolean and forwards ON/OFF to the existing service without manual writes or settings changes',async()=>{
 const f=await fixture();for(const enabled of [undefined,'true',0,null])assert.equal((await f.request(routes[4],{data:{enabled}})).status,400);assert.deepEqual(f.calls,[]);
 const on=await f.request(routes[4],{data:{enabled:true,duty:100,curve:{fixture:true}}});assert.equal(on.status,200);assert.equal(on.value.enabled,true);assert.deepEqual(f.calls,[['fan-enable',true]]);
 const off=await f.request(routes[4],{data:{enabled:false}});assert.equal(off.status,200);assert.equal(off.value.enabled,false);assert.deepEqual(f.calls,[['fan-enable',true],['fan-enable',false]]);
});

test('a failed mainboard OFF remains an error instead of claiming hardware restoration',async()=>{
 const f=await fixture();f.runtime.fanControl.enable=async()=>{throw Error('Hardware return failed');};const response=await f.request(routes[4],{data:{enabled:false}});assert.equal(response.status,400);assert.equal(response.value.ok,false);assert.equal(response.value.message,'Hardware return failed');assert.deepEqual(f.calls,[]);
});
