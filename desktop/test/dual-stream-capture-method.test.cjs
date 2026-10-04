'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {defaults,validate,importProject}=require('../src/dual-stream/config.cjs');
const {DualStream}=require('../src/dual-stream/service.cjs');
const {applyCollection}=require('../src/dual-stream/obs-scene-import.cjs');

test('older projects keep automatic screen capture and unrelated source settings',()=>{
 const c=defaults();delete c.sources.game.captureMethod;c.sources.game.kind='screen';c.sources.game.target='fixture-display';c.sources.camera={enabled:true,target:'fixture-camera',name:'Camera'};c.program.scene='Pause';
 const normalized=validate(c);assert.equal(normalized.sources.game.captureMethod,'auto');assert.deepEqual(normalized.sources.camera,c.sources.camera);assert.deepEqual(normalized.layouts,c.layouts);assert.equal(importProject(c).sources.game.captureMethod,'auto');
});
test('only known capture methods can be saved or imported',()=>{
 const c=defaults();for(const method of ['auto','dxgi','wgc']){c.sources.game.captureMethod=method;assert.equal(validate(c).sources.game.captureMethod,method);assert.equal(importProject(JSON.parse(JSON.stringify(c))).sources.game.captureMethod,method);}
 for(const method of ['',null,1,{},'WGC','other']){c.sources.game.captureMethod=method;assert.throws(()=>validate(c),/Aufnahmeverfahren/);}
});
test('OBS source selection retains the chosen shared screen capture method',()=>{
 const config=defaults();config.sources.game.captureMethod='wgc';const data={name:'Screen fixture',resolution:{x:1920,y:1080},sources:[{uuid:'display',name:'Primary',id:'monitor_capture',settings:{monitor_id:'fixture-display'}},{uuid:'scene',name:'Spiel',id:'scene',settings:{items:[{source_uuid:'display',visible:true,pos:{x:0,y:0},scale:{x:1,y:1},bounds_type:2,bounds:{x:1920,y:1080}}]}}]};
 const imported=applyCollection(data,{config,sources:{game:'display',camera:''}}).config;assert.equal(imported.sources.game.captureMethod,'wgc');assert.equal(imported.sources.game.kind,'screen');assert.equal(imported.sources.game.target,'fixture-display');assert(imported.obsCollection.sources.some(s=>s.id==='display'&&s.shared==='game'));
});
test('Windows capture method survives disk save, reload and native preparation without starting an output',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-capture-method-'));const service=new DualStream({directory:dir,executable:'fixture-unused',safeStorage:{}}),c=defaults();c.sources.game={enabled:true,kind:'screen',target:'fixture-display',name:'Main screen',captureMethod:'wgc'};
 try{await service.save(c);const reload=new DualStream({directory:dir,executable:'fixture-unused',safeStorage:{}}),requests=[];reload.client=async()=>({request:async(command,value)=>{requests.push({command,value});return {prepared:true,outputs:{}};}});reload.idle=()=>{};await reload.prepare();assert.equal(reload.config.sources.game.captureMethod,'wgc');assert.equal(requests[0].command,'prepare');assert.equal(requests[0].value.config.sources.game.captureMethod,'wgc');assert.deepEqual(requests[0].value.config.layouts,c.layouts);assert.equal(reload.running(),false);assert(!requests.some(r=>r.command==='camera-start'||r.command==='start'));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
