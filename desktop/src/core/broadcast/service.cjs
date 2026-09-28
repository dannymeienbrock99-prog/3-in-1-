'use strict';
const {randomUUID}=require('node:crypto');
const {BroadcastScheduler,normalizeItem}=require('./scheduler.cjs');
class BroadcastService {
  constructor({store,send,isLive,onStatus,onConfig,onSound,onActions}={}){this.store=store;this.onConfig=onConfig;this.scheduler=new BroadcastScheduler({send,isLive,onStatus,onSound,onActions});this.configure();}
  configure(){this.scheduler.configure(this.store.get().autoBroadcast);}
  start(){this.configure();this.scheduler.start();}
  stop(){this.scheduler.stop();}
  status(){return this.scheduler.status();}
  noteChat(platform){this.scheduler.noteChat(platform==='internal'?'local':platform);}
  save(patch){const config=this.store.merge({autoBroadcast:patch});this.configure();this.onConfig?.(config);return config;}
  upsert(input){const previous=(this.store.get().autoBroadcast.items||[]).find(x=>x.id===input?.id);const item=normalizeItem({...input,onlyWhenLive:input.onlyWhenLive??previous?.onlyWhenLive??true}),items=[...this.store.get().autoBroadcast.items],index=items.findIndex(x=>x.id===item.id);if(index<0)items.push(item);else items[index]=item;return{ok:true,item,config:this.save({items})};}
  remove(id){const items=this.store.get().autoBroadcast.items;if(!items.some(x=>x.id===id))throw new Error('Broadcast nicht gefunden.');return{ok:true,config:this.save({items:items.filter(x=>x.id!==id)})};}
  duplicate(id){const item=this.store.get().autoBroadcast.items.find(x=>x.id===id);if(!item)throw new Error('Broadcast nicht gefunden.');return this.upsert({...item,id:randomUUID(),name:item.name+' (Kopie)',enabled:false});}
  master(input={}){if(typeof input.enabled!=='boolean')throw new Error('Aktivierung fehlt.');const patch={enabled:input.enabled};if(input.showInMultiChat!==undefined){if(typeof input.showInMultiChat!=='boolean')throw new Error('Multi-Chat-Anzeige muss an oder aus sein.');patch.showInMultiChat=input.showInMultiChat;}for(const key of ['globalMinGapSeconds','platformMinGapSeconds']){const n=Number(input[key]);if(!Number.isFinite(n)||n<0||n>3600)throw new Error('Mindestabstand: 0 bis 3600 Sekunden.');patch[key]=n;}return{ok:true,config:this.save(patch)};}
  test(input){return this.scheduler.test(input || this.store.get().autoBroadcast.items[0]);}
}
module.exports={BroadcastService};
