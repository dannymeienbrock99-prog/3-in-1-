import {useEffect,useRef,useState} from 'react';
import {DEFAULT_CUSTOM,isAnimatedEffect,renderFrame} from '../server/effect-renderer.mjs';
import './custom-effects.css';

function CycleTime({value,onChange,disabled}){
 const [text,setText]=useState(String(value));
 useEffect(()=>setText(String(value)),[value]);
 const valid=text.trim()!==''&&Number.isFinite(Number(text))&&Number(text)>=.25&&Number(text)<=60;
 return <label className="custom-effect-cycle"><span>Umlaufzeit <small>Sekunden pro Runde</small></span><input aria-label="Umlaufzeit in Sekunden" aria-invalid={!valid} type="number" min="0.25" max="60" step="0.25" disabled={disabled} value={text} onChange={e=>{const next=e.target.value;setText(next);const n=Number(next);if(next.trim()&&Number.isFinite(n)&&n>=.25&&n<=60)onChange(n);}} onBlur={()=>{if(!valid)setText(String(value));}}/><small>0,25–60 Sekunden</small></label>;
}

function PatternPreview({config,running}){
 const canvas=useRef(null),time=useRef(0);
 useEffect(()=>{
  const context=canvas.current.getContext('2d');if(!context)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame,last;
  const draw=()=>{const colors=renderFrame(48,config,time.current);context.clearRect(0,0,480,34);colors.forEach((color,index)=>{context.fillStyle=`rgb(${color&255},${color>>>8&255},${color>>>16&255})`;context.fillRect(index*10+1,3,8,28);});};
  const tick=now=>{if(last!==undefined)time.current+=Math.min((now-last)/1000,.1);last=now;draw();frame=requestAnimationFrame(tick);};
  const refresh=()=>{cancelAnimationFrame(frame);last=undefined;draw();if(running&&!reduced.matches&&isAnimatedEffect(config))frame=requestAnimationFrame(tick);};
  refresh();reduced.addEventListener('change',refresh);
  return()=>{cancelAnimationFrame(frame);reduced.removeEventListener('change',refresh);};
 },[config,running]);
 return <div className="custom-effect-preview"><span>Dein Muster · LED-Vorschau</span><canvas ref={canvas} width="480" height="34" aria-label="Lichtmuster als virtuelle LED-Reihe"/><small>Die Vorschau passt das Muster an die LED-Reihe an. Hardware wird erst beim Anwenden geändert.</small></div>;
}

export function CustomEffectEditor({config,onChange,running=true,onSave}){
 const custom={...DEFAULT_CUSTOM,...config.custom};
 const change=(key,value)=>onChange({...custom,[key]:value});
 return <section className="custom-effect-editor" aria-label="Eigenen Effekt gestalten">
  <div className="custom-effect-choice"><span>Lichtmuster</span><div className="segmented">{[['gradient','Weicher Verlauf'],['bands','Farbblöcke']].map(([value,label])=><button key={value} type="button" aria-pressed={custom.pattern===value} className={custom.pattern===value?'active':''} onClick={()=>change('pattern',value)}>{label}</button>)}</div></div>
  <div className="custom-effect-choice"><span>Bewegung</span><div className="segmented">{[['still','Still'],['scroll','Umlauf'],['bounce','Hin und her']].map(([value,label])=><button key={value} type="button" aria-pressed={custom.motion===value} className={custom.motion===value?'active':''} onClick={()=>change('motion',value)}>{label}</button>)}</div></div>
  <label className="custom-effect-range"><span>Musterwiederholungen <output>{custom.repeats}×</output></span><input aria-label="Musterwiederholungen" type="range" min="1" max="12" step="1" value={custom.repeats} onChange={e=>change('repeats',Number(e.target.value))}/></label>
  <label className="custom-effect-range"><span>Pulsstärke <output>{custom.pulse}%</output></span><input aria-label="Pulsstärke" type="range" min="0" max="100" step="1" value={custom.pulse} onChange={e=>change('pulse',Number(e.target.value))}/><small>0 %: konstante Helligkeit · 100 %: bis ganz dunkel.</small></label>
  <CycleTime value={custom.cycleSeconds} disabled={custom.motion==='still'&&custom.pulse===0} onChange={value=>change('cycleSeconds',value)}/>
  <PatternPreview config={config} running={running}/>
  {onSave?<button className="secondary" type="button" onClick={onSave}>Eigenen Effekt als Profil speichern</button>:null}
 </section>;
}
