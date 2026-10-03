'use strict';
const crypto=require('node:crypto');
const PLATFORMS={twitch:'Twitch',youtube:'YouTube',tiktok:'TikTok'};
const OPERATIONS={ban:'block',unban:'unblock',timeout:'mute'};
const cleanName=value=>String(value||'').normalize('NFKC').trim().replace(/^@/,'').replace(/\s+/g,' ').toLocaleLowerCase('de-DE');
const validId=(platform,id)=>platform==='twitch'?/^\d{1,30}$/.test(id):platform==='youtube'?/^UC[\w-]{20,30}$/.test(id):false;
const failure=(text,kind='error')=>({ok:false,text,kind});
const errorText=result=>result?.error||result?.message||result?.text||'Die Aktion wurde nicht bestätigt.';

/** Bridges named Jarvis requests to the existing authenticated moderation service. */
class JarvisModeration{
 constructor({getHost,clock=Date.now}){this.getHost=getHost;this.clock=clock;this.pending=new Map();}
 trim(){for(const [id,value]of this.pending)if(value.expiresAt<=this.clock())this.pending.delete(id);}
 candidates(intent,host,states){
  const wanted=cleanName(intent.userName),rows=[...(host.chatMessages?.()||[])];
  // An unbanned person may no longer occur in the bounded current chat buffer.
  if(intent.operation==='unban')for(const [platform,state]of Object.entries(states))for(const row of [...(state.blocked||[]),...(state.muted||[])])rows.push({...row,platform,channelId:row.channelId||state.channelId,identityVerified:true});
  const matched=rows.filter(row=>PLATFORMS[row.platform]&&(!intent.platform||row.platform===intent.platform)&&
   [row.username,row.displayName].some(name=>cleanName(name)===wanted)&&row.raw?.meta?.sourceConnector!=='fake-connector'&&row.raw?.meta?.sourceConnector!=='synthetic');
  const unique=new Map();
  for(const row of matched){
   const state=states[row.platform]||{},channelId=row.platform==='twitch'&&row.channelId==='login:'+state.channelLogin?state.channelId:row.channelId;
   // Twitch login names are unique; YouTube display names are not.
   const identity=row.platform==='twitch'?cleanName(row.username):String(row.userId||'unknown');
   const key=JSON.stringify([row.platform,channelId,identity]);
   const current=unique.get(key),next={...row,channelId};
   if(!current||(!current.identityVerified&&next.identityVerified))unique.set(key,next);
   else if(current.identityVerified&&next.identityVerified&&current.userId!==next.userId)unique.set(key+':'+next.userId,next);
  }
  return [...unique.values()];
 }
 async prepareModeration(intent={}){
  try{
   this.trim();
   if(!OPERATIONS[intent.operation]||!cleanName(intent.userName)||String(intent.userName).length>120)return failure('Bitte nenne eine Person und die gewünschte Moderationsaktion.','clarification');
   if(intent.platform&&!PLATFORMS[intent.platform])return failure('Diese Plattform wird für Moderation nicht unterstützt.');
   if(intent.platform==='tiktok')return failure('TikTok-Moderation ist über die aktuelle TikFinity-Verbindung nicht verfügbar. Öffne dafür die TikTok-Verwaltung.');
   const duration=intent.durationSeconds===undefined?600:intent.durationSeconds;
   if(intent.operation==='timeout'&&(!Number.isInteger(duration)||duration<1||duration>1209600))return failure('Die Stummschaltung muss zwischen einer Sekunde und 14 Tagen dauern.');
   const host=this.getHost();if(!host?.moderationState||!host?.moderationPerform)return failure('Die Moderation ist noch nicht bereit.');
   const states=host.moderationState()||{},candidates=this.candidates(intent,host,states);
   if(!candidates.length)return failure(`Ich finde „${String(intent.userName).trim()}“ nicht eindeutig im aktuellen Chat oder in der bestätigten Sperrliste. Nenne den genauen Namen und die Plattform.`,'clarification');
   if(candidates.length!==1)return failure(`Zu „${String(intent.userName).trim()}“ finde ich mehrere Personen oder Kanäle. Nenne die Plattform; bei gleichen Namen wähle die Person im Chat.`,'clarification');
   let target=candidates[0];const platform=target.platform,state=states[platform]||{},action=OPERATIONS[intent.operation];
   if(platform==='tiktok')return failure('TikTok-Moderation ist über die aktuelle TikFinity-Verbindung nicht verfügbar. Öffne dafür die TikTok-Verwaltung.');
   if(!state.connected||!state.actions?.[action])return failure(state.error||`${PLATFORMS[platform]}-Moderation ist nicht angemeldet oder hat keine Berechtigung für diese Aktion. Öffne Moderation und verbinde dein Konto.`);
   if(!target.channelId)return failure('Zur Person fehlt der Nachrichtenkanal. Wähle eine aktuelle Nachricht im Chat.');
   if(platform==='twitch'&&(!target.identityVerified||!validId(platform,target.userId)||target.channelId.startsWith('login:'))){
    if(!host.moderationResolve)return failure('Die stabile Twitch-Nutzer-ID konnte noch nicht geprüft werden. Wähle die Person im Chat.');
    const resolved=await host.moderationResolve({platform,username:target.username,channelId:target.channelId});
    if(!resolved?.ok||resolved.identityVerified!==true||resolved.platform!==platform||cleanName(resolved.username)!==cleanName(target.username))return failure(errorText(resolved));
    if(target.identityVerified&&validId(platform,target.userId)&&resolved.userId!==target.userId)return failure('Die Nutzer-ID hat sich geändert. Wähle die Person erneut aus.');
    target={...target,...resolved};
   }
   if(!target.identityVerified||!validId(platform,target.userId))return failure('Es fehlt eine bestätigte stabile Nutzer-ID. Ich sende keine Moderationsaktion anhand eines Anzeigenamens.');
   if(target.channelId!==state.channelId)return failure('Der Nachrichtenkanal stimmt nicht mit dem angemeldeten Moderationskanal überein.');
   if(target.userId===state.identity?.id||target.userId===state.channelId||target.isBroadcaster===true)return failure('Das angemeldete Konto und der Kanalinhaber können hier nicht Ziel einer Moderationsaktion sein.');
   const username=String(target.username||target.displayName).slice(0,120),displayName=String(target.displayName||username).slice(0,120);
   const prepared={id:crypto.randomUUID(),expiresAt:this.clock()+45000,platform,channelId:target.channelId,userId:target.userId,username,displayName,operation:intent.operation,action,
    reason:String(intent.reason||'Auf ausdrücklichen Jarvis-Befehl der Bedienperson.').replace(/[\x00-\x1f]/g,' ').slice(0,500),...(intent.operation==='timeout'?{durationSeconds:duration}:{})};
   if(this.pending.size>=16)this.pending.delete(this.pending.keys().next().value);
   this.pending.set(prepared.id,Object.freeze(prepared));
   const what=intent.operation==='ban'?'dauerhaft sperren':intent.operation==='unban'?'entsperren':`für ${duration} Sekunden stummschalten`;
   return {ok:true,description:`${displayName} auf ${PLATFORMS[platform]} ${what}`,prepared:{...prepared}};
  }catch(error){return failure(String(error.message||error));}
 }
 async executePrepared(prepared){
  this.trim();const saved=this.pending.get(prepared?.id);
  if(!saved)return failure('Die Moderationsbestätigung ist abgelaufen oder wurde bereits verwendet. Bitte nenne den Befehl erneut.');
  // Consume before awaiting platform IO, including ambiguous errors: never retry a ban silently.
  this.pending.delete(saved.id);
  if(Object.keys(saved).some(key=>prepared[key]!==saved[key]))return failure('Die Zielperson oder Aktion hat sich verändert. Bitte nenne den Befehl erneut.');
  try{
   const host=this.getHost(),state=host?.moderationState?.()?.[saved.platform];
   if(!state?.connected||state.channelId!==saved.channelId||!state.actions?.[saved.action])return failure('Kanal oder Moderationsberechtigung haben sich geändert. Bitte prüfe die Moderationsanmeldung.');
   const result=await host.moderationPerform({requestId:saved.id,platform:saved.platform,channelId:saved.channelId,userId:saved.userId,username:saved.username,displayName:saved.displayName,action:saved.action,reason:saved.reason,durationSeconds:saved.durationSeconds,actor:'Jarvis · bestätigter Befehl'});
   if(result?.ok!==true||result.entry?.result!=='confirmed')return failure(errorText(result));
   const entry=result.entry;
   if(['platform','channelId','userId','action'].some(key=>entry[key]!==saved[key]))return failure('Die Plattformantwort bestätigt nicht die ausgewählte Person und Aktion. Bitte prüfe den Moderationsverlauf.');
   const what=saved.operation==='ban'?'gesperrt':saved.operation==='unban'?'entsperrt':`für ${saved.durationSeconds} Sekunden stummgeschaltet`;
   return {ok:true,text:`${saved.displayName} wurde auf ${PLATFORMS[saved.platform]} ${what}.`,kind:'status'};
  }catch(error){return failure(String(error.message||error));}
 }
 async filter(intent={}){
  try{
   if(!['add-word','remove-word'].includes(intent.operation))return failure('Diese Filteraktion ist nicht verfügbar.');
   const word=String(intent.word||'').trim();
   if(!word||word.length>120||/[\x00-\x1f]/.test(word))return failure('Bitte nenne einen Filterbegriff mit höchstens 120 Zeichen.','clarification');
   const platform=intent.platform||'all';if(platform!=='all'&&!PLATFORMS[platform])return failure('Diese Filterplattform ist nicht verfügbar.');
   const host=this.getHost();if(!host?.filters||!host?.filterAdd||!host?.filterRemove)return failure('Die Chatfilter sind noch nicht bereit.');
   const settings=host.filters()||{},rules=settings.rules||[],matches=rules.filter(rule=>String(rule.term||'').toLocaleLowerCase('de-DE')===word.toLocaleLowerCase('de-DE')&&(intent.platform?rule.platform===platform:true));
   if(intent.operation==='add-word'){
    const duplicate=rules.find(rule=>(rule.platform||'all')===platform&&String(rule.term||'').toLocaleLowerCase('de-DE')===word.toLocaleLowerCase('de-DE'));
    if(duplicate)return {ok:true,text:`„${word}“ steht bereits im Chatfilter.${duplicate.enabled===false?' Diese Regel ist ausgeschaltet.':''}${settings.enabled===false?' Der Chatfilter ist ausgeschaltet.':''}`,kind:'status'};
    const result=await host.filterAdd({term:word,platform,action:'hide',wholeWord:true,caseSensitive:false,enabled:true});
    if(result?.ok!==true)return failure(errorText(result));
    return {ok:true,text:`„${word}“ wurde zum lokalen Chatfilter hinzugefügt.${settings.enabled===false?' Der Chatfilter ist noch ausgeschaltet.':' Passende Nachrichten werden im Tool ausgeblendet.'}`,kind:'status'};
   }
   if(!matches.length)return failure(`„${word}“ steht nicht im Chatfilter.`,'clarification');
   if(matches.length>1)return failure(`Für „${word}“ gibt es mehrere Filterregeln. Nenne die Plattform oder wähle die Regel im Bereich Chatfilter.`,'clarification');
   const result=await host.filterRemove(matches[0].id);if(result?.ok!==true)return failure(errorText(result));
   return {ok:true,text:`„${word}“ wurde aus dem Chatfilter entfernt.`,kind:'status'};
  }catch(error){return failure(String(error.message||error));}
 }
}
module.exports={JarvisModeration,cleanName};
