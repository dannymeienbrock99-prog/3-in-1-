import {useRef,useState} from 'react';
import {MAX_LCONNECT_FILE_BYTES,readLConnectImport,lconnectPreviewSelection} from '../server/lconnect-import.mjs';
import './lconnect-import.css';

export function LConnectImport({onImport,disabled=false}) {
 const [document,setDocument]=useState(null),[identity,setIdentity]=useState(''),[selection,setSelection]=useState('common'),[reading,setReading]=useState(false),[importing,setImporting]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const sequence=useRef(0);
 const cable=document?.cables.find(value=>value.identity===identity);
 const setting=cable?(selection==='common'?cable.common:cable.groups.find(value=>String(value.index)===selection)):null;
 async function chooseFile(event) {
  const file=event.target.files?.[0],request=++sequence.current;event.target.value='';
  setDocument(null);setIdentity('');setMessage('');setError('');setReading(false);
  if(!file)return;
  setReading(true);
  try {
   if(file.size<1||file.size>MAX_LCONNECT_FILE_BYTES)throw new Error('Bitte eine L-Connect-Sicherung mit maximal 1 MB wählen.');
   const result=await readLConnectImport(new Uint8Array(await file.arrayBuffer()));
   if(request!==sequence.current)return;
   const first=result.cables[0];setDocument(result);setIdentity(first.identity);setSelection(first.sourceSeparate&&first.groups.length?'0':'common');
   setMessage(`${result.cables.length} ${result.cables.length===1?'Kabel':'Kabel'} in der Sicherung gelesen. Jetzt das gewünschte Kabel und seine Quellenwerte wählen.`);
  }catch(value){if(request===sequence.current)setError(value.message||'Die Sicherung konnte nicht gelesen werden.');}
  finally {if(request===sequence.current)setReading(false);}
 }
 async function importPreview() {
  if(!document||!setting||disabled||reading||importing||typeof onImport!=='function')return;
  setImporting(true);setError('');setMessage('');
  try {await onImport(lconnectPreviewSelection(document,identity,selection));setMessage(`${cable.name}: lokaler Vorschauentwurf importiert.`);}
  catch(value){setError(value.message||'Der Vorschauentwurf konnte nicht übernommen werden.');}
  finally {setImporting(false);}
 }
 const locked=disabled||reading||importing;
 return <details className="lconnect-import">
  <summary>L-Connect-Sicherung als Vorschau importieren</summary>
  <p>Wähle den Export „Lighting / Fan Speed“ als ZIP oder die darin enthaltene JSON-Datei „backup“. Der Import erstellt einen lokalen Kabelentwurf. Er überträgt keine Beleuchtung.</p>
  <label className="lconnect-file">Sicherung wählen<input type="file" accept=".zip,.json,application/zip,application/json" aria-label="L-Connect-Sicherung wählen" onChange={chooseFile} disabled={locked}/></label>
  {reading?<p role="status">Sicherung wird gelesen …</p>:null}
  {document&&cable?<div className="lconnect-result">
   <p className="lconnect-source">L-Connect {document.source.version} · Beleuchtungsexport · {new Date(document.source.createdAt).toLocaleString('de-DE')}</p>
   <div className="lconnect-choices">
    <label>Kabel aus der Sicherung<select aria-label="Kabel aus der L-Connect-Sicherung" value={identity} disabled={locked} onChange={event=>{const next=document.cables.find(value=>value.identity===event.target.value);setIdentity(next.identity);setSelection(next.sourceSeparate&&next.groups.length?'0':'common');setMessage('');}}>{document.cables.map(value=><option key={value.identity} value={value.identity}>{value.name} · {value.ledCount} LEDs</option>)}</select></label>
    <label>Gespeicherte Quellenwerte<select aria-label="Beleuchtungsgruppe aus der L-Connect-Sicherung" value={selection} disabled={locked} onChange={event=>{setSelection(event.target.value);setMessage('');}}>{cable.groups.map(value=><option key={value.index} value={String(value.index)}>Gruppe {value.index+1} · {value.sourceLabel}</option>)}<option value="common">Gemeinsame Einstellung · {cable.common.sourceLabel}{cable.sourceSeparate?' (zusätzlich gespeichert)':''}</option></select></label>
   </div>
   {setting?<>
    <dl className="lconnect-values"><div><dt>Herstellereffekt</dt><dd>{setting.sourceLabel}</dd></div><div><dt>Gespeicherte Helligkeit</dt><dd>{setting.brightness===null?'Nicht angegeben':`${setting.brightness}%`}</dd></div><div><dt>Tempo / Richtung (Quellenwerte)</dt><dd>{setting.speed??'—'} / {setting.direction??'—'}</dd></div></dl>
    {setting.colors.length?<div className="lconnect-palette" aria-label="Gespeicherte Farbpalette">{setting.colors.map((color,index)=><span key={index}><i style={{backgroundColor:color.hex}} aria-hidden="true"/>{color.hex.toUpperCase()}{color.alpha!==255?` · Deckkraft ${color.alpha}/255`:''}</span>)}</div>:<p>Keine Farbpalette gespeichert. Die aktuelle Vorschaupalette bleibt erhalten.</p>}
    <p className="lconnect-note">{cable.groups.length} gespeicherte Gruppen sind Quelleninformationen. Sie werden keinem physischen Lichtleiter zugeordnet. Die gewählte Gruppe dient dem gemeinsamen Vorschauentwurf. Tempo und Richtung der bisherigen Vorschau bleiben erhalten.</p>
    {[...document.warnings,...cable.warnings,...setting.warnings].map((value,index)=><p className="lconnect-note" key={index}>{value}</p>)}
    <button type="button" className="secondary" disabled={locked||typeof onImport!=='function'} onClick={importPreview}>{importing?'Vorschau wird übernommen …':'Als lokalen Vorschauentwurf importieren'}</button>
   </>:null}
  </div>:null}
  {message?<p role="status">{message}</p>:null}{error?<p className="lconnect-error" role="alert">{error}</p>:null}
 </details>;
}
