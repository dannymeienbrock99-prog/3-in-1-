'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ArchiveService}=require('../src/core/community/archive-service.cjs');
const {ModerationService,TwitchModeration,YouTubeModeration,PlatformError,identityKey}=require('../src/core/community/moderation-service.cjs');
const {ViewerService}=require('../src/core/community/viewer-service.cjs');
const {AuditStore}=require('../src/core/storage/audit-store.cjs');
const {createCommunityServices}=require('../electron/community-services.cjs');
const {diagnosticEntry}=require('../src/core/community/diagnostic-privacy.cjs');
const {ChatCore,normalizeMessage}=require('../src/core/chat-core.cjs');
const {DatabaseSync}=require('node:sqlite');
const taskDir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-community-'));
const event=(id,text,userId='10',platform='twitch',channelId='20')=>({eventId:id,type:'chat',platform,channelId,identityVerified:true,timestamp:'2026-09-15T12:00:00.000Z',user:{id:userId,username:'gleich',displayName:'Gleich'},message:{text},meta:{rawData:{token:'not-for-disk',comment:text}}});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
async function archiveChecks(){
  const config={enabled:false,moderationEnabled:true,excerptsEnabled:false};let archive=new ArchiveService({dataDir:taskDir,config});await archive.start();
  assert.equal(archive.ingest(event('off','Aus darf nicht bleiben')),false);
  await archive.configure({enabled:true});
  archive.ingest(event('one','Grüße aus Köln 🚨'));archive.ingest(event('one','Grüße aus Köln 🚨'));archive.ingest(event('two','Andere Plattform','10','youtube','20'));archive.ingest(event('three','Anderer Kanal','10','twitch','21'));archive.ingest(event('formula','=HYPERLINK("https://invalid.test")'));
  let result=await archive.search({query:'Grüße'});assert.equal(result.total,1);assert.equal(result.items[0].text,'Grüße aus Köln 🚨');
  assert.equal((await archive.search({query:'🚨'})).total,1);assert.equal((await archive.search({query:'" OR *'})).total,0);
  assert.equal((await archive.search({platform:'twitch',channelId:'20',userId:'10'})).total,2);
  archive.ingest(event('last-on','Noch bei aktiver Aufzeichnung empfangen'));await archive.configure({enabled:false});archive.ingest(event('off2','Aus nach Schalter'));assert.equal((await archive.search({query:'Schalter'})).total,0);assert.equal((await archive.search({query:'Aufzeichnung'})).total,1);
  archive.recordModeration({id:'mod1',timestamp:'2026-09-15T12:00:05.000Z',platform:'twitch',channelId:'20',userId:'10',action:'mute',result:'confirmed',reason:'Regel',lastMessage:'KEIN_AUSZUG'});
  assert.equal((await archive.history({})).items[0].lastMessage,undefined);
  await archive.configure({excerptsEnabled:true});archive.recordModeration({id:'mod2',timestamp:'2026-09-15T12:00:06.000Z',platform:'twitch',channelId:'20',userId:'10',action:'mute',result:'confirmed',lastMessage:'ERLAUBTER_AUSZUG'});
  assert.equal((await archive.history({})).items[0].lastMessage,'ERLAUBTER_AUSZUG');
  const context=await archive.context({platform:'twitch',channelId:'20',timestamp:'2026-09-15T12:00:05.000Z'});assert.equal(context.contextStatus,'recorded');assert(context.items.every(x=>x.channelId==='20'&&x.platform==='twitch'));
  const csvFile=path.join(taskDir,'archive.csv');await archive.export({format:'csv',filters:{platform:'twitch'},file:csvFile});assert.match(fs.readFileSync(csvFile,'utf8'),/"'=HYPERLINK/);
  const jsonFile=path.join(taskDir,'archive.json');await archive.export({format:'json',filters:{query:'Grüße'},file:jsonFile});assert.equal(JSON.parse(fs.readFileSync(jsonFile,'utf8')).length,1);
  assert.equal((await archive.sessions()).items.length,1);await archive.close();
  archive=new ArchiveService({dataDir:taskDir,config});await archive.start();assert.equal((await archive.search({})).total,5);assert.equal((await archive.search({person:'10'})).total,5);assert.equal((await archive.history({})).items.length,2);await archive.close();
  const db=new DatabaseSync(path.join(taskDir,'chat-archive.db'));const all=JSON.stringify(db.prepare('SELECT * FROM messages').all());assert(!all.includes('not-for-disk'));assert(!all.includes('Aus darf nicht bleiben'));db.close();
  const audit=new AuditStore({dataDir:path.join(taskDir,'audit')});audit.open();audit.writeEvent(event('audit','DIAGNOSTIK_DARF_DAS_NICHT'));audit.writeModeration({id:'legacy',timestamp:new Date().toISOString(),platform:'twitch',action:'mute',lastMessage:'NICHT_SPEICHERN'});audit.close();
  const auditDb=new DatabaseSync(path.join(taskDir,'audit','batto.db'));assert(!JSON.stringify(auditDb.prepare('SELECT * FROM events').all()).includes('DIAGNOSTIK'));assert.equal(auditDb.prepare('SELECT count(*) AS n FROM moderation_audit').get().n,0);auditDb.close();
  const obstruction=path.join(taskDir,'not-a-directory');fs.writeFileSync(obstruction,'x');const failed=new ArchiveService({dataDir:obstruction,config});await assert.rejects(()=>failed.start());assert.equal(failed.status().state,'error');await failed.close();
}
async function moderationChecks(){
  let calls=0,release;const adapter={verify:async()=>({channelId:'20',identity:{id:'20',username:'owner'},actions:{block:true,mute:true,unblock:true,unmute:true,addModerator:true,removeModerator:true}}),snapshot:async()=>({moderators:[],muted:[],blocked:[],listMode:'complete',bansMode:'complete',confirmedAt:new Date().toISOString()}),perform:async()=>{calls++;await new Promise(r=>{release=r;});return {};}};
  const history=[];const archive={config:{excerptsEnabled:false},recordModeration:e=>history.push({...e})};const mod=new ModerationService({adapters:{twitch:adapter},archive});
  assert.notEqual(identityKey('twitch','20','10'),identityKey('youtube','20','10'));assert.notEqual(identityKey('twitch','20','10'),identityKey('twitch','21','10'));
  assert.equal((await mod.perform({platform:'tiktok',userId:'10',channelId:'20',action:'block',reason:'Test'})).ok,false);
  assert.equal((await mod.perform({platform:'twitch',userId:'10',channelId:'21',action:'block',reason:'Test'})).ok,false);assert.equal(calls,0);
  const p={requestId:'same-id',platform:'twitch',userId:'10',channelId:'20',username:'same',action:'block',reason:'Test',lastMessage:'DO_NOT_PERSIST'};
  const first=mod.perform(p);await new Promise(r=>setImmediate(r));assert.equal((await mod.perform({...p,requestId:'second'})).ok,false);assert.equal(calls,1);release();assert.equal((await first).ok,true);assert.equal((await mod.perform(p)).duplicate,true);assert.equal(calls,1);assert(history.every(x=>!x.lastMessage));assert.equal(mod.snapshot('twitch').blocked[0].userId,'10');
  adapter.perform=async()=>{calls++;throw new PlatformError('Unklar','NETWORK',true);};const unknown=await mod.perform({...p,userId:'11',requestId:'unknown'});assert.equal(unknown.entry.result,'unknown');assert.equal((await mod.perform({...p,userId:'11',requestId:'retry'})).ok,false);assert.equal(calls,2);
  adapter.snapshot=async()=>({moderators:[],muted:[],blocked:[{userId:'11',channelId:'20',expiresAt:'',confirmedAt:new Date().toISOString()}],listMode:'complete',bansMode:'complete',confirmedAt:new Date().toISOString()});await mod.refresh('twitch');assert.equal(mod.entries.get('unknown').result,'confirmed');assert.equal(calls,2);
  adapter.verify=async()=>{throw new PlatformError('Abgelaufen','401');};assert.equal((await mod.refresh('twitch')).ok,false);assert(Object.values(mod.snapshot('twitch').actions).every(x=>!x));
  const requestLog=[];const twitch=new TwitchModeration({getToken:async()=>'SECRET_TOKEN',getConfig:()=>({clientId:'client',broadcasterId:'20'}),fetchImpl:async(url,options)=>{requestLog.push({url,options});if(url.includes('/validate'))return response({user_id:'20',login:'owner',client_id:'client',scopes:['moderation:read','channel:manage:moderators','moderator:manage:banned_users']});if(options.method==='POST')return response({data:[{end_time:'2026-09-15T12:00:05Z'}]});return response({data:[]});}});
  const auth=await twitch.verify();assert.equal(auth.actions.addModerator,true);await twitch.perform({...p,action:'mute',durationSeconds:200},auth);assert.equal(JSON.parse(requestLog.at(-1).options.body).data.duration,200);assert.equal(JSON.parse(requestLog.at(-1).options.body).data.user_id,'10');
  const yt=new YouTubeModeration({getToken:async()=>'TOKEN',getConfig:()=>({liveChatId:'LIVE'}),fetchImpl:async url=>{if(url.includes('tokeninfo'))return response({scope:'https://www.googleapis.com/auth/youtube.readonly'});throw new Error('must not call');}});await assert.rejects(()=>yt.verify(),/Schreibberechtigung/);
}
async function viewerChecks(){let now=1000000;const service=new ViewerService({getTwitch:async()=>({state:'live',count:0}),now:()=>now});await service.poll();assert.equal(service.snapshot().twitch.count,0);assert.equal(service.snapshot().twitch.state,'live');
  assert.equal(service.ingestTikFinity({event:'like',data:{count:99,viewerCount:999}}),false);assert.equal(service.ingestTikFinity({event:'roomUser',data:{viewerCount:0}}),true);assert.equal(service.snapshot().tiktok.count,0);
  assert.equal(service.ingestTikFinity({event:'roomUser',data:{viewerCount:null,totalViewerCount:999}}),false);now+=100000;assert.equal(service.snapshot().tiktok.state,'stale');service.ingestTikFinity({event:'streamEnd'});assert.equal(service.snapshot().tiktok.state,'offline');service.configure({enabled:false});assert.equal(service.snapshot().tiktok.state,'disabled');
  service.configure({enabled:true,tiktok:false,twitch:true});assert.equal(service.snapshot().tiktok.state,'disabled');service.getTwitch=async()=>{throw new Error('offline socket')};await service.poll();assert.equal(service.snapshot().twitch.state,'unavailable');service.stop();
}
async function channelChecks(){
  const config={community:{archive:{enabled:false},viewers:{enabled:false},moderation:{twitch:{channel:'configured-other'}}},platforms:{twitch:{channel:'misconfigured'},youtube:{liveChatId:'actual-reader'}}};
  const service=createCommunityServices({dataDir:path.join(taskDir,'integration'),getConfig:()=>config,saveConfig:()=>config,secrets:{get:()=>'',has:()=>false,set:()=>{},delete:()=>{}},fetchImpl:async()=>{throw new Error('No external calls allowed in test');}});
  const now=new Date().toISOString();Object.assign(service.moderation.states.twitch,{channelId:'20',channelLogin:'actual-channel',connected:true,listMode:'complete',confirmedAt:now,moderators:[{userId:'10',username:'gleich',displayName:'Gleich',channelId:'20',confirmedAt:now}]});
  const incoming=event('channel','hi','gleich');delete incoming.channelId;incoming.meta={sourceConnector:'twitch-popout',rawData:{channel:'actual-channel'}};
  let enriched=service.enrichChat(incoming);assert.equal(enriched.channelId,'20');assert.equal(enriched.user.id,'10');assert.equal(enriched.user.identityVerified,true);assert.equal(enriched.user.isModerator,true);
  const elsewhere={...incoming,meta:{...incoming.meta,rawData:{channel:'unrelated-channel'}}};enriched=service.enrichChat(elsewhere);assert.equal(enriched.channelId,'login:unrelated-channel');assert.equal(enriched.user.id,'gleich');assert.equal(enriched.user.isModerator,undefined);
  const forged={...incoming,meta:{...incoming.meta,sourceConnector:'fake-connector'}};assert.equal(service.enrichChat(forged).user.id,'gleich');
  service.moderation.states.twitch.confirmedAt='2000-01-01T00:00:00Z';assert.equal(service.enrichChat(incoming).user.id,'gleich');
  const handlers=new Map();service.registerIpc({handle:(key,fn)=>handlers.set(key,fn)});assert(handlers.has('archive:context'));assert(handlers.has('moderation:resolve'));assert(handlers.has('moderation:openLogin'));await service.close();
}
function legacyPrivacyChecks(){
  const diagnostic=diagnosticEntry({level:'INFO',category:'Chat-Filter',message:'CHAT_TEXT',meta:{message:'CHAT_TEXT',username:'TARGET_NAME',rawData:{message:'CHAT_TEXT'},action:{type:'chat',text:'CHAT_TEXT',args:{message:'CHAT_TEXT'}},authorization:'SECRET',reason:'REASON',code:'FILTER'}});
  assert(!JSON.stringify(diagnostic).includes('CHAT_TEXT'));assert(!JSON.stringify(diagnostic).includes('TARGET_NAME'));assert(!JSON.stringify(diagnostic).includes('SECRET'));assert.equal(diagnostic.context.code,'FILTER');
  const cfg={moderation:{state:{},history:[]},community:{archive:{enabled:false,moderationEnabled:false,excerptsEnabled:false}},multiChat:{maxMessages:50},filters:{enabled:false}};
  const core=new ChatCore(cfg);core.ingest({platform:'local',username:'Person',message:'Nicht speichern'});core.moderate({platform:'local',username:'Person',action:'mute',reason:'Lokaler Filter',resultMode:'local'});assert.equal(core.history.length,0);assert.equal(core.config.moderation.history.length,0);assert(!JSON.stringify(core.config).includes('Nicht speichern'));
  const preserved=normalizeMessage({id:'m',platform:'twitch',channelId:'20',userId:'10',username:'person',message:'test',identityVerified:true,moderatorConfirmedAt:'2026-09-15T00:00:00Z',isBroadcaster:true});assert.equal(preserved.identityVerified,true);assert.equal(preserved.moderatorConfirmedAt,'2026-09-15T00:00:00Z');assert.equal(preserved.isBroadcaster,true);
}
(async()=>{try{await archiveChecks();await moderationChecks();await viewerChecks();await channelChecks();legacyPrivacyChecks();console.log('Community regression: archive persistence/privacy/Unicode/search/export/errors, moderation identity/permission/idempotency/unknown reconciliation/channel-bound roles, viewers zero/offline/stale, diagnostic and legacy privacy: OK');}finally{const resolved=path.resolve(taskDir);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('batto-community-'))throw new Error('Unsafe test cleanup path');fs.rmSync(resolved,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
