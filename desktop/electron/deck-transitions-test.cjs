'use strict';
// Isolated browser acceptance: real editors, synthetic catalog; no devices,
// local service ports, microphone, capture or user's deck settings are opened.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const {SuiteControls}=require('../src/services/suite-controls.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(process.env.BATTO_TEST_INSTANCE==='1'&&process.env.BATTO_SUITE_TEST_OUTPUT)app.setPath('userData',path.join(process.env.BATTO_SUITE_TEST_OUTPUT,'electron-profile'));
app.whenReady().then(async()=>{
 const output=process.env.BATTO_SUITE_TEST_OUTPUT;if(!output||process.env.BATTO_TEST_INSTANCE!=='1')throw Error('Isolated test output required');fs.mkdirSync(output,{recursive:true});
 const win=new BrowserWindow({width:1280,height:920,show:false,webPreferences:{backgroundThrottling:false}}),checks=[],errors=[];
 const js=code=>win.webContents.executeJavaScript(code),check=async(name,code)=>{assert(await js(code),name);checks.push(name);};
 const until=async code=>{for(let i=0;i<70;i++){if(await js(code))return;await delay(50);}throw Error('Timeout: '+code);};
 const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(80);};
 const select=async(selector,value)=>{await js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(60);};
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
 const watchdog=setTimeout(()=>{fs.writeFileSync(path.join(output,'error.txt'),'Timed out: '+checks.join(' / '));app.exit(1);},45000);
 try{
  const renderer=path.resolve(__dirname,'../src/renderer'),url=file=>pathToFileURL(path.join(renderer,file)).href;
  const config={transitions:[{id:'obs-transition:fixture',name:'Stinger',type:'stinger',settings:{path:'C:/Fixtures/stinger.mp4'}}],program:{transition:'obs-transition:fixture',durationMs:350}};
  const catalog=new SuiteControls({runtime:{voice:{}},getDual:()=>({config}),getHost:()=>({})}).catalog();
  const fixture={version:1,revision:1,activeProfile:'main',profiles:[{id:'main',name:'Mein Deck',columns:3,rows:1,keySize:'auto',buttons:[{id:'pause',type:'action',title:'Pause',steps:[{action:'scene',target:'Pause'}]},null,null]}],sensors:[],mobile:{running:false},presentation:{}};
  const file=path.join(output,'deck-transitions-fixture.html');fs.writeFileSync(file,`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Batto Touch Deck · Übergänge</title>${['styles.css','marble-gold.css','suite.css','touch-deck.css'].map(file=>`<link rel="stylesheet" href="${url(file)}">`).join('')}<style>body{overflow:auto;padding:20px;background:#141311}</style></head><body><main id="view-touchdeck" class="active"><div id="touch-deck-root"></div></main></body></html>`);
  await win.loadFile(file);win.showInactive();
  await js(`window.__catalog=${JSON.stringify(catalog)};window.__state=${JSON.stringify(fixture)};window.__calls=[];window.BattoResources={suspended:false};window.batto={async touch(command,value){window.__calls.push({command,value});if(command==='catalog')return window.__catalog;if(command==='packages')return {plugins:[],iconPacks:[]};if(command==='save'){window.__state={...window.__state,...value,revision:window.__state.revision+1};return window.__state;}return window.__state;}};void 0;`);
  await js(`new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=${JSON.stringify(url('touch-deck.js'))};s.onload=()=>resolve(null);s.onerror=()=>reject(Error('Touch editor failed to load'));document.body.append(s);})`);
  await until('!!document.getElementById("td-mode")');await click('#td-mode');await click('[data-td-key="0"]');
  const transition='[data-td-step="0"][data-td-field="transition"]',duration='[data-td-step="0"][data-td-field="durationMs"]';
  await check('new and existing unpinned scene buttons inherit the current transition',`document.querySelector(${JSON.stringify(transition)}).value===''&&document.querySelector(${JSON.stringify(duration)}).value===''`);
  await check('Touch Deck lists the imported Stinger',`[...document.querySelector(${JSON.stringify(transition)}).options].some(o=>o.value==='obs-transition:fixture'&&o.textContent==='Stinger')`);
  await select(transition,'obs-transition:fixture');await check('Stinger duration is described and cannot override clip timing',`document.querySelector(${JSON.stringify(duration)}).disabled&&document.querySelector(${JSON.stringify(duration)}).parentElement.textContent.includes('Stinger-Videodatei')`);
  await click('#td-save');await check('Touch Deck persists the imported transition ID',`window.__state.profiles[0].buttons[0].steps[0].transition==='obs-transition:fixture'`);
  await select(transition,'');await click('#td-save');await check('inherit removes the override instead of saving an empty invalid ID',`!('transition' in window.__state.profiles[0].buttons[0].steps[0])&&!('durationMs' in window.__state.profiles[0].buttons[0].steps[0])`);
  await select(transition,'fade');await check('built-in fade duration becomes editable',`!document.querySelector(${JSON.stringify(duration)}).disabled`);
  await select(transition,'obs-transition:fixture');await click('#td-save');
  await js(`document.querySelector(${JSON.stringify(transition)}).scrollIntoView({block:'center'})`);await delay(80);
  fs.writeFileSync(path.join(output,'Touch-Deck-Stinger.png'),(await win.webContents.capturePage()).toPNG());
  await win.loadFile(path.resolve(__dirname,'../../streamdeck/de.crazybatto.suite.sdPlugin/ui/index.html'));
  await js(`window.__messages=[];window.WebSocket=class {static OPEN=1;constructor(){this.readyState=1;window.__socket=this;}send(value){window.__messages.push(JSON.parse(value));}};connectElgatoStreamDeckSocket(1,'fixture','registerPropertyInspector','{}',JSON.stringify({action:'de.crazybatto.suite.scene',payload:{settings:{control:{action:'scene',target:'Pause'}}}}));window.__socket.onmessage({data:JSON.stringify({event:'sendToPropertyInspector',payload:{suiteOnline:true,controls:${JSON.stringify(catalog)}}})});void 0;`);
  const piFind=`[...document.querySelectorAll('#steps label')].find(label=>label.firstChild.textContent==='Übergang').querySelector('select')`;
  await check('Stream Deck inspector lists inherited and imported choices',`${piFind}.value===''&&[...${piFind}.options].some(o=>o.value==='obs-transition:fixture')`);
  await js(`(()=>{const input=${piFind};input.value='obs-transition:fixture';input.dispatchEvent(new Event('change'));})()`);
  await check('Stream Deck inspector sends the Stinger identity to the plugin',`window.__messages.filter(m=>m.event==='setSettings').at(-1).payload.control.transition==='obs-transition:fixture'&&document.querySelector('#steps input').disabled`);
  await js(`(()=>{const input=${piFind};input.value='';input.dispatchEvent(new Event('change'));})()`);
  await check('Stream Deck inherited transition stays absent in saved settings',`!('transition' in window.__messages.filter(m=>m.event==='setSettings').at(-1).payload.control)`);
  await js(`window.__socket.onmessage({data:JSON.stringify({event:'sendToPropertyInspector',payload:{suiteOnline:true,controls:{actions:${JSON.stringify(catalog.actions)}.map(item=>item.id==='scene'?{...item,transitionChoices:[]}:item)}}})});void 0;`);
  await check('empty transition catalog still offers the current selection safely',`${piFind}.options.length===1`);
  assert.equal(errors.length,0,errors.join('\n'));clearTimeout(watchdog);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));app.exit(0);
 }catch(error){clearTimeout(watchdog);fs.writeFileSync(path.join(output,'error.txt'),error.stack+'\n'+errors.join('\n'));app.exit(1);}
});
