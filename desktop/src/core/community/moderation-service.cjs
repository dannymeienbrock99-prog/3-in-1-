'use strict';
const crypto=require('node:crypto');
const ACTIONS=['addModerator','removeModerator','mute','unmute','block','unblock'];
const none=()=>Object.fromEntries(ACTIONS.map(x=>[x,false]));
const str=(v,n=500)=>String(v??'').slice(0,n);
const identityKey=(p,c,u)=>JSON.stringify([p,c,u]);
class PlatformError extends Error {constructor(message,code,uncertain=false){super(message);this.code=code;this.uncertain=uncertain;}}
async function jsonRequest(fetchImpl,url,options={},token='') {
  let response;try{response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw new PlatformError('Keine eindeutige Plattformantwort. Status vor einem erneuten Versuch abgleichen.','NETWORK',options.method&&options.method!=='GET');}
  let data={};if(response.status!==204)try{data=await response.json();}catch{if(response.ok)throw new PlatformError('Unvollständige Plattformantwort.','INVALID_RESPONSE',!!options.method&&options.method!=='GET');}
  if(!response.ok){const detail=str(data.message||data.error?.message||data.error_description||'Anfrage abgelehnt.',700);throw new PlatformError(('Plattform '+response.status+': '+detail).split(token||'\u0000').join('[geschützt]'),String(response.status),response.status>=500&&!!options.method&&options.method!=='GET');}
  return data;
}
class TwitchModeration {
  constructor({getToken,getConfig,fetchImpl=fetch}){Object.assign(this,{getToken,getConfig,fetchImpl});this.identity=null;this.authorization=null;}
  async api(route,params={},method='GET',body,token){token=token||await this.getToken();const cfg=this.getConfig();return jsonRequest(this.fetchImpl,'https://api.twitch.tv/helix/'+route+'?'+new URLSearchParams(params),{method,headers:{'Client-Id':this.identity?.clientId||cfg.clientId,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},token);}
  async pages(route,params,token){const rows=[];let after='';for(let i=0;i<100;i++){const data=await this.api(route,{...params,first:'100',...(after?{after}:{})},'GET',undefined,token);rows.push(...(data.data||[]));after=data.pagination?.cursor;if(!after)return rows;}throw new PlatformError('Plattformliste ist größer als das Abruflimit; keine vollständige Liste bestätigt.','LIMIT');}
  async verify(){
    const token=await this.getToken();if(!token)throw new PlatformError('Twitch-Moderationskonto noch nicht angemeldet.','AUTH_REQUIRED');
    const validation=await jsonRequest(this.fetchImpl,'https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+token}},token);
    const cfg=this.getConfig();if(cfg.clientId&&validation.client_id!==cfg.clientId)throw new PlatformError('Twitch-App-Kennung passt nicht zur Anmeldung.','CLIENT_ID');
    this.identity={id:str(validation.user_id),username:str(validation.login),clientId:str(validation.client_id),scopes:validation.scopes||[]};
    let channelId=str(cfg.broadcasterId),channelLogin='';if(!channelId&&cfg.channel){const response=await this.api('users',{login:str(cfg.channel).replace(/^#/,'')},'GET',undefined,token);channelId=str(response.data?.[0]?.id);channelLogin=str(response.data?.[0]?.login).toLowerCase();}
    if(!/^\d+$/.test(channelId))throw new PlatformError('Twitch-Kanal-ID oder Kanalname fehlt.','CHANNEL_REQUIRED');
    const own=this.identity.id===channelId,scopes=this.identity.scopes;
    if(!channelLogin){if(own)channelLogin=this.identity.username.toLowerCase();else{const response=await this.api('users',{id:channelId},'GET',undefined,token);channelLogin=str(response.data?.[0]?.login).toLowerCase();}}
    let moderator=own;
    if(!own&&scopes.includes('user:read:moderated_channels')){const channels=await this.pages('moderation/channels',{user_id:this.identity.id},token);moderator=channels.some(x=>x.broadcaster_id===channelId);}
    const actions=none();actions.addModerator=actions.removeModerator=own&&scopes.includes('channel:manage:moderators');
    actions.mute=actions.unmute=actions.block=actions.unblock=moderator&&scopes.includes('moderator:manage:banned_users');
    this.authorization={channelId,channelLogin,identity:{id:this.identity.id,username:this.identity.username},actions,own,canListModerators:own&&(scopes.includes('moderation:read')||scopes.includes('channel:manage:moderators')),canListBans:own&&(scopes.includes('moderation:read')||scopes.includes('moderator:manage:banned_users'))};return this.authorization;
  }
  async snapshot(auth){
    const confirmedAt=new Date().toISOString(),base={platform:'twitch',channelId:auth.channelId,confirmedAt};
    const moderators=auth.canListModerators?(await this.pages('moderation/moderators',{broadcaster_id:auth.channelId})).map(x=>({...base,userId:x.user_id,username:x.user_login,displayName:x.user_name})):null;
    const bans=auth.canListBans?(await this.pages('moderation/banned',{broadcaster_id:auth.channelId})).map(x=>({...base,userId:x.user_id,username:x.user_login,displayName:x.user_name,reason:x.reason||'Von der Plattform nicht mitgeteilt',reasonSource:'platform',expiresAt:x.expires_at||'',executor:x.moderator_id,createdAt:x.created_at})):null;
    return {moderators,muted:bans?.filter(x=>x.expiresAt),blocked:bans?.filter(x=>!x.expiresAt),listMode:moderators?'complete':'observed',bansMode:bans?'complete':'observed',confirmedAt};
  }
  async perform(p,auth){
    if(!/^\d+$/.test(p.userId))throw new PlatformError('Eine bestätigte numerische Twitch-Nutzer-ID ist erforderlich.','IDENTITY');
    if(['addModerator','removeModerator'].includes(p.action)){await this.api('moderation/moderators',{broadcaster_id:auth.channelId,user_id:p.userId},p.action==='addModerator'?'POST':'DELETE');return {};}
    const params={broadcaster_id:auth.channelId,moderator_id:auth.identity.id};
    if(['unmute','unblock'].includes(p.action)){await this.api('moderation/bans',{...params,user_id:p.userId},'DELETE');return {};}
    const data={user_id:p.userId,reason:p.reason};if(p.action==='mute')data.duration=p.durationSeconds;
    const response=await this.api('moderation/bans',params,'POST',{data});const item=response.data?.[0];
    if(!item)throw new PlatformError('Sperrantwort enthält keine Bestätigung.','INVALID_RESPONSE',true);
    return {expiresAt:item.end_time||'',resourceId:''};
  }
  async resolve(username){const auth=await this.verify();const login=str(username,100).trim().toLowerCase().replace(/^@/,'');if(!/^[a-z0-9_]{1,25}$/.test(login))throw new PlatformError('Ungültiger Twitch-Anmeldename.','IDENTITY');const response=await this.api('users',{login});const user=response.data?.find(x=>x.login?.toLowerCase()===login);if(!user?.id)throw new PlatformError('Twitch-Nutzerkonto wurde nicht gefunden.','IDENTITY');return {ok:true,platform:'twitch',channelId:auth.channelId,channelLogin:auth.channelLogin,userId:user.id,username:user.login,displayName:user.display_name,identityVerified:true};}
  async viewers(){const token=await this.getToken();if(!token)throw new PlatformError('Twitch-Anmeldung für Zuschauerzahlen fehlt.','AUTH_REQUIRED');if(!this.identity)await this.verify();const cfg=this.getConfig(),params=cfg.broadcasterId?{user_id:cfg.broadcasterId}:{user_login:cfg.channel||this.identity.username};const result=await this.api('streams',params,'GET',undefined,token);if(!Array.isArray(result.data))throw new PlatformError('Keine gültige Zuschauerantwort.','INVALID_RESPONSE');return result.data.length?{state:'live',count:Number(result.data[0].viewer_count)}:{state:'offline',count:null};}
}
class YouTubeModeration {
  constructor({getToken,getConfig,fetchImpl=fetch}){Object.assign(this,{getToken,getConfig,fetchImpl});this.identity=null;}
  async api(route,params={},method='GET',body){const token=await this.getToken();if(!token)throw new PlatformError('YouTube-OAuth-Anmeldung fehlt. Ein API-Schlüssel genügt nicht für Moderation.','AUTH_REQUIRED');return jsonRequest(this.fetchImpl,'https://www.googleapis.com/youtube/v3/'+route+'?'+new URLSearchParams(params),{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},token);}
  async verify(){
    const cfg=this.getConfig();if(!cfg.liveChatId)throw new PlatformError('YouTube-LiveChat-ID fehlt.','CHANNEL_REQUIRED');
    const token=await this.getToken();if(!token)throw new PlatformError('YouTube-OAuth-Anmeldung fehlt.','AUTH_REQUIRED');
    const grant=await jsonRequest(this.fetchImpl,'https://oauth2.googleapis.com/tokeninfo?'+new URLSearchParams({access_token:token}),{},token);
    const scopes=String(grant.scope||'').split(' ');if(!scopes.includes('https://www.googleapis.com/auth/youtube')&&!scopes.includes('https://www.googleapis.com/auth/youtube.force-ssl'))throw new PlatformError('YouTube-Anmeldung hat keine Moderations-Schreibberechtigung (youtube.force-ssl).','MISSING_PERMISSION');
    const own=await this.api('channels',{part:'id,snippet',mine:'true'});const id=own.items?.[0]?.id;if(!id)throw new PlatformError('Kein YouTube-Kanal für diese Anmeldung bestätigt.','IDENTITY');
    this.identity={id,username:own.items[0].snippet?.title||id};
    let isOwner=false,pageToken='';for(let page=0;page<100;page++){const broadcasts=await this.api('liveBroadcasts',{part:'snippet',mine:'true',maxResults:'50',...(pageToken?{pageToken}:{})});isOwner=(broadcasts.items||[]).some(x=>x.snippet?.liveChatId===cfg.liveChatId&&x.snippet?.channelId===id);pageToken=broadcasts.nextPageToken;if(isOwner||!pageToken)break;}
    if(!isOwner)throw new PlatformError('Die Inhaberschaft dieses Live-Chats wurde nicht bestätigt. Moderation bleibt gesperrt.','OWNER_REQUIRED');
    return {channelId:str(cfg.liveChatId),identity:this.identity,actions:Object.fromEntries(ACTIONS.map(x=>[x,true])),own:true};
  }
  async snapshot(auth){const items=[];let pageToken='';for(let i=0;i<100;i++){const response=await this.api('liveChat/moderators',{part:'snippet',liveChatId:auth.channelId,maxResults:'100',...(pageToken?{pageToken}:{})});items.push(...(response.items||[]));pageToken=response.nextPageToken;if(!pageToken)break;if(i===99)throw new PlatformError('Moderatorenliste unvollständig.','LIMIT');}
    const confirmedAt=new Date().toISOString();return {moderators:items.map(x=>({platform:'youtube',channelId:auth.channelId,userId:x.snippet?.moderatorDetails?.channelId,username:x.snippet?.moderatorDetails?.displayName,displayName:x.snippet?.moderatorDetails?.displayName,resourceId:x.id,confirmedAt})).filter(x=>x.userId),muted:null,blocked:null,listMode:'complete',bansMode:'observed',confirmedAt};}
  async perform(p,auth,state){
    if(!/^UC[\w-]{20,30}$/.test(p.userId))throw new PlatformError('Eine bestätigte YouTube-Kanal-ID der Zielperson ist erforderlich.','IDENTITY');
    if(p.action==='addModerator'){const r=await this.api('liveChat/moderators',{part:'snippet'},'POST',{snippet:{liveChatId:auth.channelId,moderatorDetails:{channelId:p.userId}}});if(!r.id)throw new PlatformError('Moderatorantwort ohne Ressourcen-ID.','INVALID_RESPONSE',true);return {resourceId:r.id};}
    if(p.action==='removeModerator'){const target=state.moderators.find(x=>x.userId===p.userId);if(!target?.resourceId)throw new PlatformError('Aktuelle Moderator-ID fehlt. Liste erneut abgleichen.','RESOURCE_REQUIRED');await this.api('liveChat/moderators',{id:target.resourceId},'DELETE');return {};}
    if(['unmute','unblock'].includes(p.action)){const target=[...state.muted,...state.blocked].find(x=>x.userId===p.userId);if(!target?.resourceId)throw new PlatformError('Die YouTube-Sperr-ID ist nicht bekannt. In der Plattformverwaltung aufheben.','RESOURCE_REQUIRED');await this.api('liveChat/bans',{id:target.resourceId},'DELETE');return {};}
    const snippet={liveChatId:auth.channelId,type:p.action==='mute'?'temporary':'permanent',bannedUserDetails:{channelId:p.userId}};if(p.action==='mute')snippet.banDurationSeconds=p.durationSeconds;
    const r=await this.api('liveChat/bans',{part:'snippet'},'POST',{snippet});if(!r.id)throw new PlatformError('Sperrantwort ohne Ressourcen-ID.','INVALID_RESPONSE',true);return {resourceId:r.id,expiresAt:p.action==='mute'?new Date(Date.now()+p.durationSeconds*1000).toISOString():''};
  }
}
function initialState(platform){return {platform,channelId:'',connected:false,identity:null,actions:none(),moderators:[],muted:[],blocked:[],listMode:'unavailable',bansMode:'unavailable',confirmedAt:'',error:['tiktok','cng'].includes(platform)?'Plattformaktion nicht verfügbar: kein nachgewiesener Moderations-Sendeweg.':'Moderationskonto noch nicht angemeldet.'};}
class ModerationService {
  constructor({adapters={},archive,onChange=()=>{},now=Date.now}={}){Object.assign(this,{adapters,archive,onChange,now});this.states=Object.fromEntries(['twitch','youtube','tiktok','cng'].map(p=>[p,initialState(p)]));this.entries=new Map();this.locks=new Map();this.refreshes=new Map();}
  snapshot(platform){const expire=state=>({...state,muted:state.muted.filter(x=>!x.expiresAt||Date.parse(x.expiresAt)>this.now()),stale:!!state.confirmedAt&&this.now()-Date.parse(state.confirmedAt)>120000});return platform?expire(this.states[platform]||initialState(platform)):Object.fromEntries(Object.entries(this.states).map(([p,s])=>[p,expire(s)]));}
  emit(){this.onChange(this.snapshot());}
  async restore(){if(!this.archive)return;const history=await this.archive.history({}).catch(()=>({items:[]}));for(const entry of (history.items||[]).reverse()){if(entry.result==='pending'){entry.result='unknown';entry.error='Programm wurde vor der Plattformbestätigung beendet. Status abgleichen.';this.archive.recordModeration(entry);}this.entries.set(entry.id,entry);if(entry.result==='unknown')this.locks.set(identityKey(entry.platform,entry.channelId,entry.userId),entry.id);}}
  capabilities(platform){return this.snapshot(platform);}
  async refresh(platform){if(this.refreshes.has(platform))return this.refreshes.get(platform);const operation=this.refreshOnce(platform).finally(()=>this.refreshes.delete(platform));this.refreshes.set(platform,operation);return operation;}
  recordObservedChanges(platform,auth,state,lists){
    for(const [name,added,removed]of [['moderators','addModerator','removeModerator'],['muted','mute','unmute'],['blocked','block','unblock']]){
      if(!Array.isArray(lists[name]))continue;
      const previous=state.channelId===auth.channelId?state[name]:[],current=lists[name],alreadyComplete=state.channelId===auth.channelId&&(name==='moderators'?state.listMode:state.bansMode)==='complete';
      const changes=current.filter(row=>!alreadyComplete||!previous.some(old=>old.userId===row.userId)).map(row=>({row,action:added}));
      if(alreadyComplete)changes.push(...previous.filter(row=>!current.some(item=>item.userId===row.userId)).map(row=>({row,action:removed})));
      for(const {row,action}of changes){if(this.locks.has(identityKey(platform,auth.channelId,row.userId)))continue;const entry={id:crypto.randomUUID(),timestamp:lists.confirmedAt,platform,channelId:auth.channelId,userId:row.userId,username:row.username,displayName:row.displayName,action,result:'confirmed',source:'platform_snapshot',reason:row.reason||'Von der Plattform nicht mitgeteilt',reasonSource:'platform',actor:'',executor:row.executor||'',expiresAt:row.expiresAt||'',confirmedAt:lists.confirmedAt};this.archive?.recordModeration(entry);}
    }
  }
  async refreshOnce(platform){
    const adapter=this.adapters[platform],state=this.states[platform];if(!adapter||!state)return {ok:false,state:this.snapshot(platform),error:state?.error||'Plattformaktion nicht verfügbar.'};
    try{const auth=await adapter.verify();const lists=await adapter.snapshot(auth);this.recordObservedChanges(platform,auth,state,lists);const sameChannel=state.channelId===auth.channelId;Object.assign(state,{connected:true,channelId:auth.channelId,channelLogin:auth.channelLogin||'',identity:auth.identity,actions:auth.actions,error:'',confirmedAt:lists.confirmedAt,listMode:lists.listMode,bansMode:lists.bansMode,moderators:lists.moderators??(sameChannel?state.moderators:[]),muted:lists.muted??(sameChannel?state.muted:[]),blocked:lists.blocked??(sameChannel?state.blocked:[])});
      // Only fresh complete lists can settle a previously ambiguous request; nothing is resent.
      for(const [key,id] of this.locks){const e=this.entries.get(id);if(!e||e.platform!==platform||e.channelId!==auth.channelId||e.result!=='unknown')continue;const mods=lists.moderators,bans=lists.muted&&lists.blocked?[...lists.muted,...lists.blocked]:null;let applied=false;
        if(e.action==='addModerator'&&mods)applied=mods.some(x=>x.userId===e.userId);if(e.action==='removeModerator'&&mods)applied=!mods.some(x=>x.userId===e.userId);if(['block','mute'].includes(e.action)&&bans)applied=bans.some(x=>x.userId===e.userId&&Boolean(x.expiresAt)===(e.action==='mute'));if(['unblock','unmute'].includes(e.action)&&bans)applied=!bans.some(x=>x.userId===e.userId);
        if(applied){Object.assign(e,{result:'confirmed',confirmedAt:new Date().toISOString(),source:'reconciled',error:''});this.archive?.recordModeration(e);this.locks.delete(key);}
      }
      this.emit();return {ok:true,state:this.snapshot(platform)};
    }catch(error){Object.assign(state,{connected:false,actions:none(),error:error.message});this.emit();return {ok:false,error:error.message,state:this.snapshot(platform)};}
  }
  reset(platform){if(this.states[platform])this.states[platform]=initialState(platform);this.emit();}
  observe(event,channelHint=''){
    if(event.type!=='chat'||!this.states[event.platform])return;const user=event.user||{},raw=event.meta?.rawData||event.raw||{},data=raw.data||raw;
    const channelId=str(event.channelId||event.channel?.id||data.channelId||data.roomId||data.room_id||raw.snippet?.liveChatId||channelHint),userId=str(user.id||event.userId);
    if(!channelId||!userId||event.meta?.sourceConnector==='fake-connector')return;
    const verified=event.identityVerified===true||user.identityVerified===true||event.platform==='youtube'&&/^UC[\w-]{20,30}$/.test(userId)||event.platform==='tiktok'&&/^\d{5,}$/.test(userId);
    if(!verified||!user.isModerator)return;const state=this.states[event.platform];if(state.channelId&&state.channelId!==channelId)return;
    if(state.listMode==='complete')return;
    state.channelId=channelId;state.listMode='observed';const row={platform:event.platform,channelId,userId,username:user.username,displayName:user.displayName,confirmedAt:event.timestamp,source:'chat_role'};const at=state.moderators.findIndex(x=>x.userId===userId);if(at<0)state.moderators.push(row);else state.moderators[at]=row;this.emit();
  }
  enrichChat(event,channelHint=''){
    const state=this.states[event.platform];if(!state||event.type!=='chat')return event;const raw=event.meta?.rawData||{},data=raw.data||raw;const channelId=str(event.channelId||event.channel?.id||data.channelId||data.roomId||data.room_id||raw.snippet?.liveChatId||channelHint);const user=event.user||{};
    if(!channelId||state.channelId!==channelId)return channelId?{...event,channelId}:event;
    const listFresh=state.connected&&state.listMode==='complete'&&this.now()-Date.parse(state.confirmedAt)<120000;
    const trustedPopout=event.platform==='twitch'&&event.meta?.sourceConnector==='twitch-popout';
    if(trustedPopout&&state.connected&&state.channelLogin&&user.username?.toLowerCase()===state.channelLogin&&this.now()-Date.parse(state.confirmedAt)<120000)return {...event,channelId,user:{...user,id:channelId,identityVerified:true,isBroadcaster:true,isModerator:false,roleConfirmedAt:state.confirmedAt}};
    const byLogin=trustedPopout&&listFresh&&!/^\d+$/.test(user.id||'')?state.moderators.find(x=>x.username?.toLowerCase()===user.username?.toLowerCase()):null;
    const row=state.moderators.find(x=>x.userId===user.id)||byLogin;const isFresh=row&&this.now()-Date.parse(row.confirmedAt)<120000;
    if(isFresh)return {...event,channelId,user:{...user,...(byLogin?{id:row.userId,identityVerified:true}:{}),isModerator:true,moderatorConfirmedAt:row.confirmedAt}};
    if(state.connected&&state.listMode==='complete'&&this.now()-Date.parse(state.confirmedAt)<120000)return {...event,channelId,user:{...user,isModerator:false}};
    return {...event,channelId};
  }
  async perform(input={}){
    const p={platform:str(input.platform,20),channelId:str(input.channelId),userId:str(input.userId),username:str(input.username),displayName:str(input.displayName||input.username),action:str(input.action),reason:str(input.reason,500),durationSeconds:Math.trunc(Number(input.durationSeconds)||600),messageId:str(input.messageId),actor:str(input.actor||'Batto-Bedienung')};
    const adapter=this.adapters[p.platform];if(!adapter||!ACTIONS.includes(p.action))return {ok:false,error:'Plattformaktion nicht verfügbar.'};
    if(!p.channelId||!p.userId||p.userId==='unknown')return {ok:false,error:'Stabile Nutzer-ID und Kanal-/Raum-ID fehlen. Keine Aktion gesendet.'};
    if(['mute','block'].includes(p.action)&&!p.reason.trim())return {ok:false,error:'Bitte einen Grund für die Moderationsaktion eingeben.'};
    if(p.action==='mute'&&(p.durationSeconds<1||p.durationSeconds>1209600))return {ok:false,error:'Dauer muss zwischen 1 Sekunde und 14 Tagen liegen.'};
    const id=str(input.requestId||crypto.randomUUID());if(this.entries.has(id)){const e=this.entries.get(id);if(['platform','channelId','userId','action','reason','durationSeconds'].some(k=>e[k]!==p[k]))return {ok:false,error:'Diese Auftrags-ID gehört zu einer anderen Moderationsaktion.'};return {ok:e.result==='confirmed',duplicate:true,entry:{...e},state:this.snapshot(p.platform)};}
    const key=identityKey(p.platform,p.channelId,p.userId);if(this.locks.has(key))return {ok:false,error:'Für diese Person läuft bereits eine Aktion oder ihr Ausgang ist unklar. Zuerst Status abgleichen.',entry:this.entries.get(this.locks.get(key))};
    this.locks.set(key,id);
    let entry;
    try{
      const auth=await adapter.verify();if(auth.channelId!==p.channelId)throw new PlatformError('Nachrichtenkanal und angemeldeter Moderationskanal stimmen nicht überein.','CHANNEL_MISMATCH');
      if(!auth.actions[p.action])throw new PlatformError('Für diese Aktion fehlen bestätigte Plattformrechte oder OAuth-Berechtigungen.','MISSING_PERMISSION');
      if(p.userId===auth.channelId||p.userId===auth.identity.id)throw new PlatformError('Das ausführende Konto bzw. der Kanalinhaber kann hier nicht Ziel sein.','SELF_TARGET');
      if(['removeModerator','unmute','unblock'].includes(p.action)&&p.platform==='youtube'){const refresh=await this.refresh(p.platform);if(!refresh.ok)throw new PlatformError(refresh.error,'REFRESH_REQUIRED');}
      entry={id,timestamp:new Date().toISOString(),...p,executor:auth.identity.id,result:'pending',reasonSource:p.platform==='youtube'?'local':'platform',...(this.archive?.config.excerptsEnabled&&input.lastMessage?{lastMessage:str(input.lastMessage,10000)}:{})};this.entries.set(id,entry);this.archive?.recordModeration(entry);this.emit();
      const response=await adapter.perform(p,auth,this.states[p.platform]);Object.assign(entry,response,{result:'confirmed',confirmedAt:new Date().toISOString()});
      const state=this.states[p.platform];if(state.channelId!==p.channelId)Object.assign(state,initialState(p.platform),{channelId:p.channelId});Object.assign(state,{connected:true,identity:auth.identity,actions:auth.actions});
      const row={platform:p.platform,channelId:p.channelId,userId:p.userId,username:p.username,displayName:p.displayName,reason:p.reason,reasonSource:entry.reasonSource,executor:entry.executor,confirmedAt:entry.confirmedAt,...response};
      const remove=name=>{state[name]=state[name].filter(x=>x.userId!==p.userId);};
      if(p.action==='addModerator'){remove('moderators');state.moderators.push(row);}if(p.action==='removeModerator')remove('moderators');
      if(['block','mute','unblock','unmute'].includes(p.action)){remove('muted');remove('blocked');if(p.action==='block')state.blocked.push(row);if(p.action==='mute')state.muted.push(row);}
      this.archive?.recordModeration(entry);this.locks.delete(key);this.emit();return {ok:true,entry:{...entry},state:this.snapshot(p.platform)};
    }catch(error){
      const unknown=!!entry&&error.uncertain;entry=entry||{id,timestamp:new Date().toISOString(),...p,executor:this.states[p.platform]?.identity?.id||'',reasonSource:'local'};Object.assign(entry,{result:unknown?'unknown':'failed',error:error.message,errorCode:error.code||'ERROR'});this.entries.set(id,entry);this.archive?.recordModeration(entry);if(!unknown)this.locks.delete(key);if(['401','403','AUTH_REQUIRED','MISSING_PERMISSION'].includes(error.code)){this.states[p.platform].actions=none();this.states[p.platform].error=error.message;}this.emit();return {ok:false,error:error.message,entry:{...entry},state:this.snapshot(p.platform)};
    }
  }
}
module.exports={ModerationService,TwitchModeration,YouTubeModeration,PlatformError,jsonRequest,identityKey,ACTIONS};
