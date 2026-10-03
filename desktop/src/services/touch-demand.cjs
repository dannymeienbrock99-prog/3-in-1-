'use strict';
// Only visible profiles or explicitly held keys require a plugin. Mobile polling
// renews a lease without re-sending unchanged assignments and their key images.
class TouchDemand{
 constructor({getConfig,getHost,changed=()=>{},now=()=>Date.now(),leaseMs=15000}){
  Object.assign(this,{getConfig,getHost,changed,now,leaseMs});this.consumers=new Map();this.timer=null;this.closed=false;this.queue=Promise.resolve();this.lastSignature=null;this.lastHost=null;this.closePromise=null;
 }
 set(id,profileId,{visible=true,temporary=false,buttonId}={}){
  if(this.closed)return Promise.resolve();
  if(visible)this.consumers.set(id,{profileId,buttonId,expires:temporary?this.now()+this.leaseMs:Infinity});else this.consumers.delete(id);
  this.schedule();return this.sync();
 }
 remove(id){return this.set(id,'',{visible:false});}
 expire(){const time=this.now();for(const [id,consumer]of this.consumers)if(consumer.expires<=time)this.consumers.delete(id);}
 schedule(){
  clearTimeout(this.timer);this.timer=null;if(this.closed)return;
  const times=[...this.consumers.values()].map(consumer=>consumer.expires).filter(Number.isFinite);if(!times.length)return;
  this.timer=setTimeout(()=>{this.timer=null;this.expire();this.schedule();void this.sync().catch(()=>{});},Math.max(10,Math.min(...times)-this.now()));this.timer.unref?.();
 }
 assignments(){
  this.expire();const selected=new Map(),profiles=this.getConfig().profiles;
  const visit=(buttons,columns,wanted)=>buttons.forEach((button,index)=>{
   if(button?.type==='folder')visit(button.buttons,columns,wanted);
   else if(button?.type==='plugin'&&(!wanted||wanted===button.id))selected.set(button.id,{id:button.id,pluginId:button.pluginId,actionId:button.actionId,coordinates:{column:index%columns,row:Math.floor(index/columns)}});
  });
  for(const consumer of this.consumers.values())for(const profile of profiles)if(consumer.buttonId||profile.id===consumer.profileId)visit(profile.buttons,profile.columns,consumer.buttonId);
  // Consumer insertion order is not an assignment change (e.g. phone reconnect).
  return [...selected.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 }
 sync({force=false}={}){
  const work=async()=>{
   if(this.closed)return;const buttons=this.assignments();this.schedule();const host=this.getHost(buttons.length>0),signature=JSON.stringify(buttons);
   if(!force&&signature===this.lastSignature&&host===this.lastHost)return;
   if(host)await host.sync(buttons);
   // Only remember successful work: a failed start or stop must be retried.
   this.lastSignature=signature;this.lastHost=host;this.changed();
  };
  this.queue=this.queue.then(work,work);return this.queue;
 }
 close(){
  if(this.closePromise)return this.closePromise;
  this.closed=true;clearTimeout(this.timer);this.timer=null;this.consumers.clear();
  const stop=async()=>{const host=this.getHost(false);if(host)await host.sync([]);this.lastSignature='[]';this.lastHost=host;};
  // An in-flight start must settle before the final stop, otherwise it can
  // resurrect a plugin after the deck has been closed.
  this.closePromise=this.queue.then(stop,stop);this.queue=this.closePromise;return this.closePromise;
 }
}
module.exports={TouchDemand};
