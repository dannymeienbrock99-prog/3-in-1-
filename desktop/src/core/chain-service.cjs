'use strict';
const crypto=require('crypto');
class ChainService {
 constructor({getConfig,engine,onStatus=()=>{}}){Object.assign(this,{getConfig,engine,onStatus});this.running=new Map();this.queues=new Map();this.history=[];}
 status(){return {running:[...this.running.values()].map(r=>({id:r.id,chainId:r.chainId,startedAt:r.startedAt,context:r.context})),queued:[...this.queues].map(([chainId,q])=>({chainId,count:q.length})),history:this.history.slice(-100)};}
 notify(){this.onStatus(this.status());}
 trigger(chainId,context={},options={}){
  if(options.signal?.aborted)return Promise.resolve({ok:false,cancelled:true});
  const chain=(this.getConfig().actionChains||[]).find(c=>c.id===chainId);if(!chain||chain.enabled===false)return Promise.reject(new Error('Aktionskette fehlt oder ist deaktiviert.'));
  const active=[...this.running.values()].some(r=>r.chainId===chainId);
  if(active&&chain.queueMode!=='parallel'){
   if(chain.queueMode==='discard')return Promise.resolve({ok:false,skipped:'running'});
   const q=this.queues.get(chainId)||[];if(q.length>=100)return Promise.reject(new Error('Warteschlange der Aktionskette ist voll.'));
   return new Promise((resolve,reject)=>{
    const item={context,options,resolve,reject,cleanup:()=>options.signal?.removeEventListener('abort',cancel)};
    const cancel=()=>{const list=this.queues.get(chainId)||[],index=list.indexOf(item);if(index>=0)list.splice(index,1);if(!list.length)this.queues.delete(chainId);item.cleanup();resolve({ok:false,cancelled:true});this.notify();};
    if(chain.queueMode==='coalesce'&&q.length){const replaced=q.pop();replaced.cleanup?.();replaced.resolve({ok:false,skipped:'coalesced'});}
    q.push(item);this.queues.set(chainId,q);options.signal?.addEventListener('abort',cancel,{once:true});this.notify();
   });
  }
  return this.start(chain,context,options);
 }
 async start(chain,context,options={}){
  if(this.running.size>=25)throw new Error('Zu viele gleichzeitige Aktionsketten.');
  const id=crypto.randomUUID(),controller=new AbortController(),cancel=()=>controller.abort();options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)controller.abort();
  const run={id,chainId:chain.id,startedAt:new Date().toISOString(),controller,context:{source:context.source||context.kind||'manual',eventId:context.eventId||context.rawEvent?.eventId,platform:context.platform,user:context.user||context.username}};
  this.running.set(id,run);this.notify();let result;
  try{result=await this.engine.execute(chain.actions||[],{...context,chainId:chain.id},{runId:id,ruleId:chain.id,signal:controller.signal,failurePolicy:chain.failurePolicy||'stop-sequence',timeoutMs:chain.timeoutMs||30000});return result;}
  catch(e){result={ok:false,error:e.message};throw e;}
  finally{
   options.signal?.removeEventListener('abort',cancel);this.running.delete(id);this.history.push({...run,controller:undefined,endedAt:new Date().toISOString(),result});if(this.history.length>100)this.history.shift();
   const q=this.queues.get(chain.id)||[],next=q.shift();if(!q.length)this.queues.delete(chain.id);
   if(next){next.cleanup?.();this.trigger(chain.id,next.context,next.options).then(next.resolve,next.reject);}this.notify();
  }
 }
 cancelAll(){for(const r of this.running.values())r.controller.abort();for(const q of this.queues.values())for(const item of q){item.cleanup?.();item.resolve({ok:false,cancelled:true});}this.queues.clear();this.notify();return {ok:true};}
}
module.exports={ChainService};
