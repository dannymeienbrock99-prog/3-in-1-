'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {WebSocket}=require('ws');
const {TouchPackages,relativeName,checkImage}=require('../src/services/touch-packages.cjs');
const {TouchPluginHost}=require('../src/services/touch-plugin-host.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX5cAAAAASUVORK5CYII=';
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return (crc^0xffffffff)>>>0;}
function zip(file,entries){let offset=0;const local=[],central=[];for(const entry of entries){const name=Buffer.from(entry.name),data=Buffer.from(entry.data||''),crc=crc32(data),a=Buffer.alloc(30),b=Buffer.alloc(46);a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt16LE(0x800,6);a.writeUInt32LE(crc,14);a.writeUInt32LE(data.length,18);a.writeUInt32LE(entry.size??data.length,22);a.writeUInt16LE(name.length,26);b.writeUInt32LE(0x02014b50);b.writeUInt16LE(0x314,4);b.writeUInt16LE(20,6);b.writeUInt16LE(0x800,8);b.writeUInt32LE(crc,16);b.writeUInt32LE(data.length,20);b.writeUInt32LE(entry.size??data.length,24);b.writeUInt16LE(name.length,28);b.writeUInt32LE(entry.attributes??0,38);b.writeUInt32LE(offset,42);local.push(a,name,data);central.push(b,name);offset+=a.length+name.length+data.length;}const center=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(center.length,12);end.writeUInt32LE(offset,16);fs.writeFileSync(file,Buffer.concat([...local,center,end]));return file;}
const manifest={UUID:'de.batto.test',Name:'Test Plugin',Version:'1.0.0.0',SDKVersion:2,CodePath:'plugin.exe',Actions:[{UUID:'de.batto.test.key',Name:'Zähler',PropertyInspectorPath:'ui.html',States:[{Image:'key'}]}]};
function plugin(file,extra=[]){return zip(file,[{name:'de.batto.test.sdPlugin/manifest.json',data:JSON.stringify(manifest)},{name:'de.batto.test.sdPlugin/plugin.exe',data:'fixture - not executable'},{name:'de.batto.test.sdPlugin/ui.html',data:'<html></html>'},{name:'de.batto.test.sdPlugin/key.png',data:Buffer.from(PNG.split(',')[1],'base64')},...extra]);}
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-touch-packages-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function until(predicate){for(let attempt=0;attempt<100;attempt++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Erwartetes Plugin-Ereignis fehlt.');}
function simulatedHost(t,{registerDelay=0}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-plugin-race-')),children=[],messages=[],converted=[];
 const definitions=new Map(['good','old'].map(id=>[id,{id,directory:dir,runtime:'exe',code:path.join(dir,'fixture.exe'),supported:true,manifest:{Version:'1.0'},actions:[{id:id+'.action',supported:true,states:[]}]}]));
 const packages={directory:dir,getPlugin(id){if(!definitions.has(id))throw Error('Plugin nicht installiert.');return definitions.get(id);},actionIcon:async()=>PNG,pluginImage:async(_id,value)=>{converted.push(value);return PNG;}};
 const host=new TouchPluginHost({packages,readyTimeout:2000,launchProcess(_exe,args){
  const child=new EventEmitter();children.push(child);child.killed=false;child.exitCode=null;let timer;
  const port=args[args.indexOf('-port')+1],uuid=args[args.indexOf('-pluginUUID')+1],socket=child.socket=new WebSocket('ws://127.0.0.1:'+port);
  socket.on('error',()=>{});socket.on('message',bytes=>messages.push(JSON.parse(bytes)));socket.on('open',()=>{if(!child.killed)timer=setTimeout(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({event:'registerPlugin',uuid}));},registerDelay);});
  child.kill=()=>{if(child.killed)return;child.killed=true;child.exitCode=0;clearTimeout(timer);socket.terminate();child.emit('exit',0);};return child;
 }});
 t.after(async()=>{await host.close();fs.rmSync(dir,{recursive:true,force:true});});return {host,children,messages,converted,definitions};
}
test('Paketimport beginnt keine Laufzeit; Metadaten und Iconbibliothek überleben Neustart',async t=>{
 const dir=temporary(t),packages=new TouchPackages({directory:path.join(dir,'installed')});await packages.importFile(plugin(path.join(dir,'p.streamDeckPlugin')));
 assert.equal(packages.list().plugins[0].supported,true);assert.equal(packages.list().plugins[0].actions[0].hasInspector,true);assert.equal(await packages.actionIcon(manifest.UUID,manifest.Actions[0].UUID),PNG);
 const pack=zip(path.join(dir,'icons.streamDeckIconPack'),[{name:'com.test.icons.sdIconPack/manifest.json',data:JSON.stringify({Name:'Eigene Icons',Version:'1.1'})},{name:'com.test.icons.sdIconPack/icons.json',data:JSON.stringify([{path:'one.png',name:'Traktor',tags:['LS25']},{path:'two.png',name:'Pause',tags:[]}])},{name:'com.test.icons.sdIconPack/icons/one.png',data:Buffer.from(PNG.split(',')[1],'base64')},{name:'com.test.icons.sdIconPack/icons/two.png',data:Buffer.from(PNG.split(',')[1],'base64')}]);
 await packages.importFile(pack);assert.equal(packages.icons({packId:'com.test.icons',query:'LS25'}).items[0].name,'Traktor');assert.equal(packages.icons({packId:'com.test.icons',limit:1}).items.length,1);assert.equal(await packages.icon({packId:'com.test.icons',iconId:'0'}),PNG);
 const reloaded=new TouchPackages({directory:packages.directory});assert.equal(reloaded.list().iconPacks[0].count,2);assert.equal(reloaded.list().plugins.length,1);assert.equal(reloaded.list().plugins[0].directory,undefined);assert.equal(packages.list().plugins[0].manifest,undefined);
});
test('Archive mit Pfadtricks, Symlinks, Duplikaten und Größenbomben werden vollständig abgelehnt',async t=>{
 const dir=temporary(t),packages=new TouchPackages({directory:path.join(dir,'installed')});
 for(const value of ['../escape','/root','C:/file','a\\b','a/../file','NUL.txt','trailing.','a:stream'])assert.throws(()=>relativeName(value));
 for(const [name,entry] of [['traversal',{name:'../escape',data:'no'}],['symlink',{name:'de.batto.test.sdPlugin/link',data:'../../escape',attributes:(0xa000<<16)>>>0}],['duplicate',{name:'de.batto.test.sdPlugin/KEY.PNG',data:'duplicate'}],['size',{name:'de.batto.test.sdPlugin/huge',data:'a',size:200*1024*1024}]]){
  await assert.rejects(packages.importFile(plugin(path.join(dir,name+'.streamDeckPlugin'),[entry])));assert.equal(packages.list().plugins.length,0);assert.equal(fs.readdirSync(packages.directory).filter(name=>name.startsWith('.import-')).length,0);
 }
 assert.equal(fs.existsSync(path.join(dir,'escape')),false);
});
test('Geschützte Marketplace-Manifeste und beschädigte Pakete werden klar gemeldet',async t=>{
 const dir=temporary(t),packages=new TouchPackages({directory:path.join(dir,'installed')});await packages.importFile(plugin(path.join(dir,'good.streamDeckPlugin')));
 await assert.rejects(packages.importFile(zip(path.join(dir,'protected.streamDeckPlugin'),[{name:'de.locked.sdPlugin/manifest.json',data:'ELGATOencrypted'}])),/geschützt/);
 fs.writeFileSync(path.join(dir,'bad.streamDeckPlugin'),'invalid');await assert.rejects(packages.importFile(path.join(dir,'bad.streamDeckPlugin')));assert.equal(packages.list().plugins.length,1);
});
test('Externe SVG-Inhalte werden vor der Bildkonvertierung gesperrt',()=>{
 assert.throws(()=>checkImage('data:image/svg+xml,'+encodeURIComponent('<svg><image href="https://example.com/private"/></svg>')),/externen/);
 assert.throws(()=>checkImage('data:image/svg+xml,'+encodeURIComponent('<svg><script>alert(1)</script></svg>')),/externen/);
 assert.equal(checkImage('data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')).startsWith('data:'),true);
});
test('Standard-Plugin: Registrierung, Taste, Anzeige, Inspector, private Einstellungen und bedarfsgerechtes Ende',async t=>{
 const dir=temporary(t),packages=new TouchPackages({directory:path.join(dir,'installed')});await packages.importFile(plugin(path.join(dir,'test.streamDeckPlugin')));
 const messages=[],visuals=[],children=[];let piSocket,piLaunch;
 const launchProcess=(exe,args,options)=>{
  assert.equal(options.windowsHide,true);assert.equal(options.shell,false);const child=new EventEmitter();children.push(child);const port=args[args.indexOf('-port')+1],uuid=args[args.indexOf('-pluginUUID')+1];
  child.socket=new WebSocket('ws://127.0.0.1:'+port);child.socket.on('error',()=>{});child.socket.on('open',()=>child.socket.send(JSON.stringify({event:'registerPlugin',uuid})));
  child.socket.on('message',bytes=>{const message=JSON.parse(bytes);messages.push(message);if(message.event==='keyDown'){
   child.socket.send(JSON.stringify({event:'setTitle',context:message.context,payload:{title:'Ausgeführt'}}));child.socket.send(JSON.stringify({event:'setImage',context:message.context,payload:{image:PNG}}));child.socket.send(JSON.stringify({event:'showOk',context:message.context}));
  }});child.kill=()=>{child.killed=true;child.socket.terminate();child.emit('exit',0);};return child;
 };
 const host=new TouchPluginHost({packages,launchProcess,onVisual:(id,patch)=>visuals.push({id,patch}),launchHtml:async value=>{
  piLaunch=value;piSocket=new WebSocket('ws://127.0.0.1:'+value.port);piSocket.on('error',()=>{});piSocket.on('open',()=>piSocket.send(JSON.stringify({event:'registerPropertyInspector',uuid:value.uuid})));return {close(){piSocket.close();value.onClose?.();}};
 }});t.after(()=>host.close());assert.equal(host.server,null);assert.equal(children.length,0);
 await host.sync([{id:'button-1',pluginId:manifest.UUID,actionId:manifest.Actions[0].UUID}]);await until(()=>messages.some(e=>e.event==='willAppear'));
 assert.equal(children.length,1);await host.press('button-1');await until(()=>host.visuals()['button-1'].feedback==='ok');assert.equal(host.visuals()['button-1'].title,'Ausgeführt');assert.equal(host.visuals()['button-1'].image,PNG);
 assert.equal(messages.filter(e=>e.event==='keyDown').length,1);await until(()=>messages.some(e=>e.event==='keyUp'));await host.inspector('button-1');await until(()=>piSocket.readyState===WebSocket.OPEN);
 assert.equal(piLaunch.kind,'inspector');assert.deepEqual(piLaunch.actionInfo.payload.settings,{});
 piSocket.send(JSON.stringify({event:'setSettings',context:piLaunch.uuid,payload:{apiToken:'PRIVATE_TEST_TOKEN',mode:'counter'}}));await until(()=>messages.some(e=>e.event==='didReceiveSettings'&&e.payload.settings.mode==='counter'));
 piSocket.send(JSON.stringify({event:'sendToPlugin',context:piLaunch.uuid,payload:{custom:'hello'}}));await until(()=>messages.some(e=>e.event==='sendToPlugin'&&e.payload.custom==='hello'));
 assert.equal(JSON.stringify(host.visuals()).includes('PRIVATE_TEST_TOKEN'),false);assert.equal(JSON.stringify(packages.list()).includes('PRIVATE_TEST_TOKEN'),false);
 await host.sync([]);assert.equal(children[0].killed,true);assert.equal(host.plugins.size,0);await host.close();
 const reloaded=new TouchPluginHost({packages,launchProcess});t.after(()=>reloaded.close());await reloaded.sync([{id:'button-1',pluginId:manifest.UUID,actionId:manifest.Actions[0].UUID}]);await until(()=>messages.filter(e=>e.event==='willAppear').length===2);assert.equal(messages.filter(e=>e.event==='willAppear')[1].payload.settings.apiToken,'PRIVATE_TEST_TOKEN');
});
test('Nicht registrierte Verbindungen können weder Einstellungen ändern noch Programme öffnen',async t=>{
 const dir=temporary(t),packages=new TouchPackages({directory:path.join(dir,'installed')}),host=new TouchPluginHost({packages,openExternal(){throw Error('must not open');}});t.after(()=>host.close());await host.startServer();
 const socket=new WebSocket('ws://127.0.0.1:'+host.port);await new Promise(resolve=>socket.once('open',resolve));socket.send(JSON.stringify({event:'setGlobalSettings',payload:{token:'should-not-save'}}));await new Promise(resolve=>socket.once('close',resolve));assert.deepEqual(host.stored.globals,{});
});
test('Die angehängten Batto- und LS25-Pakete sind tatsächlich importierbar', {skip:process.env.BATTO_REAL_PACKAGES!=='1'},async t=>{
 const dir=temporary(t),packages=new TouchPackages({directory:path.join(dir,'installed')});await packages.importFile('C:/Users/Batto/Downloads/de.crazybatto.suite (1).streamDeckPlugin');await packages.importFile('C:/Users/Batto/Downloads/LS25-Buttons-1.1.10.streamDeckIconPack');
 assert.equal(packages.list().plugins[0].actions.length,8);assert.equal(packages.list().plugins[0].supported,true);assert.equal(packages.list().iconPacks[0].count,84);assert.equal(packages.icons({packId:packages.list().iconPacks[0].id}).items.length,60);
});
test('Das echte Batto-EXE-Plugin zeigt Tastenbilder und bestätigt Aktionen am isolierten Testserver', {skip:process.env.BATTO_REAL_PLUGIN!=='1'},async t=>{
 const http=require('node:http'),{spawn}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-touch-exe-')),token='ab'.repeat(32),requests=[];let host;
 const server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);res.setHeader('Content-Type','application/json');if(req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{requests.push(JSON.parse(body));res.end(JSON.stringify({ok:true}));});}else res.end(JSON.stringify(req.url==='/api/catalog'?{actions:[]}:{generatedUtc:new Date().toISOString(),program:{scene:'Spiel'}}));});
 t.after(async()=>{await host?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(17666,'127.0.0.1',resolve);});const descriptor=path.join(dir,'bridge.json');fs.writeFileSync(descriptor,JSON.stringify({port:17666,token}));
 const packages=new TouchPackages({directory:path.join(dir,'installed')});await packages.importFile('C:/Users/Batto/Downloads/de.crazybatto.suite (1).streamDeckPlugin');
 host=new TouchPluginHost({packages,launchProcess:(exe,args,options)=>spawn(exe,args,{...options,env:{...options.env,BATTO_TEST_INSTANCE:'1',BATTO_TEST_BRIDGE:descriptor,FANATLAS_TEST_BRIDGE:path.join(dir,'no-fan-bridge.json')}})});
 await host.sync([{id:'listen',pluginId:'de.crazybatto.suite',actionId:'de.crazybatto.suite.listen'},{id:'pause',pluginId:'de.crazybatto.suite',actionId:'de.crazybatto.suite.scene'}]);
 await until(()=>host.visuals().listen?.image?.startsWith('data:image/png;'));await host.press('listen');await until(()=>host.visuals().listen?.feedback==='ok');await host.press('pause');await until(()=>host.visuals().pause?.feedback==='ok');
 assert.deepEqual(requests,[{action:'listen'},{action:'scene',target:'Pause'}]);assert.equal(Object.values(host.visuals()).some(v=>v.error),false);assert.equal(host.plugins.size,1);
});
test('Fehlende Plugins blockieren weder gültige Tasten noch das Beenden alter Prozesse',async t=>{
 const {host,children,messages}=simulatedHost(t);await host.sync([{id:'old-key',pluginId:'old',actionId:'old.action'}]);
 await host.sync([{id:'missing-key',pluginId:'missing',actionId:'missing.action'},{id:'good-key',pluginId:'good',actionId:'good.action'},{id:'missing-action',pluginId:'good',actionId:'good.removed'}]);
 assert.equal(children[0].killed,true);assert.equal(host.plugins.size,1);assert.equal(host.plugins.has('good'),true);assert.match(host.visuals()['missing-key'].error,/nicht installiert/);assert.match(host.visuals()['missing-action'].error,/fehlt/);
 await assert.rejects(host.press('missing-key'),/nicht installiert/);await host.press('good-key');await until(()=>messages.some(message=>message.event==='keyDown'&&message.action==='good.action'));
 assert.equal(messages.some(message=>message.event==='willAppear'&&message.action==='good.removed'),false);await host.sync([]);assert.equal(children[1].killed,true);
});
test('Parallele Tasten nach Plugin-Absturz teilen genau einen Neustart',async t=>{
 const {host,children,messages}=simulatedHost(t,{registerDelay:40});await host.sync([{id:'key',pluginId:'good',actionId:'good.action'}]);children[0].kill();await until(()=>!host.plugins.get('good').socket);
 await Promise.all([host.press('key'),host.press('key'),host.press('key')]);assert.equal(children.length,2);assert.equal(host.plugins.size,1);await until(()=>messages.filter(message=>message.event==='keyDown').length===3);
 await host.close();assert.equal(children.every(child=>child.killed),true);
});
test('Schließen bricht laufende Starts ab und lässt keine Prozesse oder Bildtimer zurück',async t=>{
 const {host,children}=simulatedHost(t,{registerDelay:1000});const started=host.sync([{id:'key',pluginId:'good',actionId:'good.action'}]);await until(()=>children.length===1);const before=Date.now();await host.close();await started;
 assert.ok(Date.now()-before<800);assert.equal(children[0].killed,true);assert.equal(host.starts.size,0);assert.equal(host.plugins.size,0);assert.equal(host.server,null);await assert.rejects(host.startPlugin('good'),/geschlossen/);
});
test('Plugin-Bildfluten werden vor der Konvertierung auf das neueste Bild begrenzt',async t=>{
 const {host,converted}=simulatedHost(t);await host.sync([{id:'key',pluginId:'good',actionId:'good.action'}]);const button=host.buttons.get('key'),owner={id:'good'};
 for(let index=0;index<100;index++)await host.message(owner,'plugin',{event:'setImage',context:button.context,payload:{image:'frame-'+index}});
 assert.equal(converted.length,0);await new Promise(resolve=>setTimeout(resolve,230));assert.deepEqual(converted,['frame-99']);
 for(let index=0;index<100;index++)await host.message(owner,'plugin',{event:'setImage',context:button.context,payload:{image:'frame-99'}});
 await new Promise(resolve=>setTimeout(resolve,230));assert.equal(converted.length,1);
 await host.message(owner,'plugin',{event:'setImage',context:button.context,payload:{image:'after-close'}});await host.sync([]);await new Promise(resolve=>setTimeout(resolve,230));assert.deepEqual(converted,['frame-99']);
});
test('Profilwechsel während eines erneuten Tastendruck-Starts beendet auch den noch startenden Prozess',async t=>{
 const {host,children,messages}=simulatedHost(t,{registerDelay:100});await host.sync([{id:'key',pluginId:'good',actionId:'good.action'}]);children[0].kill();await until(()=>!host.plugins.get('good').socket);
 const pending=host.press('key'),rejected=assert.rejects(pending,/nicht mehr benötigt|nicht mehr aktiv/);await until(()=>children.length===2);await host.sync([]);await rejected;
 assert.equal(children.every(child=>child.killed),true);assert.equal(host.plugins.size,0);assert.equal(host.starts.size,0);assert.equal(messages.some(message=>message.event==='keyDown'),false);
});
test('Plugin- und Inspector-Einstellungen bleiben an ihren eigenen Plugin- und Tastenkontext gebunden',async t=>{
 const {host}=simulatedHost(t);await host.sync([{id:'a',pluginId:'good',actionId:'good.action'},{id:'b',pluginId:'old',actionId:'old.action'}]);const a=host.buttons.get('a'),b=host.buttons.get('b');
 await host.message({id:'good'},'plugin',{event:'setSettings',context:b.context,payload:{token:'cannot-write-other-plugin'}});assert.deepEqual(b.settings,{});
 await host.message({buttonId:'a'},'inspector',{event:'setSettings',context:b.context,payload:{secret:'only-own-button'}});assert.equal(a.settings.secret,'only-own-button');assert.deepEqual(b.settings,{});
 await host.message({id:'good'},'plugin',{event:'setGlobalSettings',context:'old',payload:{secret:'only-own-plugin'}});assert.equal(host.stored.globals.good.secret,'only-own-plugin');assert.equal(host.stored.globals.old,undefined);
 assert.equal(JSON.stringify(host.visuals()).includes('only-own'),false);
});
