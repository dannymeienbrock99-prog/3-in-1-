'use strict';

// This reader treats an OBS collection as data. Browser URLs, scripts, plugins,
// filters, hotkeys, credentials and audio devices are never loaded or executed.
const fs=require('node:fs'),path=require('node:path');
const {defaults,validate}=require('./config.cjs');
const {importObsTransitions}=require('./transitions.cjs');
const {validateObsCollection,sourceSettings,SOURCE_TYPES}=require('./obs-collection.cjs');
const PLATFORMS=['tiktok','twitch'],SLOTS=['Spiel','Start','Pause','Ende'];
const CAMERA_TYPES=new Set(['dshow_input','av_capture_input','v4l2_input']);
const GAME_TYPES={game_capture:'game',window_capture:'window',monitor_capture:'screen',display_capture:'screen'};
const MEDIA=/\.(?:png|jpe?g|webp|bmp|gif|mp4|mkv|mov|webm|avi|m4v)$/i;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const text=(v,max=300)=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,' ').slice(0,max):'';
const finite=(v,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
const type=s=>s.id||s.versioned_id;
const sceneType=s=>['scene','group'].includes(type(s));
const key=(s,i)=>text(s.uuid,150)||`source-${i}`;
const cleanName=s=>text(s.name)||'Unbenannte Quelle';
const localPath=value=>typeof value==='string'&&value.length<=2000&&!/[\x00-\x1f]/.test(value)&&!value.startsWith('\\\\')&&!value.startsWith('//')&&(/^[a-z]:[\\/]/i.test(value)||path.isAbsolute(value))?value:'';

function model(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Diese JSON-Datei ist keine OBS-Szenensammlung. Bitte in OBS „Szenensammlung → Exportieren“ verwenden oder „Direkt aus OBS“ wählen.');
 if(!Array.isArray(data.sources)){
  if(data.sources&&typeof data.sources==='object'&&data.layouts&&data.program)throw Error('Diese Datei ist ein Batto-Dual-Stream-Projekt. Bitte „Projekt importieren“ verwenden. Für OBS-Szenen kannst du „Direkt aus OBS“ wählen.');
  throw Error('Diese JSON-Datei enthält keine OBS-Quellenliste. Bitte die exportierte OBS-Szenensammlung auswählen oder „Direkt aus OBS“ verwenden.');
 }
 if(data.sources.length>2000)throw Error('Die OBS-Szenensammlung enthält mehr als 2000 Quellen. Bitte eine kleinere Sammlung exportieren.');
 const records=[...data.sources,...(Array.isArray(data.groups)?data.groups:[])];
 if(records.length>2000||records.some(s=>!s||typeof s!=='object'||Array.isArray(s)))throw Error('Die OBS-Quellenliste ist ungültig oder zu groß.');
 const rows=records.map((source,i)=>({source,id:key(source,i)})),byId=new Map(),byName=new Map();let count=0;
 for(const row of rows){if(byId.has(row.id))throw Error('Die OBS-Datei enthält doppelte Quellen-IDs.');byId.set(row.id,row);const name=cleanName(row.source);byName.set(name,[...(byName.get(name)||[]),row]);const items=row.source.settings?.items;if(items!==undefined&&!Array.isArray(items))throw Error('Eine OBS-Szene enthält eine ungültige Quellenliste.');count+=items?.length||0;}
 if(count>10000)throw Error('Die OBS-Sammlung enthält zu viele Szenenelemente.');
 const scenes=rows.filter(r=>type(r.source)==='scene');if(!scenes.length)throw Error('Diese Datei enthält keine OBS-Szenen.');
 const warnings=[];const warn=message=>{if(warnings.length<200&&!warnings.includes(message))warnings.push(message);};
 function resolve(item){if(item.source_uuid){const found=byId.get(item.source_uuid);if(!found)warn(`Quelle „${text(item.name)}“: Die gespeicherte Quellen-ID fehlt.`);return found;}
  const matches=byName.get(text(item.name))||[];if(matches.length===1)return matches[0];warn(`Quelle „${text(item.name)}“: ${matches.length?'Der Name ist mehrfach vorhanden; keine automatische Zuordnung.':'Die Quelle fehlt.'}`);return null;}
 return {data,rows,scenes,byId,warnings,warn,resolve,visits:0};
}
function dimensions(scene,data){
 const s=scene.settings||{};
 if(s.custom_size&&finite(s.cx||s.width)>0&&finite(s.cy||s.height)>0)return {width:finite(s.cx||s.width),height:finite(s.cy||s.height)};
 // Aitum's settings.canvas is a link to another scene, not this scene's size.
 const refs=(s.items||[]).map(x=>x.scale_ref).filter(x=>finite(x?.x)>0&&finite(x?.y)>0);
 if(refs.length){const counts=new Map();for(const r of refs){const k=`${r.x}:${r.y}`,entry=counts.get(k)||{width:r.x,height:r.y,count:0};entry.count++;counts.set(k,entry);}const best=[...counts.values()].sort((a,b)=>b.count-a.count)[0];return {width:best.width,height:best.height};}
 return {width:finite(data.resolution?.x,1920)||1920,height:finite(data.resolution?.y,1080)||1080};
}
function sourceCandidate(row){const s=row.source,settings=s.settings||{},id=type(s),name=cleanName(s);
 if(CAMERA_TYPES.has(id)){const target=text(settings.video_device_id||settings.device||'',2000);if(target&&!/27b05c2d-93dc-474a-a5da-9bba34cb2a9[cd]|Batto (?:TikTok|Twitch)/i.test(target))return {id:row.id,name,target,kind:'camera'};}
 if(GAME_TYPES[id]){const kind=GAME_TYPES[id],raw=kind==='screen'?(settings.monitor_id??settings.monitor):settings.window,target=typeof raw==='number'?String(raw):text(raw,2000);if(target)return {id:row.id,name,target,kind};}
 return null;
}
function sourceSize(source){const s=source.settings||{},resolution=typeof s.resolution==='string'?s.resolution.match(/^(\d+)x(\d+)$/):null;return {width:finite(s.width||s.cx,resolution?Number(resolution[1]):0),height:finite(s.height||s.cy,resolution?Number(resolution[2]):0)};}
function itemBox(item,source,canvas,warn,label){
 if(Math.abs(finite(item.rot))>.01||finite(item.scale?.x,1)<=0||finite(item.scale?.y,1)<=0){warn(`${label}: Drehung oder Spiegelung wird nicht übernommen; die bisherige Anordnung bleibt erhalten.`);return null;}
 if(['crop_left','crop_right','crop_top','crop_bottom'].some(k=>finite(item[k])!==0))warn(`${label}: OBS-Zuschnitt wird nicht übernommen; bitte den Ausschnitt nach dem Import prüfen.`);
 let width=finite(item.bounds?.x),height=finite(item.bounds?.y),fit=item.bounds_type===3?'cover':'contain';
 if(!(finite(item.bounds_type)>0&&width>0&&height>0)){const sourceDimensions=sceneType(source)?dimensions(source,{resolution:{x:canvas.width,y:canvas.height}}):sourceSize(source);width=sourceDimensions.width*finite(item.scale?.x,1);height=sourceDimensions.height*finite(item.scale?.y,1);}
 if(width<=0||height<=0){warn(`${label}: Originalgröße fehlt; die bisherige Anordnung bleibt erhalten.`);return null;}
 if(item.bounds_type===1)warn(`${label}: Gestreckte OBS-Quelle wird proportional eingepasst.`);
 let x=finite(item.pos?.x),y=finite(item.pos?.y),align=Number.isInteger(item.align)?item.align:5;
 if(!(align&1))x-=align&2?width:width/2;if(!(align&4))y-=align&8?height:height/2;
 return {x,y,width,height,fit};
}
function flatten(m,row){
 const output=[],canvas=dimensions(row.source,m.data),start=m.warnings.length;
 function walk(current,transform,seen,depth){if(depth>8||seen.has(current.id)){m.warn(`Szene „${cleanName(row.source)}“: Verschachtelung ist zu tief oder enthält einen Kreis.`);return;}
  const next=new Set(seen).add(current.id),childCanvas=dimensions(current.source,m.data);
  for(const item of current.source.settings?.items||[]){if(++m.visits>40000)throw Error('Die Szenen sind zu stark verschachtelt; bitte eine kleinere OBS-Sammlung exportieren.');if(!item||item.visible===false||item.group_item_backup===true)continue;const found=m.resolve(item);if(!found)continue;const label=`${cleanName(row.source)} · ${cleanName(found.source)}`,box=itemBox(item,found.source,childCanvas,m.warn,label),absolute=box?{x:transform.x+box.x*transform.sx,y:transform.y+box.y*transform.sy,width:box.width*transform.sx,height:box.height*transform.sy,fit:box.fit}:null;
   if(sceneType(found.source)){if(!absolute){m.warn(`${label}: Verschachtelte Szene ohne verwertbare Größe wurde ausgelassen.`);continue;}const dims=dimensions(found.source,m.data),scale=absolute.fit==='cover'?Math.max(absolute.width/dims.width,absolute.height/dims.height):Math.min(absolute.width/dims.width,absolute.height/dims.height);walk(found,{x:absolute.x+(absolute.width-dims.width*scale)/2,y:absolute.y+(absolute.height-dims.height*scale)/2,sx:scale,sy:scale},next,depth+1);}
   else {output.push({row:found,item,box:absolute});if(Array.isArray(found.source.filters)&&found.source.filters.length)m.warn(`${label}: OBS-Filter werden nicht übernommen.`);}
  }
 }
 walk(row,{x:0,y:0,sx:1,sy:1},new Set(),0);return {items:output,canvas,warnings:m.warnings.slice(start)};
}
function mediaAsset(entry,fileExists,warn,scene){const s=entry.row.source,id=type(s);if(!['image_source','ffmpeg_source'].includes(id))return null;
 const raw=id==='image_source'?s.settings?.file:s.settings?.local_file,file=localPath(raw),supported=!!file&&MEDIA.test(file);let exists=false;
 if(supported)try{exists=fileExists(file)===true;}catch{}
 const reason=!file?'Kein lokaler Dateipfad':!supported?'Dateiformat nicht unterstützt':!exists?'Datei fehlt':'';
 if(reason)warn(`${scene} · ${cleanName(s)}: ${reason}.`);
 return {source:entry.row.id,name:cleanName(s),path:file,exists,supported,reason};
}
function createObsCollection(data,{mapping={},sharedGameId='',fileExists=fs.existsSync}={}){
 const m=model(data),warnings=[],warn=value=>{const message=text(value,1000).replace(/https?:\/\/\S+/gi,'[Adresse]');if(warnings.length<200&&!warnings.includes(message))warnings.push(message);};
 const nodes=m.rows.filter(r=>sceneType(r.source)),sources=m.rows.filter(r=>!sceneType(r.source)).map(row=>{
  const source=row.source,name=cleanName(source),original=type(source),stock=typeof original==='string'?original.replace(/_v\d+$/,''):'';
  let sourceType=SOURCE_TYPES.has(stock)?stock:'unsupported',settings=sourceSettings(sourceType,source.settings);
  if(sourceType==='unsupported')warn(`${name}: Quellentyp „${text(original)}“ bleibt als inaktive Ebene erhalten.`);
  if(sourceType==='dshow_input'&&!settings.video_device_id){sourceType='unsupported';settings={};warn(`${name}: Kein verwendbares Kameragerät gespeichert; diese Ebene bleibt inaktiv.`);}
  if(['game_capture','window_capture'].includes(sourceType)&&!settings.window&&settings.capture_mode!=='any_fullscreen'){sourceType='unsupported';settings={};warn(`${name}: Kein Aufnahmefenster gespeichert; diese Ebene bleibt inaktiv.`);}
  if(['image_source','ffmpeg_source'].includes(sourceType)){
   const file=settings.file||settings.local_file;
   if(!file){sourceType='unsupported';settings={};warn(`${name}: Kein unterstützter lokaler Dateipfad gespeichert; diese Ebene bleibt inaktiv.`);}
   else {let exists=false;try{exists=fileExists(file)===true;}catch{}if(!exists)warn(`${name}: Datei fehlt.`);}
  }
  if(Array.isArray(source.filters)&&source.filters.length)warn(`${name}: OBS-Filter werden nicht übernommen.`);
  if(['text_gdiplus','text_ft2_source'].includes(sourceType)&&(source.settings?.read_from_file||source.settings?.from_file))warn(`${name}: Text aus einer externen Datei wird nicht geladen; bitte einen festen Text verwenden.`);
  return {id:row.id,name,type:sourceType,settings,...(sourceType==='dshow_input'?{shared:'camera'}:row.id===sharedGameId&&['game_capture','window_capture','monitor_capture','display_capture'].includes(sourceType)?{shared:'game'}:{})};
 });
 const labels=new Map(),scenes=nodes.map(row=>{
  const source=row.source,canvas=dimensions(source,data),platform=canvas.height>canvas.width?'tiktok':'twitch',name=cleanName(source),base=`${name} · ${platform==='tiktok'?'TikTok':'Twitch'}`,count=(labels.get(base)||0)+1;labels.set(base,count);
  const items=[];for(const entry of source.settings?.items||[]){if(!entry||entry.group_item_backup===true)continue;const found=m.resolve(entry);if(!found)continue;
   // Keep OBS transforms untouched. Native source dimensions become available
   // after decoding; bounded and unbounded items must not be collapsed to boxes.
   items.push({source:found.id,visible:entry.visible!==false,pos:entry.pos,scale:entry.scale,rot:entry.rot,align:entry.align,bounds_type:entry.bounds_type,bounds_align:entry.bounds_align,bounds_crop:entry.bounds_crop,bounds:entry.bounds,crop_left:entry.crop_left,crop_right:entry.crop_right,crop_top:entry.crop_top,crop_bottom:entry.crop_bottom,scale_ref:entry.scale_ref});
  }
  return {id:row.id,key:'obs:'+row.id,name,label:base+(count>1?` (${count})`:''),platform,...canvas,partnerId:'',internal:type(source)==='group',items};
 });
 const byId=new Map(scenes.map(s=>[s.id,s]));
 for(const row of nodes){const scene=byId.get(row.id);for(const link of Array.isArray(row.source.settings?.canvas)?row.source.settings.canvas:[]){const matches=scenes.filter(s=>!s.internal&&s.platform!==scene.platform&&s.name===text(link.scene));if(matches.length===1){scene.partnerId=matches[0].id;if(!matches[0].partnerId)matches[0].partnerId=scene.id;break;}}}
 let visits=0;function prune(scene,parents,depth){const next=new Set(parents).add(scene.id);scene.items=scene.items.filter(i=>{if(++visits>40000)throw Error('Die OBS-Sammlung ist zu stark verschachtelt.');const child=byId.get(i.source);if(!child)return true;if(next.has(child.id)||depth>=8){warn(`${scene.name}: Eine Szenenverknüpfung enthält einen Kreis oder ist zu tief und bleibt inaktiv.`);return false;}prune(child,next,depth+1);return true;});}
 for(const scene of scenes)prune(scene,new Set(),0);
 for(const warning of m.warnings)warn(warning);
 const order=(Array.isArray(data.scene_order)?data.scene_order:[]).map(s=>text(s?.name));
 scenes.sort((a,b)=>{const rank=s=>{const direct=order.indexOf(s.name);if(direct>=0)return direct*2+(s.platform==='tiktok'?1:0);const partner=byId.get(s.partnerId),index=partner?order.indexOf(partner.name):-1;return index>=0?index*2+1:10000;};return rank(a)-rank(b);});
 if(sources.some(s=>s.type==='dshow_input'))warn('Kameraebenen mit passendem Gerät nutzen die eingeschaltete Kamera 1, 2 oder 3. Sonstige Kameraebenen nutzen Kamera 1. Historische OBS-Kameras werden nicht zusätzlich geöffnet.');
 if(sources.some(s=>['game_capture','window_capture','monitor_capture','display_capture'].includes(s.type)))warn('Weitere Spiel- und Fensterquellen behalten ihre OBS-Zuordnung. Geschlossene Programme liefern kein Bild, bis sie wieder geöffnet werden.');
 if(sources.some(s=>s.type==='ffmpeg_source'))warn('OBS-Ton und Medienlautstärke werden nicht übernommen; die virtuelle Kamera überträgt das Bild.');
 return validateObsCollection({version:1,name:text(data.name)||'OBS-Szenensammlung',sources,scenes,aliases:mapping,warnings});
}
function inspectCollection(data,{fileExists=fs.existsSync}={}){
 const m=model(data),scenes=m.scenes.map(row=>{const start=m.warnings.length,flattened=flatten(m,row),sources=flattened.items.map(e=>sourceCandidate(e.row)).filter(Boolean),assets=flattened.items.map(e=>mediaAsset(e,fileExists,m.warn,cleanName(row.source))).filter(Boolean),unsupported=flattened.items.filter(e=>!sourceCandidate(e.row)&&!['image_source','ffmpeg_source'].includes(type(e.row.source)));
  for(const e of unsupported)m.warn(`${cleanName(row.source)} · ${cleanName(e.row.source)}: Quellentyp „${text(type(e.row.source))}“ wird nicht übernommen.`);
  return {id:row.id,name:cleanName(row.source),platform:flattened.canvas.height>flattened.canvas.width?'tiktok':'twitch',...flattened.canvas,summary:`${sources.filter(x=>x.kind==='camera').length} Kamera · ${sources.filter(x=>x.kind!=='camera').length} Spiel/Fenster · ${assets.length} Medien`,warnings:m.warnings.slice(start),assets,sources:sources.map(x=>x.id)};
 });
 const suggestedMapping={tiktok:{},twitch:{}};
 for(const p of PLATFORMS)for(const slot of SLOTS){const exact=scenes.filter(s=>s.platform===p&&s.name.toLowerCase()===slot.toLowerCase()),names=slot==='Spiel'?/^(?:spiel|game|gaming)$/i:slot==='Ende'?/^(?:ende|end|offline)$/i:new RegExp(`^${slot}$`,'i'),matching=exact.length?exact:scenes.filter(s=>s.platform===p&&names.test(s.name));suggestedMapping[p][slot]=matching.length===1?matching[0].id:'';}
 const all=m.rows.map(sourceCandidate).filter(Boolean),sources={camera:all.filter(x=>x.kind==='camera'),game:all.filter(x=>x.kind!=='camera')},suggestedSources={camera:'',game:''};
 for(const kind of ['camera','game']){const used=new Set(PLATFORMS.flatMap(p=>scenes.find(s=>s.id===suggestedMapping[p].Spiel)?.sources||[])),candidates=sources[kind].filter(x=>used.has(x.id)),targets=new Set(candidates.map(x=>`${x.kind}:${x.target}`));if(targets.size===1)suggestedSources[kind]=candidates[0].id;}
 const saved=createObsCollection(data,{mapping:suggestedMapping,fileExists});
 for(const scene of scenes){const original=saved.scenes.find(s=>s.id===scene.id);scene.key=original.key;scene.label=original.label;scene.partnerId=original.partnerId;scene.warnings=saved.warnings.filter(w=>w.startsWith(scene.name+' · '));}
 return {name:text(data.name)||'OBS-Szenensammlung',scenes,sources,suggestedSources,suggestedMapping,warnings:saved.warnings,...importObsTransitions(data,{fileExists})};
}
function normalizeBox(box,canvas,fallback,warn,label){if(!box)return {...fallback,visible:true};const left=Math.max(0,box.x),top=Math.max(0,box.y),right=Math.min(canvas.width,box.x+box.width),bottom=Math.min(canvas.height,box.y+box.height);
 if(right<=left||bottom<=top){warn(`${label}: Quelle liegt vollständig außerhalb der Leinwand und bleibt ausgeblendet.`);return {...fallback,visible:false};}
 if(left!==box.x||top!==box.y||right!==box.x+box.width||bottom!==box.y+box.height)warn(`${label}: Quelle ragte über den Rand hinaus; sie wurde auf den sichtbaren Bereich eingepasst. Bitte den Ausschnitt prüfen.`);
 const width=(right-left)/canvas.width,height=(bottom-top)/canvas.height;if(width<.02||height<.02){warn(`${label}: Quelle ist für die Suite zu klein; die bisherige Größe bleibt erhalten.`);return {...fallback,visible:true};}
 return {source:fallback.source,x:left/canvas.width,y:top/canvas.height,width,height,fit:box.fit,visible:true};
}
function applyCollection(data,{config=defaults(),mapping,sources:selection,devices,fileExists=fs.existsSync}={}){
 const m=model(data),preview=inspectCollection(data,{fileExists}),next=validate(config),map=mapping||preview.suggestedMapping,warnings=[...preview.warnings],warn=s=>{if(warnings.length<200&&!warnings.includes(s))warnings.push(s);},chosen={};
 if(selection!==undefined&&(!selection||typeof selection!=='object'||Array.isArray(selection)||['camera','game'].some(k=>own(selection,k)&&typeof selection[k]!=='string')))throw Error('Ungültige Auswahl der gemeinsamen Bildquellen.');
 if(!map||typeof map!=='object'||Array.isArray(map))throw Error('Bitte die zu importierenden OBS-Szenen zuordnen.');
 for(const p of PLATFORMS){if(map[p]!==undefined&&(!map[p]||typeof map[p]!=='object'||Array.isArray(map[p])))throw Error('Ungültige Szenenzuordnung.');for(const slot of SLOTS){const id=map[p]?.[slot];if(id!==undefined&&id!==''&&(typeof id!=='string'||!m.scenes.some(r=>r.id===id)))throw Error('Die gewählte OBS-Szene ist nicht in dieser Sammlung vorhanden.');}}
 const gameScenes=PLATFORMS.map(p=>m.byId.get(map[p]?.Spiel)).filter(Boolean),gameItems=gameScenes.flatMap(row=>flatten(m,row).items),candidates=gameItems.map(e=>sourceCandidate(e.row)).filter(Boolean);
 for(const kind of ['camera','game']){const all=preview.sources[kind],explicit=selection&&own(selection,kind),id=explicit?selection[kind]:null;let candidate;
  if(explicit&&id){candidate=all.find(x=>x.id===id);if(!candidate)throw Error('Die gewählte gemeinsame Quelle gehört nicht zu dieser OBS-Sammlung.');}
  else if(!explicit){const eligible=candidates.filter(x=>kind==='camera'?x.kind==='camera':x.kind!=='camera'),current=next.sources[kind];candidate=eligible.find(x=>x.target===current.target&&(kind==='camera'||x.kind===current.kind));if(!candidate){const unique=new Map(eligible.map(x=>[`${x.kind}:${x.target}`,x]));if(unique.size===1)candidate=[...unique.values()][0];else if(unique.size>1)warn(`Mehrere ${kind==='camera'?'Kameras':'Spiel-/Fensterquellen'} sind vorhanden. Die aktuelle gemeinsame Quelle bleibt erhalten; bitte die gewünschte Quelle ausdrücklich auswählen.`);}}
  if(candidate){const devicesForKind=devices?.[candidate.kind];if(Array.isArray(devicesForKind)&&!devicesForKind.some(d=>d.id===candidate.target)){warn(`„${candidate.name}“ ist aktuell nicht unter den erkannten Geräten/Fenstern. Die bisherige gemeinsame Quelle bleibt erhalten.`);candidate=null;}}
  if(kind==='camera'&&candidate){const assigned=['camera2','camera3'].find(id=>next.sources[id].enabled&&next.sources[id].target.trim().toLowerCase()===candidate.target.trim().toLowerCase());if(assigned){warn(`Kameragerät „${candidate.name}“ ist bereits Kamera ${assigned.slice(-1)} zugeordnet. Kamera 1 bleibt unverändert; passende OBS-Ebenen verwenden das zugeordnete Gerät.`);candidate=null;}}
  if(candidate){next.sources[kind]={enabled:true,target:candidate.target,name:candidate.name,...(kind==='game'?{kind:candidate.kind,captureMethod:next.sources.game.captureMethod}:{})};chosen[kind]=candidate;}
  else {const current=next.sources[kind];chosen[kind]=all.find(x=>x.target===current.target&&(kind==='camera'||x.kind===current.kind));}
 }
 let imported=0;
 for(const p of PLATFORMS)for(const slot of SLOTS){const row=m.byId.get(map[p]?.[slot]);if(!row)continue;imported++;const flat=flatten(m,row),label=`${p==='tiktok'?'TikTok':'Twitch'} · ${slot}`;
  if(slot==='Spiel'){for(const kind of ['game','camera']){const existing=next.layouts[p].find(x=>x.source===kind),candidate=chosen[kind];if(!candidate){warn(`${label}: Keine gemeinsame ${kind==='camera'?'Kamera':'Spiel-/Fensterquelle'} zugeordnet; die bisherige Anordnung bleibt erhalten.`);continue;}
    const matches=flat.items.filter(e=>{const c=sourceCandidate(e.row);return c&&c.kind===candidate.kind&&c.target===candidate.target;});if(matches.length>1)warn(`${label}: Dieselbe ${kind==='camera'?'Kamera':'Spielquelle'} wird mehrfach verwendet; die oberste sichtbare Instanz wird übernommen.`);
    const e=matches.at(-1),index=next.layouts[p].indexOf(existing);next.layouts[p][index]=e?normalizeBox(e.box,flat.canvas,existing,warn,label):{...existing,visible:false};}
   if(flat.items.some(e=>['image_source','ffmpeg_source'].includes(type(e.row.source))))warn(`${label}: Zusätzliche Medienebenen der Spielszene werden nicht übernommen.`);
  }else {const assets=flat.items.map(e=>mediaAsset(e,fileExists,warn,label)).filter(Boolean),usable=assets.filter(a=>a.supported&&a.exists);if(usable.length>1)warn(`${label}: Mehrere Medien vorhanden; das unterste verfügbare Hintergrundmedium wird verwendet.`);if(usable[0]){next.program.platformBackgrounds[p][slot]=usable[0].path;warn(`${label}: Das Hintergrundmedium wird auf die Leinwand eingepasst; OBS-Ebenenposition, Zuschnitt und Medienlautstärke werden nicht übernommen.`);}else{next.program.platformBackgrounds[p][slot]=null;warn(`${label}: Kein verfügbares Hintergrundmedium; die Szene erhält einen leeren Hintergrund.`);}
   if(flat.items.some(e=>sourceCandidate(e.row)))warn(`${label}: Kamera-/Fensterebenen dieser Szene werden nicht übernommen. Gemeinsame Bildquellen können in Spiel angeordnet werden.`);
  }
 }
 // The simplified layouts/backgrounds above remain useful when the collection
 // is removed. Actual imported scenes always render their complete saved layers.
 next.obsCollection=createObsCollection(data,{mapping:map,sharedGameId:chosen.game?.id||'',fileExists});
 for(const message of warnings.filter(w=>/^Mehrere (?:Kameras|Spiel-)|^„.+“ ist aktuell nicht|^Kameragerät .+ bereits Kamera/.test(w)))if(!next.obsCollection.warnings.includes(message))next.obsCollection.warnings.push(message);
 if(next.program.scene.startsWith('obs:')&&!next.obsCollection.scenes.some(s=>s.key===next.program.scene))next.program.scene='Spiel';
 const transitionImport=applyTransitions(data,{config:next,fileExists});
 next.transitions=transitionImport.config.transitions;next.program=transitionImport.config.program;
 for(const warning of transitionImport.warnings)if(!next.obsCollection.warnings.includes(warning))next.obsCollection.warnings.push(warning);
 next.layoutRevision=2;return {config:validate(next),warnings:next.obsCollection.warnings,summary:`${next.obsCollection.scenes.filter(s=>!s.internal).length} OBS-Szenen mit ihren Ebenen übernommen; ${imported} Schnellwahltasten zugeordnet. Die Ausgabe wurde nicht gestartet.`};
}
function applyTransitions(data,{config=defaults(),fileExists=fs.existsSync}={}){
 const imported=importObsTransitions(data,{fileExists}),next=validate(config),merged=new Map(next.transitions.map(t=>[t.id,t]));
 for(const item of imported.transitions)merged.set(item.id,item);next.transitions=[...merged.values()];
 if(imported.selectedTransition){next.program.transition=imported.selectedTransition;next.program.durationMs=imported.durationMs;}
 return {config:validate(next),warnings:imported.transitionWarnings,summary:imported.transitions.length+' OBS-Videoübergang/Videoübergänge übernommen. Szenen, Kameras und Anordnung bleiben erhalten.'};
}
module.exports={inspectCollection,applyCollection,createObsCollection,applyTransitions};
