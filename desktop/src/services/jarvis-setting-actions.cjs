'use strict';

// A finite parameter contract shared by the local parser and execution layer.
// These are voice actions, not arbitrary settings paths supplied by a transcript.
const SETTING_SPECS = Object.freeze({
  chatMode: {name:'Chat-Auswahl', values:['all','moderators','allowlist'], labels:{all:'alle Chatnachrichten',moderators:'nur Moderatoren',allowlist:'nur freigegebene Personen'}},
  chatSource: {name:'Chat-Quelle', values:['window','connected'], labels:{window:'Chatfenster',connected:'verbundene Chats'}},
  'events.likeThreshold': {name:'Like-Schwelle', min:1, max:100000000, unit:'Likes'},
  'events.giftAnnouncement': {name:'Geschenk-Ansage', values:['gift','coins','both'], labels:{gift:'Geschenkname',coins:'Coins',both:'Geschenkname und Coins'}},
  'events.giftMinimum': {name:'Geschenk-Mindestwert', min:0, max:100000000, unit:'Coins'},
  'events.cooldown': {name:'Abstand zwischen Ereignis-Ansagen', min:2, max:120, unit:'Sekunden'},
  speechRate: {name:'Sprechtempo', min:120, max:210, unit:'Wörter pro Minute', relative:true},
  chatCooldown: {name:'Abstand zwischen Chatnachrichten', min:2, max:60, unit:'Sekunden'},
  chatMaxLength: {name:'Chat-Länge', min:40, max:500, unit:'Zeichen'},
  'fanAlerts.threshold': {name:'Lüfterwarnung', min:1, max:100, unit:'Prozent'},
  'fanAlerts.cooldown': {name:'Abstand zwischen Lüfterwarnungen', min:10, max:3600, unit:'Sekunden'}
});
function validateSetting(action) {
  const spec=Object.hasOwn(SETTING_SPECS,action.target||'')&&SETTING_SPECS[action.target];
  if(!spec)throw Error('Unbekannte Jarvis-Einstellung.');
  if(action.delta!==undefined){
    if(!spec.relative||action.value!==undefined||!Number.isInteger(action.delta)||![-10,10].includes(action.delta))throw Error('Ungültige Änderung des Sprechtempos.');
  }else if(spec.values){
    if(!spec.values.includes(action.value))throw Error('Ungültige Auswahl für '+spec.name+'.');
  }else if(!Number.isInteger(action.value)||action.value<spec.min||action.value>spec.max)throw Error(`${spec.name}: Erlaubt sind ${spec.min} bis ${spec.max} ${spec.unit}.`);
  return spec;
}
function applySetting(jarvis,action){
  const spec=validateSetting(action),[key,sub]=action.target.split('.');
  const current=sub?jarvis.settings[key]?.[sub]:jarvis.settings[key];
  const value=action.delta===undefined?action.value:Math.max(spec.min,Math.min(spec.max,current+action.delta));
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('Der aktuelle Wert ist nicht verfügbar.');
  const patch=sub?{[key]:{...jarvis.settings[key],[sub]:value}}:{[key]:value};
  if(key==='chatMode'||key==='chatSource')patch.chatEnabled=true;
  jarvis.update(patch);
  let text=`${spec.name}: ${spec.labels?.[value]||value}${spec.unit?' '+spec.unit:''}.`;
  if(key==='chatMode')text+=' Vorlesen ist eingeschaltet; die gewählten Plattformen bleiben erhalten.';
  if(key==='chatSource')text+=' Vorlesen ist eingeschaltet.';
  if(key==='events'&&jarvis.settings.events.enabled===false)text+=' Ereignis-Ansagen sind derzeit ausgeschaltet.';
  else if(action.target==='events.likeThreshold'&&!jarvis.settings.events.likes)text+=' Like-Ansagen sind derzeit ausgeschaltet.';
  else if(['events.giftAnnouncement','events.giftMinimum'].includes(action.target)&&!jarvis.settings.events.gifts)text+=' Geschenk-Ansagen sind derzeit ausgeschaltet.';
  if(key==='fanAlerts'&&!jarvis.settings.fanAlerts.enabled)text+=' Lüfterwarnungen sind derzeit ausgeschaltet.';
  return {ok:true,text};
}
module.exports={SETTING_SPECS,validateSetting,applySetting};
