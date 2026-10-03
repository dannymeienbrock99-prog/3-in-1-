'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {TouchDeck,defaultConfig}=require('../src/services/touch-deck.cjs');
function setup(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-audio-integration-')),calls=[];
 const values={master:{volume:62,muted:false,available:true,name:'Windows'},jarvis:{volume:40,muted:false,available:true,name:'Jarvis'}};
 const audio={state:async ids=>{calls.push({read:ids});return Object.fromEntries(ids.map(id=>[id,values[id]]));},set:async(id,patch)=>{calls.push({id,patch});if(!values[id])throw Error('Programm nicht verfügbar');return values[id]={...values[id],...patch};},close:async()=>{}};
 const config=defaultConfig(),actions=config.profiles[0].buttons.map(b=>({id:b.steps[0].action}));
 const deck=new TouchDeck({directory,audio,controls:{catalog:()=>({actions}),execute:()=>{throw Error('No generic action expected');}},host:'127.0.0.1',port:0});
 t.after(async()=>{await deck.close();fs.rmSync(directory,{recursive:true,force:true});});
 config.profiles[0].buttons[0]={id:'volume-master',type:'volume',title:'Windows',volumeTarget:'master',settings:{secret:'PRIVATE'},steps:[{action:'listen'}]};
 config.profiles[0].buttons[1]={id:'folder',type:'folder',title:'Ton',buttons:[{id:'volume-jarvis',type:'volume',title:'Jarvis',volumeTarget:'jarvis'}]};
 deck.save(config);return {deck,calls,config};
}
function request(deck,route,{token,body,headers={}}={}){return new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null;const req=http.request({hostname:'127.0.0.1',port:deck.mobile.port,path:route,method:data?'POST':'GET',headers:{...headers,...(token?{authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(text)}));});req.on('error',reject);req.end(data);});}
test('volume assignment persists, excludes target on phone, and does not start audio for snapshots',t=>{
 const {deck,calls}=setup(t);const saved=deck.snapshot();assert.equal(saved.profiles[0].buttons[0].volumeTarget,'master');assert(!JSON.stringify(saved).includes('PRIVATE'));assert(!JSON.stringify(deck.remoteState()).includes('volumeTarget'));assert.deepEqual(calls,[]);
});
test('only the visible folder requests its audio targets and missing apps have no fabricated percentage',async t=>{
 const {deck,calls,config}=setup(t);assert.equal((await deck.audioState({profileId:'main'})).values['volume-master'].volume,62);assert.deepEqual(calls,[{read:['master']}]);
 assert.equal((await deck.audioState({profileId:'main',path:[1]})).values['volume-jarvis'].volume,40);
 config.profiles[0].buttons[0].volumeTarget='app:missing';deck.save(config);assert.equal((await deck.audioState()).values['volume-master'].available,false);
 await assert.rejects(deck.audioState({profileId:'main',path:[0]}),/Ordner/);
});
test('faders can change only saved audio assignments and validate delayed button identity',async t=>{
 const {deck,calls}=setup(t);const pos={profileId:'main',index:0,buttonId:'volume-master',baseRevision:deck.revision};
 assert.equal((await deck.volume({...pos,volume:27})).value.volume,27);assert.equal((await deck.volume({...pos,muted:true})).value.muted,true);
 for(const patch of [{volume:-1},{volume:101},{volume:NaN},{volume:'50'},{muted:1},{volume:5,muted:false},{target:'master',volume:5},{volume:5,buttonId:'old'}])await assert.rejects(deck.volume({...pos,...patch}));
 await assert.rejects(deck.volume({profileId:'main',index:2,buttonId:deck.config.profiles[0].buttons[2].id,baseRevision:deck.revision,volume:20}),/Soundregler/);assert.equal(calls.length,2);
 assert.deepEqual(await deck.press(pos),{ok:true,type:'volume'});
});
test('paired mobile volume uses the same saved positions, origin guard and bounded writes',async t=>{
 const {deck,calls}=setup(t);await deck.mobileStart();const pair=await request(deck,'/api/pair',{body:{pin:deck.mobile.pin}}),token=pair.value.token,body={profileId:'main',path:[1],index:0,buttonId:'volume-jarvis',baseRevision:deck.revision,volume:33};
 assert.equal((await request(deck,'/api/volume',{body})).status,401);
 assert.equal((await request(deck,'/api/volume',{body,token,headers:{origin:'https://invalid.example'}})).status,403);
 assert.equal((await request(deck,'/api/volume',{body:{...body,target:'master'},token})).status,400);
 const r=await request(deck,'/api/volume',{body,token});assert.equal(r.value.value.volume,33);assert.equal(r.value.ok,true);
 const read=await request(deck,'/api/readings',{token,headers:{'x-batto-profile':'main','x-batto-path':'[1]'}});assert.equal(read.value.volumes['volume-jarvis'].volume,33);assert(!read.value.volumes['volume-master']);
 assert(!JSON.stringify(read.value).includes('volumeTarget'));
 for(let i=0;i<21;i++)await request(deck,'/api/volume',{body,token});assert.equal((await request(deck,'/api/volume',{body,token})).status,429);
 assert(calls.filter(x=>x.patch).every(x=>x.id==='jarvis'));
 await deck.rotatePin();assert.equal((await request(deck,'/api/volume',{body,token})).status,401);
});
test('a delayed phone or desktop slider cannot change a reassigned button or target',async t=>{
 const {deck,calls,config}=setup(t),old={profileId:'main',index:0,buttonId:'volume-master',baseRevision:deck.revision,volume:21};
 config.profiles[0].buttons[0].volumeTarget='jarvis';deck.save(config);await assert.rejects(deck.volume(old),/geändert/);
 await assert.rejects(deck.volume({...old,baseRevision:deck.revision,buttonId:undefined}),/geändert/);
 assert.deepEqual(calls,[]);assert.equal((await deck.volume({...old,baseRevision:deck.revision})).value.name,'Jarvis');
});
test('QR PNG decodes to the local URL and current PIN; rotation and stop remove old codes',async t=>{
 const {deck}=setup(t),{PNG}=require('pngjs'),decode=require('jsqr');assert.deepEqual(deck.mobileStatus().qrCodes,[]);
 const started=await deck.mobileStart();const read=image=>{const png=PNG.sync.read(Buffer.from(image.split(',')[1],'base64'));return decode(new Uint8ClampedArray(png.data),png.width,png.height).data;};
 for(const code of started.qrCodes)assert.equal(read(code.image),code.url+'/#pin='+started.pin);
 const rotated=await deck.rotatePin();for(const code of rotated.qrCodes)assert.equal(read(code.image),code.url+'/#pin='+rotated.pin);
 const stopped=await deck.mobileStop();assert.deepEqual(stopped.qrCodes,[]);assert.equal(stopped.pin,'');
});
