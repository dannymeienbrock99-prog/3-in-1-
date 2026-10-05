import { useEffect, useState } from 'react';
import { Play, Sun, Gauge, Plus, X } from 'lucide-react';

export function NativeEffects({ device, busy, onApply, peers = [] }) {
  const supported = Array.isArray(device.nativeEffects) ? device.nativeEffects : [];
  const effects = Array.isArray(device.nativeEffectCatalog) ? device.nativeEffectCatalog.map(effect=>({...effect,...supported.find(value=>value.id===effect.id),supported:effect.available !== false&&supported.some(value=>value.id===effect.id&&value.supported!==false)})) : supported;
  const available = effects.filter(effect => effect.supported !== false);
  const [chosen, setChosen] = useState('');
  const [confirmController,setConfirmController]=useState(false);
  useEffect(()=>setConfirmController(false),[device.id,device.name,device.wholeControllerOnly]);
  const [colors, setColors] = useState(['#8b5cf6', '#06b6d4', '#ff4f9a']);
  const [brightness, setBrightness] = useState(80), [speed, setSpeed] = useState(50), [direction, setDirection] = useState('forward');
  const [advanced, setAdvanced] = useState({ background:'#101010', irDelay:0, length:0, width:0, hue:0, multicolor:false, powerSaving:false });
  const effectId = available.some(effect => effect.id === chosen) ? chosen : available[0]?.id || '';
  if (!effects.length) return null;
  const effect = effects.find(value => value.id === effectId);
  const activeState=typeof device.activeNativeEffect==='object'?device.activeNativeEffect:device.nativeSettings;
  const activeId=activeState?.effectId||(typeof device.activeNativeEffect==='string'?device.activeNativeEffect:null);
  const controls = effect?.controls || {};
  const maxColors = Math.max(1, Math.min(10, effect?.colorsMax ?? 8));
  const settings = { effectId, colors: colors.slice(0,maxColors), brightness, speed, direction:controls.direction===false?'forward':direction,
    ...(device.wholeControllerOnly&&confirmController?{controllerScope:'all',confirmWholeController:true}:{}),
    ...Object.fromEntries(Object.entries(advanced).filter(([key]) => controls[key] === true).map(([key,value]) => [key,['irDelay','length'].includes(key) ? Math.max(effect?.[key+'Min'] || 0, Math.min(effect?.[key+'Max'] || 0,value)) : value])) };
  const compatible = peers.filter(peer => !peer.wholeControllerOnly && peer.provider === device.provider && peer.nativeEffects?.some(value => value.id === effectId && value.supported !== false));
  async function applyTo(deviceIds){if(device.wholeControllerOnly&&!confirmController)return;try{await onApply({...settings,deviceIds});}finally{setConfirmController(false);}}
  return <section className="native-effects" aria-label={`Herstellereffekte für ${device.name}`}>
    <div className="native-effects__heading"><h4>Herstellereffekte</h4><span>{available.length} verfügbar · {effects.length} im Katalog</span></div>
    <p>{device.wholeControllerOnly?'Dieser Effekt ändert alle angeschlossenen Strimer-Kanäle; „Getrennt“ bleibt Vorschau.':'Der Effekt läuft im Gerät. Anwenden ändert nur den genannten Anschluss oder RAM-Riegel.'}</p>
    <label className="native-effects__select">Effekt<select aria-label={`Herstellereffekt für ${device.name}`} value={effectId} disabled={busy || !available.length} onChange={event => setChosen(event.target.value)}>
      {!available.length ? <option value="">Für dieses Gerät nicht verfügbar</option> : null}
      {effects.map(value => <option key={value.id} value={value.id} disabled={value.supported === false}>{value.name}{value.supported === false ? ' · nicht verfügbar' : ''}</option>)}
    </select></label>
    {effect?.description ? <p>{effect.description}</p> : null}
    {controls.colors !== false ? <div className="native-effects__colors">{colors.slice(0,maxColors).map((color, index) => <label key={index}>Farbe {index + 1}<input type="color" value={color} aria-label={`Herstellereffekt Farbe ${index + 1} für ${device.name}`} onChange={event => setColors(current => current.map((value, i) => i === index ? event.target.value : value))}/></label>)}{colors.length<maxColors?<button className="secondary" aria-label={`Farbe hinzufügen für ${device.name}`} onClick={()=>setColors(current=>[...current,'#ffffff'])}><Plus size={15}/></button>:null}{colors.slice(0,maxColors).length>1?<button className="secondary" aria-label={`Farbe entfernen für ${device.name}`} onClick={()=>setColors(current=>current.slice(0,Math.min(current.length,maxColors)-1))}><X size={15}/></button>:null}</div> : null}
    <div className="native-effects__sliders">
      {controls.brightness!==false?<label><span><Sun size={15}/>Helligkeit <output>{brightness}%</output></span><input type="range" min="0" max="100" value={brightness} aria-label={`Herstellereffekt Helligkeit für ${device.name}`} onChange={event => setBrightness(Number(event.target.value))}/></label>:null}
      {controls.speed!==false?<label><span><Gauge size={15}/>Tempo <output>{speed}%</output></span><input type="range" min="1" max="100" value={speed} aria-label={`Herstellereffekt Tempo für ${device.name}`} onChange={event => setSpeed(Number(event.target.value))}/></label>:null}
    </div>
    {controls.direction!==false?<label className="native-effects__select">Richtung<select value={direction} aria-label={`Herstellereffekt Richtung für ${device.name}`} onChange={event => setDirection(event.target.value)}><option value="forward">Vorwärts</option><option value="reverse">Rückwärts</option></select></label>:null}
    {['background','irDelay','length','width','hue','multicolor','powerSaving'].some(key=>controls[key])?<details><summary>Weitere Effekteinstellungen</summary>{controls.background?<label className="native-effects__select">Hintergrundfarbe<input type="color" value={advanced.background} aria-label={`Hintergrundfarbe für ${device.name}`} onChange={event=>setAdvanced(current=>({...current,background:event.target.value}))}/></label>:null}{[['irDelay','IR-Verzögerung',effect.irDelayMin||0,effect.irDelayMax||0],['length','Effektlänge',effect.lengthMin||0,effect.lengthMax||0],['width','Breite',0,4],['hue','Farbton',0,80]].filter(([key])=>controls[key]).map(([key,label,min,max])=><label key={key} className="native-effects__select">{label}<input type="range" min={min} max={max} step={key==='hue'?20:1} value={Math.max(min,Math.min(max,advanced[key]))} aria-label={`${label} für ${device.name}`} onChange={event=>setAdvanced(current=>({...current,[key]:Number(event.target.value)}))}/><output>{Math.max(min,Math.min(max,advanced[key]))}</output></label>)}{[['multicolor','Mehrfarbig'],['powerSaving','Energiesparen']].filter(([key])=>controls[key]).map(([key,label])=><label key={key} className="native-effects__select"><input type="checkbox" checked={advanced[key]} onChange={event=>setAdvanced(current=>({...current,[key]:event.target.checked}))}/>{label}</label>)}</details>:null}
    {effect?.warning?<p>{effect.warning}</p>:null}
    {device.wholeControllerOnly?<label className="native-controller-consent"><input type="checkbox" checked={confirmController} disabled={busy} onChange={event=>setConfirmController(event.target.checked)}/>Alle Strimer-Kanäle dieses Controllers ändern</label>:null}
    <div className="button-row"><button className="primary" disabled={busy || !effectId || device.wholeControllerOnly&&!confirmController} onClick={() => applyTo([device.id])}><Play size={16}/>{device.wholeControllerOnly?'Auf alle Kanäle dieses Controllers anwenden':'Auf dieses Gerät anwenden'}</button>
      {!device.wholeControllerOnly && compatible.length > 1 ? <button className="secondary" disabled={busy || !effectId} onClick={() => applyTo(compatible.map(peer => peer.id))}>Auf alle {compatible.length} {device.provider === 'kingston' ? 'FURY-Riegel' : 'passenden Anschlüsse'} anwenden</button> : null}</div>
    {activeId ? <p className="support-status">{activeState?.confirmation==='transmitted'?'An Controller übertragen':'Von der Schnittstelle gemeldet'}: {effects.find(value => value.id === activeId)?.name || activeId}</p> : null}
    {available.length < effects.length ? <details><summary>Nicht verfügbare Effekte ({effects.length - available.length})</summary><ul>{effects.filter(value => value.supported === false).map(value => <li key={value.id}>{value.name}: {value.reason || 'Dieses Controller-Modell stellt den Effekt über diese Anbindung nicht bereit.'}</li>)}</ul></details> : null}
  </section>;
}

export function NativeEffectDevices({ devices, busy, onApply }) {
  const targets = devices.filter(device => device.nativeEffects?.length);
  if (!targets.length) return null;
  return <section className="native-device-section surface"><h3>Effekte deiner Geräte</h3><p>Zusätzlich zu den Batto-Effekten: Hersteller-Modi für erkannte Geräte.</p>{targets.map(device => <details key={device.id} data-native-device={device.id}><summary>{device.name}</summary><NativeEffects device={device} peers={targets} busy={busy} onApply={onApply}/></details>)}</section>;
}
