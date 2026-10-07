'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = require('../src/renderer/widget-windows-ui.js');

test('saved webpage addresses allow empty slots and normalized HTTPS addresses only', () => {
  assert.equal(ui.address(''), '');
  assert.equal(ui.address('  https://example.invalid/overlay?mode=gift#show  '), 'https://example.invalid/overlay?mode=gift#show');
  for (const value of ['http://example.invalid','javascript:alert(1)','file:///C:/secret.txt','https://user:password@example.invalid','example.invalid','https://']) assert.throws(() => ui.address(value));
  assert.throws(() => ui.address('https://example.invalid/' + 'a'.repeat(2048)));
});

test('address edits retain stable slot identity, trim labels and require a name for configured pages', () => {
  assert.deepEqual(ui.captureSlot('slot-4','  Geschenk-Overlay  ','https://example.invalid'), {id:'slot-4',name:'Geschenk-Overlay',url:'https://example.invalid/'});
  assert.deepEqual(ui.captureSlot('slot-4','',''), {id:'slot-4',name:'',url:''});
  assert.throws(() => ui.captureSlot('slot-1','','https://example.invalid'));
  assert.throws(() => ui.captureSlot('slot-1','a'.repeat(81),''));
  assert.equal(ui.hostname('https://example.invalid/private?token=secret'), 'example.invalid');
});

test('background previews accept only local managed-file URLs and known fitting modes', () => {
  assert.deepEqual(ui.background({hasImage:true,name:'Mein Hintergrund.png',fit:'contain',imageUrl:'file:///C:/managed/image.png'}), {hasImage:true,name:'Mein Hintergrund.png',fit:'contain',imageUrl:'file:///C:/managed/image.png'});
  assert.equal(ui.background({hasImage:true,imageUrl:'file:///C:/managed/image.png',fit:'stretch'}).fit,'stretch');
  assert.equal(ui.background({hasImage:true,imageUrl:'file:///C:/managed/image.png',fit:'unknown'}).fit,'cover');
  for (const imageUrl of ['https://example.invalid/background.png','javascript:alert(1)','data:image/png;base64,AAA','file://remote-share/image.png','file:///C:/managed/image.png?other=1','file:///C:/managed/image.png#other']) assert.equal(ui.background({hasImage:true,imageUrl}).hasImage,false);
  assert.equal(ui.background({hasImage:false,imageUrl:'file:///C:/managed/image.png'}).hasImage,false);
  assert.deepEqual(ui.background(null),{hasImage:false,name:'',fit:'cover',imageUrl:''});
});

test('the original detached chat never mounts or subscribes to the additional widget windows', () => {
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/widget-windows-ui.js'),'utf8');
  let reads=0;
  vm.runInNewContext(source,{window:{location:{search:'?detached=1'},document:{querySelector(){reads++;throw Error('Original chat must not mount widgets');}},batto:{widgetWindowsStatus(){reads++;}}},URLSearchParams,URL,String});
  assert.equal(reads,0);
});

const renderer = fs.readFileSync(path.join(__dirname,'../src/renderer/widget-window.js'),'utf8');
function toolbarFixture() {
  const nodes = new Map(), calls = [], elements = ['#widgetWindowName','#widgetWindowStatus','#widgetWindowSlot','#widgetWindowReload','#widgetWindowClose','#widgetWindowTop','.widget-window-toolbar','#widgetWindowBackground','#widgetWindowPlaceholder'];
  for (const name of elements) nodes.set(name, {textContent:'',disabled:true,checked:false,value:'',dataset:{},style:{},listeners:{},addEventListener(type,callback){this.listeners[type]=callback;},setAttribute(name,value){this[name]=value;},getAttribute(name){return this[name];},removeAttribute(name){delete this[name];}});
  let publish;
  const state = {ok:true,windowId:'widget-2',slots:[{id:'slot-1',name:'TikFinity',url:'https://example.invalid/overlay'},{id:'slot-2',name:'',url:''}],windows:[{id:'widget-1',name:'Fenster 2',slotId:'slot-2',open:false},{id:'widget-2',name:'Fenster 3',slotId:'slot-1',open:true,loading:false,alwaysOnTop:false}]};
  const copy = value => JSON.parse(JSON.stringify(value));
  const api = {status:async()=>{calls.push(['status']);return copy(state);},select:async value=>{calls.push(['select',copy(value)]);state.windows[1].slotId=value.slotId;return copy(state);},reload:async()=>{calls.push(['reload']);return copy(state);},close:async()=>{calls.push(['close']);return copy(state);},alwaysOnTop:async value=>{calls.push(['alwaysOnTop',copy(value)]);state.windows[1].alwaysOnTop=value.value;return copy(state);},onUpdate:fn=>publish=fn};
  vm.runInNewContext(renderer,{window:{widgetWindow:api},document:{querySelector:key=>nodes.get(key)},String,JSON,Array,Error,URL});
  return {nodes,calls,state,publish:value=>publish(copy(value)),settle:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('detached toolbar reads only its verified window identity and never opens a page on startup or state updates', async () => {
  const f=toolbarFixture();await f.settle();
  assert.deepEqual(f.calls,[['status']]);
  assert.equal(f.nodes.get('#widgetWindowName').textContent,'Fenster 3');
  assert.equal(f.nodes.get('#widgetWindowSlot').value,'slot-1');
  f.publish({...f.state,windows:[...f.state.windows].reverse()});
  assert.equal(f.nodes.get('#widgetWindowName').textContent,'Fenster 3');
  assert.deepEqual(f.calls,[['status']]);
});

test('toolbar actions send only explicit slot and display settings without caller-chosen window IDs', async () => {
  const f=toolbarFixture();await f.settle();
  const select=f.nodes.get('#widgetWindowSlot');select.value='slot-2';select.listeners.change();await f.settle();
  f.nodes.get('#widgetWindowReload').listeners.click();await f.settle();
  const top=f.nodes.get('#widgetWindowTop');top.checked=true;top.listeners.change();await f.settle();
  f.nodes.get('#widgetWindowClose').listeners.click();await f.settle();
  assert.deepEqual(f.calls,[['status'],['select',{slotId:'slot-2'}],['reload'],['alwaysOnTop',{value:true}],['close']]);
});

test('detached toolbar shows only its own local background beneath the page and updates fitting and removal', async () => {
  const f=toolbarFixture();await f.settle();
  const image=f.nodes.get('#widgetWindowBackground'),placeholder=f.nodes.get('#widgetWindowPlaceholder');
  assert.equal(image.hidden,true);assert.equal(placeholder.hidden,false);
  f.state.windows[0].background={hasImage:true,name:'Other.png',fit:'cover',imageUrl:'file:///C:/managed/other.png'};
  f.state.windows[1].background={hasImage:true,name:'Mine.png',fit:'contain',imageUrl:'file:///C:/managed/mine.png'};
  f.publish(f.state);
  assert.equal(image.src,'file:///C:/managed/mine.png');assert.equal(image.style.objectFit,'contain');assert.equal(image.hidden,false);assert.equal(placeholder.hidden,true);
  f.state.windows[1].background.fit='stretch';f.publish(f.state);assert.equal(image.style.objectFit,'fill');
  f.state.windows[1].background={hasImage:false,fit:'cover'};f.publish(f.state);
  assert.equal(image.hidden,true);assert.equal(placeholder.hidden,false);assert.equal(image.src,undefined);
  assert.deepEqual(f.calls,[['status']]);
});

test('detached toolbar never embeds arbitrary remote or script image addresses', async () => {
  const f=toolbarFixture();await f.settle();
  for (const imageUrl of ['https://example.invalid/private.png','javascript:alert(1)','file://remote-share/picture.png']) {
    f.state.windows[1].background={hasImage:true,fit:'cover',imageUrl};f.publish(f.state);
    assert.equal(f.nodes.get('#widgetWindowBackground').hidden,true);
    assert.equal(f.nodes.get('#widgetWindowBackground').src,undefined);
  }
});

test('local toolbar has a strict CSP, no embedded remote page and no full app bridge', () => {
  const html=fs.readFileSync(path.join(__dirname,'../src/renderer/widget-window.html'),'utf8');
  assert.match(html,/frame-src 'none'/);assert.match(html,/connect-src 'none'/);assert.match(html,/object-src 'none'/);
  assert.doesNotMatch(html,/<iframe|<webview/i);
  assert.doesNotMatch(renderer,/window\.batto|location\.search|URLSearchParams/);
  assert.match(html,/img-src 'self' file:/);assert.doesNotMatch(html,/img-src[^;]*https:/);
  assert.match(fs.readFileSync(path.join(__dirname,'../src/renderer/widget-window.css'),'utf8'),/height:88px/);
});
