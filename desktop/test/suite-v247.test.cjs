'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chatForJarvis,obsForJarvis}=require('../src/services/suite-host.cjs');
const {allowedChat,DEFAULTS}=require('../src/services/jarvis-core.cjs');
test('2.4.7 moderator metadata reaches the Jarvis moderator-only filter',()=>{
 const message={platform:'twitch',message:'Hallo Sir Crazy',userId:'123',badges:[]};
 assert(!allowedChat(chatForJarvis({...message,moderator:false}),DEFAULTS));
 assert(allowedChat(chatForJarvis({...message,moderator:true}),DEFAULTS));
 assert(allowedChat(chatForJarvis({...message,isBroadcaster:true}),DEFAULTS));
 assert(!allowedChat(chatForJarvis({...message,moderator:'false'}),DEFAULTS));
});
test('Jarvis shares the live OBS controller and acknowledges failures',async()=>{
 let current=null;const adapter=obsForJarvis(()=>current);assert(!adapter.connected);assert.throws(()=>adapter.request('GetSceneList'));
 const calls=[];current={connected:true,call:async(name,data)=>{calls.push([name,data]);return {scenes:[{sceneName:'Pause'}]};}};
 assert(adapter.connected);assert.equal((await adapter.request('GetSceneList')).scenes[0].sceneName,'Pause');
 await adapter.request('SetCurrentProgramScene',{sceneName:'Pause'});assert.equal(calls[1][1].sceneName,'Pause');
 current.call=async()=>{throw Error('OBS Fehler');};await assert.rejects(adapter.request('SetCurrentProgramScene'),/OBS Fehler/);
});
test('original 2.4.7 style and artwork hashes remain unchanged',()=>{
 const manifest=require('../reference-2.4.7.json');
 for(const [file,hash] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);
});
test('separate local ports avoid the original OBS Tool listeners',()=>{
 const {DEFAULT_CONFIG}=require('../src/core/config-store.cjs');assert.equal(DEFAULT_CONFIG.http.port,17787);assert.equal(DEFAULT_CONFIG.navigation.port,17788);
});
