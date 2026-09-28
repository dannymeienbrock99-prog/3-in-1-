'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter,once}=require('node:events');
const {WebSocket}=require('ws');
const {OverlayServer}=require('../src/core/overlay-server.cjs');
const {wishlistState,wishlistImage,overlayWidgetTrigger}=require('../src/core/wishlist-overlay.cjs');
const {createChatExtrasService}=require('../electron/chat-extras-service.cjs');
const {ConfigStore,DEFAULT_CONFIG,migrateConfig}=require('../src/core/config-store.cjs');
const clientSource=fs.readFileSync(path.join(__dirname,'../src/renderer/wishlist-overlay.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const baseWish=()=>({enabled:true,title:'Wunschgeschenke',caption:'Danke!',width:180,height:80,scale:1,anchor:'top-right',x:12,y:12,durationMs:1000,permanent:false,fadeInMs:100,fadeOutMs:100,queueMode:'queue',maxQueue:2,items:[{key:'file:rose.png',name:'Rose',sourceType:'image',url:'/overlay/wishlist/image?key=file%3Arose.png',giftId:'5655',giftIdVerified:true}]});
const results=[];
function passed(name){results.push(name);console.log('PASS '+name);}
class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attrs={};}
 append(...nodes){for(const n of nodes){n.remove();n.parent=this;this.children.push(n);}}
 insertBefore(node,reference){node.remove();node.parent=this;const i=this.children.indexOf(reference);this.children.splice(i<0?this.children.length:i,0,node);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}}
 setAttribute(k,v){this.attrs[k]=v;}
 set src(v){this.attrs.src=v;this.srcChanges=(this.srcChanges||0)+1;}
 get src(){return this.attrs.src;}
}
async function browser(initial){
 let config=clone(initial),now=0,next=0,fetches=0,unload,activeFetch=0,maxConcurrentFetch=0;
 const timers=new Map(),sockets=[],host=new Node('div');host.style.visibility='hidden';
 const later=(fn,ms)=>{timers.set(++next,{fn,at:now+ms});return next;};
 function advance(ms){const end=now+ms;let safety=1000;while(safety--){let first;for(const entry of timers)if(entry[1].at<=end&&(!first||entry[1].at<first[1].at))first=entry;if(!first)break;timers.delete(first[0]);now=first[1].at;first[1].fn();}assert.ok(safety>0,'Timer loop terminates');now=end;}
 class Socket{constructor(url){this.url=url;sockets.push(this);}close(){this.onclose?.();}}
 const sandbox={document:{getElementById:()=>host,createElement:t=>new Node(t)},location:{protocol:'http:',host:'127.0.0.1:12345'},WebSocket:Socket,addEventListener:(event,cb)=>{if(event==='beforeunload')unload=cb;},fetch:async()=>{fetches++;activeFetch++;maxConcurrentFetch=Math.max(maxConcurrentFetch,activeFetch);await Promise.resolve();activeFetch--;return{ok:true,json:async()=>clone(config)};},setTimeout:later,clearTimeout:id=>timers.delete(id),console};
 vm.runInNewContext(clientSource,sandbox);
 await new Promise(resolve=>setImmediate(resolve));advance(0);
 return{host,advance,get config(){return config;},set config(x){config=clone(x);},async update(){await sockets.at(-1).onmessage({data:JSON.stringify({type:'config',sections:['chatExtras']})});},async message(p){return sockets.at(-1).onmessage({data:JSON.stringify(p)});},async trigger(p={}){return this.message({type:'chat-widgets:trigger',data:{kind:'wishlist',...p}});},close(){unload();assert.equal(timers.size,0,'Unload clears own timers and reconnect');},get fetches(){return fetches;},get maxConcurrentFetch(){return maxConcurrentFetch;}};
}
async function clientTests(){
 let b=await browser(baseWish());assert.equal(b.host.style.visibility,'hidden');
 await b.trigger({triggerId:'one'});assert.equal(b.host.style.visibility,'visible');assert.equal(b.host.style.transition,'opacity 100ms');
 await b.trigger({triggerId:'one'});b.advance(1000);assert.equal(b.host.style.opacity,'0');assert.equal(b.host.style.visibility,'visible','Fade keeps element until finished');b.advance(100);assert.equal(b.host.style.visibility,'hidden');b.close();passed('Client duration, fade-out, duplicate trigger suppression');
 b=await browser(baseWish());await b.trigger({triggerId:'1'});await b.trigger({triggerId:'2'});await b.trigger({triggerId:'3'});await b.trigger({triggerId:'4'});
 b.advance(1100);assert.equal(b.host.style.opacity,'1');b.advance(1100);assert.equal(b.host.style.opacity,'1');b.advance(1100);assert.equal(b.host.style.visibility,'hidden','Queue is capped at two waiting items');b.close();passed('Client FIFO queue and maximum queue size');
 for(const mode of ['replace','discard']){b=await browser({...baseWish(),queueMode:mode});await b.trigger({triggerId:'a'});b.advance(500);await b.trigger({triggerId:'b'});b.advance(600);assert.equal(b.host.style.visibility,mode==='replace'?'visible':'hidden');b.advance(500);assert.equal(b.host.style.visibility,'hidden');b.close();}passed('Client replace and discard modes');
 b=await browser({...baseWish(),enabled:false});await b.trigger();assert.equal(b.host.style.visibility,'hidden');await b.trigger({preview:true,durationMs:500});assert.equal(b.host.style.visibility,'visible');b.config.caption='Unrelated save';await b.update();b.advance(499);assert.equal(b.host.style.opacity,'1');b.advance(101);assert.equal(b.host.style.visibility,'hidden');assert.equal(b.config.enabled,false);b.close();passed('Disabled preview is temporary and survives unrelated config refresh');
 b=await browser({...baseWish(),permanent:true});assert.equal(b.host.style.visibility,'visible');await b.trigger({preview:true,durationMs:500});b.advance(600);assert.equal(b.host.style.visibility,'visible','Preview restores permanent display');b.advance(20000);assert.equal(b.host.style.visibility,'visible');
 await b.trigger({visible:false});b.advance(100);assert.equal(b.host.style.visibility,'hidden');await b.trigger({preview:true,durationMs:500});b.advance(600);assert.equal(b.host.style.visibility,'hidden','Preview restores explicitly hidden permanent display');
 await b.trigger({durationMs:500});b.advance(250);b.config.caption='Config update during timed run';await b.update();b.advance(350);assert.equal(b.host.style.visibility,'hidden','Config refresh must not cancel explicit duration');await b.update();assert.equal(b.host.style.visibility,'hidden');b.close();passed('Permanent preview restoration, manual hide and timed override');
 b=await browser({...baseWish(),permanent:true});b.config.permanent=false;await b.update();b.advance(100);assert.equal(b.host.style.visibility,'hidden');await b.trigger();await b.trigger();b.config.enabled=false;await b.update();b.advance(5000);assert.equal(b.host.style.visibility,'hidden');b.close();passed('Permanent off and disabled clear display and queue');
 b=await browser({...baseWish(),items:[{key:'url:a',name:'Widget',sourceType:'widget',url:'https://tikfinity.zerody.one/widget/gifts?cid=676051&custom=kept'}]});
 const frame=b.host.children[2].children[0].children[0];assert.equal(frame.attrs.sandbox,'allow-scripts allow-same-origin');assert.match(frame.attrs.allow,/autoplay 'none'/);
 b.config.caption='New caption';b.config.items[0].giftIdVerified=true;b.config.items[0].giftId='777';b.config.items[0].name='Renamed';await b.update();assert.equal(b.host.children[2].children[0].children[0],frame);assert.equal(frame.srcChanges,1);assert.match(frame.src,/custom=kept/);assert.equal(frame.title,'Renamed');
 b.config.items[0].url+='&new=1';await b.update();assert.equal(frame.srcChanges,2);b.close();passed('Unchanged iframe session retained across text/metadata updates; full query and isolation');
 b=await browser(baseWish());await b.message(null);await b.message({type:'event',data:{type:'gift',platform:'twitch',giftId:'5655'}});assert.equal(b.host.style.visibility,'hidden');await b.message({type:'event',data:{type:'gift',platform:'tiktok',data:{gift:{giftId:'5655'},msgId:'gift-1'}}});assert.equal(b.host.style.visibility,'visible');await b.message({type:'event',data:{event:'gift',platform:'tiktok',giftId:'5655',id:'gift-1'}});b.advance(1100);assert.equal(b.host.style.visibility,'hidden');b.config.items[0].giftIdVerified=false;await b.update();await b.message({type:'event',data:{type:'gift',platform:'tiktok',giftId:'5655',id:'gift-2'}});assert.equal(b.host.style.visibility,'hidden');
 await Promise.all([b.trigger({preview:true,durationMs:500}),b.update(),b.trigger({visible:false})]);assert.equal(b.maxConcurrentFetch,1,'Incoming messages serialize state loads');b.advance(100);assert.equal(b.host.style.visibility,'hidden');b.close();passed('TikTok verified gift IDs, normalized aliases, no other platform, ordered WS updates');
}
async function httpTests(temp){
 const gifts=path.join(temp,'gifts');fs.mkdirSync(gifts);const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
 for(const name of ['rose.png','not-selected.png','disabled.png','safe..png'])fs.writeFileSync(path.join(gifts,name),png);fs.writeFileSync(path.join(temp,'outside.png'),png);
 let config={...clone(DEFAULT_CONFIG),chatExtras:{widgets:[],wishlist:{...baseWish(),folderPath:gifts,items:[{key:'file:rose.png',name:'Rose',enabled:true,giftId:'5655',giftIdVerified:true,secret:'private',verificationSource:'private'},{key:'file:disabled.png',name:'Off',enabled:false},{key:'file:safe..png',name:'Safe dots',enabled:true},{key:'url:valid',name:'Remote',url:'https://example.com/widget?a=1&b=2',sourceType:'widget'},{key:'url:bad',name:'Bad',url:'javascript:alert(1)'},{key:'url:secret',name:'Credentials',url:'https://secret:password@example.com/'}]}}};
 const core=new EventEmitter();core.log=()=>{};core.getMessages=()=>[];const server=new OverlayServer({chatCore:core,configStore:{get:()=>config}});server.port=0;
 let client;
 try{
  await server.start();server.port=server.server.address().port;const url='http://127.0.0.1:'+server.port;
  for(const route of ['/overlay/wishlist','/overlay/wishlist/client.js','/overlay/wishlist/style.css']){const r=await fetch(url+route);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');const body=await r.text();assert.ok(body.length>50);}
  const stateResponse=await fetch(url+'/api/wishlist'),state=await stateResponse.json();assert.equal(stateResponse.status,200);assert.equal(state.items.length,3);assert.equal(state.items[2].url,'https://example.com/widget?a=1&b=2');assert.ok(!JSON.stringify(state).includes(gifts));assert.ok(!JSON.stringify(state).includes('private'));assert.ok(!JSON.stringify(state).includes('password'));assert.equal(state.items[0].giftIdVerified,true);passed('Real HTTP routes, headers and minimized safe display API');
  for(const key of ['file:rose.png','file:safe..png']){const r=await fetch(url+'/overlay/wishlist/image?key='+encodeURIComponent(key));assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^image\/png/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);}
  config.chatExtras.wishlist.items.push(...['file:../outside.png','file:..\\outside.png','file:'+path.join(temp,'outside.png'),'file:rose.png:secret.png'].map(key=>({key,name:'Traversal'})));
  for(const key of ['file:not-selected.png','file:disabled.png','file:../outside.png','file:..\\outside.png','file:'+path.join(temp,'outside.png'),'file:rose.png:secret.png','url:valid'])assert.equal((await fetch(url+'/overlay/wishlist/image?key='+encodeURIComponent(key))).status,404,key);
  assert.equal((await fetch(url+'/overlay/wishlist/image?key[]=file:rose.png')).status,404);assert.equal((await fetch(url+'/overlay/wishlist/image?key=file:rose.png&key=file:disabled.png')).status,404);assert.equal((await fetch(url+'/api/wishlist',{headers:{Origin:'https://outside.example'}})).status,403);passed('Real HTTP selected PNG bytes, traversal/ADS/query-array/unselected/disabled blocking and Origin guard');
  let symlinkTest='not supported by this Windows account';try{fs.symlinkSync(path.join(temp,'outside.png'),path.join(gifts,'escape.png'),'file');config.chatExtras.wishlist.items.push({key:'file:escape.png',name:'Escape'});assert.equal((await fetch(url+'/overlay/wishlist/image?key=file%3Aescape.png')).status,404);symlinkTest='outside symlink rejected';}catch(e){if(!['EPERM','EACCES','ENOTSUP'].includes(e.code))throw e;}
  const originalRealpath=fs.realpathSync;try{fs.realpathSync=file=>file===path.join(gifts,'simulated.png')?path.join(temp,'outside.png'):originalRealpath(file);config.chatExtras.wishlist.items.push({key:'file:simulated.png'});assert.equal(wishlistImage(config,'file:simulated.png',temp),null);}finally{fs.realpathSync=originalRealpath;}passed('Resolved-path containment ('+symlinkTest+')');
  client=new WebSocket(url.replace('http:','ws:')+'/ws');await once(client,'open');const received=[];client.on('message',bytes=>received.push(JSON.parse(bytes)));let localPreview;
  const service=createChatExtrasService({getConfig:()=>config,saveConfig:()=>assert.fail('Preview must not save config'),send:(channel,p)=>{localPreview=p;server.broadcast({type:channel,data:overlayWidgetTrigger(p)});},assetsDir:temp,allowCatalogFetch:false});
  config.chatExtras.wishlist.enabled=false;assert.throws(()=>service.trigger({kind:'wishlist'}),/deaktiviert/);
  const before=JSON.stringify(config);const result=service.trigger({kind:'wishlist',preview:true,durationMs:50});assert.equal(result.ok,true);assert.equal(localPreview.durationMs,250);assert.ok(localPreview.definition.folderPath);
  await new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(received.some(p=>p.type==='chat-widgets:trigger')){clearInterval(timer);resolve();}else if(Date.now()-start>2000){clearInterval(timer);reject(Error('WS preview missing'));}},5);});
  const event=received.find(p=>p.type==='chat-widgets:trigger');assert.equal(event.data.triggerId,result.triggerId);assert.equal(event.data.preview,true);assert.equal(event.data.durationMs,250);assert.equal(event.data.definition,undefined);assert.ok(!JSON.stringify(event).includes(gifts));assert.equal(JSON.stringify(config),before);
  service.trigger({kind:'wishlist',preview:true,durationMs:999999});assert.equal(localPreview.durationMs,120000);config.chatExtras.wishlist.items=[];assert.throws(()=>service.trigger({kind:'wishlist',preview:true}),/mindestens ein/);
  service.close();passed('Real Service → Overlay HTTP/WS preview forwarding, bounded duration, no config writes or folder leakage');
 }finally{client?.terminate();await server.stop();}
}
function migrationTests(temp){
 const raw=clone(DEFAULT_CONFIG);delete raw.chatExtras.wishlist.layoutVersion;Object.assign(raw.chatExtras.wishlist,{width:300,height:110,scale:1});const untouched=JSON.stringify(raw);
 let migrated=migrateConfig(raw);assert.equal(JSON.stringify(raw),untouched,'Migration does not mutate caller input');assert.deepEqual([migrated.chatExtras.wishlist.width,migrated.chatExtras.wishlist.height,migrated.chatExtras.wishlist.layoutVersion],[180,80,2]);assert.deepEqual(migrateConfig(migrated).chatExtras.wishlist,migrated.chatExtras.wishlist);
 for(const size of [[420,110,1],[300,200,1],[300,110,1.5]]){const custom=clone(raw);Object.assign(custom.chatExtras.wishlist,{width:size[0],height:size[1],scale:size[2]});const w=migrateConfig(custom).chatExtras.wishlist;assert.deepEqual([w.width,w.height,w.scale],size);}
 const home=path.join(temp,'profile');fs.mkdirSync(path.join(home,'Batto-OBS-Tool'),{recursive:true});fs.writeFileSync(path.join(home,'Batto-OBS-Tool/settings.json'),JSON.stringify(raw));let store=new ConfigStore(home);assert.equal(store.get().chatExtras.wishlist.width,180);store.merge({chatExtras:{wishlist:{caption:'saved'}}});store=new ConfigStore(home);assert.deepEqual([store.get().chatExtras.wishlist.width,store.get().chatExtras.wishlist.height],[180,80]);assert.equal(store.get().chatExtras.wishlist.caption,'saved');passed('Compact migration 300x110→180x80 once, custom dimensions retained, actual ConfigStore save/reload');
}
(async()=>{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'batto-wishlist-regression-'));try{await clientTests();await httpTests(temp);migrationTests(temp);console.log(JSON.stringify({ok:true,groups:results.length,tests:results}));}finally{fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
