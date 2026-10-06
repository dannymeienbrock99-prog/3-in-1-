import {useEffect,useRef,useState} from 'react';
import {createEffectSampler} from './effect-color.js';
import {EFFECT_NAMES,EFFECT_DETAILS,DEFAULT_CONFIG,validConfig,api} from './data.js';
import {normalizeStrimerDraft,strimerIdentity} from '../server/strimer-draft.mjs';
import {createStrimerStore} from './strimer-store.mjs';
import {strimerConnectionState,strimerTransmissionState,strimerControlPresentation,strimerControlRequest} from './strimer-output.mjs';
import {CustomEffectEditor} from './CustomEffectEditor.jsx';
import {LConnectImport} from './LConnectImport.jsx';
import {STRIMER_CABLE_TYPES,STRIMER_WIRELESS_CABLE_TYPES,STRIMER_LCONNECT_MODES,STRIMER_SOURCES,STRIMER_WIRELESS_SOURCES,strimerCapabilities} from '../server/strimer-capabilities.mjs';
import './strimer-preview.css';

const KEY='batto.rgb.strimer-preview.v1';
const EMBEDDED=new URLSearchParams(window.location.search).get('embedded')==='1';
const embeddedStore=createStrimerStore(api);
function read(){
 try{return normalizeStrimerDraft(JSON.parse(localStorage.getItem(KEY)||'{}'),validConfig);}
 catch{return normalizeStrimerDraft({},validConfig);}
}

export function StrimerPreview({config=DEFAULT_CONFIG,onChange,onApply,onNotify,onRefresh,onControl,strimerControl,native={},running=true,devices=[],busy=false}){
 const [draft,setDraft]=useState(read),[channel,setChannel]=useState(0),[deviceChoice,setDeviceChoice]=useState(null),[virtual,setVirtual]=useState(false),[storageError,setStorageError]=useState('');
 const [draftReady,setDraftReady]=useState(!EMBEDDED);
 const [persistenceReady,setPersistenceReady]=useState(!EMBEDDED);
 const [output,setOutput]=useState(null),[refreshError,setRefreshError]=useState(''),[submitting,setSubmitting]=useState(false);
 const [pauseConsent,setPauseConsent]=useState(false),[controlError,setControlError]=useState(''),[takingControl,setTakingControl]=useState(false);
 const handoff=strimerControlPresentation(strimerControl);
 const waiting=busy||submitting||takingControl||handoff.changing||!draftReady;
 const canvas=useRef(null),time=useRef(0);
 const recognised=devices.filter(device=>strimerCapabilities(device).family!=='unassigned');
 const selectedDevice=recognised.find(device=>strimerIdentity(device)===draft.deviceChoice)||recognised.find(device=>!strimerIdentity(device)&&String(device.id)===deviceChoice)||recognised.find(device=>strimerCapabilities(device).family==='wireless')||recognised[0];
 const rememberedMissing=Boolean(draft.deviceChoice&&!recognised.some(device=>strimerIdentity(device)===draft.deviceChoice)||deviceChoice&&!recognised.some(device=>!strimerIdentity(device)&&String(device.id)===deviceChoice));
 const offline=virtual||!selectedDevice||rememberedMissing;
 const capabilities=selectedDevice?strimerCapabilities(selectedDevice):null;
 const family=virtual?draft.previewFamily:!selectedDevice||rememberedMissing||capabilities.family==='wireless'?'wireless':'plus-v2';
 const wireless=family==='wireless',familyTitle=wireless?'Strimer Wireless':'Strimer Plus V2',title=virtual?`${familyTitle} · Demo`:selectedDevice&&!rememberedMissing?familyTitle:'Strimer Wireless';
 const cableTypes=wireless?STRIMER_WIRELESS_CABLE_TYPES:STRIMER_CABLE_TYPES;
 const selectedCable=wireless?offline?draft.wirelessCable:capabilities.cableType:draft.cable;
 const cableType=cableTypes.find(type=>type.id===selectedCable);
 const strands=cableType?.strands||0,ledCount=offline?cableType?.ledCount:Number.isInteger(selectedDevice?.ledCount)&&selectedDevice.ledCount>0?selectedDevice.ledCount:null;
 const ledsPerStrand=wireless?cableType?.ledsPerStrand:null;
 const channelCount=wireless?strands:cableType?.channels||strands/2;
 const channelIndex=Math.min(channel,Math.max(0,channelCount-1));
 const separate=draft.mode==='separate'&&channelCount>0;
 const draftKey=offline?selectedCable:`${strimerIdentity(selectedDevice)||'unassigned'}:${selectedCable}`;
 const channelConfigs=wireless?draft.wirelessChannels[draftKey]||{}:draft.channels;
 const localOnly=offline||!capabilities?.directAvailable;
 const connection=strimerConnectionState({native,recognised,selectedDevice,rememberedMissing});
 const showWorkbench=virtual||Boolean(selectedDevice&&!rememberedMissing);
 const selectedHint=localOnly?'Eigene Effekte sind für dieses Gerät derzeit nicht freigegeben.':'„Auf dieses Kabel übertragen“ sendet den gemeinsamen Effekt ausschließlich an dieses Kabel.';
 const commonConfig=draft.offlineConfig||config;
 const settings=separate?channelConfigs[channelIndex]||commonConfig:commonConfig;
 const effectDetails=EFFECT_DETAILS[settings.effect]||EFFECT_DETAILS.static;
 const outputIdentity=strimerIdentity(selectedDevice)||selectedDevice?.id;
 const shownOutput=output?.identity===outputIdentity?output:null;
 const changedSinceOutput=shownOutput&&shownOutput.settings!==JSON.stringify(settings);

 useEffect(()=>{
  if(!EMBEDDED)return;let alive=true;
  embeddedStore.load().then(value=>{if(!alive)return;if(value.draft)setDraft(normalizeStrimerDraft(value.draft,validConfig));setPersistenceReady(true);setDraftReady(true);}).catch(()=>{if(alive){setStorageError('Gespeicherte Kabelentwürfe konnten nicht geladen werden. Du kannst Geräte prüfen und neue Effekte einstellen; bestehende Entwürfe werden nicht überschrieben.');setDraftReady(true);}});
  return()=>{alive=false;};
 },[]);
 useEffect(()=>{
  if(!draftReady||!persistenceReady)return;
  if(EMBEDDED){let alive=true;embeddedStore.save(draft).then(()=>{if(alive)setStorageError('');}).catch(()=>{if(alive)setStorageError('Kabelvorschau konnte nicht gespeichert werden.');});return()=>{alive=false;};}
  try{localStorage.setItem(KEY,JSON.stringify(draft));setStorageError('');}catch{setStorageError('Kabelvorschau konnte nicht gespeichert werden.');}
 },[draft,draftReady,persistenceReady]);
 useEffect(()=>{
  const node=canvas.current;if(!node)return;const context=node.getContext('2d');if(!context)return;
  let frame,last,lastPaint,visible=true;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const render=()=>{
   const width=node.width,height=node.height,rows=strands||1,left=width*.055,right=width*.945,gap=height/(rows+1);
   context.clearRect(0,0,width,height);context.fillStyle='#10100e';context.fillRect(0,0,width,height);
   // GPU Wireless only exposes a flat LED list. Equal symbolic strands never
   // pretend to establish how its 116/174 addresses map to physical guides.
   const segments=wireless&&ledsPerStrand?ledsPerStrand:72;
   for(let strand=0;strand<rows;strand++){
    const id=wireless?strand:Math.floor(strand/2),value=separate?channelConfigs[id]||commonConfig:commonConfig,sample=createEffectSampler(value,time.current);
    for(let i=0;i<segments;i++){
     const {color,alpha}=sample(i/Math.max(1,segments-1),strand*segments+i);
     context.strokeStyle=`rgba(${color.join(',')},${alpha})`;context.shadowColor=context.strokeStyle;context.shadowBlur=9;context.lineWidth=Math.max(2,gap*.42);
     context.beginPath();context.moveTo(left+(right-left)*i/segments,gap*(strand+1));context.lineTo(left+(right-left)*(i+.93)/segments,gap*(strand+1));context.stroke();
    }
    context.shadowBlur=0;
   }
   context.fillStyle='#282820';context.fillRect(0,0,left*.78,height);context.fillRect(right+left*.22,0,width-right,height);
  };
  const resize=()=>{const rect=node.getBoundingClientRect();node.width=Math.max(1,rect.width*Math.min(devicePixelRatio||1,2));node.height=Math.max(1,rect.height*Math.min(devicePixelRatio||1,2));render();};
  const tick=now=>{if(last!==undefined)time.current+=Math.min(.06,(now-last)/1000);last=now;if(lastPaint===undefined||now-lastPaint>=33){render();lastPaint=now;}frame=requestAnimationFrame(tick);};
  const animate=()=>{cancelAnimationFrame(frame);last=undefined;lastPaint=undefined;render();if(visible&&!document.hidden&&running&&!media.matches)frame=requestAnimationFrame(tick);};
  const observer=new ResizeObserver(resize);observer.observe(node);
  const visibility=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;animate();},{rootMargin:'100px'});visibility.observe(node);
  document.addEventListener('visibilitychange',animate);media.addEventListener('change',animate);resize();animate();
  return()=>{observer.disconnect();visibility.disconnect();document.removeEventListener('visibilitychange',animate);media.removeEventListener('change',animate);cancelAnimationFrame(frame);};
 },[commonConfig,channelConfigs,separate,strands,wireless,ledsPerStrand,running,showWorkbench]);

 function change(patch){
  const next={...settings,...patch};
  if(!separate){setDraft(current=>({...current,offlineConfig:next}));return;}
  setDraft(current=>wireless?{...current,wirelessChannels:{...current.wirelessChannels,[draftKey]:{...(current.wirelessChannels[draftKey]||{}),[channelIndex]:next}}}:{...current,channels:{...current.channels,[channelIndex]:next}});
 }
 function chooseCable(value){setDraft(current=>({...current,[wireless?'wirelessCable':'cable']:value}));setChannel(0);}
 function resetChannels(){setDraft(current=>wireless?{...current,wirelessChannels:{...current.wirelessChannels,[draftKey]:{}}}:{...current,channels:{}});}
 function confirmPreview(){if(!separate)onChange?.(settings);onNotify?.(separate?`${wireless?'Strang':'Kanal'} ${channelIndex+1}: Vorschaueffekt bestätigt.`:'Vorschaueffekt bestätigt. Deine Geräteauswahl bleibt erhalten.');}
 function importPreview({cable,previewPatch}){
  // A saved manufacturer group is a source preset, never a physical strand.
  // Import always enters virtual mode and preserves global targets and output.
  const next=validConfig({...settings,...previewPatch});
  setDraft(current=>({...current,mode:'all',previewFamily:'wireless',wirelessCable:cable.cableType,deviceChoice:cable.identity,offlineConfig:next}));
  setDeviceChoice(null);setVirtual(true);setChannel(0);
 }
 async function refresh(){
  if(waiting||!onRefresh)return;setRefreshError('');setSubmitting(true);
  try{await onRefresh();}catch(error){setRefreshError(error.message||'Die Kabelsuche konnte nicht abgeschlossen werden.');}finally{setSubmitting(false);}
 }
 async function transmit(){
  if(waiting||localOnly||separate||!onApply)return;
  const device=selectedDevice,identity=outputIdentity,value=structuredClone(settings);
  setSubmitting(true);setOutput({identity,settings:JSON.stringify(value),phase:'sending',title:'Effekt wird übertragen …',message:`Ziel: ${device.name}`});
  try{const result=await onApply(value,device.id);const state=strimerTransmissionState(result,device);setOutput({identity,settings:JSON.stringify(value),...state});onNotify?.(state.title,state.phase==='pending'?'info':'success');}
  catch(error){setOutput({identity,settings:JSON.stringify(value),phase:'error',title:'Übertragung fehlgeschlagen',message:error.message||'Die Ausgabe konnte nicht bestätigt werden.'});onNotify?.(error.message||'Die Strimer-Ausgabe konnte nicht bestätigt werden.','error');}
  finally{setSubmitting(false);}
 }
 async function control(){
  if(waiting||!onControl||!handoff.returnRequired&&!pauseConsent)return;
  const enabled=!handoff.returnRequired;
  setTakingControl(true);setControlError('');
  try{await onControl(strimerControlRequest(strimerControl,pauseConsent));setPauseConsent(false);if(enabled)setVirtual(false);}
  catch(error){setControlError(error.message||'Die Strimer-Steuerung konnte nicht umgeschaltet werden.');}
  finally{setTakingControl(false);}
 }

 return <section className="surface strimer-preview" aria-label={virtual?'Strimer Demo-Vorschau':'Strimer-Kabel steuern'} data-strimer-family={family} inert={!draftReady}>
  <div className="strimer-heading"><div className="strimer-heading-copy"><span className="strimer-eyebrow">Kabel & Lichtleiter</span><div className="strimer-title-row"><h3>{title}</h3><span className={`strimer-preview-badge${virtual||connection.phase!=='ready'?' virtual':''}`}>{virtual?'Demo · keine Ausgabe':connection.phase==='ready'?'Bereit zur Ausgabe':'Verbindung prüfen'}</span></div><p>{virtual?'Deine gespeicherten Entwürfe · ohne Hardware-Ausgabe':selectedDevice&&!rememberedMissing?selectedDevice.name:'Eigene Effekte an deine Strimer-Wireless-Kabel übertragen.'}</p></div>
   {recognised.length?<label className="strimer-device-choice">Zielkabel<select aria-label="Strimer-Zielkabel" value={rememberedMissing?'':selectedDevice.id} disabled={waiting} onChange={event=>{const device=recognised.find(value=>String(value.id)===event.target.value);setDeviceChoice(strimerIdentity(device)?null:event.target.value);setDraft(current=>({...current,deviceChoice:strimerIdentity(device)||undefined}));setVirtual(false);setChannel(0);}}>{rememberedMissing?<option value="" disabled>Gespeichertes Kabel nicht verbunden · Gerät wählen</option>:null}{recognised.map(device=><option key={device.id} value={device.id}>{device.name}</option>)}</select></label>:null}
  </div>
  {handoff.returnRequired||!virtual&&wireless?<section className={`strimer-handoff ${handoff.phase}`} aria-label="Strimer-Steuerung übergeben"><div><strong>{handoff.title}</strong><p>{handoff.message}</p></div>{!handoff.returnRequired?<><label className="strimer-handoff-consent"><input type="checkbox" checked={pauseConsent} disabled={waiting} onChange={event=>setPauseConsent(event.target.checked)}/><span>L-Connect-Dienste während der Strimer-Steuerung pausieren</span></label><p className="strimer-handoff-explanation">L-Connect kann in dieser Zeit seine Lüfter und Controller nicht verwalten. iCUE bleibt erhalten. Beim Zurückgeben oder Beenden von Batto wird der vorherige Zustand der L-Connect-Dienste wiederhergestellt.</p></>:null}<button type="button" className={handoff.returnRequired?'secondary':'primary'} disabled={waiting||!onControl||!handoff.returnRequired&&!pauseConsent} onClick={control}>{takingControl?handoff.returnRequired?'L-Connect wird wiederhergestellt …':'Windows-Freigabe abwarten …':handoff.button}</button>{!handoff.returnRequired?<small>Windows kann eine Administratorbestätigung anzeigen. Das Übernehmen allein ändert noch keinen RGB-Effekt.</small>:null}{controlError?<p className="strimer-refresh-error" role="alert">{controlError}</p>:null}</section>:null}
  {!virtual?<div className={`strimer-connection-state ${connection.phase}`} role="status"><div><strong>{connection.title}</strong><p>{connection.message}</p></div><button type="button" className="secondary" disabled={waiting||!onRefresh} onClick={refresh}>{submitting&&!shownOutput?'Kabel werden gesucht …':'Kabel erneut suchen'}</button></div>:null}
  {refreshError?<p className="strimer-refresh-error" role="alert">{refreshError}</p>:null}
  {!virtual&&wireless&&connection.phase!=='ready'?<div className="strimer-connection-help"><ol><li>L-Wireless-Controller per USB anschließen und die Stromversorgung der Strimer-Kabel prüfen.</li><li>In L-Connect 3 die Kabel mit dem Funkcontroller koppeln und „Motherboard Sync“ für die eigene Kabelsteuerung ausschalten.</li><li>Falls der Zugriff belegt ist: die andere Steuerung in L-Connect beenden, dann „Kabel erneut suchen“ wählen.</li></ol>{connection.diagnostics.length?<details><summary>Gemeldete Controller und Zugriffsdetails</summary>{connection.diagnostics.map((item,index)=><article key={index}><strong>{item.name||'L-Wireless-Controller'}</strong><p>{item.reason||item.message||'Controller erkannt; kein steuerbares Kabel gemeldet.'}</p>{item.code?<small>{item.code}{item.stage?` · ${item.stage}`:''}</small>:null}</article>)}</details>:null}<a href={STRIMER_WIRELESS_SOURCES.software} target="_blank" rel="noreferrer">L-Connect 3 öffnen / herunterladen</a></div>:null}
  <div className="strimer-demo-actions"><button type="button" className="text-link" disabled={waiting} onClick={()=>{setVirtual(value=>!value);setChannel(0);if(!virtual)setDraft(current=>({...current,offlineConfig:current.offlineConfig||structuredClone(config)}));}}>{virtual?'Zurück zur Kabelsteuerung':'Demo-Vorschau und gespeicherte Entwürfe'}</button>{!virtual&&showWorkbench?<small>Änderungen werden erst mit „Auf dieses Kabel übertragen“ gesendet.</small>:null}</div>
  {showWorkbench?<>
  <div className="strimer-preview-source">
   {offline?<label>Demo-Familie<select disabled={waiting} aria-label="Familie der virtuellen Strimer-Vorschau" value={family} onChange={event=>{setDraft(current=>({...current,previewFamily:event.target.value}));setChannel(0);}}><option value="wireless">Strimer Wireless</option><option value="plus-v2">Strimer Plus V2 · kabelgebunden</option></select></label>:null}
   {offline||!wireless?<label>{offline?'Virtueller Kabeltyp':'Symbolischer Kabeltyp'}<select disabled={waiting} aria-label="Kabeltyp der Strimer-Vorschau" value={selectedCable||''} onChange={event=>chooseCable(event.target.value)}>{cableTypes.map(type=><option key={type.id} value={type.id}>{type.name} · {type.strands} Lichtleiter · {type.ledCount} LEDs</option>)}</select></label>:<p className="strimer-model">{cableType?.name||'Kabelmodell nicht bestätigt'} · {strands?`${strands} Lichtleiter · `:''}{Number.isInteger(ledCount)?`${ledCount} LEDs`:'LED-Anzahl nicht gemeldet'}</p>}
  </div>
  <div className="strimer-workbench"><div className="strimer-visual">
  <div className="strimer-visual-heading"><div><h4>{virtual?'Demo-Lichtvorschau':'Effekt auf deinem Kabel vorbereiten'}</h4><span>{strands?`${strands} Lichtleiter`: 'Lineare LED-Vorschau'}{Number.isInteger(ledCount)?` · ${ledCount} LEDs`:''}</span></div><div className="segmented strimer-mode" aria-label="Darstellung der Lichtleiter">{[['all','Ganzes Kabel'],['separate','Strang-Demo']].map(([value,label])=><button key={value} disabled={waiting||value==='separate'&&!channelCount} aria-pressed={draft.mode===value} className={draft.mode===value?'active':''} onClick={()=>setDraft(current=>({...current,mode:value}))}>{label}</button>)}</div></div>
  <canvas ref={canvas} className="strimer-canvas" data-strand-count={strands} data-led-count={ledCount||0} data-leds-per-strand={ledsPerStrand||'symbolic'} data-physical-strand-map-verified="false" aria-label={`${strands?`${strands} ${familyTitle}-Lichtleiter`:'Lineare Strimer-LED-Vorschau'} · ${Number.isInteger(ledCount)?`${ledCount} LEDs`:'LED-Anzahl unbekannt'} · schematische Vorschau`}/>
  <p className="strimer-boundary">{offline?recognised.length?'Virtueller Kabeltyp. Keine Hardware wird dadurch zugeordnet.':`Kein Strimer-Gerät von der RGB-Anbindung gemeldet. Diese ${familyTitle}-Vorschau ist virtuell.`:`Vorschau für: ${selectedDevice.name}. ${selectedHint}`} {wireless?`${ledsPerStrand?`${strands} × ${ledsPerStrand} LEDs. `:strands?'Die Gesamtsumme ist bekannt; die Stränge sind symbolisch gleich lang dargestellt. ':''}Die physische Adresszuordnung zu den Lichtleitern ist nicht bestätigt. Getrennte Stränge bleiben ausschließlich Vorschau.`:'Getrennte Kanäle werden ausschließlich als Vorschau gespeichert; native Gesamteffekte bleiben im Bereich „Effekte deiner Geräte“.'}</p>
  {separate?<div className="strimer-channels" aria-label="Vorschaukanal wählen">{Array.from({length:channelCount},(_,index)=><button key={index} disabled={waiting} className={channelIndex===index?'active':''} aria-pressed={channelIndex===index} onClick={()=>setChannel(index)}>{wireless?'Strang':'Kanal'} {index+1}<small>{wireless?'Nur Vorschau':`Lichtleiter ${index*2+1}–${index*2+2}`}</small></button>)}</div>:null}
  </div><div className="strimer-control-panel"><h4>{separate?`${wireless?'Strang':'Kanal'} ${channelIndex+1} · Demo`:'Kabeleffekt einstellen'}</h4><p>{separate?'Für echte Ausgabe wähle „Ganzes Kabel“. Getrennte Stränge sind noch nicht als Hardwarekanäle freigegeben.':'Ein gemeinsamer Effekt für alle Lichtleiter.'}</p>
  <fieldset className="strimer-controls" disabled={waiting}>
   <label>Effekt<select aria-label="Strimer-Vorschaueffekt" value={settings.effect} onChange={event=>change({effect:event.target.value})}>{Object.entries(EFFECT_NAMES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   {effectDetails.colors!=='spectrum'?<div className="strimer-palette"><span>{effectDetails.colors==='first'?'Farbe':'Farbpalette'}</span><div>{(effectDetails.colors==='first'?settings.colors.slice(0,1):settings.colors).map((color,index)=><label className="strimer-color-value" key={index}><input type="color" aria-label={index===0?'Strimer-Vorschaufarbe':`Strimer-Farbe ${index+1}`} value={color} onChange={event=>change({colors:settings.colors.map((value,i)=>i===index?event.target.value:value)})}/><span>{color.toUpperCase()}</span>{effectDetails.colors!=='first'&&settings.colors.length>1?<button type="button" aria-label={`Strimer-Farbe ${index+1} entfernen`} onClick={()=>change({colors:settings.colors.filter((_,i)=>i!==index)})}>×</button>:null}</label>)}</div>{effectDetails.colors!=='first'&&settings.colors.length<8?<button type="button" className="secondary" onClick={()=>change({colors:[...settings.colors,'#ffffff']})}>Farbe hinzufügen</button>:null}</div>:<p className="strimer-spectrum-note">Dieser Effekt nutzt das automatische Regenbogenspektrum.</p>}
   <label>Helligkeit<input type="range" aria-label="Strimer-Vorschauhelligkeit" min="0" max="100" value={settings.brightness} onChange={event=>change({brightness:+event.target.value})}/><output>{settings.brightness}%</output></label>
   <label>Tempo<input type="range" aria-label="Strimer-Vorschautempo" min="1" max="100" value={settings.speed} onChange={event=>change({speed:+event.target.value})}/><output>{settings.speed}%</output></label>
   <label>Richtung<select aria-label="Strimer-Vorschaurichtung" value={settings.direction} onChange={event=>change({direction:event.target.value})}><option value="forward">Vorwärts</option><option value="reverse">Rückwärts</option></select></label>
   {effectDetails.scale?<label>{effectDetails.scale.label}<input type="range" aria-label={`Strimer ${effectDetails.scale.label}`} min="1" max="100" value={settings.scale} onChange={event=>change({scale:+event.target.value})}/><output>{settings.scale}%</output></label>:null}
  </fieldset>
  {settings.effect==='custom'?<div className="strimer-custom-editor" inert={waiting}><CustomEffectEditor config={settings} onChange={value=>change({custom:value})} running={running}/></div>:null}
  {!virtual&&!separate?<button className="primary strimer-apply" disabled={waiting||localOnly||!onApply} onClick={transmit}>{submitting?'Wird übertragen …':'Auf dieses Kabel übertragen'}</button>:null}
  {!virtual&&!separate&&localOnly?<p>Für dieses Kabel ist aktuell keine direkte RGB-Ausgabe freigegeben.</p>:null}
  {!virtual&&shownOutput?<div className={`strimer-output-state ${shownOutput.phase}`} role={shownOutput.phase==='error'?'alert':'status'} aria-live="polite"><strong>{shownOutput.title}</strong><p>{shownOutput.message}</p>{changedSinceOutput?<small>Neue Änderungen sind noch nicht übertragen.</small>:null}</div>:null}
  {virtual||separate?<button className="secondary" disabled={waiting} onClick={confirmPreview}>Entwurf für die Setup-Vorschau übernehmen</button>:null}
  {separate?<button className="secondary" disabled={waiting} onClick={resetChannels}>{wireless?'Stränge':'Kanäle'} auf gemeinsamen Effekt zurücksetzen</button>:null}
  </div></div>
  </>:null}
  <LConnectImport disabled={waiting} onImport={importPreview}/>
  {wireless?<details className="strimer-reference"><summary>Strimer Wireless · Ausgabe und Bestätigung</summary><p>Deine erkannten Kabel werden einzeln über den L-Wireless-Controller angesprochen. Batto überträgt den eingestellten Effekt als RGB-Schleife; sie läuft anschließend im Strimer-Kabel weiter. Alle vorhandenen Effekte und eigenen Muster bleiben verfügbar.</p><p>„Funkempfänger bestätigt“ bedeutet, dass die Bestätigung zum übertragenen Effekt empfangen wurde. „Funkbestätigung steht aus“ bestätigt lediglich die Übertragung an den Controller. Die Animation auf dem Bildschirm ist keine Bestätigung der tatsächlichen Kabelbeleuchtung.</p><p>Eine getrennte Einstellung einzelner Lichtleiter bleibt ein gespeicherter Demo-Entwurf, solange die physische Kanalzuordnung nicht geprüft ist. Für die reale Ausgabe wähle „Ganzes Kabel“.</p><p><a href={STRIMER_WIRELESS_SOURCES.product} target="_blank" rel="noreferrer">Strimer Wireless bei Lian Li</a> · <a href={STRIMER_WIRELESS_SOURCES.software} target="_blank" rel="noreferrer">L-Connect 3</a></p></details>:<details className="strimer-reference"><summary>L-Connect-Vergleich · 24 dokumentierte Modi</summary><p>Hersteller-Modusnamen der kabelgebundenen Familie zum Vergleich. Diese Tabelle ist keine Freigabe für USB-Befehle.</p><div className="strimer-reference-modes">{STRIMER_LCONNECT_MODES.map(mode=><span key={mode.referenceId}>{mode.name}</span>)}</div>{!offline&&selectedDevice?<p>{strimerCapabilities(selectedDevice).limitation}</p>:null}<p>{strimerCapabilities().documentationConflict}</p><p><a href={STRIMER_SOURCES.manual} target="_blank" rel="noreferrer">Lian-Li-Handbuch</a> · <a href={STRIMER_SOURCES.product} target="_blank" rel="noreferrer">Strimer Plus V2</a></p></details>}
  {storageError?<p role="status">{storageError}</p>:null}
 </section>;
}
