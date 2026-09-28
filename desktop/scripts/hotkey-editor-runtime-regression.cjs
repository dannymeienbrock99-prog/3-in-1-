'use strict';
// node scripts/hotkey-editor-runtime-regression.cjs
// Two real Electron starts use the actual bootstrap, preload, UI and config IPC.
// All saved hotkeys are disabled. No physical input, action execution or user profile is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const electron=require('electron');
const {spawn}=require('node:child_process');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const phase=process.env.BATTO_HOTKEY_EDITOR_PHASE;
const base=process.env.BATTO_HOTKEY_EDITOR_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'batto-hotkey-editor-'));
fs.mkdirSync(base,{recursive:true});
const profile=path.join(base,'fresh-profile');
const resultsFile=path.join(base,'result.json');
const combos=['F8','Control+F8','K+RButton','A+B'];
const seed={id:'fixture-existing',name:'Saved fixture',accelerator:'LButton',enabled:false,scope:'app',triggerMode:'up',passthrough:true,debounceMs:450,chainId:'fixture-chain',stopAll:false};

if(typeof electron==='string'){
 (async()=>{
  const phases=[];
  for(const next of ['edit-save','restart']){
   const previousReport=path.join(base,next+'.json');if(fs.existsSync(previousReport))fs.unlinkSync(previousReport);
   const result=await new Promise((resolve,reject)=>{
    const child=spawn(electron,[__filename],{cwd:path.join(__dirname,'..'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BATTO_HOTKEY_EDITOR_QA_DIR:base,BATTO_HOTKEY_EDITOR_PHASE:next}});
    let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.on('data',()=>{});
    const timer=setTimeout(()=>{child.kill();reject(Error('Isolated Electron phase timed out: '+next));},90000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);const file=path.join(base,next+'.json');if(!fs.existsSync(file))return reject(Error('No phase report: '+next+' (exit '+code+') '+stderr.slice(-1500)));const r=JSON.parse(fs.readFileSync(file,'utf8'));resolve(r);});
   });
   phases.push(result);if(!result.ok)break;
  }
  const result={ok:phases.length===2&&phases.every(p=>p.ok),entry:'electron/bootstrap.cjs',profile,phases};
  fs.writeFileSync(resultsFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
 })().catch(error=>{fs.writeFileSync(resultsFile,JSON.stringify({ok:false,error:error.stack},null,2));console.error(error.stack);process.exitCode=1;});
}else{
 const {app,BrowserWindow,session,ipcMain}=electron;
 if(!['edit-save','restart'].includes(phase))throw Error('Run this regression with node, not directly with Electron.');
 app.setPath('userData',profile);app.disableHardwareAcceleration();process.argv.push('--batto-qa-hotkey-editor-runtime');
 BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};
 const report={ok:false,phase,checks:[],saveInvocations:0,actionInvocations:0,rendererErrors:[]};let finished=false;
 // Observe the actual IPC boundary; every original callback still handles its request.
 const nativeHandle=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,listener)=>nativeHandle(channel,(...args)=>{
  if(channel==='config:save')report.saveInvocations++;
  if(/^(chains:trigger|automation:testAction|automation:test|automation:action:test|hotkeys:capture)$/.test(channel))report.actionInvocations++;
  return listener(...args);
 });
 app.on('web-contents-created',(_event,wc)=>wc.on('console-message',(_e,level,message)=>{
  if(level===3&&!/ERR_BLOCKED_BY_CLIENT|Content Security Policy|Potential permissions policy violation/i.test(message))report.rendererErrors.push(message);
 }));
 const read=()=>JSON.parse(fs.readFileSync(path.join(profile,'Batto-OBS-Tool','settings.json'),'utf8'));
 function finish(error){
  if(finished)return;finished=true;report.ok=!error;report.error=error?.stack;
  try{report.finalHotkeys=read().hotkeys.map(({id,name,accelerator,enabled,scope,triggerMode,debounceMs,chainId})=>({id,name,accelerator,enabled,scope,triggerMode,debounceMs,chainId}));}catch{}
  fs.writeFileSync(path.join(base,phase+'.json'),JSON.stringify(report,null,2));
  app.quit();setTimeout(()=>app.exit(error?1:0),2500).unref();
 }
 setTimeout(()=>finish(Error('Electron UI regression timed out')),80000).unref();
 async function until(check,label){const end=Date.now()+15000;while(Date.now()<end){const result=await check();if(result)return result;await wait(40);}throw Error('Timeout: '+label);}
 if(phase==='edit-save'){
  const {ConfigStore}=require('../src/core/config-store.cjs');const config=new ConfigStore(profile);
  config.merge({http:{enabled:false,autoStart:false},obs:{enabled:false,autoConnect:false},navigation:{enabled:false},windows:{detachedOpen:false},general:{startView:'hotkeys'},
   appearance:{programBackground:false,chatWidgets:{enabled:false,snowEnabled:false,likesEnabled:false,giftsEnabled:false,snowUrl:'',likesUrl:'',viewersUrl:'',giftsUrl:''}},
   platforms:{tikfinity:{autoConnect:false},twitch:{autoConnect:false},youtube:{autoConnect:false},cng:{autoOpenGhost:false}},streamerbot:{autoConnect:false},
   community:{archive:{enabled:false},viewers:{enabled:false,tiktok:false,twitch:false}},autoBroadcast:{enabled:false,items:[]},hotkeys:[seed],commands:[],events:[],
   actionChains:[{id:'fixture-chain',name:'Harmless fixture chain',enabled:false,queueMode:'queue',failurePolicy:'stop-sequence',actions:[{type:'delay',ms:0}]}],
   chatExtras:{widgets:[],wishlist:{enabled:false,items:[]}}});
 }
 app.whenReady().then(async()=>{
  try{
   session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_details,done)=>done({cancel:true}));
   const win=await until(()=>BrowserWindow.getAllWindows()[0],'actual app window');
   const run=code=>win.webContents.executeJavaScript('(async()=>{'+code+'})()');
   await until(async()=>{try{return await run("return typeof S!=='undefined'&&!!S.config;");}catch{return false;}},'renderer config loaded');
   await run("setView('hotkeys');");await until(()=>run("return !!document.getElementById('inputSave');"),'actual hotkey editor');
   const values=()=>run("return {name:$('#inputKeyName').value,accelerator:$('#inputKey').value,scope:$('#inputScope').value,mode:$('#inputMode').value,debounce:Number($('#inputDebounce').value),chain:$('#inputChain').value,enabled:$('#inputEnabled').checked};");
   const fill=async(fields)=>run('const fields='+JSON.stringify(fields)+";for(const [id,value]of Object.entries(fields)){const el=document.getElementById(id);if(!el)throw Error('Missing editor field '+id);if(typeof value==='boolean')el.checked=value;else el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));}");
   const click=selector=>run('const button=document.querySelector('+JSON.stringify(selector)+');if(!button)throw Error("Missing button");button.click();');
   async function save(){
    const before=report.saveInvocations;await click('#inputSave');await until(()=>report.saveInvocations===before+1,'one actual config:save invocation');
    await until(()=>run("return !$('#inputSave').disabled;"),'save button available');await wait(100);
    assert.equal(report.saveInvocations,before+1);
   }
   if(phase==='restart'){
    const rows=read().hotkeys;assert.equal(rows.length,5);assert.deepEqual(rows.map(k=>k.accelerator).sort(),['LButton',...combos].sort());assert(rows.every(k=>k.enabled===false));
    await click('[data-key-edit="fixture-existing"]');assert.deepEqual(await values(),{name:'Renamed fixture',accelerator:'LButton',scope:'app',mode:'up',debounce:450,chain:'fixture-chain',enabled:false});
    const before=rows;await save();assert.deepEqual(read().hotkeys,before,'Restarted app saves the selected entry without duplicate, reset or list reordering');assert.equal((await values()).accelerator,'LButton');
    report.checks.push('Second actual Electron start reloads all five combinations and saved metadata; saving selected entry still retains one stable ID');
   }else{
    const initial=JSON.stringify(read().hotkeys),before=report.saveInvocations;
    await click('#inputSave');await wait(150);assert.equal(report.saveInvocations,before,'Empty form must not call config:save');assert.equal(JSON.stringify(read().hotkeys),initial);
    const feedback=await run("return {text:$('#inputValidation').textContent,focused:document.activeElement.id};");
    assert.match(feedback.text,/Kombination|Taste/i);assert.equal(feedback.focused,'inputKey');
    report.checks.push('Empty save is rejected by the real UI before any save IPC, with inline feedback and focus on the combination');
    await click('[data-key-edit="fixture-existing"]');assert.deepEqual(await values(),{name:seed.name,accelerator:seed.accelerator,scope:seed.scope,mode:seed.triggerMode,debounce:seed.debounceMs,chain:seed.chainId,enabled:false});
    for(let i=0;i<3;i++){await save();assert.equal(read().hotkeys.length,1);assert.equal(read().hotkeys[0].id,seed.id);assert.equal((await values()).accelerator,'LButton','Saved editor must remain selected and filled');assert.equal((await values()).name,seed.name);}
    const beforeDouble=report.saveInvocations;await run("const button=$('#inputSave');button.click();button.click();");await until(()=>report.saveInvocations===beforeDouble+1,'double click one save');await until(()=>run("return !$('#inputSave').disabled;"),'double click save ended');await wait(150);assert.equal(report.saveInvocations,beforeDouble+1);assert.equal(read().hotkeys.length,1);
    await fill({inputKeyName:'Renamed fixture'});await save();assert.equal(read().hotkeys.length,1);assert.equal(read().hotkeys[0].name,'Renamed fixture');assert.equal(read().hotkeys[0].id,seed.id);
    report.checks.push('Editing existing LButton, saving three times and double-clicking Save preserves populated fields and one stable ID; rename updates the same entry');
    for(const combo of combos){
     await click('#inputNew');await fill({inputKeyName:'Fixture '+combo,inputKey:combo,inputScope:'app',inputMode:'down',inputChain:'fixture-chain',inputEnabled:false});await save();
     const item=read().hotkeys.find(x=>x.accelerator===combo);assert(item);assert.equal(item.enabled,false);assert.equal((await values()).accelerator,combo);assert.equal((await values()).name,'Fixture '+combo);
     const count=read().hotkeys.length;await save();assert.equal(read().hotkeys.length,count);assert.equal(read().hotkeys.find(x=>x.accelerator===combo).id,item.id);
    }
    assert.equal(read().hotkeys.length,5);report.checks.push('F8, Control+F8, K+RButton and A+B persist through real IPC; immediate repeated Save never creates duplicates or clears the form');
    await click('#inputNew');await fill({inputKeyName:'Missing chain',inputKey:'F9',inputEnabled:false});
    await run("const el=$('#inputChain');const option=document.createElement('option');option.value='missing-chain';option.textContent='Previously removed chain';el.append(option);el.value='missing-chain';el.dispatchEvent(new Event('input',{bubbles:true}));");
    const beforeMissing=report.saveInvocations,snapshot=JSON.stringify(read().hotkeys);await click('#inputSave');await wait(150);
    assert.equal(report.saveInvocations,beforeMissing,'Missing chain is rejected before save IPC');assert.equal(JSON.stringify(read().hotkeys),snapshot);assert.match(await run("return $('#inputValidation').textContent;"),/Aktionskette/);
    report.checks.push('A stale selection for a missing chain is rejected inline and cannot alter saved hotkeys');
    await fill({inputKey:'NotAKey',inputChain:'fixture-chain'});const beforeInvalid=report.saveInvocations;await click('#inputSave');await until(()=>report.saveInvocations===beforeInvalid+1,'real backend invalid-key validation');
    await until(()=>run("return !$('#inputSave').disabled && /Taste nicht erkannt/.test($('#inputValidation').textContent);"),'backend error inline');assert.equal(JSON.stringify(read().hotkeys),snapshot);assert.equal((await values()).accelerator,'NotAKey');
    report.checks.push('Actual backend rejection of an unknown key appears inline, preserves the draft and releases the Save button');
    for(const selected of [false,true]){
     await click('#inputNew');await fill({inputKeyName:'Delete fixture',inputKey:'F10',inputChain:'fixture-chain',inputEnabled:false,inputScope:'app'});await save();const extra=read().hotkeys.find(k=>k.accelerator==='F10');assert(extra);
     if(!selected){await click('#inputNew');await fill({inputKeyName:'Unrelated draft',inputKey:'F11',inputEnabled:false});}
     const beforeDelete=report.saveInvocations;await click('[data-key-delete="'+extra.id+'"]');await until(()=>report.saveInvocations===beforeDelete+1&&read().hotkeys.length===5,'delete disabled fixture');
     await until(async()=>{const form=await values();return form.accelerator===(selected?'':'F11')&&form.name===(selected?'':'Unrelated draft');},'delete IPC finished updating editor');
     assert.equal((await values()).accelerator,selected?'':'F11');assert.equal((await values()).name,selected?'':'Unrelated draft');
    }
    report.checks.push('Deleting a different disabled entry preserves the unsaved draft; deleting the selected entry clears its editor');
   }
   assert.equal(report.actionInvocations,0,'No chain test, capture or automation invocation');assert.deepEqual(report.rendererErrors,[]);
   assert(read().hotkeys.every(k=>k.enabled===false),'No global or mouse hook registration enabled');
   report.checks.push('All hotkeys remain disabled; no action/capture IPC or external requests; actual user settings untouched');finish();
  }catch(error){finish(error);}
 });
 require('../electron/bootstrap.cjs');
}
