'use strict';
const testPort = Number(process.env.BATTO_QA_PORT || 28777);
// Explicit opt-in CI self-test. Never reads or changes the user's normal profile.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = process.env.BATTO_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'batto-qa-'));
fs.mkdirSync(dir, { recursive: true });
const profile = path.join(dir, 'isolated-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const {ConfigStore,DEFAULT_CONFIG}=require('../src/core/config-store.cjs');
const qaStore=new ConfigStore(profile);qaStore.commit(structuredClone(DEFAULT_CONFIG));
qaStore.merge({http:{port:testPort},obs:{autoConnect:false},navigation:{enabled:false},platforms:{tikfinity:{autoConnect:false,webWidgets:[]},twitch:{autoConnect:false},youtube:{autoConnect:false}},streamerbot:{autoConnect:false},community:{archive:{enabled:false},viewers:{enabled:false}}});
app.disableHardwareAcceleration();
const checks = [];
let finished = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch {}
    await delay(100);
  }
  throw new Error(`QA timeout: ${label}`);
}
function finish(ok, error) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok, checks, error: error?.message, versions: process.versions }, null, 2));
  if (!ok) { console.error(error); app.exit(1); }
  else { console.log('Installed Electron UI/IPC self-test passed.'); app.quit(); }
}
const timer = setTimeout(() => finish(false, new Error('Installed app QA exceeded 120 seconds')), 120000);
timer.unref();
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(request,done)=>done({cancel:!['127.0.0.1','localhost','[::1]'].includes(new URL(request.url).hostname)}));
  const win = await waitFor(() => BrowserWindow.getAllWindows()[0], 'main window');
  const run = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const fill=(selector,value)=>run(`const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing QA field: '+${JSON.stringify(selector)});const value=${JSON.stringify(value)};if(typeof value==='boolean')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await waitFor(() => run("return typeof S !== 'undefined' && !!S.config && !!document.querySelector('#composer');"), 'rendered app and IPC');
  checks.push('Fresh profile: main window and renderer ready');
  await waitFor(async () => (await run('return await window.batto.getState();')).overlay?.running, 'overlay HTTP server');
  const state = await run('return await window.batto.getState();');
  assert.equal(state.config.http.port, testPort);
  assert.equal(state.config.obs.url, 'ws://127.0.0.1:4455');
  checks.push(`Separate OBS 4455 / Overlay ${testPort}`);
  await waitFor(()=>run("return Array.from(document.images).every(img => img.complete && img.naturalWidth > 0);"),"Originalbilder dekodiert");
  await run("setView('dashboard');");
  checks.push('All visible branding images decoded');
  await run("document.querySelector('#sendPlatform').value='local'; document.querySelector('#messageInput').value='QA CHAT 2101'; document.querySelector('#composer').requestSubmit();");
  await waitFor(() => run("return document.querySelector('#chatList').textContent.includes('QA CHAT 2101');"), 'local chat render');
  checks.push('Composer -> IPC -> normalizer -> chat renderer');

  await run("document.querySelector('[data-view=commands]').click();document.querySelector('#commandsModule [data-new-rule]').click();");
  const commandForm='#commandsModule [data-rule-form]';
  await fill(commandForm+' [name=name]','QA Command');await fill(commandForm+' [name=trigger]','!qa');await fill(commandForm+' [data-rule-platform][value=cng]',true);await fill(commandForm+' [name=cooldownSeconds]',17);await fill(commandForm+' [data-new-step]','overlay');
  await run("document.querySelector('#commandsModule [data-add-step]').click();");
  assert.deepEqual(await run("const form=document.querySelector('#commandsModule [data-rule-form]');return {trigger:form.querySelector('[name=trigger]').value,platforms:[...form.querySelectorAll('[data-rule-platform]:checked')].map(input=>input.value),cooldown:Number(form.querySelector('[name=cooldownSeconds]').value)};"),{trigger:'!qa',platforms:['cng'],cooldown:17});
  await fill(commandForm+' [data-rule-step] [name=text]','QA command');
  await run("document.querySelector('#commandsModule [data-rule-form]').requestSubmit();");
  await waitFor(()=>run("return (await window.batto.getState()).config.commands.some(rule=>rule.name==='QA Command')&&!document.querySelector('#commandsModule [data-rule-form]');"),'Command saved and editor collapsed');
  const commandRule=(await run('return await window.batto.getState();')).config.commands.find(rule=>rule.name==='QA Command');
  assert.equal(commandRule.trigger,'!qa');assert.deepEqual(commandRule.platforms,['cng']);assert.equal(commandRule.cooldownSeconds,17);assert.equal(commandRule.actions[0].type,'overlay');assert.equal(commandRule.actions[0].text,'QA command');
  checks.push('Command builder retains trigger/platform/cooldown when adding actions');
  await run("document.querySelector('[data-view=events]').click();document.querySelector('#eventsModule [data-new-rule]').click();");
  const eventForm='#eventsModule [data-rule-form]';
  await fill(eventForm+' [name=name]','QA Event');await fill(eventForm+' [name=platform]','twitch');await fill(eventForm+' [name=event]','follow');await fill(eventForm+' [name=matchText]','tester');await fill(eventForm+' [name=minValue]',3);await fill(eventForm+' [data-new-step]','overlay');
  await run("document.querySelector('#eventsModule [data-add-step]').click();");
  assert.equal(await run("const form=document.querySelector('#eventsModule [data-rule-form]');return form.querySelector('[name=platform]').value+':'+form.querySelector('[name=matchText]').value+':'+form.querySelector('[name=minValue]').value;"),'twitch:tester:3');
  await fill(eventForm+' [data-rule-step] [name=text]','QA event');await fill(eventForm+' [data-rule-step] [name=eventType]','custom');
  await run("document.querySelector('#eventsModule [data-rule-form]').requestSubmit();");
  await waitFor(()=>run("return (await window.batto.getState()).config.events.some(rule=>rule.name==='QA Event')&&!document.querySelector('#eventsModule [data-rule-form]');"),'Event saved and editor collapsed');
  const eventRule = (await run('return await window.batto.getState();')).config.events.find(rule=>rule.name==='QA Event');
  assert.equal(eventRule.event,'follow');assert.equal(eventRule.platform,'twitch');assert.equal(eventRule.matchText,'tester');assert.equal(eventRule.minValue,3);assert.equal(eventRule.actions[0].type,'overlay');assert.equal(eventRule.actions[0].eventType,'custom');assert.equal(eventRule.actions[0].text,'QA event');
  checks.push('Event builder retains platform/filter/minimum and separates event/action type');

  await run("document.querySelector('[data-view=platforms]').click(); document.querySelector('#cngChatSecret').value='https://cng-plattform.com/chat-popout/210048?mode=obs&obsChatToken=qa-fixture-only'; await document.querySelector('#cngSave').onclick();");
  const afterSecret = await run('return await window.batto.getState();');
  assert.equal(afterSecret.secrets.cngObsChatUrl, true);
  assert.equal(JSON.stringify(afterSecret.config).includes('qa-fixture-only'), false);
  checks.push('CNG field -> safeStorage persists; no secret in settings');
  await run("document.querySelector('[data-view=settings]').click();");
  await waitFor(() => run("return !!document.querySelector('#stApply21');"), 'settings controls');
  assert.equal(await run("return document.querySelector('#settingsModule').textContent.includes('Sarah Luna');"), true);
  await run("document.querySelector('#stBgDark21').value='0.4'; await document.querySelector('#stApply21').onclick();");
  assert.equal((await run('return await window.batto.getState();')).config.appearance.backgroundDarkness, 0.4);
  checks.push('Settings Apply persists background control and retains dedication');
  await run("document.querySelector('[data-view=dashboard]').click();");
  await delay(300);
  fs.writeFileSync(path.join(dir, 'dashboard.png'), (await win.webContents.capturePage()).toPNG());
  const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'Batto-OBS-Tool', 'settings.json'), 'utf8'));
  assert.equal(persisted.appearance.backgroundDarkness, 0.4);
  checks.push('Settings written to disk; desktop screenshot captured');
  await require('./qa-release.cjs')({win,run,waitFor,checks,dir,profile});
  finish(true);
}).catch(error => finish(false, error));
