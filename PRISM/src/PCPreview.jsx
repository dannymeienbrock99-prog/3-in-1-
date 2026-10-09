import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createEffectSampler } from './effect-color.js';
import { getMotherboardPreview } from './motherboard-preview.js';
import { getMemoryPreview, getMsiDimmPositions } from './memory-preview.js';
import { PC_COMPONENTS as COMPONENTS, getPreviewDeviceTypes, getPreviewPoints } from './pc-preview-points.js';
import './pc-preview.css';

const LAYOUT_KEY='batto.rgb.pc-layout.v1';
const deviceIdentity=device=>`${device.provider||''}|${device.name||''}|${device.category||''}`;
function readLayout(){try{const raw=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'{}');return Object.fromEntries(COMPONENTS.map(component=>{const value=raw[component.type]||{},next={};for(const [key,min,max]of [['x',0,100],['y',0,100],['width',2,100],['height',2,100]])next[key]=Number.isFinite(value[key])?Math.max(min,Math.min(max,value[key])):component[key];next.deviceId=['string','number'].includes(typeof value.deviceId)?value.deviceId:null;next.deviceIdentity=typeof value.deviceIdentity==='string'?value.deviceIdentity:null;return [component.type,next];}));}catch{return Object.fromEntries(COMPONENTS.map(component=>[component.type,{...component,deviceId:null,deviceIdentity:null}]));}}

function drawLighting(canvas, config, types, time, msiDimmPositions = null, layout = {}) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const w = canvas.width;
  const h = canvas.height;
  context.clearRect(0, 0, w, h);
  const sampleColor = createEffectSampler(config, time);
  const illuminated = new Set(types);
  let ledIndex = 0;
  let currentType;
  const glow = (x1, y1, x2, y2, position, width = 3, strength = 1, index) => {
    const base=COMPONENTS.find(component=>component.type===currentType),placed=layout[currentType];
    if(base&&placed){const sx=placed.width/base.width,sy=placed.height/base.height;x1=placed.x/100+(x1-base.x/100)*sx;x2=placed.x/100+(x2-base.x/100)*sx;y1=placed.y/100+(y1-base.y/100)*sy;y2=placed.y/100+(y2-base.y/100)*sy;}
    const sample = sampleColor(position, index ?? ledIndex++);
    const { color } = sample;
    const alpha = sample.alpha * strength;
    context.strokeStyle = `rgba(${color.join(',')},${alpha})`;
    context.shadowColor = `rgba(${color.join(',')},${alpha * 0.85})`;
    context.shadowBlur = w * 0.013;
    context.lineWidth = w * width / 1000;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x1 * w, y1 * h);
    context.lineTo(x2 * w, y2 * h);
    context.stroke();
  };

  if (illuminated.has('fans')) {
    currentType='fans';
    [0.235, 0.477, 0.715].forEach((centerY) => {
      const radiusX = 0.0844;
      const radiusY = radiusX * w / h;
      // A diffuse band tints the blades while leaving the dark fan hub visible.
      for (let i = 0; i < 32; i++) {
        const a = i / 32 * Math.PI * 2;
        const b = (i + 1.04) / 32 * Math.PI * 2;
        glow(0.822 + Math.cos(a) * radiusX * 0.76, centerY + Math.sin(a) * radiusY * 0.76,
          0.822 + Math.cos(b) * radiusX * 0.76, centerY + Math.sin(b) * radiusY * 0.76,
          i / 31, 30, 0.11, i * 2);
      }
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * Math.PI * 2;
        const b = (i + 1.06) / 64 * Math.PI * 2;
        glow(0.822 + Math.cos(a) * radiusX, centerY + Math.sin(a) * radiusY,
          0.822 + Math.cos(b) * radiusX, centerY + Math.sin(b) * radiusY, i / 63, 4.5, 1, i);
      }
    });
  }
  if (illuminated.has('motherboard')) {
    currentType='motherboard';
    ledIndex = 0;
    // A rounded rectangle follows the perimeter of the pump block.
    const left = 0.315, right = 0.426, top = 0.227, bottom = 0.370;
    const rx = 0.018, ry = rx * w / h;
    const points = [];
    [[right - rx, top + ry, -Math.PI / 2], [right - rx, bottom - ry, 0],
      [left + rx, bottom - ry, Math.PI / 2], [left + rx, top + ry, Math.PI]].forEach(([x, y, start]) => {
      for (let i = 0; i <= 8; i++) {
        const angle = start + i / 8 * Math.PI / 2;
        points.push([x + Math.cos(angle) * rx, y + Math.sin(angle) * ry]);
      }
    });
    points.forEach((point, i) => {
      const next = points[(i + 1) % points.length];
      glow(...point, ...next, i / (points.length - 1), 3.5);
    });
  }
  if (illuminated.has('ram')) {
    currentType='ram';
    (msiDimmPositions || [0.511, 0.544]).forEach((x) => {
      for (let i = 0; i < 40; i++) {
        glow(x, 0.148 + i / 40 * 0.287, x, 0.148 + (i + 1.05) / 40 * 0.287, i / 39, 7, 1, i);
      }
    });
  }
  if (illuminated.has('gpu')) {
    currentType='gpu';
    ledIndex = 0;
    for (let i = 0; i < 44; i++) {
      glow(0.115 + i / 44 * 0.288, 0.619, 0.115 + (i + 1.05) / 44 * 0.288, 0.619, i / 47, 4);
    }
    for (let i = 0; i < 4; i++) {
      glow(0.403 + i / 4 * 0.025, 0.619 - i / 4 * 0.02,
        0.403 + (i + 1) / 4 * 0.025, 0.619 - (i + 1) / 4 * 0.02, (44 + i) / 47, 4);
    }
  }
  if (illuminated.has('strip')) {
    currentType='strip';
    ledIndex = 0;
    for (let i = 0; i < 16; i++) {
      const x = 0.132 + i / 15 * 0.567;
      glow(x - 0.006, 0.866, x + 0.006, 0.866, i / 15, 9);
    }
  }
  if(illuminated.has('strimer')){currentType='strimer';for(let strand=0;strand<8;strand++)for(let i=0;i<30;i++){const x=.575+strand*.009,y=.55+i/30*.28;glow(x,y,x,y+.010,i/29,3,1,strand*30+i);}}
  context.shadowBlur = 0;
}

function drawPreviewPoints(canvas, points, config, types, time, selectedId) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width, height = canvas.height;
  const density = width / Math.max(1, canvas.getBoundingClientRect().width);
  const radius = Math.max(3 * density, width * 0.0048);
  const active = new Set(types), sample = createEffectSampler(config, time);
  context.clearRect(0, 0, width, height);
  for (const point of points) {
    const x = point.x * width, y = point.y * height;
    const selected = point.id === selectedId;
    const value = active.has(point.type) ? sample(point.position, point.sampleIndex) : null;
    const fill = selected ? '#ff2525' : value
      ? `rgba(${value.color.join(',')},${value.alpha})` : '#66717b';
    // A separate, normally blended canvas keeps the dark outlines readable on
    // white hardware. The light-effect canvas deliberately uses screen blending.
    context.shadowBlur = selected ? 4 * density : 2 * density;
    context.shadowColor = selected ? '#ff252570' : '#ffffff60';
    context.beginPath();
    context.arc(x, y, radius + (selected ? 3 : 0.8) * density, 0, Math.PI * 2);
    context.fillStyle = '#f6f8ff';
    context.fill();
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = '#18212b';
    context.fill();
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = '#18212b';
    context.lineWidth = 1.2 * density;
    context.stroke();
  }
}

export function PCPreview({ config = {}, selectedTypes = [], selectedIds = [], running = true, onSelectType, onSelectDevice, onPreviewSelect, system, devices = [], preview = false }) {
  const canvasRef = useRef(null);
  const pointsCanvasRef = useRef(null);
  const timeRef = useRef(0);
  const effectRef = useRef(config.effect);
  const [failedImage, setFailedImage] = useState(null);
  const [failedBoard, setFailedBoard] = useState(false);
  const [layout,setLayout]=useState(readLayout),[editing,setEditing]=useState(null),[arrange,setArrange]=useState(false),[storageError,setStorageError]=useState('');
  const [selectedPointId, setSelectedPointId] = useState(null);
  const [focusedPointId, setFocusedPointId] = useState(null);
  const selectedPointIdentity = useRef(null);
  const drag=useRef(null),area=useRef(null);
  const motherboard = getMotherboardPreview(system);
  const memory = getMemoryPreview(system);
  const isMsi = motherboard.brand === 'msi';
  const dimmCount = isMsi ? memory.visibleModules.length : null;
  const chosenImage = motherboard.image;
  const usesFallback = failedImage === chosenImage;
  const matching=component=>devices.filter(device=>getPreviewDeviceTypes(device).includes(component.type));
  const assignedDevice=type=>devices.find(device=>String(device.id)===String(layout[type].deviceId)&&deviceIdentity(device)===layout[type].deviceIdentity);
  const visibleComponents=COMPONENTS.filter(component=>preview||matching(component).length||assignedDevice(component.type)||component.type==='motherboard'&&motherboard.modelName||component.type==='ram'&&memory.count||component.type==='gpu'&&Array.isArray(system?.gpus)&&system.gpus.length);
  const illuminatedTypes=visibleComponents.filter(component=>layout[component.type]?.deviceId!==null?assignedDevice(component.type)&&selectedIds.some(id=>String(id)===String(layout[component.type].deviceId)):selectedTypes.includes(component.type)).map(component=>component.type);
  const visibleTypesKey = visibleComponents.map(component => component.type).join(',');
  const illuminatedTypesKey = illuminatedTypes.join(',');
  const points = useMemo(() => getPreviewPoints({
    types: visibleTypesKey.split(',').filter(Boolean), layout,
    dimmPositions: isMsi ? getMsiDimmPositions(dimmCount) : null,
  }), [visibleTypesKey, layout, isMsi, dimmCount]);
  const pointTabId = points.some(point => point.id === focusedPointId) ? focusedPointId : points[0]?.id;
  const chosenPoint = points.find(point => point.id === selectedPointId);
  function pointIdentity(type) {
    const assigned = assignedDevice(type);
    return (assigned ? [assigned] : matching({ type }))
      .map(device => `${device.id}|${deviceIdentity(device)}`).sort().join('\n');
  }
  const currentPointIdentity = chosenPoint ? pointIdentity(chosenPoint.type) : null;
  const activePointId = chosenPoint && illuminatedTypes.includes(chosenPoint.type)
    && currentPointIdentity === selectedPointIdentity.current ? selectedPointId : null;
  useEffect(() => {
    if (selectedPointId && !activePointId) setSelectedPointId(null);
  }, [selectedPointId, activePointId]);
  useEffect(()=>{try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(layout));setStorageError('');}catch{setStorageError('Positionen konnten nicht gespeichert werden.');}},[layout]);
  useEffect(()=>setFailedBoard(false),[motherboard.brand]);
  const imageSource = usesFallback ? '/pc-base.png' : chosenImage;
  const previewLabel = motherboard.brand === 'asus' && !usesFallback
    ? 'ASUS White Build · Mainboard-Vorschau'
    : motherboard.label && !usesFallback ? `${motherboard.label} Mainboard-Vorschau` : 'Mainboard-Vorschau';
  useEffect(() => {
    if (effectRef.current !== config.effect) {
      timeRef.current = 0;
      effectRef.current = config.effect;
    }
    const canvas = canvasRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame;
    let lastTime;
    let lastPaint;
    let visible=true;
    const pointCanvas = pointsCanvasRef.current;
    const render = () => {
      drawLighting(canvas, config, illuminatedTypes, timeRef.current, isMsi ? getMsiDimmPositions(dimmCount) : null, layout);
      drawPreviewPoints(pointCanvas, points, config, illuminatedTypes, timeRef.current, activePointId);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * density));
      canvas.height = Math.max(1, Math.round(rect.height * density));
      pointCanvas.width = canvas.width;
      pointCanvas.height = canvas.height;
      render();
    };
    const tick = (now) => {
      if (lastTime !== undefined) timeRef.current += Math.min((now - lastTime) / 1000, 0.06);
      lastTime = now;
      if(lastPaint===undefined||now-lastPaint>=33){render();lastPaint=now;}
      frame = requestAnimationFrame(tick);
    };
    const updateAnimation = () => {
      cancelAnimationFrame(frame);
      lastTime = undefined;
      lastPaint = undefined;
      render();
      if (visible && !document.hidden && running && !reducedMotion.matches && !['static', 'gradient'].includes(config.effect)) frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const visibility=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;updateAnimation();},{rootMargin:'100px'});
    visibility.observe(canvas);
    resize();
    updateAnimation();
    reducedMotion.addEventListener('change', updateAnimation);
    document.addEventListener('visibilitychange',updateAnimation);
    return () => {
      observer.disconnect();
      visibility.disconnect();
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', updateAnimation);
      document.removeEventListener('visibilitychange',updateAnimation);
    };
  }, [config, illuminatedTypesKey, running, isMsi, dimmCount, layout, points, activePointId]);

  function select(component, pointId = null){onPreviewSelect?.();selectedPointIdentity.current=pointId?pointIdentity(component.type):null;setSelectedPointId(pointId);setEditing(component.type);const device=assignedDevice(component.type);if(device)onSelectDevice?.(device.id);else onSelectType?.(component.type);}
  function selectPoint(event, fallback) {
    let point = fallback;
    if (event.detail > 0) {
      const bounds = area.current.getBoundingClientRect();
      const distance = candidate => (candidate.x * bounds.width + bounds.left - event.clientX) ** 2
        + (candidate.y * bounds.height + bounds.top - event.clientY) ** 2;
      // Dense cable dots share generous click targets. Always select the dot
      // nearest the pointer, rather than whichever overlapping button is on top.
      point = points.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest, fallback);
      area.current.querySelector(`[data-point-id="${point.id}"]`)?.focus({ preventScroll: true });
    }
    select(COMPONENTS.find(component => component.type === point.type), point.id);
  }
  function focusPoint(event, index) {
    const offsets = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in offsets) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
      : (index + offsets[event.key] + points.length) % points.length;
    area.current?.querySelector(`[data-point-id="${points[nextIndex].id}"]`)?.focus();
  }
  function move(event){if(!drag.current||!arrange)return;const bounds=area.current.getBoundingClientRect(),start=drag.current;setLayout(current=>({...current,[start.type]:{...current[start.type],x:Math.max(0,Math.min(100,start.x+(event.clientX-start.clientX)/bounds.width*100)),y:Math.max(0,Math.min(100,start.y+(event.clientY-start.clientY)/bounds.height*100))}}));}

  return <>
    <div ref={area} className={`pc-preview ${arrange?'pc-preview--arrange':''}`} aria-label="Interaktive Vorschau der PC-Beleuchtung">
      <img key={imageSource} className="pc-preview__base" src={imageSource}
        alt={`${previewLabel}: Symbolbild für die bearbeitbare Beleuchtungsvorschau`}
        onLoad={() => { if (!usesFallback && failedImage) setFailedImage(null); }}
        onError={() => { if (imageSource !== '/pc-base.png') setFailedImage(chosenImage); }} draggable="false" />
      {isMsi && !usesFallback && !failedBoard ? <>
        <img className="pc-preview__msi-board" src={motherboard.boardImage} alt="Das bereitgestellte MSI-Mainboard als Symbolbild" draggable="false" onError={() => setFailedBoard(true)}/>
        <img className="pc-preview__msi-foreground pc-preview__msi-foreground--gpu" src={imageSource} alt="" aria-hidden="true" draggable="false"/>
        <img className="pc-preview__msi-foreground pc-preview__msi-foreground--pump" src={imageSource} alt="" aria-hidden="true" draggable="false"/>
        {getMsiDimmPositions(dimmCount).map((position, index) => <span key={index} className="pc-preview__msi-dimm" style={{ left:`${position * 100}%` }} title={memory.visibleModules[index].modelName || memory.visibleModules[index].partNumber || 'Erkannter RAM-Riegel'} aria-hidden="true"/>)}
      </> : null}
      <canvas ref={canvasRef} className="pc-preview__lighting" aria-hidden="true" />
      <canvas ref={pointsCanvasRef} className="pc-preview__points" aria-hidden="true" />
      {onSelectType && visibleComponents.map(component => {const {type,label}=component,{x,y,width,height}=layout[type];return (
        <button type="button" key={type} className="pc-preview__target"
          style={{ left: `${x - width / 2}%`, top: `${y - height / 2}%`, width: `${width}%`, height: `${height}%` }}
          aria-label={`${label} in der Vorschau auswählen`}
          aria-pressed={illuminatedTypes.includes(type)} title={label} onClick={()=>select(component)} onPointerDown={event=>{if(arrange){event.currentTarget.setPointerCapture(event.pointerId);drag.current={type,x,y,clientX:event.clientX,clientY:event.clientY};setEditing(type);}}} onPointerMove={move} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}><span>{arrange?label:null}</span></button>
      );})}
      {!arrange && onSelectType ? points.map((point, index) => {
        const label = COMPONENTS.find(component => component.type === point.type).label;
        return <button key={point.id} type="button" className="pc-preview__point"
          data-point-id={point.id} data-component={point.type} data-x={point.x} data-y={point.y}
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          tabIndex={point.id === pointTabId ? 0 : -1}
          aria-label={`${label}: RGB-Punkt ${index + 1} in der Vorschau auswählen`}
          aria-pressed={point.id === activePointId} title={`${label} · Vorschaupunkt auswählen`}
          onFocus={() => setFocusedPointId(point.id)} onKeyDown={event => focusPoint(event, index)}
          onClick={event => selectPoint(event, point)} />;
      }) : null}
    </div>
    {points.length ? <div className="pc-preview__legend" aria-label="RGB-Punkte in der Vorschau">
      <span><i className="pc-preview__legend-dot" aria-hidden="true"/>RGB-Punkt</span>
      <span><i className="pc-preview__legend-dot pc-preview__legend-dot--selected" aria-hidden="true"/>Ausgewählt</span>
      <span><i className="pc-preview__legend-dot pc-preview__legend-dot--preview" aria-hidden="true"/>Vorschau</span>
    </div> : null}
    <div className="pc-preview__board-caption">
      <span className="pc-preview__board-label">{previewLabel}</span>
      {motherboard.modelName ? <span className="pc-preview__board-model">Erkannt: {motherboard.modelName}</span> : null}
      {memory.summary ? <span className="pc-preview__memory-model">RAM: {memory.summary}</span> : null}
      {isMsi && !memory.count ? <span className="pc-preview__memory-model">RAM-Steckplätze: keine Modulnamen von Windows gemeldet.</span> : null}
      <span className="pc-preview__board-note">Symbolbild · Mainboard-Design kann je nach Modell abweichen.</span>
      <span className="pc-preview__board-note">{preview?'Beispielaufbau.':'Nur erkannte oder ausdrücklich zugeordnete Komponenten sind auswählbar; das Hintergrundbild ist keine Stückliste.'}</span>
      <label className="pc-arrange-toggle"><input type="checkbox" checked={arrange} onChange={event=>setArrange(event.target.checked)}/>Komponenten verschieben</label>
    </div>
    {editing&&visibleComponents.some(component=>component.type===editing)?<section className="pc-component-editor" aria-label="Vorschau-Komponente bearbeiten"><div className="pc-component-heading"><h3>{COMPONENTS.find(component=>component.type===editing).label} anordnen</h3><button className="secondary" onClick={()=>{setLayout(current=>({...current,[editing]:{...COMPONENTS.find(component=>component.type===editing),deviceId:null}}));}}>Position zurücksetzen</button></div><div className="pc-component-values">{[['x','Mitte links'],['y','Mitte oben'],['width','Breite'],['height','Höhe']].map(([key,label])=><label key={key}>{label} %<input type="number" aria-label={`${label} der PC-Komponente`} min={key==='width'||key==='height'?2:0} max="100" step=".5" value={Math.round(layout[editing][key]*10)/10} onChange={event=>setLayout(current=>({...current,[editing]:{...current[editing],[key]:Math.max(key==='width'||key==='height'?2:0,Math.min(100,+event.target.value))}}))}/></label>)}</div><label className="pc-device-mapping">Gerät zuordnen<select aria-label="Gerät der PC-Komponente" value={assignedDevice(editing)?.id??''} onChange={event=>{onPreviewSelect?.();const value=event.target.value,device=devices.find(item=>String(item.id)===value);setLayout(current=>({...current,[editing]:{...current[editing],deviceId:device?.id??null,deviceIdentity:device?deviceIdentity(device):null}}));if(device)onSelectDevice?.(device.id);}}><option value="">Automatisch nach Komponententyp</option>{devices.map(device=><option key={device.id} value={device.id}>{device.name}</option>)}</select></label><p>Die Zuordnung wählt ein RGB-Gerät für die Effekteinstellungen aus. Position und Größe ändern ausschließlich die Vorschau.</p>{storageError?<p role="status">{storageError}</p>:null}</section>:null}
  </>;
}

function Fan({ x, y, size = 50, gradient }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect width={size} height={size} rx="5" fill="#101720" stroke="#39424c" />
    <circle cx={size / 2} cy={size / 2} r={size * 0.42} fill="#0a1118" stroke={`url(#${gradient})`} strokeWidth="3.7" />
    {[0, 60, 120, 180, 240, 300].map((angle) => <path key={angle} transform={`rotate(${angle} ${size / 2} ${size / 2})`} d={`M${size / 2} ${size / 2} Q${size * 0.25} ${size * 0.19} ${size * 0.62} ${size * 0.2} Q${size * 0.81} ${size * 0.28} ${size / 2} ${size / 2}`} fill="#1c2731" stroke="#384b56" strokeWidth="0.6" />)}
    <circle cx={size / 2} cy={size / 2} r={size * 0.135} fill="#070d14" stroke="#354650" />
  </g>;
}

export function DeviceVisual({ type }) {
  const id = useId().replace(/:/g, '');
  const gradient = `device-gradient-${id}`;
  return <svg className={`device-visual device-visual--${type}`} viewBox="0 0 190 90" fill="none" aria-hidden="true">
    <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#A650FF" /><stop offset=".33" stopColor="#3767FF" /><stop offset=".67" stopColor="#00E9DB" /><stop offset="1" stopColor="#FF61CA" /></linearGradient></defs>
    {type === 'fans' && <g><Fan x={9} y={21} size={54} gradient={gradient} /><Fan x={68} y={21} size={54} gradient={gradient} /><Fan x={127} y={21} size={54} gradient={gradient} /></g>}
    {type === 'ram' && [20, 51].map((y) => <g key={y}><path d={`M25 ${y} H165 V${y + 21} H25 Z`} fill="#131d29" stroke="#3b4b5e" /><rect x="31" y={y + 3} width="128" height="8" rx="2" fill={`url(#${gradient})`} /><path d={`M37 ${y + 15} H151`} stroke="#536078" strokeWidth="2" strokeDasharray="4 3" /><path d={`M30 ${y + 21} H160`} stroke="#65705b" strokeWidth="3" strokeDasharray="3 2" /></g>)}
    {type === 'motherboard' && <g><rect x="47" y="8" width="97" height="74" rx="3" fill="#101820" stroke="#465662" /><rect x="81" y="21" width="29" height="27" rx="2" stroke="#566573" strokeWidth="2" /><rect x="86" y="26" width="19" height="17" fill="#1c2633" /><path d="M57 17 H72 V56 H57 Z M81 57 H122 V65 H81 Z M80 71 H123" stroke="#3c4d5a" strokeWidth="4" /><path d="M128 21 V70 M101 12 H128" stroke={`url(#${gradient})`} strokeWidth="5" strokeLinecap="round" /><path d="M53 75 H70 M54 65 H69 M134 77 H138" stroke="#677889" strokeWidth="2" /></g>}
    {type === 'gpu' && <g><path d="M15 22 H174 L181 31 V72 H18 Z" fill="#101821" stroke="#43525d" /><Fan x={25} y={25} size={43} gradient={gradient} /><Fan x={73} y={25} size={43} gradient={gradient} /><Fan x={121} y={25} size={43} gradient={gradient} /><path d="M19 18 V79 M31 75 H154" stroke="#4e606d" strokeWidth="2" /><path d="M41 20 H167" stroke={`url(#${gradient})`} strokeWidth="2" /></g>}
    {type === 'strip' && <g><ellipse cx="95" cy="46" rx="71" ry="24" stroke="#0a151e" strokeWidth="12" /><ellipse cx="95" cy="43" rx="71" ry="24" stroke={`url(#${gradient})`} strokeWidth="8" />{Array.from({ length: 20 }, (_, i) => { const angle = i / 20 * Math.PI * 2; return <circle key={i} cx={95 + Math.cos(angle) * 71} cy={43 + Math.sin(angle) * 24} r="1.5" fill="#e8fbff" />; })}</g>}
  </svg>;
}

export default PCPreview;
