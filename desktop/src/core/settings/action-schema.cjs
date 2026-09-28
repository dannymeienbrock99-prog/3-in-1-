'use strict';
const {normalizeHotkey}=require('../input-hotkeys.cjs');
const issue=(path,message)=>({path,message});
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
function validateActions(c){
 const errors=[];
 const {normalizeKeyActionPatch,isKeyActionId}=require('../key-action-profiles.cjs');
 let keyProfiles=[];try{keyProfiles=normalizeKeyActionPatch(c.keyActions===undefined?[]:c.keyActions);}catch(error){errors.push(...(error.details||[issue('keyActions',error.message)]));}
 for(const section of ['actionChains','commands','events'])for(const [i,rule] of (c[section]||[]).entries()){
  const base=section+'.'+i;
  if(section==='actionChains'){
   if(rule.failurePolicy!==undefined&&!['stop-sequence','continue'].includes(rule.failurePolicy))errors.push(issue(base+'.failurePolicy','Bei Fehler abbrechen oder fortsetzen wählen.'));
   if(rule.timeoutMs!==undefined&&!finite(rule.timeoutMs,250,60000))errors.push(issue(base+'.timeoutMs','Maximale Wartezeit: 250 bis 60000 ms.'));
  }
  for(const [j,a] of (rule.actions||[]).entries()){
   const p=base+'.actions.'+j;
   if(!a||typeof a!=='object'||Array.isArray(a)){errors.push(issue(p,'Aktionsschritt muss ein Objekt sein.'));continue;}
   if(a.enabled!==undefined&&typeof a.enabled!=='boolean')errors.push(issue(p+'.enabled','Aktivierung ist ungültig.'));
   if(a.timeoutMs!==undefined&&!finite(a.timeoutMs,250,60000))errors.push(issue(p+'.timeoutMs','Maximale Wartezeit: 250 bis 60000 ms.'));
   if(a.failurePolicy&&!['stop-sequence','continue'].includes(a.failurePolicy))errors.push(issue(p+'.failurePolicy','Abbrechen oder fortsetzen wählen.'));
   if(a.type==='delay'&&a.ms!==undefined&&!finite(a.ms,0,60000))errors.push(issue(p+'.ms','Wartezeit: 0 bis 60000 ms.'));
   if(String(a.type||'').toLowerCase()==='key-action'){if(!isKeyActionId(a.keyActionId))errors.push(issue(p+'.keyActionId','Ein gespeichertes Hotkey-Profil auswählen.'));else if(!keyProfiles.some(profile=>profile.id===a.keyActionId))errors.push(issue(p+'.keyActionId','Das gespeicherte Hotkey-Profil fehlt. Bitte neu auswählen.'));}
   if(a.type==='hotkey'){try{require('../keyboard-action.cjs').planKeyboardAction(a);}catch(error){errors.push(issue(p+'.keys',error.message));}}
   if(a.type==='streamerbot'){
    if(typeof a.actionId!=='string'||!a.actionId.trim()||a.actionId.length>100)errors.push(issue(p+'.actionId','Streamer.bot-Aktion auswählen.'));
    if(a.waitForCompletion!==undefined&&typeof a.waitForCompletion!=='boolean')errors.push(issue(p+'.waitForCompletion','Abschlussbestätigung ist ungültig.'));
    if(a.args!==undefined){if(!a.args||Array.isArray(a.args)||typeof a.args!=='object'||Object.keys(a.args).length>100||JSON.stringify(a.args).length>32000)errors.push(issue(p+'.args','Argumente müssen ein JSON-Objekt mit maximal 100 Einträgen sein.'));}
   }
   if(a.type==='chat-widget'){
    if(!['widget','wishlist'].includes(a.kind))errors.push(issue(p+'.kind','Widget oder Wunschgeschenke wählen.'));
    if(a.kind==='widget'&&(typeof a.widgetId!=='string'||!a.widgetId.trim()||a.widgetId.length>100))errors.push(issue(p+'.widgetId','Widget auswählen.'));
    if(a.visible!==undefined&&typeof a.visible!=='boolean')errors.push(issue(p+'.visible','Sichtbarkeit ist ungültig.'));
    if(a.durationMs!==undefined&&!finite(a.durationMs,0,120000))errors.push(issue(p+'.durationMs','Dauer: 0 bis 120000 ms.'));
   }
  }
 }
 const ids=new Set((c.actionChains||[]).map(x=>x.id));
 for(const [i,b] of (c.autoBroadcast?.items||[]).entries())if(b.chainId&&!ids.has(b.chainId))errors.push(issue('autoBroadcast.items.'+i+'.chainId','Zugeordnete Aktionskette fehlt.'));
 return errors;
}
function hotkeyError(error,index,item,field=error.field||'accelerator'){
 const name=String(item?.name||'').trim().slice(0,100);
 const result=new Error((name?'Hotkey „'+name+'“: ':'Hotkey '+(index+1)+': ')+error.message);
 result.details=[issue('hotkeys.'+index+'.'+field,result.message)];return result;
}
function unchangedInvalidHotkey(item,old){
 if(!old)return false;
 // Preserve an unchanged legacy record in a larger save, never swallow a new
 // validation failure merely because its key text and enabled state match.
 const fields=['accelerator','enabled','scope','triggerMode','passthrough','debounceMs','chainId','stopAll'];
 if(fields.some(key=>item[key]!==old[key]))return false;
 try{normalizeHotkey(old);return false;}catch{return true;}
}
function normalizeHotkeyPatch(items,previous=[]){
 if(!Array.isArray(items)||items.length>200){const error=new Error('Maximal 200 Eingabe-Hotkeys.');error.details=[issue('hotkeys',error.message)];throw error;}
 const ids=new Set(),combinations=new Set();
 return items.map((item,index)=>{
  if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id))throw hotkeyError(new Error('Hotkey-ID fehlt oder ist doppelt.'),index,item,'id');ids.add(item.id);
  let normalized;
  try{normalized=normalizeHotkey(item);}catch(error){if(unchangedInvalidHotkey(item,previous.find(x=>x.id===item.id)))return item;throw hotkeyError(error,index,item);}
  const signature=normalized.scope+':'+normalized.accelerator.toLowerCase();
  if(item.enabled!==false){if(combinations.has(signature))throw hotkeyError(new Error('Tastenkombination im gleichen Geltungsbereich doppelt vergeben.'),index,item);combinations.add(signature);}
  const {key,keys,modifierMask,modifiers,wheel,...persistent}=normalized;return persistent;
 });
}
module.exports={validateActions,normalizeHotkeyPatch};
