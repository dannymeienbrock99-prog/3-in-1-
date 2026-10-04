'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {normalizeChat}=require('../src/core/events/normalizer.cjs');
const {ChatCore,normalizeMessage}=require('../src/core/chat-core.cjs');
const {chatForJarvis}=require('../src/services/suite-host.cjs');
const {JarvisCore,allowedChat,cleanSettings}=require('../src/services/jarvis-core.cjs');
const {EventCore}=require('../src/core/events/event-core.cjs');
const {normalizeStreamerBotChat}=require('../src/adapters/streamerbot.cjs');
const {ingestStreamerBotChat}=require('../src/services/streamerbot-chat.cjs');
const {isAutoBroadcast}=require('../src/core/broadcast/visibility.cjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const mainSource=fs.readFileSync(path.join(__dirname,'../electron/main21.cjs'),'utf8');
const chatBridge=mainSource.slice(mainSource.indexOf('function normalizedToChat('),mainSource.indexOf('function normalizedToUiEvent('));
assert(chatBridge.startsWith('function normalizedToChat('));
const actualChatBridge=vm.runInNewContext(chatBridge+'\nnormalizedToChat;');
const throughChat=(message,source)=>normalizeMessage(actualChatBridge(normalizeChat(message,source)));

function popoutFixture(config={}){
 const handlers=new Map(),messages=[],timers=new Map();let serial=0;
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new EventEmitter();this.webContents.mainFrame={url:''};this.webContents.getURL=()=>this.webContents.mainFrame.url;this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};this.webContents.insertText=()=>Promise.resolve();}
  async loadURL(url){this.webContents.mainFrame.url=url;}isDestroyed(){return false;}isMinimized(){return false;}show(){}
 }
 const file=path.join(__dirname,'../electron/twitch-popout.cjs'),scope={module:{exports:{}},require:name=>name==='electron'?{BrowserWindow:Window,ipcMain:{on:(name,callback)=>handlers.set(name,callback)}}:require(name),__dirname:path.dirname(file),URL,Date,setTimeout:callback=>{const id=++serial;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),scope,{filename:file});
 const popout=new scope.module.exports.TwitchPopout({getConfig:()=>({channel:'owner',popoutUrl:'https://dashboard.twitch.tv/popout/u/owner/stream-manager/chat',...config}),getParent:()=>null,onMessage:(message,source)=>messages.push({message,source})});
 return {popout,messages,emit:payload=>handlers.get('twitch-popout:message')({sender:popout.window.webContents,senderFrame:popout.window.webContents.mainFrame},payload)};
}
function preloadFixture(){
 const callbacks=new Map(),sent=[],timers=[],elements=[];let changed;
 const root={isConnected:true,querySelectorAll:()=>elements};
 const scope={require:name=>{assert.equal(name,'electron');return {ipcRenderer:{send:(name,payload)=>sent.push({name,payload}),on:()=>{}}};},location:{hostname:'dashboard.twitch.tv'},window:{addEventListener:(name,fn)=>callbacks.set(name,fn)},document:{querySelector:()=>root},URL,Date,Math,WeakSet,setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout:()=>{},setInterval:()=>{},MutationObserver:class{constructor(callback){changed=callback;}disconnect(){}observe(){}}};
 const file=path.join(__dirname,'../electron/twitch-popout-preload.cjs');vm.runInNewContext(fs.readFileSync(file,'utf8'),scope,{filename:file});callbacks.get('DOMContentLoaded')();timers[0]();
 return {ingest:row=>{elements.push(row);changed();return sent.filter(item=>item.name==='twitch-popout:message').at(-1)?.payload;}};
}
function row({id='native',canonical='owner',display='Beliebiger Anzeigename',badgeAlt='',badgeSrc='https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1',badgeElement=true}={}){
 const user={textContent:display,getAttribute:name=>name==='data-a-user'?canonical:null};
 const image={getAttribute:name=>name==='alt'?badgeAlt:name==='src'?badgeSrc:null};
 return {getAttribute:name=>name==='data-id'?id:null,querySelector:selector=>selector.includes('username')?user:null,querySelectorAll:selector=>selector.includes('text-fragment')?[{tagName:'SPAN',textContent:'Hallo'}]:selector.includes('chat-badge')&&badgeElement&&badgeAlt?[image]:[]};
}
function jarvisFixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-popout-narration-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const said=[],jarvis=new JarvisCore({directory,speak:text=>said.push(text)});jarvis.settings=cleanSettings({chatSource:'connected'});jarvis.execute=()=>assert.fail('Chat must remain narration only');return {jarvis,said};
}

test('isolated Twitch preload keeps canonical login separate from display name',()=>{
 const fixture=preloadFixture(),owner=fixture.ingest(row({canonical:'OwNeR',display:'Neuer Name'}));
 assert.equal(owner.canonicalLogin,'owner');assert.equal(owner.username,'owner');assert.equal(owner.displayName,'Neuer Name');assert.equal(owner.isBroadcaster,false);
 const missing=fixture.ingest(row({id:'second',canonical:'',display:'owner'}));assert.equal(missing.canonicalLogin,'');assert.equal(missing.username,'owner');
 const invalid=fixture.ingest(row({id:'third',canonical:'@owner',display:'owner'}));assert.equal(invalid.canonicalLogin,'');
});
test('only a Twitch badge element with exact moderator label and official badge CDN supplies a narration hint',()=>{
 for(const [index,options,expected]of [
  [0,{canonical:'mod',badgeAlt:'Moderator'},true],
  [1,{canonical:'mod',badgeAlt:'Not a Moderator'},false],
  [2,{canonical:'mod',badgeAlt:'Moderator',badgeSrc:'https://example.com/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1'},false],
  [3,{canonical:'mod',badgeAlt:'Moderator',badgeElement:false},false],
  [4,{canonical:'',badgeAlt:'Moderator'},false]
 ])assert.equal(preloadFixture().ingest(row({id:String(index),...options})).moderatorBadge,expected,String(index));
});
test('canonical channel owner and moderator narrate through the actual normalization without granting platform roles',async t=>{
 const fixture=popoutFixture();await fixture.popout.connect();const {jarvis,said}=jarvisFixture(t);
 for(const payload of [preloadFixture().ingest(row()),preloadFixture().ingest(row({id:'mod-message',canonical:'mod',badgeAlt:'Moderator'}))]){
  fixture.emit(payload);const {message,source}=fixture.messages.at(-1),event=normalizeChat(message,source),chat=normalizeMessage(actualChatBridge(event));
  assert.equal(event.user.isBroadcaster,false);assert.equal(event.user.isModerator,false);assert.equal(event.user.identityVerified,false);assert.equal(event.user.badges.length,0);
  assert.equal(chat.isBroadcaster,false);assert.equal(chat.moderator,false);assert.equal(chat.identityVerified,false);assert.equal(chat.channelId,'login:owner');
  const speech=chatForJarvis(chat);assert.equal(allowedChat(speech,jarvis.settings),true);jarvis.onChat([speech]);
 }
 assert.equal(said.length,1);assert.equal(jarvis.chatPending.length,1);assert.equal(jarvis.memory.length,0);
});
test('display-name-only owner, other canonical viewer and unmatched channels stay silent',async()=>{
 const fixture=popoutFixture();await fixture.popout.connect();
 for(const [index,payload]of [
  {canonicalLogin:'',username:'owner',displayName:'owner'},
  {canonicalLogin:'viewer',username:'owner',displayName:'owner'},
  {canonicalLogin:'@owner',username:'owner',displayName:'owner'}
 ].entries()){
  fixture.emit({id:String(index),message:'Hallo',...payload});const entry=fixture.messages.at(-1),chat=throughChat(entry.message,entry.source);
  assert.equal(chat.narrationRole,'');assert.equal(allowedChat(chatForJarvis(chat),cleanSettings({chatSource:'connected'})),false);
 }
 fixture.popout.window.webContents.mainFrame.url='https://dashboard.twitch.tv/settings';fixture.emit({id:'unmatched-url',canonicalLogin:'owner',username:'owner',message:'Hallo'});
 assert.equal(throughChat(fixture.messages.at(-1).message,'twitch-popout').narrationRole,'');
});
test('a confirmed manual echo from configured sender narrates once but a name fallback cannot confirm it',async t=>{
 const fixture=popoutFixture({senderUsername:'sender'});await fixture.popout.connect();const {jarvis,said}=jarvisFixture(t);
 const sending=fixture.popout.sendChat('Manuelle Nachricht');
 fixture.emit({id:'spoof-display',canonicalLogin:'viewer',username:'sender',message:'Manuelle Nachricht'});assert.equal(fixture.popout.pending.size,1);
 fixture.emit({id:'confirmed-own',canonicalLogin:'sender',username:'sender',message:'Manuelle Nachricht'});assert.equal((await sending).confirmed,true);
 const entry=fixture.messages.at(-1);assert.equal(entry.source,'manual');const chat=throughChat(entry.message,entry.source);assert.equal(chat.narrationRole,'self');
 jarvis.onChat([chatForJarvis(chat)]);fixture.emit({id:'confirmed-own',canonicalLogin:'sender',username:'sender',message:'Manuelle Nachricht'});jarvis.onChat([chatForJarvis(chat)]);
 assert.equal(said.length,1);assert.equal(chat.isBroadcaster,false);assert.equal(chat.moderator,false);assert.equal(chat.identityVerified,false);
});
test('automatic echo retains broadcast provenance and visibility without becoming a manual self message',async t=>{
 const fixture=popoutFixture({senderUsername:'sender'});await fixture.popout.connect();const sending=fixture.popout.sendChat('Automatischer Text',{source:'broadcast-run:example'});
 fixture.emit({id:'auto-own',canonicalLogin:'sender',username:'sender',message:'Automatischer Text'});await sending;
 const entry=fixture.messages.at(-1),chat=throughChat(entry.message,entry.source);assert.equal(entry.source,'broadcast-run:example');assert.equal(isAutoBroadcast(chat),true);assert.equal(chat.narrationRole,'');
 const core=new ChatCore({filters:{enabled:false},multiChat:{},moderation:{state:{}},autoBroadcast:{showInMultiChat:false}}),accepted=core.ingest(normalizeChat(entry.message,entry.source));
 assert.equal(core.isMultiChatVisible(accepted),false);const {jarvis,said}=jarvisFixture(t);jarvis.settings.chatSource='window';jarvis.onChat([{...chatForJarvis(accepted),windowVisible:core.isMultiChatVisible(accepted)}]);assert.equal(said.length,0);
});
test('same native Twitch message narrates exactly once in Popout-first, queued and Streamer.bot-first orders',async t=>{
 for(const order of ['popout-first','queued-popout-first','bot-first']){
  const fixture=popoutFixture();await fixture.popout.connect();fixture.emit({id:'native-message',canonicalLogin:'owner',username:'owner',message:'Jarvis starte den Stream'});const {message,source}=fixture.messages[0];
  const core=new EventCore(),chat=new ChatCore({filters:{enabled:false},multiChat:{},moderation:{state:{}}}),events=[],{jarvis,said}=jarvisFixture(t);t.after(()=>core.stop());
  chat.on('message',value=>jarvis.onChat([chatForJarvis(value)]));chat.on('identity',value=>jarvis.onChat([chatForJarvis(value)]));core.on('event',event=>{events.push(event);chat.ingest(event);});
  const bot=normalizeStreamerBotChat({event:{source:'Twitch',type:'ChatMessage'},data:{messageId:'native-message',text:message.message,broadcaster:{id:'456',login:'owner'},user:{id:'456',login:'owner',name:'Owner'}}});
  if(order==='bot-first')ingestStreamerBotChat(core,chat,bot);else core.ingestChat(message,source);
  if(order!=='queued-popout-first')await flush();
  if(order==='bot-first')core.ingestChat(message,source);else ingestStreamerBotChat(core,chat,bot);
  await flush();ingestStreamerBotChat(core,chat,bot);assert.equal(events.length,1,order);assert.equal(chat.messages.length,1,order);assert.equal(said.length,1,order);assert.equal(jarvis.memory.length,0,order);
  assert.equal(chat.messages[0].userId,'456',order);assert.equal(chat.messages[0].isBroadcaster,true,order);
 }
});
test('narration evidence is bound to source, canonical author, channel and native message ID',async()=>{
 const fixture=popoutFixture();await fixture.popout.connect();fixture.emit({id:'native-message',canonicalLogin:'owner',username:'owner',message:'Hallo'});
 const valid=normalizeChat(fixture.messages[0].message,'twitch-popout');assert.equal(normalizeMessage(valid).narrationRole,'owner');
 for(const change of [
  event=>event.user.username='viewer',event=>event.eventId='twitch:chat:other',event=>event.meta.sourceConnector='fake-connector',event=>event.meta.sourceConnector='tikfinity',event=>event.meta.rawData.channel='other',event=>event.meta.rawData.narration.canonicalLogin='owner ',event=>event.meta.rawData.narration.channel='@owner',event=>event.meta.rawData.narration.messageId=null
 ]){const event=structuredClone(valid);change(event);assert.equal(normalizeMessage(event).narrationRole,'');}
 assert.equal(normalizeMessage({platform:'twitch',username:'viewer',message:'Hallo',narrationRole:'owner'}).narrationRole,'');
});
