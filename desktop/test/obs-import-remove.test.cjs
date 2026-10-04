'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {defaults,validate}=require('../src/dual-stream/config.cjs');
const {removeObsImport,sceneChoices}=require('../src/dual-stream/obs-collection.cjs');
const item=source=>({source}),scene=(id,platform,items,extra={})=>({id,name:id,label:id,platform,width:platform==='tiktok'?1080:1920,height:platform==='tiktok'?1920:1080,items:items.map(item),...extra});
function fixture(){
 const c=defaults();c.program.scene='obs:portrait';c.program.platformBackgrounds={tiktok:{Start:'C:/media/shared.mp4'},twitch:{Start:'C:/media/shared.mp4',Pause:'C:/media/independent.png'}};
 c.obsCollection={version:1,name:'Synthetic import',sources:[{id:'shared',name:'Shared',type:'ffmpeg_source',settings:{local_file:'C:/media/shared.mp4'}},{id:'portrait-only',name:'Portrait-only',type:'image_source',settings:{file:'C:/media/portrait.png'}},{id:'unused',name:'Unused',type:'image_source',settings:{file:'C:/media/unused.png'}}],scenes:[scene('wide','twitch',['shared'],{partnerId:'portrait'}),scene('portrait','tiktok',['shared','group'],{partnerId:'wide'}),scene('group','tiktok',['portrait-only'],{internal:true})],aliases:{tiktok:{Start:'portrait'},twitch:{Start:'wide'}},warnings:['Portrait-only: Datei fehlt.','Shared: Datei fehlt.']};
 c.transitions=[{id:'obs-transition:one',name:'Stinger',type:'stinger',settings:{path:'C:/media/stinger.mp4'}}];c.program.transition='obs-transition:one';return validate(c);
}
test('removing one scene keeps referenced shared media, repairs partner/alias references and drops its orphan group',()=>{
 const original=fixture(),copy=structuredClone(original),c=validate(removeObsImport(original,{kind:'scene',id:'obs:portrait'}));
 assert.deepEqual(original,copy);assert.deepEqual(c.obsCollection.scenes.map(s=>s.id),['wide']);assert.deepEqual(c.obsCollection.sources.map(s=>s.id),['shared']);assert.equal(c.obsCollection.scenes[0].partnerId,'');assert.deepEqual(c.obsCollection.aliases,{tiktok:{},twitch:{Start:'wide'}});assert.equal(c.program.scene,'Spiel');assert.equal(c.program.platformBackgrounds.tiktok.Start,null);assert.equal(c.program.platformBackgrounds.twitch.Start,'C:/media/shared.mp4');assert.equal(c.program.platformBackgrounds.twitch.Pause,'C:/media/independent.png');assert.deepEqual(c.obsCollection.warnings,['Shared: Datei fehlt.']);assert.equal(sceneChoices(c).length,5);assert.equal(c.transitions.length,1);
});
test('removing an imported media source removes every scene reference and matching fallback background only',()=>{
 const original=fixture();original.program.backgrounds.Pause='C:\\MEDIA\\shared.mp4';const c=validate(removeObsImport(original,{kind:'source',id:'shared'}));
 assert(!c.obsCollection.sources.some(s=>s.id==='shared'));assert(c.obsCollection.scenes.every(s=>s.items.every(i=>i.source!=='shared')));assert.equal(c.obsCollection.scenes.length,3);assert.equal(c.program.scene,'obs:portrait');assert.equal(c.program.platformBackgrounds.tiktok.Start,null);assert.equal(c.program.platformBackgrounds.twitch.Start,null);assert.equal(c.program.backgrounds.Pause,null);assert.equal(c.program.platformBackgrounds.twitch.Pause,'C:/media/independent.png');assert(!c.obsCollection.warnings.includes('Shared: Datei fehlt.'));
});
test('removing the last public scene removes its import even when nested groups existed',()=>{
 let c=removeObsImport(fixture(),{kind:'scene',id:'obs:wide'});c=validate(removeObsImport(c,{kind:'scene',id:'obs:portrait'}));assert.equal(c.obsCollection,undefined);assert.equal(c.program.scene,'Spiel');assert.equal(c.transitions.length,1);assert.equal(sceneChoices(c).length,4);
});
test('removing a nested public scene detaches incoming scene references without removing its parent',()=>{
 const c=fixture();c.obsCollection.scenes[0].items.push(item('portrait'));const result=validate(removeObsImport(c,{kind:'scene',id:'obs:portrait'}));assert.deepEqual(result.obsCollection.scenes[0].items.map(i=>i.source),['shared']);
});
test('remove all resets the current scene and video transition while retaining independent choices and files as data',()=>{
 const original=fixture(),c=validate(removeObsImport(original,{kind:'all'}));assert.equal(c.obsCollection,undefined);assert.deepEqual(c.transitions,[]);assert.equal(c.program.scene,'Spiel');assert.equal(c.program.transition,'fade');assert.equal(c.program.platformBackgrounds.twitch.Start,null);assert.equal(c.program.platformBackgrounds.twitch.Pause,'C:/media/independent.png');assert.deepEqual(c.sources,original.sources);assert.deepEqual(c.layouts,original.layouts);assert.equal(original.obsCollection.sources[0].settings.local_file,'C:/media/shared.mp4');assert.equal(validate(removeObsImport(c,{kind:'all'})).program.scene,'Spiel');
});
test('removing a video transition keeps the collection and resets only an active removed transition',()=>{
 const c=fixture(),result=validate(removeObsImport(c,{kind:'transition',id:'obs-transition:one'}));assert.deepEqual(result.obsCollection,c.obsCollection);assert.deepEqual(result.transitions,[]);assert.equal(result.program.transition,'fade');c.program.transition='cut';assert.equal(validate(removeObsImport(c,{kind:'transition',id:'obs-transition:one'})).program.transition,'cut');
});
test('removing all imports preserves the independent built-in scene and cut choice',()=>{
 const c=fixture();c.program.scene='Pause';c.program.transition='cut';const result=validate(removeObsImport(c,{kind:'all'}));assert.equal(result.program.scene,'Pause');assert.equal(result.program.transition,'cut');
});
test('stale selections and file paths are rejected instead of being treated as import identifiers',()=>{
 const c=fixture();for(const request of [null,{kind:'file',id:'C:/media/shared.mp4'},{kind:'scene',id:'C:/media/shared.mp4'},{kind:'scene',id:'obs:group'},{kind:'source',id:'missing'},{kind:'transition',id:'fade'}])assert.throws(()=>removeObsImport(c,request));assert.throws(()=>removeObsImport(defaults(),{kind:'source',id:'shared'}),/nicht mehr vorhanden/);
});
