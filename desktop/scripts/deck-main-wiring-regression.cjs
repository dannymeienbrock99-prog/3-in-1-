'use strict';
// Run with Electron: electron scripts/deck-main-wiring-regression.cjs
// Optional --reproduce-old-scope loads the SAME main entry with only the helper
// moved back into initCore in memory. The red run must report the original error.
// No production module, save callback, WebSocket server or IPC is substituted.
const {app,BrowserWindow,session,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),assert=require('node:assert/strict'),Module=require('node:module');
const WebSocket=require('ws');
if(!app)throw new Error('Use Electron to run this actual-main regression.');
const oldScope=process.argv.includes('--reproduce-old-scope');
const dir=process.env.BATTO_DECK_MAIN_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'batto-deck-main-'));
fs.mkdirSync(dir,{recursive:true});
const profile=fs.mkdtempSync(path.join(dir,'profile-'));
app.setPath('userData',profile);app.disableHardwareAcceleration();
process.argv.push('--batto-qa-main-wiring'); // disable external catalogue fetching
// Keep genuine app windows hidden, including its ready-to-show handler.
BrowserWindow.prototype.show=function(){};
BrowserWindow.prototype.showInactive=function(){};
const checks=[],acks=[],rendererErrors=[];let ws,finished=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,label){const end=Date.now()+20000;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await sleep(80);}throw Error('Timeout: '+label);}
function finish(ok,error){
 if(finished)return;finished=true;ws?.terminate();
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ok,mode:oldScope?'old-scope-reproduction':'current-main',version:require('../package.json').version,entry:'electron/bootstrap.cjs → electron/main21.cjs',profile,checks,acks,rendererErrors,error:error?.stack,isolation:'Fresh profile; external HTTP blocked; actual localhost WebSocket; no platform messages or input actions'},null,2));
 console.log(ok?'Actual main Stream Deck wiring regression passed.':error?.stack);
 app.quit();setTimeout(()=>app.exit(ok?0:1),3000).unref();
}
setTimeout(()=>finish(false,Error('Actual main wiring regression timed out')),90000).unref();
app.on('web-contents-created',(_event,wc)=>wc.on('console-message',(_e,level,message)=>{
 if(level===3&&!/ERR_BLOCKED_BY_CLIENT|Content Security Policy|Potential permissions policy violation/i.test(message))rendererErrors.push(message);
}));
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}

function loadRealEntry(){
 if(oldScope){
  const mainFile=require.resolve('../electron/main21.cjs');
  const original=Module._extensions['.cjs']||Module._extensions['.js'];
  Module._extensions['.cjs']=function(module,filename){
   if(filename!==mainFile)return original(module,filename);
   const code=fs.readFileSync(filename,'utf8');
   const helper=/function saveCommunityConfig\(patch\) \{\r?\n[\s\S]*?\r?\n\}/;
   const found=code.match(helper);assert.ok(found,'module-scoped helper is present for exact scope reproduction');
   const regressed=code.replace(helper,'').replace('function initCore() {','function initCore() {\n'+found[0]);
   module._compile(regressed,filename);
  };
 }
 require('../electron/bootstrap.cjs');
}

(async()=>{
 const port=await freePort();
 const {ConfigStore}=require('../src/core/config-store.cjs');
 const config=new ConfigStore(profile);
 config.merge({http:{enabled:false,autoStart:false},obs:{enabled:false,autoConnect:false},navigation:{enabled:true,port,focus:false},windows:{detachedOpen:false},general:{startView:'dashboard'},
  appearance:{programBackground:false,chatWidgets:{enabled:true,snowEnabled:false,likesEnabled:false,giftsEnabled:false,snowUrl:'',likesUrl:'',viewersUrl:'',giftsUrl:''}},
  platforms:{tikfinity:{autoConnect:false},twitch:{autoConnect:false},youtube:{autoConnect:false},cng:{autoOpenGhost:false}},streamerbot:{autoConnect:false},
  community:{archive:{enabled:false},viewers:{enabled:false,tiktok:false,twitch:false}},autoBroadcast:{enabled:false,items:[]},hotkeys:[],commands:[],events:[],actionChains:[],chatExtras:{widgets:[],wishlist:{enabled:false,items:[]}}});
 app.whenReady().then(async()=>{
  try{
   session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>{let host='';try{host=new URL(details.url).hostname;}catch{}done({cancel:!['127.0.0.1','localhost'].includes(host)});});
   const win=await waitFor(()=>BrowserWindow.getAllWindows()[0],'real main window');
   const run=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
   await waitFor(()=>run("return typeof S!=='undefined'&&!!S.config;"),'real renderer');
   assert.ok(await run("return /index\\.html/.test(location.href)&&document.body.textContent.includes('Multi-Chat');"));
   await run("setView('dashboard');window.__deckNotifications=[];batto.onConfigChanged(c=>window.__deckNotifications.push(c));");
   const {SecretsService}=require('../src/core/settings/secrets-service.cjs');
   const secrets=new SecretsService({userDataPath:profile,safeStorage});
   const token=await waitFor(()=>secrets.get('navigation-token'),'real main navigation token');
   ws=await waitFor(()=>new Promise(resolve=>{const client=new WebSocket('ws://127.0.0.1:'+port);client.once('open',()=>resolve(client));client.once('error',()=>{client.terminate();resolve(null);});}),'real navigation server');
   let state;
   const pending=new Map();
   ws.on('message',bytes=>{const message=JSON.parse(bytes);if(message.type==='state')state=message;if(message.type==='ack'){const done=pending.get(message.id);if(done){pending.delete(message.id);done(message);}}});
   ws.send(JSON.stringify({type:'auth',token}));
   await waitFor(()=>state?.ready,'actual navigation UI-ready state');
   checks.push('Actual bootstrap/main21 started; real renderer and authenticated navigation WebSocket ready');
   let number=0;
   async function rpc(target,op){
    const id='main-wiring-'+(++number);
    const reply=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('No control reply: '+target));},5000);pending.set(id,value=>{clearTimeout(timer);resolve(value);});ws.send(JSON.stringify({type:'control',id,target,op,args:{}}));});
    acks.push({target,op,ok:reply.ok,state:reply.state,error:reply.error});return reply;
   }
   const controls=[['overlay.snow','on',true,false],['overlay.likeBar','on',true,true],['overlay.snow','off',false,true],['overlay.likeBar','toggle',false,false]];
   for(const [target,op,snow,likes] of controls){
    const before=await run('return window.__deckNotifications.length;');
    const reply=await rpc(target,op);
    assert.equal(reply.ok,true,reply.error||target+' did not persist');
    assert.equal(reply.states['overlay.snow'],snow);assert.equal(reply.states['overlay.likeBar'],likes);
    await waitFor(()=>run(`return window.__deckNotifications.length>${before}&&S.config.appearance.chatWidgets.snowEnabled===${snow}&&S.config.appearance.chatWidgets.likesEnabled===${likes};`),'renderer config notification '+target);
    assert.equal(await run('return window.__deckNotifications.length;'),before+1,'one config notification per control');
    const disk=new ConfigStore(profile).get();assert.equal(disk.appearance.chatWidgets.snowEnabled,snow);assert.equal(disk.appearance.chatWidgets.likesEnabled,likes);
    assert.equal(disk.autoBroadcast.enabled,false);assert.deepEqual(disk.hotkeys,[]);assert.deepEqual(disk.events,[]);
    const actual=await run('return await batto.getState();');assert.equal(actual.settings.dirty,false);assert.equal(actual.settings.validation.ok,true);
    assert.equal(actual.config.appearance.chatWidgets.snowEnabled,snow);assert.equal(actual.config.appearance.chatWidgets.likesEnabled,likes);
    await waitFor(()=>state?.controls?.['overlay.snow']===snow&&state?.controls?.['overlay.likeBar']===likes,'updated WebSocket state');
   }
   checks.push('Snow and likes on/off/toggle use real main callback; each persists on disk, preserves sibling setting, sends one config notification and updated WebSocket state');
   const snapshot=JSON.stringify(new ConfigStore(profile).get().appearance.chatWidgets);
   const before=await run('return window.__deckNotifications.length;');
   assert.equal((await rpc('overlay.unknown','on')).ok,false);assert.equal((await rpc('overlay.snow','invalid')).ok,false);
   assert.equal(JSON.stringify(new ConfigStore(profile).get().appearance.chatWidgets),snapshot);assert.equal(await run('return window.__deckNotifications.length;'),before);
   const rejected=await new Promise((resolve,reject)=>{const client=new WebSocket('ws://127.0.0.1:'+port);const timer=setTimeout(()=>{client.terminate();reject(Error('Unauthenticated request was not rejected'));},5000);client.on('open',()=>client.send(JSON.stringify({type:'control',id:'unauth',target:'overlay.snow',op:'on'})));client.on('close',code=>{clearTimeout(timer);resolve(code);});client.on('error',reject);});
   assert.equal(rejected,1008);assert.equal(JSON.stringify(new ConfigStore(profile).get().appearance.chatWidgets),snapshot);
   checks.push('Unknown target, invalid operation and unauthenticated control do not modify settings');
   const viewer=await rpc('viewerCount.enabled','on');assert.equal(viewer.ok,true,viewer.error);assert.equal(new ConfigStore(profile).get().community.viewers.enabled,true);
   await waitFor(()=>run('return S.config.community.viewers.enabled===true;'),'community config notification');
   assert.equal((await rpc('viewerCount.enabled','off')).ok,true);assert.equal(new ConfigStore(profile).get().community.viewers.enabled,false);
   checks.push('Community viewer control also persists through the actual shared main helper');
   const unchanged=await run('return await batto.settingsApply();');assert.equal(unchanged.ok,true);assert.equal(unchanged.config.appearance.chatWidgets.snowEnabled,false);assert.equal(unchanged.config.appearance.chatWidgets.likesEnabled,false);
   checks.push('A subsequent clean Settings Apply retains Stream Deck changes');
   assert.deepEqual(rendererErrors,[]);
   finish(true);
  }catch(error){finish(false,error);}
 });
 loadRealEntry();
})().catch(error=>finish(false,error));
