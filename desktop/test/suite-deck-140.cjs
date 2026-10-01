'use strict';
process.env.BATTO_TEST_INSTANCE='1';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{WebSocketServer}=require('ws');
const {SuiteRuntime}=require('../src/services/suite-runtime.cjs'),{DualStream}=require('../src/dual-stream/service.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await pause(100);}throw Error('Deck response timed out');}
(async()=>{
 const output=process.env.BATTO_DECK_TEST_OUTPUT;if(!output)throw Error('Isolated output required');fs.mkdirSync(output,{recursive:true});const root=path.resolve(__dirname,'../..'),calls=[];
 const dual=new DualStream({directory:path.join(output,'dual'),executable:'not-used',safeStorage:{}});
 const suite=new SuiteRuntime({directory:output,fanRoot:'not-used',voiceCode:'not-used',voiceBundle:'not-used',obs:{},getDual:()=>dual,getHost:()=>({catalog:()=>({controls:[],items:[]}),navigate:view=>calls.push(view)})});
 suite.voice.send=job=>{calls.push(job);};suite.jarvis.update({voiceEnabled:false,microphoneEnabled:false});await suite.startServer();const headers={Authorization:'Bearer '+suite.token,'Content-Type':'application/json'},url='http://127.0.0.1:17666';
 const results=[];let child,server,creator;
 try{
  assert.equal((await fetch(url+'/api/catalog')).status,401);assert.equal((await fetch(url+'/api/control',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/control',{method:'POST',headers,body:JSON.stringify({action:'shell',text:'unsafe'})})).status,400);assert.equal((await fetch(url+'/api/control',{method:'POST',headers,body:'x'.repeat(9000)})).status,413);
  process.env.BATTO_TEST_BRIDGE=path.join(output,'bridge.json');process.env.FANATLAS_TEST_BRIDGE=path.join(output,'absent-fan-bridge.json');
  const messages=[];server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>server.once('listening',r));let socket;
  server.on('connection',s=>{socket=s;s.on('message',raw=>messages.push(JSON.parse(raw)));});
  child=spawn(path.join(root,'streamdeck/de.crazybatto.suite.sdPlugin/bin/FanAtlas.Deck.exe'),['-port',String(server.address().port),'-pluginUUID','TEST','-registerEvent','registerPlugin'],{windowsHide:true,stdio:'ignore',env:process.env});await until(()=>messages.some(m=>m.event==='registerPlugin'));
  const send=(event,context,kind,payload={})=>socket.send(JSON.stringify({event,context,action:'de.crazybatto.suite.'+kind,payload}));
  for(const [context,kind,settings]of [['listen','listen',{}],['scene','scene',{control:{action:'scene',target:'Pause',transition:'fade',durationMs:350}}],['combo','combo',{steps:[{action:'scene',target:'Spiel',transition:'cut',durationMs:100},{action:'navigate',target:'jarvis'}]}]]){
   send('willAppear',context,kind,{settings});await until(()=>messages.some(m=>m.event==='setImage'&&m.context===context));send('keyDown',context,kind);await until(()=>messages.some(m=>m.event==='showOk'&&m.context===context));results.push('Elgato protocol: '+kind);
  }
  assert(calls.some(x=>x?.command==='listen'));assert(calls.includes('jarvis'));assert.equal(dual.config.program.scene,'Spiel');assert.equal(dual.native,null);
  send('propertyInspectorDidAppear','scene','scene');await until(()=>messages.some(m=>m.event==='sendToPropertyInspector'));assert(messages.find(m=>m.event==='sendToPropertyInspector').payload.controls.actions.length>=24);
  const before=messages.filter(m=>m.event==='setImage').length;await pause(2300);const after=messages.filter(m=>m.event==='setImage').length;assert(after-before<=1,'unchanged keys are not rendered/sent repeatedly');
  child.kill();child=null;socket.close();await new Promise(r=>server.close(r));server=null;
  if(process.env.BATTO_CREATOR_REFERENCE){
   const {PluginHost,inspectPlugin}=require(process.env.BATTO_CREATOR_REFERENCE);creator=new PluginHost({settingsFile:path.join(output,'creator-settings.json')});const received=[];creator.onMessage(m=>received.push(m));await creator.start();const plugin=inspectPlugin(path.join(root,'streamdeck/de.crazybatto.suite.sdPlugin'));assert.equal(plugin.actions.length,8);await creator.launch(plugin);
   creator.willAppear(plugin.uuid,'creator-pause','de.crazybatto.suite.scene',{column:0,row:0},{label:'Pause',control:{action:'scene',target:'Pause',transition:'cut',durationMs:100}});await until(()=>received.some(m=>m.event==='setImage'&&m.context==='creator-pause'));creator.keyDown(plugin.uuid,'creator-pause','de.crazybatto.suite.scene');await until(()=>received.some(m=>m.event==='showOk'&&m.context==='creator-pause'));assert.equal(dual.config.program.scene,'Pause');results.push('Creator Hub 1.8.6 original plugin host: registration, image, settings, button, acknowledgement');await creator.stop();creator=null;
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks:results,authorization:true,boundedRequests:true,noCapture:true,cachedKeyImages:true},null,2));console.log(results.join('\n'));
 }finally{child?.kill();server?.close();if(creator)await creator.stop();await suite.close();await dual.release();}
})().catch(e=>{console.error(e);process.exitCode=1;});
