'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process');
const {WebSocketServer}=require('ws');
const {NavigationService}=require('../src/core/navigation-service.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<200;i++){const r=check();if(r)return r;await delay(10);}throw Error('Fixture response timed out');}
(async()=>{
 const token='fixture-private-must-not-be-logged',calls=[],states={'overlay.snow':false,'overlay.likeBar':false};
 const controls={snapshot:()=>({states:{...states},controls:[]}),control:async p=>{calls.push({type:'control',target:p.target});if(!(p.target in states))throw Error('Unknown target');states[p.target]=!states[p.target];return{ok:true,state:states[p.target]};}};
 let testCount=0;const nav=new NavigationService({token,controls,navigate:async view=>{calls.push({type:'navigate',view});return view;},catalog:()=>[{kind:'chain',id:'fixture-audio',name:'Fixture audio',enabled:true}],test:async(kind,id)=>{assert.equal(kind,'chain');if(id!=='fixture-audio')throw Error('Die gewählte Aktion fehlt.');testCount++;await delay(150);return{ok:true};}});
 nav.start(0);await new Promise(r=>nav.server.once('listening',r));nav.publish('dashboard');
 const hostServer=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>hostServer.once('listening',r));
 let host,child,stderr='',stdout='';const events=[];
 hostServer.on('connection',ws=>{host=ws;ws.on('message',data=>{events.push(JSON.parse(data));});});
 const uuid='de.crazybatto.navigation',dir=path.resolve(__dirname,'../../repair-streamdeck/'+uuid+'.sdPlugin');
 const send=(event,action,context,payload={})=>host.send(JSON.stringify({event,action:uuid+'.'+action,context,payload}));
 const test=(action,context,requestId,settings)=>send('sendToPlugin',action,context,{type:'testKey',requestId,settings});
 const result=id=>events.find(e=>e.event==='sendToPropertyInspector'&&e.payload?.type==='testKeyResult'&&e.payload.requestId===id)?.payload;
 try{
  child=spawn(process.execPath,[path.join(dir,'plugin.cjs'),'-port',String(hostServer.address().port),'-pluginUUID',uuid,'-registerEvent','registerPlugin'],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.on('data',b=>stderr+=b);child.stdout.on('data',b=>stdout+=b);
  await until(()=>events.find(e=>e.event==='getGlobalSettings'));
  assert(events.some(e=>e.event==='registerPlugin'&&e.uuid===uuid));
  send('willAppear','snow','snow',{settings:{}});test('snow','snow','offline',{});assert.equal((await until(()=>result('offline'))).ok,false);assert.match(result('offline').error,/nicht bereit/);assert.equal(calls.length,0);
  host.send(JSON.stringify({event:'didReceiveGlobalSettings',payload:{settings:{url:'ws://127.0.0.1:'+nav.server.address().port,token}}}));
  await until(()=>events.find(e=>e.event==='sendToPropertyInspector'&&e.payload?.ready===true));
  test('snow','snow','snow',{});assert.equal((await until(()=>result('snow'))).ok,true);assert.equal(states['overlay.snow'],true);assert.equal(testCount,0);
  send('willAppear','control','control',{settings:{target:'overlay.snow'}});test('control','control','pi-settings',{target:'overlay.likeBar'});assert.equal((await until(()=>result('pi-settings'))).ok,true);assert.equal(states['overlay.likeBar'],true);assert.equal(states['overlay.snow'],true,'PI uses current displayed settings');
  test('snow','control','mismatch',{});assert.equal((await until(()=>result('mismatch'))).ok,false);assert.match(result('mismatch').error,/Profil/);assert.equal(calls.length,2);
  send('willDisappear','snow','snow');test('snow','snow','inactive',{});assert.equal((await until(()=>result('inactive'))).ok,false);assert.equal(calls.length,2);
  send('willAppear','test','test',{settings:{kind:'chain',targetId:'fixture-audio'}});test('test','test','missing',{kind:'chain',targetId:'does-not-exist'});assert.equal((await until(()=>result('missing'))).ok,false);assert.equal(testCount,0);
  test('test','test','first',{kind:'chain',targetId:'fixture-audio'});await until(()=>testCount===1);test('test','test','busy',{kind:'chain',targetId:'fixture-audio'});assert.equal((await until(()=>result('busy'))).ok,false);assert.match(result('busy').error,/gerade ausgeführt/);assert.equal((await until(()=>result('first'))).ok,true);assert.equal(testCount,1);
  send('keyDown','test','test',{settings:{kind:'chain',targetId:'fixture-audio'}});await until(()=>testCount===2);await until(()=>events.filter(e=>e.event==='showOk'&&e.context==='test').length===2);
  send('willAppear','open','navigate',{settings:{view:'livecenter',focus:false}});test('open','navigate','navigate',{view:'livecenter',focus:false});assert.equal((await until(()=>result('navigate'))).ok,true);assert.equal(nav.view,'livecenter');
  const logs=events.filter(e=>e.event==='logMessage').map(e=>e.payload.message).join('\n');assert.match(logs,/"origin":"keyDown"/);assert.match(logs,/"origin":"propertyInspector"/);assert.match(logs,/"phase":"context-active"/);assert.match(logs,/"error":"BUSY"/);assert.match(logs,/"error":"OFFLINE"/);assert.ok(!logs.includes(token));assert.ok(!stdout.includes(token));assert.equal(stderr,'');
  console.log(JSON.stringify({ok:true,checks:['real plugin process registration','offline PI failure without execution','PI test same control pathway','current PI settings used','context/action mismatch blocked','inactive context blocked','missing action returned','concurrent key rejected with result','actual host keyDown same test handler','navigation returned acknowledgment','host diagnostic origins/context/no token']}));
 }finally{child?.kill();for(const ws of hostServer.clients)ws.terminate();hostServer.close();nav.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
