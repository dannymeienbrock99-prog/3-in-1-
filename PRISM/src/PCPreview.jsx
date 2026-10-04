import { useEffect, useId, useRef, useState } from 'react';
import { createEffectSampler } from './effect-color.js';
import { getMotherboardPreview } from './motherboard-preview.js';
import './pc-preview.css';

const COMPONENTS = [
  { type: 'fans', label: 'Lüfter', x: 82.2, y: 47.6, width: 21, height: 76 },
  { type: 'motherboard', label: 'Mainboard', x: 37, y: 30, width: 16, height: 21 },
  { type: 'ram', label: 'Arbeitsspeicher', x: 52.7, y: 29, width: 9, height: 33 },
  { type: 'gpu', label: 'Grafikkarte', x: 39, y: 61.8, width: 57, height: 16 },
  { type: 'strip', label: 'LED-Streifen', x: 41, y: 86.6, width: 61, height: 6 },
];

function drawLighting(canvas, config, types, time) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const w = canvas.width;
  const h = canvas.height;
  context.clearRect(0, 0, w, h);
  const sampleColor = createEffectSampler(config, time);
  const illuminated = new Set(types);
  let ledIndex = 0;
  const glow = (x1, y1, x2, y2, position, width = 3, strength = 1, index) => {
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
    [0.511, 0.544].forEach((x) => {
      for (let i = 0; i < 40; i++) {
        glow(x, 0.148 + i / 40 * 0.287, x, 0.148 + (i + 1.05) / 40 * 0.287, i / 39, 7, 1, i);
      }
    });
  }
  if (illuminated.has('gpu')) {
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
    ledIndex = 0;
    for (let i = 0; i < 16; i++) {
      const x = 0.132 + i / 15 * 0.567;
      glow(x - 0.006, 0.866, x + 0.006, 0.866, i / 15, 9);
    }
  }
  context.shadowBlur = 0;
}

export function PCPreview({ config = {}, selectedTypes = [], running = true, onSelectType, system }) {
  const canvasRef = useRef(null);
  const timeRef = useRef(0);
  const effectRef = useRef(config.effect);
  const [failedImage, setFailedImage] = useState(null);
  const motherboard = getMotherboardPreview(system);
  const chosenImage = motherboard.image;
  const usesFallback = failedImage === chosenImage;
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
    const render = () => drawLighting(canvas, config, selectedTypes, timeRef.current);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * density));
      canvas.height = Math.max(1, Math.round(rect.height * density));
      render();
    };
    const tick = (now) => {
      if (lastTime !== undefined) timeRef.current += Math.min((now - lastTime) / 1000, 0.06);
      lastTime = now;
      render();
      frame = requestAnimationFrame(tick);
    };
    const updateAnimation = () => {
      cancelAnimationFrame(frame);
      lastTime = undefined;
      render();
      if (running && !reducedMotion.matches && !['static', 'gradient'].includes(config.effect)) frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    updateAnimation();
    reducedMotion.addEventListener('change', updateAnimation);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', updateAnimation);
    };
  }, [config, selectedTypes, running]);

  return <>
    <div className="pc-preview" aria-label="Interaktive Vorschau der PC-Beleuchtung">
      <img key={imageSource} className="pc-preview__base" src={imageSource}
        alt={`${previewLabel}: PC mit drei Lüftern, RAM, Grafikkarte und LED-Streifen`}
        onLoad={() => { if (!usesFallback && failedImage) setFailedImage(null); }}
        onError={() => { if (imageSource !== '/pc-base.png') setFailedImage(chosenImage); }} draggable="false" />
      <canvas ref={canvasRef} className="pc-preview__lighting" aria-hidden="true" />
      {onSelectType && COMPONENTS.map(({ type, label, x, y, width, height }) => (
        <button type="button" key={type} className="pc-preview__target"
          style={{ left: `${x - width / 2}%`, top: `${y - height / 2}%`, width: `${width}%`, height: `${height}%` }}
          aria-label={`${label} in der Vorschau auswählen`}
          aria-pressed={selectedTypes.includes(type)} title={label} onClick={() => onSelectType(type)} />
      ))}
    </div>
    <div className="pc-preview__board-caption">
      <span className="pc-preview__board-label">{previewLabel}</span>
      {motherboard.modelName ? <span className="pc-preview__board-model">Erkannt: {motherboard.modelName}</span> : null}
      <span className="pc-preview__board-note">Symbolbild · Mainboard-Design kann je nach Modell abweichen.</span>
    </div>
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
