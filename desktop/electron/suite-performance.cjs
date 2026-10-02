'use strict';
// Explicit isolated development benchmark. No stream connections or speech jobs.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const out=process.env.BATTO_SUITE_TEST_OUTPUT;if(!out||process.env.BATTO_TEST_INSTANCE!=='1')throw Error('Isolated benchmark required');
 fs.mkdirSync(out,{recursive:true});const win=require('./main21.cjs').getMainWindow();
 const js=code=>win.webContents.executeJavaScript(code),errors=[];
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3&&!/ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(message))errors.push(message);});
 try {
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
  await pause(6500);if(process.env.BATTO_BENCH_VISIBLE!=='1')win.webContents.setBackgroundThrottling(false);
  const runtime=require('../src/suite-bootstrap.cjs').getRuntime();runtime.jarvis.update({voiceEnabled:false,microphoneEnabled:false,chatEnabled:false});
  const helperPid=runtime.fan.child?.pid;
  fs.writeFileSync(path.join(out,'pids.json'),JSON.stringify({electron:process.pid,helper:helperPid}));
  const results=[],views=process.env.BATTO_BENCH_VISIBLE==='1'?['fans','dashboard','minimized','gaming']:['fans','dashboard'];
  if(process.env.BATTO_BENCH_VISIBLE==='1')win.showInactive();
  for(const view of views){
   if(view==='gaming'){require('./main21.cjs').getSuiteHost().gaming();await pause(1500);}else if(view==='minimized'){win.webContents.setBackgroundThrottling(true);win.hide();}else await js(`setView(${JSON.stringify(view)})`);await pause(1500);
   fs.writeFileSync(path.join(out,'phase.json'),JSON.stringify({view,pids:[...app.getAppMetrics().map(m=>m.pid),helperPid].filter(Boolean)}));
   if(view!=='gaming')await js(`window.perfMutations=0;window.perfObserver?.disconnect();window.perfObserver=new MutationObserver(ms=>{window.perfMutations+=ms.filter(m=>m.type==='childList'&&[...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1)).length});for(const id of ['f-stage','s-list','j-log','f-assignments'])window.perfObserver.observe(document.getElementById(id),{childList:true,subtree:true});window.perfFirstFan=document.querySelector('.suite-fan');`);
   const before=app.getAppMetrics(),start=Date.now();await pause(Number(process.env.BATTO_BENCH_MS)||20000);const after=app.getAppMetrics(),seconds=(Date.now()-start)/1000;
   let cpuSeconds=0;for(const m of after){const old=before.find(b=>b.pid===m.pid);if(old)cpuSeconds+=Math.max(0,(m.cpu.cumulativeCPUUsage||0)-(old.cpu.cumulativeCPUUsage||0));}
   const dom=view==='gaming'?{rendererReleased:win.isDestroyed()}:await js(`({elementRebuilds:window.perfMutations,fanRetained:window.perfFirstFan===document.querySelector('.suite-fan'),fanCount:document.querySelectorAll('.suite-fan').length,visibility:document.visibilityState,active:document.querySelector('.view.active')?.id,suspended:window.BattoResources?.suspended})`);dom.minimized=!win.isDestroyed()&&win.isMinimized();dom.hidden=win.isDestroyed()||!win.isVisible();
   const processes=after.map(m=>({pid:m.pid,type:m.type,name:m.name,serviceName:m.serviceName,memory:m.memory,cpuSeconds:Math.max(0,(m.cpu.cumulativeCPUUsage||0)-(before.find(b=>b.pid===m.pid)?.cpu.cumulativeCPUUsage||0))}));
   const content=view==='gaming'?{windows:require('electron').BrowserWindow.getAllWindows().length}:await js(`({resources:typeof window.BattoResources,mode:S.config?.performance,url:location.href,scripts:[...document.scripts].map(s=>s.src.split('/').pop()),nodes:document.querySelectorAll('*').length,frames:[...document.querySelectorAll('iframe')].map(f=>({title:f.title,host:new URL(f.src||'about:blank').hostname,visible:!!f.getClientRects().length})),memory:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null})`);
   results.push({view,seconds,cpuSeconds,cpuPercentOfPc:cpuSeconds/seconds/os.cpus().length*100,workingSetMb:after.reduce((n,m)=>n+m.memory.workingSetSize,0)/1024,processes,content,dom});
  }
  fs.writeFileSync(path.join(out,'performance.json'),JSON.stringify({results,errors},null,2));
 }catch(e){fs.writeFileSync(path.join(out,'error.txt'),e.stack);}finally{app.quit();}
});
