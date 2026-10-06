'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture({error:serviceError,startPromise}={}){
 const url='http://127.0.0.1:51234/?embedded=1',listeners={},assignments=[],fetches=[];let stopped=false;
 const element=()=>({hidden:true,disabled:false,textContent:'',addEventListener(name,fn){this[name]=fn;}}),frame=element();let source='';
 Object.defineProperty(frame,'src',{get:()=>source,set:value=>{source=value;assignments.push(value);}});frame.removeAttribute=()=>{source='';};frame.contentWindow={postMessage(){}};
 const error=element(),start=element(),stop=element(),panel={querySelector:key=>({'#rgb-frame':frame,'#rgb-error':error,'#rgb-start':start,'#rgb-stop':stop}[key])};
 const document={getElementById:key=>({mainNav:{},'view-rgb':panel}[key]),querySelector:()=>({parentElement:{}}),addEventListener:(name,fn)=>listeners[name]=fn};
 const context={URL,document,fetch:async value=>{fetches.push(value);throw Error('The file-origin renderer must not probe HTTP.');},window:{batto:{suite:async command=>{if(command==='rgb-stop'){stopped=true;return{stopped:true};}if(command==='rgb-start'){if(serviceError)throw Error(serviceError);if(startPromise)await startPromise;return{running:true,url,revision:0};}return{running:!stopped,url,revision:0};},onSuiteState(){}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/rgb-ui.js'),'utf8'),context);
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 return{listeners,assignments,fetches,error,frame,start,stop,settle};
}
test('returning to RGB retains its iframe, and explicit reload navigates even at the same URL',async()=>{
 const f=fixture();f.listeners['batto:view']({detail:'rgb'});await f.settle();assert.equal(f.assignments.length,1);assert.equal(f.frame.hidden,false);
 f.listeners['batto:view']({detail:'rgb'});await f.settle();assert.equal(f.assignments.length,1);
 f.start.click();await f.settle();assert.equal(f.assignments.length,2);assert.equal(f.assignments[0],f.assignments[1]);assert.equal(f.fetches.length,0);
});
test('missing compiled RGB UI displays the server reason instead of a blank iframe',async()=>{
 const f=fixture({error:'Die Oberfläche ist noch nicht gebaut.'});f.start.click();await f.settle();assert.equal(f.assignments.length,0);assert.equal(f.frame.hidden,true);assert.equal(f.error.textContent,'Die Oberfläche ist noch nicht gebaut.');assert.equal(f.start.disabled,false);assert.equal(f.fetches.length,0);
});

test('a late UI-ready reply cannot reopen the iframe after the user stops its service',async()=>{
 let release;const startPromise=new Promise(resolve=>release=resolve),f=fixture({startPromise});
 f.start.click();f.stop.click();await f.settle();release();await f.settle();
 assert.equal(f.assignments.length,0);assert.equal(f.frame.hidden,true);assert.equal(f.start.disabled,false);
});
