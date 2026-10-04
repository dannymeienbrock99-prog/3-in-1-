'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FanClient}=require('../src/services/suite-runtime.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const catalog=id=>({curves:[{id}],state:{selectedCurveId:id,generatedUtc:new Date().toISOString()}});
test('saving while a previous poll is pending refreshes the saved curve before returning',async()=>{
 const client=new FanClient({root:'.',data:'.'}),old=deferred();let reads=0;
 client.request=async(route)=>route==='/api/catalog'?(++reads===1?old.promise:catalog('new')):{ok:true,curveId:'new'};
 const pending=client.poll();const saving=client.configure('curve',{});await Promise.resolve();old.resolve(catalog('old'));
 await pending;const result=await saving;assert.equal(result.curveId,'new');assert.equal(client.catalog.state.selectedCurveId,'new');assert.equal(reads,2);
});
test('concurrent periodic polls share a request and a failed read can recover',async()=>{
 const client=new FanClient({root:'.',data:'.'}),read=deferred();let count=0;
 client.request=async()=>{count++;return read.promise;};const a=client.poll(),b=client.poll();assert.equal(count,1);read.resolve(catalog('same'));await Promise.all([a,b]);
 client.request=async()=>{throw Error('temporary failure');};await client.poll();assert.equal(client.snapshot,null);assert.match(client.error,/temporary/);
 client.request=async()=>catalog('recovered');await client.poll();assert.equal(client.snapshot.selectedCurveId,'recovered');assert.equal(client.error,'');
});
test('save success still returns its ID when the subsequent catalog refresh is unavailable',async()=>{
 const client=new FanClient({root:'.',data:'.'});client.request=async route=>{if(route==='/api/catalog')throw Error('offline');return {ok:true,curveId:'saved'};};
 const result=await client.configure('curve',{});assert.equal(result.curveId,'saved');assert.equal(client.snapshot,null);assert.equal(client.error,'offline');
});
