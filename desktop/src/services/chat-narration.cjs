'use strict';
const {normalizeChat}=require('../core/events/normalizer.cjs');
const {isAutoBroadcast}=require('../core/broadcast/visibility.cjs');
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
function canonicalTikTokLogin(value){return typeof value==='string'&&/^[a-z0-9_.]{1,24}$/.test(value.trim().toLowerCase())?value.trim().toLowerCase():'';}
function stableId(value){const text=typeof value==='string'?value.trim():Number.isSafeInteger(value)&&value>=0?String(value):'';return /^\d{1,30}$/.test(text)?text:'';}
function first(object,keys,convert){for(const key of keys){const value=convert(object?.[key]);if(value)return value;}return '';}
function providerData(packet){if(typeof packet?.data==='string'){try{return record(JSON.parse(packet.data))||packet;}catch{return packet;}}return record(packet?.data)||packet;}

// Only the host adds this narration evidence. It grants no platform role or
// command rights and never identifies a sender by a nickname/display name.
function withTikTokSelfNarration(message,{senderUsername='',source=''}={}){
 if(!record(message))return message;
 const packet=record(message.raw),raw=packet?{...packet}:{};delete raw.narration;
 const clean=packet&&Object.hasOwn(packet,'narration')?{...message,raw}:message;
 if(message.platform!=='tiktok'||message.identityVerified!==true||!(source==='tikfinity'||source==='manual'||source==='automation'||isAutoBroadcast({meta:{sourceConnector:source}})))return clean;
 const data=providerData(packet),user=[data?.user,data?.userData,data?.author].find(record)||{};
 const canonicalLogin=first(user,['uniqueId','unique_id'],canonicalTikTokLogin)||first(data,['uniqueId','unique_id'],canonicalTikTokLogin);
 const senderLogin=canonicalTikTokLogin(typeof senderUsername==='string'?senderUsername.trim().replace(/^@/,''):'');
 const userId=first(user,['userId','userIdString','user_id','id'],stableId)||first(data,['userId','userIdString','user_id'],stableId);
 if(!canonicalLogin||canonicalLogin!==senderLogin||canonicalTikTokLogin(message.username)!==canonicalLogin||!userId||userId!==message.userId)return clean;
 // Reuse the normalizer's ID so an idless provider replay keeps its deduplication key.
 const messageId=message.id===undefined||message.id===''?normalizeChat(message,source).eventId.slice('tiktok:chat:'.length):message.id;
 if(typeof messageId!=='string'||!messageId||messageId.length>512||/[\x00-\x1f\x7f]/.test(messageId))return clean;
 return {...message,id:messageId,raw:{...raw,narration:{transport:'tikfinity',role:'self',method:'sender-login',canonicalLogin,senderLogin,messageId,userId}}};
}
module.exports={withTikTokSelfNarration,canonicalTikTokLogin};
