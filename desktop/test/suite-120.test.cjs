const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FanAlertEngine}=require('../src/services/fan-alerts.cjs');
const {JarvisCore,cleanSettings}=require('../src/services/jarvis-core.cjs');
const {prepareImport,applyPending,status}=require('../src/services/obs-settings-import.cjs');
const {DEFAULT_CONFIG}=require('../src/core/config-store.cjs');
const config=()=>structuredClone(DEFAULT_CONFIG);
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'batto-120-'));
const settings=cleanSettings({}).fanAlerts;
function fan(value,time,extra={}){return {id:'link-1',name:'Oben links',announce:true,reference:['percent','rpm',2000],percent:{value,unit:'%',basis:'measured',fresh:true,updatedUtc:new Date(time).toISOString()},rpm:{value:1600,unit:'RPM',fresh:true,updatedUtc:new Date(time).toISOString()},...extra};}
test('80% crossing speaks once despite polling, source dropout and process restart',()=>{
 let e=new FanAlertEngine(),time=Date.now();const read=v=>e.evaluate([fan(v,time)],settings,time);
 assert.equal(read(79).length,0);assert.equal(read(80).length,1);
 for(let n=0;n<100;n++){time+=10000;assert.equal(read(99).length,0);}
 e.evaluate([],settings,time);e.evaluate([fan(90,time,{percent:{value:90,fresh:false}})],settings,time);
 e=new FanAlertEngine(e.snapshot());assert.equal(read(90).length,0);
 read(76);assert.equal(read(81).length,0);read(75);assert.equal(read(80).length,1);
});
test('threshold 75 and 95, per-fan opt-out, global switch and stale values',()=>{
 for(const threshold of [75,95]){const e=new FanAlertEngine(),now=Date.now(),s={...settings,threshold};assert.equal(e.evaluate([fan(threshold-1,now)],s,now).length,0);assert.equal(e.evaluate([fan(threshold,now)],s,now).length,1);}
 for(const row of [fan(99,Date.now()-16000),fan(99,Date.now(),{announce:false}),fan(101,Date.now()),fan(NaN,Date.now())])assert.equal(new FanAlertEngine().evaluate([row],settings).length,0);
 assert.equal(new FanAlertEngine().evaluate([fan(99,Date.now())],{...settings,enabled:false}).length,0);
});
test('new crossing respects cooldown; unrelated settings do not repeat high-fan message',()=>{
 let time=Date.now(),rows=[fan(80,time)],said=[];const core=new JarvisCore({directory:temp(),getFans:()=>rows,speak:t=>said.push(t),clock:()=>time});
 core.poll();assert.equal(said.length,1);assert.match(said[0],/^hohe Lüfterdrehzahl.*80 Prozent.*1.600 Umdrehungen/);
 core.update({chatCooldown:12});time+=10000;rows=[fan(95,time)];core.poll();assert.equal(said.length,1);
 rows=[fan(60,time)];core.poll();rows=[fan(81,time)];core.poll();assert.equal(said.length,1);
 time+=90000;rows=[fan(81,time)];core.poll();assert.equal(said.length,2);
});
test('fan query returns only requested fan speed unit, never GPU load or power',async()=>{
 const now=Date.now(),core=new JarvisCore({directory:temp(),getFans:()=>[fan(80,now)],getSensors:()=>[{id:'gpu',name:'GPU Auslastung',unit:'%',value:20,fresh:true,updatedUtc:new Date().toISOString()}]});
 assert.match((await core.execute('Lüfterdrehzahl')).text,/1.600 Umdrehungen pro Minute/);
 const percent=(await core.execute('Wie schnell sind die Lüfter in Prozent')).text;assert.match(percent,/80 Prozent/);assert.doesNotMatch(percent,/GPU|Watt|Umdrehungen/);
 assert.match((await core.execute('Oben links Drehzahl')).text,/1.600 Umdrehungen/);
});
test('import stages privately, preserves original, backs up suite and applies only once',()=>{
 const root=temp(),source=path.join(root,'original'),target=path.join(root,'suite'),original=path.join(source,'Batto-OBS-Tool'),dest=path.join(target,'Batto-OBS-Tool');fs.mkdirSync(path.join(original,'assets'),{recursive:true});fs.mkdirSync(dest,{recursive:true});
 const cfg=config();cfg.autoBroadcast.enabled=true;cfg.autoBroadcast.messages=['User broadcast'];cfg.streamerbot.autoConnect=true;cfg.http.port=17777;cfg.navigation.port=17778;
 cfg.appearance.programBackground=path.join(original,'assets','picture.jpg');fs.writeFileSync(path.join(original,'assets','picture.jpg'),'artwork');
 const raw=JSON.stringify(cfg);fs.writeFileSync(path.join(original,'settings.json'),raw);fs.writeFileSync(path.join(original,'secrets.bin'),'encrypted credentials');fs.writeFileSync(path.join(dest,'settings.json'),'old suite');
 prepareImport(source,target);assert.equal(fs.readFileSync(path.join(dest,'settings.json'),'utf8'),'old suite');assert(status(target).pending);
 const report=applyPending(target),copied=JSON.parse(fs.readFileSync(path.join(dest,'settings.json')));
 assert(copied.autoBroadcast.enabled);assert.deepEqual(copied.autoBroadcast.messages,['User broadcast']);assert(copied.streamerbot.autoConnect);assert.equal(copied.http.port,17787);assert.equal(copied.navigation.port,17788);
 assert.equal(copied.appearance.programBackground,path.join(dest,'assets','picture.jpg'));assert.equal(fs.readFileSync(path.join(dest,'secrets.bin'),'utf8'),'encrypted credentials');
 assert.equal(fs.readFileSync(path.join(target,report.backup,'settings.json'),'utf8'),'old suite');assert.equal(fs.readFileSync(path.join(original,'settings.json'),'utf8'),raw);assert.equal(applyPending(target),null);assert(status(target).ok);
});
test('damaged prepared import never replaces working settings',()=>{
 const root=temp(),source=path.join(root,'original'),target=path.join(root,'suite');fs.mkdirSync(path.join(source,'Batto-OBS-Tool'),{recursive:true});fs.mkdirSync(path.join(target,'Batto-OBS-Tool'),{recursive:true});fs.writeFileSync(path.join(source,'Batto-OBS-Tool/settings.json'),JSON.stringify(config()));fs.writeFileSync(path.join(target,'Batto-OBS-Tool/settings.json'),'keep');
 const stage=prepareImport(source,target);fs.appendFileSync(path.join(target,stage.stage,'settings.json'),'\n');assert.throws(()=>applyPending(target));assert.equal(fs.readFileSync(path.join(target,'Batto-OBS-Tool/settings.json'),'utf8'),'keep');
});
