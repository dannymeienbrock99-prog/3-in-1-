'use strict';
const {planKeyboardAction}=require('./keyboard-action.cjs');
const isKeyActionId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
function invalid(field,message){const error=new Error(message);error.field=field;error.code='INVALID_KEY_ACTION';return error;}
function normalizeKeyAction(item){
 if(!item||typeof item!=='object'||Array.isArray(item))throw invalid('','Hotkey-Profil muss ein Objekt sein.');
 if(!isKeyActionId(item.id))throw invalid('id','Eindeutige Hotkey-Profil-ID mit 1 bis 100 Zeichen erforderlich.');
 if(typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>100)throw invalid('name','Name mit 1 bis 100 Zeichen erforderlich.');
 if(typeof item.process!=='string'||!item.process.trim()||item.process.trim().replace(/\.exe$/i,'').length>100||! /^[\p{L}\p{N}_ .-]+$/u.test(item.process.trim().replace(/\.exe$/i,'')))throw invalid('process','Gültigen Zielprozess für das Hotkey-Profil eingeben.');
 if(typeof item.keys!=='string'||!item.keys.trim()||item.keys.length>2048)throw invalid('keys','Tastenkombination eingeben oder aufnehmen.');
 if(item.keyFormat!==undefined&&item.keyFormat!=='chord')throw invalid('keyFormat','Gespeicherte Hotkey-Profile verwenden Tastenkombinationen.');
 if(item.enabled!==undefined&&typeof item.enabled!=='boolean')throw invalid('enabled','Aktivierung des Hotkey-Profils ist ungültig.');
 if(item.holdMs!==undefined&&(typeof item.holdMs!=='number'||!Number.isInteger(item.holdMs)||item.holdMs<10||item.holdMs>3000))throw invalid('holdMs','Tastendauer: 10 bis 3000 Millisekunden.');
 let plan;try{plan=planKeyboardAction({...item,keyFormat:'chord'});}catch(error){throw invalid(error.field==='accelerator'?'keys':error.field||'keys',error.message);}
 return {id:item.id,name:item.name.trim(),process:plan.target,keys:plan.value,keyFormat:'chord',holdMs:plan.holdMs,enabled:item.enabled!==false};
}
function normalizeKeyActionPatch(items){
 if(!Array.isArray(items)||items.length>200){const error=invalid('','Maximal 200 gespeicherte Hotkey-Profile.');error.details=[{path:'keyActions',message:error.message}];throw error;}
 const ids=new Set();return items.map((item,index)=>{
  try{const profile=normalizeKeyAction(item);if(ids.has(profile.id))throw invalid('id','Hotkey-Profil-ID ist doppelt vergeben.');ids.add(profile.id);return profile;}
  catch(error){error.details=[{path:'keyActions.'+index+(error.field?'.'+error.field:''),message:error.message}];throw error;}
 });
}
function resolveKeyAction(config,id){
 if(!isKeyActionId(id))throw new Error('Ein gespeichertes Hotkey-Profil auswählen.');
 const profiles=Array.isArray(config?.keyActions)?config.keyActions:[],matches=profiles.filter(item=>item?.id===id);
 if(!matches.length)throw new Error('Das gespeicherte Hotkey-Profil fehlt. Bitte neu auswählen.');
 if(matches.length!==1)throw new Error('Hotkey-Profil-ID ist nicht eindeutig.');
 const profile=normalizeKeyAction(matches[0]);
 if(!profile.enabled)throw new Error('Hotkey-Profil „'+profile.name+'“ ist deaktiviert.');
 return profile;
}
module.exports={isKeyActionId,normalizeKeyAction,normalizeKeyActionPatch,resolveKeyAction};
