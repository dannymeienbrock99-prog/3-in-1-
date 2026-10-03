'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {YouTubeAdapter}=require('../src/adapters/youtube.cjs');
const flush=()=>new Promise(r=>setImmediate(r));
test('stop aborts fetch; late body cannot emit chat, restore connected state or schedule polling',async t=>{
 let finishBody,signal;const messages=[];
 t.mock.method(global,'fetch',async(_url,options)=>{signal=options.signal;return{ok:true,json:()=>new Promise(r=>{finishBody=r;})};});
 const a=new YouTubeAdapter({liveChatId:'fixture',apiKey:'fixture',onMessage:m=>messages.push(m)});
 const start=a.connect();const rejected=assert.rejects(start,/beendet/);await flush();a.disconnect();assert.equal(signal.aborted,true);
 finishBody({items:[{id:'late',snippet:{displayMessage:'must not appear'},authorDetails:{displayName:'fixture'}}]});await rejected;
 assert.equal(messages.length,0);assert.equal(a.getStatus().state,'stopped');assert.equal(a.timer,null);assert.equal(a.requestController,null);
});
test('old response after reconnect cannot replace new chat state or its timer',async t=>{
 let oldBody;let calls=0;
 t.mock.method(global,'fetch',async()=>({ok:true,json:()=>++calls===1?new Promise(r=>{oldBody=r;}):Promise.resolve({items:[],nextPageToken:'new-page'})}));
 const a=new YouTubeAdapter({liveChatId:'fixture',apiKey:'fixture'});t.after(()=>a.disconnect());
 const first=a.connect(),rejected=assert.rejects(first,/beendet/);await flush();a.disconnect();assert.equal((await a.connect()).ok,true);
 const timer=a.timer;oldBody({items:[],nextPageToken:'old-page'});await rejected;
 assert.equal(a.pageToken,'new-page');assert.equal(a.timer,timer);assert.equal(a.getStatus().connected,true);
});
