'use strict';
process.env.BATTO_TEST_INSTANCE='1';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {WebSocketServer}=require('ws'),{SuiteRuntime}=require('../src/services/suite-runtime.cjs'),{OBSController}=require('../src/core/obs-controller.cjs'),{obsForJarvis}=require('../src/services/suite-host.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('suite: real sensors, isolated OBS protocol, authenticated API, native Stream Deck', {timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-suite-test-')),root=path.resolve(__dirname,'../..');
 const mockObs=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>mockObs.once('listening',r));let changed='',requests=0;const {encode,decode}=require('@msgpack/msgpack');const wire=x=>Buffer.from(encode(x));
 mockObs.on('connection',s=>{s.send(wire({op:0,d:{rpcVersion:1}}));s.on('message',raw=>{const m=decode(raw);if(m.op===1)s.send(wire({op:2,d:{negotiatedRpcVersion:1}}));if(m.op===6){const d=m.d;let responseData={};if(d.requestType==='GetSceneList')responseData={scenes:[{sceneName:'Pause'},{sceneName:'Spiel'}]};if(d.requestType==='SetCurrentProgramScene'){changed=d.requestData.sceneName;requests++;}setTimeout(()=>s.send(wire({op:7,d:{requestId:d.requestId,requestType:d.requestType,requestStatus:{result:true,code:100},responseData}})),30);}});});
 const controller=new OBSController({url:'ws://127.0.0.1:'+mockObs.address().port,autoReconnect:false});const obs=obsForJarvis(()=>controller);
 const suite=new SuiteRuntime({directory:dir,fanRoot:path.join(root,'FanAtlas'),voiceCode:path.join(root,'jarvis'),voiceBundle:path.join(root,'jarvis'),obs});suite.jarvis.update({voiceEnabled:false,sceneAliases:{pause:'Pause'}});
 let plugin,sd;
 try{
  await controller.connect();await suite.start();for(let n=0;n<20&&!suite.fan.snapshot;n++){await pause(400);await suite.fan.poll();}
  assert(suite.fan.snapshot.sensors.some(s=>s.device==='RAM'&&s.fresh),'actual Windows RAM');
  const descriptor=JSON.parse(fs.readFileSync(path.join(dir,'bridge.json'))),headers={Authorization:'Bearer '+descriptor.token,'Content-Type':'application/json'};
  const url='http://127.0.0.1:17666';assert.equal((await fetch(url+'/api/state')).status,401);
  assert.equal((await fetch(url+'/api/state',{headers:{...headers,Origin:'https://example.com'}})).status,403);
  const result=await (await fetch(url+'/api/command',{method:'POST',headers,body:JSON.stringify({text:'Jarvis Pause'})})).json();assert(result.ok);assert.equal(changed,'Pause');assert.equal(requests,1);
  assert.equal((await fetch(url+'/api/command',{method:'POST',headers,body:'{broken'})).status,400);
  const unknown=await suite.jarvis.execute('Spannung Pin 6');assert.match(unknown.text,/keinen passenden/);
  const log=path.join(dir,'corsair_cue_TEST.csv');
  fs.writeFileSync(log,'Time;iCUE LINK TEST Fan [RPM];iCUE LINK TEST Fan [%]\n10:00;1600;80\n');
  await suite.fan.configure('csv',{paths:[log]});await pause(2300);await suite.fan.poll();
  fs.appendFileSync(log,'10:01;1800;90\n');await pause(2300);await suite.fan.poll();
  const readings=suite.fan.snapshot.sensors.filter(s=>s.name.includes('TEST Fan'));
  assert.equal(readings.length,2);assert(readings.every(s=>s.fresh));
  const scene=structuredClone(suite.fan.snapshot.scene),testFan=scene.tiles.find(t=>readings.some(s=>s.id===t.rpmSensorId));assert(testFan);
  Object.assign(testFan,{name:'Prüflüfter',percentSensorId:readings.find(s=>s.unit==='%').id,maxRpm:2000,centerMode:'percent',announce:true});
  await suite.fan.configure('stage',scene);
  assert.equal(suite.fan.snapshot.scene.tiles.find(t=>t.id===testFan.id).speedPercent.value,90);
  assert.match((await suite.jarvis.execute('Prüflüfter Prozent')).text,/90 Prozent/);
  suite.jarvis.poll();assert(suite.jarvis.history.some(h=>h.kind==='alert'&&h.text.includes('90 Prozent')));
  testFan.percentSensorId='';await suite.fan.configure('stage',scene);
  const referenced=suite.fan.snapshot.scene.tiles.find(t=>t.id===testFan.id).speedPercent;
  assert.equal(referenced.value,90);assert.equal(referenced.basis,'rpm-reference');
  await suite.fan.configure('curve',{name:'Integration Test',sensorLabel:'GPU',points:[{temperature:30,duty:30},{temperature:80,duty:100}]});const curveId=suite.fan.snapshot.selectedCurveId;assert(curveId);
  await assert.rejects(()=>suite.fan.configure('curve',{name:'Bad',sensorLabel:'GPU',points:[{temperature:80,duty:30},{temperature:30,duty:100}]}));
  const sensor=suite.fan.snapshot.sensors.find(s=>s.unit==='°C')||suite.fan.snapshot.sensors[0];
  sd=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>sd.once('listening',r));const messages=[],waiters=[];let socket;
  const wait=predicate=>{const i=messages.findIndex(predicate);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Plugin timeout: '+predicate.toString())),10000);waiters.push({predicate,resolve:e=>{clearTimeout(timer);resolve(e);}});});};
  sd.on('connection',s=>{socket=s;s.on('message',raw=>{const e=JSON.parse(raw),i=waiters.findIndex(w=>w.predicate(e));if(i>=0)waiters.splice(i,1)[0].resolve(e);else messages.push(e);});});
  plugin=spawn(path.join(root,'streamdeck/de.crazybatto.suite.sdPlugin/bin/FanAtlas.Deck.exe'),['-port',String(sd.address().port),'-pluginUUID','TEST','-registerEvent','registerPlugin'],{windowsHide:true,env:{...process.env,FANATLAS_TEST_BRIDGE:path.join(dir,'FanAtlas/bridge.json'),BATTO_TEST_BRIDGE:path.join(dir,'bridge.json')}});
  await wait(e=>e.event==='registerPlugin');const send=(event,context,action,payload={})=>socket.send(JSON.stringify({event,context,action:'de.crazybatto.suite.'+action,payload}));
  send('willAppear','sensor','sensor',{settings:{sensorId:sensor.id}});assert((await wait(e=>e.event==='setImage'&&e.context==='sensor')).payload.image.startsWith('data:image/png;base64,'));
  // The initial key image can be the offline placeholder before the two-second poll.
  // A catalog request acknowledges actual data readiness before testing key actions.
  send('propertyInspectorDidAppear','sensor','sensor');const ready=await wait(e=>e.event==='sendToPropertyInspector'&&e.context==='sensor');
  assert(ready.payload.online,'native plugin has loaded FanAtlas state');assert(ready.payload.catalog.sensors.some(s=>s.id===sensor.id));assert.equal(ready.payload.catalog.selectedCurveId,curveId);
  send('willAppear','fan','fan',{settings:{tileId:testFan.id,mode:'percent'}});assert((await wait(e=>e.event==='setImage'&&e.context==='fan')).payload.image.startsWith('data:image/png;base64,'));
  send('keyDown','fan','fan');assert.equal((await wait(e=>e.event==='setSettings'&&e.context==='fan')).payload.mode,'rpm');
  send('keyDown','sensor','sensor');await wait(e=>e.event==='showOk'&&e.context==='sensor');
  send('willAppear','pause','command',{settings:{label:'Pause',command:'Pause'}});send('keyDown','pause','command');await wait(e=>e.event==='showOk'&&e.context==='pause');assert.equal(requests,2);
  send('willAppear','curve','curve',{settings:{curveId}});send('keyDown','curve','curve');await wait(e=>e.event==='showOk'&&e.context==='curve');
  send('propertyInspectorDidAppear','sensor','sensor');const catalog=await wait(e=>e.event==='sendToPropertyInspector');assert(catalog.payload.online);assert(catalog.payload.catalog.sensors.length>0);
  console.log('Verified: live Windows/NVIDIA sensors, token/origin checks, invalid bodies/curves, explicit unavailable pins, acknowledged OBS changes, sensor/command/curve Stream Deck keys.');socket.close();
 }finally{plugin?.kill();sd?.close();await suite.close();await controller.disconnect();mockObs.close();}
});
