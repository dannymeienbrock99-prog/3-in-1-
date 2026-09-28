'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attrs={};this.clientWidth=360;this.clientHeight=160;this.classList={add(){},toggle(){}};}
 append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
 before(n){this.parentElement?.append(n);}
 after(){}
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}}
 setAttribute(k,v){this.attrs[k]=v;}
 getAttribute(k){return this.attrs[k]??null;}
 addEventListener(){}
 set src(value){this.attrs.src=value;this.srcChanges=(this.srcChanges||0)+1;}
 get src(){return this.attrs.src;}
 replaceChildren(...nodes){for(const n of this.children.slice())n.remove();this.append(...nodes);}
}
let now=0,next=0;const timers=new Map();function timeout(fn,delay){timers.set(++next,{fn,at:now+delay});return next;}function advance(ms){const end=now+ms;while(true){let found;for(const[id,timer]of timers)if(timer.at<=end&&(!found||timer.at<found[1].at))found=[id,timer];if(!found)break;now=found[1].at;timers.delete(found[0]);found[1].fn();}now=end;}
const card=new Node('section'),chat=new Node('div');card.append(chat);let platformEvent,widgetTrigger;
const config={chatExtras:{widgets:[{id:'follow',name:'Follow',url:'https://tikfinity.zerody.one/widget/alert?cid=676051&custom=preserved',enabled:true,event:'follow',platform:'tiktok',width:360,height:160,scale:1,durationMs:1000,fadeInMs:0,fadeOutMs:100,permanent:false,queueMode:'queue',maxQueue:2}],wishlist:{enabled:false,items:[]}}};
const window={},sandbox={window,S:{config},document:{querySelector:s=>s==='#chatList'?chat:null,createElement:tag=>new Node(tag)},api:{onChatWidgetTrigger:cb=>widgetTrigger=cb,onPlatformEvent:cb=>platformEvent=cb},ResizeObserver:class{observe(){}disconnect(){}},URL,structuredClone,Map,Set,Number,String,Date,Math,setTimeout:timeout,clearTimeout:id=>timers.delete(id),renderPlatformsModule(){},toast(){},detached:false};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/chat-extras-ui.js'),'utf8'),sandbox);
const ui=window.BattoChatExtras,surface=chat.parentElement,layer=surface.children.find(n=>n!==chat),slot=layer.children[0],iframe=slot.children[0];
assert.equal(iframe.getAttribute('src'),config.chatExtras.widgets[0].url,'Full HTTPS query preserved');
assert.equal(iframe.getAttribute('sandbox'),'allow-scripts allow-same-origin');assert.match(iframe.getAttribute('allow'),/autoplay 'none'/);
platformEvent({event:'follow',platform:'tiktok',id:'one'});assert.equal(slot.style.visibility,'visible');
platformEvent({event:'follow',platform:'tiktok',id:'one'});advance(1100);assert.equal(slot.style.visibility,'hidden','Duplicate source IDs do not schedule a second alert');
platformEvent({event:'follow',platform:'tiktok',id:'two'});platformEvent({event:'follow',platform:'tiktok',id:'three'});advance(1100);assert.equal(slot.style.visibility,'visible','Queued alert shown after first fades');advance(1100);assert.equal(slot.style.visibility,'hidden');
ui.apply();assert.equal(slot.children[0],iframe,'Unrelated renders preserve iframe element');assert.equal(iframe.srcChanges,1,'Unrelated renders preserve the connected widget session');
config.chatExtras.widgets[0].permanent=true;ui.apply();advance(10000);assert.equal(slot.style.visibility,'visible');config.chatExtras.widgets[0].permanent=false;ui.apply();advance(100);assert.equal(slot.style.visibility,'hidden','Turning permanent mode off hides without waiting for another event');
config.chatExtras.widgets[0].queueMode='replace';ui.apply();ui.trigger({id:'follow'});advance(500);ui.trigger({id:'follow'});advance(600);assert.equal(slot.style.visibility,'visible');advance(500);assert.equal(slot.style.visibility,'hidden','Replace extends only this alert');
config.chatExtras.widgets[0].permanent=true;ui.apply();ui.trigger({id:'follow',durationMs:1000});advance(500);ui.apply();advance(600);assert.equal(slot.style.visibility,'hidden','Unrelated apply preserves explicit duration on permanent widgets');ui.apply();assert.equal(slot.style.visibility,'hidden','Expired override is not resurrected by unrelated rendering');
ui.trigger({id:'follow'});assert.equal(slot.style.visibility,'visible');ui.trigger({id:'follow',visible:false});advance(100);ui.apply();assert.equal(slot.style.visibility,'hidden','Explicit hide persists until show');
ui.trigger({id:'follow'});widgetTrigger({id:'follow',kind:'widget',preview:true,definition:{...config.chatExtras.widgets[0],permanent:false},durationMs:300});advance(150);ui.apply();advance(350);assert.equal(slot.style.visibility,'visible','Preview restores saved permanent display');
ui.trigger({id:'follow',visible:false});advance(100);widgetTrigger({id:'follow',kind:'widget',preview:true,definition:{...config.chatExtras.widgets[0],permanent:false},durationMs:300});advance(400);assert.equal(slot.style.visibility,'hidden','Preview restores a previously hidden permanent display');
config.chatExtras.widgets[0].enabled=false;ui.apply();assert.equal(layer.children.length,0,'Disabled widget frees its iframe and timer');advance(10000);assert.equal(layer.children.length,0);
widgetTrigger({id:'follow',kind:'widget',preview:true,definition:{...config.chatExtras.widgets[0],enabled:true,permanent:false},durationMs:300});const previewSlot=layer.children[0];assert.equal(previewSlot.style.visibility,'visible');advance(100);ui.apply();assert.equal(layer.children[0],previewSlot,'Unrelated render retains disabled preview');advance(300);assert.equal(layer.children.length,0,'Disabled preview expires and releases iframe');assert.equal(config.chatExtras.widgets[0].enabled,false);
console.log('Chat extras: frame isolation/query, event dedupe, queue, session retention, permanent toggle, explicit duration/hide, temporary preview restoration, replace and disable passed.');

