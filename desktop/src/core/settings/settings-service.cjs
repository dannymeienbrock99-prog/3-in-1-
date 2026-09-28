'use strict';
const { EventEmitter } = require('events');
const { deepMerge, DEFAULT_CONFIG } = require('../config-store.cjs');
const { validateConfig } = require('./schema.cjs');
function failedSave(error) {
  return {ok:false,validation:{ok:false,errors:error.details?.length?error.details:[{path:'settings',message:error.message||String(error)}]}};
}
function removeSavedPaths(pending, patch) {
  const remaining=structuredClone(pending);
  for(const [key,value] of Object.entries(patch)){
    if(!(key in remaining))continue;
    if(value&&typeof value==='object'&&!Array.isArray(value)&&remaining[key]&&typeof remaining[key]==='object'&&!Array.isArray(remaining[key])){
      remaining[key]=removeSavedPaths(remaining[key],value);
      if(Object.keys(remaining[key]).length===0)delete remaining[key];
    } else delete remaining[key];
  }
  return remaining;
}
class SettingsService extends EventEmitter {
  constructor({configStore}={}) {super();if(!configStore)throw new Error('SettingsService benötigt ConfigStore.');this.configStore=configStore;this.pending={};this.draft=configStore.get();this.dirty=false;}
  getPersisted(){return this.configStore.get();}
  getDraft(){this.draft=deepMerge(this.configStore.get(),this.pending);return structuredClone(this.draft);}
  isDirty(){return this.dirty;}
  syncIfClean(){if(!this.dirty)this.draft=this.configStore.get();}
  patch(patch={}){this.pending=deepMerge(this.pending,patch);const config=this.getDraft();this.dirty=JSON.stringify(config)!==JSON.stringify(this.configStore.get());const validation=validateConfig(config);this.emit('draft',{config,dirty:this.dirty,validation});return{config,dirty:this.dirty,validation};}
  apply(){const validation=validateConfig(this.getDraft());if(!validation.ok)return{ok:false,validation};let persisted;try{persisted=this.configStore.merge(this.pending);}catch(error){return failedSave(error);}this.pending={};this.draft=persisted;this.dirty=false;this.emit('applied',persisted);return{ok:true,config:structuredClone(persisted)};}
  // Direct module saves are independent of the explicit Settings draft. Validate and
  // commit before changing pending state, so a rejected hotkey cannot poison later saves.
  savePatch(patch={}){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))return failedSave(new Error('Einstellungen müssen ein Objekt sein.'));
    let persisted;
    try{persisted=this.configStore.merge(patch);}catch(error){return failedSave(error);}
    this.pending=removeSavedPaths(this.pending,patch);
    this.draft=deepMerge(persisted,this.pending);
    this.dirty=JSON.stringify(this.draft)!==JSON.stringify(persisted);
    this.emit('applied',persisted);
    return{ok:true,config:structuredClone(persisted)};
  }
  discard(){this.pending={};this.draft=this.configStore.get();this.dirty=false;this.emit('discarded',this.getDraft());return{ok:true,config:this.getDraft()};}
  resetSection(section){if(!(section in DEFAULT_CONFIG))return{ok:false,error:'Unbekannter Bereich.'};const result=this.patch({[section]:structuredClone(DEFAULT_CONFIG[section])});return{ok:result.validation.ok,...result};}
  test(section){const validation=validateConfig(this.getDraft());const errors=validation.errors.filter(x=>x.path===section||x.path.startsWith(section+'.'));return{ok:errors.length===0,errors};}
}
module.exports={SettingsService};
