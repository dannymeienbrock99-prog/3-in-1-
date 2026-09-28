'use strict';
const path=require('node:path');
const {ArchiveService,archiveConfig}=require('../src/core/community/archive-service.cjs');
const {ModerationService,TwitchModeration,YouTubeModeration}=require('../src/core/community/moderation-service.cjs');
const {ViewerService,viewerConfig}=require('../src/core/community/viewer-service.cjs');
const {TwitchModerationLogin}=require('../src/core/community/twitch-moderation-login.cjs');
const DEFAULT_COMMUNITY={archive:{enabled:false,moderationEnabled:true,excerptsEnabled:false,directory:'',retentionDays:0},viewers:{enabled:true,tiktok:true,twitch:true},moderation:{twitch:{clientId:'',broadcasterId:'',channel:''},youtube:{liveChatId:'',channelId:''}}};
function createCommunityServices({dataDir,getConfig,saveConfig,secrets,send=()=>{},dialog,shell,getParent=()=>null,fetchImpl=fetch}={}){
  let config=getConfig(),started=false,refreshTimer=null,applying=Promise.resolve(),closed=false;
  const current=()=>config.community||{};
  const platformConfig=p=>({...config.platforms?.[p],...current().moderation?.[p],...(p==='twitch'?{channel:current().moderation?.twitch?.channel||config.platforms?.twitch?.channel||'',clientId:current().moderation?.twitch?.clientId||config.platforms?.twitch?.clientId||''}:{liveChatId:current().moderation?.youtube?.liveChatId||config.platforms?.youtube?.liveChatId||''})});
  const broadcast=()=>send('community:status',snapshot());
  const archive=new ArchiveService({dataDir,config:current().archive,onStatus:status=>{send('archive:status',status);broadcast();}});
  let moderation;
  const login=new TwitchModerationLogin({secrets,fetchImpl,onChange:status=>{send('moderation:loginStatus',status);broadcast();},onConnected:async()=>{await moderation.refresh('twitch');}});
  const twitch=new TwitchModeration({getToken:()=>login.token(),getConfig:()=>platformConfig('twitch'),fetchImpl});
  const youtube=new YouTubeModeration({getToken:async()=>secrets.get('community-youtube-token'),getConfig:()=>platformConfig('youtube'),fetchImpl});
  moderation=new ModerationService({adapters:{twitch,youtube},archive,onChange:state=>{send('moderation:state',state);broadcast();}});
  const twitchViewers=new TwitchModeration({getToken:async()=>{const token=await login.token();if(token)return token;try{const prior=JSON.parse(secrets.get('twitch-device-session')||'null');if(prior?.expires>Date.now()+60000)return prior.accessToken;}catch{}return secrets.get('twitch-write-token');},getConfig:()=>platformConfig('twitch'),fetchImpl});
  const viewers=new ViewerService({getTwitch:()=>twitchViewers.viewers(),config:current().viewers,onChange:state=>send('viewers:status',state)});
  function snapshot(){return {archive:archive.status(),moderation:moderation.snapshot(),viewers:viewers.snapshot(),login:login.snapshot()};}
  function channelHint(platform,event={}){if(platform==='twitch'){const raw=event.meta?.rawData||event.raw||{},incoming=String(raw.channel||event.channel||'').replace(/^#/,'').toLowerCase(),state=moderation.snapshot('twitch');if(incoming&&state.connected&&state.channelLogin===incoming)return state.channelId;return incoming?'login:'+incoming:'';}if(platform==='youtube')return config.platforms?.youtube?.liveChatId||'';if(platform==='tiktok')return String(config.platforms?.tikfinity?.roomId||'');return '';}
  async function applyConfig(next){config=next||getConfig();viewers.configure(current().viewers);const archiveNext=archiveConfig(current().archive);if(JSON.stringify(archive.config)!==JSON.stringify(archiveNext)){applying=applying.catch(()=>{}).then(()=>archive.configure(archiveNext));await applying;}broadcast();}
  async function save(section,patch){const next=await saveConfig({community:{[section]:patch}});await applyConfig(next?.community?next:getConfig());return {ok:true,...(section==='archive'?{status:archive.status()}:{status:snapshot()})};}
  async function refreshAll(){for(const p of ['twitch','youtube']){if(closed)return;if(p==='twitch'?(secrets.has('community-twitch-token')||secrets.has('community-twitch-session')):secrets.has('community-youtube-token'))await moderation.refresh(p);}}
  function wrap(fn){return async(_event,input)=>{try{return await fn(input||{});}catch(error){return {ok:false,error:error.message};}};}
  async function connect(p){
    if(!['twitch','youtube'].includes(p.platform))throw new Error('Für diese Plattform ist keine bestätigte Moderationsanmeldung verfügbar.');
    const fields=p.platform==='twitch'?['clientId','broadcasterId','channel']:['liveChatId','channelId'];const patch={...current().moderation?.[p.platform]};for(const field of fields)if(p[field]!==undefined)patch[field]=String(p[field]).trim().slice(0,300);
    await save('moderation',{[p.platform]:patch});
    if(p.platform==='twitch'&&!String(p.token||'').trim()){const status=await login.start(platformConfig('twitch').clientId);return {ok:true,pending:true,...status};}
    const token=String(p.token||'').trim().replace(/^(oauth:|Bearer\s+)/i,'');if(!token)throw new Error('YouTube OAuth-Zugriffstoken mit youtube.force-ssl-Berechtigung erforderlich.');if(token.length>16000)throw new Error('Anmeldung ungültig.');
    const ref='community-'+p.platform+'-token';const previous=secrets.get(ref);secrets.set(ref,token);
    try{if(p.platform==='twitch'){login.cancel();const priorSession=secrets.get('community-twitch-session');secrets.delete('community-twitch-session');try{await twitch.verify();}catch(error){if(priorSession)secrets.set('community-twitch-session',priorSession);throw error;}}else await youtube.verify();}
    catch(error){if(previous)secrets.set(ref,previous);else secrets.delete(ref);throw error;}
    const result=await moderation.refresh(p.platform);return {...result,connected:result.ok};
  }
  function registerIpc(ipcMain){
    ipcMain.handle('community:status',()=>snapshot());
    ipcMain.handle('archive:search',wrap(p=>archive.search(p)));ipcMain.handle('archive:sessions',wrap(()=>archive.sessions()));ipcMain.handle('archive:context',wrap(p=>archive.context(p)));ipcMain.handle('archive:config',wrap(p=>save('archive',archiveConfig({...current().archive,...p}))));
    ipcMain.handle('archive:chooseDirectory',wrap(async()=>{const result=await dialog.showOpenDialog(getParent()||undefined,{title:'Speicherordner für das Chatarchiv',properties:['openDirectory','createDirectory']});if(result.canceled||!result.filePaths?.[0])return {ok:false,canceled:true};return save('archive',{...archive.config,directory:result.filePaths[0]});}));
    ipcMain.handle('archive:export',wrap(async p=>{const format=['json','csv','txt'].includes(p.format)?p.format:'json';const result=await dialog.showSaveDialog(getParent()||undefined,{title:'Chatarchiv exportieren',defaultPath:'Batto-Chatarchiv-'+new Date().toISOString().slice(0,10)+'.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]});if(result.canceled||!result.filePath)return {ok:false,canceled:true};return archive.export({format,filters:p.filters||{},file:result.filePath});}));
    ipcMain.handle('moderation:history',wrap(p=>archive.history(p)));ipcMain.handle('moderation:capabilities',wrap(p=>({ok:true,state:moderation.capabilities(p.platform)})));ipcMain.handle('moderation:state',()=>moderation.snapshot());ipcMain.handle('moderation:refresh',wrap(p=>moderation.refresh(p.platform)));ipcMain.handle('moderation:perform',wrap(p=>moderation.perform(p)));ipcMain.handle('moderation:connect',wrap(connect));
    ipcMain.handle('moderation:resolve',wrap(async p=>{if(p.platform!=='twitch')return {ok:false,error:'Für diese Plattform wird die stabile Nutzer-ID aus der Nachricht benötigt.'};const result=await twitch.resolve(p.username);if(!p.channelId||p.channelId!==result.channelId&&p.channelId!=='login:'+result.channelLogin)return {ok:false,error:'Moderationskanal stimmt nicht mit dem Nachrichtenkanal überein.'};return result;}));
    ipcMain.handle('moderation:disconnect',wrap(p=>{if(p.platform==='twitch')login.disconnect();else if(p.platform==='youtube')secrets.delete('community-youtube-token');else return {ok:false,error:'Unbekannte Anmeldung.'};moderation.reset(p.platform);return {ok:true,state:moderation.snapshot(p.platform)};}));
    ipcMain.handle('moderation:loginStatus',()=>login.snapshot());
    ipcMain.handle('moderation:openLogin',wrap(async()=>{const status=login.snapshot();if(status.status!=='pending')return {ok:false,error:'Keine laufende Twitch-Anmeldung.'};await shell.openExternal(status.url);return {ok:true};}));
    ipcMain.handle('viewers:status',()=>viewers.snapshot());ipcMain.handle('viewers:config',wrap(p=>save('viewers',viewerConfig({...current().viewers,...p}))));
  }
  return {archive,moderation,viewers,login,snapshot,registerIpc,applyConfig,perform:p=>moderation.perform(p),
    onEvent(event){moderation.observe(event,channelHint(event.platform,event));archive.ingest(event,channelHint(event.platform,event));if(event.platform==='tiktok')viewers.ingestTikFinity(event);},
    onTikFinityEvent:event=>viewers.ingestTikFinity(event),enrichChat:event=>moderation.enrichChat(event,channelHint(event.platform,event)),
    async start(){if(started)return;started=true;try{await archive.start();await moderation.restore();}catch(error){archive.fail(error);}refreshAll().catch(()=>{});viewers.start();refreshTimer=setInterval(()=>refreshAll().catch(()=>{}),60000);refreshTimer.unref?.();broadcast();},
    async close(){closed=true;clearInterval(refreshTimer);viewers.stop();login.cancel();await archive.close();}
  };
}
module.exports={createCommunityServices,DEFAULT_COMMUNITY};
