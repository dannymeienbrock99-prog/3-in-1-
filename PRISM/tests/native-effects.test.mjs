import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNativeEffect, validateNativeEffect } from '../server/native-effects.mjs';
const device = (id, extra={}) => ({id,name:`FURY Slot ${id}`,vendor:'Kingston',provider:'kingston',nativeEffects:[{id:'static_color',name:'Statisch',colorsMax:1}],...extra});
test('native selection is fully validated before stopping or writing any RGB',async()=>{
  let stopped=0,writes=0;
  const client={connected:true,devices:[device(40000)],applyNativeEffect:()=>{writes++}};
  const engine={stop:()=>{stopped++}};
  for(const input of [{deviceIds:[]},{deviceIds:[40000,40001],effectId:'static_color'}, {deviceIds:[40000],effectId:'unknown'}, {deviceIds:[40000],effectId:'static_color',colors:['#ff0000','#00ff00']}, {deviceIds:[40000],effectId:'static_color',zoneIds:{}}, {deviceIds:[40000],effectId:'static_color',colors:['#ff0000'],brightness:-1}]) await assert.rejects(applyNativeEffect(client,engine,input));
  assert.equal(stopped,0);assert.equal(writes,0);
});
test('native effect stops only selected software targets, waits for pending frames and requires ack',async()=>{
  const events=[], devices=[device(40000),device(40002)];
  const client={connected:true,devices,async applyNativeEffect(target,id,options){events.push(['write',target.id,id,options]);}};
  const engine={stop:ids=>events.push(['stop',ids]),framePromise:Promise.resolve().then(()=>events.push(['frame-done']))};
  const result=await applyNativeEffect(client,engine,{deviceIds:[40002],effectId:'static_color',colors:['#FF0000']});
  assert.deepEqual(result.applied,[40002]); assert.equal(result.streamed,false);
  assert(events.findIndex(x=>x[0]==='frame-done')<events.findIndex(x=>x[0]==='write'));
  assert.deepEqual(events.find(x=>x[0]==='stop'),['stop',[40002]]);
  assert.equal(devices[0].activeNativeEffect,undefined);assert.equal(devices[1].activeNativeEffect.colors[0],'#ff0000');
});
test('native partial failure reports acknowledged devices, with no success on failed target',async()=>{
  const devices=[device(40000),device(40001)];
  const client={connected:true,devices,async applyNativeEffect(target){if(target.id===40001)throw Error('Keine Dienstbestätigung');}};
  await assert.rejects(applyNativeEffect(client,{stop(){}},{deviceIds:[40000,40001],effectId:'static_color',colors:['#ffffff']}),error=>error.appliedDeviceIds[0]===40000);
  assert(devices[0].activeNativeEffect);assert.equal(devices[1].activeNativeEffect,undefined);
});
test('protected devices and unsupported native modes never become targets',()=>{
  const client={devices:[device(1,{vendor:'Elgato',name:'Stream Deck'}),device(2,{nativeEffects:[{id:'static_color',supported:false}]})]};
  for(const id of [1,2])assert.throws(()=>validateNativeEffect(client,{deviceIds:[id],effectId:'static_color',colors:['#ffffff']}));
});
