'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {ConfigStore}=require('../src/core/config-store.cjs');
const {SettingsService}=require('../src/core/settings/settings-service.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'batto-settings-isolation-'));
const invalid={hotkeys:[{id:'bad-input',name:'K und rechte Maustaste',enabled:true,accelerator:'Control+UnknownKey',stopAll:true}]};
try{
 const store=new ConfigStore(root),service=new SettingsService({configStore:store});
 const before=fs.readFileSync(store.file,'utf8');
 const rejected=service.savePatch(invalid);
 assert.equal(rejected.ok,false);assert.match(rejected.validation.errors[0].message,/Taste nicht erkannt/);
 assert.equal(fs.readFileSync(store.file,'utf8'),before);
 assert.deepEqual(service.pending,{});assert.equal(service.isDirty(),false);
 assert.equal(service.savePatch({platforms:{twitch:{channel:'crazy_batto'}}}).ok,true);
 assert.equal(service.savePatch({community:{archive:{enabled:true}}}).ok,true);
 assert.equal(store.get().community.archive.enabled,true);assert.deepEqual(store.get().hotkeys,[]);
 // Reproduce the failed draft from older versions; independent module saves recover
 // without silently applying or throwing away that editable draft.
 service.patch(invalid);
 assert.equal(service.apply().ok,false);
 assert.equal(service.savePatch({community:{archive:{enabled:false}}}).ok,true);
 assert.deepEqual(store.get().hotkeys,[]);assert.equal(service.getDraft().hotkeys[0].accelerator,'Control+UnknownKey');
 assert.equal(service.isDirty(),true);
 // Correcting this module replaces its bad draft; aliases still normalize normally.
 assert.equal(service.savePatch({hotkeys:[{id:'valid-input',name:'Maus',enabled:true,accelerator:'strg+Mouse5',stopAll:true}]}).ok,true);
 assert.equal(store.get().hotkeys[0].accelerator,'Control+XButton2');assert.equal(service.isDirty(),false);
 // Unrelated draft changes inside a saved section remain a draft, not a hidden save.
 service.patch({general:{displayName:'Nicht gespeichert',startView:'events'}});
 assert.equal(service.savePatch({general:{startView:'chatarchive'}}).ok,true);
 assert.notEqual(store.get().general.displayName,'Nicht gespeichert');
 assert.equal(service.getDraft().general.displayName,'Nicht gespeichert');
 assert.equal(service.getDraft().general.startView,'chatarchive');
 const pending=structuredClone(service.pending),persisted=store.get(),write=store.atomicWrite;
 store.atomicWrite=()=>{throw new Error('Datenträger-Testfehler');};
 assert.equal(service.savePatch({general:{displayName:'Scheitert'}}).ok,false);
 assert.deepEqual(service.pending,pending);assert.deepEqual(store.get(),persisted);
 store.atomicWrite=write;
 const reopened=new ConfigStore(root);
 assert.equal(reopened.get().hotkeys[0].accelerator,'Control+XButton2');
 assert.equal(reopened.get().general.startView,'chatarchive');
 assert.notEqual(reopened.get().general.displayName,'Nicht gespeichert');
 console.log('PASS Settings save isolation: invalid hotkey -> Twitch/archive saves, failed legacy draft, correction, nested draft rebase, disk failure rollback, persisted restart.');
}finally{
 const resolved=path.resolve(root),tmp=path.resolve(os.tmpdir())+path.sep;
 assert.ok(resolved.startsWith(tmp)&&path.basename(resolved).startsWith('batto-settings-isolation-'));
 fs.rmSync(resolved,{recursive:true,force:true});
}
