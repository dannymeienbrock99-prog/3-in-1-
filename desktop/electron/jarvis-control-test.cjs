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
  runtime.voice.send=()=>{throw Error('QA must not activate microphone or speech');};
  const js=code=>win.webContents.executeJavaScript(code);
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3&&!/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(message))errors.push(message);});
  win.setSize(1600,1000);win.showInactive();
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
  assert.equal(runtime.voice.child,null);assert.equal(dual.native?.child||null,null);assert.equal(errors.length,0,errors.join('\n'));
  clearTimeout(guard);fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));app.quit();
 }catch(error){clearTimeout(guard);fs.writeFileSync(path.join(output,'error.txt'),error.stack+'\n'+errors.join('\n'));app.exit(1);}
});
