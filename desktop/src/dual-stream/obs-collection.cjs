'use strict';

// Persist only source data that the built-in renderer understands. An OBS export
// may also contain scripts, browser credentials, output keys and plugin settings.
// Those are deliberately not part of this format.
const PLATFORMS=['tiktok','twitch'],DEFAULT_SCENES=['Spiel','Start','Pause','Ende'];
const SOURCE_TYPES=new Set(['image_source','ffmpeg_source','text_gdiplus','text_ft2_source','color_source','dshow_input','game_capture','window_capture','monitor_capture','display_capture','unsupported']);
const MEDIA=/\.(?:png|jpe?g|webp|bmp|gif|mp4|mkv|mov|webm|avi|m4v)$/i;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function string(v,max=300){if(typeof v!=='string'||v.length>max||/[\x00-\x1f]/.test(v))throw Error('Ungültiger Text in der OBS-Sammlung.');return v;}
function number(v,fallback,min=-1000000,max=1000000){if(v===undefined)return fallback;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('Ungültige OBS-Position oder Größe.');return v;}
function localFile(v){return typeof v==='string'&&v.length<=2000&&!/[\x00-\x1f]/.test(v)&&!v.startsWith('\\\\')&&!v.startsWith('//')&&(/^[a-z]:[\\/]/i.test(v)||v.startsWith('/'))&&MEDIA.test(v)?v:'';}
function sourceSettings(type,input){
 const s=object(input)?input:{},out={};
 const strings=(keys,max=2000)=>{for(const k of keys)if(typeof s[k]==='string'&&s[k].length<=max&&!/[\x00-\x1f]/.test(s[k]))out[k]=s[k];};
 const numbers=(keys,min=0,max=1000000)=>{for(const k of keys)if(typeof s[k]==='number'&&Number.isFinite(s[k])&&s[k]>=min&&s[k]<=max)out[k]=s[k];};
 const booleans=keys=>{for(const k of keys)if(typeof s[k]==='boolean')out[k]=s[k];};
 if(type==='image_source'){const file=localFile(s.file);if(file)out.file=file;}
 if(type==='ffmpeg_source'){
  const file=localFile(s.local_file);if(file)out.local_file=file;
  booleans(['looping','restart_on_activate','close_when_inactive','hw_decode']);numbers(['speed_percent'],25,400);
  out.is_local_file=true;out.close_when_inactive=true;
 }
 if(type==='dshow_input'){
  strings(['video_device_id','resolution']);numbers(['res_type','video_format','frame_interval','color_space','color_range','buffering']);numbers(['width','height'],1,16384);
  if(/27b05c2d-93dc-474a-a5da-9bba34cb2a9[cd]/i.test(out.video_device_id||''))delete out.video_device_id;
 }
 if(['game_capture','window_capture','monitor_capture','display_capture'].includes(type)){
  strings(['window','capture_mode','monitor_id']);numbers(['monitor','method','priority']);booleans(['capture_cursor','cursor','client_area','capture_overlays','limit_framerate','anti_cheat_hook','compatibility']);
 }
 if(type==='color_source'){numbers(['width','height'],1,16384);numbers(['color'],0,4294967295);}
 if(['text_gdiplus','text_ft2_source'].includes(type)){
  // Reading arbitrary text files is not necessary to reproduce an inline label.
  if(typeof s.text==='string'&&s.text.length<=10000)out.text=s.text.replace(/\u0000/g,'');
  strings(['align','valign'],40);numbers(['color','color2','bk_color','outline_color','gradient_color'],0,4294967295);
  numbers(['opacity','bk_opacity','outline_opacity'],0,100);numbers(['outline_size','extents_cx','extents_cy','custom_width'],0,16384);
  booleans(['outline','gradient','vertical','extents','extents_wrap','word_wrap','drop_shadow']);out.read_from_file=false;out.from_file=false;
  if(object(s.font)){out.font={};for(const k of ['face','style'])if(typeof s.font[k]==='string'&&s.font[k].length<=100&&!/[\x00-\x1f]/.test(s.font[k]))out.font[k]=s.font[k];for(const k of ['size','flags'])if(Number.isInteger(s.font[k])&&s.font[k]>=0&&s.font[k]<=1000)out.font[k]=s.font[k];}
 }
 return out;
}
function point(value,fallback){if(value!==undefined&&!object(value))throw Error('Ungültige OBS-Position.');return {x:number(value?.x,fallback.x),y:number(value?.y,fallback.y)};}
function item(input){
 if(!object(input))throw Error('Ungültige OBS-Ebene.');
 if(input.visible!==undefined&&typeof input.visible!=='boolean')throw Error('Ungültige Sichtbarkeit der OBS-Ebene.');
 if(input.bounds_crop!==undefined&&typeof input.bounds_crop!=='boolean')throw Error('Ungültige OBS-Zuschnittbegrenzung.');
 const result={source:string(input.source,200),visible:input.visible!==false,pos:point(input.pos,{x:0,y:0}),scale:point(input.scale,{x:1,y:1}),rot:number(input.rot,0,-360000,360000),align:number(input.align,5,0,15),bounds_type:number(input.bounds_type,0,0,6),bounds_align:number(input.bounds_align,0,0,15),bounds_crop:input.bounds_crop===true,bounds:point(input.bounds,{x:0,y:0}),crop_left:number(input.crop_left,0,0),crop_right:number(input.crop_right,0,0),crop_top:number(input.crop_top,0,0),crop_bottom:number(input.crop_bottom,0,0),scale_ref:point(input.scale_ref,{x:0,y:0})};
 for(const field of ['align','bounds_type','bounds_align','crop_left','crop_right','crop_top','crop_bottom'])if(!Number.isInteger(result[field]))throw Error('Ungültige OBS-Ausrichtung oder Zuschnitt.');
 if(result.bounds.x<0||result.bounds.y<0||result.scale_ref.x<0||result.scale_ref.y<0)throw Error('Ungültige OBS-Begrenzung.');
 return result;
}
function validateObsCollection(input){
 if(input===undefined||input===null)return undefined;
 if(!object(input)||input.version!==1||!Array.isArray(input.sources)||!Array.isArray(input.scenes)||!input.scenes.length)throw Error('Ungültige gespeicherte OBS-Sammlung.');
 if(input.sources.length>1024||input.scenes.length>256)throw Error('Die OBS-Sammlung darf höchstens 256 Szenen und 1024 Quellen enthalten.');
 const ids=new Set(),register=id=>{string(id,200);if(!id||ids.has(id))throw Error('Doppelte oder leere OBS-Quellen-ID.');ids.add(id);return id;};
 const sources=input.sources.map(s=>{if(!object(s)||!SOURCE_TYPES.has(s.type))throw Error('Nicht unterstützter OBS-Quellentyp.');const result={id:register(s.id),name:string(s.name),type:s.type,settings:sourceSettings(s.type,s.settings)};
  if(s.shared!==undefined){if(['camera','camera2','camera3'].includes(s.shared)&&s.type==='dshow_input'||s.shared==='game'&&['game_capture','window_capture','monitor_capture','display_capture'].includes(s.type))result.shared=s.shared;else throw Error('Ungültige gemeinsame OBS-Bildquelle.');}return result;});
 let total=0;
 const scenes=input.scenes.map(s=>{
  if(!object(s)||!PLATFORMS.includes(s.platform)||!Array.isArray(s.items)||(total+=s.items.length)>10000)throw Error('Ungültige OBS-Szene oder zu viele Ebenen.');
  const id=register(s.id);return {id,key:'obs:'+id,name:string(s.name),label:string(s.label||s.name,400),platform:s.platform,width:number(s.width,1920,1,16384),height:number(s.height,1080,1,16384),partnerId:s.partnerId?string(s.partnerId,200):'',internal:s.internal===true,items:s.items.map(item)};
 });
 const byId=new Map(scenes.map(s=>[s.id,s]));
 for(const s of scenes){if(s.partnerId&&(!byId.has(s.partnerId)||byId.get(s.partnerId).platform===s.platform))throw Error('Ungültiger OBS-Hochformatpartner.');for(const i of s.items)if(!ids.has(i.source))throw Error('Eine gespeicherte OBS-Quelle fehlt.');}
 // Bound expansion as well as depth: a small DAG can otherwise expand into
 // millions of repeated scene items when rendered recursively.
 let visits=0;function visit(s,parents,depth){if(depth>8||parents.has(s.id))throw Error('Die OBS-Szenen enthalten einen Kreis oder sind zu tief verschachtelt.');const next=new Set(parents).add(s.id);for(const i of s.items){if(++visits>40000)throw Error('Die OBS-Szenen sind zu stark verschachtelt.');const child=byId.get(i.source);if(child)visit(child,next,depth+1);}}
 for(const s of scenes)visit(s,new Set(),0);
 const aliases={tiktok:{},twitch:{}};
 for(const p of PLATFORMS)for(const slot of DEFAULT_SCENES){const id=input.aliases?.[p]?.[slot];if(id){if(typeof id!=='string'||!byId.has(id)||byId.get(id).internal)throw Error('Ungültige gespeicherte OBS-Szenenzuordnung.');aliases[p][slot]=id;}}
 const warnings=Array.isArray(input.warnings)?input.warnings.slice(0,200).map(w=>string(w,1000).replace(/https?:\/\/\S+/gi,'[Adresse]')):[];
 return {version:1,name:string(input.name),sources,scenes,aliases,warnings};
}
// Presentation order never changes the saved OBS graph or stable scene keys.
// Use the landscape partner as the common sort name so differently named
// portrait scenes (for example Chat / chat_tt) remain together in both lists.
const sceneCollator=new Intl.Collator('de',{numeric:true,sensitivity:'base'});
function sceneSortName(value){return String(value||'').toLocaleLowerCase('de').replace(/[_.-]+/g,' ').replace(/\b(?:tiktok|tik tok|twitch|hochformat|querformat|portrait|landscape|tt)\b/g,' ').trim().replace(/\s+/g,' ');}
function sceneRank(value){const name=sceneSortName(value),groups=[['start','startszene','stream startet'],['spiel','gaming','game','spielszene'],['pause','pausenszene','bin gleich zurück'],['chat','chatten','just chatting'],['ende','end','endszene','abspann'],['offline'],['pc','setup']];const index=groups.findIndex(group=>group.includes(name));return index<0?groups.length:index;}
function sceneChoices(config){
 const scenes=(config?.obsCollection?.scenes||[]).filter(s=>!s.internal),byId=new Map(scenes.map(s=>[s.id,s]));
 const partner=s=>{const p=byId.get(s.partnerId);return p&&p.platform!==s.platform?p:undefined;};
 const sortBase=s=>{const p=partner(s);return s.platform==='tiktok'&&p?p:s;},sortName=s=>sceneSortName(sortBase(s).name);
 const sorted=[...scenes].sort((a,b)=>PLATFORMS.indexOf(a.platform)-PLATFORMS.indexOf(b.platform)||sceneRank(sortName(a))-sceneRank(sortName(b))||sceneCollator.compare(sortName(a),sortName(b))||sortBase(a).key.localeCompare(sortBase(b).key)||sceneCollator.compare(a.name,b.name)||a.key.localeCompare(b.key));
 return [...DEFAULT_SCENES.map(value=>({value,label:value})),...sorted.map((s,order)=>{const p=partner(s);return {value:s.key,label:s.label||s.name,name:s.name,platform:s.platform,spokenName:(s.platform==='tiktok'?'TikTok':'Twitch')+' '+s.name,order,...(p?{partnerKey:p.key,partnerName:p.name,partnerLabel:p.label||p.name}:{})};})];
}
function resolveScene(config,value){
 if(typeof value!=='string'||!value.trim())throw Error('Bitte eine Szene auswählen.');
 const wanted=value.trim(),lower=wanted.toLocaleLowerCase('de'),standard=DEFAULT_SCENES.find(s=>s.toLocaleLowerCase('de')===lower);if(standard)return standard;
 const scenes=(config?.obsCollection?.scenes||[]).filter(s=>!s.internal),key=scenes.find(s=>s.key===wanted);if(key)return key.key;
 const labels=scenes.filter(s=>s.label.toLocaleLowerCase('de')===lower),names=scenes.filter(s=>s.name.toLocaleLowerCase('de')===lower),matches=labels.length?labels:names;
 if(matches.length===1)return matches[0].key;if(matches.length>1)throw Error('Dieser Szenenname ist mehrfach vorhanden. Bitte TikTok oder Twitch mit auswählen.');throw Error('Diese Szene ist nicht vorhanden.');
}
module.exports={validateObsCollection,sourceSettings,localFile,sceneChoices,resolveScene,DEFAULT_SCENES,SOURCE_TYPES};
