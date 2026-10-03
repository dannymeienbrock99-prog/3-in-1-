'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const BUILTINS=[{id:'fade',name:'Überblendung',type:'fade'},{id:'cut',name:'Schnitt',type:'cut'}];
const clean=value=>typeof value==='string'?value.trim():'';
const normal=value=>clean(value).normalize('NFKC').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss');
function localFile(value){return typeof value==='string'&&value.length<=2000&&!/[\x00-\x1f]/.test(value)&&!value.startsWith('\\\\')&&!value.startsWith('//')&&(/^[a-z]:[\\/]/i.test(value)||path.isAbsolute(value))&&/\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(value);}
function settings(value){
 const s=value||{};if(!localFile(s.path))throw Error('Für den Stinger ist eine lokale Videodatei erforderlich.');
 const out={path:s.path,preload:false,enable_monitoring:false,audio_monitoring:0};
 for(const [key,min,max,fallback]of [['transition_point',0,120000,0],['tp_type',0,1,0],['audio_fade_style',0,1,0],['track_matte_layout',0,3,0]]){const v=s[key]??fallback;if(!Number.isInteger(v)||v<min||v>max)throw Error('Ungültige Stinger-Einstellung: '+key);out[key]=v;}
 for(const [key,fallback]of [['hw_decode',true],['track_matte_enabled',false],['invert_matte',false]]){if(s[key]!==undefined&&typeof s[key]!=='boolean')throw Error('Ungültige Stinger-Einstellung: '+key);out[key]=s[key]??fallback;}
 if(out.track_matte_enabled&&out.track_matte_layout===2){if(!localFile(s.track_matte_path))throw Error('Die separate Stinger-Maskendatei fehlt.');out.track_matte_path=s.track_matte_path;}
 return out;
}
function validateTransitions(value){
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>50)throw Error('Höchstens 50 OBS-Übergänge können übernommen werden.');const ids=new Set();
 return value.map(item=>{if(!item||item.type!=='stinger'||!/^obs-transition:[a-zA-Z0-9_-]{1,100}$/.test(item.id)||ids.has(item.id)||!clean(item.name)||item.name.length>200||/[\x00-\x1f]/.test(item.name))throw Error('Ungültiger oder doppelter OBS-Übergang.');ids.add(item.id);return {id:item.id,name:clean(item.name),type:'stinger',settings:settings(item.settings)};});
}
function transitionChoices(config){return [...BUILTINS,...(config?.transitions||[]).map(({id,name,type})=>({id,name,type}))];}
function resolveTransition(config,value){
 const choices=transitionChoices(config),exact=choices.find(item=>item.id===value);if(exact)return exact.id;
 const needle=normal(value),aliases={fade:['ueberblenden','ueberblendung','fade'],cut:['schnitt','cut']};
 const matches=choices.filter(item=>normal(item.name)===needle||(aliases[item.id]||[]).includes(needle));
 if(matches.length===1)return matches[0].id;
 throw Error(matches.length?'Der Übergangsname ist mehrfach vorhanden. Bitte den Übergang eindeutig auswählen.':'Dieser Übergang ist nicht vorhanden. Bitte zuerst aus OBS importieren oder Überblendung / Schnitt wählen.');
}
function assertTransitionFiles(config,id,fileExists=fs.existsSync){const item=(config.transitions||[]).find(t=>t.id===id);if(!item)return;for(const file of [item.settings.path,item.settings.track_matte_path].filter(Boolean))if(!fileExists(file))throw Error('Die Videodatei für „'+item.name+'“ fehlt. Bitte die OBS-Übergänge mit dem aktuellen Dateipfad erneut importieren.');}
function importObsTransitions(data,{fileExists=fs.existsSync}={}){
 const warnings=[],transitions=[],records=data?.transitions??[];if(!Array.isArray(records)||records.length>50)throw Error('Die OBS-Übergangsliste ist ungültig oder zu groß.');
 for(const item of records){const name=clean(item?.name).slice(0,200)||'OBS-Übergang';if(['fade_transition','cut_transition'].includes(item?.id))continue;
  if(item?.id!=='obs_stinger_transition'){warnings.push('„'+name+'“: Dieser OBS-Übergangstyp wird noch nicht unterstützt.');continue;}
  try{const id='obs-transition:'+crypto.createHash('sha256').update(name+'\0'+item.id).digest('hex').slice(0,20),transition=validateTransitions([{id,name,type:'stinger',settings:item.settings}])[0];assertTransitionFiles({transitions:[transition]},id,fileExists);if(transitions.some(t=>t.id===id))throw Error('Der Übergangsname ist doppelt vorhanden.');transitions.push(transition);}
  catch(error){warnings.push('„'+name+'“: '+error.message);}
 }
 let selectedTransition=null;
 if(data?.current_transition){try{selectedTransition=resolveTransition({transitions},data.current_transition);}catch{const record=records.find(t=>t?.name===data.current_transition);if(record?.id==='fade_transition')selectedTransition='fade';else if(record?.id==='cut_transition')selectedTransition='cut';else warnings.push('Der in OBS ausgewählte Übergang konnte nicht übernommen werden.');}}
 const durationMs=Number.isInteger(data?.transition_duration)?Math.max(100,Math.min(2000,data.transition_duration)):350;
 return {transitions,transitionWarnings:[...new Set(warnings)],selectedTransition,durationMs};
}
module.exports={validateTransitions,transitionChoices,resolveTransition,assertTransitionFiles,importObsTransitions};
