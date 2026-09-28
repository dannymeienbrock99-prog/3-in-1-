'use strict';
// Actual Chromium DOM + actual automation-ui.js. Only the native capture response
// is controlled here; no hook, physical input, action or live connection is started.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!app)throw Error('Run with Electron.');
const dir=process.env.BATTO_CAPTURE_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'batto-capture-ui-'));
fs.mkdirSync(dir,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(dir,'profile-')));app.disableHardwareAcceleration();
const checks=[];let win;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(code){return win.webContents.executeJavaScript(`(async()=>{${code}})()`);}
async function waitFor(code,label){for(let i=0;i<100;i++){if(await run(code))return;await sleep(30);}throw Error('Timeout: '+label);}
function finish(ok,error){fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ok,checks,error:error?.stack,environment:'Hidden real Chromium DOM; actual automation-ui.js; controlled native replies; no physical hooks or actions'},null,2));console.log(ok?'Hotkey capture DOM regression passed.':error.stack);app.exit(ok?0:1);}
app.whenReady().then(async()=>{try{
 win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 await win.loadURL('data:text/html,<main><div id="hotkeysModule"></div><div id="settingsModule"></div></main>');
 await run(`
  window.$=selector=>document.querySelector(selector);window.esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.qaId=0;window.cryptoId=()=>('qa-'+(++qaId));window.toasts=[];window.toast=(message,error)=>toasts.push({message,error});window.confirm=()=>true;
  window.S={config:{hotkeys:[],actionChains:[{id:'qa-chain',name:'QA',actions:[{type:'delay',ms:1}],enabled:false}],media:[],mediaPools:[]}};
  window.renderSettingsModule=()=>{};window.renderHotkeysModule=()=>{};window.saved=[];window.actions=0;window.captureCalls=0;window.cancelCalls=0;
  window.api={hotkeyStatus:async()=>[],hotkeyCapture:()=>{captureCalls++;return new Promise((resolve,reject)=>{window.captureResolve=resolve;window.captureReject=reject;});},hotkeyCancelCapture:async()=>{cancelCalls++;},triggerChain:async()=>{actions++;return{ok:true,result:{ok:true}};},cancelAllAutomations:async()=>{actions++;}};
  window.saveAndSync=async patch=>{saved.push(structuredClone(patch));Object.assign(S.config,structuredClone(patch));};
 `);
 await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../src/renderer/automation-ui.js'),'utf8'));
 await run("renderHotkeysModule();$('#inputKey').value='K+RButton';$('#inputKey').dispatchEvent(new Event('input'));$('#inputEnabled').checked=false;");
 await run("window.recordRun=$('#inputRecord').onclick();");
 assert.equal(await run("return $('#inputSave').disabled&&$('#inputTest').disabled&&$('#inputKey').disabled&&!$('#inputCancelRecord').disabled;"),true);
 await run("await $('#inputSave').onclick();await $('#inputTest').onclick();");
 assert.equal(await run('return saved.length+actions;'),0);
 await run("captureResolve({ok:true,accelerator:'Control+A+B'});await recordRun;");
 assert.equal(await run("return $('#inputKey').value;"),'Control+A+B');
 assert.equal(await run("return $('#inputSave').disabled||$('#inputTest').disabled||$('#inputKey').disabled;"),false);
 checks.push('Recording locks save/test/field; direct handlers also reject; complete multi-key capture retained');
 for(const accelerator of ['', 'Control+Shift']){
  await run("window.recordRun=$('#inputRecord').onclick();");
  await run(`captureResolve({ok:true,accelerator:${JSON.stringify(accelerator)}});await recordRun;`);
  assert.equal(await run("return $('#inputKey').value;"),'Control+A+B');
  assert.equal(await run("return $('#inputSave').disabled;"),false);
 }
 checks.push('Empty and modifier-only capture responses retain prior combination and restore controls');
 await run("window.recordRun=$('#inputRecord').onclick();captureResolve({ok:true,accelerator:'LButton'});setTimeout(()=>$('#inputCancelRecord').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})),10);await recordRun;");
 assert.equal(await run("return $('#inputKey').value;"),'Control+A+B');
 assert.match(await run("return $('#inputRecordStatus').textContent;"),/beendet/);
 checks.push('Native mouse result arriving before Cancel DOM pointerdown cannot replace prior keys');
 await run("window.recordRun=$('#inputRecord').onclick();document.dispatchEvent(new CustomEvent('batto:view',{detail:'dashboard'}));renderHotkeysModule();captureResolve({ok:true,accelerator:'RButton'});await recordRun;");
 assert.equal(await run("return $('#inputKey').value;"),'Control+A+B');
 checks.push('Navigation cancels capture; late reply cannot overwrite re-rendered draft');
 await run("$('#inputKey').value='Control+A';$('#inputMouse').value='RButton';$('#inputAddMouse').click();$('#inputAddMouse').click();");
 assert.equal(await run("return $('#inputKey').value;"),'Control+A+RButton');
 assert.match(await run("return $('#inputMouse').selectedOptions[0].textContent;"),/Rechte Maustaste/);
 checks.push('Named right-mouse selection appends without losing keyboard partners or duplicating it');
 await run("$('#inputKey').value='';await $('#inputSave').onclick();");
 assert.equal(await run('return saved.length;'),0);assert.match(await run("return $('#inputValidation').textContent;"),/zuerst eine Kombination/);
 await run("$('#inputKey').value='Control';await $('#inputSave').onclick();");
 assert.equal(await run('return saved.length;'),0);assert.match(await run("return $('#inputValidation').textContent;"),/noch eine Taste/);
 checks.push('Empty/modifier-only save stopped before persistence with inline feedback');
 await run("$('#chainType').value='hotkey';$('#chainType').dispatchEvent(new Event('change'));$('#stepProcess').value='Own QA.exe';$('#stepKeys').value='K+RButton';$('#stepKeys').dispatchEvent(new Event('input'));$('#stepRecord').click();");
 assert.equal(await run("return $('#chainAdd').disabled&&$('#chainSave').disabled&&!$('#stepCancelRecord').disabled;"),true);
 await run("await $('#chainAdd').onclick();captureResolve({ok:true,accelerator:'LButton'});setTimeout(()=>$('#stepCancelRecord').dispatchEvent(new PointerEvent('pointerdown')),10);");
 await waitFor("return !$('#chainAdd').disabled;",'step capture cancelled');
 assert.equal(await run("return $('#stepKeys').value;"),'K+RButton');
 await run("$('#stepRecord').click();captureResolve({ok:true,accelerator:'A+B'});");
 await waitFor("return !$('#chainAdd').disabled;",'step capture completed');
 assert.equal(await run("return $('#stepKeys').value;"),'A+B');assert.equal(await run("return $('#stepKeyFormat').value;"),'chord');
 await run("$('#chainType').value='delay';$('#chainType').dispatchEvent(new Event('change'));$('#chainType').value='hotkey';$('#chainType').dispatchEvent(new Event('change'));");
 assert.equal(await run("return $('#stepKeys').value;"),'A+B');
 assert.equal(await run('return saved.length+actions;'),0);
 checks.push('Chain step capture locks Apply/Save, handles same Cancel race, retains full chord across type switch');
 await run("$('#inputKey').value='Control+UnknownKey';window.originalSave=saveAndSync;window.saveAndSync=async()=>{throw Error(\"Error invoking remote method 'config:save': Error: Hotkey QA: Taste nicht erkannt.\");};await $('#inputSave').onclick();");
 assert.equal(await run("return $('#inputKey').value;"),'Control+UnknownKey');
 assert.equal(await run("return $('#inputValidation').textContent;"),'Hotkey QA: Taste nicht erkannt.');
 assert.equal(await run("return $('#inputSave').disabled;"),false);
 checks.push('Backend save failure preserves the draft, restores Save and displays the actual reason without IPC prefix');
 await run("$('#inputKey').value='F8';window.saveCalls=0;window.saveAndSync=patch=>{saveCalls++;return new Promise(resolve=>{window.finishSave=()=>{Object.assign(S.config,structuredClone(patch));resolve();};});};window.firstSave=$('#inputSave').onclick();window.secondSave=$('#inputSave').onclick();");
 assert.equal(await run('return saveCalls;'),1);
 assert.equal(await run("return $('#inputSave').disabled;"),true);
 await run('finishSave();await Promise.all([firstSave,secondSave]);');
 assert.equal(await run("return $('#inputKey').value;"),'F8');
 assert.equal(await run('return S.config.hotkeys.length;'),1);
 checks.push('Concurrent Save is submitted once; successful save keeps selected populated binding');
 finish(true);
}catch(error){finish(false,error);}});
