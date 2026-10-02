'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const output=process.env.BATTO_SUITE_TEST_OUTPUT;if(!output||process.env.BATTO_TEST_INSTANCE!=='1')throw Error('Isolated test output required');fs.mkdirSync(output,{recursive:true});
 let win=require('./main21.cjs').getMainWindow(),js=s=>win.webContents.executeJavaScript(s),checks=[],errors=[];let fixture;
 const check=async(name,code)=>{assert(await js('(async()=>('+code+'))()'),name);checks.push(name);};
 async function until(code){for(let n=0;n<100;n++){if(await js(code))return;await delay(150);}throw Error('Timeout: '+code+' / '+await js('document.getElementById("dual-message")?.textContent'));}
 async function capture(name){win.webContents.invalidate();await delay(200);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
 win.webContents.on('console-message',(_e,level,text)=>{if(level>=3&&!/ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(text))errors.push(text);});
 try{
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));await delay(2500);win.setSize(1600,1000);win.showInactive();await js('setView("dualstream")');await until('!!document.getElementById("dual-save") && !document.getElementById("dual-save").disabled');
  await until('document.getElementById("dual-readiness").textContent.includes("Video-Dienst aus")');
  await check('new native sender page, no automatic capture','/Batto/i.test(document.title) && document.getElementById("dual-readiness").textContent.includes("Video-Dienst aus")');
  await check('virtual camera starts need no stream key','!document.getElementById("dual-start-both").disabled && !document.getElementById("dual-key-twitch") && document.getElementById("dual-status-tiktok").textContent === "Aus"');
  await check('camera fills entire top region','(await window.batto.dual("state")).config.layouts.tiktok[1].width===1 && (await window.batto.dual("state")).config.layouts.tiktok[1].height===.48');
  await js('document.getElementById("dual-canvas").scrollIntoView({block:"center"})');await capture('Kamera-oben-1600');
  await js('document.querySelector("[data-view=dualstream]").scrollIntoView({block:"nearest"});document.getElementById("dual-layer").value="camera";document.getElementById("dual-layer").dispatchEvent(new Event("change"));document.getElementById("dual-width").value="35";document.getElementById("dual-width").dispatchEvent(new Event("change"));document.getElementById("dual-save").click()');await until('document.getElementById("dual-dirty").textContent==="Gespeichert"&&!document.getElementById("dual-save").disabled');
  await check('persistent independent canvas settings','(await window.batto.dual("state")).config.layouts.tiktok[1].width===.35 && (await window.batto.dual("state")).config.layouts.twitch[1].width===.25');
  await capture('Dual-Stream-1600');
  await js('document.getElementById("dual-canvas").scrollIntoView({block:"center"})');await delay(200);
  const pos=await js('(()=>{const r=document.querySelector("[data-dual-source=camera]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),before:Number(document.getElementById("dual-x").value)}})()');
  win.webContents.sendInputEvent({type:'mouseDown',x:pos.x,y:pos.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:pos.x+22,y:pos.y+12,movementX:22,movementY:12});win.webContents.sendInputEvent({type:'mouseUp',x:pos.x+22,y:pos.y+12,button:'left',clickCount:1});await delay(200);
  await check('drag repositions selected layer',`Number(document.getElementById('dual-x').value)>${pos.before}`);
  await js('document.getElementById("dual-save").click()');await until('document.getElementById("dual-dirty").textContent==="Gespeichert"&&!document.getElementById("dual-save").disabled');
  await capture('Dual-Stream-Editor');
  await js('document.getElementById("dual-tab-twitch").click()');await check('canvas switch changes aspect ratio and independent inspector','document.getElementById("dual-width").value==="25.0" && document.getElementById("dual-canvas").classList.contains("twitch")');
  await js('document.getElementById("dual-template").click()');await delay(100);await js('document.getElementById("dual-save").click()');await until('document.getElementById("dual-dirty").textContent==="Gespeichert"&&!document.getElementById("dual-save").disabled');
  await check('template restores full width independently','(await window.batto.dual("state")).config.layouts.tiktok[1].width===1 && (await window.batto.dual("state")).config.layouts.twitch[1].width===.25');
  win.setSize(1180,800);await delay(250);await capture('Dual-Stream-1180');
  await check('no horizontal overflow','document.getElementById("content").scrollWidth<=document.getElementById("content").clientWidth+2');
  await js('document.getElementById("dual-probe").click()');await until('document.getElementById("dual-message").textContent.includes("erkannt") && !document.getElementById("dual-probe").disabled');
  await check('native device scan releases its process','(await window.batto.dual("state")).probe.virtualCameras.tiktok.ready && !(await window.batto.dual("state")).engineRunning');
  // Capture only our own synthetic window; no user desktop, camera or microphone.
  fixture=new BrowserWindow({width:800,height:500,show:false,webPreferences:{backgroundThrottling:false}});
  await fixture.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Batto Dual Stream Aufnahme Test</title><body style="margin:0;background:#164065;color:#f4ca74;font:40px sans-serif;padding:40px"><h1>Lokaler Aufnahmetest</h1><p>Gemeinsame Quelle · zwei Leinwände</p><canvas width="100" height="40"></canvas><script>setInterval(()=>document.body.style.borderLeft=(30+Math.random()*40)+"px solid #e5bc63",100)</script>'));
  fixture.showInactive();await delay(800);
  const service=require('../src/dual-stream/bootstrap.cjs').getService();let previewCalls=0;const image=service.image.bind(service);service.image=async p=>{previewCalls++;return image(p);};await service.serial(()=>service.probe());
  const target=service.probeResult.devices.window.find(x=>x.name.includes('Batto Dual Stream Aufnahme Test'));assert(target,'synthetic window listed by native capture');
  await js(`document.getElementById('dual-kind').value='window';document.getElementById('dual-kind').dispatchEvent(new Event('change'));document.getElementById('dual-target-game').value=${JSON.stringify(target.id)};document.getElementById('dual-target-game').dispatchEvent(new Event('change'));document.getElementById('dual-source-game').checked=true;document.getElementById('dual-source-game').dispatchEvent(new Event('change'))`);
  await until('document.getElementById("dual-message").textContent.includes("Quelle eingeschaltet") && !document.getElementById("dual-preview").disabled');await delay(2000);
  await until('!!document.querySelector("#dual-canvas > img")');
  await check('real native preview is displayed, outputs remain stopped','document.querySelector("#dual-canvas > img").src.startsWith("data:image/png;base64,") && (await window.batto.dual("state")).state.outputs.twitch.state==="stopped"');
  const visibleBefore=previewCalls;await delay(2500);assert(previewCalls>visibleBefore);checks.push('enabling source automatically starts sparse preview');
  await js('setView("dashboard")');await delay(300);const hiddenBefore=previewCalls;await delay(2100);assert.equal(previewCalls,hiddenBefore);checks.push('preview performs no capture while its view is hidden');
  await js('setView("dualstream")');await delay(1400);assert(previewCalls>hiddenBefore);
  await js('document.getElementById("dual-auto-preview").click()');await delay(300);const pausedBefore=previewCalls;await delay(1500);assert.equal(previewCalls,pausedBefore);checks.push('preview can be paused explicitly');await js('document.getElementById("dual-auto-preview").click()');
  const shot=await service.serial(()=>service.image('twitch'));fs.writeFileSync(path.join(output,'capture-fixture.png'),Buffer.from(shot.image.split(',')[1],'base64'));
  fixture.hide();win.showInactive();await js('document.getElementById("dual-canvas").scrollIntoView({block:"center"})');await capture('Dual-Stream-Vorschaubild');
  await js('document.getElementById("dual-start-both").scrollIntoView({block:"end"})');await capture('Dual-Stream-Sendeziele');
  await js('document.getElementById("dual-start-both").click()');await until('document.getElementById("dual-status-tiktok").textContent==="Kamera läuft" && document.getElementById("dual-status-twitch").textContent==="Kamera läuft"');
  await delay(800);assert(service.running()&&!service.live());checks.push('two keyless cameras running without public live flag');
  await capture('Virtuelle-Kameras');
  await js('document.getElementById("dual-stop-tiktok").click()');await until('document.getElementById("dual-status-tiktok").textContent==="Aus" && !document.getElementById("dual-stop-both").disabled');
  await check('independent camera stop','document.getElementById("dual-status-twitch").textContent==="Kamera läuft"');
  await js('document.getElementById("dual-stop-both").click()');await until('document.getElementById("dual-status-twitch").textContent==="Aus" && !document.getElementById("dual-release").disabled');
  await js('document.getElementById("dual-release").click()');await until('!(document.getElementById("dual-readiness").textContent.includes("eingeschaltet"))');
  await check('native resources released by user control','!(await window.batto.dual("state")).engineRunning');
  await js('setView("jarvis")');await delay(250);
  await check('simple Jarvis view hides detailed settings','!document.getElementById("j-events-likeThreshold").getClientRects().length');
  await js('document.getElementById("j-settings-toggle").click();document.getElementById("j-events-likeThreshold").value="7500";document.getElementById("j-save-events").click()');await until('(window.batto.suite("state").then(s=>s.jarvis.settings.events.likeThreshold===7500))');
  await check('Jarvis event settings persist and original moderator default survives','(await window.batto.suite("state")).jarvis.settings.events.likeThreshold===7500 && (await window.batto.suite("state")).jarvis.settings.chatMode==="moderators"');
  await js('document.getElementById("j-events-likeThreshold").scrollIntoView({block:"center"})');await capture('Jarvis-Ereignisse');
  await js('document.getElementById("j-settings-toggle").click();document.getElementById("content").scrollTop=0');await capture('Jarvis-Fragen');
  await check('deck catalog covers scenes, sources, bot, actions and all views','(await window.batto.suite("catalog")).actions.length>=24');
  await js('window.batto.suite("control",{steps:[{action:"scene",target:"Pause",transition:"cut",durationMs:100},{action:"navigate",target:"dualstream"}]})');
  await check('combined deck action changes native scene without opening OBS or starting capture','(await window.batto.dual("state")).config.program.scene==="Pause" && !(await window.batto.dual("state")).engineRunning');
  await js('document.getElementById("dual-scene").scrollIntoView({block:"center"})');await capture('Szenen-Uebergaenge');
  await js('window.batto.suite("control",{action:"companion",op:"on"})');await check('LIVE Studio live flag is explicit and leaves own capture off','(await window.batto.dual("state")).companionLive && !(await window.batto.dual("state")).engineRunning');await js('window.batto.suite("control",{action:"companion",op:"off"})');
  await js('setView("dashboard")');await check('existing widget saving mode remains active','!document.querySelector("iframe[src]")');
  await check('Jarvis default address is empty','(await window.batto.suite("state")).jarvis.settings.address===""');
  const runtime=require('../src/suite-bootstrap.cjs').getRuntime(), helperPid=runtime.fan.child?.pid;
  fixture.destroy();fixture=null;process.env.BATTO_DUAL_TEST='1';await service.serial(async()=>{const native=await service.client();service.state=await native.request('test-prepare',{config:service.nativeConfig()});await service.start('both');});
  await js('setView("dualstream")');await delay(300);
  await js('window.batto.suite("control",{action:"control",target:"chatWindow.detached",op:"on"})');await delay(900);
  // Exercise the real button and the close events of BOTH windows.
  await js('document.getElementById("dual-gaming").click()');await delay(1800);
  assert(win.isDestroyed());assert(require('./main21.cjs').getGamingMode());assert.equal(runtime.fan.child?.pid,helperPid);checks.push('Gaming releases renderer and preserves sensor helper');const cameraState=await service.serial(()=>service.native.request('status'));assert(Object.values(cameraState.outputs).every(x=>x.state==='camera'&&x.frames>10));checks.push('Gaming keeps both cameras producing frames without any browser window');const sound=await require('./main21.cjs').getAudioOutputForTest().play({testTone:true,volume:0,deviceId:'default'});assert(sound.ok);await delay(5600);assert.equal(BrowserWindow.getAllWindows().length,0);checks.push('silent notification playback works in Gaming and releases its player');
  await runtime.controls.execute({action:'navigate',target:'dualstream'});win=require('./main21.cjs').getMainWindow();await delay(900);
  await check('Stream Deck restores window with saved layout','S.view==="dualstream" && (await window.batto.dual("state")).config.layouts.tiktok[1].width===1');
  const restoredWindows=BrowserWindow.getAllWindows();assert.equal(restoredWindows.length,2);checks.push('Gaming restores detached chat as well as main window');
  const host=require('./main21.cjs').getSuiteHost();host.gaming();host.gaming();await host.show();await delay(400);assert(!win.isDestroyed()&&!require('./main21.cjs').getGamingMode());checks.push('quick restore cancels pending Gaming and repeated presses are harmless');
  await service.serial(()=>service.stop('both'));await js('document.getElementById("dual-width").value="95";document.getElementById("dual-width").dispatchEvent(new Event("change"));document.getElementById("dual-gaming").click()');await delay(1000);assert(win.isDestroyed());await host.show();win=require('./main21.cjs').getMainWindow();await delay(800);assert.equal(service.config.layouts.tiktok.find(x=>x.source==='game').width,.95);checks.push('Gaming button saves pending layout before releasing windows');
  assert.equal(errors.length,0,errors.join('\n'));fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));
 }catch(e){fs.writeFileSync(path.join(output,'error.txt'),e.stack+'\n'+errors.join('\n'));process.exitCode=1;}
 finally{fixture?.destroy();await require('../src/dual-stream/bootstrap.cjs').getService()?.release();await require('../src/suite-bootstrap.cjs').getRuntime()?.close();app.exit(process.exitCode||0);}
});
