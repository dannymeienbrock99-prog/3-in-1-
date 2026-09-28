'use strict';
const path=require('node:path');
const crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const clean=(value,max=1000)=>String(value??'').slice(0,max);
function archiveConfig(value={}) { return {enabled:value.enabled===true,moderationEnabled:value.moderationEnabled!==false,excerptsEnabled:value.excerptsEnabled===true,directory:clean(value.directory,2000),retentionDays:Math.max(0,Math.min(36500,Math.trunc(Number(value.retentionDays)||0)))}; }
function chatRecord(event, session, channelHint='') {
  if(event.type!=='chat')return null;
  const raw=event.meta?.rawData||event.raw||{}, data=raw.data||raw, user=event.user||{};
  const text=clean(event.message?.text??event.message??event.text,200000); if(!text)return null;
  const channelId=clean(event.channelId||event.channel?.id||data.channelId||data.roomId||data.room_id||raw.snippet?.liveChatId||channelHint,300);
  const userId=clean(user.id||event.userId,300);
  return {platform:clean(event.platform,30),channelId,messageId:clean(event.eventId||event.id||crypto.randomUUID(),500),sessionId:session.id,sessionStartedAt:session.at,sessionLabel:session.label,timestamp:Number.isFinite(Date.parse(event.timestamp))?new Date(event.timestamp).toISOString():new Date().toISOString(),userId,username:clean(user.username||event.username,300),displayName:clean(user.displayName||event.displayName||user.username||event.username,300),text,identityVerified:event.identityVerified===true||user.identityVerified===true};
}
function moderationRecord(input={},excerpts=false) {
  const out={}; for(const key of ['id','timestamp','platform','channelId','userId','username','displayName','action','actor','executor','reason','reasonSource','result','error','errorCode','messageId','expiresAt','confirmedAt','source','resourceId'])out[key]=clean(input[key],key==='reason'||key==='error'?1000:500);
  out.durationSeconds=Number(input.durationSeconds)||null;
  if(excerpts&&input.lastMessage)out.lastMessage=clean(input.lastMessage,10000);
  out.contextStatus=excerpts&&input.lastMessage?'last_received_message':'not_recorded';return out;
}
class ArchiveService {
  constructor({dataDir,config={},onStatus=()=>{},WorkerClass=Worker}={}) { Object.assign(this,{dataDir,onStatus,WorkerClass});this.config=archiveConfig(config);this.worker=null;this.pending=new Map();this.seq=0;this.queue=[];this.auditQueue=[];this.error='';this.state='closed';this.session=null;this.writes=Promise.resolve();this.timer=null; }
  status(){return {...this.config,state:this.state,error:this.error,file:this.file||path.join(this.config.directory||this.dataDir,'chat-archive.db'),recording:this.config.enabled&&this.state==='ready',pending:this.queue.length+this.auditQueue.length,sessionId:this.session?.id||''};}
  emit(){this.onStatus(this.status());}
  fail(error){this.error=clean(error?.message||error,1000);this.state='error';this.emit();}
  newSession(){this.session={id:crypto.randomUUID(),at:new Date().toISOString(),label:'Aufzeichnung '+new Date().toLocaleString('de-DE')};}
  async start(){
    if(this.worker)return;
    this.file=path.join(this.config.directory||this.dataDir,'chat-archive.db');this.state='opening';this.emit();
    this.worker=new this.WorkerClass(path.join(__dirname,'archive-worker.cjs'),{workerData:{file:this.file}});
    const ready=new Promise((resolve,reject)=>{this.ready={resolve,reject};});
    this.worker.on('message',message=>{
      if('ready'in message){if(message.ready){this.state='ready';this.error='';this.ready.resolve();this.emit();}else{this.ready.reject(new Error(message.error));this.fail(message.error);}return;}
      const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error)):pending.resolve(message.result);
    });
    this.worker.on('error',error=>{this.ready?.reject(error);for(const p of this.pending.values())p.reject(error);this.pending.clear();this.fail(error);});
    this.worker.on('exit',code=>{if(this.state!=='closed'&&code!==0)this.fail(new Error('Archiv-Hintergrundprozess beendet.'));for(const p of this.pending.values())p.reject(new Error('Archiv-Hintergrundprozess beendet.'));this.pending.clear();});
    await ready;if(this.config.enabled)this.newSession();await this.request('retention',{days:this.config.retentionDays});
  }
  request(method,input={}) { if(!this.worker||this.state!=='ready')return Promise.reject(new Error(this.error||'Archiv noch nicht bereit.'));const id=++this.seq;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,method,input});}); }
  async configure(value={}){
    const previous=this.config,next=archiveConfig({...previous,...value});
    // Apply the switch synchronously, before any pending asynchronous write can accept a new message.
    this.config=next;
    if(!next.moderationEnabled)this.auditQueue=[];else if(!next.excerptsEnabled)this.auditQueue=this.auditQueue.map(x=>moderationRecord(x,false));
    // Finish messages received while ON; ingest() already sees the new OFF switch.
    const finishRecording=previous.enabled&&!next.enabled?this.flush():Promise.resolve();
    await finishRecording;
    if(previous.directory!==next.directory){await this.close();await this.start();}
    else {if(!previous.enabled&&next.enabled)this.newSession();if(previous.enabled&&!next.enabled&&this.session){await this.request('endSession',{id:this.session.id}).catch(e=>this.fail(e));this.session=null;}if(previous.retentionDays!==next.retentionDays)await this.request('retention',{days:next.retentionDays});}
    this.emit();return {ok:true,status:this.status()};
  }
  ingest(event,channelHint=''){if(!this.config.enabled||this.state!=='ready')return false;if(!this.session)this.newSession();const record=chatRecord(event,this.session,channelHint);if(!record)return false;if(this.queue.length>=10000){this.fail(new Error('Archiv-Warteschlange voll. Neue Nachrichten werden nicht gespeichert.'));return false;}this.queue.push(record);this.schedule();return true;}
  recordModeration(entry){if(!this.config.moderationEnabled||this.state!=='ready')return;this.auditQueue.push(moderationRecord(entry,this.config.excerptsEnabled));this.schedule();}
  schedule(){if(!this.timer){this.timer=setTimeout(()=>{this.timer=null;this.flush().catch(()=>{});},40);this.timer.unref?.();}}
  flush(){clearTimeout(this.timer);this.timer=null;const messages=this.queue.splice(0),moderation=this.auditQueue.splice(0);this.writes=this.writes.catch(()=>{}).then(async()=>{if(messages.length||moderation.length)try{await this.request('append',{messages,moderation});this.error='';this.emit();}catch(error){this.fail(error);throw error;}});return this.writes;}
  async search(input){await this.flush();return this.request('search',input);}
  async history(input){await this.flush();return this.request('history',input);}
  async sessions(){await this.flush();return this.request('sessions');}
  async context(input){await this.flush();return this.request('context',input);}
  async export(input){await this.flush();return this.request('export',input);}
  async close(){clearTimeout(this.timer);this.timer=null;if(!this.worker)return;await this.flush().catch(()=>{});if(this.session)await this.request('endSession',{id:this.session.id}).catch(()=>{});await this.request('close').catch(()=>{});this.state='closed';const worker=this.worker;this.worker=null;await worker.terminate();this.emit();}
}
module.exports={ArchiveService,archiveConfig,chatRecord,moderationRecord};
