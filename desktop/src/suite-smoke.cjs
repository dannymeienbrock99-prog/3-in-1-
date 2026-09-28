'use strict';
const fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async(window,diagnostics)=>{
 const dir=process.env.BATTO_SUITE_TEST_OUTPUT;if(!dir)throw Error('Testausgabe fehlt');fs.mkdirSync(dir,{recursive:true});
 const runtime=require('./suite-bootstrap.cjs').getRuntime();
 for(let n=0;n<20&&!runtime.fan.snapshot;n++)await pause(500);
 if(!runtime.fan.snapshot?.sensors.length)throw Error('Keine echten Windows-Messwerte angekommen: '+runtime.fan.error);
 runtime.jarvis.update({voiceEnabled:false});
 const sensors=runtime.fan.snapshot.sensors,temp=sensors.find(s=>s.unit==='°C'),speed=sensors.find(s=>s.unit==='%'&&/fan|lüfter/i.test(s.name));
 const scene={background:'stream-startet.jpg',tiles:[{id:'uitestfan',name:'GPU · Testlayout',x:950,y:310,size:310,visible:true,rpmSensorId:speed?.id||'',temperatureSensorId:temp?.id||'',fromProfile:false}]};
 await runtime.fan.configure('stage',scene);await pause(2200);
 const checks=await window.webContents.executeJavaScript(`(async()=>{
  const problems=[];if(document.querySelectorAll('#multi-chat-root').length!==1||document.getElementById('batto-multi-chat-dock'))problems.push('Doppelte Chat-Oberfläche');for(const id of ['jarvis','sensors','fans']){const b=document.querySelector('[data-view="'+id+'"]');b.click();if(!document.getElementById('view-'+id).classList.contains('active'))problems.push('Navigation '+id);}
  const data=await window.batto.suite('state');if(!data.fan?.state?.sensors.length)problems.push('IPC Messwerte');
  document.querySelector('[data-view="sensors"]').click();const sensor=document.querySelector('[data-sensor]');if(!sensor)problems.push('Sensorliste leer');else{sensor.click();if(document.getElementById('s-rule').hidden)problems.push('Regel nicht geöffnet');}
  document.querySelector('[data-view="fans"]').click();const tile=document.querySelector('[data-fan="uitestfan"]');if(!tile)problems.push('Lüfter fehlt');
  return {problems,sensors:data.fan.state.sensors.length,fan:!!tile,temperature:tile?.querySelector('.temp')?.textContent};
 })()`);
 if(checks.problems.length){fs.writeFileSync(path.join(dir,'failure.json'),JSON.stringify({checks,diagnostics,html:await window.webContents.executeJavaScript('document.getElementById("view-fans").innerHTML')},null,2));await runtime.close();throw Error(JSON.stringify(checks));}
 const answer=await runtime.jarvis.execute('CPU Auslastung');if(!answer.text.includes('Prozent'))throw Error('Gezielte CPU-Abfrage fehlgeschlagen');
 await window.webContents.insertCSS('.view{animation:none!important}');
 for(const view of ['jarvis','sensors','fans']){await window.webContents.executeJavaScript(`document.querySelector('[data-view="${view}"]').click()`);window.webContents.invalidate();await window.webContents.capturePage();await pause(300);fs.writeFileSync(path.join(dir,view+'.png'),(await window.webContents.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({checks,answer,diagnostics,sensors:runtime.fan.snapshot.sensors},null,2));await runtime.close();
 if(diagnostics.some(d=>d.includes('Uncaught')))throw Error('Uncaught renderer error: '+diagnostics.filter(d=>d.includes('Uncaught')).join('; '));
};
