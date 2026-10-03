'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JarvisModeration}=require('../src/services/jarvis-moderation.cjs');
const {ModerationService}=require('../src/core/community/moderation-service.cjs');
const {ChatCore}=require('../src/core/chat-core.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const channel='20',person='10',youtubeId='UCabcdefghijklmnopqrstuv';
function fixture(){
 let now=1000000;
 const messages=[{platform:'twitch',channelId:channel,userId:person,username:'some_user',displayName:'Alex',identityVerified:true}];
 const states={twitch:{connected:true,channelId:channel,channelLogin:'owner',identity:{id:channel},actions:{block:true,unblock:true,mute:true},blocked:[],muted:[]},youtube:{connected:true,channelId:'live-chat',identity:{id:'owner'},actions:{block:true,unblock:true,mute:true},blocked:[],muted:[]}};
 const performed=[],resolutions=[];
 const config={moderation:{state:{},history:[]},community:{archive:{moderationEnabled:false}},multiChat:{maxMessages:50},filters:{enabled:true,rules:[],whitelistUsers:[],whitelistTerms:[]}};
 const chat=new ChatCore(config);
 const host={chatMessages:()=>messages,moderationState:()=>states,
  moderationPerform:async payload=>{performed.push(payload);return {ok:true,entry:{...payload,result:'confirmed'}};},
  moderationResolve:async payload=>{resolutions.push(payload);return {ok:true,platform:'twitch',channelId:channel,userId:person,username:'some_user',displayName:'Alex',identityVerified:true};},
  filters:()=>config.filters,filterAdd:payload=>chat.addFilter(payload),filterRemove:id=>chat.removeFilter(id)};
 const service=new JarvisModeration({getHost:()=>host,clock:()=>now});
 return {service,host,messages,states,performed,resolutions,chat,config,advance:ms=>now+=ms};
}
const ban=(userName='Alex',platform=null)=>({kind:'moderation',operation:'ban',userName,platform});
function coreFixture(t){
 const f=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-jarvis-moderation-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 f.jarvis=new JarvisCore({directory,moderation:f.service,clock:f.service.clock,getCommandCatalog:()=>({actions:[]})});
 f.jarvis.settings.voiceEnabled=false;return f;
}

test('preparation is read-only; confirmed execution keeps the captured stable identity and runs once',async()=>{
 const f=fixture(),r=await f.service.prepareModeration(ban());
 assert.equal(r.ok,true);assert.match(r.description,/Alex.*Twitch.*sperren/);assert.deepEqual(f.performed,[]);
 // A display name changing in chat cannot redirect the already prepared action.
 f.messages[0].userId='99';f.messages[0].displayName='Someone else';
 const done=await f.service.executePrepared(r.prepared);
 assert.equal(done.ok,true);assert.match(done.text,/Alex.*gesperrt/);
 assert.equal(f.performed[0].userId,person);assert.equal(f.performed[0].channelId,channel);
 assert.equal((await f.service.executePrepared(r.prepared)).ok,false);assert.equal(f.performed.length,1);
});
test('expired, forged and tampered confirmations never send platform actions',async()=>{
 const f=fixture(),r=await f.service.prepareModeration(ban());f.advance(45001);
 assert.equal((await f.service.executePrepared(r.prepared)).ok,false);
 assert.equal((await f.service.executePrepared({...r.prepared,id:'not-created'})).ok,false);
 const next=await f.service.prepareModeration(ban());
 assert.equal((await f.service.executePrepared({...next.prepared,userId:'another'})).ok,false);
 assert.equal((await f.service.executePrepared(next.prepared)).ok,false);
 assert.equal(f.performed.length,0);
});
test('platform and permission changes invalidate a prepared action',async()=>{
 const f=fixture();let r=await f.service.prepareModeration(ban());
 f.states.twitch.actions.block=false;
 assert.equal((await f.service.executePrepared(r.prepared)).ok,false);
 f.states.twitch.actions.block=true;r=await f.service.prepareModeration(ban());f.states.twitch.channelId='different';
 assert.equal((await f.service.executePrepared(r.prepared)).ok,false);assert.equal(f.performed.length,0);
});
test('same display name on two platforms requires clarification; explicit platform resolves it',async()=>{
 const f=fixture();f.messages.push({platform:'youtube',channelId:'live-chat',userId:youtubeId,username:'Alex',displayName:'Alex',identityVerified:true});
 let r=await f.service.prepareModeration(ban());assert.equal(r.ok,false);assert.equal(r.kind,'clarification');
 r=await f.service.prepareModeration(ban('Alex','youtube'));assert.equal(r.ok,true);assert.equal(r.prepared.userId,youtubeId);
 assert.equal(f.performed.length,0);
});
test('same YouTube display name with different channel identities remains ambiguous',async()=>{
 const f=fixture();f.messages.push(...['UCabcdefghijklmnopqrstuv','UCabcdefghijklmnopqrstab'].map(userId=>({platform:'youtube',channelId:'live-chat',userId,username:'Twin',displayName:'Twin',identityVerified:true})));
 const r=await f.service.prepareModeration(ban('Twin','youtube'));assert.equal(r.ok,false);assert.equal(r.kind,'clarification');assert.equal(f.performed.length,0);
});
test('repeated messages from the same user do not create a false ambiguity',async()=>{
 const f=fixture();f.messages.push({...f.messages[0]},{...f.messages[0]});
 assert.equal((await f.service.prepareModeration(ban())).ok,true);
});
test('login-only Twitch chat uses the verified account resolver and original channel',async()=>{
 const f=fixture();Object.assign(f.messages[0],{identityVerified:false,userId:'some_user',channelId:'login:owner'});
 const r=await f.service.prepareModeration(ban());assert.equal(r.ok,true);assert.equal(r.prepared.userId,person);
 assert.deepEqual(f.resolutions,[{platform:'twitch',username:'some_user',channelId:channel}]);assert.equal(f.performed.length,0);
});
test('resolver failures or a mismatching resolved account cannot become a prepared action',async()=>{
 const f=fixture();f.messages[0].identityVerified=false;
 f.host.moderationResolve=async()=>({ok:false,error:'Anmeldung abgelaufen'});
 assert.match((await f.service.prepareModeration(ban())).text,/abgelaufen/);
 f.host.moderationResolve=async()=>({ok:true,platform:'twitch',channelId:channel,userId:'9',username:'unrelated',identityVerified:true});
 assert.equal((await f.service.prepareModeration(ban())).ok,false);assert.equal(f.performed.length,0);
});
test('unknown names, synthetic chat, absent identity and wrong channel are never guessed',async()=>{
 const f=fixture();assert.equal((await f.service.prepareModeration(ban('not_seen'))).ok,false);assert.equal(f.resolutions.length,0);
 f.messages[0].raw={meta:{sourceConnector:'fake-connector'}};assert.equal((await f.service.prepareModeration(ban())).ok,false);delete f.messages[0].raw;
 f.messages[0].channelId='elsewhere';assert.equal((await f.service.prepareModeration(ban())).ok,false);
 assert.equal(f.performed.length,0);
});
test('TikTok clearly reports unavailable moderation without any platform write or lookup',async()=>{
 const f=fixture();const r=await f.service.prepareModeration(ban('Alex','tiktok'));
 assert.equal(r.ok,false);assert.match(r.text,/TikTok.*nicht verfügbar/);assert.equal(f.performed.length,0);assert.equal(f.resolutions.length,0);
});
test('unban can select a stable identity from the confirmed ban list after chat was cleared',async()=>{
 const f=fixture();f.messages.length=0;f.states.twitch.blocked.push({channelId:channel,userId:person,username:'some_user',displayName:'Alex'});
 const r=await f.service.prepareModeration({...ban(),operation:'unban'});assert.equal(r.ok,true);
 assert.equal((await f.service.executePrepared(r.prepared)).ok,true);assert.equal(f.performed[0].action,'unblock');
});
test('timeout validates duration and never changes the requested duration while confirming',async()=>{
 const f=fixture();for(const durationSeconds of [0,-1,1.5,Infinity,1209601])assert.equal((await f.service.prepareModeration({...ban(),operation:'timeout',durationSeconds})).ok,false);
 const r=await f.service.prepareModeration({...ban(),operation:'timeout',durationSeconds:300});assert.equal(r.ok,true);
 assert.equal((await f.service.executePrepared({...r.prepared,durationSeconds:999})).ok,false);assert.equal(f.performed.length,0);
 const next=await f.service.prepareModeration({...ban(),operation:'timeout',durationSeconds:300});
 assert.equal((await f.service.executePrepared(next.prepared)).ok,true);assert.equal(f.performed[0].durationSeconds,300);assert.equal(f.performed[0].action,'mute');
});
test('self moderation and unverified YouTube targets are refused',async()=>{
 const f=fixture();f.messages[0].userId=channel;assert.equal((await f.service.prepareModeration(ban())).ok,false);
 f.messages.length=0;f.messages.push({platform:'youtube',channelId:'live-chat',userId:youtubeId,username:'Alex',identityVerified:false});
 assert.equal((await f.service.prepareModeration(ban())).ok,false);assert.equal(f.performed.length,0);
});
test('only a matching confirmed platform response is announced as success',async()=>{
 for(const response of [{ok:false,error:'Keine Rechte'}, {ok:true,entry:{result:'unknown'}}, {ok:true,entry:{result:'confirmed',platform:'twitch',channelId:channel,userId:'different',action:'block'}}]){
  const f=fixture();f.host.moderationPerform=async p=>{f.performed.push(p);return response;};const r=await f.service.prepareModeration(ban());
  assert.equal((await f.service.executePrepared(r.prepared)).ok,false);assert.equal((await f.service.executePrepared(r.prepared)).ok,false);assert.equal(f.performed.length,1);
 }
});
test('actual ModerationService rechecks revoked adapter authorization before performing the ban',async()=>{
 const f=fixture();let allowed=true,writes=0;
 const adapter={verify:async()=>({channelId:channel,identity:{id:channel},actions:{block:allowed}}),perform:async()=>{writes++;return {};}};
 const real=new ModerationService({adapters:{twitch:adapter}});f.host.moderationPerform=payload=>real.perform(payload);
 const r=await f.service.prepareModeration(ban());allowed=false;
 const done=await f.service.executePrepared(r.prepared);assert.equal(done.ok,false);assert.match(done.text,/Berechtigungen/);assert.equal(writes,0);
});
test('spoken filter terms use the real local chat filter without banning platform users',async()=>{
 const f=fixture(),r=await f.service.filter({kind:'filter',operation:'add-word',word:'spam'});
 assert.equal(r.ok,true);assert.match(r.text,/lokalen Chatfilter/);
 assert.equal(f.chat.ingest({platform:'twitch',username:'person',message:'This is spam'}),null);
 assert(f.chat.ingest({platform:'twitch',username:'person',message:'spammer'}));
 assert.equal(f.config.filters.rules[0].action,'hide');assert.equal(f.performed.length,0);
 const removed=await f.service.filter({operation:'remove-word',word:'SPAM'});assert.equal(removed.ok,true);
 assert(f.chat.ingest({platform:'twitch',username:'person',message:'This is spam'}));
});
test('adding a filter preserves disabled state and reports it; duplicates do not accumulate',async()=>{
 const f=fixture();f.config.filters.enabled=false;
 let r=await f.service.filter({operation:'add-word',word:'SPAM'});assert.equal(r.ok,true);assert.match(r.text,/ausgeschaltet/);
 r=await f.service.filter({operation:'add-word',word:'spam'});assert.equal(r.ok,true);assert.match(r.text,/bereits/);assert.equal(f.config.filters.rules.length,1);assert.equal(f.config.filters.enabled,false);
});
test('ambiguous filter deletion asks for the platform and removes only that selected rule',async()=>{
 const f=fixture();for(const platform of ['twitch','youtube'])await f.service.filter({operation:'add-word',word:'spam',platform});
 let r=await f.service.filter({operation:'remove-word',word:'spam'});assert.equal(r.ok,false);assert.equal(r.kind,'clarification');assert.equal(f.config.filters.rules.length,2);
 r=await f.service.filter({operation:'remove-word',word:'spam',platform:'twitch'});assert.equal(r.ok,true);assert.deepEqual(f.config.filters.rules.map(x=>x.platform),['youtube']);
});
test('invalid filter input and failed persistence are never acknowledged as applied',async()=>{
 const f=fixture();for(const word of ['', 'a'.repeat(121),'two\nlines'])assert.equal((await f.service.filter({operation:'add-word',word})).ok,false);
 assert.equal(f.config.filters.rules.length,0);
 f.host.filterAdd=async()=>({ok:false,error:'Speicherfehler'});assert.match((await f.service.filter({operation:'add-word',word:'spam'})).text,/Speicherfehler/);
});
test('spoken ban goes through Jarvis parsing, asks for confirmation and sends one captured action',async t=>{
 const f=coreFixture(t);let result=await f.jarvis.execute('Jarvis banne Alex auf Twitch',{source:'voice'});
 assert.equal(result.kind,'clarification');assert.match(result.text,/Bestätigen/);assert.equal(f.performed.length,0);
 result=await f.jarvis.execute('Jarvis bestätigen',{source:'voice'});assert.equal(result.ok,true);assert.match(result.text,/Alex.*gesperrt/);assert.equal(f.performed.length,1);
 result=await f.jarvis.execute('Bestätigen');assert.equal(result.ok,false);assert.equal(f.performed.length,1);
});
test('cancel, a different command and an expired confirmation never apply the previous ban',async t=>{
 const f=coreFixture(t);
 for(const following of ['Abbrechen','Hilfe']){
  await f.jarvis.execute('Banne Alex auf Twitch');await f.jarvis.execute(following);
  assert.equal((await f.jarvis.execute('Bestätigen')).ok,false);
 }
 await f.jarvis.execute('Banne Alex auf Twitch');f.advance(45001);
 assert.equal((await f.jarvis.execute('Bestätigen')).ok,false);assert.equal(f.performed.length,0);
});
test('spoken filter changes preserve umlauts and change the existing local filter',async t=>{
 const f=coreFixture(t);let r=await f.jarvis.execute('Jarvis Filterwort böse hinzufügen');
 assert.equal(r.ok,true);assert.equal(f.config.filters.rules[0].term,'böse');
 assert.equal(f.chat.ingest({platform:'twitch',username:'person',message:'Das ist böse'}),null);
 r=await f.jarvis.execute('Filterwort böse entfernen');assert.equal(r.ok,true);assert.equal(f.config.filters.rules.length,0);assert.equal(f.performed.length,0);
});
