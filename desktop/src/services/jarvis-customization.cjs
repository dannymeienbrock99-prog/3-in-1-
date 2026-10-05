'use strict';
const crypto=require('node:crypto');
const {normalizeCommand}=require('./jarvis-commands.cjs');
const RESERVED=/^(?:stopp?|ruhe|sei still|schweigen|sei ruhig|hor auf zu sprechen|sprich nicht weiter|abbrechen|nicht bestatigen|nein abbrechen|bestatigen|bestatige|ja bestatigen|ja bestatige|hilfe|welche befehle kannst du)$/;
const DEFAULT_PRONUNCIATION=[{word:'Crazy_Batto',spoken:'Kräisi Batto'},{word:'CNG',spoken:'Ce En Ge'},{word:'Lian Li',spoken:'Li An Li'}];
const cleanText=(value,max)=>typeof value==='string'?value.replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,max):'';
function cleanCustomization(input={}){
 input=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const aliases=Array.isArray(input.aliases)?input.aliases.slice(0,200).flatMap(item=>{
  const phrase=cleanText(item?.phrase,200),target=cleanText(item?.target,500);
  return phrase&&target&&!RESERVED.test(normalizeCommand(phrase))?[{id:/^[\w-]{1,80}$/.test(item.id||'')?item.id:crypto.randomUUID(),phrase,target,enabled:item.enabled!==false}]:[];
 }):[];
 return {aliases,disabled:Array.isArray(input.disabled)?[...new Set(input.disabled.filter(id=>/^cmd_[a-f0-9]{24}$/.test(id)))].slice(0,2000):[],confirmation:['off','external','always'].includes(input.confirmation)?input.confirmation:'off'};
}
function cleanVoice(input={}){
 input=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const dictionary=Array.isArray(input.dictionary)?input.dictionary.slice(0,100).flatMap(item=>{
  const word=cleanText(item?.word,80),spoken=cleanText(item?.spoken,160);return word&&spoken?[{word,spoken}]:[];
 }):DEFAULT_PRONUNCIATION.map(item=>({...item}));
 return {style:['natural','controlled','synthetic'].includes(input.style)?input.style:'synthetic',pauseMs:typeof input.pauseMs==='number'&&Number.isFinite(input.pauseMs)?Math.round(Math.max(0,Math.min(1500,input.pauseMs))):180,dictionary};
}
function identity(intent,phrase=''){
 const shape=intent?.kind==='action'?{kind:intent.kind,action:intent.action}:intent?.kind==='audio'?{kind:intent.kind,targetQuery:intent.targetQuery,patch:intent.patch,delta:intent.delta}:intent?.kind==='sensor'?{kind:'sensor',phrase:normalizeCommand(phrase)}:intent?{kind:intent.kind,phrase:normalizeCommand(phrase)}:{phrase:normalizeCommand(phrase)};
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
 return 'cmd_'+crypto.createHash('sha256').update(JSON.stringify(canonical(shape))).digest('hex').slice(0,24);
}
function decorateExamples(examples,settings){return examples.map(entry=>{
 const intent=entry.expectedKind==='action'?{kind:'action',action:entry.expectedAction}:entry.expectedIntent||{kind:entry.expectedKind};
 const id=identity(intent,entry.phrase),protectedCommand=RESERVED.test(normalizeCommand(entry.phrase))||['confirmation','cancel-confirmation','help'].includes(entry.expectedKind)||['cancel','speech-stop'].includes(entry.expectedAction?.action);
 return {...entry,id,protected:protectedCommand,enabled:protectedCommand||!settings.disabled.includes(id)};
});}
function mapAlias(original,examples,settings){
 const query=normalizeCommand(original),matches=settings.aliases.filter(item=>item.enabled&&normalizeCommand(item.phrase)===query);
 if(RESERVED.test(query)||!matches.length)return {text:original};
 const targets=[...new Set(matches.map(item=>normalizeCommand(item.target)))];
 if(targets.length!==1)return {error:'Dieser eigene Ausdruck ist mehreren Befehlen zugeordnet. Wähle in der Befehlsverwaltung eine eindeutige Zuordnung.'};
 const available=examples.filter(entry=>!entry.template&&normalizeCommand(entry.phrase)===targets[0]);
 if(available.length!==1)return {error:'Der zugeordnete Befehl ist nicht mehr eindeutig verfügbar. Bitte den eigenen Ausdruck neu zuordnen.'};
 if(!available[0].enabled)return {error:'Dieser Befehl ist in deiner Befehlsverwaltung ausgeschaltet.'};
 const builtin=examples.find(entry=>!entry.template&&normalizeCommand(entry.phrase)===query);
 if(builtin&&builtin.id!==available[0].id)return {error:'Dieser Ausdruck bezeichnet bereits einen anderen Befehl. Wähle einen eigenen, eindeutigen Ausdruck.'};
 return {text:available[0].phrase};
}
function needsConfirmation(intent,settings){
 if(intent?.kind==='audio')return settings.confirmation==='always';
 if(intent?.kind!=='action'||['cancel','speech-stop','listen','navigate','jarvis-settings','rgb-status','show','microphones'].includes(intent.action.action))return false;
 if(settings.confirmation==='always')return true;
 return settings.confirmation==='external'&&(['broadcast','chain','event','hotkey','start','stop','connect','broadcast-profile'].includes(intent.action.action)||intent.action.action==='control'&&['broadcast.master','chatbot.enabled','bot.enabled','bot'].includes(intent.action.target));
}
module.exports={cleanCustomization,cleanVoice,decorateExamples,mapAlias,identity,needsConfirmation,RESERVED,DEFAULT_PRONUNCIATION};
