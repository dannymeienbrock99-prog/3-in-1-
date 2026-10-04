import React from 'react';
import {Info,RefreshCw,ShieldCheck} from 'lucide-react';
import {HardwareDevices} from './HardwareDevices.jsx';

const number=value=>Number(value).toLocaleString('de-DE',{maximumFractionDigits:1});
const words=parts=>parts.filter(Boolean).join(' · ');
export function SystemInventory({system,busy,onRefresh}){
 const modules=system?.memory??[];
 const moduleTotal=system?.installedMemoryGb||modules.reduce((sum,m)=>sum+(Number(m.capacityGb)||0),0);
 const errors=Array.isArray(system?.errors)?system.errors:[];
 const warnings=Array.isArray(system?.warnings)?system.warnings:[];
 const partial=Boolean(system?.error||errors.length||warnings.length);
 const rows=[
  ['Betriebssystem','os',system?.os?[words([system.os.name,system.os.version,system.os.architecture])]:[]],
  ['Prozessor','cpus',(system?.cpus??[]).map(c=>words([c.name,c.cores?`${c.cores} Kerne`:c.logicalCores?`${c.logicalCores} logische Kerne`:null]))],
  ['Arbeitsspeicher','memory',modules.length?[
   `${moduleTotal?`${number(moduleTotal)} GB · `:''}${modules.length} ${modules.length===1?'Modul':'Module'}`,
   ...modules.map(m=>words([m.capacityGb?`${number(m.capacityGb)} GB`:null,m.manufacturer,m.partNumber,m.speedMhz?`${number(m.speedMhz)} MHz`:null]))
  ]:system?.totalMemoryGb?[`${number(system.totalMemoryGb)} GB vom Betriebssystem gemeldet`,'Hersteller und Moduldaten nicht verfügbar']:[]],
  ['Mainboard','motherboard',(system?.motherboard??[]).map(b=>[b.manufacturer,b.name].filter(Boolean).join(' '))],
  ['Grafikkarte','gpus',(system?.gpus??[]).map(g=>g.name)],
  ['Laufwerke','drives',(system?.drives??[]).map(d=>words([d.model,d.sizeGb?`${number(d.sizeGb)} GB`:null]))]
 ];
 return <section className="system-section standalone-inventory">
  <div className="page-intro"><div><h2>Deine PC-Komponenten</h2><p>Automatisch aus Windows gelesen. Diese Erkennung braucht keine RGB-Software.</p></div><button className="secondary" disabled={busy} onClick={onRefresh}><RefreshCw size={17} className={busy?'spin':''}/>{busy?'PC wird gelesen …':'PC erneut erkennen'}</button></div>
  {!system?<div className="surface inventory"><p role="status">Prozessor, Arbeitsspeicher und weitere Komponenten werden ausgelesen …</p></div>:<>
   <div className="inventory-source"><span className={`inventory-badge ${partial?'partial':''}`}>{partial?'Teilweise erkannt':'PC-Informationen gelesen'}</span><span>{system.source||'Betriebssystem'}</span></div>
   <div className="surface inventory">{rows.map(([label,key,values])=>{const error=errors.find(e=>e.component===key);return <div key={key}><span>{label}</span><div className="inventory-values">{values.filter(Boolean).length?values.filter(Boolean).map((value,i)=><strong className={i>0&&key==='memory'?'memory-module':''} key={i}>{value}</strong>):<strong className="muted">Von Windows nicht gemeldet</strong>}{error?<small>{error.message}</small>:null}</div></div>;})}</div>
   {partial?<div className="help-note inventory-warning" role="status"><Info size={19}/><div><p>{system.error||'Einzelne Windows-Geräteinformationen konnten nicht gelesen werden.'}</p>{warnings.length?<ul>{warnings.map((warning,i)=><li key={i}>{typeof warning==='string'?warning:warning.message}</li>)}</ul>:null}<p>Bereits erkannte Komponenten bleiben sichtbar. „PC erneut erkennen“ wiederholt die Abfrage.</p></div></div>:null}
  </>}
  <div className="inventory-boundary"><ShieldCheck size={18}/><p>Die PC-Liste zeigt verbaute Hardware. Ob ihre Beleuchtung steuerbar ist, wird separat geprüft. Stream Deck und Elgato-Geräte sind von PRISMs RGB-Steuerung ausgeschlossen.</p></div>
  {system?<HardwareDevices system={system}/>:null}
 </section>;
}
