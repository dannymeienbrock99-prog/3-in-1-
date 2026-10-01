'use strict';
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const dir=process.env.BATTO_SUITE_TEST_OUTPUT;if(!dir)throw Error('Test output directory missing');fs.mkdirSync(dir,{recursive:true});
 const win=require('./main21.cjs').getMainWindow(),errors=[],warnings=[];
 win.webContents.on('console-message',(_e,level,message)=>{if(message==='Potential permissions policy violation: autoplay is not allowed in this document.'){warnings.push(message);return;}if(level>=3&&!/favicon|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED/.test(message))errors.push(message);});
 try{
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
  const js=code=>win.webContents.executeJavaScript(code);
  await win.webContents.insertCSS('.view{animation:none!important}');
  let snapshot;
  for(let n=0;n<30;n++){await delay(400);snapshot=await js('window.batto.suite("state")');if(snapshot.fan?.state?.scene.tiles.length)break;}
  assert(snapshot.fan?.state?.sensors.some(s=>s.device==='RAM'&&s.fresh),'real RAM readings');
  assert(snapshot.fan.state.scene.tiles.length>0,'iCUE profile detected');
  assert(snapshot.fan.state.scene.tiles.every(t=>t.centerMode==='percent'),'percentage default');
  assert(snapshot.fan.state.scene.tiles.every(t=>!t.name.includes('GPU-Lüfter')),'no GPU fan placeholders');
  await js('window.batto.suite("settings",{voiceEnabled:false})');
  async function capture(name){win.webContents.invalidate();await delay(250);await win.webContents.capturePage();await delay(250);fs.writeFileSync(path.join(dir,name+'.png'),(await win.webContents.capturePage()).toPNG());}
  await js('setView("dashboard")');await capture('Multi-Chat-2.4.7');
  await js('setView("fans")');await delay(500);
  await js('window.savedFanImage=document.querySelector(".suite-fan img")');
  await delay(2300);
  assert(await js('window.savedFanImage===document.querySelector(".suite-fan img")'),'live readings must retain fan images');
  let before=await js('JSON.stringify([...document.querySelectorAll(".suite-fan")].map(e=>({width:e.getBoundingClientRect().width,src:e.querySelector("img").src})))');
  await js('document.querySelector(".suite-fan").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:0,clientY:0,pointerId:1}));document.getElementById("f-stage").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:1}))');
  await delay(500);
  const after=await js('JSON.stringify([...document.querySelectorAll(".suite-fan")].map(e=>({width:e.getBoundingClientRect().width,src:e.querySelector("img").src})))');assert.equal(before,after,'selection must not resize fans');
  const geometry=await js(`(()=>{const p=document.querySelector('.suite-fan-picture').getBoundingClientRect(),t=document.querySelector('.suite-fan .temp').getBoundingClientRect();return {square:Math.abs(p.width-p.height),x:(t.x+t.width/2-p.x)/p.width,y:(t.y+t.height/2-p.y)/p.height}})()`);
  assert(geometry.square<1);assert(Math.abs(geometry.x-.475)<.005);assert(Math.abs(geometry.y-.5)<.005);
  assert((await js('document.querySelector(".suite-fan .temp").textContent')).includes('%'),'percent center label');
  await capture('iCUE-LINK-Luefter');
  // Synthetic UI-only reading verifies that cached layout values clear on disconnect.
  const runtime=require('../src/suite-bootstrap.cjs').getRuntime();
  const fixture=structuredClone(runtime.fan.snapshot);fixture.scene.tiles[0].speedPercent={value:80,unit:'%',fresh:true,basis:'measured',updatedUtc:new Date().toISOString()};
  let isolated=runtime.snapshot();isolated.fan.state=fixture;win.webContents.send('suite:state',isolated);await delay(100);
  assert.match(await js('document.querySelector(".suite-fan .temp").textContent'),/80/);
  isolated={...isolated,fan:{...isolated.fan,state:null},fanError:'Testunterbrechung'};win.webContents.send('suite:state',isolated);await delay(100);
  assert.equal(await js('document.querySelector(".suite-fan .temp").textContent'),'— %','cached percentages clear when source disconnects');
  win.webContents.send('suite:state',runtime.snapshot());await delay(100);
  await js('setView("dashboard");window.hiddenFanText=document.querySelector(".suite-fan .temp").textContent');
  win.webContents.send('suite:state',{...runtime.snapshot(),fan:{...runtime.snapshot().fan,state:fixture}});await delay(100);
  assert(await js('window.hiddenFanText===document.querySelector(".suite-fan .temp").textContent'),'hidden stage must not repaint');
  await js('setView("fans")');
  assert.match(await js('document.querySelector(".suite-fan .temp").textContent'),/80/,'returning to the stage must immediately show latest readings');
  win.webContents.send('suite:state',runtime.snapshot());await delay(100);
  win.setSize(1180,800);await delay(500);await capture('iCUE-LINK-1180');
  win.setSize(1600,980);await js('setView("jarvis")');await capture('Jarvis');
  assert.equal(errors.length,0,errors.join('\n'));
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ok:true,geometry,fanCount:snapshot.fan.state.scene.tiles.length,liveFanCount:snapshot.fan.state.scene.tiles.filter(t=>snapshot.fan.state.sensors.some(s=>s.id===t.rpmSensorId&&s.fresh)).length,originalPalette:await js('getComputedStyle(document.documentElement).getPropertyValue("--gold")'),errors,warnings},null,2));
  app.quit();
 }catch(e){fs.writeFileSync(path.join(dir,'error.txt'),e.stack+'\n'+errors.join('\n'));console.error(e);app.exit(1);}
});
