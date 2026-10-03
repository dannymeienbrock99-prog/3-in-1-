'use strict';
// Isolated acceptance flow: synthetic readings and no microphone, camera or public chat sends.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const output=process.env.BATTO_SUITE_TEST_OUTPUT;if(!output||process.env.BATTO_TEST_INSTANCE!=='1')throw Error('Isolated test directory required');fs.mkdirSync(output,{recursive:true});
 const host=require('./main21.cjs'),touch=require('../src/touch-bootstrap.cjs');let win=host.getMainWindow(),phone;
 const checks=[],errors=[];checks.push=(...items)=>{Array.prototype.push.apply(checks,items);fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify(checks));return checks.length;};const watchdog=setTimeout(()=>{fs.writeFileSync(path.join(output,'error.txt'),'Test timed out after: '+checks.join(' / '));app.exit(1);},90000);const js=code=>win.webContents.executeJavaScript(code);
 async function until(code){for(let i=0;i<100;i++){if(await js(code))return;await pause(100);}throw Error('Timeout: '+code+' / '+await js('document.getElementById("td-message")?.textContent'));}
 async function click(id){await js(`document.getElementById(${JSON.stringify(id)}).click()`);await pause(70);}
 async function input(id,value,event='input'){await js(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);}
 async function capture(name,target=win){target.webContents.invalidate();await pause(220);fs.writeFileSync(path.join(output,name+'.png'),(await target.webContents.capturePage()).toPNG());}
 try{
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));await pause(2200);win.setSize(1600,1000);win.showInactive();
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3&&!/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(message))errors.push(message);});
  assert.equal(touch.getExistingDeck(),undefined);checks.push('Touch Deck is not constructed before first use');
  const windowCount=BrowserWindow.getAllWindows().length;await js('setView("touchdeck")');await until('!!document.getElementById("td-mode")');
  const deck=touch.getDeck(),runtime=require('../src/suite-bootstrap.cjs').getRuntime(),dual=require('../src/dual-stream/bootstrap.cjs').getService();
  assert.equal(BrowserWindow.getAllWindows().length,windowCount);assert.equal(deck.mobileStatus().running,false);assert.equal(runtime.voice.child,null);checks.push('integrated page creates no second window, microphone or network listener');
  const initialMetrics=app.getAppMetrics().map(m=>({type:m.type,workingSetKiB:m.memory.workingSetSize}));
  await capture('Touch-Deck-1600');
  await js('document.querySelector("[data-td-key=\\"3\\"]").click()');await until('document.getElementById("td-message").textContent.includes("ausgeführt")');assert.equal(dual.config.program.scene,'Pause');assert.equal(dual.native?.child||dual.child||null,null);checks.push('default Pause key changes real Batto scene without starting capture');
  await click('td-mode');await click('td-profile-add');await input('td-profile-name','Mein Stream');
  await js('document.querySelector("[data-td-key=\\"0\\"]").click()');await pause(80);await click('td-create-action');await input('td-title','Pause + still');
  await js('(()=>{const e=document.querySelector("[data-td-step=\\"0\\"][data-td-field=action]");e.value="scene";e.dispatchEvent(new Event("change"));})()');
  await js('(()=>{const e=document.querySelector("[data-td-step=\\"0\\"][data-td-field=target]");e.value="Pause";e.dispatchEvent(new Event("change"));})()');
  await click('td-step-add');await js('(()=>{const e=document.querySelector("[data-td-step=\\"1\\"][data-td-field=action]");e.value="speech-stop";e.dispatchEvent(new Event("change"));})()');
  await click('td-save');await until('document.getElementById("td-dirty").textContent==="Gespeichert"');
  let current=deck.config.profiles.find(p=>p.name==='Mein Stream');assert.equal(current.buttons[0].steps.length,2);checks.push('profile and two-step key saved through actual UI and disk');
  await input('td-title','Entwurf behalten');await js('setView("jarvis");setView("touchdeck")');assert.equal(await js('document.getElementById("td-title").value'),'Entwurf behalten');checks.push('view navigation preserves unsaved touch form');await click('td-save');
  await input('td-move-target','1','change');await click('td-move');await click('td-save');current=deck.config.profiles.find(p=>p.name==='Mein Stream');assert.equal(current.buttons[0],null);assert.equal(current.buttons[1].title,'Entwurf behalten');checks.push('keyboard-friendly move swaps existing positions');
  await js('document.querySelector("[data-td-key=\\"0\\"]").click()');await pause(70);await click('td-create-folder');await input('td-title','Unterwegs');await click('td-folder-open');
  await js('document.querySelector("[data-td-key=\\"0\\"]").click()');await pause(70);await click('td-create-action');await input('td-title','Fenster öffnen');
  await js('(()=>{const e=document.querySelector("[data-td-step=\\"0\\"][data-td-field=action]");e.value="show";e.dispatchEvent(new Event("change"));})()');await click('td-save');
  current=deck.config.profiles.find(p=>p.name==='Mein Stream');assert.equal(current.buttons[0].buttons[0].steps[0].action,'show');checks.push('nested folder key persists');
  await capture('Touch-Deck-Editor-1600');win.setSize(1180,800);await pause(200);await capture('Touch-Deck-Editor-1180');assert(await js('document.getElementById("content").scrollWidth<=document.getElementById("content").clientWidth+2'));checks.push('editor fits minimum supported window width');
  const config=deck.snapshot();current=config.profiles.find(p=>p.name==='Mein Stream');current.buttons[2]={id:'qa-reading',type:'sensor',title:'UI-Testwert',sensorId:'qa-only',symbol:'◴'};deck.getSensors=()=>[{id:'qa-only',name:'UI-Testwert',value:42.5,unit:'°C'}];deck.save(config);
  await js('document.querySelector("[data-td-crumb=\\"0\\"]")?.click()');await click('td-mode');
  // Return to a freshly loaded, saved deck so the test does not depend on breadcrumb internals.
  await win.webContents.reload();await pause(1500);await js('setView("touchdeck")');await until('document.querySelector("[data-td-key=\\"2\\"]")?.textContent.includes("42,5")');
  let snapshots=0;const sensorRead=deck.sensors.bind(deck);deck.sensors=()=>{snapshots++;return sensorRead();};await pause(3400);assert(snapshots>=1);await js('setView("dashboard")');await pause(200);const hidden=snapshots;await pause(3300);assert.equal(snapshots,hidden);checks.push('sensor refresh stops completely while Touch Deck is hidden');
  await js('setView("touchdeck")');await until('!!document.getElementById("td-mobile-toggle")');await js('document.querySelector(".td-mobile-panel").open=true');await click('td-mobile-toggle');await until('document.querySelector(".td-pin")?.textContent.length===6');
  const mobile=deck.mobileStatus(),url=`http://127.0.0.1:${mobile.port}`;
  phone=new BrowserWindow({width:420,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await phone.loadURL(url);phone.showInactive();
  const pjs=code=>phone.webContents.executeJavaScript(code);await pjs(`document.getElementById('pin').value=${JSON.stringify(mobile.pin)};document.getElementById('pair-form').requestSubmit()`);for(let i=0;i<50&&await pjs('document.getElementById("deck").hidden');i++)await pause(100);
  assert.equal(await pjs('document.getElementById("deck").hidden'),false,await pjs('document.getElementById("status").textContent'));checks.push('real mobile browser page pairs using PIN');
  await capture('Touch-Deck-Handy',phone);assert(await pjs('document.documentElement.scrollWidth<=window.innerWidth'));checks.push('phone layout has no horizontal overflow');
  const token=await pjs('sessionStorage.getItem("batto-touch-session")');await pjs('document.querySelector("[data-index=\\"1\\"]").click()');await pause(400);assert((await pjs('document.getElementById("status").textContent')).includes('ausgeführt'));checks.push('phone executes persisted multi-action through real SuiteControls');
  await pjs('document.getElementById("disconnect").click()');await pause(200);assert.equal(deck.mobileStatus().clients,0);checks.push('disconnect releases the paired server session');
  await pjs(`document.getElementById('pin').value=${JSON.stringify(mobile.pin)};document.getElementById('pair-form').requestSubmit()`);await pause(250);deck.rotatePin();await pause(3300);assert.equal(await pjs('document.getElementById("deck").hidden'),true);checks.push('rotated PIN disconnects already paired phone');
  phone.destroy();phone=null;checks.push('phone window released');
  const pair=await fetch(url+'/api/pair',{signal:AbortSignal.timeout(8000),method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:deck.mobileStatus().pin})}).then(r=>r.json());
  checks.push('Node mobile session paired');await runtime.controls.execute({action:'gaming'});await pause(600);assert(win.isDestroyed());assert.equal(BrowserWindow.getAllWindows().length,0);checks.push('Gaming released all windows');
  const response=await fetch(url+'/api/press',{signal:AbortSignal.timeout(8000),method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},body:JSON.stringify({profileId:current.id,path:[],index:1,buttonId:current.buttons[1].id,baseRevision:deck.revision})}).then(r=>r.json());assert(response.ok);assert.equal(dual.config.program.scene,'Pause');checks.push('phone actions work with every desktop window released in Gaming mode');
  await runtime.controls.execute({action:'show'});checks.push('Show action resolved');win=host.getMainWindow();await pause(500);await js('setView("touchdeck")');await until('!!document.getElementById("td-mode")');checks.push('returning from Gaming restores saved Touch Deck');
  await deck.mobileStop();assert.equal(deck.mobileStatus().running,false);assert.equal(runtime.voice.child,null);assert.equal(errors.length,0,errors.join('\n'));clearTimeout(watchdog);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors,initialMetrics,actualPhoneTested:false},null,2));app.quit();
 }catch(error){phone?.destroy();fs.writeFileSync(path.join(output,'error.txt'),error.stack+'\n'+errors.join('\n'));app.exit(1);}
});
