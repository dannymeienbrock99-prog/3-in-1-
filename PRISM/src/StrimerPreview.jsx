import {useEffect,useRef,useState} from 'react';
import {createEffectSampler} from './effect-color.js';
import {EFFECT_NAMES,DEFAULT_CONFIG,validConfig} from './data.js';
import {STRIMER_CABLE_TYPES,STRIMER_WIRELESS_CABLE_TYPES,STRIMER_LCONNECT_MODES,STRIMER_SOURCES,STRIMER_WIRELESS_SOURCES,strimerCapabilities} from '../server/strimer-capabilities.mjs';
import './strimer-preview.css';

const KEY='batto.rgb.strimer-preview.v1';
function configs(input,max=12){const result={};for(const [id,value]of Object.entries(input||{}))if(/^\d{1,2}$/.test(id)&&Number(id)<max){try{result[id]=validConfig(value);}catch{}}return result;}
function read(){
 try{
  const raw=JSON.parse(localStorage.getItem(KEY)||'{}'),cable=raw.cable==='2x8'?'dual8pin':raw.cable,wirelessChannels={};
  for(const [id,value]of Object.entries(raw.wirelessChannels||{}).slice(0,32))if(id.length<=240)wirelessChannels[id]=configs(value);
  let offlineConfig;try{offlineConfig=validConfig(raw.offlineConfig);}catch{}
  return {mode:raw.mode==='separate'?'separate':'all',previewFamily:raw.previewFamily==='plus-v2'?'plus-v2':'wireless',cable:STRIMER_CABLE_TYPES.some(type=>type.id===cable)?cable:'24pin',wirelessCable:STRIMER_WIRELESS_CABLE_TYPES.some(type=>type.id===raw.wirelessCable)?raw.wirelessCable:'wireless-24pin',channels:configs(raw.channels,6),wirelessChannels,offlineConfig};
 }catch{return {mode:'all',previewFamily:'wireless',cable:'24pin',wirelessCable:'wireless-24pin',channels:{},wirelessChannels:{}};}
}

export function StrimerPreview({config=DEFAULT_CONFIG,onChange,running=true,devices=[]}){
 const [draft,setDraft]=useState(read),[channel,setChannel]=useState(0),[deviceChoice,setDeviceChoice]=useState(null),[virtual,setVirtual]=useState(false),[storageError,setStorageError]=useState('');
 const canvas=useRef(null),time=useRef(0);
 const recognised=devices.filter(device=>strimerCapabilities(device).family!=='unassigned');
 const selectedDevice=recognised.find(device=>String(device.id)===deviceChoice)||recognised.find(device=>strimerCapabilities(device).family==='wireless')||recognised[0];
 const offline=virtual||!selectedDevice;
 const capabilities=selectedDevice?strimerCapabilities(selectedDevice):null;
 const family=offline?draft.previewFamily:capabilities.family==='wireless'?'wireless':'plus-v2';
 const wireless=family==='wireless',familyTitle=wireless?'Strimer Wireless':'Strimer Plus V2',title=offline?'Strimer-Kabel':familyTitle;
 const cableTypes=wireless?STRIMER_WIRELESS_CABLE_TYPES:STRIMER_CABLE_TYPES;
 const selectedCable=wireless?offline?draft.wirelessCable:capabilities.cableType:draft.cable;
 const cableType=cableTypes.find(type=>type.id===selectedCable);
 const strands=cableType?.strands||0,ledCount=offline?cableType?.ledCount:Number.isInteger(selectedDevice?.ledCount)&&selectedDevice.ledCount>0?selectedDevice.ledCount:null;
 const ledsPerStrand=wireless?cableType?.ledsPerStrand:null;
 const channelCount=wireless?strands:cableType?.channels||strands/2;
 const channelIndex=Math.min(channel,Math.max(0,channelCount-1));
 const separate=draft.mode==='separate'&&channelCount>0;
 const draftKey=offline?selectedCable:`${selectedDevice?.provider||selectedDevice?.backend||''}:${selectedDevice?.id}:${selectedCable}`;
 const channelConfigs=wireless?draft.wirelessChannels[draftKey]||{}:draft.channels;
 const localOnly=offline||!selectedDevice?.directMode;
 const selectedHint=localOnly?'Die Änderungen bleiben lokale Vorschau; die Ausgabe der Herstellereffekte wird separat bestätigt.':'Die Ausgabeauswahl bleibt oben sichtbar. Eine Änderung des gemeinsamen Effekts wählt ausschließlich dieses direkt steuerbare Kabel.';
 const commonConfig=localOnly?draft.offlineConfig||config:config;
 const settings=separate?channelConfigs[channelIndex]||commonConfig:commonConfig;

 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(draft));setStorageError('');}catch{setStorageError('Kabelvorschau konnte nicht gespeichert werden.');}},[draft]);
 useEffect(()=>{
  const node=canvas.current,context=node.getContext('2d');if(!context)return;
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
 },[commonConfig,channelConfigs,separate,strands,wireless,ledsPerStrand,running]);

 function change(patch){
  const next={...settings,...patch};
  if(!separate){if(localOnly)setDraft(current=>({...current,offlineConfig:next}));else onChange?.(next,selectedDevice.id);return;}
  setDraft(current=>wireless?{...current,wirelessChannels:{...current.wirelessChannels,[draftKey]:{...(current.wirelessChannels[draftKey]||{}),[channelIndex]:next}}}:{...current,channels:{...current.channels,[channelIndex]:next}});
 }
 function chooseCable(value){setDraft(current=>({...current,[wireless?'wirelessCable':'cable']:value}));setChannel(0);}
 function resetChannels(){setDraft(current=>wireless?{...current,wirelessChannels:{...current.wirelessChannels,[draftKey]:{}}}:{...current,channels:{}});}

 return <section className="surface strimer-preview" aria-label={offline?'Virtuelle Strimer-Kabelvorschau':`${title} Kabelvorschau`} data-strimer-family={family}>
  <div className="strimer-heading"><div className="strimer-heading-copy"><span className="strimer-eyebrow">Kabel & Lichtleiter</span><div className="strimer-title-row"><h3>{title}</h3><span className={`strimer-preview-badge${offline?' virtual':''}`}>{offline?'Virtuelle Vorschau':'Gerät erkannt'}</span></div><p>{offline?`Virtuelle ${familyTitle}-Vorschau`:'Erkannte Kabelfamilie · animierte Vorschau'}</p></div>
   {recognised.length?<label className="strimer-device-choice">Gerät in der Kabelvorschau<select aria-label="Gerät in der Kabelvorschau" value={selectedDevice.id} onChange={event=>{setDeviceChoice(event.target.value);setVirtual(false);setChannel(0);}}>{recognised.map(device=><option key={device.id} value={device.id}>{device.name}</option>)}</select></label>:null}
  </div>
  <div className="strimer-preview-source">
   {recognised.length?<label><input type="checkbox" checked={virtual} onChange={event=>{setVirtual(event.target.checked);setChannel(0);if(event.target.checked)setDraft(current=>({...current,offlineConfig:current.offlineConfig||structuredClone(config)}));}}/>Virtuellen Kabeltyp ansehen</label>:null}
   {offline?<label>Vorschau-Familie<select aria-label="Familie der virtuellen Strimer-Vorschau" value={family} onChange={event=>{setDraft(current=>({...current,previewFamily:event.target.value}));setChannel(0);}}><option value="wireless">Strimer Wireless</option><option value="plus-v2">Strimer Plus V2 · kabelgebunden</option></select></label>:null}
   {offline||!wireless?<label>{offline?'Virtueller Kabeltyp':'Symbolischer Kabeltyp'}<select aria-label="Kabeltyp der Strimer-Vorschau" value={selectedCable||''} onChange={event=>chooseCable(event.target.value)}>{cableTypes.map(type=><option key={type.id} value={type.id}>{type.name} · {type.strands} Lichtleiter · {type.ledCount} LEDs</option>)}</select></label>:<p className="strimer-model">{cableType?.name||'Kabelmodell nicht bestätigt'} · {strands?`${strands} Lichtleiter · `:''}{Number.isInteger(ledCount)?`${ledCount} LEDs`:'LED-Anzahl nicht gemeldet'}</p>}
  </div>
  <div className="strimer-workbench"><div className="strimer-visual">
  <div className="strimer-visual-heading"><div><h4>Lichtvorschau</h4><span>{strands?`${strands} Lichtleiter`: 'Lineare LED-Vorschau'}{Number.isInteger(ledCount)?` · ${ledCount} LEDs`:''}</span></div><div className="segmented strimer-mode" aria-label="Darstellung der Lichtleiter">{[['all','Alle'],['separate','Getrennt']].map(([value,label])=><button key={value} disabled={value==='separate'&&!channelCount} aria-pressed={draft.mode===value} className={draft.mode===value?'active':''} onClick={()=>setDraft(current=>({...current,mode:value}))}>{label}</button>)}</div></div>
  <canvas ref={canvas} className="strimer-canvas" data-strand-count={strands} data-led-count={ledCount||0} data-leds-per-strand={ledsPerStrand||'symbolic'} data-physical-strand-map-verified="false" aria-label={`${strands?`${strands} ${familyTitle}-Lichtleiter`:'Lineare Strimer-LED-Vorschau'} · ${Number.isInteger(ledCount)?`${ledCount} LEDs`:'LED-Anzahl unbekannt'} · schematische Vorschau`}/>
  <p className="strimer-boundary">{offline?recognised.length?'Virtueller Kabeltyp. Keine Hardware wird dadurch zugeordnet.':`Kein Strimer-Gerät von der RGB-Anbindung gemeldet. Diese ${familyTitle}-Vorschau ist virtuell.`:`Vorschau für: ${selectedDevice.name}. ${selectedHint}`} {wireless?`${ledsPerStrand?`${strands} × ${ledsPerStrand} LEDs. `:strands?'Die Gesamtsumme ist bekannt; die Stränge sind symbolisch gleich lang dargestellt. ':''}Die physische Adresszuordnung zu den Lichtleitern ist nicht bestätigt. Getrennte Stränge bleiben ausschließlich Vorschau.`:'Getrennte Kanäle werden ausschließlich als Vorschau gespeichert; native Gesamteffekte bleiben im Bereich „Effekte deiner Geräte“.'}</p>
  {separate?<div className="strimer-channels" aria-label="Vorschaukanal wählen">{Array.from({length:channelCount},(_,index)=><button key={index} className={channelIndex===index?'active':''} aria-pressed={channelIndex===index} onClick={()=>setChannel(index)}>{wireless?'Strang':'Kanal'} {index+1}<small>{wireless?'Nur Vorschau':`Lichtleiter ${index*2+1}–${index*2+2}`}</small></button>)}</div>:null}
  </div><div className="strimer-control-panel"><h4>{separate?`${wireless?'Strang':'Kanal'} ${channelIndex+1} einstellen`:'Vorschau einstellen'}</h4><p>{separate?'Die Einstellung gilt für diesen Vorschaukanal.':'Ein gemeinsamer Effekt für alle Lichtleiter.'}</p>
  <div className="strimer-controls">
   <label>Effekt<select aria-label="Strimer-Vorschaueffekt" value={settings.effect} onChange={event=>change({effect:event.target.value})}>{Object.entries(EFFECT_NAMES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="strimer-color-control">Farbe<span className="strimer-color-value"><input type="color" aria-label="Strimer-Vorschaufarbe" value={settings.colors[0]} onChange={event=>change({colors:[event.target.value,...settings.colors.slice(1)]})}/><span>{settings.colors[0].toUpperCase()}</span></span></label>
   <label>Helligkeit<input type="range" aria-label="Strimer-Vorschauhelligkeit" min="0" max="100" value={settings.brightness} onChange={event=>change({brightness:+event.target.value})}/><output>{settings.brightness}%</output></label>
   <label>Tempo<input type="range" aria-label="Strimer-Vorschautempo" min="1" max="100" value={settings.speed} onChange={event=>change({speed:+event.target.value})}/><output>{settings.speed}%</output></label>
   <label>Richtung<select aria-label="Strimer-Vorschaurichtung" value={settings.direction} onChange={event=>change({direction:event.target.value})}><option value="forward">Vorwärts</option><option value="reverse">Rückwärts</option></select></label>
  </div>
  {separate?<button className="secondary" onClick={resetChannels}>{wireless?'Stränge':'Kanäle'} auf gemeinsamen Effekt zurücksetzen</button>:null}
  </div></div>
  {wireless?<details className="strimer-reference"><summary>Strimer Wireless · Erkennung und eigene Effekte</summary><p>Funkkabel werden einzeln über den L-Wireless-Empfänger erkannt. Die vorhandenen Batto-Effekte und eigenen RGB-Schleifen bleiben verfügbar. Die Vorschau legt keine neue Gerätezuordnung fest.</p><p>Eine frei gespeicherte Strang-Einstellung wird nicht als physische Kanaladresse übertragen. „Alle“ bereitet den gemeinsamen Effekt ausschließlich für das bewusst bearbeitete Funkkabel vor. Im virtuellen Modus bleibt auch dieser ausschließlich Vorschau.</p><p><a href={STRIMER_WIRELESS_SOURCES.product} target="_blank" rel="noreferrer">Strimer Wireless bei Lian Li</a> · <a href={STRIMER_WIRELESS_SOURCES.software} target="_blank" rel="noreferrer">L-Connect 3</a></p></details>:<details className="strimer-reference"><summary>L-Connect-Vergleich · 24 dokumentierte Modi</summary><p>Hersteller-Modusnamen der kabelgebundenen Familie zum Vergleich. Diese Tabelle ist keine Freigabe für USB-Befehle.</p><div className="strimer-reference-modes">{STRIMER_LCONNECT_MODES.map(mode=><span key={mode.referenceId}>{mode.name}</span>)}</div>{!offline&&selectedDevice?<p>{strimerCapabilities(selectedDevice).limitation}</p>:null}<p>{strimerCapabilities().documentationConflict}</p><p><a href={STRIMER_SOURCES.manual} target="_blank" rel="noreferrer">Lian-Li-Handbuch</a> · <a href={STRIMER_SOURCES.product} target="_blank" rel="noreferrer">Strimer Plus V2</a></p></details>}
  {storageError?<p role="status">{storageError}</p>:null}
 </section>;
}
