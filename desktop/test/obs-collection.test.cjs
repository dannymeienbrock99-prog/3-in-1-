'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {defaults,validate,sceneChoices,resolveScene}=require('../src/dual-stream/config.cjs');
const {applyCollection,inspectCollection}=require('../src/dual-stream/obs-scene-import.cjs');
const source=(uuid,name,id,settings={})=>({uuid,name,id,settings});
const item=(source_uuid,width=1920,height=1080,extra={})=>({source_uuid,visible:true,align:5,pos:{x:0,y:0},scale:{x:1,y:1},bounds_type:0,bounds:{x:0,y:0},scale_ref:{x:width,y:height},...extra});
const scene=(uuid,name,items,settings={})=>source(uuid,name,'scene',{items,...settings});
const collection=sources=>({name:'Synthetic collection',resolution:{x:1920,y:1080},sources});
function fixtures(){
 const capture=source('camera','Shared camera','dshow_input',{video_device_id:'Historical camera:old-device'}),video=source('video','Local video','ffmpeg_source',{local_file:'C:/media/background.mp4',looping:true}),picture=source('picture','Local picture','image_source',{file:'C:/media/overlay.png'});
 const names=['Start','Spiel','Scene 2','Pause','Chat','Ende','Offline','Setup'];
 const scenes=names.map((name,index)=>scene('land-'+index,name,[item('video'),item('camera',1920,1080,{pos:{x:-25,y:42}}),item('picture',1920,1080,{visible:false})],index===2?{}:{canvas:[{width:1080,height:1920,scene:name==='Chat'?'Chat portrait':name}]}));
 for(let i=0;i<names.length;i++)if(i!==2)scenes.push(scene('port-'+i,names[i]==='Chat'?'Chat portrait':names[i],[item('video',1080,1920),item('picture',1080,1920,{pos:{x:11,y:-780},bounds_type:2,bounds:{x:1080,y:1920}}),item('camera',1080,1920)]));
 return {...collection([capture,video,picture,...scenes]),scene_order:names.map(name=>({name}))};
}
test('all fifteen scenes and all ordered layers survive import, save and selection without shortcut mappings',()=>{
 const config=defaults();config.sources.camera={enabled:true,name:'Current working camera',target:'Current:device'};
 const result=applyCollection(fixtures(),{config,mapping:{},sources:{camera:'',game:''},fileExists:()=>true});
 const imported=result.config.obsCollection;assert.equal(imported.scenes.length,15);assert.equal(imported.sources.length,3);assert.equal(imported.scenes.reduce((sum,s)=>sum+s.items.length,0),45);assert.equal(result.config.sources.camera.target,'Current:device');assert.deepEqual(imported.aliases,{tiktok:{},twitch:{}});
 assert.deepEqual(imported.scenes.find(s=>s.id==='port-4').items.map(i=>i.source),['video','picture','camera']);assert.equal(imported.scenes.find(s=>s.id==='land-4').partnerId,'port-4');assert.equal(imported.scenes.find(s=>s.id==='port-4').partnerId,'land-4');assert.equal(imported.scenes.find(s=>s.id==='land-4').items[2].visible,false);
 result.config.program.scene='obs:port-4';const saved=validate(JSON.parse(JSON.stringify(result.config)));assert.deepEqual(saved.obsCollection,imported);assert.equal(saved.program.scene,'obs:port-4');assert.equal(sceneChoices(saved).length,19);assert.match(result.summary,/15 OBS-Szenen/);
});
test('raw bounds, rotation, crop, negative position and natural-size scale survive exactly',()=>{
 const raw=item('image',1080,1920,{pos:{x:-3807,y:-548},scale:{x:-3.13,y:1.09},rot:17.5,crop_left:30,crop_bottom:7,bounds_align:6,bounds_crop:true});
 const result=applyCollection(collection([source('image','Image','image_source',{file:'C:/media/image.png'}),scene('portrait','Custom',[raw])]),{mapping:{},fileExists:()=>true});
 const saved=result.config.obsCollection.scenes[0].items[0];for(const field of ['pos','scale','rot','crop_left','crop_bottom','bounds_align','bounds_crop','bounds','bounds_type','scale_ref'])assert.deepEqual(saved[field],raw[field]);
 assert(!result.warnings.some(w=>/Originalgröße|Zuschnitt|Drehung/.test(w)));
});
test('source settings are a strict whitelist and remote inputs never become executable sources',()=>{
 const data=collection([source('web','Browser','browser_source',{url:'https://private.invalid/secret-widget',javascript:'private-script'}),source('remote','Remote','ffmpeg_source',{input:'https://private.invalid/secret-stream',local_file:'https://private.invalid/video.mp4',ffmpeg_options:'private-options'}),source('text','Text','text_gdiplus',{text:'A local caption',read_from_file:true,file:'C:/private.txt',font:{face:'Arial',size:36,flags:1,untrusted:'private-font'},color:0xffffff,script:'private-code'}),scene('custom','Custom',[item('web'),item('remote'),item('text')])]);
 const result=applyCollection(data,{mapping:{},fileExists:()=>{throw Error('Must not read remote files');}}),serialized=JSON.stringify(result.config);
 assert(!serialized.includes('private-'));assert(!serialized.includes('https:'));assert.equal(result.config.obsCollection.sources.find(s=>s.id==='web').type,'unsupported');assert.equal(result.config.obsCollection.sources.find(s=>s.id==='remote').type,'unsupported');const text=result.config.obsCollection.sources.find(s=>s.id==='text');assert.equal(text.settings.text,'A local caption');assert.equal(text.settings.read_from_file,false);assert.deepEqual(text.settings.font,{face:'Arial',size:36,flags:1});
});
test('distinct OBS windows and games retain their own targets and only the matching selected game is shared',()=>{
 const data=collection([source('camera','Camera','dshow_input',{video_device_id:'Old camera:id'}),source('chat','Chat window','window_capture',{window:'Chat:Class:chat.exe',method:2,capture_cursor:false}),source('game','Specific game','game_capture',{window:'Game:Class:game.exe',capture_mode:'window'}),source('screen','Display','monitor_capture',{monitor:1,monitor_id:'Display-2'}),scene('play','Spiel',[item('screen'),item('chat'),item('game'),item('camera')])]);
 const config=defaults();config.sources.game={enabled:true,kind:'game',name:'Current game',target:'Game:Class:game.exe'};
 const c=applyCollection(data,{config,sources:{camera:'',game:''}}).config,saved=c.obsCollection.sources;
 assert.equal(saved.find(s=>s.id==='camera').shared,'camera');assert.equal(saved.find(s=>s.id==='game').shared,'game');assert.equal(saved.find(s=>s.id==='chat').shared,undefined);assert.equal(saved.find(s=>s.id==='screen').shared,undefined);assert.deepEqual(saved.find(s=>s.id==='chat').settings,{window:'Chat:Class:chat.exe',method:2,capture_cursor:false});assert.equal(saved.find(s=>s.id==='screen').settings.monitor_id,'Display-2');assert.equal(saved.find(s=>s.id==='game').settings.capture_mode,'window');
});
test('legacy shortcut aliases preserve both aspect ratios while every custom scene remains selectable',()=>{
 const result=applyCollection(fixtures(),{fileExists:()=>true}),c=result.config;assert.equal(c.obsCollection.aliases.tiktok.Spiel,'port-1');assert.equal(c.obsCollection.aliases.twitch.Spiel,'land-1');assert.equal(resolveScene(c,'Spiel'),'Spiel');assert.equal(resolveScene(c,'Offline · TikTok'),'obs:port-6');assert.equal(resolveScene(c,'Chat portrait'),'obs:port-4');assert.throws(()=>resolveScene(c,'Offline'),/mehrfach/);assert.throws(()=>resolveScene(c,'Missing'),/nicht vorhanden/);assert.equal(resolveScene(c,'obs:land-7'),'obs:land-7');assert.equal(sceneChoices(undefined).length,4);
 const preview=inspectCollection(fixtures(),{fileExists:()=>true});assert.equal(preview.scenes.find(s=>s.id==='port-4').label,'Chat portrait · TikTok');
});
test('nested scenes and internal groups retain references without exposing groups as scene buttons',()=>{
 const data=collection([source('image','Image','image_source',{file:'C:/media/image.png'}),scene('inside','Inside',[item('image')]),scene('outside','Outside',[item('group',1920,1080,{pos:{x:100,y:50}})])]);data.groups=[source('group','Group','group',{custom_size:true,cx:500,cy:400,items:[item('inside')]})];
 const c=applyCollection(data,{mapping:{},fileExists:()=>true}).config;assert.equal(c.obsCollection.scenes.find(s=>s.id==='group').internal,true);assert.equal(c.obsCollection.scenes.find(s=>s.id==='outside').items[0].source,'group');assert.equal(sceneChoices(c).length,6);assert.throws(()=>resolveScene(c,'obs:group'));
 const cycle=structuredClone(data);cycle.groups[0].settings.items.push(item('outside'));const fixed=applyCollection(cycle,{mapping:{},fileExists:()=>true});assert.match(fixed.warnings.join('\n'),/Kreis/);assert.doesNotThrow(()=>validate(fixed.config));
});
test('loading rejects invalid graph references, cycles, aliases and transform numbers',()=>{
 const valid=applyCollection(fixtures(),{fileExists:()=>true}).config;
 for(const change of [c=>c.obsCollection.scenes[0].items[0].source='missing',c=>c.obsCollection.scenes[0].items.push({source:c.obsCollection.scenes[0].id}),c=>c.obsCollection.aliases.tiktok.Spiel='missing',c=>c.obsCollection.scenes[0].items[0].pos.x=NaN,c=>c.obsCollection.scenes[0].items[0].scale={x:Infinity,y:1},c=>c.obsCollection.sources.push({...c.obsCollection.sources[0]}),c=>c.program.scene='obs:missing']){const c=structuredClone(valid);change(c);assert.throws(()=>validate(c));}
 const extra=structuredClone(valid);extra.obsCollection.sources[0].settings.url='https://private.invalid/secret';extra.obsCollection.sources[0].settings.extra={secret:'private'};extra.obsCollection.scenes[0].items[0].script='private';const safe=validate(extra);assert(!JSON.stringify(safe).includes('private'));
});
test('collection limits fail during import before the native renderer is started',()=>{
 assert.throws(()=>applyCollection(collection(Array.from({length:257},(_,i)=>scene('s'+i,'Scene '+i,[]))),{mapping:{}}),/höchstens 256 Szenen/);
 const sources=Array.from({length:1025},(_,i)=>source('image'+i,'Image '+i,'image_source',{file:'C:/media/image.png'}));
 assert.throws(()=>applyCollection(collection([...sources,scene('s','Scene',[])]),{mapping:{},fileExists:()=>true}),/1024 Quellen/);
});
