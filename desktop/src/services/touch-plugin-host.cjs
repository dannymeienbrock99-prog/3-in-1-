'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {WebSocketServer,WebSocket}=require('ws');
const {saveJson}=require('./touch-packages.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const DEVICE='batto-touch-deck';
function settings(value){if(!object(value)||Buffer.byteLength(JSON.stringify(value))>131072)throw Error('Plugin-Einstellungen sind ungültig oder zu groß.');return clone(value);}
function resolveNodeExecutable(plugin,{nodeExecutable=process.execPath,nodeRuntimeDirectory=process.env.APPDATA?path.join(process.env.APPDATA,'Elgato','StreamDeck','NodeJS'):null,nodeVersion=process.versions.node}={}){
 const required=plugin.manifest?.Nodejs?.Version;if(required===undefined)return nodeExecutable;
 if(typeof required!=='string'||!/^\d{1,3}$/.test(required))throw Error('Dieses Plugin fordert eine unbekannte Node.js-Laufzeit.');
 if(nodeVersion?.split('.')[0]===required)return nodeExecutable;
 if(nodeRuntimeDirectory)try{const root=fs.realpathSync(nodeRuntimeDirectory),versions=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&new RegExp('^'+required+'\\.\\d+\\.\\d+$').test(entry.name)).sort((a,b)=>{const av=a.name.split('.').map(Number),bv=b.name.split('.').map(Number);return bv[1]-av[1]||bv[2]-av[2];});for(const version of versions){const executable=path.join(root,version.name,'node.exe');try{if(fs.statSync(executable).isFile()&&fs.realpathSync(executable).startsWith(root+path.sep))return executable;}catch{}}}catch{}
 throw Error('Dieses Plugin benötigt Node.js '+required+'. Installiere diese Laufzeit über Elgato Stream Deck oder nutze das Plugin dort.');
}
class TouchPluginHost{
 constructor({packages,onVisual=()=>{},onSettings=()=>{},launchHtml,nodeExecutable=process.execPath,nodeRuntimeDirectory=process.env.APPDATA?path.join(process.env.APPDATA,'Elgato','StreamDeck','NodeJS'):null,nodeVersion=process.versions.node,launchProcess=spawn,openExternal,readyTimeout=10000}={}){
  if(!packages)throw Error('Paketverwaltung fehlt.');Object.assign(this,{packages,onVisual,onSettings,launchHtml,nodeExecutable,nodeRuntimeDirectory,nodeVersion,launchProcess,openExternal,readyTimeout});
  this.file=path.join(packages.directory,'touch-plugin-settings.json');this.stored={buttons:{},globals:{}};this.buttons=new Map();this.plugins=new Map();this.starts=new Map();this.inspectors=new Map();this.server=null;this.port=0;this.closed=false;this.queue=Promise.resolve();this.saving=null;this.closePromise=null;
  try{if(fs.statSync(this.file).size<=4*1024*1024){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(object(saved.buttons)&&object(saved.globals))this.stored=saved;}}catch{}
 }
 save(){if(this.saving||this.closed)return;this.saving=setTimeout(()=>{this.saving=null;try{saveJson(this.file,this.stored);}catch(error){for(const button of this.buttons.values())this.visual(button,{error:'Plugin-Einstellungen konnten nicht gespeichert werden: '+error.message});}},250);this.saving.unref?.();}
 store(group,key,value){const next={...this.stored,[group]:{...this.stored[group],[key]:value}};if(Buffer.byteLength(JSON.stringify(next))>4*1024*1024)throw Error('Der Speicher für Plugin-Einstellungen ist voll.');this.stored=next;this.save();}
 importSettingsByButton(value){
  if(this.closed)throw Error('Plugin-Steuerung ist geschlossen.');if(!object(value)||Object.keys(value).length>600)throw Error('Ungültige importierte Plugin-Einstellungen.');
  const next={...this.stored,buttons:{...this.stored.buttons}};let count=0;
  for(const [id,entry]of Object.entries(value)){
   if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||!object(entry)||typeof entry.pluginId!=='string'||!/^[a-zA-Z0-9_.-]{1,150}$/.test(entry.pluginId)||typeof entry.actionId!=='string'||!/^[a-zA-Z0-9_.-]{1,200}$/.test(entry.actionId))throw Error('Ungültige importierte Plugin-Zuordnung.');
   if(Object.hasOwn(next.buttons,id)||this.buttons.has(id))throw Error('Importierte Plugin-Tasten müssen neue Kennungen verwenden.');
   next.buttons[id]={pluginId:entry.pluginId,actionId:entry.actionId,settings:settings(entry.settings)};count++;
  }
  if(Buffer.byteLength(JSON.stringify(next))>4*1024*1024)throw Error('Der Speicher für Plugin-Einstellungen ist voll.');this.stored=next;this.save();return {count};
 }
 info(plugin){return {application:{font:'Segoe UI',language:'de',platform:'windows',platformVersion:'10.0',version:'6.9.0'},plugin:{uuid:plugin.id,version:plugin.manifest.Version||'1.0.0.0'},devicePixelRatio:1,colors:{buttonMouseOverBackgroundColor:'#C5A862',buttonPressedBackgroundColor:'#A88748',buttonPressedBorderColor:'#C5A862',buttonPressedTextColor:'#FFFFFF',highlightColor:'#C5A862'},devices:[{id:DEVICE,name:'Batto Touch Deck',type:0,size:{columns:8,rows:6}}]};}
 async startServer(){
  if(this.closed)throw Error('Plugin-Steuerung ist geschlossen.');if(this.server){if(this.serverStarting)await this.serverStarting;return;}
  const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:4*1024*1024,perMessageDeflate:false});this.server=server;
  server.on('connection',socket=>this.connect(socket));this.serverStarting=new Promise((resolve,reject)=>{server.once('listening',()=>{this.port=server.address().port;resolve();});server.once('error',reject);});try{await this.serverStarting;}catch(error){this.server=null;server.close();throw error;}finally{this.serverStarting=null;}
 }
 connect(socket){
  const timeout=setTimeout(()=>socket.close(1008,'Registrierung fehlt'),5000);timeout.unref?.();let owner=null,role='';
  socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(timeout);if(owner&&role==='plugin'&&owner.socket===socket)owner.socket=null;if(owner&&role==='inspector'&&owner.socket===socket)owner.socket=null;});
  socket.on('message',bytes=>{(async()=>{
   const message=JSON.parse(bytes.toString());if(!object(message))throw Error('Ungültige Plugin-Nachricht.');
   if(!owner){
    if(message.event==='registerPlugin'){
     owner=[...this.plugins.values()].find(p=>p.token===message.uuid&&!p.socket);if(!owner)throw Error('Unbekannte Plugin-Registrierung.');role='plugin';owner.socket=socket;owner.status='running';clearTimeout(timeout);
     this.send(socket,{event:'didReceiveGlobalSettings',payload:{settings:clone(this.stored.globals[owner.id]||{})}});
     for(const button of this.buttons.values())if(button.pluginId===owner.id&&!button.disabled)this.appear(button,owner);
     owner.resolve?.();owner.resolve=null;return;
    }
    if(message.event==='registerPropertyInspector'){
     owner=this.inspectors.get(message.uuid);if(!owner||owner.socket)throw Error('Unbekannte Plugin-Einstellungen.');role='inspector';owner.socket=socket;clearTimeout(timeout);
     const button=this.buttons.get(owner.buttonId);if(!button)throw Error('Taste nicht mehr vorhanden.');
     this.receiveSettings(socket,button);this.send(socket,{event:'didReceiveGlobalSettings',payload:{settings:clone(this.stored.globals[button.pluginId]||{})}});
     this.event(button,'propertyInspectorDidAppear');return;
    }throw Error('Plugin muss sich zuerst registrieren.');
   }
   await this.message(owner,role,message);
  })().catch(error=>{if(owner?.buttonId){const button=this.buttons.get(owner.buttonId);if(button)this.visual(button,{error:error.message});}if(!owner)socket.close(1008,'Ungültige Registrierung');});});
 }
 send(socket,value){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(value));return true;}return false;}
 event(button,event,payload={}){return this.send(this.plugins.get(button.pluginId)?.socket,{event,action:button.actionId,context:button.context,device:DEVICE,payload:{settings:clone(button.settings),coordinates:button.coordinates,controller:'Keypad',isInMultiAction:false,state:button.visual.state||0,...payload}});}
 appear(button,owner){this.event(button,'willAppear');if(!button.visual.image)this.packages.actionIcon(button.pluginId,button.actionId).then(image=>{if(image&&!button.visual.image)this.visual(button,{image});}).catch(()=>{});}
 visual(button,patch){if(this.closed||this.buttons.get(button.id)!==button)return;const next=Object.fromEntries(Object.entries(patch).filter(([key,value])=>button.visual[key]!==value));if(!Object.keys(next).length)return;Object.assign(button.visual,next);this.onVisual(button.id,clone(next));}
 visuals(){return Object.fromEntries([...this.buttons.values()].map(button=>[button.id,clone(button.visual)]));}
 receiveSettings(socket,button){this.send(socket,{event:'didReceiveSettings',action:button.actionId,context:button.context,device:DEVICE,payload:{settings:clone(button.settings),coordinates:button.coordinates,isInMultiAction:false}});}
 async message(owner,role,message){
  const pluginId=role==='plugin'?owner.id:this.buttons.get(owner.buttonId)?.pluginId;if(!pluginId)return;
  const button=role==='inspector'?this.buttons.get(owner.buttonId):[...this.buttons.values()].find(b=>b.context===message.context&&b.pluginId===pluginId);
  const payload=message.payload;
  switch(message.event){
   case 'getGlobalSettings':this.send(owner.socket,{event:'didReceiveGlobalSettings',payload:{settings:clone(this.stored.globals[pluginId]||{})}});return;
   case 'setGlobalSettings':{
    this.store('globals',pluginId,settings(payload));const event={event:'didReceiveGlobalSettings',payload:{settings:clone(payload)}};this.send(this.plugins.get(pluginId)?.socket,event);for(const inspector of this.inspectors.values())if(this.buttons.get(inspector.buttonId)?.pluginId===pluginId)this.send(inspector.socket,event);return;
   }
   case 'getSettings':if(button)this.receiveSettings(owner.socket,button);return;
   case 'setSettings':if(button){const next=settings(payload);this.store('buttons',button.id,{pluginId,actionId:button.actionId,settings:next});button.settings=next;this.event(button,'didReceiveSettings');for(const inspector of this.inspectors.values())if(inspector.buttonId===button.id)this.receiveSettings(inspector.socket,button);this.onSettings(button.id);}return;
   case 'sendToPlugin':if(role==='inspector'&&button)this.event(button,'sendToPlugin',object(payload)?payload:{});return;
   case 'sendToPropertyInspector':if(role==='plugin'&&button)for(const inspector of this.inspectors.values())if(inspector.buttonId===button.id)this.send(inspector.socket,{event:'sendToPropertyInspector',action:button.actionId,context:button.context,payload});return;
   case 'openUrl':if(role==='plugin'&&typeof payload?.url==='string'&&/^https?:\/\//i.test(payload.url))await this.openExternal?.(payload.url);return;
   case 'getProfiles':this.send(owner.socket,{event:'didReceiveProfiles',payload:{profiles:[]}});return;
   case 'logMessage':return;
  }
  if(role!=='plugin'||!button)return;
  switch(message.event){
   case 'setTitle':if(typeof payload?.title==='string')this.visual(button,{title:payload.title.slice(0,300)});break;
   case 'setImage':if(typeof payload?.image==='string'){button.nextImage=payload.image;this.scheduleImage(button);}break;
   case 'setState':if(Number.isInteger(payload?.state)&&payload.state>=0&&payload.state<32){this.visual(button,{state:payload.state});try{const image=await this.packages.actionIcon(pluginId,button.actionId,payload.state);if(image)this.visual(button,{image});}catch{}}break;
   case 'showOk':this.visual(button,{feedback:'ok',feedbackAt:Date.now(),error:''});break;
   case 'showAlert':this.visual(button,{feedback:'alert',feedbackAt:Date.now(),error:'Das Plugin meldet einen Fehler. Bitte seine Einstellungen prüfen.'});break;
  }
 }
 scheduleImage(button){
  if(this.closed||button.imageTimer||button.rendering||this.buttons.get(button.id)!==button)return;
  button.imageTimer=setTimeout(()=>{button.imageTimer=null;void this.images(button);},200);button.imageTimer.unref?.();
 }
 async images(button){
  if(this.closed||button.rendering||this.buttons.get(button.id)!==button||button.nextImage===undefined)return;
  button.rendering=true;const image=button.nextImage;delete button.nextImage;
  try{const hash=crypto.createHash('sha256').update(image).digest('hex');if(hash!==button.lastImageHash){const converted=await this.packages.pluginImage(button.pluginId,image);button.lastImageHash=hash;this.visual(button,{image:converted});}}catch(error){this.visual(button,{error:error.message});}
  finally{button.rendering=false;if(button.nextImage!==undefined)this.scheduleImage(button);}
 }
 sync(buttons){const work=()=>this.synchronize(buttons);this.queue=this.queue.then(work,work);return this.queue;}
 async synchronize(assignments){
  if(this.closed)return;if(!Array.isArray(assignments)||assignments.length>600)throw Error('Zu viele Plugin-Tasten.');const desired=new Map(),needed=new Set();
  for(const value of assignments){
   if(!object(value)||typeof value.id!=='string'||value.id.length>80||desired.has(value.id))throw Error('Ungültige Plugin-Taste.');
   try{const plugin=this.packages.getPlugin(value.pluginId),action=plugin.actions.find(a=>a.id===value.actionId);if(!plugin.supported||!action?.supported)throw Error(plugin.supported?'Diese Plugin-Aktion fehlt oder benötigt eine andere Bedienfläche.':plugin.compatibility);if(!needed.has(value.pluginId)&&needed.size>=12)throw Error('Höchstens zwölf Plugins können gleichzeitig laufen.');needed.add(value.pluginId);desired.set(value.id,{...value,plugin});}
   catch(error){desired.set(value.id,{...value,error:error.message});}
  }
  for(const [id,button] of this.buttons){const next=desired.get(id);if(!next||next.pluginId!==button.pluginId||next.actionId!==button.actionId||!!next.error!==!!button.disabled){if(!button.disabled)this.event(button,'willDisappear');this.closeInspector(button);clearTimeout(button.imageTimer);this.buttons.delete(id);}}
  for(const value of desired.values())if(!this.buttons.has(value.id)){
   const stored=Object.prototype.hasOwnProperty.call(this.stored.buttons,value.id)?this.stored.buttons[value.id]:null;
   const config=stored?.pluginId===value.pluginId&&stored.actionId===value.actionId?stored.settings:{};let saved;try{saved=settings(config);}catch{saved={};}
   const button={id:value.id,pluginId:value.pluginId,actionId:value.actionId,context:crypto.randomUUID().replaceAll('-',''),settings:saved,visual:{},disabled:!!value.error,coordinates:object(value.coordinates)?{column:Number(value.coordinates.column)||0,row:Number(value.coordinates.row)||0}:{column:0,row:0}};this.buttons.set(button.id,button);
   if(value.error)this.visual(button,{error:value.error});else if(this.plugins.get(button.pluginId)?.socket)this.appear(button,this.plugins.get(button.pluginId));
  }
  for(const value of desired.values()){const button=this.buttons.get(value.id);if(value.error){this.visual(button,{error:value.error});continue;}const coordinates=object(value.coordinates)?{column:Number(value.coordinates.column)||0,row:Number(value.coordinates.row)||0}:{column:0,row:0};if(JSON.stringify(coordinates)!==JSON.stringify(button.coordinates)){this.event(button,'willDisappear');button.coordinates=coordinates;this.appear(button,this.plugins.get(button.pluginId));}}
  for(const id of new Set([...this.plugins.keys(),...this.starts.keys()]))if(!needed.has(id))await this.stopPlugin(id);
  for(const id of needed){const installed=this.packages.getPlugin(id),current=this.plugins.get(id);if(current&&current.directory!==installed.directory)await this.stopPlugin(id);try{await this.startPlugin(id);}catch(error){for(const button of this.buttons.values())if(button.pluginId===id)this.visual(button,{error:error.message});}}
 }
 async startPlugin(id){
  if(this.closed)throw Error('Plugin-Steuerung ist geschlossen.');if(this.starts.has(id))return this.starts.get(id);
  const starting=this.launchPlugin(id);this.starts.set(id,starting);try{return await starting;}finally{if(this.starts.get(id)===starting)this.starts.delete(id);}
 }
 async launchPlugin(id){
  const previous=this.plugins.get(id);if(previous?.socket?.readyState===WebSocket.OPEN)return;if(previous)await this.stopRecord(previous);await this.startServer();if(this.closed)throw Error('Plugin-Steuerung ist geschlossen.');if(![...this.buttons.values()].some(button=>button.pluginId===id&&!button.disabled))throw Error('Plugin wird nicht mehr benötigt.');
  const plugin=this.packages.getPlugin(id);if(!plugin.supported)throw Error(plugin.compatibility);
  const record={id,directory:plugin.directory,token:crypto.randomUUID().replaceAll('-',''),socket:null,child:null,window:null,status:'starting'};this.plugins.set(id,record);
  const info=this.info(plugin),args=['-port',String(this.port),'-pluginUUID',record.token,'-registerEvent','registerPlugin','-info',JSON.stringify(info)];
  let timeout;const ready=new Promise((resolve,reject)=>{record.resolve=resolve;record.reject=reject;timeout=setTimeout(()=>reject(Error(plugin.name+' konnte keine Verbindung zum Touch Deck herstellen.')),this.readyTimeout);});
  // Attach rejection handling before launching a process, which can fail immediately.
  ready.catch(()=>{});
  try{
   if(plugin.runtime==='html'){if(!this.launchHtml)throw Error('HTML-Plugins benötigen die Batto-Desktop-App.');const launch=Promise.resolve(this.launchHtml({file:plugin.code,args,kind:'plugin',port:this.port,uuid:record.token,registerEvent:'registerPlugin',info,pluginDirectory:plugin.directory})).then(window=>{if(this.closed||this.plugins.get(id)!==record){window?.close?.();throw Error('Plugin-Start wurde beendet.');}record.window=window;});await Promise.race([launch,ready]);}
   else{
    const executable=plugin.runtime==='node'?resolveNodeExecutable(plugin,this):plugin.code,arguments_=plugin.runtime==='node'?[plugin.code,...args]:args;
    const environment={...process.env};if(plugin.runtime==='node'){if(process.versions.electron&&executable===this.nodeExecutable)environment.ELECTRON_RUN_AS_NODE='1';else delete environment.ELECTRON_RUN_AS_NODE;}
    record.child=this.launchProcess(executable,arguments_,{cwd:plugin.directory,windowsHide:true,shell:false,stdio:'ignore',env:environment});
    record.child.on('error',error=>record.reject?.(Error(plugin.name+': '+error.message)));record.child.on('exit',()=>{record.status='stopped';record.reject?.(Error(plugin.name+' wurde beendet.'));if(this.plugins.get(id)===record)for(const button of this.buttons.values())if(button.pluginId===id)this.visual(button,{error:'Plugin wurde beendet. Taste erneut drücken, um es zu starten.'});});
   }
   await ready;record.reject=null;
  }catch(error){await this.stopRecord(record);throw error;}finally{clearTimeout(timeout);}
 }
 async press(buttonId){
  await this.queue;const button=this.buttons.get(buttonId);if(!button)throw Error('Diese Plugin-Taste ist nicht aktiv.');if(button.disabled)throw Error(button.visual.error);await this.startPlugin(button.pluginId);
  if(this.closed||this.buttons.get(buttonId)!==button)throw Error('Diese Plugin-Taste ist nicht mehr aktiv.');this.visual(button,{error:''});if(!this.event(button,'keyDown'))throw Error('Plugin ist nicht verbunden.');this.event(button,'keyUp');return {ok:true,type:'plugin',delivered:true};
 }
 async inspector(buttonId){
  await this.queue;const button=this.buttons.get(buttonId);if(!button)throw Error('Diese Plugin-Taste ist nicht aktiv.');if(button.disabled)throw Error(button.visual.error);await this.startPlugin(button.pluginId);
  if(this.closed||this.buttons.get(buttonId)!==button)throw Error('Diese Plugin-Taste ist nicht mehr aktiv.');const plugin=this.packages.getPlugin(button.pluginId),action=plugin.actions.find(a=>a.id===button.actionId);if(!action?.inspector)throw Error('Dieses Plugin stellt für die Taste kein Einstellungsfenster bereit.');if(!this.launchHtml)throw Error('Plugin-Einstellungen benötigen die Batto-Desktop-App.');
  this.closeInspector(button);const record={buttonId,window:null,socket:null};this.inspectors.set(button.context,record);
  const info=this.info(plugin),actionInfo={action:button.actionId,context:button.context,device:DEVICE,payload:{settings:clone(button.settings),coordinates:button.coordinates,isInMultiAction:false}};
  const args=['-port',String(this.port),'-pluginUUID',button.context,'-registerEvent','registerPropertyInspector','-info',JSON.stringify(info),'-actionInfo',JSON.stringify(actionInfo)];
  try{record.window=await this.launchHtml({buttonId,file:action.inspector,args,kind:'inspector',port:this.port,uuid:button.context,registerEvent:'registerPropertyInspector',info,actionInfo,pluginDirectory:plugin.directory,onClose:()=>{if(this.inspectors.get(button.context)===record){this.event(button,'propertyInspectorDidDisappear');record.socket?.close();this.inspectors.delete(button.context);}}});return {ok:true};}catch(error){this.inspectors.delete(button.context);throw error;}
 }
 closeInspector(button){const record=this.inspectors.get(button.context);if(!record)return;this.event(button,'propertyInspectorDidDisappear');this.inspectors.delete(button.context);record.socket?.close();record.window?.close?.();}
 async stopPlugin(id){const pending=this.starts.get(id);if(pending){this.plugins.get(id)?.reject?.(Error('Plugin wird nicht mehr benötigt.'));await pending.catch(()=>{});}const record=this.plugins.get(id);if(record)await this.stopRecord(record);}
 async stopRecord(record){if(this.plugins.get(record.id)===record)this.plugins.delete(record.id);for(const button of this.buttons.values())if(button.pluginId===record.id){this.closeInspector(button);clearTimeout(button.imageTimer);button.imageTimer=null;delete button.nextImage;}record.socket?.close();record.window?.close?.();record.reject=null;if(record.child&&!record.child.killed&&record.child.exitCode==null)await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);resolve();};record.child.once('exit',done);timer=setTimeout(done,1500);record.child.kill();});}
 close(){
  if(this.closePromise)return this.closePromise;this.closed=true;for(const record of this.plugins.values())record.reject?.(Error('Plugin-Steuerung wird geschlossen.'));
  this.closePromise=(async()=>{await this.queue.catch(()=>{});await Promise.allSettled([...this.starts.values()]);for(const button of this.buttons.values()){this.event(button,'willDisappear');clearTimeout(button.imageTimer);}for(const id of [...this.plugins.keys()])await this.stopPlugin(id);this.buttons.clear();clearTimeout(this.saving);this.saving=null;saveJson(this.file,this.stored);if(this.server){for(const socket of this.server.clients)socket.terminate();await new Promise(resolve=>this.server.close(resolve));this.server=null;this.port=0;}})();return this.closePromise;
 }
}
module.exports={TouchPluginHost,resolveNodeExecutable};
