'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseAccelerator}=require('../src/core/input-hotkeys.cjs');
const {normalizeHotkeyPatch}=require('../src/core/settings/action-schema.cjs');
const {ConfigStore}=require('../src/core/config-store.cjs');
const {SettingsService}=require('../src/core/settings/settings-service.cjs');
const fixture={id:'saved-mouse',name:'Test',accelerator:'LButton',enabled:true,scope:'global',triggerMode:'down',stopAll:true};
for(const text of ['LButton','RButton','MButton','XButton1','XButton2','K+RButton','A+B','Control+LButton','Shift+WheelUp'])assert.ok(parseAccelerator(text).keys.length);
for(const text of ['', '  ', '+', '++'])assert.throws(()=>parseAccelerator(text),/Kombination ist leer/);
for(const text of ['Control','Shift','Strg+Alt','Control+Alt+Shift'])assert.throws(()=>parseAccelerator(text),/nur Zusatztasten/);
for(const text of ['A+constructor','A+__proto__'])assert.throws(()=>parseAccelerator(text),/Taste nicht erkannt/);
for(const field of ['scope','triggerMode']){
 assert.throws(()=>normalizeHotkeyPatch([{...fixture,[field]:'invalid'}],[fixture]),error=>error.details[0].path==='hotkeys.0.'+field);
}
const oldInvalid={...fixture,id:'legacy',accelerator:'Control',enabled:false};
assert.equal(normalizeHotkeyPatch([{...oldInvalid,name:'Renamed'}],[oldInvalid])[0].name,'Renamed');
assert.throws(()=>normalizeHotkeyPatch([{...oldInvalid,enabled:true}],[oldInvalid]),/nur Zusatztasten/);
assert.throws(()=>normalizeHotkeyPatch([{...oldInvalid,triggerMode:'invalid'}],[oldInvalid]),/nur Zusatztasten/);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'batto-hotkey-save-'));
try{
 const store=new ConfigStore(temporary),service=new SettingsService({configStore:store});
 assert.equal(service.savePatch({hotkeys:[fixture]}).ok,true);
 const persisted=fs.readFileSync(store.file,'utf8');
 for(const accelerator of ['', 'Control+Alt']){
  const result=service.savePatch({hotkeys:[...store.get().hotkeys,{id:'new-key',name:'Neue Belegung',accelerator,enabled:true,stopAll:true}]});
  assert.equal(result.ok,false);assert.equal(result.validation.errors[0].path,'hotkeys.1.accelerator');assert.match(result.validation.errors[0].message,/Neue Belegung/);
  assert.equal(fs.readFileSync(store.file,'utf8'),persisted);assert.deepEqual(service.pending,{});
 }
 const result=service.savePatch({hotkeys:[{...store.get().hotkeys[0],scope:'invalid'}]});assert.equal(result.ok,false);assert.equal(result.validation.errors[0].path,'hotkeys.0.scope');
 assert.equal(service.savePatch({community:{archive:{enabled:true}}}).ok,true);assert.equal(store.get().hotkeys[0].accelerator,'LButton');
 assert.equal(service.savePatch({hotkeys:[{...fixture,accelerator:'RButton+K'}]}).ok,true);
 assert.equal(new ConfigStore(temporary).get().hotkeys[0].accelerator,'K+RButton');
 console.log('PASS hotkey save: installed LButton shape, empty/modifier-only field errors, all mouse/chord tokens, rejected invalid edits, unchanged legacy preservation and isolated saves. No live input.');
}finally{
 const resolved=path.resolve(temporary);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('batto-hotkey-save-'));fs.rmSync(resolved,{recursive:true,force:true});
}
