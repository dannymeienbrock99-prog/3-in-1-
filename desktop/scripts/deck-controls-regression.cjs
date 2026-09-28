'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {WebSocketServer,WebSocket}=require('ws');
const {NavigationService,ROUTES,showNavigationWindow}=require('../src/core/navigation-service.cjs');
const {createDeckControls}=require('../src/core/deck-controls.cjs');
const {createDeckTests}=require('../src/core/deck-tests.cjs');
const {DEFAULT_CONFIG}=require('../src/core/config-store.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let n=0;n<100;n++){if(fn())return;await sleep(30);}throw Error('Timed out');}
function merge(a,b){for(const [k,v]of Object.entries(b)){if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]??={};merge(a[k],v);}else a[k]=v;}return a;}
async function run(uuid){
 const c=structuredClone(DEFAULT_CONFIG);let detached=false,testCount=0,saveCount=0;
 c.autoBroadcast.items=[{id:'fixture-broadcast',name:'Nur Fixture',enabled:false}];
 let broadcasts=0,widgetPreviews=[];
 const deckTests=createDeckTests({getConfig:()=>c,widgetTest:payload=>{widgetPreviews.push(payload);return {ok:true};},broadcast:{test:async item=>{assert.equal(item.id,'fixture-broadcast');broadcasts++;return {ok:false,results:[{target:'fixture',ok:false,error:'fixture failure'}]};}}});
 assert.equal(deckTests.catalog().find(x=>x.kind==='broadcast').enabled,true);
 assert.match((await deckTests.test('broadcast','fixture-broadcast')).error,/fixture failure/);
 await assert.rejects(()=>deckTests.test('broadcast','missing'));assert.equal(broadcasts,1);
 const controls=createDeckControls({getConfig:()=>c,saveConfig:async patch=>{saveCount++;merge(c,patch);},isDetached:()=>detached,setDetached:v=>{detached=v;}});
 assert(ROUTES.includes('livecenter')&&ROUTES.includes('wishlist')&&ROUTES.includes('streamerbot'));assert(!ROUTES.includes('cohost'));
 const nav=new NavigationService({token:'isolated-fixture-only',navigate:async v=>v,controls,catalog:()=>[{id:'one',kind:'chain',name:'Schnee',enabled:true}],test:async(kind,id)=>{if(id!=='one')throw Error('Eintrag fehlt');testCount++;await sleep(100);return {ok:true};}});
 nav.start(0);await new Promise(r=>nav.server.once('listening',r));nav.publish('dashboard');
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));
 const events=[];let host,child,saved;
 server.on('connection',s=>{host=s;s.on('message',raw=>{const p=JSON.parse(raw);events.push(p);if(p.event==='getGlobalSettings')s.send(JSON.stringify({event:'didReceiveGlobalSettings',payload:{settings:{}}}));if(p.event==='setGlobalSettings')saved=p.payload;});});
 try{
  const dir=path.resolve(__dirname,'../../repair-streamdeck',uuid+'.sdPlugin');
  child=spawn(process.env.BATTO_DECK_NODE||process.execPath,[path.join(dir,'plugin.cjs'),'-port',String(server.address().port),'-pluginUUID',uuid,'-registerEvent','registerPlugin'],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',x=>errors+=x);child.on('error',e=>{errors+=e.message;});
  await wait(()=>events.some(e=>e.event==='getGlobalSettings'));
  const send=(event,action,context,settings={},extra={})=>host.send(JSON.stringify({event,action:uuid+'.'+action,context,payload:{settings},...extra}));
  send('propertyInspectorDidAppear','snow','snow');
  send('sendToPlugin','snow','snow',{}, {payload:{connection:JSON.stringify({url:'ws://127.0.0.1:'+nav.server.address().port,token:'isolated-fixture-only'})}});
  await wait(()=>events.some(e=>e.payload?.ready));assert.equal(saved.token,'isolated-fixture-only');
  let count=()=>events.filter(e=>e.event==='showOk').length;
  async function press(action,context,settings={}){const n=count();send('willAppear',action,context,settings);send('keyDown',action,context,settings);await wait(()=>count()>n);}
  await press('snow','snow');assert.equal(c.appearance.chatWidgets.snowEnabled,false);assert.equal(testCount,0);
  await press('likebar','likebar');assert.equal(c.appearance.chatWidgets.likesEnabled,false);assert.equal(testCount,0);
  await press('chatwindow','chat');assert(detached);await press('chatwindow','chat');assert(!detached);
  await press('open','nav',{view:'livecenter',focus:false});assert.equal(nav.view,'livecenter');
  await press('open','nav',{view:'cohost',focus:false});assert.equal(nav.view,'dashboard');
  await press('test','test',{targetId:'one',kind:'chain'});assert.equal(testCount,1);
  const alertCount=events.filter(e=>e.event==='showAlert').length;
  send('keyDown',uuid.endsWith('current21')?'snow':'test','missing',{targetId:'missing',targetName:'Schnee',kind:'chain'});
  await wait(()=>events.filter(e=>e.event==='showAlert').length>alertCount);assert.equal(testCount,1);
  // Duplicate network delivery must never toggle a setting twice.
  const direct=new WebSocket('ws://127.0.0.1:'+nav.server.address().port),replies=[];
  direct.on('message',r=>replies.push(JSON.parse(r)));await new Promise(r=>direct.once('open',r));direct.send(JSON.stringify({type:'auth',token:'isolated-fixture-only'}));await wait(()=>replies.some(r=>r.type==='state'));
  const start=saveCount,payload=JSON.stringify({id:'duplicate-toggle',type:'control',target:'overlay.snow',op:'toggle'});direct.send(payload);direct.send(payload);await wait(()=>replies.filter(r=>r.type==='ack').length===2);assert.equal(saveCount,start+1);assert.equal(c.appearance.chatWidgets.snowEnabled,true);
  direct.send(JSON.stringify({id:'unsupported',type:'control',target:'unsupported.fixture',op:'toggle'}));await wait(()=>replies.some(r=>r.id==='unsupported'));assert.equal(replies.find(r=>r.id==='unsupported').ok,false);
  await controls.control({target:'battleBar.enabled',op:'on'});assert.equal(c.battleBar.enabled,true);
  if(uuid.endsWith('navigation'))await press('battlebar','native-battle');else await controls.control({target:'battleBar.enabled'});
  assert.equal(c.battleBar.enabled,false);
  delete c.battleBar; // Compatibility for saved 2.4.5 widget profiles.
  const beforeMissing=saveCount;await assert.rejects(()=>controls.control({target:'battleBar.enabled'}),/Battle-Bar-Adresse fehlt/);assert.equal(saveCount,beforeMissing);
  c.chatExtras.widgets.push({id:'batto-battlebar',name:'Fixture Battle',url:'https://tikfinity.zerody.one/widget/fixture?cid=fixture&keep=unchanged',enabled:false,permanent:false});
  assert.equal(deckTests.catalog().find(x=>x.kind==='widget').enabled,true);
  await deckTests.test('widget','batto-battlebar');assert.deepEqual(widgetPreviews,[{id:'batto-battlebar',kind:'widget',preview:true,durationMs:8000}]);assert.equal(c.chatExtras.widgets[0].enabled,false);
  await assert.rejects(()=>deckTests.test('widget','missing-widget'));assert.equal(widgetPreviews.length,1);
  if(uuid.endsWith('navigation'))await press('battlebar','battle');else await controls.control({target:'battleBar.enabled'});
  assert.equal(c.chatExtras.widgets[0].enabled,true);assert.equal(c.chatExtras.widgets[0].permanent,true);assert.match(c.chatExtras.widgets[0].url,/keep=unchanged$/);
  await controls.control({target:'battleBar.enabled',op:'off'});assert.equal(controls.snapshot().states['battleBar.enabled'],false);
  c.chatExtras.widgets[0].url='';await assert.rejects(()=>controls.control({target:'battleBar.enabled',op:'on'}),/Widget-Adresse/);
  await assert.rejects(()=>controls.control({target:'broadcast.profile',args:{profileId:'missing'}}));
  await assert.rejects(()=>controls.control({target:'broadcast.profile:fixture-broadcast',op:'off'}));
  await assert.rejects(()=>controls.control({target:'broadcast.slot:1',op:'off'}));
  for(const authenticated of [false,true]){
    const invalid=new WebSocket('ws://127.0.0.1:'+nav.server.address().port);
    await new Promise(r=>invalid.once('open',r));
    if(authenticated){invalid.send(JSON.stringify({type:'auth',token:'isolated-fixture-only'}));await new Promise(r=>invalid.once('message',r));}
    const closed=new Promise(r=>invalid.once('close',r));invalid.send('null');assert.equal(await closed,1008);
  }
  await controls.control({target:'broadcast.profile',args:{profileId:'fixture-broadcast'},op:'on'});assert.equal(c.autoBroadcast.items[0].enabled,true);assert.equal(c.autoBroadcast.enabled,false);
  await controls.control({target:'chatArchive.enabled',op:'on'});assert.equal(c.community.archive.enabled,true);
  await controls.control({target:'viewerCount.enabled',op:'off'});assert.equal(c.community.viewers.enabled,false);
  direct.terminate();assert.equal(errors,'');
  console.log(JSON.stringify({ok:true,plugin:uuid,checks:['plugin host registration','global pairing before key appearance','snow/like/chat controls with no name guessing','new route navigation','exact test target','missing target fails without fallback','duplicate control id once only','unsupported control explicit failure','broadcast profile stable ID','archive and viewer settings']}));
 }finally{child?.kill();for(const c of server.clients)c.terminate();server.close();nav.stop();}
}
async function configurationTest(){
 const calls=[],window={isMinimized:()=>true,restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus'),showInactive:()=>calls.push('showInactive')};
 showNavigationWindow(window,false);assert.deepEqual(calls,['showInactive']);calls.length=0;
 showNavigationWindow(window,true);assert.deepEqual(calls,['restore','show','focus']);
 const service=new NavigationService({token:'fixture',navigate:async v=>v});service.publish('dashboard');
 await service.configure({enabled:true,port:0});assert(service.connectionPort());assert(service.ready);
 const original=service.server;await service.configure({enabled:true,port:0});assert.equal(service.server,original);
 await service.configure({enabled:false});assert.equal(service.connectionPort(),null);
 await service.configure({enabled:true,port:0});assert(service.connectionPort());assert(service.ready);assert.equal(service.view,'dashboard');
 const changed=await new Promise((resolve,reject)=>{const s=new WebSocketServer({host:'127.0.0.1',port:0});s.once('error',reject);s.once('listening',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
 await service.configure({enabled:true,port:changed});assert.equal(service.connectionPort(),changed);assert(service.ready);
 await service.closeServer();console.log(JSON.stringify({ok:true,checks:['focus false never activates/restores','focus true explicit','disable closes listener','enable retains UI readiness','port changes live','copied port derived from listener']}));
}
(async()=>{await configurationTest();await run('de.crazybatto.current21');await run('de.crazybatto.navigation');})().catch(e=>{console.error(e);process.exitCode=1;});
