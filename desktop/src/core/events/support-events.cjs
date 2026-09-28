'use strict';
const {DedupeCache}=require('./dedupe.cjs');
const {simulated}=require('../gifts/gift-registry.cjs');
// Only provider events and explicitly identified bridge events enter this adapter.
// A chat message containing a number is never a donation.
class SupportEvents {
  constructor({getProvider=()=> 'none',onEvent=()=>{},onLog=()=>{}}={}){Object.assign(this,{getProvider,onEvent,onLog});this.dedupe=new DedupeCache({ttlMs:3600000,maxEntries:30000});this.series=new Map();}
  ingest(packet){
    if(simulated(packet))return false;
    const source=String(packet.event?.source||'').toLowerCase(),name=String(packet.event?.type||'').toLowerCase(),d=packet.data||{};
    let type,platform='twitch',unit,value,currency,id=d.id||d.eventId||d.messageId;
    if(source==='twitch'){
      type={cheer:'cheer',sub:'sub',resub:'resub',giftsub:'giftsub',giftbomb:'giftbomb',follow:'follow',raid:'raid'}[name];if(!type)return false;
      if(type==='giftsub'&&(d.isFromGiftBomb===true||d.fromGiftBomb===true||d.isCommunityGift===true||d.fromCommunitySubGift===true))return false;
      unit=type==='cheer'?'bits':'count';value=Number(type==='cheer'?d.bits:type==='giftbomb'?d.total??d.gifts??d.count:type==='raid'?d.viewers:1);
    }else if((source==='streamlabs'&&name==='donation')||(source==='streamelements'&&name==='tip')){
      if(this.getProvider()!==source)return false;
      type='tip';platform='internal';unit='money';value=Number(d.amount);currency=String(d.currency||'').toUpperCase();
      if(!/^[A-Z]{3}$/.test(currency)||!id)return false;
    }else if(packet.bridge===true&&packet.platform==='tiktok'){
      type=String(packet.type||'').toLowerCase();if(!['gift','follow','like','share','sub'].includes(type))return false;
      platform='tiktok';id=packet.eventId;unit=type==='gift'?'coins':'count';value=Number(packet.value??packet.count??1);
      if(type==='gift'&&packet.seriesId){
        const key=String(packet.seriesId),total=Number(packet.count),prior=this.series.get(key)||0;
        if(!Number.isInteger(total)||total<=prior)return false;
        this.series.set(key,total);if(this.series.size>10000)this.series.delete(this.series.keys().next().value);
        const delta=total-prior;value=delta*Number(packet.coinsPerGift||0);id=key+':'+total;
        packet={...packet,count:delta};
      }
    }else return false;
    if(!Number.isFinite(value)||value<0)return false;
    // Without a provider ID, timestamp + user + type distinguishes replays from new events.
    if(!id&&packet.timeStamp)id=packet.timeStamp+':'+(d.user?.id||d.userId||d.user?.name||'')+':'+type;
    if(!id){this.onLog('Ereignis ohne verlässliche Kennung verworfen.');return false;}
    const key=source+':'+platform+':'+type+':'+id;if(this.dedupe.seen(key))return false;
    const user=d.user&&typeof d.user==='object'?d.user:{username:d.username||d.name||packet.username||'unknown'};
    this.onEvent({platform,type,id:key,timestamp:packet.timeStamp||packet.timestamp,raw:packet,data:{user,value,unit,coinsPerGift:packet.coinsPerGift??d.coinsPerGift??d.diamondCount,currency:currency||null,provider:source||'tikfinity',count:packet.count??(unit==='count'?value:1),giftId:packet.giftId||d.giftId,subTier:d.subTier,channel:d.broadcaster?.login||packet.channel,giftName:packet.giftName||d.giftName,skipAggregation:true}},'streamerbot-support');return true;
  }
}
module.exports={SupportEvents};
