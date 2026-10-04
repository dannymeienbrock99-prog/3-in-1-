import { useEffect, useState } from 'react';
import { api } from './data.js';
let pending = null, cache = null;
function readFans() {
  if (cache && Date.now()-cache.time<1500) return Promise.resolve(cache.value);
  if (!pending) pending=api('fans').then(value=>{cache={time:Date.now(),value};return value;}).finally(()=>{pending=null;});
  return pending;
}
export function FanTelemetry({device}) {
  const [values,setValues]=useState(null);
  useEffect(()=>{
    if(device.provider!=='lianli')return;
    let alive=true,reading=false;
    const read=async()=>{if(reading)return;reading=true;try{const value=await readFans();if(alive)setValues(value.fans?.find(fan=>fan.deviceId===device.id)||null);}catch{if(alive)setValues(null);}finally{reading=false;}};
    void read();const timer=setInterval(read,4000);return()=>{alive=false;clearInterval(timer);};
  },[device.id,device.provider]);
  if(device.provider!=='lianli')return null;
  const fresh=values?.capturedAt && Date.now()-Date.parse(values.capturedAt)<15000;
  const fans=fresh&&Array.isArray(values.fanRpms)&&values.fanRpms.length?values.fanRpms:[{index:null,rpm:fresh?values.rpm:null}];
  return <div className="native-fan-rpms" aria-label={`Lüfter-Drehzahl für ${device.name}`}><strong>Lüfter-Drehzahl</strong>{fans.map(fan=><span key={fan.index??'port'}>{fan.index===null?'Anschluss':`Lüfter ${fan.index+1}`}: <b>{Number.isInteger(fan.rpm)&&fan.rpm>=0?`${fan.rpm.toLocaleString('de-DE')} RPM`:'—'}</b></span>)}<small>{fresh?'Live · vom USB-Controller gemeldet':'Kein aktueller Drehzahlwert gemeldet'}</small></div>;
}
