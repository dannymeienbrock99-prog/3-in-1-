'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function loadPreload(file,invoke){let api;const electron={contextBridge:{exposeInMainWorld(name,value){if(name==='batto')api=value;}},ipcRenderer:{invoke,on(){},removeListener(){},send(){}}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{require(name){assert.equal(name,'electron');return electron;}},{filename:file});assert.equal(typeof api?.dual,'function');return api;}
const sharedCommands=['register-cameras','program','scene','background','background-clear','obs-import-preview','obs-import-list','obs-import-local-preview','obs-import-apply','state','save','probe','prepare','release','start','stop','snapshot','library','import','export','detach','attach','always-on-top','companion','gaming','copy-overlay'];
for(const name of ['preload.cjs','dual-preload.cjs']){
 test(name+' exposes actual import and background actions through the authorized channel',async()=>{
  const calls=[],answer={accepted:true},api=loadPreload(path.resolve(__dirname,'../electron',name),(channel,payload)=>{calls.push({channel,payload});return Promise.resolve(answer);});
  for(const command of sharedCommands){const value={token:'synthetic-import',baseRevision:7,scene:'Pause',platform:'tiktok',mapping:{twitch:{Pause:'pause'}},sources:{camera:'',game:''}};assert.strictEqual(await api.dual(command,value),answer);const call=calls.at(-1);assert.equal(call.channel,'dual:action');assert.equal(call.payload.command,command);assert.strictEqual(call.payload.value,value);}
  const count=calls.length;for(const command of ['execute','shell','read-file','obs-import','__proto__','constructor','',null,undefined,{}])assert.throws(()=>api.dual(command,{}),/Unbekannte/);assert.equal(calls.length,count,'unsupported commands must not reach IPC');
 });
 test(name+' surfaces main-process import errors instead of reporting success',async()=>{
  const error=new Error('Bitte die OBS-Datei erneut auswählen'),api=loadPreload(path.resolve(__dirname,'../electron',name),()=>Promise.reject(error));await assert.rejects(api.dual('obs-import-apply',{token:'stale'}),cause=>cause===error);
 });
}
