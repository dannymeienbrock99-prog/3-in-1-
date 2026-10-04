'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const WS=require('ws');
const {StreamerBotAdapter,eventSubscriptions,normalizeStreamerBotChat,hash}=require('../src/adapters/streamerbot.cjs');
const {EventCore}=require('../src/core/events/event-core.cjs');
const {allowedChat,cleanSettings}=require('../src/services/jarvis-core.cjs');
const {normalizeMessage}=require('../src/core/chat-core.cjs');
const {ChatCore,identityPatch}=require('../src/core/chat-core.cjs');
const {ingestStreamerBotChat}=require('../src/services/streamerbot-chat.cjs');
const {chatForJarvis}=require('../src/services/suite-host.cjs');
const {JarvisCore}=require('../src/services/jarvis-core.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
function fixture(t,options={}){
 class Socket extends EventEmitter{
  static instances=[];
  constructor(){super();this.readyState=WS.OPEN;this.sent=[];Socket.instances.push(this);}
  send(json,callback){
   const request=JSON.parse(json);this.sent.push(request);this.emit('sent',request);
   if(this.throwSend)throw Error('fixture send failure');
   if(this.errorSend){callback?.(Error('fixture asynchronous send failure'));return;}
   callback?.();if(this.pauseRequests?.includes(request.request))return;
   const response={id:request.id,status:'ok'};
   if(request.request==='GetEvents')response.events=options.events??{twitch:['ChatMessage','Follow','Cheer'],youTube:['Message'],raw:['ActionCompleted']};
   if(request.request==='GetActions')response.actions=options.actions??[{id:'a',name:'Fixture action',enabled:true}];
   queueMicrotask(()=>this.packet(response));
  }
  packet(value){this.emit('message',Buffer.from(JSON.stringify(value)));}
  close(){this.readyState=WS.CLOSED;this.emit('close',1000,'fixture closed');}
  terminate(){this.close();}
 }
 const chats=[],events=[],statuses=[];
 const adapter=new StreamerBotAdapter({getConfig:()=>({url:'ws://127.0.0.1:65530/'}),getPassword:options.getPassword||(()=> 'fixture-password'),onChat:message=>chats.push(message),onEvent:event=>events.push(event),onStatus:status=>statuses.push(status),WebSocketImpl:Socket});
 t.after(()=>adapter.disconnect());
 const hello=auth=>({request:'Hello',info:{source:'websocketServer',version:'fixture'},...(auth?{authentication:{salt:'salt',challenge:'challenge'}}:{})});
 const connect=async auth=>{const pending=adapter.connect(),socket=Socket.instances.at(-1);socket.packet(hello(auth));await pending;return socket;};
 return {adapter,Socket,chats,events,statuses,hello,connect};
}
const sent=(socket,name)=>new Promise(resolve=>{const listen=request=>{if(request.request===name){socket.off('sent',listen);resolve(request);}};socket.on('sent',listen);});
const twitch=(extra={})=>({event:{source:'Twitch',type:'ChatMessage'},timeStamp:'2026-10-04T17:00:00Z',data:{user:{id:'123',login:'mod',name:'Mod',badges:[{name:'moderator',version:'1'}]},broadcaster:{id:'456'},messageId:'native-message',text:'Hallo',...extra}});

test('advertised chat events subscribe with server category names and optional authentication succeeds',async t=>{
 const f=fixture(t),socket=await f.connect(true);
 assert.equal(f.adapter.status().connected,true);
 assert.equal(socket.sent.find(request=>request.request==='Authenticate').authentication,hash(hash('fixture-passwordsalt')+'challenge'));
 assert.deepEqual(socket.sent.find(request=>request.request==='Subscribe').events,{twitch:['ChatMessage','Follow','Cheer'],youTube:['Message'],raw:['ActionCompleted']});
 assert.equal(f.adapter.actions[0].enabled,true);
});

test('malformed event catalogs or action arrays fail clearly and clear pending requests',async t=>{
 assert.throws(()=>eventSubscriptions({Twitch:'ChatMessage'}),/Ereignisliste/);assert.throws(()=>eventSubscriptions([]),/Ereignisliste/);
 for(const options of [{events:{Twitch:[{}]}},{actions:[null]},{actions:{a:{id:'a'}}}]){
  const f=fixture(t,options);await assert.rejects(f.connect(),/Ereignisliste|Aktionsliste/);assert.equal(f.adapter.requests.size,0);assert.equal(f.adapter.state.connected,false);
 }
});

test('manual disconnect immediately rejects connection and outstanding request/completion waits',async t=>{
 const f=fixture(t),initial=f.adapter.connect(),socket=f.Socket.instances.at(-1),cancelled=assert.rejects(initial,/getrennt/);
 f.adapter.disconnect();await cancelled;assert.equal(f.adapter.connecting,null);
 const live=await f.connect();live.pauseRequests=['Pending'];const pending=f.adapter.request('Pending',{},30000),pendingRejected=assert.rejects(pending,/getrennt/);
 f.adapter.disconnect();await pendingRejected;assert.equal(f.adapter.requests.size,0);
 const active=await f.connect(),doAction=sent(active,'DoAction'),run=f.adapter.execute('a',{},undefined,30000,{waitForCompletion:true}),runRejected=assert.rejects(run,/getrennt/);
 await doAction;f.adapter.disconnect();await runRejected;assert.equal(f.adapter.executions.size,0);assert.equal(f.adapter.requests.size,0);
 socket.packet(f.hello());assert.equal(f.adapter.state.connected,false);
});

test('synchronous and asynchronous socket send failures immediately remove their waiters',async t=>{
 const f=fixture(t),socket=await f.connect();
 socket.throwSend=true;await assert.rejects(f.adapter.request('Pending',{},30000),/gesendet/);assert.equal(f.adapter.requests.size,0);
 socket.throwSend=false;socket.errorSend=true;await assert.rejects(f.adapter.request('Pending',{},30000),/gesendet/);assert.equal(f.adapter.requests.size,0);
});

test('a disconnected Hello awaiting a password cannot authenticate or mutate the next socket',async t=>{
 let resolvePassword,calls=0;const firstPassword=new Promise(resolve=>{resolvePassword=resolve;});
 const f=fixture(t,{getPassword:()=>++calls===1?firstPassword:'fixture-password'}),old=f.adapter.connect(),oldRejected=assert.rejects(old,/getrennt/),oldSocket=f.Socket.instances.at(-1);
 oldSocket.packet(f.hello(true));f.adapter.disconnect();await oldRejected;
 const current=await f.connect(true);resolvePassword('old-password');await Promise.resolve();await Promise.resolve();
 oldSocket.packet({event:{source:'Twitch',type:'Follow'},data:{id:'old'}});oldSocket.emit('error',Error('old error'));
 assert.equal(current.sent.filter(request=>request.request==='Authenticate').length,1);assert.equal(f.adapter.state.connected,true);assert.equal(f.events.length,0);
});

test('old socket responses cannot settle requests belonging to the next connection',async t=>{
 const f=fixture(t),old=await f.connect();f.adapter.disconnect();const current=await f.connect();current.pauseRequests=['Pending'];
 const pending=f.adapter.request('Pending'),request=current.sent.at(-1);
 old.packet({id:request.id,status:'ok',wrong:true});assert(f.adapter.requests.has(request.id));
 current.packet({id:request.id,status:'ok',right:true});assert.equal((await pending).right,true);
});

test('Streamer.bot Twitch/YouTube roles require stable IDs, strict flags and exact badges',()=>{
 const mod=normalizeStreamerBotChat(twitch());assert.equal(mod.moderator,true);assert.equal(mod.userId,'123');assert.equal(mod.channelId,'456');assert.equal(mod.id,'native-message');
 const owner=normalizeStreamerBotChat(twitch({user:{id:'456',login:'new_login',name:'Changed name'}}));assert.equal(owner.isBroadcaster,true);
 const fake=normalizeStreamerBotChat(twitch({user:{id:'display_name',login:'mod',isModerator:'true',badges:[{name:'moderator'}]}}));assert.equal(fake.moderator,false);assert.equal(fake.identityVerified,false);assert.equal(allowedChat(normalizeMessage(fake),cleanSettings({})),false);
 const viewer=normalizeStreamerBotChat(twitch({user:{id:'789',name:'Changed name',isBroadcaster:'true',isModerator:'false'}}));assert.equal(viewer.isBroadcaster,false);assert.equal(viewer.moderator,false);
 const guest=normalizeStreamerBotChat(twitch({isFromSharedChatGuest:true,user:{id:'789',login:'guest',badges:[{name:'broadcaster'}]}}));assert.equal(guest.isBroadcaster,false);assert.equal(allowedChat(normalizeMessage(guest),cleanSettings({})),false);
 const youtube=normalizeStreamerBotChat({event:{source:'YouTube',type:'Message'},data:{user:{id:'UCabcdefghijklmnopqrstuv',name:'Owner',isOwner:true},broadcast:{liveChatId:'chat-id',channelId:'UCabcdefghijklmnopqrstuv'},eventId:'youtube-id',message:'Hallo'}});
 assert.equal(youtube.isBroadcaster,true);assert.equal(youtube.channelId,'chat-id');assert.equal(youtube.id,'youtube-id');assert.equal(allowedChat(normalizeMessage(youtube),cleanSettings({})),true);
 assert.equal(normalizeStreamerBotChat(twitch({isTest:true})),null);assert.equal(normalizeStreamerBotChat(twitch({meta:{internal:true}})),null);
});

test('chat callbacks keep narration separate from support events and direct-feed message IDs deduplicate',async t=>{
 const f=fixture(t),socket=await f.connect();socket.packet(null);socket.packet([]);socket.packet(twitch());
 socket.packet({event:{source:'Twitch',type:'Follow'},data:{id:'follow'}});
 assert.equal(f.chats.length,1);assert.equal(f.events.length,1);assert.equal(f.events[0].event.type,'Follow');
 const core=new EventCore();t.after(()=>core.stop());
 assert.equal(core.ingestChat({platform:'twitch',id:'native-message',userId:'123',username:'mod',channelId:'456',message:'Hallo',moderator:true},'twitch').ok,true);
 assert.equal(core.ingestChat(f.chats[0],'streamerbot-chat').duplicate,true);
});

test('Popout-first, queued Popout-first and Bot-first messages upgrade identity with one row/event/narration',async t=>{
 for(const order of ['popout-first','queued-popout-first','bot-first','already-read-popout-first']){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-sb-chat-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const core=new EventCore(),chat=new ChatCore({filters:{enabled:false},multiChat:{},moderation:{state:{}}}),said=[],events=[];
  t.after(()=>core.stop());const jarvis=new JarvisCore({directory,speak:message=>said.push(message)});
  jarvis.execute=()=>assert.fail('Enrichment must never execute chat content');
  chat.on('message',message=>jarvis.onChat([chatForJarvis(message)]));chat.on('identity',message=>jarvis.onChat([chatForJarvis(message)]));
  core.on('event',event=>{events.push(event);chat.ingest(event);});
  const direct={platform:'twitch',id:'native-message',userId:'Mod',username:'Mod',message:'Jarvis starte den Stream',moderator:order==='already-read-popout-first',isBroadcaster:false};
  const bot=normalizeStreamerBotChat(twitch({text:direct.message}));
  if(order==='bot-first')ingestStreamerBotChat(core,chat,bot);else core.ingestChat(direct,'twitch-popout');
  if(order!=='queued-popout-first')await new Promise(resolve=>setImmediate(resolve));
  if(order==='bot-first')core.ingestChat(direct,'twitch-popout');else ingestStreamerBotChat(core,chat,bot);
  await new Promise(resolve=>setImmediate(resolve));ingestStreamerBotChat(core,chat,bot);
  assert.equal(events.length,1,order);assert.equal(chat.messages.length,1,order);assert.equal(chat.messages[0].userId,'123',order);assert.equal(chat.messages[0].moderator,true,order);assert.equal(said.length,1,order);assert.equal(jarvis.memory.length,0,order);
 }
});

test('identity upgrades require matching stable message identity and cannot resurrect a filtered row',async t=>{
 const config={filters:{enabled:true,rules:[{term:'hidden',action:'hide'}]},multiChat:{},moderation:{state:{}}},chat=new ChatCore(config),core=new EventCore();t.after(()=>core.stop());
 core.on('event',event=>chat.ingest(event));
 const direct={platform:'twitch',id:'native-message',username:'Mod',message:'hidden'};
 core.ingestChat(direct,'twitch-popout');await new Promise(resolve=>setImmediate(resolve));
 ingestStreamerBotChat(core,chat,normalizeStreamerBotChat(twitch({text:'hidden'})));assert.equal(chat.messages.length,0);
 const existing=normalizeMessage({...direct,identityVerified:true,userId:'123',channelId:'456'});
 for(const change of [{id:'different-message'},{platform:'youtube'},{message:'different text'},{userId:'789'},{channelId:'999'},{identityVerified:false}])assert.equal(identityPatch(existing,normalizeMessage({...existing,...change})),null);
});
