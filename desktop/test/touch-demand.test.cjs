'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TouchDemand}=require('../src/services/touch-demand.cjs');
const plugin=(id,pluginId='test.plugin')=>({id,type:'plugin',pluginId,actionId:pluginId+'.action'});
function config(){return {profiles:[{id:'main',columns:3,buttons:[plugin('main-one'),null,{id:'folder',type:'folder',buttons:[null,plugin('nested','nested.plugin')]}]},{id:'second',columns:2,buttons:[plugin('second-one','second.plugin')]},{id:'empty',columns:2,buttons:[{id:'native',type:'action',steps:[]},null]}]};}
function fixture(t,options={}){
 let current=config(),changes=0,time=1000;const calls=[],requests=[];let active=null;
 const host={async sync(buttons){calls.push(structuredClone(buttons));}};
 const demand=new TouchDemand({getConfig:()=>current,getHost:create=>{requests.push(create);if(create)active=host;return active;},changed:()=>changes++,now:()=>time,...options});
 t.after(()=>demand.close());return {demand,host,calls,requests,setConfig:value=>current=value,advance:ms=>time+=ms,get changes(){return changes;}};
}
test('Nur angefragte Profile starten Plugins; leere und unsichtbare Decks bleiben ohne Laufzeit',async t=>{
 const f=fixture(t);await f.demand.sync();assert.equal(f.requests[0],false);assert.equal(f.calls.length,0);
 await f.demand.set('desktop','empty');assert.equal(f.calls.length,0);
 await f.demand.set('desktop','main');assert.deepEqual(f.calls.at(-1).map(b=>b.id),['main-one','nested']);assert.deepEqual(f.calls.at(-1)[1].coordinates,{column:1,row:0});
 await f.demand.remove('desktop');assert.deepEqual(f.calls.at(-1),[]);
});
test('Drei-Sekunden-Polling verlängert die 15-Sekunden-Lease ohne Plugin- oder Bild-Updates',async t=>{
 const f=fixture(t);await f.demand.set('phone','main',{temporary:true});const changes=f.changes;
 for(let i=0;i<6;i++){f.advance(3000);await f.demand.set('phone','main',{temporary:true});}
 assert.equal(f.calls.length,1);assert.equal(f.changes,changes);
 f.advance(14999);await f.demand.sync();assert.equal(f.calls.length,1);
 f.advance(1);await f.demand.sync();assert.deepEqual(f.calls.at(-1),[]);assert.equal(f.demand.consumers.size,0);
});
test('Mehrere Geräte teilen Zuweisungen; ein abgelaufenes Handy stoppt kein sichtbares Desktop-Profil',async t=>{
 const f=fixture(t);await f.demand.set('desktop','main');await f.demand.set('phone','main',{temporary:true});assert.equal(f.calls.length,1);
 await f.demand.set('tablet','second',{temporary:true});assert.deepEqual(f.calls.at(-1).map(b=>b.id),['main-one','nested','second-one']);
 f.advance(15000);await f.demand.sync();assert.deepEqual(f.calls.at(-1).map(b=>b.id),['main-one','nested']);assert.equal(f.demand.consumers.size,1);
 await f.demand.remove('desktop');assert.deepEqual(f.calls.at(-1),[]);
});
test('Inspector hält genau seine Taste; kurzer Tastendruck benötigt kein sichtbares Profil',async t=>{
 const f=fixture(t);await f.demand.set('inspector','',{buttonId:'nested'});assert.deepEqual(f.calls.at(-1).map(b=>b.id),['nested']);
 await f.demand.set('press','second',{buttonId:'second-one',temporary:true});assert.deepEqual(f.calls.at(-1).map(b=>b.id),['nested','second-one']);
 await f.demand.remove('press');assert.deepEqual(f.calls.at(-1).map(b=>b.id),['nested']);f.advance(60000);await f.demand.sync();assert.deepEqual(f.calls.at(-1).map(b=>b.id),['nested']);
 await f.demand.remove('inspector');assert.deepEqual(f.calls.at(-1),[]);
});
test('Geänderte Aktion, Koordinaten und gelöschte Profile werden trotz Signaturvergleich synchronisiert',async t=>{
 const f=fixture(t);await f.demand.set('desktop','main');let next=config();next.profiles[0].buttons[0].actionId='test.plugin.other';f.setConfig(next);await f.demand.sync();assert.equal(f.calls.at(-1)[0].actionId,'test.plugin.other');
 next=structuredClone(next);next.profiles[0].buttons=[null,next.profiles[0].buttons[0],next.profiles[0].buttons[2]];f.setConfig(next);await f.demand.sync();assert.deepEqual(f.calls.at(-1)[0].coordinates,{column:1,row:0});
 f.setConfig({profiles:config().profiles.filter(p=>p.id!=='main')});await f.demand.sync();assert.deepEqual(f.calls.at(-1),[]);
});
test('Erneuter Import kann gleiche Tasten ausdrücklich synchronisieren; ersetzter Host wird initialisiert',async t=>{
 let host;const calls=[],create=()=>({async sync(buttons){calls.push(structuredClone(buttons));}});host=create();const f=fixture(t,{getHost:()=>host});
 await f.demand.set('desktop','main');await f.demand.sync();assert.equal(calls.length,1);await f.demand.sync({force:true});assert.equal(calls.length,2);
 host=create();await f.demand.sync();assert.equal(calls.length,3);
});
test('Fehlerhafte Synchronisation kann wiederholt werden und blockiert spätere Stopps nicht',async t=>{
 let attempts=0;const calls=[],host={async sync(buttons){calls.push(buttons);if(++attempts===1)throw Error('temporär');}};const f=fixture(t,{getHost:()=>host});
 await assert.rejects(f.demand.set('desktop','main'),/temporär/);await f.demand.sync();assert.equal(attempts,2);await f.demand.remove('desktop');assert.deepEqual(calls.at(-1),[]);
});
test('Schnelle Sichtbarkeitswechsel werden zusammengefasst; ein laufender Start endet vor dem finalen Stopp',async t=>{
 let release;const started=new Promise(resolve=>{release=resolve;}),calls=[];let first=true;
 const host={async sync(buttons){calls.push(structuredClone(buttons));if(first){first=false;await started;}}},f=fixture(t,{getHost:()=>host});
 const pending=f.demand.set('desktop','main');await Promise.resolve();assert.equal(calls.length,1);
 const hide=f.demand.remove('desktop'),show=f.demand.set('desktop','second'),closed=f.demand.close();release();await Promise.all([pending,hide,show,closed]);
 assert.deepEqual(calls.map(buttons=>buttons.map(b=>b.id)),[['main-one','nested'],[]]);assert.equal(f.demand.timer,null);assert.equal(f.demand.consumers.size,0);
 await f.demand.set('later','main');assert.equal(calls.length,2);
});
test('Lease-Timer beendet unbenutzte Plugins auch ohne weitere Abfragen',async t=>{
 const calls=[],host={async sync(buttons){calls.push(buttons);}},demand=new TouchDemand({getConfig:config,getHost:()=>host,leaseMs:25});t.after(()=>demand.close());
 await demand.set('phone','second',{temporary:true});await new Promise(resolve=>setTimeout(resolve,60));await demand.queue;assert.deepEqual(calls.map(buttons=>buttons.map(b=>b.id)),[['second-one'],[]]);assert.equal(demand.timer,null);
});
