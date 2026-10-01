'use strict';
const clean=v=>String(v??'').replace(/https?:\/\/\S+/gi,'Link').replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const format=v=>v.toLocaleString('de-DE',{maximumFractionDigits:2});
const DEFAULT_EVENTS={enabled:true,gifts:true,follows:true,likes:true,giftMinimum:0,likeThreshold:10000,cooldown:8};
function settings(input={}){const s={...DEFAULT_EVENTS};for(const k of ['enabled','gifts','follows','likes'])if(typeof input[k]==='boolean')s[k]=input[k];for(const [k,min,max] of [['giftMinimum',0,100000000],['likeThreshold',1,100000000],['cooldown',2,120]])if(Number.isFinite(input[k]))s[k]=Math.max(min,Math.min(max,Math.round(input[k])));return s;}
class JarvisEvents{
 constructor(){this.seen=new Map();this.likes=new Map();this.pending=[];this.last=-Infinity;}
 ingest(e,s,now=Date.now()){
  if(!s.enabled||!['tiktok','twitch','youtube'].includes(e?.platform)||!['gift','follow','like'].includes(e.type))return;
  if(/mock|fake|test|local/i.test(e.meta?.sourceConnector||''))return;
  const raw=e.meta?.rawData?.data||e.meta?.rawData||{};
  if(e.type==='gift'&&(raw.repeatEnd===false||(Number(raw.giftType)===1&&raw.repeatEnd!==true)))return;
  const age=now-Date.parse(e.timestamp);if(Number.isFinite(age)&&(age>60000||age< -5000))return;
  for(const [id,stamp]of this.seen)if(now-stamp>300000)this.seen.delete(id);
  const key=e.platform+':'+e.eventId;if(!e.eventId||this.seen.has(key))return;
  this.seen.set(key,now);if(this.seen.size>2000)this.seen.delete(this.seen.keys().next().value);
  const name=clean(e.user?.displayName||e.user?.username)||'Ein Zuschauer';let text='';
  if(e.type==='gift'&&s.gifts){
   const count=Math.max(1,Math.min(1000000,number(e.gift?.count)||1));
   // TikFinity coins is the supplied event total; diamondCount/coinsPerGift is a unit price.
   const total=number(raw.coins)??((number(raw.coinsPerGift)??number(raw.diamondCount)??number(e.gift?.coins))===null?null:(number(raw.coinsPerGift)??number(raw.diamondCount)??number(e.gift?.coins))*count);
   if(s.giftMinimum>0&&(total===null||total<s.giftMinimum))return;
   text=`${name} hat ${format(count)} mal ${clean(e.gift?.name)||'ein Geschenk'} geschickt.${total===null?' Der Wert wurde nicht übermittelt.':` Insgesamt ${format(total)} Coins.`}`;
  }else if(e.type==='follow'&&s.follows)text=`${name} folgt dir jetzt.`;
  else if(e.type==='like'&&s.likes){
   const id=e.platform+':'+e.user?.id;if(!e.user?.id||e.user.id==='unknown')return;
   let entry=this.likes.get(id)||{total:0,announced:0,time:now};
   // totalLikeCount in the socket protocol is a stream total, never attribute it to one user.
   const delta=number(raw.likeCount)??number(e.data?.count);if(delta===null||delta>100000000)return;
   entry.total+=delta;entry.time=now;const level=Math.floor(entry.total/s.likeThreshold);
   if(level>entry.announced){entry.announced=level;text=`${name} hat seit dem Zählerstart ${format(entry.total)} Likes gesendet.`;}
   this.likes.set(id,entry);for(const [k,v]of this.likes)if(now-v.time>3600000)this.likes.delete(k);
   if(this.likes.size>5000)this.likes.delete(this.likes.keys().next().value);
  }
  if(text){const replace=e.type==='like'?this.pending.findIndex(x=>x.user===e.user.id&&x.type==='like'):-1;const item={text,time:now,type:e.type,user:e.user?.id};if(replace>=0)this.pending[replace]=item;else if(this.pending.length<8)this.pending.push(item);}
 }
 next(s,now=Date.now()){
  this.pending=this.pending.filter(x=>now-x.time<30000&&s.enabled&&s[x.type==='gift'?'gifts':x.type==='follow'?'follows':'likes']);
  if(now-this.last<s.cooldown*1000||!this.pending.length)return null;
  this.last=now;return this.pending.shift().text;
 }
 resetLikes(){this.likes.clear();this.pending=this.pending.filter(x=>x.type!=='like');}
}
module.exports={JarvisEvents,eventSettings:settings,DEFAULT_EVENTS};
