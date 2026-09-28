'use strict';
// Opt-in desktop test; all settings and media belong to a separate test profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const dir = process.env.BATTO_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'batto-audio-qa-'));
fs.mkdirSync(dir, { recursive: true });
const profile = path.join(dir, 'isolated-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const wav = path.join(dir, 'Testton.wav');
const count = 11025, data = Buffer.alloc(44 + count * 2);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(22050, 24); data.writeUInt32LE(44100, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(count * 2, 40);
for (let i=0; i<count; i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 22050) * 2000 * Math.min(1,i/400,(count-i)/400)),44+i*2);
fs.writeFileSync(wav, data);
const store = new (require('../src/core/config-store.cjs').ConfigStore)(profile);
store.merge({ http:{port:Number(process.env.BATTO_QA_PORT || 29777)}, obs:{enabled:false,autoConnect:false}, navigation:{enabled:false},
  appearance:{programBackground:false},
  audioOutput:{mode:'app',deviceId:'default',deviceLabel:'Systemstandard',volume:.37},
  media:[{id:'qa-tone',name:'Testton.wav',type:'wav',path:wav}],
  events:[{id:'qa-join',name:'TikTok – Stream betreten: Audio',enabled:true,platform:'tiktok',event:'join',actions:[{type:'media',mediaId:'qa-tone'}]}]
});
const checks=[]; let finished=false;
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
function finish(ok,error) {
  if(finished)return; finished=true;
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ok,checks,error:error?.stack,version:app.getVersion()},null,2));
  if(error)console.error(error); else console.log('Audio desktop QA passed.');
  app.exit(ok?0:1);
}
setTimeout(()=>finish(false,new Error('Audio QA timeout')),90000).unref();
async function waitFor(fn,label) {
  const end=Date.now()+20000;
  while(Date.now()<end) { try { const r=await fn(); if(r)return r; }catch{} await sleep(100); }
  throw new Error('Timeout: '+label);
}
app.whenReady().then(async()=>{
  const win=await waitFor(()=>BrowserWindow.getAllWindows()[0],'main window');
  const run=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  await waitFor(()=>run("return typeof S!=='undefined' && !!S.config && !!window.BattoAudioOutputUI;"),'renderer');
  win.setSize(1440,1000);
  await run("setView('dashboard'); window.qaAudio=[]; window.batto.onAudioPlay(x=>qaAudio.push(x));");
  await waitFor(()=>run("return !!document.querySelector('[data-quick-audio-output] [data-audio-volume]');"),'dashboard output controls');
  assert.equal(await run("return document.querySelector('[data-quick-audio-output] [data-audio-volume]').value;"),'37');
  checks.push('Existing profile output settings populate dashboard');
  const controls="document.querySelector('[data-quick-audio-output]')";
  await run(`const host=${controls};host.querySelector('[data-audio-volume]').value='23';host.querySelector('[data-audio-volume]').dispatchEvent(new Event('input'));await host.querySelector('[data-audio-save]').onclick();`);
  assert.equal((await run('return (await batto.getState()).config.audioOutput;')).volume,.23);
  checks.push('Dashboard volume save persists through real IPC');
  await run(`await ${controls}.querySelector('[data-audio-test]').onclick();`);
  assert.match(await run(`return ${controls}.querySelector('[data-audio-status]').textContent;`),/Testton abgespielt/);
  checks.push('Actual HTMLAudio test tone completes at 23% volume');
  const devices=await run("return [...document.querySelector('[data-quick-audio-output] [data-audio-device]').options].map(x=>({id:x.value,label:x.textContent}));");
  checks.push({availableOutputs:devices.map(x=>x.label)});
  const chosen=devices.find(x=>!['default','communications'].includes(x.id));
  if(chosen) {
    const r=await run(`return await batto.testAudioOutput({mode:'app',deviceId:${JSON.stringify(chosen.id)},volume:0});`);
    assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(r.deviceId,chosen.id);
    checks.push('Non-default physical output accepted and playback completed: '+chosen.label);
  }
  const eventResult=await run("qaAudio.length=0;return await batto.testAutomationSequence({actions:[{type:'media',mediaId:'qa-tone',volume:.5}],timeoutMs:5000});");
  assert.equal(eventResult.ok,true,JSON.stringify(eventResult));
  const played=await run('return qaAudio;');assert.equal(played.length,1);assert.equal(played[0].volume,.115);
  checks.push('Event sound plays without OBS client; per-action gain multiplies master gain');
  await run('await batto.detachChat();');
  const detached=await waitFor(()=>BrowserWindow.getAllWindows().find(x=>x!==win),'detached chat');
  await waitFor(()=>detached.webContents.executeJavaScript("typeof S!=='undefined' && !!S.config"),'detached ready');
  await detached.webContents.executeJavaScript('window.qaAudio=[];batto.onAudioPlay(x=>qaAudio.push(x));void 0;');
  await run("qaAudio.length=0;await batto.testAutomationAction({type:'media',mediaId:'qa-tone'});");
  assert.equal(await run('return qaAudio.length;'),1);assert.equal(await detached.webContents.executeJavaScript('qaAudio.length'),0);
  checks.push('Main and detached chat open: one audio playback, no duplicate');
  await run('await batto.closeDetached();');
  const failure=await run("return await batto.testAutomationAction({type:'media',mediaId:'missing'});");
  assert.equal(failure.ok,false);checks.push('Missing event file reports failure');
  await run(`const host=${controls};host.querySelector('[data-audio-volume]').value='0';await host.querySelector('[data-audio-save]').onclick();`);
  assert.equal((await run('return (await batto.getState()).config.audioOutput;')).volume,0);
  await run(`const host=${controls};host.querySelector('[data-audio-volume]').value='23';await host.querySelector('[data-audio-save]').onclick();host.scrollIntoView({block:'center'});`);
  await sleep(300);
  fs.writeFileSync(path.join(dir,'dashboard.png'),(await win.webContents.capturePage()).toPNG());
  await run("setView('broadcast');");
  await waitFor(()=>run("return !!document.querySelector('#bcFirst');"),'broadcast editor');
  await run("await document.querySelector('#bcFirst').onclick();document.querySelector('#bcName').value='Audio-Test';document.querySelector('[data-bc-message]').value='Lokaler Audiotest';document.querySelectorAll('[data-bc-target]').forEach(x=>x.checked=x.dataset.bcTarget==='local');document.querySelector('#bcSound').value='qa-tone';await document.querySelector('#bcForm').onsubmit({preventDefault(){}});");
  const item=(await run('return (await batto.getState()).config.autoBroadcast.items;'))[0];
  assert.equal(item.soundMediaId,'qa-tone');
  await run("qaAudio.length=0;await document.querySelector('#bcTest').onclick();");
  assert.match(await run("return document.querySelector('#bcTestResult').textContent;"),/Ton: erfolgreich/);
  assert.equal(await run('return qaAudio.length;'),1);
  checks.push('Broadcast sound selected, saved and tested once after local chat output');
  await run("document.querySelector('#bcSound').scrollIntoView({block:'center'});");await sleep(200);
  fs.writeFileSync(path.join(dir,'broadcast.png'),(await win.webContents.capturePage()).toPNG());
  await run("setView('settings');");
  await waitFor(()=>run("return !!document.querySelector('#settingsModule [data-audio-output-settings]');"),'settings audio controls');
  assert.equal(await run("return document.querySelector('#settingsModule [data-audio-volume]').value;"),'23');
  await run("const h=document.querySelector('#settingsModule [data-audio-output-settings]');h.querySelector('[data-audio-mode]').value='obs';h.querySelector('[data-audio-mode]').dispatchEvent(new Event('change'));await h.querySelector('[data-audio-save]').onclick();");
  assert.equal(await run("return document.querySelector('#settingsModule [data-audio-device]').disabled;"),true);
  assert.equal((await run('return (await batto.getState()).config.audioOutput;')).mode,'obs');
  await run("const h=document.querySelector('#settingsModule [data-audio-output-settings]');h.querySelector('[data-audio-mode]').value='app';await h.querySelector('[data-audio-save]').onclick();");
  checks.push('Shared settings panel reflects saved output and OBS mode disables device selection');
  const persisted=new (require('../src/core/config-store.cjs').ConfigStore)(profile).get();
  assert.equal(persisted.audioOutput.volume,.23);assert.equal(persisted.audioOutput.mode,'app');assert.equal(persisted.autoBroadcast.items[0].soundMediaId,'qa-tone');
  checks.push('New ConfigStore instance reloads saved device, volume and broadcast sound');
  finish(true);
}).catch(e=>finish(false,e));
