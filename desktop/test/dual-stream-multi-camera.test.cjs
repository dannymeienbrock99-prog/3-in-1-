'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {defaults,validate,cameraIds,visualIds}=require('../src/dual-stream/config.cjs');
const {DualStream}=require('../src/dual-stream/service.cjs');
const {applyCollection}=require('../src/dual-stream/obs-scene-import.cjs');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-three-cameras-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return new DualStream({directory,executable:'not-present',safeStorage:{}});}

test('legacy saved layouts upgrade without changing the original two layers or starting extra devices',()=>{
 const old=defaults();delete old.sources.camera2;delete old.sources.camera3;
 for(const p of ['tiktok','twitch'])old.layouts[p]=old.layouts[p].filter(x=>['game','camera'].includes(x.source));
 old.sources.camera={enabled:true,target:'existing:camera',name:'Existing camera'};old.layouts.twitch[1].x=.4;old.layouts.twitch[1].width=.3;
 const before=structuredClone(old),next=validate(old);assert.deepEqual(old,before);assert.deepEqual(next.sources.camera,old.sources.camera);
 for(const p of ['tiktok','twitch']){assert.deepEqual(next.layouts[p].slice(0,2),old.layouts[p]);assert.deepEqual(next.layouts[p].map(x=>x.source),visualIds);}
 for(const id of ['camera2','camera3'])assert.deepEqual(next.sources[id],{enabled:false,target:'',name:''});
 assert.deepEqual(validate(next),next);
});

test('three selected cameras and their independent canvas positions persist across restart',async t=>{
 const dual=fixture(t),next=defaults();for(const [index,id]of cameraIds.entries())next.sources[id]={enabled:true,target:'camera:'+index,name:'Camera '+(index+1)};
 next.layouts.tiktok.find(x=>x.source==='camera2').x=.4;next.layouts.twitch.find(x=>x.source==='camera3').visible=false;
 await dual.save(next);const restored=new DualStream({directory:dual.directory,executable:'not-present',safeStorage:{}});
 assert.equal(dual.native,null);assert.equal(restored.native,null);assert.deepEqual(restored.config,validate(next));assert.equal(restored.error,'');
});

test('duplicate enabled camera devices and malformed additional source/layout data are rejected',()=>{
 const next=defaults();next.sources.camera={enabled:true,target:'Device:ABC',name:''};next.sources.camera2={enabled:true,target:'device:abc',name:''};assert.throws(()=>validate(next),/nur einmal/);
 next.sources.camera2.enabled=false;assert.doesNotThrow(()=>validate(next));
 for(const mutate of [c=>c.sources.camera2=null,c=>c.sources.camera3.enabled='yes',c=>{c.sources.camera2.enabled=true;c.sources.camera2.target='   ';},c=>c.layouts.twitch[2].source='camera4',c=>c.layouts.tiktok[2].source='camera',c=>c.layouts.tiktok[3].width=2]){const bad=defaults();mutate(bad);assert.throws(()=>validate(bad));}
});

test('invalid camera requests are rejected before launching the video service',async t=>{
 const dual=fixture(t);let starts=0;dual.client=async()=>{starts++;throw Error('Must not launch');};
 for(const id of cameraIds){dual.config=defaults();dual.config.sources[id]={enabled:true,target:'Batto:{27b05c2d-93dc-474a-a5da-9bba34cb2a9c}',name:''};await assert.rejects(dual.prepare(),/echte Kamera/);}
 dual.config=defaults();dual.config.sources.camera2={enabled:true,target:'Same',name:''};dual.config.sources.camera3={enabled:true,target:'same',name:''};await assert.rejects(dual.prepare(),/nur einmal/);assert.equal(starts,0);
});

test('additional source controls toggle only their own prepared camera and never configure a disabled slot',async t=>{
 const dual=fixture(t),calls=[];dual.config.sources.camera2={enabled:true,target:'Second',name:''};dual.state={prepared:true,outputs:{}};dual.sourceState={camera:true,camera2:true,camera3:false};
 dual.native={request:async(command,args)=>{calls.push({command,args});return {prepared:true,outputs:{}};}};
 await dual.source('camera2',false);assert.deepEqual(calls,[{command:'source',args:{source:'camera2',enabled:false}}]);assert.equal(dual.sourceState.camera,true);assert.equal(dual.sourceState.camera2,false);
 await dual.source('camera2',true);await assert.rejects(dual.source('camera3',true),/nicht eingeschaltet/);assert.equal(calls.length,2);
});

test('OBS import keeps extra camera device/layout choices and does not duplicate a device into primary',()=>{
 const config=defaults();config.sources.camera2={enabled:true,target:'Second:id',name:'Existing second'};config.layouts.twitch.find(x=>x.source==='camera2').x=.6;
 const data={name:'Synthetic camera collection',sources:[{uuid:'cam',name:'Second camera',id:'dshow_input',settings:{video_device_id:'Second:id'}},{uuid:'scene',name:'Spiel',id:'scene',settings:{items:[{source_uuid:'cam',name:'Second camera',visible:true,pos:{x:0,y:0},scale:{x:1,y:1}}]}}],scene_order:[{name:'Spiel'}]};
 const result=applyCollection(data,{config,sources:{camera:'cam'}});assert.deepEqual(result.config.sources.camera2,config.sources.camera2);assert.equal(result.config.sources.camera.enabled,false);assert.deepEqual(result.config.layouts.twitch.find(x=>x.source==='camera2'),config.layouts.twitch.find(x=>x.source==='camera2'));assert(result.warnings.some(x=>x.includes('bereits Kamera 2')));
 const raw=result.config.obsCollection.sources.find(x=>x.type==='dshow_input');assert.equal(raw.settings.video_device_id,'Second:id');raw.shared='camera2';assert.equal(validate(result.config).obsCollection.sources.find(x=>x.type==='dshow_input').shared,'camera2');
});
