'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {TouchDeck,defaultConfig,LIMITS}=require('../src/services/touch-deck.cjs');
const {SESSION_MS}=require('../src/services/touch-mobile.cjs');
const {moveButton,removeButton,visibleKeyCount,rememberPosition,restorePosition}=require('../src/renderer/touch-deck.js');
const actions=[{id:'listen'},{id:'speech-stop'},{id:'command',text:true},{id:'scene',choices:[{id:'Spiel'},{id:'Pause'},{id:'Start'},{id:'Ende'}],transition:true},{id:'start',choices:[{id:'both'}]},{id:'stop',choices:[{id:'both'}]},{id:'source',choices:[{id:'camera'},{id:'game'}],switch:true},{id:'gaming'},{id:'show'},{id:'jarvis',choices:[{id:'voiceEnabled'}],switch:true},{id:'prepare'},{id:'release'}];
function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-touch-')),webRoot=path.join(directory,'web');fs.mkdirSync(webRoot);for(const [file,content]of Object.entries({'index.html':'<title>Batto Touch Deck</title>','client.js':'console.log("touch");','style.css':'body{color:gold}'}))fs.writeFileSync(path.join(webRoot,file),content);
 const calls=[],controls={catalog:()=>({actions}),execute:async value=>{calls.push(value);return {ok:true,completed:value.steps.length};}};
 const deck=new TouchDeck({directory,controls,host:'127.0.0.1',port:0,webRoot,...options});t.after(async()=>{await deck.close();fs.rmSync(directory,{recursive:true,force:true});});return {deck,directory,calls};
}
function request(deck,route,{method='GET',body,token,headers={}}={}){
 const data=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body);
 return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:deck.mobile.port,path:route,method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...headers}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{let value;try{value=JSON.parse(text);}catch{value=text;}resolve({status:res.statusCode,headers:res.headers,value});});});req.on('error',reject);req.end(data);});
}
async function pair(deck){const r=await request(deck,'/api/pair',{method:'POST',body:{pin:deck.mobileStatus().pin}});assert.equal(r.status,200);return r.value;}
function guardedPosition(deck,position){return {...position,buttonId:deck.locate(position).id,baseRevision:deck.revision};}
function sensorConfig(){const c=defaultConfig();c.profiles[0].buttons[0]={id:'cpu-key',type:'sensor',title:'CPU',symbol:'°',sensorId:'private/cpu/temperature'};c.profiles[0].buttons[1]={id:'folder',type:'folder',title:'Ordner',buttons:[{id:'nested',type:'action',title:'Pause',steps:[{action:'scene',target:'Pause',transition:'fade',durationMs:500}]}]};return c;}

test('construction leaves server, files, microphone and sensor polling asleep',t=>{
 let sensorReads=0;const {deck,directory,calls}=fixture(t,{getSensors:()=>{sensorReads++;return [];}});assert.equal(sensorReads,0);assert.equal(deck.mobile.server,null);assert.equal(deck.mobile.pending,null);assert.equal(deck.mobile.assets.size,0);assert(!fs.existsSync(path.join(directory,'touch-deck.json')));assert.deepEqual(calls,[]);assert.equal(deck.snapshot().mobile.running,false);assert.equal(sensorReads,1);
});
test('explicit loopback binding remains available when network adapter enumeration is unavailable',async t=>{
 let queries=0;t.mock.method(os,'networkInterfaces',()=>{queries++;throw Error('Network adapter enumeration unavailable');});
 const {deck}=fixture(t),state=await deck.mobileStart();
 assert.equal(queries,0);assert.equal(state.running,true);assert.deepEqual(deck.mobile.addresses,['127.0.0.1']);
 assert.deepEqual(state.urls,['http://127.0.0.1:'+deck.mobile.port]);assert.equal((await request(deck,'/')).status,200);
 assert.equal((await request(deck,'/',{headers:{Host:'192.168.1.50:'+deck.mobile.port}})).status,403);
});
test('stale ordinary keys cannot execute a replacement action at the same position',async t=>{
 const {deck,calls}=fixture(t),position=guardedPosition(deck,{profileId:'main',path:[],index:0});
 const config=deck.snapshot();config.profiles[0].buttons[0]={id:'replacement',type:'action',title:'Ersatz',steps:[{action:'show'}]};deck.save(config);
 await assert.rejects(deck.press(position),/geändert/);assert.equal(calls.length,0);
 await assert.rejects(deck.press({...position,baseRevision:deck.revision}),/geändert/);assert.equal(calls.length,0);
 await deck.press(guardedPosition(deck,{profileId:'main',path:[],index:0}));assert.deepEqual(calls,[{steps:[{action:'show'}]}]);
});
test('phone refresh recovers a removed folder or profile before querying audio',async t=>{
 const {deck}=fixture(t);deck.save(sensorConfig());await deck.mobileStart();const {token,state}=await pair(deck);let audioCalls=0;deck.audioState=async()=>{audioCalls++;throw Error('removed path must not reach audio');};
 const config=deck.snapshot();config.profiles=config.profiles.filter(p=>p.id!=='main');deck.save(config);
 const refresh=await request(deck,'/api/readings',{token,headers:{'X-Batto-Profile':'main','X-Batto-Path':'[1]','X-Batto-Revision':String(state.revision)}});
 assert.equal(refresh.status,200);assert.equal(refresh.value.revision,deck.revision);assert.equal(audioCalls,0);assert(!('profiles'in refresh.value));
 const updated=await request(deck,'/api/state',{token});assert.equal(updated.status,200);assert.equal(updated.value.profiles.some(p=>p.id==='main'),false);
});
test('paired phone requires displayed button identity and rejects stale presses without side effects',async t=>{
 const {deck,calls}=fixture(t);await deck.mobileStart();const {token}=await pair(deck),position={profileId:'main',path:[],index:0},guarded=guardedPosition(deck,position);
 assert.equal((await request(deck,'/api/press',{method:'POST',token,body:position})).status,409);assert.equal(calls.length,0);
 const config=deck.snapshot();config.profiles[0].buttons[0].steps=[{action:'show'}];deck.save(config);
 const stale=await request(deck,'/api/press',{method:'POST',token,body:guarded});assert.equal(stale.status,400);assert.match(stale.value.message,/geändert/);assert.equal(calls.length,0);
 assert.equal((await request(deck,'/api/press',{method:'POST',token,body:guardedPosition(deck,position)})).status,200);assert.deepEqual(calls,[{steps:[{action:'show'}]}]);
});
test('save preserves an isolated profile, fills grids, strips foreign settings and reloads',t=>{
 const {deck,directory}=fixture(t);const original=path.join(directory,'jarvis-settings.json');fs.writeFileSync(original,'{"voiceEnabled":true}');const config=sensorConfig();config.multiChat={token:'never-copy'};config.profiles[0].buttons[2].settings={password:'never-copy'};let events=0;deck.on('change',()=>events++);const state=deck.save(config);assert.equal(events,1);assert.equal(state.profiles[0].buttons[1].buttons.length,15);assert(!JSON.stringify(state).includes('never-copy'));assert.equal(fs.readFileSync(original,'utf8'),'{"voiceEnabled":true}');assert.equal(fs.readdirSync(directory).filter(x=>x.endsWith('.tmp')).length,0);
 const loaded=new TouchDeck({directory,controls:deck.controls});assert.deepEqual(loaded.config,deck.config);assert.equal(loaded.loadError,'');state.profiles[0].name='mutated';assert.equal(deck.config.profiles[0].name,'Mein Deck');
});
test('invalid save never replaces the last valid deck and corrupt load preserves source',t=>{
 const {deck,directory}=fixture(t);deck.save(defaultConfig());const before=fs.readFileSync(deck.file,'utf8'),bad=defaultConfig();bad.profiles[0].buttons[0].steps=[{action:'exec',command:'anything'}];assert.throws(()=>deck.save(bad),/nicht unterstützt/);assert.equal(fs.readFileSync(deck.file,'utf8'),before);fs.writeFileSync(deck.file,'{broken');const loaded=new TouchDeck({directory,controls:deck.controls});assert.match(loaded.loadError,/nicht geladen/);assert.equal(fs.readFileSync(deck.file,'utf8'),'{broken');
});
test('schema rejects oversized actions, deep folders, duplicate IDs and unsafe pictures',t=>{
 const {deck}=fixture(t);for(const mutate of [c=>c.profiles[0].buttons[0].steps=Array(9).fill({action:'listen'}),c=>c.profiles[0].buttons[0].icon='data:image/svg+xml,<svg/>',c=>c.profiles[0].buttons[1].id=c.profiles[0].buttons[0].id,c=>c.profiles[0].columns=100,c=>c.profiles=Array(21).fill(c.profiles[0]),c=>c.profiles[0].buttons[0].steps=[{action:'scene',target:'Spiel',durationMs:9999}],c=>c.profiles[0].buttons[0].steps=[{action:'command',text:'a'.repeat(501)}]]){const c=defaultConfig();mutate(c);assert.throws(()=>deck.save(c));}
 const c=defaultConfig();let current=c.profiles[0].buttons;for(let depth=0;depth<5;depth++){current[0]={id:'folder'+depth,type:'folder',title:'Folder',buttons:[]};current=current[0].buttons;}assert.throws(()=>deck.save(c),/vier Ebenen/);
});
test('only the saved button executes, folders navigate and sensors return live or unavailable values',async t=>{
 const {deck,calls}=fixture(t,{getSensors:()=>[{id:'private/cpu/temperature',name:'CPU Paket',value:51.5,unit:'°C'}]});deck.save(sensorConfig());assert.equal((await deck.press({profileId:'main',path:[],index:0})).value,51.5);assert.deepEqual(await deck.press({profileId:'main',path:[],index:1}),{ok:true,type:'folder',path:[1]});await deck.press({profileId:'main',path:[1],index:0});assert.deepEqual(calls,[{steps:[{action:'scene',target:'Pause',transition:'fade',durationMs:500}]}]);deck.getSensors=()=>[];assert.equal((await deck.press({profileId:'main',index:0})).value,null);for(const position of [{profileId:'missing',index:0},{profileId:'main',path:[0],index:0},{profileId:'main',path:[1],index:2},{profileId:'main',index:-1},{profileId:'main',index:'0'}])await assert.rejects(deck.press(position));assert.equal(calls.length,1);
});
test('stale action targets remain editable, execution uses the shared control validation',async t=>{
 const {deck}=fixture(t);const c=defaultConfig();c.profiles[0].buttons[0].steps=[{action:'scene',target:'Gelöschte Szene'}];deck.save(c);deck.controls.execute=async()=>{throw Error('Bitte ein vorhandenes Ziel wählen.');};await assert.rejects(deck.press({profileId:'main',index:0}),/vorhandenes Ziel/);assert.equal(deck.snapshot().profiles[0].buttons[0].steps[0].target,'Gelöschte Szene');
});
test('remote state omits control definitions, sensor identifiers, settings and pairing secrets',t=>{
 const {deck}=fixture(t,{getSensors:()=>[{id:'private/cpu/temperature',name:'CPU',value:53,unit:'°C'},{id:'unused/sensor',name:'unused',value:2,unit:'V'}]});deck.save(sensorConfig());const remote=deck.remoteState(),serialized=JSON.stringify(remote);for(const hidden of ['steps','sensorId','private/cpu/temperature','unused/sensor','mobile','pin'])assert(!serialized.includes(hidden),hidden);assert.deepEqual(remote.readings['cpu-key'],{value:53,unit:'°C',name:'CPU'});const revision=remote.revision;assert.equal(deck.remoteReadings().revision,revision);deck.save(defaultConfig());assert.equal(deck.remoteState().revision,revision+1);assert.deepEqual(Object.keys(deck.remoteReadings()).sort(),['readings','revision']);
});
test('explicit mobile start serves only approved assets and pairing protects all device APIs',async t=>{
 const {deck}=fixture(t);const started=await deck.mobileStart();assert(started.running);assert.match(started.pin,/^\d{6}$/);assert.equal(started.urls.length,1);assert.equal((await request(deck,'/')).status,200);assert.equal((await request(deck,'/client.js')).status,200);assert.equal((await request(deck,'/style.css')).status,200);assert.equal((await request(deck,'/touch-deck.json')).status,404);assert.equal((await request(deck,'/../touch-deck.json')).status,404);for(const route of ['/api/state','/api/readings'])assert.equal((await request(deck,route)).status,401);assert.equal((await request(deck,'/api/press',{method:'POST',body:{profileId:'main',index:0}})).status,401);const p=await pair(deck);assert.match(p.token,/^[a-f0-9]{64}$/);assert(!JSON.stringify(p.state).includes(started.pin));assert.equal((await request(deck,'/api/state',{token:p.token})).status,200);const readings=await request(deck,'/api/readings',{token:p.token});assert.equal(readings.status,200);assert(!('profiles'in readings.value));assert.equal(deck.mobileStatus().clients,1);
});
test('mobile requests reject hostile origins, host spoofing, cross-site fetch and body injection',async t=>{
 const {deck,calls}=fixture(t);await deck.mobileStart();const {token}=await pair(deck);for(const headers of [{Origin:'https://evil.example'},{Origin:'null'},{Host:'evil.example:'+deck.mobile.port},{Host:'192.168.123.123:'+deck.mobile.port},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await request(deck,'/api/state',{token,headers})).status,403);const ok=await request(deck,'/api/press',{method:'POST',token,body:guardedPosition(deck,{profileId:'main',path:[],index:0})});assert.equal(ok.status,200);assert.deepEqual(calls,[{steps:[{action:'listen'}]}]);assert.equal((await request(deck,'/api/press',{method:'POST',token,body:{profileId:'main',index:0,steps:[{action:'show'}]}})).status,400);assert.equal(calls.length,1);assert.equal((await request(deck,'/api/press',{method:'POST',token,body:'{'})).status,400);assert.equal((await request(deck,'/api/press',{method:'POST',token,body:'x'.repeat(5000)})).status,413);assert.equal((await request(deck,'/api/press',{method:'POST',token,body:{},headers:{'Content-Type':'text/plain'}})).status,415);
});
test('PIN attempts are bounded and rotation revokes all prior sessions',async t=>{
 const {deck}=fixture(t);await deck.mobileStart();const {token}=await pair(deck),wrong=deck.mobile.pin==='000000'?'000001':'000000';for(let i=0;i<5;i++)assert.equal((await request(deck,'/api/pair',{method:'POST',body:{pin:wrong}})).status,401);assert.equal((await request(deck,'/api/pair',{method:'POST',body:{pin:deck.mobile.pin}})).status,429);deck.rotatePin();assert.equal(deck.mobileStatus().clients,0);assert.equal((await request(deck,'/api/state',{token})).status,401);assert((await pair(deck)).token);
});
test('sessions expire, simultaneous clients are bounded, stopping revokes and frees the server',async t=>{
 let now=100000;const {deck}=fixture(t,{now:()=>now});await deck.mobileStart();const {token}=await pair(deck);for(let i=1;i<8;i++)await pair(deck);assert.equal((await request(deck,'/api/pair',{method:'POST',body:{pin:deck.mobile.pin}})).status,409);now+=SESSION_MS+1;assert.equal((await request(deck,'/api/state',{token})).status,401);assert.equal(deck.mobileStatus().clients,0);await pair(deck);const stopped=await deck.mobileStop();assert.equal(stopped.running,false);assert.equal(stopped.pin,'');assert.equal(stopped.clients,0);assert.equal(deck.mobile.assets.size,0);assert.equal(deck.mobile.server,null);await deck.mobileStart();assert.equal((await request(deck,'/api/state',{token})).status,401);
});
test('repeated start/stop has one listener and busy action errors remain readable',async t=>{
 const {deck}=fixture(t);await Promise.all([deck.mobileStart(),deck.mobileStart()]);const server=deck.mobile.server;assert.equal((await deck.mobileStart()).port,server.address().port);deck.controls.execute=async()=>{throw Error('Eine Tastenaktion läuft bereits.');};const {token}=await pair(deck);const result=await request(deck,'/api/press',{method:'POST',token,body:guardedPosition(deck,{profileId:'main',index:0})});assert.equal(result.status,400);assert.match(result.value.message,/läuft bereits/);await Promise.all([deck.mobileStop(),deck.mobileStop()]);assert.equal(server.listening,false);
});
test('disconnect revokes only that phone and releases its pairing slot',async t=>{
 const {deck}=fixture(t);await deck.mobileStart();const first=await pair(deck),second=await pair(deck);assert.equal(deck.mobileStatus().clients,2);assert.equal((await request(deck,'/api/disconnect',{method:'POST',token:first.token})).status,200);assert.equal(deck.mobileStatus().clients,1);assert.equal((await request(deck,'/api/state',{token:first.token})).status,401);assert.equal((await request(deck,'/api/state',{token:second.token})).status,200);assert.equal((await request(deck,'/api/disconnect',{method:'POST'})).status,401);
});

test('profile key size accepts automatic and 80–220 pixels, persists and reaches the phone',t=>{
 const {deck,directory}=fixture(t);
 for(const keySize of [undefined,'auto',80,150,220]){
  const config=defaultConfig();if(keySize!==undefined)config.profiles[0].keySize=keySize;
  const saved=deck.save(config),expected=keySize??'auto';assert.equal(saved.profiles[0].keySize,expected);assert.equal(deck.remoteState().profiles[0].keySize,expected);
  assert.equal(new TouchDeck({directory,controls:deck.controls}).config.profiles[0].keySize,expected);
 }
 const before=fs.readFileSync(deck.file,'utf8'),revision=deck.revision;
 for(const keySize of [79,221,100.5,NaN,Infinity,'120','Auto',false,{},[]]){
  const config=defaultConfig();config.profiles[0].keySize=keySize;assert.throws(()=>deck.save(config),/Tastengröße/);
 }
 assert.equal(deck.revision,revision);assert.equal(fs.readFileSync(deck.file,'utf8'),before);
});

test('plugin assignment keeps only action identity and exposes no plugin settings to phone or export',async t=>{
 const pluginCalls=[];const {deck,calls}=fixture(t,{pressPlugin:async(button,position)=>{pluginCalls.push({button,position});return {ok:true};}});
 const config=defaultConfig();config.profiles[0].buttons[0]={id:'plugin-key',type:'plugin',title:'Jarvis fragen',symbol:'◉',pluginId:'de.crazybatto.suite',actionId:'de.crazybatto.suite.listen',settings:{token:'PRIVATE_PLUGIN_TOKEN',nested:{password:'PRIVATE_PASSWORD'}},globalSettings:{secret:'PRIVATE_GLOBAL'},codePath:'C:/private/plugin.exe',steps:[{action:'listen'}]};
 const saved=deck.save(config),button=saved.profiles[0].buttons[0];assert.deepEqual(Object.keys(button).sort(),['actionId','id','pluginId','symbol','title','type']);
 const disk=fs.readFileSync(deck.file,'utf8'),remote=JSON.stringify(deck.remoteState());
 for(const hidden of ['PRIVATE_PLUGIN_TOKEN','PRIVATE_PASSWORD','PRIVATE_GLOBAL','codePath','globalSettings']){assert(!disk.includes(hidden),hidden);assert(!remote.includes(hidden),hidden);}
 assert(!remote.includes('pluginId'));assert(!remote.includes('actionId'));
 const position={profileId:'main',path:[],index:0};assert.deepEqual(await deck.press(position),{ok:true});assert.deepEqual(pluginCalls,[{button,position}]);assert.deepEqual(calls,[]);
 deck.pressPlugin=undefined;await assert.rejects(deck.press(position),/Plugin-Dienst/);
 for(const patch of [{pluginId:'../wrong'},{actionId:'bad/action'},{pluginId:''},{actionId:'a'.repeat(201)}]){const invalid=structuredClone(config);Object.assign(invalid.profiles[0].buttons[0],patch);assert.throws(()=>deck.save(invalid),/Plugin-Aktion/);}
 assert.equal(fs.readFileSync(deck.file,'utf8'),disk);
});

test('stale detached-window save cannot overwrite newer configuration or emit a change',t=>{
 const {deck}=fixture(t);const firstWindow=deck.snapshot(),detachedWindow=deck.snapshot();let changes=0;deck.on('change',()=>changes++);
 firstWindow.profiles[0].name='Neue Tasten';const latest=deck.save({...firstWindow,baseRevision:firstWindow.revision});const before=fs.readFileSync(deck.file,'utf8');
 detachedWindow.profiles[0].name='Veralteter Entwurf';assert.throws(()=>deck.save({...detachedWindow,baseRevision:detachedWindow.revision}),/anderen Fenster/);
 assert.equal(deck.revision,latest.revision);assert.equal(deck.config.profiles[0].name,'Neue Tasten');assert.equal(fs.readFileSync(deck.file,'utf8'),before);assert.equal(changes,1);
 const refreshed=deck.snapshot();refreshed.profiles[0].keySize=180;deck.save({...refreshed,baseRevision:refreshed.revision});assert.equal(changes,2);assert.equal(deck.config.profiles[0].keySize,180);
 assert(!fs.readFileSync(deck.file,'utf8').includes('baseRevision'));
});

test('authenticated phone activity identifies its visible profile and disconnect releases only that device',async t=>{
 const activity=[],disconnected=[];const {deck}=fixture(t,{onRemoteActivity:(id,profile)=>activity.push({id,profile}),onRemoteDisconnect:id=>disconnected.push(id)});
 const config=defaultConfig();config.profiles.push({id:'second',name:'Tablet',columns:2,rows:1,buttons:[{id:'second-listen',type:'action',title:'Jarvis',steps:[{action:'listen'}]}]});deck.save(config);
 await deck.mobileStart();const first=await pair(deck),second=await pair(deck);assert.equal(activity.length,0);
 assert.equal((await request(deck,'/api/readings',{headers:{'X-Batto-Profile':'second'}})).status,401);assert.equal(activity.length,0);
 assert.equal((await request(deck,'/api/state',{token:first.token})).status,200);const firstId=activity.at(-1).id;assert.equal(activity.at(-1).profile,'main');assert.notEqual(firstId,first.token);
 assert.equal((await request(deck,'/api/readings',{token:first.token,headers:{'X-Batto-Profile':'second'}})).status,200);assert.deepEqual(activity.at(-1),{id:firstId,profile:'second'});
 assert.equal((await request(deck,'/api/press',{method:'POST',token:second.token,body:guardedPosition(deck,{profileId:'second',path:[],index:0})})).status,200);const secondId=activity.at(-1).id;assert.notEqual(firstId,secondId);assert.equal(activity.at(-1).profile,'second');
 assert.equal((await request(deck,'/api/disconnect',{method:'POST',token:first.token})).status,200);assert.deepEqual(disconnected,[firstId]);
 const prior=activity.length;assert.equal((await request(deck,'/api/state',{token:first.token})).status,401);assert.equal(activity.length,prior);assert.equal((await request(deck,'/api/readings',{token:second.token})).status,200);assert.deepEqual(disconnected,[firstId]);
 await deck.mobileStop();assert.deepEqual(disconnected,[firstId,secondId]);await deck.mobileStop();assert.deepEqual(disconnected,[firstId,secondId]);
});

test('PIN rotation and session expiry release remote plugin activity exactly once',async t=>{
 let now=1_000_000;const disconnected=[],activity=[];const {deck}=fixture(t,{now:()=>now,onRemoteActivity:id=>activity.push(id),onRemoteDisconnect:id=>disconnected.push(id)});
 await deck.mobileStart();const one=await pair(deck),two=await pair(deck);await request(deck,'/api/state',{token:one.token});await request(deck,'/api/state',{token:two.token});
 deck.rotatePin();assert.deepEqual(disconnected.sort(),activity.sort());assert.equal(new Set(disconnected).size,2);assert.equal((await request(deck,'/api/state',{token:one.token})).status,401);assert.equal(disconnected.length,2);
 const current=await pair(deck);await request(deck,'/api/state',{token:current.token});const id=activity.at(-1);now+=SESSION_MS+1;assert.equal((await request(deck,'/api/readings',{token:current.token})).status,401);assert.equal(disconnected.filter(value=>value===id).length,1);
 deck.mobileStatus();await deck.mobileStop();assert.equal(disconnected.length,3);
});

test('mobile visual revision sends changed plugin images once and keeps unchanged polls small',async t=>{
 let visualRevision=4,presentationReads=0,presentation={'plugin-key':{image:'data:image/png;base64,fixture',title:'75 %'}};
 const {deck}=fixture(t,{getPresentation:()=>{presentationReads++;return presentation;},getVisualRevision:()=>visualRevision});await deck.mobileStart();const {token,state}=await pair(deck);
 assert.equal(state.visualRevision,4);assert.deepEqual(state.presentation,presentation);
 let reads=presentationReads;const first=await request(deck,'/api/readings',{token});assert.equal(first.value.visualRevision,4);assert.deepEqual(first.value.visuals,presentation);assert.equal(presentationReads,reads+1);
 reads=presentationReads;const unchanged=await request(deck,'/api/readings',{token,headers:{'X-Batto-Visual-Revision':'4'}});assert.equal(unchanged.status,200);assert(!('visuals'in unchanged.value));assert(!('profiles'in unchanged.value));assert.equal(presentationReads,reads);assert.equal(unchanged.value.visualRevision,4);
 visualRevision=5;presentation={'plugin-key':{title:'80 %'}};const updated=await request(deck,'/api/readings',{token,headers:{'X-Batto-Visual-Revision':'4'}});assert.equal(updated.value.visualRevision,5);assert.deepEqual(updated.value.visuals,presentation);
 visualRevision=6;presentation={};const cleared=await request(deck,'/api/readings',{token,headers:{'X-Batto-Visual-Revision':'5'}});assert.deepEqual(cleared.value.visuals,{});assert.equal(cleared.value.visualRevision,6);
});

test('real mobile manifest and icon are public local assets with strict MIME and no data-file exposure',async t=>{
 const webRoot=path.join(__dirname,'../src/touch-mobile'),{deck}=fixture(t,{webRoot});await deck.mobileStart();
 const manifest=await request(deck,'/manifest.webmanifest');assert.equal(manifest.status,200);assert.match(manifest.headers['content-type'],/^application\/manifest\+json/);assert.equal(manifest.value.name,'Batto Touch Deck');assert.equal(manifest.value.display,'standalone');assert.equal(manifest.value.start_url,'/');assert.equal(manifest.value.icons[0].src,'/icon.png');assert.match(manifest.headers['content-security-policy'],/manifest-src 'self'/);
 const icon=await fetch('http://127.0.0.1:'+deck.mobile.port+'/icon.png');assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/png');assert.equal(icon.headers.get('x-content-type-options'),'nosniff');const data=Buffer.from(await icon.arrayBuffer());assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert(data.equals(fs.readFileSync(path.join(webRoot,'icon.png'))));
 const index=await request(deck,'/');assert.match(index.value,/apple-mobile-web-app-capable/);assert.match(index.value,/rel="apple-touch-icon"/);
 for(const route of ['/manifest.webmanifest?secret=true','/AndroidManifest.xml','/touch-plugin-settings.json','/password.dpapi'])assert.equal((await request(deck,route)).status,404);
});

test('moving onto occupied keys inserts in either direction while swapping stays explicit',()=>{
 const a={id:'a',type:'action',steps:[{action:'scene',target:'Pause',transition:'cut'}]},b={id:'b',type:'plugin',pluginId:'plugin',actionId:'plugin.action'},c={id:'c',type:'folder',buttons:[{id:'nested',type:'volume',volumeTarget:'master'}]},d={id:'d',type:'sensor',sensorId:'cpu'};
 const keys=[a,b,c,d,null];
 assert.equal(moveButton(keys,0,2),true);assert.deepEqual(keys,[b,c,a,d,null]);assert.equal(keys[2],a);assert.equal(keys[1].buttons[0].volumeTarget,'master');
 assert.equal(moveButton(keys,3,0),true);assert.deepEqual(keys,[d,b,c,a,null]);
 assert.equal(moveButton(keys,0,2,true),true);assert.deepEqual(keys,[c,b,d,a,null]);
 assert.equal(moveButton(keys,2,4),true);assert.deepEqual(keys,[c,b,null,a,d]);assert.equal(keys[4].sensorId,'cpu');
 const before=keys.slice();for(const [from,to]of [[-1,0],[0,99],[2,0],[0,0],['0',1],[1,NaN]])assert.equal(moveButton(keys,from,to),false);assert.deepEqual(keys,before);
});

test('deleting a key closes gaps only on its page, keeps capacity and preserves complete remaining bindings',async t=>{
 const calls=[],{deck}=fixture(t,{pressPlugin:async(button,position)=>{calls.push({id:button.id,position});return {ok:true};}}),config=defaultConfig();
 const folder={id:'arrange-folder',type:'folder',title:'Unterwegs',buttons:[{id:'arrange-nested',type:'volume',title:'Windows',volumeTarget:'master'}]};
 config.profiles[0].buttons=[{id:'arrange-action',type:'action',title:'Pause',steps:[{action:'scene',target:'Pause',transition:'cut'}]},null,folder,{id:'arrange-plugin',type:'plugin',title:'Bot',pluginId:'de.example.bot',actionId:'de.example.bot.action'},null,{id:'arrange-volume',type:'volume',title:'Jarvis',volumeTarget:'jarvis'},{id:'arrange-sensor',type:'sensor',title:'CPU',sensorId:'private/cpu'},...Array(8).fill(null)];
 deck.save(config);const stale=guardedPosition(deck,{profileId:'main',index:3}),draft=deck.snapshot(),keys=draft.profiles[0].buttons,nestedBefore=JSON.stringify(keys[2].buttons),otherBefore=JSON.stringify(draft.profiles[1]);
 assert.equal(removeButton(keys,0),true);assert.deepEqual(keys.filter(Boolean).map(button=>button.id),['arrange-folder','arrange-plugin','arrange-volume','arrange-sensor']);assert.equal(keys.length,15);assert.equal(JSON.stringify(keys[0].buttons),nestedBefore);assert.equal(JSON.stringify(draft.profiles[1]),otherBefore);
 deck.save({...draft,baseRevision:draft.revision});const saved=deck.snapshot();assert.equal(saved.profiles[0].columns,5);assert.equal(saved.profiles[0].rows,3);assert.equal(saved.profiles[0].buttons[2].volumeTarget,'jarvis');assert.equal(saved.profiles[0].buttons[3].sensorId,'private/cpu');assert.equal(saved.profiles[0].buttons[0].buttons[0].volumeTarget,'master');
 await assert.rejects(deck.press(stale),/geändert|nicht belegt/);assert.equal(calls.length,0);await deck.press(guardedPosition(deck,{profileId:'main',index:1}));assert.equal(calls[0].id,'arrange-plugin');assert.equal(calls[0].position.index,1);
 assert.equal(deck.remoteState().profiles[0].buttons.length,15);assert.equal(deck.remoteState().profiles[0].buttons[1].id,'arrange-plugin');
 const before=JSON.stringify(keys);for(const index of [-1,15,14,'0',NaN])assert.equal(removeButton(keys,index),false);assert.equal(JSON.stringify(keys),before);
});

test('compact rendering hides trailing slots while retaining internal coordinates and editable capacity',()=>{
 const keys=[{id:'a'},null,{id:'b'},null,null,null];assert.equal(visibleKeyCount(keys),3);assert.equal(visibleKeyCount(keys,true),4);assert.equal(visibleKeyCount(keys,true,true),6);
 removeButton(keys,0);assert.equal(visibleKeyCount(keys),1);assert.equal(visibleKeyCount(keys,true),2);assert.equal(keys[0].id,'b');assert.equal(keys.length,6);
 assert.equal(visibleKeyCount(Array(6).fill(null)),0);assert.equal(visibleKeyCount(Array(6).fill(null),true),1);assert.equal(visibleKeyCount(Array(6).fill({id:'a'}),true),6);
});

test('open profile, nested folder and selected key follow their IDs after a second window moves or compacts keys',()=>{
 const config=defaultConfig();config.profiles[0].buttons[2]={id:'location-folder',type:'folder',title:'Bot',buttons:[null,{id:'location-inner',type:'folder',buttons:[null,{id:'location-selected',type:'plugin',pluginId:'bot',actionId:'bot.action'}]}]};
 const bookmark=rememberPosition(config,[2,1],1),next=structuredClone(config);next.activeProfile='sound';moveButton(next.profiles[0].buttons,2,4);next.profiles[0].buttons[4].buttons.unshift(null);
 const restored=restorePosition(next,bookmark);assert.equal(next.activeProfile,'main');assert.deepEqual(restored,{path:[4,2],selected:1});
 const inner=next.profiles[0].buttons[4].buttons[2].buttons;inner.unshift({id:'new-key'});assert.deepEqual(restorePosition(next,bookmark),{path:[4,2],selected:2});
 next.profiles[0].buttons[4].buttons[2]=null;assert.deepEqual(restorePosition(next,bookmark),{path:[4],selected:-1});
 next.profiles.splice(0,1);assert.deepEqual(restorePosition(next,bookmark),{path:[],selected:-1});assert.equal(next.activeProfile,'main');
});
