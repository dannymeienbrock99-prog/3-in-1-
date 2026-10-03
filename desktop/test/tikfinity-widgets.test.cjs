'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const urls=require('../src/renderer/tikfinity-url.js');
const {ConfigStore}=require('../src/core/config-store.cjs');
const {isTikFinityWidgetUrl,isTikFinityGiftsWidgetUrl}=require('../src/core/settings/schema.cjs');
const {validWidgetUrl}=require('../src/renderer/battlebar-view.js');
const short='https://widgets.tikfinity.com/ExampleAbc1';
test('new TikFinity tokens and canonical legacy HTTPS widgets share a validator',()=>{
 for(const url of [short,'https://tikfinity.zerody.one/widget/fallingsnow?cid=test','https://tikfinity.zerody.one/widget/gifts?cid=test']){assert(urls.isValid(url));assert(isTikFinityWidgetUrl(url));assert.equal(validWidgetUrl(url),url)}
 assert(isTikFinityGiftsWidgetUrl(short));assert(!isTikFinityGiftsWidgetUrl('https://tikfinity.zerody.one/widget/chat'));
 assert.equal(urls.normalize('http://widgets.tikfinity.com/ExampleAbc1',{allowHttp:true}),short);assert(!urls.isValid('http://widgets.tikfinity.com/ExampleAbc1'));
});
test('trusted widget policy rejects credentials, confusing hosts, ports and executable URLs',()=>{
 for(const url of ['https://widgets.tikfinity.com.evil.invalid/ExampleAbc1','https://evil.widgets.tikfinity.com/ExampleAbc1','https://widgets.tikfinity.com@evil.invalid/ExampleAbc1','https://name:secret@widgets.tikfinity.com/ExampleAbc1','https://widgets.tikfinity.com:8443/ExampleAbc1','javascript:alert(1)','data:text/html,hello','file:///C:/test.html','https://widgets.tikfinity.com/','https://widgets.tikfinity.com/a/b','https://tikfinity.zerody.one/','https://evil.tikfinity.zerody.one/widget/chat']){assert.equal(urls.normalize(url),'',url);assert(!isTikFinityWidgetUrl(url),url)}
});
test('snow opt-in and private short URL survive save/reload without enabling other widgets',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-widget-policy-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true})});const store=new ConfigStore(dir);
 store.merge({appearance:{chatWidgets:{snowUrl:short,snowAutoStart:true,snowEnabled:true,likesUrl:'',viewersUrl:'',giftsUrl:''}},performance:{webWidgetsAutoStart:false}});
 const reloaded=new ConfigStore(dir).get();assert.equal(reloaded.appearance.chatWidgets.snowUrl,short);assert.equal(reloaded.appearance.chatWidgets.snowAutoStart,true);assert.equal(reloaded.performance.webWidgetsAutoStart,false);
 for(const key of ['snowUrl','likesUrl','viewersUrl','giftsUrl'])assert.throws(()=>store.merge({appearance:{chatWidgets:{[key]:'https://evil.invalid/widget'}}}));
 assert.equal(new ConfigStore(dir).get().appearance.chatWidgets.snowUrl,short);
});
