'use strict';
// Opt-in isolated acceptance run. Never uses the owner's chat, microphone or camera.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const output=process.env.BATTO_SUITE_TEST_OUTPUT;
 if(process.env.BATTO_TEST_INSTANCE!=='1'||!output||!process.env.BATTO_OBS_DATA||!process.env.BATTO_SUITE_DATA)throw Error('Isolated data paths required');
 fs.mkdirSync(output,{recursive:true});const checks=[],errors=[];
 const guard=setTimeout(()=>{fs.writeFileSync(path.join(output,'error.txt'),'Timeout: '+checks.join(', '));app.exit(1);},60000);
 try{
  const host=require('./main21.cjs'),win=host.getMainWindow();
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));await pause(1800);
  const runtime=require('../src/suite-bootstrap.cjs').getRuntime(),dual=require('../src/dual-stream/bootstrap.cjs').getService();
  runtime.jarvis.settings.voiceEnabled=false;runtime.jarvis.settings.microphoneEnabled=false;
  const voiceJobs=[];
  runtime.voice.send=job=>{voiceJobs.push(job.command);if(job.command!=='devices')throw Error('QA must not activate microphone or speech');};
  const js=code=>win.webContents.executeJavaScript(code);
  async function until(predicate,label){for(let i=0;i<100;i++){if(await predicate())return;await pause(40);}throw Error('Timed out: '+label);}
  async function field(id,value){await js(`{const el=document.getElementById(${JSON.stringify(id)});el[el.type==='checkbox'?'checked':'value']=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}`);}
  async function click(id){await js(`document.getElementById(${JSON.stringify(id)}).click()`);await pause(100);}
  async function openSettings(){await js('setView("jarvis")');if(!await js('document.getElementById("view-jarvis").classList.contains("settings-open")'))await click('j-settings-toggle');assert.equal(await js('document.getElementById("j-settings-toggle").getAttribute("aria-expanded")'),'true');}
  const persisted=()=>JSON.parse(fs.readFileSync(path.join(process.env.BATTO_SUITE_DATA,'jarvis-settings.json'),'utf8'));
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3&&!/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(message))errors.push(message);});
  win.setSize(1600,1000);win.showInactive();
  assert.match(win.webContents.getURL(),/renderer[\\/]index\.html/);
  assert(await js('document.body.innerText.length>100&&Boolean(document.getElementById("view-jarvis"))'));
  checks.push('the expected local application renderer is loaded and nonblank');
  async function command(text){await js('setView("jarvis")');await pause(100);const before=runtime.jarvis.history.length;
   await js(`document.getElementById('j-command').value=${JSON.stringify(text)};document.getElementById('j-command-form').requestSubmit()`);
   for(let i=0;i<100;i++){if(runtime.jarvis.history.length>before&&!runtime.jarvis.commandBusy)return runtime.jarvis.history.at(-1);await pause(40);}throw Error('Command timeout: '+text);
  }
  await command('Start Szene öffnen');assert.equal(dual.config.program.scene,'Start');checks.push('typed Start Szene öffnen changes the real program scene');
  await command('Multi Chat öffnen');assert.equal(await js('S.view'),'dashboard');checks.push('typed Multi Chat öffnen opens the real Multi-Chat page');
  await command('Chat Filter öffnen');assert.equal(await js('S.view'),'filters');checks.push('typed Chat Filter öffnen opens the real filters page');
  await command('Chat Filter aus');assert.equal(host.getSuiteHost().filters().enabled,false);
  await command('Chat Filter an');assert.equal(host.getSuiteHost().filters().enabled,true);checks.push('filter switch updates and saves actual test configuration');
  await command('Filterwort JarvisTest181 hinzufügen');assert(host.getSuiteHost().filters().rules.some(x=>x.term==='JarvisTest181'));
  await command('Filterwort JarvisTest181 entfernen');assert(!host.getSuiteHost().filters().rules.some(x=>x.term==='JarvisTest181'));checks.push('spoken filter terms add and remove through the real filter persistence API');
  await command('Jarvis Lautstärke auf 35 Prozent');assert.equal(runtime.jarvis.settings.speechVolume,35);assert.equal(runtime.audio.child,null);checks.push('own voice volume requires no native helper');
  await runtime.controls.execute({action:'command',text:'Pause'});assert.equal(dual.config.program.scene,'Pause');checks.push('saved Stream Deck command routes without deadlock');
  runtime.voice.emit('event',{type:'transcript',text:'Multi Chat öffnen'});await pause(180);assert.equal(await js('S.view'),'dashboard');checks.push('recognized voice text reaches the same live navigation');
  assert.equal((await command('Blockiere NichtVorhanden auf Twitch')).kind,'clarification');checks.push('unknown person cannot trigger moderation');
  assert.equal((await command('Schalte irgendetwas ein')).kind,'clarification');checks.push('unknown switches visibly fail without made-up success');
  await js('setView("jarvis")');await pause(2400);
  assert((await js('document.getElementById("j-log").textContent')).includes('ERKANNT'));checks.push('recognized voice input and outcome appear in the real Jarvis history');
  assert(await js('document.querySelectorAll("[data-command-example]").length>=6'));
  await js('document.getElementById("j-more-commands").open=true');await pause(150);
  fs.writeFileSync(path.join(output,'Jarvis-1600.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(1180,850);await pause(200);assert(await js('document.getElementById("content").scrollWidth<=document.getElementById("content").clientWidth+2'));
  fs.writeFileSync(path.join(output,'Jarvis-1180.png'),(await win.webContents.capturePage()).toPNG());checks.push('Jarvis command panel fits both desktop sizes');
  await command('Lies alle Chatnachrichten vor');assert.equal(runtime.jarvis.settings.chatMode,'all');assert.equal(runtime.jarvis.settings.chatEnabled,true);checks.push('voice command switches chat reading to all people and enables it');
  await command('Geschenk-Ansage auf Geschenkname und Coins');assert.equal(runtime.jarvis.settings.events.giftAnnouncement,'both');checks.push('voice command selects gift name and coin announcements');
  await command('Lüfterwarnung ab 75 Prozent');assert.equal(runtime.jarvis.settings.fanAlerts.threshold,75);checks.push('voice command saves the fan alert threshold');
  await command('Öffne deine Einstellungen');await until(async()=>await js('S.view==="jarvis"&&document.getElementById("view-jarvis").classList.contains("settings-open")'),'Jarvis settings opened through the host');checks.push('voice command opens actual Jarvis settings through the host navigation');
  const savedMicrophone={name:'QA USB Mikrofon',hostapi:'Windows WASAPI'},chosenMicrophone={name:'QA Headset',hostapi:'Windows WASAPI'};
  runtime.jarvis.update({microphone:savedMicrophone});runtime.emit('state',runtime.snapshot());await openSettings();
  await until(async()=>await js('document.getElementById("j-device").value')===JSON.stringify(savedMicrophone),'saved microphone restored without enumerating devices');
  assert.match(await js('document.getElementById("j-device").selectedOptions[0].textContent'),/gespeichert/);
  await field('j-greeting','Wie kann ich helfen? QA');await click('j-save-voice');
  await until(()=>runtime.jarvis.settings.greeting==='Wie kann ich helfen? QA','voice settings saved');
  assert.deepEqual(persisted().microphone,savedMicrophone);checks.push('saving voice settings preserves the saved microphone object before loading any device list');
  const devices=Array.from({length:20},(_,index)=>({index,name:index===0?savedMicrophone.name:index===1?'QA Tischmikrofon':index===2?chosenMicrophone.name:`QA Eingang ${index+1}`,hostapi:index<3?'Windows WASAPI':'Windows WDM-KS',available:index<3,recommended:index===0,reason:index<3?'':'Kein gemeinsam nutzbarer Eingang'}));
  await click('j-devices');assert.deepEqual(voiceJobs,['devices']);runtime.voice.emit('event',{type:'devices',items:devices});
  await until(async()=>await js('document.getElementById("j-device").options.length')===21,'20 microphone devices displayed');
  assert.equal(await js('document.querySelectorAll("#j-device option:disabled").length'),17);
  assert.equal(await js('document.querySelectorAll("#j-device option:not(:disabled)").length'),4);
  assert.equal(await js('document.getElementById("j-device").value'),JSON.stringify(savedMicrophone));
  await field('j-device',JSON.stringify(chosenMicrophone));runtime.voice.emit('event',{type:'devices',items:devices.toReversed().map(d=>({...d,index:d.index+30}))});await pause(100);
  assert.equal(await js('document.getElementById("j-device").value'),JSON.stringify(chosenMicrophone));
  await click('j-save-voice');assert.deepEqual(persisted().microphone,chosenMicrophone);checks.push('all 20 microphone routes are visible, 17 unusable routes are disabled, and an unsaved selection survives refresh and saves by identity');
  const followTemplate='Hallo {username}, danke für deinen Follow bei {platform}.',subscriptionTemplate='Danke {username} für {submonth} Monate. QA';
  await field('j-template-follow',followTemplate);await field('j-template-subscription',subscriptionTemplate);await field('j-events-likeThreshold',1000);await field('j-gift-announcement','both');await click('j-save-events');
  await until(()=>runtime.jarvis.settings.events.templates.follow===followTemplate,'event templates saved');
  assert.equal(persisted().events.templates.subscription,subscriptionTemplate);assert.equal(persisted().events.likeThreshold,1000);assert.equal(persisted().events.giftAnnouncement,'both');
  const chatTemplate='{username} schreibt: {message}';
  await field('j-chat',true);await field('j-chat-source','connected');await field('j-chat-mode','allowlist');await field('j-chat-template',chatTemplate);await field('j-allowlist','twitch:qa_moderator\ntiktok:qa_host');await field('j-chat-cooldown',7);await field('j-chat-length',170);await click('j-save-chat');
  await until(()=>runtime.jarvis.settings.chatTemplate===chatTemplate,'chat reading settings saved');
  assert.equal(persisted().chatSource,'connected');assert.equal(persisted().chatMode,'allowlist');assert.deepEqual(persisted().chatAllowlist,['twitch:qa_moderator','tiktok:qa_host']);assert.equal(persisted().chatCooldown,7);assert.equal(persisted().chatMaxLength,170);
  await field('j-chat-source','window');await field('j-chat-mode','all');await click('j-save-chat');
  assert.equal(persisted().chatSource,'window');assert.equal(persisted().chatMode,'all');checks.push('event templates, like threshold, gift mode, chat source, reader mode and template persist through their actual save buttons');
  const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.webContents.reload();await loaded;await pause(500);await openSettings();
  await until(async()=>await js('document.getElementById("j-template-follow").value')===followTemplate,'templates reloaded into renderer');
  assert.equal(await js('document.getElementById("j-template-subscription").value'),subscriptionTemplate);assert.equal(await js('document.getElementById("j-events-likeThreshold").value'),'1000');
  assert.equal(await js('document.getElementById("j-chat-source").value'),'window');assert.equal(await js('document.getElementById("j-chat-mode").value'),'all');assert.equal(await js('document.getElementById("j-chat-template").value'),chatTemplate);assert.equal(await js('document.getElementById("j-device").value'),JSON.stringify(chosenMicrophone));checks.push('saved microphone, event templates and chat reading settings survive a full renderer reload');
  const eventState=()=>JSON.stringify({seen:[...runtime.jarvis.events.seen],likes:[...runtime.jarvis.events.likes],pending:runtime.jarvis.events.pending,last:runtime.jarvis.events.last}),beforePreview=eventState(),beforeHistory=runtime.jarvis.history.length;
  await js('document.querySelector("[data-preview-template=follow]").click()');
  await until(()=>runtime.jarvis.history.length===beforeHistory+1,'event preview completes');
  assert.equal(runtime.jarvis.history.at(-1).kind,'preview');assert.match(runtime.jarvis.history.at(-1).text,/Vorschau mit erfundenen Beispieldaten.*Beispielperson/);assert.equal(eventState(),beforePreview);
  await until(async()=>/Beispielperson/.test(await js('document.getElementById("j-template-preview").textContent')),'preview result visible');checks.push('explicit preview displays clearly fictional sample values exactly once without changing any real event counters');
  runtime.voice.emit('event',{type:'devices',items:devices});await pause(100);
  for(const [width,height] of [[1600,1000],[1180,850]]){
   win.setSize(width,height);await pause(200);await js('document.getElementById("view-jarvis").scrollTop=0;document.getElementById("content").scrollTop=0;window.scrollTo(0,0)');await pause(100);
   const sizes=await js('["content","view-jarvis"].map(id=>{const e=document.getElementById(id);return {id,width:e.clientWidth,scrollWidth:e.scrollWidth}})');
   assert(sizes.every(e=>e.scrollWidth<=e.width+2),JSON.stringify(sizes));
   fs.writeFileSync(path.join(output,`Jarvis-Settings-${width}.png`),(await win.webContents.capturePage()).toPNG());
   await js('document.getElementById("j-chat-template").scrollIntoView({block:"center"})');await pause(100);
   fs.writeFileSync(path.join(output,`Jarvis-Chat-${width}.png`),(await win.webContents.capturePage()).toPNG());
  }
  checks.push('opened Jarvis settings and chat controls have no horizontal overflow at 1600×1000 and 1180×850');
  assert.deepEqual(voiceJobs,['devices']);checks.push('acceptance exercised no real microphone, speech, AI or camera service');
  assert.equal(runtime.voice.child,null);assert.equal(dual.native?.child||null,null);assert.equal(errors.length,0,errors.join('\n'));
  clearTimeout(guard);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));app.quit();
 }catch(error){clearTimeout(guard);fs.writeFileSync(path.join(output,'error.txt'),error.stack+'\n'+errors.join('\n'));app.exit(1);}
});
