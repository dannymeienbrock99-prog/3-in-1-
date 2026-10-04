'use strict';
const WS=require('ws'),crypto=require('crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('base64');
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
const text=(...values)=>values.find(value=>typeof value==='string'&&value.trim())?.trim()||'';
const WANTED={Twitch:['ChatMessage','Follow','Cheer','Sub','ReSub','GiftSub','GiftBomb','Raid'],YouTube:['Message'],Streamlabs:['Donation'],StreamElements:['Tip'],Raw:['Action','ActionCompleted'],General:['Custom']};
function eventSubscriptions(events){
 if(!record(events))throw Error('Streamer.bot hat keine gültige Ereignisliste geliefert.');
 const requested=[],catalog=[];
 for(const [category,names]of Object.entries(events)){
  if(!Array.isArray(names)||names.some(name=>typeof name!=='string'||!name||name.length>150))throw Error('Streamer.bot hat eine beschädigte Ereignisliste geliefert.');
  catalog.push([category,[...new Set(names)]]);
  const wanted=Object.keys(WANTED).find(name=>name.toLowerCase()===category.toLowerCase());
  if(wanted){const selected=names.filter(name=>WANTED[wanted].includes(name));if(selected.length)requested.push([category,[...new Set(selected)]]);}
 }
 return {events:Object.fromEntries(catalog),requested:Object.fromEntries(requested)};
}
function normalizeStreamerBotChat(packet){
 const source=text(packet?.event?.source).toLowerCase(),kind=text(packet?.event?.type).toLowerCase();
 if(!(source==='twitch'&&kind==='chatmessage'||source==='youtube'&&kind==='message'))return null;
 const data=record(packet.data);if(!data||data.isTest===true||data.meta?.isTest===true||data.meta?.internal===true)return null;
 const legacy=record(data.message)||{},user=record(data.user)||legacy;
 const message=text(data.text,typeof data.message==='string'?data.message:'',legacy.message,legacy.text);
 if(!message)return null;
 const userId=text(user.id,user.userId),identityVerified=source==='twitch'?/^\d{1,30}$/.test(userId):/^UC[\w-]{20,30}$/.test(userId);
 const channelId=source==='twitch'?text(data.broadcaster?.id,data.channelId,legacy.channelId):text(data.broadcast?.liveChatId,data.liveChatId);
 const ownerId=source==='twitch'?channelId:text(data.broadcast?.channelId);
 const badges=(Array.isArray(user.badges)?user.badges:[]).map(badge=>text(typeof badge==='string'?badge:'',badge?.name,badge?.set_id).toLowerCase().split('/')[0]).filter(Boolean);
 const isBroadcaster=identityVerified&&(user.isBroadcaster===true||source==='youtube'&&user.isOwner===true||!!ownerId&&userId===ownerId||source==='twitch'&&!data.isFromSharedChatGuest&&badges.includes('broadcaster'));
 const moderator=identityVerified&&(user.isModerator===true||user.moderator===true||badges.includes('moderator'));
 const username=text(user.login,user.username,legacy.username,user.name)||'Unknown',stamp=text(data.createdAt,data.publishedAt,packet.timeStamp,packet.timestamp);
 const trustedBadges=badges.filter(name=>(name!=='moderator'||moderator)&&(name!=='broadcaster'||isBroadcaster));
 return {platform:source,id:text(data.messageId,data.eventId,legacy.messageId,legacy.msgId)||undefined,userId:userId||'unknown',channelId,identityVerified,username,displayName:text(user.name,user.displayName,legacy.displayName,username),message,timestamp:Number.isFinite(Date.parse(stamp))?new Date(stamp).toISOString():new Date().toISOString(),badges:trustedBadges,moderator,isBroadcaster,raw:packet};
}
class StreamerBotAdapter{
 constructor({getConfig,getPassword,onEvent=()=>{},onChat=()=>{},onStatus=()=>{},WebSocketImpl=WS}){Object.assign(this,{getConfig,getPassword,onEvent,onChat,onStatus,WebSocketImpl});this.requests=new Map();this.executions=new Map();this.actions=[];this.events={};this.state={name:'streamerbot',connected:false,state:'idle'};this.retryCount=0;this.stopped=true;this.generation=0;}
 status(){return {...this.state,actions:this.actions,events:this.events};}
 set(p){this.state={...this.state,...p};this.onStatus(this.status());}
 rejectPending(socket,error){
  for(const [id,task]of this.requests)if(!socket||task.socket===socket){clearTimeout(task.timer);this.requests.delete(id);task.reject(error);}
  for(const [id,task]of this.executions)if(!socket||task.socket===socket){clearTimeout(task.timer);this.executions.delete(id);task.reject(new Error('Ausführung nicht bestätigt: '+error.message));}
 }
 request(request,fields={},timeout=10000,socket=this.socket){
  return new Promise((resolve,reject)=>{
   if(!socket||socket!==this.socket||socket.readyState!==WS.OPEN)return reject(new Error('Streamer.bot ist nicht verbunden.'));
   const id=crypto.randomUUID(),fail=error=>{const pending=this.requests.get(id);if(!pending)return;clearTimeout(pending.timer);this.requests.delete(id);pending.reject(error);};
   const timer=setTimeout(()=>fail(new Error('Streamer.bot antwortet nicht auf '+request+'.')),timeout);
   this.requests.set(id,{resolve,reject,timer,socket});
   try{socket.send(JSON.stringify({...fields,request,id}),error=>{if(error)fail(new Error('Streamer.bot-Anfrage konnte nicht gesendet werden.'));});}catch{fail(new Error('Streamer.bot-Anfrage konnte nicht gesendet werden.'));}
  });
 }
 connect(){
  if(this.connecting)return this.connecting;
  if(this.state.connected&&this.socket?.readyState===WS.OPEN)return Promise.resolve(this.status());
  this.stopped=false;clearTimeout(this.retry);const generation=++this.generation;this.set({state:'connecting',connected:false,error:null});
  const operation=new Promise((resolve,reject)=>{
   let settled=false,timer,hello=false,ws;
   const done=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(this.status());};
   this.connectionDone=done;
   try{const url=new URL(this.getConfig().url);if(!['ws:','wss:'].includes(url.protocol))throw Error('Streamer.bot benötigt eine WebSocket-Adresse.');ws=new this.WebSocketImpl(url,{handshakeTimeout:10000,maxPayload:2*1024*1024});}catch(error){this.set({state:'error',connected:false,error:error.message});done(error);return;}
   this.socket=ws;const current=()=>ws===this.socket&&generation===this.generation;
   const fail=error=>{if(!current())return;this.set({state:'error',connected:false,error:error.message});this.rejectPending(ws,error);done(error);ws.terminate();};
   timer=setTimeout(()=>fail(new Error('Streamer.bot: kein gültiges Hello empfangen.')),15000);
   ws.on('message',async bytes=>{
    if(!current())return;
    let packet;try{packet=JSON.parse(bytes.toString());if(!record(packet))throw Error();}catch{this.set({error:'Streamer.bot: ungültiges JSON empfangen.'});return;}
    const task=this.requests.get(packet.id);
    if(task&&task.socket===ws){clearTimeout(task.timer);this.requests.delete(packet.id);packet.status==='ok'?task.resolve(packet):task.reject(new Error('Streamer.bot: '+text(packet.error,packet.message,'Anfrage abgelehnt')));return;}
    if(packet.request==='Hello'){
     if(hello)return;hello=true;
     try{
      if(packet.info?.source!=='websocketServer')throw Error('Kein Streamer.bot-WebSocket-Server.');
      this.set({version:typeof packet.info.version==='string'?packet.info.version:''});
      if(packet.authentication){
       const auth=record(packet.authentication);if(!auth||typeof auth.salt!=='string'||typeof auth.challenge!=='string')throw Error('Streamer.bot hat keine gültige Passwort-Abfrage geliefert.');
       const password=await this.getPassword?.();if(!current())return;if(typeof password!=='string'||!password)throw Error('Streamer.bot verlangt das lokale Server-Passwort.');
       await this.request('Authenticate',{authentication:hash(hash(password+auth.salt)+auth.challenge)},10000,ws);if(!current())return;
      }
      const result=await this.request('GetEvents',{},10000,ws);if(!current())return;
      const catalog=eventSubscriptions(result.events);this.events=catalog.events;
      await this.request('Subscribe',{events:catalog.requested},10000,ws);if(!current())return;
      await this.loadActions(ws);if(!current())return;
      this.retryCount=0;this.set({state:'connected',connected:true,error:null});done();
     }catch(error){fail(error);}return;
    }
    if(!this.state.connected)return;
    try{
     const custom=record(packet.batto)||record(packet.data?.batto);
     if(custom?.kind==='completion'){
      const pending=this.executions.get(custom.runId);
      if(pending&&pending.socket===ws&&custom.actionId===pending.actionId){this.executions.delete(custom.runId);clearTimeout(pending.timer);custom.ok===true?pending.resolve({ok:true,runId:custom.runId,completed:true}):pending.reject(new Error('Streamer.bot-Aktion meldet einen Fehler.'));}return;
     }
     if(custom?.kind==='event'){this.onEvent({...custom,bridge:true});return;}
     const chat=normalizeStreamerBotChat(packet);if(chat){this.onChat(chat,'streamerbot-chat');return;}
     if(packet.event)this.onEvent(packet);
    }catch{this.set({error:'Streamer.bot-Ereignis konnte nicht verarbeitet werden.'});}
   });
   ws.on('error',error=>fail(new Error('Streamer.bot: '+(error.code||error.message))));
   ws.on('close',(code,reason)=>{
    if(!current())return;this.socket=null;clearTimeout(timer);this.set({connected:false,state:this.stopped?'stopped':'disconnected',closeCode:code,closeReason:String(reason)});
    const error=new Error('Streamer.bot-Verbindung verloren.');done(error);this.rejectPending(ws,error);
    if(!this.stopped){this.retry=setTimeout(()=>this.connect().catch(()=>{}),[1000,2000,5000,10000,30000][Math.min(this.retryCount++,4)]);this.retry.unref?.();}
   });
  });
  this.connecting=operation.finally(()=>{if(generation===this.generation){this.connecting=null;this.connectionDone=null;}});return this.connecting;
 }
 async loadActions(socket=this.socket){
  const result=await this.request('GetActions',{},10000,socket);if(socket!==this.socket)throw Error('Streamer.bot-Verbindung hat sich geändert.');
  if(!Array.isArray(result.actions)||result.actions.some(action=>!record(action)||typeof action.id!=='string'||!action.id||typeof action.name!=='string'||typeof action.enabled!=='boolean'))throw Error('Streamer.bot hat eine beschädigte Aktionsliste geliefert.');
  this.actions=result.actions.map(action=>({id:action.id,name:action.name,enabled:action.enabled}));return this.actions;
 }
 async execute(actionId,args={},signal,timeout=30000,options={}){
  const socket=this.socket;if(!this.state.connected)throw Error('Streamer.bot ist nicht verbunden.');
  await this.loadActions(socket);const action=this.actions.find(item=>item.id===actionId);if(!action?.enabled)throw Error('Streamer.bot-Aktion fehlt oder ist deaktiviert.');const runId=crypto.randomUUID();
  if(options.waitForCompletion!==true){
   if(signal?.aborted)throw Error('Aktion abgebrochen.');
   // DoAction confirms queue acceptance. Completion requires the optional bridge.
   try{await this.request('DoAction',{action:{id:actionId},args:{...args,battoRunId:runId,battoActionId:actionId}},Math.min(30000,Math.max(1000,timeout)),socket);}catch(error){error.retryable=false;throw error;}
   return {ok:true,accepted:true,completed:false,delivery:'unconfirmed',actionId,runId};
  }
  let rejectRun;
  const completion=new Promise((resolve,reject)=>{rejectRun=reject;const timer=setTimeout(()=>{this.executions.delete(runId);reject(Error('Auftrag angenommen, aber Ausführung nicht bestätigt. Abschluss-Bridge in Streamer.bot prüfen.'));},timeout);this.executions.set(runId,{resolve,reject,timer,actionId,socket});});
  completion.catch(()=>{});const cancel=()=>rejectRun(Error('Batto hat das Warten abgebrochen. Eine bereits laufende Streamer.bot-Aktion kann extern weiterlaufen.'));
  if(signal?.aborted)cancel();signal?.addEventListener('abort',cancel,{once:true});
  try{if(signal?.aborted)throw Error('Aktion abgebrochen.');await this.request('DoAction',{action:{id:actionId},args:{...args,battoRunId:runId,battoActionId:actionId}},10000,socket);return await completion;}finally{signal?.removeEventListener('abort',cancel);const pending=this.executions.get(runId);if(pending)clearTimeout(pending.timer);this.executions.delete(runId);}
 }
 disconnect(){
  this.stopped=true;clearTimeout(this.retry);const socket=this.socket;this.socket=null;this.generation++;
  this.connectionDone?.(Error('Streamer.bot-Verbindung wurde getrennt.'));this.connectionDone=null;this.connecting=null;
  this.rejectPending(null,Error('Streamer.bot-Verbindung wurde getrennt.'));
  if(socket){try{socket.close();}catch{socket.terminate();}}
  this.set({connected:false,state:'stopped'});
 }
}
module.exports={StreamerBotAdapter,hash,eventSubscriptions,normalizeStreamerBotChat};
