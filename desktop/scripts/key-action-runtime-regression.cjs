'use strict';
// Real application/UI/IPC/event pipeline. Only the final Windows output is
// intercepted. The isolated profile has no physical input bindings or services.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const electron=require('electron'),{spawn}=require('node:child_process');
const base=process.env.BATTO_KEY_ACTION_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'batto-key-action-'));
const phase=process.env.BATTO_KEY_ACTION_PHASE,profile=path.join(base,'profile'),wait=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(base,{recursive:true});
if(typeof electron==='string'){
 (async()=>{const phases=[];for(const p of ['save','restart']){
  const result=await new Promise((resolve,reject)=>{let stderr='';const child=spawn(electron,[__filename],{cwd:path.join(__dirname,'..'),windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,BATTO_KEY_ACTION_QA_DIR:base,BATTO_KEY_ACTION_PHASE:p}});
   child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>{child.kill();reject(Error('QA timeout '+p));},100000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);const report=path.join(base,p+'.json');if(!fs.existsSync(report))return reject(Error('QA report missing '+p+' '+code+' '+stderr.slice(-1500)));resolve(JSON.parse(fs.readFileSync(report,'utf8')));});});
  phases.push(result);if(!result.ok)break;
 }const result={ok:phases.length===2&&phases.every(p=>p.ok),environment:'Actual Electron bootstrap and isolated profile; external requests blocked; final Windows output intercepted',phases};fs.writeFileSync(path.join(base,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
 })().catch(e=>{console.error(e);process.exitCode=1;});
}else{
 const {app,BrowserWindow,session}=electron;app.setPath('userData',profile);app.disableHardwareAcceleration();process.argv.push('--batto-qa-key-actions');
 BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
 const report={ok:false,phase,checks:[],outputs:[],rendererErrors:[]};let ended=false;
 require('../src/core/action-engine.cjs').ActionEngine.prototype.hotkey=async function(action){report.outputs.push({keys:action.keys,keyFormat:action.keyFormat,process:action.process,holdMs:action.holdMs});return{ok:true,inputSent:false,confirmed:false,qaIntercepted:true};};
 app.on('web-contents-created',(_e,w)=>w.on('console-message',(_ev,level,message)=>{if(level===3&&!/ERR_BLOCKED_BY_CLIENT|Content Security Policy|Potential permissions policy violation/.test(message))report.rendererErrors.push(message);}));
 const read=()=>JSON.parse(fs.readFileSync(path.join(profile,'Batto-OBS-Tool','settings.json'),'utf8'));
 function finish(error){if(ended)return;ended=true;report.ok=!error;report.error=error?.stack;fs.writeFileSync(path.join(base,phase+'.json'),JSON.stringify(report,null,2));app.quit();setTimeout(()=>app.exit(error?1:0),2000).unref();}
 setTimeout(()=>finish(Error('Application QA timeout')),90000).unref();
 async function until(fn,label){const end=Date.now()+12000;while(Date.now()<end){const v=await fn();if(v)return v;await wait(40);}throw Error('Timeout: '+label);}
 if(phase==='save'){
  const store=new (require('../src/core/config-store.cjs').ConfigStore)(profile);
  store.merge({general:{startView:'hotkeys'},http:{enabled:false,autoStart:false},obs:{enabled:false,autoConnect:false},navigation:{enabled:false},windows:{detachedOpen:false},
   appearance:{programBackground:false,chatWidgets:{enabled:false,snowEnabled:false,likesEnabled:false,giftsEnabled:false,snowUrl:'',likesUrl:'',viewersUrl:'',giftsUrl:''}},platforms:{tikfinity:{autoConnect:false},twitch:{autoConnect:false},youtube:{autoConnect:false},cng:{autoOpenGhost:false}},streamerbot:{autoConnect:false},
   community:{archive:{enabled:false},viewers:{enabled:false}},autoBroadcast:{enabled:false,items:[]},hotkeys:[],keyActions:[],actionChains:[],commands:[],events:[],chatExtras:{widgets:[],wishlist:{enabled:false,items:[]}}});
 }
 app.whenReady().then(async()=>{try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_d,done)=>done({cancel:true}));
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window'),run=code=>win.webContents.executeJavaScript('(async()=>{'+code+'})()');
  async function capture(file){await win.webContents.capturePage();await wait(400);fs.writeFileSync(path.join(base,file),(await win.webContents.capturePage()).toPNG());}
  await until(async()=>{try{return await run("return typeof S!=='undefined'&&!!S.config;");}catch{return false;}},'renderer');
  await run("setView('hotkeys');");await until(()=>run("return !!$('#outputKeySave');"),'profile editor');
  const click=sel=>run('const el=document.querySelector('+JSON.stringify(sel)+');if(!el)throw Error("Missing control");el.click();');
  const fill=(sel,value)=>run('const el=document.querySelector('+JSON.stringify(sel)+');if(!el)throw Error("Missing field");const value='+JSON.stringify(value)+';if(typeof value==="boolean")el.checked=value;else el.value=String(value);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));');
  async function saveProfile(){await click('#outputKeySave');await until(()=>run("return /gespeichert/i.test($('#outputKeyStatus').textContent)&&!$('#outputKeySave').disabled;"),'saved profile');await wait(100);}
  let id;
  if(phase==='save'){
   await fill('#outputKeyName','K und Links');await fill('#outputKeyProcess','Batto-QA-target');await fill('#outputKeys','K+LButton');await fill('#outputKeyHold',100);await fill('#outputKeyEnabled',true);await saveProfile();
   assert.equal(read().keyActions.length,1);id=read().keyActions[0].id;await saveProfile();assert.equal(read().keyActions.length,1);assert.equal(read().keyActions[0].id,id);
   assert.equal(await run("return $('#outputKeys').value;"),'K+LButton');report.checks.push('Actual profile form saves K+LButton twice with stable ID and populated fields');
   const types=['follow','gift','like','share','subscribe','custom'];
   for(const type of types){
    await run("setView('events');");await click('[data-new-rule]');
    await fill('[data-rule-form] [name="name"]','QA '+type);await fill('[data-rule-form] [name="platform"]',type==='custom'?'all':'tiktok');await fill('[data-rule-form] [name="event"]',type);await fill('[data-rule-form] [name="cooldownSeconds"]',0);
    await fill('[data-link-key-action]',id);await click('[data-add-key-action]');
    assert.equal(await run("return document.querySelector('[data-rule-step] [name=keyActionId]').value;"),id);
    await run("document.querySelector('[data-rule-form]').requestSubmit();");await until(()=>read().events.some(e=>e.name==='QA '+type),'saved '+type);await until(()=>run("return !document.querySelector('[data-rule-form]');"),'collapsed editor');
   }
   assert(read().events.every(e=>e.actions[0].type==='key-action'&&e.actions[0].keyActionId===id));report.checks.push('Follow, Gift, Like, Share, Subscribe and Custom linked and saved through actual Events forms');
   for(const type of types){const before=report.outputs.length;await run('return api.testEvent('+JSON.stringify(type)+');');await until(()=>report.outputs.length===before+1,'event output '+type);assert.deepEqual(report.outputs.at(-1),{keys:'K+LButton',keyFormat:'chord',process:'Batto-QA-target',holdMs:100});}
   report.checks.push('All six events traverse actual EventCore and rule engine to exact K+LButton final output boundary');
   await run("setView('hotkeys');");await click('[data-output-key-edit="'+id+'"]');await fill('#outputKeyHold',125);await saveProfile();
   const before=report.outputs.length;await run("return api.testEvent('follow');");await until(()=>report.outputs.length===before+1,'updated profile event');assert.equal(report.outputs.at(-1).holdMs,125);report.checks.push('Central profile edit affects linked event without rewriting its actions');
   await fill('#outputKeyEnabled',false);await saveProfile();const blocked=await run('return api.testAutomationAction({type:"key-action",keyActionId:'+JSON.stringify(id)+'});');assert.equal(blocked.ok,false);assert.match(JSON.stringify(blocked),/deaktiviert/);assert.equal(report.outputs.length,before+1);
   await fill('#outputKeyEnabled',true);await saveProfile();report.checks.push('Disabled profile prevents native output with an explicit error; links remain saved');
   await run("setView('events');");await click('[data-rule-edit="'+read().events[0].id+'"]');await run("document.querySelector('[data-link-key-action]').scrollIntoView({block:'center'});");await capture('events.png');
  }else{
   const cfg=read();assert.equal(cfg.keyActions.length,1);assert.equal(cfg.events.length,6);id=cfg.keyActions[0].id;assert.equal(cfg.keyActions[0].keys,'K+LButton');
   await click('[data-output-key-edit="'+id+'"]');assert.equal(await run("return $('#outputKeys').value;"),'K+LButton');assert.equal(await run("return Number($('#outputKeyHold').value);"),125);
   await run("return api.testEvent('follow');");await until(()=>report.outputs.length===1,'restarted follow');assert.equal(report.outputs[0].keys,'K+LButton');assert.equal(report.outputs[0].holdMs,125);
   report.checks.push('Second actual application start reloads all references and Follow resolves current K+LButton profile');await run("document.querySelector('#keyActionsEditor').scrollIntoView({block:'start'});");await capture('hotkeys.png');
  }
  assert.equal(read().hotkeys.length,0,'QA never configures physical input bindings');assert.deepEqual(report.rendererErrors,[]);finish();
 }catch(error){finish(error);}}).catch(finish);
 require('../electron/bootstrap.cjs');
}
