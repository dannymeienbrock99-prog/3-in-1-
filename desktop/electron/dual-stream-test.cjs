'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const output=process.env.BATTO_SUITE_TEST_OUTPUT;if(!output||process.env.BATTO_TEST_INSTANCE!=='1')throw Error('Isolated test output required');fs.mkdirSync(output,{recursive:true});
 const win=require('./main21.cjs').getMainWindow(),js=s=>win.webContents.executeJavaScript(s),checks=[],errors=[];let fixture;
 const check=async(name,code)=>{assert(await js('(async()=>('+code+'))()'),name);checks.push(name);};
 async function until(code){for(let n=0;n<100;n++){if(await js(code))return;await delay(150);}throw Error('Timeout: '+code);}
 async function capture(name){win.webContents.invalidate();await delay(200);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
 win.webContents.on('console-message',(_e,level,text)=>{if(level>=3&&!/ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(text))errors.push(text);});
 try{
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));await delay(2500);win.setSize(1600,1000);win.showInactive();await js('setView("dualstream")');await until('!!document.getElementById("dual-save") && !document.getElementById("dual-save").disabled');
  await until('document.getElementById("dual-readiness").textContent.includes("Video-Dienst aus")');
  await check('new native sender page, no automatic capture','/Batto/i.test(document.title) && document.getElementById("dual-readiness").textContent.includes("Video-Dienst aus")');
  await check('no fake live state or unlocked start without keys','document.getElementById("dual-start-both").disabled && document.getElementById("dual-status-tiktok").textContent === "Aus"');
  await js('document.querySelector("[data-view=dualstream]").scrollIntoView({block:"nearest"});document.getElementById("dual-layer").value="camera";document.getElementById("dual-layer").dispatchEvent(new Event("change"));document.getElementById("dual-width").value="35";document.getElementById("dual-width").dispatchEvent(new Event("change"));document.getElementById("dual-save").click()');await until('document.getElementById("dual-dirty").textContent==="Gespeichert"&&!document.getElementById("dual-save").disabled');
  await check('persistent independent canvas settings','(await window.batto.dual("state")).config.layouts.tiktok[1].width===.35 && (await window.batto.dual("state")).config.layouts.twitch[1].width===.25');
  await capture('Dual-Stream-1600');
  await js('document.getElementById("dual-canvas").scrollIntoView({block:"center"})');await delay(200);
  const pos=await js('(()=>{const r=document.querySelector("[data-dual-source=camera]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),before:Number(document.getElementById("dual-x").value)}})()');
  win.webContents.sendInputEvent({type:'mouseDown',x:pos.x,y:pos.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:pos.x-22,y:pos.y+12,movementX:-22,movementY:12});win.webContents.sendInputEvent({type:'mouseUp',x:pos.x-22,y:pos.y+12,button:'left',clickCount:1});await delay(200);
  await check('drag repositions selected layer',`Number(document.getElementById('dual-x').value)<${pos.before}`);
  await js('document.getElementById("dual-save").click()');await until('document.getElementById("dual-dirty").textContent==="Gespeichert"&&!document.getElementById("dual-save").disabled');
  await capture('Dual-Stream-Editor');
  await js('document.getElementById("dual-tab-twitch").click()');await check('canvas switch changes aspect ratio and independent inspector','document.getElementById("dual-width").value==="25.0" && document.getElementById("dual-canvas").classList.contains("twitch")');
  await js('document.getElementById("dual-key-twitch").value="local-test-only-secret";document.getElementById("dual-key-save-twitch").click()');await until('document.getElementById("dual-key-state-twitch").textContent.includes("gespeichert")');
  await check('key is cleared from form and absent from public state','!document.getElementById("dual-key-twitch").value && !JSON.stringify(await window.batto.dual("state")).includes("local-test-only-secret")');
  await js('document.getElementById("dual-key-clear-twitch").click()');await until('document.getElementById("dual-key-state-twitch").textContent.includes("fehlt")');
  win.setSize(1180,800);await delay(250);await capture('Dual-Stream-1180');
  await check('no horizontal overflow','document.getElementById("content").scrollWidth<=document.getElementById("content").clientWidth+2');
  await js('document.getElementById("dual-probe").click()');await until('document.getElementById("dual-message").textContent.includes("erkannt") && !document.getElementById("dual-probe").disabled');
  await check('native device scan releases its process','!!(await window.batto.dual("state")).probe.encoder && !(await window.batto.dual("state")).engineRunning');
  // Capture only our own synthetic window; no user desktop, camera or microphone.
  fixture=new BrowserWindow({width:800,height:500,show:false,webPreferences:{backgroundThrottling:false}});
  await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Batto Dual Stream Aufnahme Test</title><body style="margin:0;background:#164065;color:#f4ca74;font:40px sans-serif;padding:40px"><h1>Lokaler Aufnahmetest</h1><p>Gemeinsame Quelle · zwei Leinwände</p><canvas width="100" height="40"></canvas><script>setInterval(()=>document.body.style.borderLeft=(30+Math.random()*40)+"px solid #e5bc63",100)</script>'));
  fixture.showInactive();await delay(800);
  const service=require('../src/dual-stream/bootstrap.cjs').getService();await service.serial(()=>service.probe());
  const target=service.probeResult.devices.window.find(x=>x.name.includes('Batto Dual Stream Aufnahme Test'));assert(target,'synthetic window listed by native capture');
  await js(`document.getElementById('dual-kind').value='window';document.getElementById('dual-kind').dispatchEvent(new Event('change'));document.getElementById('dual-target-game').value=${JSON.stringify(target.id)};document.getElementById('dual-target-game').dispatchEvent(new Event('change'));document.getElementById('dual-source-game').checked=true;document.getElementById('dual-source-game').dispatchEvent(new Event('change'));document.getElementById('dual-prepare').click()`);
  await until('document.getElementById("dual-message").textContent.includes("Quellen vorbereitet") && !document.getElementById("dual-preview").disabled');await delay(2000);
  await js('document.getElementById("dual-preview").click()');await until('!!document.querySelector("#dual-canvas > img")');
  await check('real native preview is displayed, outputs remain stopped','document.querySelector("#dual-canvas > img").src.startsWith("data:image/png;base64,") && (await window.batto.dual("state")).state.outputs.twitch.state==="stopped"');
  const shot=await service.serial(()=>service.image('twitch'));fs.writeFileSync(path.join(output,'capture-fixture.png'),Buffer.from(shot.image.split(',')[1],'base64'));
  fixture.hide();win.showInactive();await js('document.getElementById("dual-canvas").scrollIntoView({block:"center"})');await capture('Dual-Stream-Vorschaubild');
  await js('document.getElementById("dual-start-both").scrollIntoView({block:"end"})');await capture('Dual-Stream-Sendeziele');
  await js('document.getElementById("dual-release").click()');await until('!(document.getElementById("dual-readiness").textContent.includes("eingeschaltet"))');
  await check('native resources released by user control','!(await window.batto.dual("state")).engineRunning');
  await js('setView("dashboard")');await check('existing widget saving mode remains active','!document.querySelector("iframe[src]")');
  assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));
 }catch(e){fs.writeFileSync(path.join(output,'error.txt'),e.stack+'\n'+errors.join('\n'));process.exitCode=1;}
 finally{fixture?.destroy();await require('../src/dual-stream/bootstrap.cjs').getService()?.release();await require('../src/suite-bootstrap.cjs').getRuntime()?.close();app.exit(process.exitCode||0);}
});
