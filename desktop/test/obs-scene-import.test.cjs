'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectCollection,applyCollection}=require('../src/dual-stream/obs-scene-import.cjs');
const {defaults,validate}=require('../src/dual-stream/config.cjs');
const source=(uuid,name,id,settings={})=>({uuid,name,id,settings});
const item=(uuid,name,{width=1920,height=1080,x=0,y=0,boundsWidth=width,boundsHeight=height,...rest}={})=>({source_uuid:uuid,name,visible:true,align:5,rot:0,scale:{x:1,y:1},scale_ref:{x:width,y:height},pos:{x,y},bounds_type:2,bounds:{x:boundsWidth,y:boundsHeight},...rest});
const scene=(uuid,name,items)=>source(uuid,name,'scene',{items});
const camera=source('camera','Webcam','dshow_input',{video_device_id:'Real webcam:device-id'});
const game=source('game','Spielaufnahme','game_capture',{window:'Game:WindowClass:game.exe'});
const collection=(sources)=>({name:'Fixture collection',resolution:{x:1920,y:1080},sources});
const present=()=>true;
function dualCollection(){return collection([camera,game,
 scene('landscape','Spiel',[item('game','Spielaufnahme'),item('camera','Webcam',{x:1440,y:648,boundsWidth:480,boundsHeight:432})]),
 scene('portrait','Spiel',[item('game','Spielaufnahme',{width:1080,height:1920,y:960,boundsWidth:1080,boundsHeight:960}),item('camera','Webcam',{width:1080,height:1920,boundsWidth:1080,boundsHeight:960})])]);}

test('duplicate scene names are mapped independently by UUID and actual canvas size',()=>{
 const data=dualCollection();data.sources.find(s=>s.uuid==='landscape').settings.canvas=[{width:1080,height:1920,scene:'Spiel'}];
 const preview=inspectCollection(data);assert.equal(preview.scenes.length,2);assert.equal(preview.suggestedMapping.tiktok.Spiel,'portrait');assert.equal(preview.suggestedMapping.twitch.Spiel,'landscape');
 const result=applyCollection(data);assert.deepEqual(result.config.layouts.tiktok.find(x=>x.source==='camera'),{source:'camera',x:0,y:0,width:1,height:.5,fit:'contain',visible:true});assert.equal(result.config.layouts.twitch.find(x=>x.source==='camera').x,.75);assert.equal(result.config.sources.camera.target,camera.settings.video_device_id);assert.equal(result.config.sources.camera.enabled,true);assert.equal(result.config.sources.game.enabled,true);
});

test('local scene backgrounds retain distinct vertical and horizontal paths',()=>{
 const data=collection([source('imgV','Portrait image','image_source',{file:'C:/media/portrait.png'}),source('vidH','Landscape video','ffmpeg_source',{local_file:'C:/media/landscape.mp4',looping:true}),scene('pV','Pause',[item('imgV','Portrait image',{width:1080,height:1920})]),scene('pH','Pause',[item('vidH','Landscape video')])]);
 const result=applyCollection(data,{fileExists:present});assert.equal(result.config.program.platformBackgrounds.tiktok.Pause,'C:/media/portrait.png');assert.equal(result.config.program.platformBackgrounds.twitch.Pause,'C:/media/landscape.mp4');assert.match(result.warnings.join('\n'),/Medienlautstärke/);assert.equal(result.config.obsRoot,'');
});

test('exact Ende is preferred over the Offline fallback',()=>{const data=collection([scene('end','Ende',[]),scene('offline','Offline',[])]);assert.equal(inspectCollection(data).suggestedMapping.twitch.Ende,'end');});

test('nested scenes resolve source UUID before ambiguous display names and compose positions',()=>{
 const data=collection([camera,source('other','Webcam','dshow_input',{video_device_id:'Other camera:id'}),scene('nested','Inside',[item('camera','Webcam')]),scene('outer','Spiel',[item('nested','Inside',{x:960,y:540,boundsWidth:960,boundsHeight:540})])]);
 const result=applyCollection(data,{mapping:{twitch:{Spiel:'outer'}},sources:{camera:'camera'}});const layout=result.config.layouts.twitch.find(x=>x.source==='camera');assert.equal(layout.x,.5);assert.equal(layout.y,.5);assert.equal(layout.width,.5);assert.equal(result.config.sources.camera.target,'Real webcam:device-id');
});

test('older name references work only for unique names',()=>{
 const data=collection([camera,scene('s','Spiel',[{...item('camera','Webcam'),source_uuid:undefined}])]);assert.equal(applyCollection(data).config.sources.camera.enabled,true);
 data.sources.push(source('duplicate','Webcam','dshow_input',{video_device_id:'Other:id'}));const result=applyCollection(data);assert.equal(result.config.sources.camera.enabled,false);assert.match(result.warnings.join('\n'),/mehrfach vorhanden/);
});

test('hidden sources and hidden nested scenes do not become active inputs',()=>{
 const data=collection([camera,scene('nested','Inside',[item('camera','Webcam')]),scene('outer','Spiel',[item('nested','Inside',{visible:false})])]);const result=applyCollection(data);assert.equal(result.config.sources.camera.enabled,false);
});

test('conflicting cameras preserve the configured device until explicitly selected',()=>{
 const another=source('second','Other camera','dshow_input',{video_device_id:'Second:id'}),data=collection([camera,another,scene('s','Spiel',[item('camera','Webcam'),item('second','Other camera')])]);
 let result=applyCollection(data);assert.equal(result.config.sources.camera.enabled,false);assert.match(result.warnings.join('\n'),/Mehrere Kameras/);
 const configured=defaults();configured.sources.camera={enabled:true,target:camera.settings.video_device_id,name:'Already selected'};
 result=applyCollection(data,{config:configured});assert.equal(result.config.sources.camera.target,camera.settings.video_device_id);
 result=applyCollection(data,{sources:{camera:'second'}});assert.equal(result.config.sources.camera.target,'Second:id');assert.equal(result.config.sources.camera.enabled,true);
});

test('explicit retain choice preserves existing source and warns for unavailable selected devices',()=>{
 const data=dualCollection(),config=defaults();config.sources.camera={enabled:true,target:'Existing:id',name:'Existing camera'};
 assert.equal(applyCollection(data,{config,sources:{camera:''}}).config.sources.camera.target,'Existing:id');
 const result=applyCollection(data,{config,sources:{camera:'camera'},devices:{camera:[{id:'Existing:id',name:'Existing camera'}]}});assert.equal(result.config.sources.camera.target,'Existing:id');assert.match(result.warnings.join('\n'),/aktuell nicht/);
});

test('missing references never fall back to a same-named different UUID',()=>{const data=collection([camera,scene('s','Spiel',[item('missing','Webcam')])]);const result=applyCollection(data);assert.equal(result.config.sources.camera.enabled,false);assert.match(result.warnings.join('\n'),/Quellen-ID fehlt/);});

test('unsupported and remote sources remain inert and secret URLs are not echoed',()=>{
 let reads=0;const data=collection([source('browser','Browser','browser_source',{url:'https://private.example.invalid/secret-token',local_file:'C:/scripts/evil.js'}),source('remote','Remote','ffmpeg_source',{local_file:'https://example.invalid/video.mp4'}),source('share','Share','image_source',{file:'\\\\server\\secret\\image.png'}),scene('s','Pause',[item('browser','Browser'),item('remote','Remote'),item('share','Share')])]);data.modules={script:'run evil()'};
 const result=applyCollection(data,{fileExists:()=>{reads++;return true;}});assert.equal(reads,0);assert.equal(result.config.program.platformBackgrounds.twitch.Pause,null);const serialized=JSON.stringify(result);assert(!serialized.includes('secret-token'));assert(!serialized.includes('evil'));assert.match(result.warnings.join('\n'),/browser_source/);
});

test('missing media produces an explicit empty background and no fake file import',()=>{const data=collection([source('m','Missing','image_source',{file:'C:/missing/pause.png'}),scene('s','Pause',[item('m','Missing')])]);const preview=inspectCollection(data,{fileExists:()=>false});assert.equal(preview.scenes[0].assets[0].exists,false);const result=applyCollection(data,{fileExists:()=>false});assert.equal(result.config.program.platformBackgrounds.twitch.Pause,null);assert.match(result.warnings.join('\n'),/Datei fehlt/);});

test('crop, rotation and overscan are disclosed without creating invalid coordinates',()=>{
 const data=collection([camera,scene('s','Spiel',[item('camera','Webcam',{x:-100,boundsWidth:2200,crop_left:20})])]);let result=applyCollection(data);assert.equal(result.config.layouts.twitch.find(x=>x.source==='camera').width,1);assert.match(result.warnings.join('\n'),/Zuschnitt/);assert.match(result.warnings.join('\n'),/Rand/);assert.doesNotThrow(()=>validate(result.config));
 data.sources[1].settings.items[0].rot=90;result=applyCollection(data);assert.deepEqual(result.config.layouts.twitch.find(x=>x.source==='camera'),defaults().layouts.twitch.find(x=>x.source==='camera'));assert.match(result.warnings.join('\n'),/Drehung/);
});

test('fully off-canvas capture stays hidden and groups cannot loop forever',()=>{const data=collection([camera,scene('s','Spiel',[item('camera','Webcam',{x:3000})])]);assert.equal(applyCollection(data).config.layouts.twitch.find(x=>x.source==='camera').visible,false);data.sources[1].settings.items.push(item('s','Spiel'));assert.match(inspectCollection(data).warnings.join('\n'),/Kreis/);});

test('preserves destinations, library, quality, live scene and unselected scene slots',()=>{
 const config=defaults();config.obsRoot='C:/programs/obs';config.profile='fullhd_1080p30';config.program.scene='Pause';config.program.backgrounds.Ende='C:/existing/end.png';config.destinations.twitch.server='rtmps://live.example.invalid/app';
 const before=structuredClone(config),result=applyCollection(dualCollection(),{config,mapping:{tiktok:{Spiel:'portrait'}}});assert.equal(result.config.obsRoot,config.obsRoot);assert.equal(result.config.profile,config.profile);assert.equal(result.config.program.scene,'Pause');assert.equal(result.config.program.backgrounds.Ende,'C:/existing/end.png');assert.deepEqual(result.config.destinations,config.destinations);assert.deepEqual(result.config.layouts.twitch,config.layouts.twitch);assert.deepEqual(config,before);
});

test('background removal survives roundtrip separately from automatic defaults',()=>{const config=defaults();config.program.backgrounds.Pause=null;config.program.platformBackgrounds={tiktok:{Start:null},twitch:{Start:'C:/start.mp4'}};const roundtrip=validate(JSON.parse(JSON.stringify(config)));assert.equal(roundtrip.program.backgrounds.Pause,null);assert.equal(roundtrip.program.backgrounds.Start,'');assert.equal(roundtrip.program.platformBackgrounds.tiktok.Start,null);assert.equal(roundtrip.program.platformBackgrounds.twitch.Start,'C:/start.mp4');assert.equal(roundtrip.program.platformBackgrounds.twitch.Pause,undefined);});

test('rejects malformed collection, mapping and source choice before changing config',()=>{const good=dualCollection();for(const data of [null,{},collection([]),collection([camera,camera,scene('s','Spiel',[])])])assert.throws(()=>inspectCollection(data));assert.throws(()=>applyCollection(good,{mapping:{twitch:{Spiel:'missing'}}}),/nicht in dieser/);assert.throws(()=>applyCollection(good,{mapping:{}}),/mindestens/);assert.throws(()=>applyCollection(good,{sources:{camera:'missing'}}),/gehört nicht/);assert.throws(()=>applyCollection(good,{sources:{camera:42}}),/Ungültige/);assert.throws(()=>inspectCollection(collection([scene('s','Spiel',new Array(10001).fill(null))])));});

test('own virtual camera cannot be selected as an OBS import input',()=>{const data=collection([source('loop','Batto TikTok','dshow_input',{video_device_id:'Batto:{27b05c2d-93dc-474a-a5da-9bba34cb2a9c}'}),scene('s','Spiel',[item('loop','Batto TikTok')])]);assert.equal(inspectCollection(data).sources.camera.length,0);assert.equal(applyCollection(data).config.sources.camera.enabled,false);});
