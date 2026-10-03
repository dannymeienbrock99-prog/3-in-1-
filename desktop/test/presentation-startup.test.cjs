'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('early window show/hide remembers suspension before app state exists without accessing S',()=>{
 let presentation;const classes=new Set(),context={window:{batto:{onDualState(){},onPresentationState(callback){presentation=callback;}}},document:{body:{classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}},addEventListener(){},querySelector(){throw Error('renderer must wait for app initialization');}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/resource-saving.js'),'utf8'),context);
 assert.equal('S'in context,false);assert.doesNotThrow(()=>presentation(true));assert.equal(context.window.BattoResources.suspended,true);assert(classes.has('presentation-paused'));
 assert.doesNotThrow(()=>presentation(false));assert.equal(context.window.BattoResources.suspended,false);assert(!classes.has('presentation-paused'));
});
