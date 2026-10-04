import React from 'react';
import {Info} from 'lucide-react';

export const providerName=provider=>({corsair:'Corsair · iCUE',windows:'Windows · Dynamische Beleuchtung',msi:'MSI · Mystic Light',kingston:'Kingston · FURY CTRL',lianli:'Lian Li · USB-Controller','lianli-wireless':'Lian Li · Strimer Wireless'}[provider]||provider||'RGB-Anbindung');
const labels={connected:'Bereit',ready:'Bereit',detected:'USB-Gerät erkannt',sdkMissing:'Anbindung fehlt',notConnected:'iCUE nicht verbunden',denied:'Zugriff nicht erlaubt',unsupported:'Nicht unterstützt',unavailable:'Nicht verfügbar',error:'Abfrage fehlgeschlagen'};
export function RGBDiscovery({status}){
 const native=status.native||{};
 const discovery=Array.isArray(native.discovery)?native.discovery:[];
 const unavailable=discovery.filter(device=>['unsupported','unavailable','error'].includes(device.status));
 const warnings=[...new Set([...(Array.isArray(native.warnings)?native.warnings:[]),...(Array.isArray(native.windows?.warnings)?native.windows.warnings:[])])];
 return <>
  {status.error?<div className="connection-error rgb-inline-error" role="status"><Info size={18}/><span>{status.error}</span></div>:null}
  <div className="rgb-provider-statuses">{['windows','corsair','msi','kingston','lianli','lianli-wireless'].map(provider=>{const value=native[provider==='lianli-wireless'?'lianliWireless':provider];return <article className="rgb-provider-status surface" key={provider}><div className="rgb-provider-heading"><h3>{providerName(provider)}</h3><span>{value?labels[value.status]||'Geprüft':'Noch nicht geprüft'}</span></div><p>{value?.message||'Die RGB-Gerätesuche prüft diese Anbindung.'}</p>{Number.isInteger(value?.deviceCount)?<p>{value.deviceCount} {value.deviceCount===1?'RGB-Gerät':'RGB-Geräte'} gemeldet</p>:null}</article>;})}</div>
  {unavailable.length?<div className="rgb-unavailable surface"><h3>Gemeldet, aber derzeit nicht steuerbar</h3>{unavailable.map((device,index)=><article key={`${device.provider}-${device.name}-${index}`}><div><strong>{device.name||'Gerätename nicht gemeldet'}</strong><span>{providerName(device.provider)} · {labels[device.status]}</span></div><p>{device.reason||'Diese Anbindung stellt für das Gerät keine direkte LED-Steuerung bereit.'}</p><ControllerChannels channels={device.channels}/></article>)}</div>:null}
  {warnings.length?<div className="help-note rgb-discovery-warning" role="status"><Info size={18}/><ul>{warnings.map((warning,index)=><li key={index}>{typeof warning==='string'?warning:warning.message}</li>)}</ul></div>:null}
 </>;
}
export function ControllerChannels({channels}){
 if(!Array.isArray(channels)||channels.length===0)return null;
 return <details className="controller-channels"><summary>In iCUE konfigurierte Anschlüsse ({channels.length})</summary><div>{channels.map((channel,index)=><article key={channel.index??index}><strong>{channel.name||`Anschluss ${(channel.index??index)+1}`}</strong><p>{Number.isInteger(channel.deviceCount)?`${channel.deviceCount} Geräte`:''}{Number.isInteger(channel.ledCount)?` · ${channel.ledCount} LEDs`:''}{channel.complete===false?' · Angaben unvollständig':''}</p>{Array.isArray(channel.devices)?channel.devices.map((device,deviceIndex)=><span key={device.index??deviceIndex}>{device.name||'Modellname nicht gemeldet'}{Number.isInteger(device.ledCount)?` · ${device.ledCount} LEDs`:''}</span>):null}</article>)}</div><p>Diese Angaben sind die in iCUE konfigurierten Modelle. Welche LED-Zonen einzeln verfügbar sind, steht in der LED-Zonenauswahl.</p></details>;
}
