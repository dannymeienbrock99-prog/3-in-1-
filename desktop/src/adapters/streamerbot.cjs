'use strict';
const WS=require('ws'),crypto=require('crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('base64');
class StreamerBotAdapter{
 constructor({getConfig,getPassword,onEvent=()=>{},onStatus=()=>{}}){Object.assign(this,{getConfig,getPassword,onEvent,onStatus});this.requests=new Map();this.executions=new Map();this.actions=[];this.events={};this.state={name:'streamerbot',connected:false,state:'idle'};this.retryCount=0;this.stopped=true;}
 status(){return {...this.state,actions:this.actions,events:this.events};}
 set(p){this.state={...this.state,...p};this.onStatus(this.status());}
 request(request,fields={},timeout=10000){return new Promise((resolve,reject)=>{if(this.socket?.readyState!==WS.OPEN)return reject(new Error('Streamer.bot ist nicht verbunden.'));const id=crypto.randomUUID();const timer=setTimeout(()=>{this.requests.delete(id);reject(new Error('Streamer.bot antwortet nicht auf '+request+'.'));},timeout);this.requests.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({request,id,...fields}));});}
 connect(){if(this.connecting)return this.connecting;if(this.state.connected)return Promise.resolve(this.status());this.stopped=false;clearTimeout(this.retry);this.set({state:'connecting',error:null});
 this.connecting=new Promise((resolve,reject)=>{let settled=false,timer;const done=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(this.status());};let ws;try{const u=new URL(this.getConfig().url);if(!['ws:','wss:'].includes(u.protocol))throw new Error('Streamer.bot benötigt eine WebSocket-Adresse.');ws=new WS(u,{handshakeTimeout:10000,maxPayload:2*1024*1024});}catch(e){done(e);return;}this.socket=ws;
 timer=setTimeout(()=>{done(new Error('Streamer.bot: kein gültiges Hello empfangen.'));ws.terminate();},15000);
 ws.on('message',async bytes=>{let p;try{p=JSON.parse(bytes.toString());}catch{this.set({error:'Streamer.bot: ungültiges JSON empfangen.'});return;}
 if(p.id&&this.requests.has(p.id)){const task=this.requests.get(p.id);clearTimeout(task.timer);this.requests.delete(p.id);p.status==='ok'?task.resolve(p):task.reject(new Error('Streamer.bot: '+(p.error||p.message||'Anfrage abgelehnt')));return;}
 if(p.request==='Hello'){try{if(p.info?.source!=='websocketServer')throw new Error('Kein Streamer.bot-WebSocket-Server.');this.set({version:p.info.version});if(p.authentication){const password=this.getPassword();if(!password)throw new Error('Streamer.bot verlangt das lokale Server-Passwort.');await this.request('Authenticate',{authentication:hash(hash(password+p.authentication.salt)+p.authentication.challenge)});}
 const ev=await this.request('GetEvents');this.events=ev.events||{};const requested={};const wanted={Twitch:['Follow','Cheer','Sub','ReSub','GiftSub','GiftBomb','Raid'],Streamlabs:['Donation'],StreamElements:['Tip'],Raw:['Action','ActionCompleted'],General:['Custom']};
 for(const [category,names] of Object.entries(this.events)){const selected=Object.keys(wanted).find(k=>k.toLowerCase()===category.toLowerCase());if(selected){const allowed=names.filter(n=>wanted[selected].includes(n));if(allowed.length)requested[category]=allowed;}}
 await this.request('Subscribe',{events:requested});await this.loadActions();this.retryCount=0;this.set({state:'connected',connected:true,error:null});done();}catch(e){this.set({state:'error',connected:false,error:e.message});done(e);ws.close();}return;}
 const custom=p.batto||(p.data?.batto);if(custom?.kind==='completion'){const pending=this.executions.get(custom.runId);if(pending&&custom.actionId===pending.actionId){this.executions.delete(custom.runId);clearTimeout(pending.timer);custom.ok===true?pending.resolve({ok:true,runId:custom.runId,completed:true}):pending.reject(new Error('Streamer.bot-Aktion meldet einen Fehler.'));}return;}
 if(custom?.kind==='event'){this.onEvent({bridge:true,...custom});return;}
 if(p.event)this.onEvent(p);
 });
 ws.on('error',e=>{this.set({state:'error',connected:false,error:'Streamer.bot: '+(e.code||e.message)});done(e);});
 ws.on('close',(code,reason)=>{if(ws!==this.socket)return;this.socket=null;this.set({connected:false,state:this.stopped?'stopped':'disconnected',closeCode:code,closeReason:String(reason)});done(new Error('Streamer.bot-Verbindung geschlossen.'));for(const r of this.requests.values()){clearTimeout(r.timer);r.reject(new Error('Streamer.bot-Verbindung verloren.'));}this.requests.clear();for(const r of this.executions.values()){clearTimeout(r.timer);r.reject(new Error('Ausführung nicht bestätigt: Verbindung verloren.'));}this.executions.clear();if(!this.stopped){this.retry=setTimeout(()=>this.connect().catch(()=>{}),[1000,2000,5000,10000,30000][Math.min(this.retryCount++,4)]);this.retry.unref?.();}});
 }).finally(()=>{this.connecting=null;});return this.connecting;}
 async loadActions(){const p=await this.request('GetActions');this.actions=(p.actions||[]).map(a=>({id:a.id,name:a.name,enabled:a.enabled===true}));return this.actions;}
 async execute(actionId,args={},signal,timeout=30000,options={}){await this.loadActions();const action=this.actions.find(a=>a.id===actionId);if(!action?.enabled)throw new Error('Streamer.bot-Aktion fehlt oder ist deaktiviert.');const runId=crypto.randomUUID();
 if(options.waitForCompletion!==true){
  if(signal?.aborted)throw new Error('Aktion abgebrochen.');
  // DoAction acknowledges queue acceptance. Ordinary actions do not emit our optional completion bridge.
  try{await this.request('DoAction',{action:{id:actionId},args:{...args,battoRunId:runId,battoActionId:actionId}},Math.min(30000,Math.max(1000,timeout)));}
  catch(error){error.retryable=false;throw error;}
  return {ok:true,accepted:true,completed:false,delivery:'unconfirmed',actionId,runId};
 }
 let rejectRun;
 const completion=new Promise((resolve,reject)=>{rejectRun=reject;const timer=setTimeout(()=>{this.executions.delete(runId);reject(new Error('Auftrag angenommen, aber Ausführung nicht bestätigt. Abschluss-Bridge in Streamer.bot prüfen.'));},timeout);this.executions.set(runId,{resolve,reject,timer,actionId});});
 // Attach immediately, including when a request fails before the completion waiter is awaited.
 completion.catch(()=>{});const cancel=()=>rejectRun(new Error('Batto hat das Warten abgebrochen. Eine bereits laufende Streamer.bot-Aktion kann extern weiterlaufen.'));
 if(signal?.aborted)cancel();signal?.addEventListener('abort',cancel,{once:true});
 try{if(signal?.aborted)throw new Error('Aktion abgebrochen.');await this.request('DoAction',{action:{id:actionId},args:{...args,battoRunId:runId,battoActionId:actionId}});return await completion;}finally{signal?.removeEventListener('abort',cancel);const pending=this.executions.get(runId);if(pending)clearTimeout(pending.timer);this.executions.delete(runId);}
 }
 disconnect(){this.stopped=true;clearTimeout(this.retry);this.socket?.close();this.set({connected:false,state:'stopped'});}
}
module.exports={StreamerBotAdapter,hash};
