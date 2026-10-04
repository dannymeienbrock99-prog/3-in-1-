'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {curveForExport,curveTable,icueExecutable}=require('../src/services/fan-curves.cjs');
const curve=()=>({id:'current',name:'Meine Kurve',sensorLabel:'CPU',points:[{temperature:70,duty:90},{temperature:30.5,duty:25}]});
test('export and copy use the visible edited draft without saving or changing the source',()=>{
 const original=curve(),copy=structuredClone(original);const result=curveForExport({curve:original});assert.deepEqual(original,copy);assert.equal(result.points[0].temperature,30.5);assert.equal(result.isCustom,true);
 assert.match(curveTable(result),/30,5\t25\r\n70\t90/);assert.equal(curveForExport('current',[original]).name,'Meine Kurve');
});
test('invalid, empty and duplicate points cannot be exported as a valid iCUE table',()=>{
 for(const points of [[],[{temperature:1,duty:5}],[{temperature:30,duty:40},{temperature:30,duty:90}],[{temperature:null,duty:0},{temperature:60,duty:100}],[{temperature:1,duty:101},{temperature:60,duty:100}],[{temperature:-1,duty:0},{temperature:60,duty:100}]])assert.throws(()=>curveForExport({curve:{...curve(),points}}));
 for(const patch of [{name:''},{name:'x'.repeat(101)},{sensorLabel:null},{sensorLabel:'x'.repeat(201)}])assert.throws(()=>curveForExport({curve:{...curve(),...patch}}));
 assert.throws(()=>curveForExport('missing',[]));
});
test('iCUE handoff opens only a known application path and explains missing installation',()=>{
 const root=path.resolve('fixture-programs'),expected=path.join(root,'Corsair','Corsair iCUE5 Software','iCUE.exe');
 assert.equal(icueExecutable({env:{ProgramFiles:root},exists:file=>file===expected}),expected);
 assert.throws(()=>icueExecutable({env:{},exists:()=>false}),/Startmenü/);
});
