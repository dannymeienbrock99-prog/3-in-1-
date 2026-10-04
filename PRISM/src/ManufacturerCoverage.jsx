import React,{useMemo,useState} from 'react';
import {Search,RefreshCw,ShieldCheck,ExternalLink,Info} from 'lucide-react';

const EMPTY=[];
const INTEGRATION_LABELS={ready:'RGB-Anbindung bereit','setup-required':'Einrichtung erforderlich','provider-required':'Hersteller-Software erforderlich','adapter-missing':'RGB-Anbindung fehlt',excluded:'RGB-Steuerung ausgeschlossen','not-verified':'Unterstützung nicht geprüft','runtime-only':'Software erkannt · keine LED-Steuerung','no-targets':'Keine steuerbaren RGB-Ziele gemeldet',disconnected:'RGB-Verbindung getrennt'};
const PROVIDER_LABELS={available:'Software gefunden',unavailable:'Nicht verfügbar',connected:'Bereit',disconnected:'Getrennt','not-verified':'Noch nicht geprüft',sdkMissing:'Anbindung fehlt',sdkError:'Anbindung konnte nicht geladen werden',notConnected:'Nicht verbunden',denied:'Zugriff nicht erlaubt',unsupported:'Nicht unterstützt',error:'Abfrage fehlgeschlagen',ready:'Bereit',unknown:'Noch nicht geprüft'};
const textMatch=(value,query)=>String(value||'').toLocaleLowerCase('de-DE').includes(query);

function DeviceNames({devices}){
 return <ul className="manufacturer-device-names">{devices.map((device,index)=><li key={`${device.source||'detected'}-${device.id??index}`}><div><strong>{device.name||'Gerätename nicht gemeldet'}</strong><small>{device.source||'Geräteinformationen'}</small></div>{device.protected?<span className="manufacturer-protected"><ShieldCheck size={12}/>Nur Anzeige</span>:null}</li>)}</ul>;
}

export function ManufacturerCoverage({coverage,busy,error,onRefresh}){
 const [query,setQuery]=useState('');
 const brands=coverage?.brands||EMPTY;
 const unidentified=coverage?.unidentified||EMPTY;
 const providers=coverage?.providers||EMPTY;
 const warnings=coverage?.warnings||EMPTY;
 const normalizedQuery=query.trim().toLocaleLowerCase('de-DE');
 const visibleBrands=useMemo(()=>brands.filter(brand=>!normalizedQuery||textMatch(brand.name,normalizedQuery)||(brand.devices||EMPTY).some(device=>textMatch(device.name,normalizedQuery))||(brand.controlledNames||EMPTY).some(name=>textMatch(name,normalizedQuery))),[brands,normalizedQuery]);
 const unknownMatches=useMemo(()=>unidentified.filter(device=>!normalizedQuery||textMatch(device.name,normalizedQuery)||textMatch(device.source,normalizedQuery)),[unidentified,normalizedQuery]);
 return <section className="manufacturer-coverage" aria-labelledby="manufacturer-coverage-title">
  <div className="page-intro"><div><h2 id="manufacturer-coverage-title">Hersteller & RGB-Unterstützung</h2><p>PRISM liest jeden PC neu aus. Hier stehen die tatsächlich gemeldeten Hersteller und Modellnamen des PCs, auf dem das Programm läuft.</p></div><button className="secondary" onClick={onRefresh} disabled={busy}><RefreshCw size={16} className={busy?'spin':''}/>{busy?'Wird geprüft …':'Anbindungen prüfen'}</button></div>
  {error?<div className="connection-error coverage-error" role="status"><Info size={18}/><span>{error}{coverage?' Die zuletzt gelesenen Angaben bleiben sichtbar.':' Die PC-Geräteliste oben bleibt unabhängig verfügbar.'}</span></div>:null}
  {!coverage?<div className="surface coverage-loading"><p role="status">{busy?'Hersteller und Anbindungen werden gelesen …':'Die Herstellerübersicht ist noch nicht verfügbar.'}</p></div>:<>
   {warnings.length?<div className="help-note inventory-warning coverage-warning" role="status"><Info size={18}/><div><strong>Herstellerübersicht teilweise erkannt</strong><ul>{warnings.map((warning,index)=><li key={index}>{typeof warning==='string'?warning:warning.message}</li>)}</ul><p>Bereits gemeldete Hersteller und Modellnamen bleiben sichtbar.</p></div></div>:null}
   <div className="coverage-providers">{providers.map(provider=><article className="surface coverage-provider" key={provider.id}><div><h3>{provider.name||provider.id}</h3><span>{PROVIDER_LABELS[provider.status]||provider.status||'Noch nicht geprüft'}</span></div><p>{provider.message||'Die verfügbare Geräteschnittstelle wird separat geprüft.'}</p>{provider.id==='razer'?<p className="coverage-runtime-note">Erkennung der Razer-Software. Daraus entstehen keine steuerbaren LED-Geräte.</p>:Number.isInteger(provider.deviceCount)?<p>{provider.deviceCount} gemeldete RGB-Geräte</p>:null}</article>)}</div>
   <label className="hardware-search coverage-search"><Search size={18}/><input type="search" aria-label="Hersteller und Modellnamen suchen" placeholder="Hersteller oder Modellname suchen …" value={query} onChange={event=>setQuery(event.target.value)}/></label>
   <div className="coverage-result-count" role="status">{visibleBrands.length} {visibleBrands.length===1?'gemeldeter Hersteller':'gemeldete Hersteller'}{normalizedQuery?` für „${query.trim()}“`:''}</div>
   <div className="manufacturer-grid">{visibleBrands.map((brand,index)=>{const devices=brand.devices||EMPTY;const controlledNames=brand.controlledNames||EMPTY;const canControl=brand.status==='controllable'&&controlledNames.length>0;const excluded=brand.status==='excluded';const nameMatches=normalizedQuery&&textMatch(brand.name,normalizedQuery);const listedDevices=normalizedQuery&&!nameMatches?devices.filter(device=>textMatch(device.name,normalizedQuery)):devices;return <article className="surface manufacturer-card" key={brand.id||index}>
    <div className="manufacturer-card-heading"><h3>{brand.name||'Hersteller nicht gemeldet'}</h3><span className={`manufacturer-status ${canControl?'controllable':excluded?'excluded':'detected'}`}>{canControl?'RGB-Geräte steuerbar':excluded?'Nur Anzeige · geschützt':'Geräte erkannt'}</span></div>
    <p className="manufacturer-entry-count">{devices.length} gemeldete {devices.length===1?'Geräteangabe':'Geräteangaben'}</p>
    {canControl?<div className="manufacturer-controlled"><strong>RGB-Steuerung verfügbar für:</strong><ul>{controlledNames.map((name,nameIndex)=><li key={nameIndex}>{name}</li>)}</ul></div>:null}
    {listedDevices.length?<><DeviceNames devices={listedDevices.slice(0,3)}/>{listedDevices.length>3?<details className="manufacturer-more"><summary>Weitere Modellnamen ({listedDevices.length-3})</summary><DeviceNames devices={listedDevices.slice(3)}/></details>:null}</>:normalizedQuery?<p className="small">Der Suchbegriff passt zu einem steuerbaren RGB-Modell dieses Herstellers.</p>:null}
    {brand.integration?<div className="manufacturer-integration"><strong>{INTEGRATION_LABELS[brand.integration.status]||brand.integration.name||'RGB-Unterstützung prüfen'}</strong><p>{brand.integration.message}</p>{brand.integration.url?<a href={brand.integration.url} target="_blank" rel="noreferrer">Informationen zur Anbindung <ExternalLink size={12}/></a>:null}</div>:null}
   </article>;})}</div>
   {!visibleBrands.length&&!unknownMatches.length?<div className="empty surface coverage-empty"><Search size={28}/><h3>{normalizedQuery?'Keine passenden Hersteller oder Modelle':'Keine Hersteller eindeutig gemeldet'}</h3><p>{normalizedQuery?'Ändere den Suchbegriff.':'Die vollständigen Windows-Geräteeinträge bleiben in der PC-Liste sichtbar.'}</p></div>:null}
   {unknownMatches.length?<details className="surface unidentified-devices" key={normalizedQuery} open={Boolean(normalizedQuery)}><summary>Hersteller nicht eindeutig zugeordnet ({unknownMatches.length} Einträge)</summary><p>Diese Gerätenamen bleiben sichtbar. Ein nicht zugeordneter Hersteller ist kein Beleg für fehlende RGB-Hardware.</p><DeviceNames devices={unknownMatches}/></details>:null}
   <div className="inventory-boundary"><Info size={18}/><p>„Erkannt“ bedeutet, dass Windows oder eine Hersteller-Schnittstelle einen Namen gemeldet hat. RGB-Steuerung ist nur für die ausdrücklich aufgeführten Modelle verfügbar. Mehrere Windows-Einträge können zu einem Gerät gehören.</p></div>
  </>}
 </section>;
}
