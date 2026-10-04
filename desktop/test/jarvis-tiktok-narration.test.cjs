'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {withTikTokSelfNarration}=require('../src/services/chat-narration.cjs');
const {normalizeTikFinityPacket}=require('../src/adapters/tikfinity.cjs');
const {normalizeChat}=require('../src/core/events/normalizer.cjs');
const {ChatCore,normalizeMessage}=require('../src/core/chat-core.cjs');
const {chatForJarvis}=require('../src/services/suite-host.cjs');
const {JarvisCore,cleanSettings,allowedChat}=require('../src/services/jarvis-core.cjs');
const {BroadcastEchoTracker}=require('../src/core/broadcast/echo-tracker.cjs');
const settings=cleanSettings({chatMode:'moderators',chatSource:'connected',chatPlatforms:['tiktok']});
const packet=(extra={})=>({event:'chat',data:{msgId:'provider-message',userId:'123456789',uniqueId:'owner_handle',nickname:'Owner display name',comment:'Meine Nachricht',...extra}});
const mark=(input,source='tikfinity',senderUsername='owner_handle')=>withTikTokSelfNarration(normalizeTikFinityPacket(input).value,{source,senderUsername});
const through=(message,source='tikfinity')=>chatForJarvis(normalizeMessage(normalizeChat(message,source)));

test('TikFinity canonical handles with stable IDs identify own narration without granting platform roles',()=>{
 const input=normalizeTikFinityPacket(packet()).value,own=withTikTokSelfNarration(input,{source:'tikfinity',senderUsername:' @OWNER_HANDLE '});
 assert.equal(own.raw.narration.canonicalLogin,'owner_handle');assert.equal(own.raw.narration.senderLogin,'owner_handle');assert.equal(own.raw.narration.userId,input.userId);
 assert.equal(own.userId,input.userId);assert.equal(own.username,input.username);assert.equal(own.identityVerified,input.identityVerified);assert.equal(own.moderator,false);assert.equal(own.isBroadcaster,false);
 assert.equal(input.raw.narration,undefined,'provider packet stays unchanged');
 const message=through(own);assert.equal(message.narrationRole,'self');assert.equal(allowedChat(message,settings),true);assert.equal(message.moderator,false);assert.equal(message.isBroadcaster,false);
});

test('explicit uniqueId aliases in the provider-selected nested or flat user survive the narration path',()=>{
 for(const key of ['user','userData','author']){
  const nested={event:'comment',data:{msgId:'nested-'+key,comment:'Hallo',[key]:{id:'123456789',unique_id:'OWNER_HANDLE',nickname:'Independent display'}}};
  assert.equal(through(mark(nested)).narrationRole,'self',key);
 }
 assert.equal(through(mark(packet({uniqueId:undefined,unique_id:'owner_handle'}))).narrationRole,'self');
 const encoded=packet();encoded.data=JSON.stringify(encoded.data);assert.equal(through(mark(encoded)).narrationRole,'self');
});

test('display names, username/login fallback and another canonical handle do not establish self narration',()=>{
 const variants=[
  {uniqueId:'viewer_handle',nickname:'owner_handle'},
  {uniqueId:undefined,username:'owner_handle',nickname:'owner_handle'},
  {uniqueId:undefined,user:{id:'123456789',name:'owner_handle'}},
  {uniqueId:undefined,user:{id:'123456789',login:'owner_handle'}},
  {uniqueId:'@owner_handle'},
  {uniqueId:'owner_handle with spaces'},
  {uniqueId:'x'.repeat(25)}
 ];
 for(const extra of variants){const own=mark(packet(extra));assert.equal(own.raw.narration,undefined);assert.equal(allowedChat(through(own),settings),false);}
 const inconsistent=normalizeTikFinityPacket(packet({user:{id:'123456789',username:'different_user'}})).value;
 assert.equal(withTikTokSelfNarration(inconsistent,{source:'tikfinity',senderUsername:'owner_handle'}).raw.narration,undefined);
});

test('missing, unsafe, malformed or mismatched stable IDs are rejected',()=>{
 for(const userId of [undefined,'not-an-id',true,{id:'123456789'},'1'.repeat(31),Number.MAX_SAFE_INTEGER+1]){
  assert.equal(mark(packet({userId})).raw.narration,undefined,String(userId));
 }
 const input=normalizeTikFinityPacket(packet()).value;
 for(const modified of [{...input,userId:'987654321'},{...input,identityVerified:false},{...input,username:'viewer_handle'}])assert.equal(withTikTokSelfNarration(modified,{source:'tikfinity',senderUsername:'owner_handle'}).raw.narration,undefined);
 assert.equal(through(mark(packet({userId:123456789}))).narrationRole,'self','safe numeric IDs match the adapter representation');
});

test('the host strips provider-supplied narration even when it cannot create its own evidence',()=>{
 const input=normalizeTikFinityPacket(packet({uniqueId:'viewer_handle'})).value;input.raw.narration={transport:'tikfinity',role:'self',method:'sender-login',canonicalLogin:'viewer_handle',senderLogin:'viewer_handle',messageId:input.id,userId:input.userId};
 const clean=withTikTokSelfNarration(input,{source:'tikfinity',senderUsername:'owner_handle'});assert.equal(clean.raw.narration,undefined);assert.equal(input.raw.narration.role,'self');assert.equal(allowedChat(through(clean),settings),false);
 for(const source of ['mock','fake-connector','streamerbot-chat','twitch-popout'])assert.equal(withTikTokSelfNarration(input,{source,senderUsername:'viewer_handle'}).raw.narration,undefined,source);
 assert.equal(withTikTokSelfNarration(null),null);
});

test('a missing provider message ID is assigned once before normalization for reliable narration deduplication',t=>{
 const own=mark(packet({msgId:undefined}));assert.match(own.id,/^[a-f0-9-]{36}$/);assert.equal(own.raw.narration.messageId,own.id);
 const normalized=normalizeChat(own,'tikfinity');assert.equal(normalized.eventId,'tiktok:chat:'+own.id);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-tiktok-narration-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const spoken=[],core=new JarvisCore({directory,speak:text=>spoken.push(text)});core.update({chatMode:'moderators',chatSource:'connected',chatPlatforms:['tiktok']});core.execute=()=>assert.fail('Narration never executes chat commands');
 const message=chatForJarvis(normalizeMessage(normalized));core.onChat([message]);core.onChat([message]);assert.deepEqual(spoken,['owner_handle sagt: Meine Nachricht']);assert.equal(core.chatPending.length,0);
});

test('narration evidence remains bound to the real message, sender and connector',()=>{
 const normalized=normalizeChat(mark(packet()),'tikfinity');
 for(const mutate of [e=>{e.eventId='tiktok:chat:other';},e=>{e.user.id='987654321';},e=>{e.user.username='viewer_handle';},e=>{e.meta.sourceConnector='twitch-popout';},e=>{e.meta.rawData.narration.senderLogin='viewer_handle';}]){
  const changed=structuredClone(normalized);mutate(changed);assert.equal(normalizeMessage(changed).narrationRole,'');
 }
});

test('the resolved manual or broadcast source is preserved and existing broadcast visibility still applies',async()=>{
 const tracker=new BroadcastEchoTracker();let delivered;
 await tracker.ingest(normalizeTikFinityPacket(packet()).value,'manual',(input,source)=>{delivered={source,message:withTikTokSelfNarration(input,{source,senderUsername:'owner_handle'})};});
 assert.equal(delivered.source,'manual');assert.equal(through(delivered.message,delivered.source).narrationRole,'self');
 const source='broadcast-run:fixture',normalized=normalizeChat(mark(packet(),source),source);assert.equal(normalized.meta.sourceConnector,source);
 const chat=new ChatCore({multiChat:{maxMessages:50},autoBroadcast:{showInMultiChat:false},moderation:{state:{}}});const received=chat.ingest(normalized);
 assert.equal(received.narrationRole,'self');assert.equal(chat.isMultiChatVisible(received),false);assert.deepEqual(chat.getMultiChatMessages(),[]);
 assert.equal(allowedChat({...chatForJarvis(received),windowVisible:false},cleanSettings({chatPlatforms:['tiktok'],chatSource:'window'})),false);
});

test('the actual host callback marks only TikFinity messages after the echo tracker resolves their source',async()=>{
 const vm=require('node:vm'),{createRequire}=require('node:module'),file=path.join(__dirname,'../electron/main21.cjs'),source=fs.readFileSync(file,'utf8'),start=source.indexOf('  const callbacks = (name) => ({'),end=source.indexOf('\n  adapters = {',start);
 assert(start>=0&&end>start);
 const received=[],seen=[],scope={module:{exports:{}},require:createRequire(file),currentConfig:()=>({platforms:{tikfinity:{senderUsername:'owner_handle'}}}),connectorManager:{markEvent:name=>seen.push(name)},tiktokWriter:{sourceFor:()=> 'manual'},broadcastEchoes:{ingest:async(input,_source,deliver)=>deliver(input,'broadcast-run:resolved')},eventCore:{ingestChat:(message,connector)=>received.push({message,connector})},bridgeLog:()=>assert.fail('No chat ingestion failure expected')};
 vm.runInNewContext(source.slice(start,end)+'\nmodule.exports=callbacks;',scope,{filename:file});
 const input=normalizeTikFinityPacket(packet({msgId:undefined})).value;scope.module.exports('tikfinity').onMessage(input);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(received[0].connector,'broadcast-run:resolved');assert.equal(received[0].message.raw.narration.messageId,received[0].message.id);assert.equal(through(received[0].message,received[0].connector).narrationRole,'self');assert.equal(input.id,undefined);
 scope.module.exports('youtube').onMessage(input);await new Promise(resolve=>setImmediate(resolve));assert.equal(received[1].message,input);assert.equal(received[1].message.raw.narration,undefined);assert.deepEqual(seen,['tikfinity','youtube']);
});
