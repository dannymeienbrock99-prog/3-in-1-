'use strict';
// Isolated UI regression: no external messages, microphone or actual widget network.
const {app,session}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const out=process.env.BATTO_SUITE_TEST_OUTPUT;
 if(!out||process.env.BATTO_TEST_INSTANCE!=='1')throw Error('Isolated output required');
 fs.mkdirSync(out,{recursive:true});
 let hits=0;const fixture=http.createServer((_req,res)=>{hits++;res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Lokales Test-Widget</title><body style="background:#12110f;color:#e6bd70">Lokales Test-Widget</body>');});
 await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 session.defaultSession.webRequest.onBeforeRequest({urls:['https://tikfinity.zerody.one/widget/*']},(_details,done)=>done({redirectURL:`http://127.0.0.1:${fixture.address().port}/widget`}));
 const win=require('./main21.cjs').getMainWindow(),js=source=>win.webContents.executeJavaScript(source),errors=[];
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3&&!/ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(message))errors.push(message);});
 const checks=[];
 async function check(name,source){assert(await js(source),name);checks.push(name);}
 async function capture(name){win.webContents.invalidate();await delay(350);await win.webContents.capturePage();await delay(250);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
 try{
  if(win.webContents.isLoading())await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  await delay(7000);
  win.setSize(1600,980);
  await win.webContents.insertCSS('.view{animation:none!important}');
  await check('resource controller loaded','!!window.BattoResources');
  await check('widget URLs are saved but no site loads by default','!S.config.performance.webWidgetsAutoStart && !!S.config.appearance.chatWidgets.giftsUrl && !document.querySelector("iframe[src]")');
  assert.equal(hits,0,'startup must not contact widget pages');
  assert(!app.getAppMetrics().some(m=>m.serviceName==='video_capture.mojom.VideoCaptureService'),'no video capture service before a device request');checks.push('no video capture service at startup');
  await js('setView("dashboard")');await capture('Sparmodus-1600');
  await check('dashboard remains in saving mode','!document.querySelector("iframe[src]") && document.getElementById("resourceWidgets").textContent.includes("starten")');
  await js('document.getElementById("resourceWidgets").click()');await delay(700);
  await check('explicit widget start loads configured sources','!!document.querySelector("iframe[src]")');assert(hits>0);
  await js('window.resourceFrame=document.querySelector(".dashboard-gifts-frame"); window.resourceUrl=resourceFrame.src;');
  await js('window.batto.saveConfig({performance:{webWidgetsAutoStart:false}})');await delay(250);
  await check('unrelated settings keep a manually started session','resourceFrame===document.querySelector(".dashboard-gifts-frame") && resourceFrame.src===resourceUrl');
  await js('setView("fans")');await delay(300);
  await check('leaving chat unloads web widgets','!document.querySelector("iframe[src]")');
  await js('window.resourceChatBefore=document.getElementById("chatList").innerHTML;S.messages.push({id:"resource-local-test",platform:"internal",username:"Test",displayName:"Test",message:"Nachricht während Lüfteransicht",timestamp:new Date().toISOString()});renderChat();');
  await check('hidden chat keeps data without repainting','document.getElementById("chatList").innerHTML===resourceChatBefore');
  await js('setView("dashboard")');await delay(400);
  await check('return shows accumulated messages and resumes widgets','document.getElementById("chatList").textContent.includes("Nachricht während Lüfteransicht") && !!document.querySelector("iframe[src]")');
  win.showInactive();await delay(200);win.minimize();await delay(600);
  await check('minimized window releases widgets','document.hidden && !document.querySelector("iframe[src]")');
  win.restore();win.showInactive();await delay(600);
  await check('restored window resumes requested widgets','!document.hidden && !!document.querySelector("iframe[src]")');
  await js('document.getElementById("resourceWidgets").click()');await delay(250);
  await check('stop releases every web widget','!document.querySelector("iframe[src]")');
  win.setSize(1180,800);await delay(250);await capture('Sparmodus-1180');
  await js('setView("settings")');await delay(250);
  await check('saving preference is accessible without changing widget configuration','!!document.getElementById("resourceAutoStart") && !document.getElementById("resourceAutoStart").checked');
  await check('saved audio device remains selectable before enumeration','!!document.querySelector("[data-audio-device]").value');
  assert(!app.getAppMetrics().some(m=>m.serviceName==='video_capture.mojom.VideoCaptureService'),'settings page does not enumerate devices on its own');
  await js('setView("dashboard");document.querySelector("[data-audio-device]").focus()');await delay(800);
  await check('audio device list loads on demand','document.querySelector("[data-audio-device]").options.length>1');
  await js('setView("fans")');await capture('LINK-Luefter-1180');
  assert.equal(errors.length,0,errors.join('\n'));
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:true,checks,errors,fixtureRequests:hits},null,2));
 }catch(error){fs.writeFileSync(path.join(out,'error.txt'),error.stack+'\n'+errors.join('\n'));process.exitCode=1;}
 finally{session.defaultSession.webRequest.onBeforeRequest(null);fixture.closeAllConnections();fixture.close();await require('../src/suite-bootstrap.cjs').getRuntime()?.close();app.exit(process.exitCode||0);}
});
