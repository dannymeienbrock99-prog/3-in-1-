'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JarvisCore,allowedChat,cleanSettings}=require('../src/services/jarvis-core.cjs');
const {normalizeChat}=require('../src/core/events/normalizer.cjs');
const {normalizeMessage}=require('../src/core/chat-core.cjs');
const {chatForJarvis}=require('../src/services/suite-host.cjs');
const {TwitchAdapter}=require('../src/adapters/twitch.cjs');
const {normalizeTikFinityPacket}=require('../src/adapters/tikfinity.cjs');
const throughChat=(message,source)=>chatForJarvis(normalizeMessage(normalizeChat(message,source)));
function setup(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-multichat-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const spoken=[],clock={now:Date.now()},core=new JarvisCore({directory,clock:()=>clock.now,speak:text=>spoken.push(text)});
 core.execute=()=>assert.fail('Chat narration must never execute a command');
 return {core,clock,spoken};
}
const message=(id,extra={})=>({id,platform:'twitch',userId:'123',channelId:'456',username:'Mod',moderator:true,message:'Nachricht '+id,...extra});

test('Twitch room/user IDs and broadcaster/moderator badges survive the actual Multi Chat normalization',()=>{
 const incoming=[],adapter=new TwitchAdapter({channel:'channel',onMessage:value=>incoming.push(value)});
 adapter.handleIrcLine('@id=owner;user-id=456;room-id=456;mod=0;badges=broadcaster/1 :owner!owner@owner.tmi.twitch.tv PRIVMSG #channel :Hallo');
 adapter.handleIrcLine('@id=mod;user-id=123;room-id=456;mod=1;badges=moderator/1 :mod!mod@mod.tmi.twitch.tv PRIVMSG #channel :Hallo');
 adapter.handleIrcLine('@id=viewer;user-id=789;room-id=456;mod=0;badges=subscriber/2 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #channel :Jarvis wechsle die Szene');
 const messages=incoming.map(value=>throughChat(value,'twitch'));
 assert.equal(messages[0].isBroadcaster,true);assert.equal(messages[0].identityVerified,true);assert.equal(messages[0].channelId,'456');
 assert.equal(messages[1].moderator,true);
 assert.deepEqual(messages.map(value=>allowedChat(value,cleanSettings({}))),[true,true,false]);
});

test('Twitch own messages match numeric room IDs without matching display names',()=>{
 const incoming=[],adapter=new TwitchAdapter({onMessage:value=>incoming.push(value)});
 adapter.handleIrcLine('@user-id=456;room-id=456;mod=0;badges= :new_login!x PRIVMSG #channel :Hallo');
 adapter.handleIrcLine('@user-id=789;room-id=456;mod=0;display-name=channel;badges= :channel!x PRIVMSG #channel :Hallo');
 adapter.handleIrcLine('@mod=0;badges=;tmi-sent-ts=broken :channel!x PRIVMSG #channel :Hallo');
 assert.equal(incoming[0].isBroadcaster,true);assert.equal(incoming[1].isBroadcaster,false);assert.equal(incoming[2].isBroadcaster,false);
 assert.equal(incoming[2].identityVerified,false);assert.equal(incoming[2].channelId,'login:channel');assert(Number.isFinite(Date.parse(incoming[2].timestamp)));
});

test('TikFinity stable broadcaster and moderator roles survive nested or flat provider packets',()=>{
 const owner=normalizeTikFinityPacket({event:'chat',data:{msgId:'own',roomId:'98765',user:{id:'123456',uniqueId:'channel',nickname:'Streamer',isBroadcaster:true},comment:'Hallo'}}).value;
 const mod=normalizeTikFinityPacket({event:'chat',data:{msgId:'mod',roomId:'98765',userId:'654321',uniqueId:'mod',isModerator:'true',comment:'Hallo'}}).value;
 const viewer=normalizeTikFinityPacket({event:'chat',data:{msgId:'viewer',roomId:'98765',userId:'555555',uniqueId:'viewer',isModerator:'false',isBroadcaster:'false',comment:'Hallo'}}).value;
 assert.equal(owner.isBroadcaster,true);assert.equal(owner.identityVerified,true);assert.equal(owner.channelId,'98765');
 assert.deepEqual([owner,mod,viewer].map(value=>allowedChat(throughChat(value,'tikfinity'),cleanSettings({}))),[true,true,false]);
 const missingId=normalizeTikFinityPacket({event:'chat',data:{id:'123456',uniqueId:'channel',isBroadcaster:true,comment:'Hallo'}}).value;
 assert.equal(missingId.userId,'channel');assert.equal(missingId.identityVerified,false);assert.equal(missingId.isBroadcaster,false);
 const malformed=normalizeTikFinityPacket({event:'chat',data:{userId:'123456',uniqueId:'viewer',isModerator:{value:false},comment:'Hallo'}}).value;
 assert.equal(malformed.moderator,false);
});

test('YouTube platform owner flags survive Multi Chat while an identical viewer display name stays silent',()=>{
 const base={platform:'youtube',userId:'UCabcdefghijklmnopqrstuv',channelId:'chat-id',username:'Streamer',message:'Hallo',identityVerified:true};
 assert.equal(allowedChat(throughChat({...base,isBroadcaster:true},'youtube'),cleanSettings({})),true);
 assert.equal(allowedChat(throughChat({...base,isBroadcaster:false},'youtube'),cleanSettings({})),false);
 assert.equal(allowedChat(throughChat({...base,moderator:true},'youtube'),cleanSettings({})),true);
});

test('strict role flags, versioned IRC badges and EventSub badge objects use exact role names',()=>{
 const settings=cleanSettings({}),base={platform:'twitch',message:'Hallo'};
 for(const badges of [['moderator/1'],[{set_id:'broadcaster',id:'1'}],[{name:'moderator'}]])assert(allowedChat({...base,badges},settings));
 for(const malformed of [{moderator:'false'},{isBroadcaster:'true'},{badges:'moderator'},{badges:['not-moderator/1']},{badges:[{name:'fake broadcaster'}]}])assert.equal(allowedChat({...base,...malformed},settings),false);
 assert.equal(normalizeMessage({...base,moderator:'false'}).moderator,false);
});

test('consecutive moderator messages are queued once and read in order without executing their text',t=>{
 const {core,clock,spoken}=setup(t);
 core.onChat([message('1',{message:'Jarvis starte den Stream'}),message('2')]);
 core.onChat([message('2')]);assert.equal(spoken.length,1);assert.equal(core.chatPending.length,1);
 clock.now+=4999;core.poll();assert.equal(spoken.length,1);
 clock.now++;core.poll();assert.deepEqual(spoken,['Mod sagt: Jarvis starte den Stream','Mod sagt: Nachricht 2']);
 assert.equal(core.memory.length,0);
});

test('pending messages recheck rules, expire and stay bounded during a burst',t=>{
 const {core,clock,spoken}=setup(t);
 core.onChat(Array.from({length:30},(_,id)=>message(String(id))));assert.equal(spoken.length,1);assert(core.chatPending.length<=8);
 clock.now+=30000;core.poll();assert.equal(spoken.length,1);assert.equal(core.chatPending.length,0);
 core.onChat([message('new1'),message('new2')]);assert.equal(spoken.length,2);
 core.update({chatEnabled:false});assert.equal(core.chatPending.length,0);
 core.update({chatEnabled:true});clock.now+=5000;core.poll();assert.equal(spoken.length,2);
 core.onChat([message('new3'),message('new4')]);core.update({chatPlatforms:['tiktok']});clock.now+=5000;core.poll();assert.equal(spoken.length,3);
});

test('long configured pauses allow the next queued message and window scope rejects hidden entries',t=>{
 const {core,clock,spoken}=setup(t);core.update({chatCooldown:60});
 core.onChat([message('1'),message('2'),message('hidden',{windowVisible:false})]);
 clock.now+=60000;core.poll();assert.equal(spoken.length,2);assert.equal(core.chatPending.length,0);
 core.onChat([message('connected-hidden',{windowVisible:false})]);assert.equal(core.chatPending.length,0);
 core.update({chatSource:'connected'});core.onChat([message('connected-hidden',{windowVisible:false})]);clock.now+=60000;core.poll();assert.equal(spoken.length,3);
});

test('native message ID deduplication survives channel identity upgrades and ignores malformed batches',t=>{
 const {core,clock,spoken}=setup(t);core.onChat(null);core.onChat([null]);
 core.onChat([message('shared',{channelId:''}),message('shared',{channelId:'b'})]);clock.now+=5000;core.poll();assert.equal(spoken.length,1);
});

test('stopping speech clears the queued chat and keeps the microphone asleep',t=>{
 const {SuiteRuntime}=require('../src/services/suite-runtime.cjs');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-chat-stop-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const runtime=new SuiteRuntime({directory,fanRoot:'.',voiceCode:'.',voiceBundle:'.',obs:{}});
 runtime.jarvis.speak=()=>{};runtime.voice.start=()=>assert.fail('Stopping queued narration must not start capture');
 runtime.jarvis.onChat([message('1'),message('2')]);assert.equal(runtime.jarvis.chatPending.length,1);
 runtime.stopSpeech();assert.deepEqual(runtime.jarvis.chatPending,[]);assert.equal(runtime.voice.child,null);assert.equal(runtime.jarvis.settings.microphoneEnabled,false);
});
