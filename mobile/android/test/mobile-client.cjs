'use strict';
// Browser UI fixture only: no real microphone, camera, public messages or hardware actions.
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const output=process.env.BATTO_MOBILE_QA;if(!output)throw Error('BATTO_MOBILE_QA must point to an isolated directory');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'user-data'));
const webRoot=path.resolve(__dirname,'../../../desktop/src/touch-mobile');
const icon='data:image/png;base64,'+fs.readFileSync(path.join(webRoot,'icon.png')).toString('base64');
const state={revision:1,visualRevision:1,presentation:{plug:{image:icon,title:'Bereit'}},activeProfile:'main',readings:{temp:{value:42.5,unit:'°C'}},profiles:[{id:'main',name:'Gaming',columns:5,rows:3,keySize:120,buttons:[{id:'action',type:'action',title:'Pause',symbol:'Ⅱ'},{id:'temp',type:'sensor',title:'Temperatur',symbol:'◴'},{id:'plug',type:'plugin',title:'Plugin-Taste'},{id:'folder',type:'folder',title:'Szenen',buttons:[{id:'nested',type:'action',title:'Spiel'}]}]},{id:'second',name:'Zweites Deck',columns:3,rows:2,keySize:'auto',buttons:[{id:'other',type:'action',title:'Jarvis'}]}]};
let polls=0,auth=true,requests=[],presses=[];const checks=[];
const server=http.createServer(async(req,res)=>{
 const file={'/':'index.html','/client.js':'client.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/icon.png':'icon.png'}[req.url];
 if(file){res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'application/manifest+json'});res.end(fs.readFileSync(path.join(webRoot,file)));return;}
 let body='';for await(const chunk of req)body+=chunk;let data={};try{data=JSON.parse(body);}catch{}
 requests.push({path:req.url,profile:req.headers['x-batto-profile'],visual:req.headers['x-batto-visual-revision']});res.setHeader('Content-Type','application/json');
 if(req.url==='/api/pair'){res.statusCode=data.pin==='123456'?200:401;res.end(JSON.stringify(data.pin==='123456'?{token:'test-session',state}:{message:'Die PIN stimmt nicht.'}));return;}
 if(!auth||req.headers.authorization!=='Bearer test-session'){res.statusCode=401;res.end(JSON.stringify({message:'Erneut koppeln'}));return;}
 if(req.url==='/api/state')res.end(JSON.stringify(state));else if(req.url==='/api/readings'){polls++;res.end(JSON.stringify({revision:state.revision,readings:state.readings,visualRevision:state.visualRevision,visuals:state.presentation}));}else if(req.url==='/api/press'){presses.push(data);res.end('{"ok":true}');}else if(req.url==='/api/disconnect'){auth=false;res.end('{"ok":true}');}else{res.statusCode=404;res.end('{}');}
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let win;
app.whenReady().then(async()=>{
 const errors=[];const watchdog=setTimeout(()=>{fs.writeFileSync(path.join(output,'error.txt'),'Timed out');app.exit(1);},45000);
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({width:390,height:844,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.webContents.on('console-message',(_event,level,text)=>{if(level>=3&&!text.includes('401'))errors.push(text);});
  await win.loadURL('http://127.0.0.1:'+server.address().port);win.showInactive();
  const js=code=>win.webContents.executeJavaScript(code),until=async code=>{for(let i=0;i<60;i++){if(await js(code))return;await delay(70);}throw Error('Timed out: '+code);};
  await js("document.getElementById('pin').value='000000';document.getElementById('pair-form').requestSubmit()");await until("document.getElementById('status').textContent.includes('PIN stimmt nicht')");checks.push('wrong PIN stays on pair screen');
  await js("document.getElementById('pin').value='123456';document.getElementById('pair-form').requestSubmit()");await until("!document.getElementById('deck').hidden");
  assert.equal(await js("document.querySelectorAll('.key').length"),15);assert.equal(await js("document.querySelector('[data-reading]').textContent"),'42,5 °C');checks.push('phone pairs and shows configured keys/readings');
  assert.equal(await js("document.querySelector('[data-plugin] .plugin-status').textContent"),'Bereit');assert(await js("document.querySelector('[data-plugin] img').src.startsWith('data:image/png;base64,')"));checks.push('plugin dynamic PNG and status title shown');
  await js("document.querySelector('[data-index=\"0\"]').click()");await until("document.getElementById('status').textContent.includes('ausgeführt')");assert.deepEqual(presses[0],{profileId:'main',path:[],index:0});
  await js("document.querySelector('[data-index=\"3\"]').click();document.querySelector('[data-index=\"0\"]').click()");await until("document.getElementById('status').textContent.includes('Spiel')");assert.deepEqual(presses[1],{profileId:'main',path:[3],index:0});await js("document.getElementById('back').click()");checks.push('actions and nested folder presses route to assigned index');
  assert(await js("document.getElementById('keys').classList.contains('fixed-size')"));await js("document.querySelector('.display-settings').open=true;document.getElementById('key-size').value='180';document.getElementById('key-size').dispatchEvent(new Event('input'))");assert.equal(await js("document.getElementById('keys').style.getPropertyValue('--key-size')"),'180px');
  await js("document.getElementById('size-reset').click()");assert.equal(await js("document.getElementById('keys').style.getPropertyValue('--key-size')"),'120px');checks.push('phone size override and reset use PC profile size');
  await delay(3300);assert(requests.some(r=>r.path==='/api/readings'&&r.profile==='main'&&r.visual==='1'));state.presentation.plug={image:icon,title:'75 %'};state.visualRevision=2;await delay(3300);assert.equal(await js("document.querySelector('[data-plugin] .plugin-status').textContent"),'75 %');checks.push('poll headers hold visible plugin lease and dynamic updates refresh');
  await js("window.dispatchEvent(new Event('batto:suspend'))");await delay(200);const before=polls;await delay(3300);assert.equal(polls,before);await js("window.dispatchEvent(new Event('batto:resume'))");await until("document.querySelector('[data-plugin] .plugin-status').textContent==='75 %'");await delay(200);assert(polls>before);checks.push('Android background suspends polling and resumes on return');
  await js("document.querySelector('.display-settings').open=false");assert(await js('document.documentElement.scrollWidth<=innerWidth'));fs.writeFileSync(path.join(output,'Touch-Deck-Handy.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(1024,768);await delay(150);assert(await js('document.documentElement.scrollWidth<=innerWidth'));assert(await js("[...document.querySelectorAll('.key .reading,.key .plugin-status')].every(e=>{const child=e.getBoundingClientRect(),parent=e.parentElement.getBoundingClientRect();return child.bottom<=parent.bottom&&child.top>=parent.top})"));fs.writeFileSync(path.join(output,'Touch-Deck-Tablet.png'),(await win.webContents.capturePage()).toPNG());checks.push('phone and tablet layout have no horizontal overflow or clipped readings');
  await js("document.getElementById('profiles').value='second';document.getElementById('profiles').dispatchEvent(new Event('change'))");assert.equal(await js("document.querySelectorAll('.key').length"),6);assert.equal(await js("document.getElementById('keys').classList.contains('fixed-size')"),false);checks.push('second profile restores auto sized layout');
  await js("document.getElementById('disconnect').click()");await until("!document.getElementById('pairing').hidden");await delay(200);assert.equal(auth,false);assert.equal(await js("sessionStorage.getItem('batto-touch-session')"),null);checks.push('disconnect clears session and revokes pairing');
  assert.deepEqual(errors,[]);checks.push('no browser errors');fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,actualPhoneTested:false},null,2));
  clearTimeout(watchdog);win.destroy();server.close();app.exit(0);
 }catch(error){fs.writeFileSync(path.join(output,'error.txt'),error.stack);clearTimeout(watchdog);server.close();app.exit(1);}
});
