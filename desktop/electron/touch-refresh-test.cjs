'use strict';
// Real local phone renderer with fixture actions only. Never controls a device,
// microphone, public chat, user's profile or an installed plugin.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {TouchDeck}=require('../src/services/touch-deck.cjs');
const output=process.env.BATTO_SUITE_TEST_OUTPUT;
if(!output||process.env.BATTO_TEST_INSTANCE!=='1')throw Error('Isolated test output required');
app.setPath('userData',path.join(output,'electron-profile'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 fs.mkdirSync(output,{recursive:true});const checks=[],errors=[],calls=[];
 const deck=new TouchDeck({directory:path.join(output,'deck'),host:'127.0.0.1',port:0,controls:{catalog:()=>({actions:[{id:'scene',choices:[{id:'Pause'},{id:'Spiel'}]}]}),execute:async value=>{calls.push(value);return {ok:true};}}});
 const win=new BrowserWindow({width:420,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code),until=async(code,label)=>{for(let i=0;i<100;i++){if(await js(code)){checks.push(label);return;}await delay(60);}throw Error('Timeout: '+label);};
 const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(100);};
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3&&!/status of 400/.test(message))errors.push(message);});
 const watchdog=setTimeout(()=>{fs.writeFileSync(path.join(output,'error.txt'),'Timed out: '+checks.join(' / '));app.exit(1);},30000);
 try{
  const key=(id,title,target)=>({id,type:'action',title,steps:[{action:'scene',target}]}),folder=(id,title,button)=>({id,type:'folder',title,buttons:[button]});
  deck.save({version:1,activeProfile:'main',profiles:[{id:'main',name:'Mein Deck',columns:2,rows:1,buttons:[folder('folder','Ordner',key('pause','Pause','Pause'))]},{id:'backup',name:'Reserve',columns:2,rows:1,buttons:[folder('backup-folder','Anderer Ordner',key('backup-key','Reserve-Taste','Spiel'))]}]});
  const mobile=await deck.mobileStart(),url=`http://127.0.0.1:${mobile.port}`;await win.loadURL(url);win.showInactive();
  assert.equal(await js('document.title'),'Batto Touch Deck');assert(win.webContents.getURL().startsWith(url));checks.push('page identity, nonblank pairing form and expected local URL');
  await js(`document.getElementById('pin').value=${JSON.stringify(mobile.pin)};document.getElementById('pair-form').requestSubmit()`);
  await until('!document.getElementById("deck").hidden','phone pairs through real local API');await click('[data-index="0"]');assert.match(await js('document.getElementById("breadcrumb").textContent'),/Ordner/);
  let config=deck.snapshot();config.profiles[0].buttons[0]=null;deck.save(config);await js("window.dispatchEvent(new Event('batto:resume'))");
  await until('document.getElementById("breadcrumb").textContent==="Mein Deck"&&document.querySelector("[data-index=\\"0\\"]").disabled','removed open folder returns to current profile without broken polling');
  config=deck.snapshot();config.profiles[0].buttons[0]=key('pause','Pause','Pause');deck.save(config);await js("window.dispatchEvent(new Event('batto:resume'))");await until('document.querySelector("[data-index=\\"0\\"]").textContent.includes("Pause")','newly saved button appears without re-pairing');
  await js("window.dispatchEvent(new Event('batto:suspend'))");config=deck.snapshot();config.profiles[0].buttons[0]=key('replacement','Spiel','Spiel');deck.save(config);await click('[data-index="0"]');
  await until('document.getElementById("status").textContent.includes("geändert")','stale visible key is rejected with readable feedback');assert.equal(calls.length,0);checks.push('stale phone key executes no replacement action');
  await js("window.dispatchEvent(new Event('batto:resume'))");await until('document.querySelector("[data-index=\\"0\\"]").textContent.includes("Spiel")','refresh replaces obsolete key');await click('[data-index="0"]');assert.deepEqual(calls,[{steps:[{action:'scene',target:'Spiel'}]}]);checks.push('fresh key executes its displayed saved action');
  config=deck.snapshot();config.profiles[0].buttons[0]=folder('folder-return','Ordner',key('nested-pause','Pause','Pause'));deck.save(config);await js("window.dispatchEvent(new Event('batto:resume'))");await until('document.querySelector("[data-index=\\"0\\"]").textContent.includes("Ordner")','folder restored');await click('[data-index="0"]');
  config=deck.snapshot();config.profiles=config.profiles.filter(p=>p.id!=='main');deck.save(config);await js("window.dispatchEvent(new Event('batto:resume'))");await until('document.getElementById("breadcrumb").textContent==="Reserve"&&document.querySelector("[data-index=\\"0\\"]").textContent.includes("Anderer Ordner")','deleted profile returns to remaining profile root without entering another folder');
  assert(await js('document.documentElement.scrollWidth<=window.innerWidth'));checks.push('phone viewport fits without horizontal overflow');await delay(100);fs.writeFileSync(path.join(output,'Touch-Deck-Handy-Aktualisiert.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(1024,768);await delay(180);assert(await js('document.documentElement.scrollWidth<=window.innerWidth'));checks.push('tablet viewport fits without horizontal overflow');fs.writeFileSync(path.join(output,'Touch-Deck-Tablet-Aktualisiert.png'),(await win.webContents.capturePage()).toPNG());
  assert.equal(errors.length,0,errors.join('\n'));checks.push('no unexpected renderer errors');clearTimeout(watchdog);await deck.close();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors,viewports:[[420,900],[1024,768]],actualPhoneTested:false},null,2));app.exit(0);
 }catch(error){clearTimeout(watchdog);fs.writeFileSync(path.join(output,'error.txt'),error.stack+'\n'+errors.join('\n'));await deck.close();app.exit(1);}
});
