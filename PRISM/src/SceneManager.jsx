import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,Copy,Download,Plus,Search,SlidersHorizontal,Star,Upload} from 'lucide-react';
import {DEFAULT_CONFIG,EFFECT_NAMES,EFFECT_DETAILS,SCENES,SCENE_CATEGORIES,MAX_PROFILE_IMPORT_BYTES,importProfileDocument,downloadProfiles} from './data.js';
import {availableSceneTargets,saveScene,sceneLibrary,validateSceneCollection} from './scene-library.js';
import {isAnimatedEffect,renderFrame} from '../server/effect-renderer.mjs';
import {CustomEffectEditor} from './CustomEffectEditor.jsx';
import './scene-manager.css';

export function SceneMiniPreview({config,label='Animiertes Lichtband: Farben und Helligkeit',large=false}) {
 const canvas=useRef(null);
 useEffect(()=>{
  const element=canvas.current,context=element?.getContext('2d');if(!context)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame,visible=true,last=0,elapsed=.8;
  const draw=()=>{
   const colors=renderFrame(64,config,elapsed);
   const samples=colors.map(color=>({r:color&255,g:color>>>8&255,b:color>>>16&255}));
   const brightness=samples.map(({r,g,b})=>(.2126*r+.7152*g+.0722*b)/255);
   // The trace is the smoothed brightness of the actual rendered LEDs. Its
   // colors come from that same frame; it never substitutes a preset image.
   const points=brightness.map((_,index)=>{
    let sum=0,weight=0;
    for(let offset=-3;offset<=3;offset++){
     const sample=Math.max(0,Math.min(brightness.length-1,index+offset));
     const strength=4-Math.abs(offset);sum+=brightness[sample]*strength;weight+=strength;
    }
    return {x:index*320/(brightness.length-1),y:76-(sum/weight)*56};
   });
   context.clearRect(0,0,320,100);context.fillStyle='#0b1017';context.fillRect(0,0,320,100);
   const light=context.createLinearGradient(0,0,320,0);
   samples.forEach(({r,g,b},index)=>light.addColorStop(index/(samples.length-1),`rgb(${r},${g},${b})`));
   const trace=()=>{
    context.beginPath();context.moveTo(points[0].x,points[0].y);
    for(let index=1;index<points.length-1;index++){
     const point=points[index],next=points[index+1];
     context.quadraticCurveTo(point.x,point.y,(point.x+next.x)/2,(point.y+next.y)/2);
    }
    context.lineTo(points.at(-1).x,points.at(-1).y);
   };
   trace();context.lineTo(320,100);context.lineTo(0,100);context.closePath();
   context.globalAlpha=.12;context.fillStyle=light;context.fill();
   context.strokeStyle=light;context.lineJoin='round';context.lineCap='round';
   trace();context.globalAlpha=.08;context.lineWidth=20;context.stroke();
   context.globalAlpha=.18;context.lineWidth=9;context.stroke();
   context.globalAlpha=1;context.lineWidth=2.3;context.stroke();
  };
  const tick=now=>{if(now-last>=80){elapsed+=last?Math.min((now-last)/1000,.25):0;last=now;draw();}frame=requestAnimationFrame(tick);};
  const refresh=()=>{cancelAnimationFrame(frame);last=0;draw();if(visible&&!document.hidden&&!reduced.matches&&isAnimatedEffect(config))frame=requestAnimationFrame(tick);};
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;refresh();}):null;
  observer?.observe(element);document.addEventListener('visibilitychange',refresh);reduced.addEventListener('change',refresh);refresh();
  return()=>{cancelAnimationFrame(frame);observer?.disconnect();document.removeEventListener('visibilitychange',refresh);reduced.removeEventListener('change',refresh);};
 },[config]);
 return <canvas className={'scene-mini-preview'+(large?' scene-mini-preview-large':'')} ref={canvas} width="320" height="100" role="img" aria-label={label}/>;
}

function SceneColor({color,index,onChange,onRemove,canRemove}) {
 const [text,setText]=useState(color);useEffect(()=>setText(color),[color]);
 const valid=/^#[0-9a-f]{6}$/i.test(text);
 return <div className="scene-color"><input type="color" value={color} aria-label={`Szenenfarbe ${index+1}`} onChange={e=>onChange(e.target.value)}/><input className="scene-hex" aria-label={`HEX Szenenfarbe ${index+1}`} value={text} maxLength={7} aria-invalid={!valid} onChange={e=>{setText(e.target.value);if(/^#[0-9a-f]{6}$/i.test(e.target.value))onChange(e.target.value);}} onBlur={()=>{if(!valid)setText(color);}}/><button type="button" disabled={!canRemove} aria-label={`Szenenfarbe ${index+1} entfernen`} onClick={onRemove}>×</button></div>;
}

export function SceneManager({config=DEFAULT_CONFIG,onChoose,active,devices=[],selectedIds=[],onSelectionChange,profiles=[],onProfilesChange,profilesReady=true,onNotify}) {
 const [search,setSearch]=useState(''),[category,setCategory]=useState(''),[favoritesOnly,setFavoritesOnly]=useState(false),[draft,setDraft]=useState(null),[notice,setNotice]=useState(null),[deleteId,setDeleteId]=useState(null);
 const fileInput=useRef(null),editor=useRef(null),latestProfiles=useRef(profiles);latestProfiles.current=profiles;
 const scenes=useMemo(()=>sceneLibrary(profiles),[profiles]);
 const categories=useMemo(()=>[...new Set([...SCENE_CATEGORIES,...scenes.map(scene=>scene.category).filter(Boolean)])],[scenes]);
 const filtered=scenes.filter(scene=>(!category||(scene.category||'Eigene')===category)&&(!favoritesOnly||scene.favorite)&&scene.name.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')));
 const notify=(message,type='success')=>{setNotice({message,type});onNotify?.(message,type);};
 const commit=next=>{if(!profilesReady)throw new Error('Die Szenenbibliothek wird noch geladen.');const safe=validateSceneCollection(next);if(!onProfilesChange)throw new Error('Szenen können in dieser Ansicht nicht gespeichert werden.');latestProfiles.current=safe;onProfilesChange(safe);};
 const choose=scene=>{
  onChoose?.(scene);
  const targets=availableSceneTargets(scene,devices);
  if(targets){onSelectionChange?.(targets.available);if(targets.missing.length)notify(`${targets.missing.length} gespeicherte Geräte sind derzeit nicht verbunden. Prüfe die Geräteauswahl vor dem Anwenden.`,'error');}
 };
 const openEditor=(scene,{duplicate=false}={})=>{
  const next=scene?{...structuredClone(scene),id:duplicate?crypto.randomUUID():scene.id,name:duplicate?`${scene.name.slice(0,52)} Kopie`:scene.name,category:scene.category||'Eigene',targetDevices:[...(scene.targetDevices??selectedIds)]}:{id:crypto.randomUUID(),name:'Meine Szene',category:'Eigene',favorite:false,config:structuredClone(config),targetDevices:[...selectedIds]};
  setDraft(next);setDeleteId(null);setNotice(null);choose(next);setTimeout(()=>editor.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}),0);
 };
 const edit=patch=>{const next={...draft,...patch};setDraft(next);choose(next);};
 const editConfig=patch=>edit({config:{...draft.config,...patch}});
 const persistDraft=()=>{try{const next=saveScene(latestProfiles.current,draft);commit(next);setDraft(next.find(scene=>scene.id===draft.id));notify(`„${draft.name.trim()}“ gespeichert.`);}catch(error){notify(error.message,'error');}};
 const toggleFavorite=scene=>{try{commit(saveScene(latestProfiles.current,{...scene,favorite:!scene.favorite}));if(draft?.id===scene.id)setDraft({...draft,favorite:!scene.favorite});}catch(error){notify(error.message,'error');}};
 const remove=scene=>{try{commit(latestProfiles.current.filter(profile=>profile.id!==scene.id));if(draft?.id===scene.id)setDraft(null);setDeleteId(null);notify(SCENES.some(preset=>preset.id===scene.id)?'Die Standardvorlage wurde wiederhergestellt.':'Szene gelöscht.');}catch(error){notify(error.message,'error');}};
 const importFile=async file=>{
  if(!file)return;
  try{if(file.size>MAX_PROFILE_IMPORT_BYTES)throw new Error('Die Profildatei ist zu groß (maximal 128 KB).');const imported=importProfileDocument(JSON.parse(await file.text()));commit([...latestProfiles.current,...imported]);notify(`${imported.length} Szenen importiert.`);}catch(error){notify(error instanceof SyntaxError?'Die Datei enthält kein gültiges JSON.':error.message,'error');}
 };
 const exportScenes=items=>{try{downloadProfiles(items);notify(`${items.length} Szenen exportiert.`);}catch(error){notify(error.message,'error');}};
 return <section className="scene-manager" aria-label="Szenen verwalten">
  <div className="scene-manager-heading"><div><h2>Szenen <span className="scene-library-count">{scenes.length}</span></h2><p>Deine Lichtstimmungen. Auswählen, anpassen, Vorschau prüfen.</p></div><button type="button" className="primary" disabled={!profilesReady} onClick={()=>openEditor(null)}><Plus size={17} aria-hidden="true"/> Eigene Szene</button></div>
  <div className="scene-toolbar"><label className="scene-search"><Search size={18} aria-hidden="true"/><span className="scene-sr-only">Szenen suchen</span><input type="search" placeholder="Szenen suchen …" value={search} onChange={e=>setSearch(e.target.value)}/></label><label><span className="scene-sr-only">Szenenkategorie filtern</span><select aria-label="Szenenkategorie filtern" value={category} onChange={e=>setCategory(e.target.value)}><option value="">Alle Kategorien</option>{categories.map(name=><option key={name}>{name}</option>)}</select></label><button type="button" aria-pressed={favoritesOnly} className={favoritesOnly?'scene-favorite-filter active':'scene-favorite-filter'} onClick={()=>setFavoritesOnly(!favoritesOnly)}><Star size={17} aria-hidden="true"/> Favoriten</button><button type="button" disabled={!profilesReady} onClick={()=>fileInput.current.click()}><Upload size={17} aria-hidden="true"/> Importieren</button><button type="button" onClick={()=>exportScenes(scenes)}><Download size={17} aria-hidden="true"/> Alle exportieren</button><input hidden ref={fileInput} type="file" accept=".json,application/json" aria-label="Szenendatei importieren" onChange={e=>{importFile(e.target.files?.[0]);e.target.value='';}}/></div>
  {notice?<p className={'scene-notice '+notice.type} role={notice.type==='error'?'alert':'status'}>{notice.message}</p>:null}
  {!profilesReady?<p className="scene-empty" role="status">Deine gespeicherten Szenen werden geladen …</p>:null}
  <div className="scene-card-grid">{filtered.map(scene=><article key={scene.id} className={'scene-managed-card'+((active===scene.name||active===scene.id)?' selected':'')}>
   <button type="button" className="scene-card-preview" aria-label={`Szene ${scene.name} in der Vorschau auswählen`} aria-pressed={active===scene.name||active===scene.id} onClick={()=>choose(scene)}><SceneMiniPreview config={scene.config} label={`${scene.name}: ${EFFECT_NAMES[scene.config.effect]}`}/><span className="scene-card-copy"><span className="scene-card-title-row"><span className="scene-card-name">{scene.name}</span>{active===scene.name||active===scene.id?<Check className="scene-selected-icon" size={17} aria-label="In der Vorschau ausgewählt"/>:null}</span><span className="scene-card-meta">{scene.category||'Eigene'} · {EFFECT_NAMES[scene.config.effect]}</span></span></button>
   <button type="button" className="scene-card-favorite" disabled={!profilesReady} aria-label={`${scene.name} ${scene.favorite?'aus Favoriten entfernen':'als Favorit speichern'}`} aria-pressed={Boolean(scene.favorite)} onClick={()=>toggleFavorite(scene)}><Star size={19} fill={scene.favorite?'currentColor':'none'} aria-hidden="true"/></button>
   <div className="scene-card-actions"><button type="button" disabled={!profilesReady} onClick={()=>openEditor(scene)}><SlidersHorizontal size={15} aria-hidden="true"/> Bearbeiten</button><button type="button" disabled={!profilesReady} aria-label={`${scene.name} duplizieren`} onClick={()=>openEditor(scene,{duplicate:true})}><Copy size={15} aria-hidden="true"/> Duplizieren</button></div>
  </article>)}</div>
  {!filtered.length?<p className="scene-empty">Keine Szene gefunden. Passe den Filter an oder erstelle deine eigene Szene.</p>:null}
  <p className="scene-preview-hint">Die Lichtbänder zeigen Farben und Helligkeit des Effekts in der Vorschau. Mit „Auf Geräte anwenden“ im Beleuchtungsbereich übernimmst du das Licht auf deine Auswahl.</p>
  {draft?<section ref={editor} className="scene-editor" aria-label="Szene bearbeiten"><div className="scene-editor-heading"><h3>{draft.name||'Szene bearbeiten'}</h3><button type="button" onClick={()=>setDraft(null)}>Bearbeitung schließen</button></div><SceneMiniPreview config={draft.config} large label={`Vorschau der bearbeiteten Szene ${draft.name}`}/><div className="scene-editor-grid">
   <label>Name<input aria-label="Szenenname" value={draft.name} maxLength={60} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
   <label>Kategorie<input aria-label="Szenenkategorie" list="rgb-scene-categories" value={draft.category} maxLength={40} onChange={e=>setDraft({...draft,category:e.target.value})}/><datalist id="rgb-scene-categories">{categories.map(name=><option key={name} value={name}/>)}</datalist></label>
   <label>Effekt<select aria-label="Szeneneffekt" value={draft.config.effect} onChange={e=>editConfig({effect:e.target.value})}>{Object.entries(EFFECT_NAMES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
   <label>Richtung<select aria-label="Szenenrichtung" value={draft.config.direction} onChange={e=>editConfig({direction:e.target.value})}><option value="forward">Vorwärts</option><option value="reverse">Rückwärts</option></select></label>
   {[['brightness','Helligkeit',0],['speed','Geschwindigkeit',1],['scale','Musterdichte',1]].map(([key,label,min])=><label key={key} className="scene-range"><span>{label}<output>{draft.config[key]}{key==='brightness'?' %':''}</output></span><input aria-label={`Szenen${label.toLowerCase()}`} type="range" min={min} max="100" value={draft.config[key]} onChange={e=>editConfig({[key]:Number(e.target.value)})}/></label>)}
   <label className="scene-favorite-editor"><input type="checkbox" checked={Boolean(draft.favorite)} onChange={e=>setDraft({...draft,favorite:e.target.checked})}/> Als Favorit speichern</label>
  </div><p className="scene-effect-description">{EFFECT_DETAILS[draft.config.effect]?.description}</p>
  <fieldset className="scene-palette"><legend>Farben</legend><div>{draft.config.colors.map((color,index)=><SceneColor key={index} color={color} index={index} canRemove={draft.config.colors.length>1} onChange={value=>editConfig({colors:draft.config.colors.map((old,i)=>i===index?value:old)})} onRemove={()=>editConfig({colors:draft.config.colors.filter((_,i)=>i!==index)})}/>)}<button type="button" disabled={draft.config.colors.length>=8} onClick={()=>editConfig({colors:[...draft.config.colors,'#d8ad52']})}>+ Farbe</button></div></fieldset>
  {draft.config.effect==='custom'?<CustomEffectEditor config={draft.config} onChange={custom=>editConfig({custom})}/>:null}
  <fieldset className="scene-targets"><legend>Beteiligte Geräte</legend><p>Die Auswahl wird mit dieser Szene gespeichert.</p><div>{devices.map(device=><label key={device.id}><input type="checkbox" checked={draft.targetDevices.includes(device.id)} onChange={e=>edit({targetDevices:e.target.checked?[...draft.targetDevices,device.id]:draft.targetDevices.filter(id=>id!==device.id)})}/><span>{device.name}</span></label>)}</div>{!devices.length?<p>Derzeit sind keine Geräte verbunden. Du kannst die Szene trotzdem speichern.</p>:null}{availableSceneTargets(draft,devices)?.missing.length?<p role="status">{availableSceneTargets(draft,devices).missing.length} gespeicherte Geräte sind nicht verbunden. <button type="button" onClick={()=>edit({targetDevices:availableSceneTargets(draft,devices).available})}>Fehlende Zuordnungen entfernen</button></p>:null}</fieldset>
  <div className="scene-editor-actions"><button type="button" className="primary" disabled={!profilesReady} onClick={persistDraft}>Szene speichern</button><button type="button" onClick={()=>choose(draft)}>Vorschau auswählen</button><button type="button" onClick={()=>openEditor(draft,{duplicate:true})}>Als Kopie bearbeiten</button><button type="button" onClick={()=>exportScenes([draft])}>Exportieren</button>{profiles.some(scene=>scene.id===draft.id)?<button type="button" className="scene-delete" onClick={()=>setDeleteId(draft.id)}>{SCENES.some(scene=>scene.id===draft.id)?'Standard wiederherstellen':'Löschen'}</button>:null}</div>
  {deleteId===draft.id?<div className="scene-delete-confirm" role="group" aria-label="Szenenänderung bestätigen"><p>{SCENES.some(scene=>scene.id===draft.id)?'Gespeicherte Änderungen dieser Vorlage entfernen?':'Diese eigene Szene dauerhaft löschen?'}</p><button type="button" onClick={()=>remove(draft)}>Ja, bestätigen</button><button type="button" onClick={()=>setDeleteId(null)}>Abbrechen</button></div>:null}
  </section>:null}
 </section>;
}

export default SceneManager;
