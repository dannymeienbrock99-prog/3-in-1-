'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {WebSocketServer}=require('ws'),{SuiteRuntime}=require('../src/services/suite-runtime.cjs'),{ObsWebSocketClient}=require('../src/services/obs-websocket.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('suite: real sensors, isolated OBS protocol, authenticated API, native Stream Deck', {timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-suite-test-')),root=path.resolve(__dirname,'../..');
 const mockObs=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>mockObs.once('listening',r));let changed='',requests=0;
 mockObs.on('connection',s=>{s.send(JSON.stringify({op:0,d:{rpcVersion:1}}));s.on('message',raw=>{const m=JSON.parse(raw);if(m.op===1)s.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));if(m.op===6){const d=m.d;let responseData={};if(d.requestType==='GetSceneList')responseData={scenes:[{sceneName:'Pause'},{sceneName:'Spiel'}]};if(d.requestType==='SetCurrentProgramScene'){changed=d.requestData.sceneName;requests++;}setTimeout(()=>s.send(JSON.stringify({op:7,d:{requestId:d.requestId,requestType:d.requestType,requestStatus:{result:true,code:100},responseData}})),30);}});});
 const obs=new ObsWebSocketClient();await obs.connect({port:mockObs.address().port});
 const suite=new SuiteRuntime({directory:dir,fanRoot:path.join(root,'FanAtlas'),voiceCode:path.join(root,'jarvis'),voiceBundle:path.join(root,'jarvis'),obs});suite.jarvis.update({voiceEnabled:false,sceneAliases:{pause:'Pause'}});
 let plugin,sd;
 try{
  await suite.start();for(let n=0;n<20&&!suite.fan.snapshot;n++){await pause(400);await suite.fan.poll();}
  assert(suite.fan.snapshot.sensors.some(s=>s.device==='RAM'&&s.fresh),'actual Windows RAM');
  const descriptor=JSON.parse(fs.readFileSync(path.join(dir,'bridge.json'))),headers={Authorization:'Bearer '+descriptor.token,'Content-Type':'application/json'};
  const url='http://127.0.0.1:17656';assert.equal((await fetch(url+'/api/state')).status,401);
  assert.equal((await fetch(url+'/api/state',{headers:{...headers,Origin:'https://example.com'}})).status,403);
  const result=await (await fetch(url+'/api/command',{method:'POST',headers,body:JSON.stringify({text:'Jarvis Pause'})})).json();assert(result.ok);assert.equal(changed,'Pause');assert.equal(requests,1);
  assert.equal((await fetch(url+'/api/command',{method:'POST',headers,body:'{broken'})).status,400);
  const unknown=await suite.jarvis.execute('Spannung Pin 6');assert.match(unknown.text,/keinen passenden/);
  await suite.fan.configure('curve',{name:'Integration Test',sensorLabel:'GPU',points:[{temperature:30,duty:30},{temperature:80,duty:100}]});const curveId=suite.fan.snapshot.selectedCurveId;assert(curveId);
  await assert.rejects(()=>suite.fan.configure('curve',{name:'Bad',sensorLabel:'GPU',points:[{temperature:80,duty:30},{temperature:30,duty:100}]}));
  const sensor=suite.fan.snapshot.sensors.find(s=>s.unit==='°C')||suite.fan.snapshot.sensors[0];
  sd=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>sd.once('listening',r));const messages=[],waiters=[];let socket;
  const wait=predicate=>{const i=messages.findIndex(predicate);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Plugin timeout')),10000);waiters.push({predicate,resolve:e=>{clearTimeout(timer);resolve(e);}});});};
  sd.on('connection',s=>{socket=s;s.on('message',raw=>{const e=JSON.parse(raw),i=waiters.findIndex(w=>w.predicate(e));if(i>=0)waiters.splice(i,1)[0].resolve(e);else messages.push(e);});});
  plugin=spawn(path.join(root,'streamdeck/de.crazybatto.suite.sdPlugin/bin/FanAtlas.Deck.exe'),['-port',String(sd.address().port),'-pluginUUID','TEST','-registerEvent','registerPlugin'],{windowsHide:true,env:{...process.env,FANATLAS_TEST_BRIDGE:path.join(dir,'FanAtlas/bridge.json'),BATTO_TEST_BRIDGE:path.join(dir,'bridge.json')}});
  await wait(e=>e.event==='registerPlugin');const send=(event,context,action,payload={})=>socket.send(JSON.stringify({event,context,action:'de.crazybatto.suite.'+action,payload}));
  send('willAppear','sensor','sensor',{settings:{sensorId:sensor.id}});assert((await wait(e=>e.event==='setImage'&&e.context==='sensor')).payload.image.startsWith('data:image/png;base64,'));
  send('keyDown','sensor','sensor');await wait(e=>e.event==='showOk'&&e.context==='sensor');
  send('willAppear','pause','command',{settings:{label:'Pause',command:'Pause'}});send('keyDown','pause','command');await wait(e=>e.event==='showOk'&&e.context==='pause');assert.equal(requests,2);
  send('willAppear','curve','curve',{settings:{curveId}});send('keyDown','curve','curve');await wait(e=>e.event==='showOk'&&e.context==='curve');
  send('propertyInspectorDidAppear','sensor','sensor');const catalog=await wait(e=>e.event==='sendToPropertyInspector');assert(catalog.payload.online);assert(catalog.payload.catalog.sensors.length>0);
  console.log('Verified: live Windows/NVIDIA sensors, token/origin checks, invalid bodies/curves, explicit unavailable pins, acknowledged OBS changes, sensor/command/curve Stream Deck keys.');socket.close();
 }finally{plugin?.kill();sd?.close();await suite.close();await obs.disconnect();mockObs.close();}
});
