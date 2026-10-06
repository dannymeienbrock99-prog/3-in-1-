import {STRIMER_CABLE_TYPES,STRIMER_WIRELESS_CABLE_TYPES} from './strimer-capabilities.mjs';

// Session device numbers are never persisted as physical cable identities.
export function strimerIdentity(device){
 const provider=device?.provider||device?.backend;
 if(provider==='lianli-wireless'&&/^[a-f0-9]{12}$/i.test(device.mac||''))return `${provider}:${device.mac.toLowerCase()}`;
 return null;
}
export function normalizeStrimerDraft(input,normalizeConfig){
 const raw=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
 const configs=(value,max=12)=>{
  const result={};if(!value||typeof value!=='object'||Array.isArray(value))return result;
  for(const [id,config]of Object.entries(value).slice(0,12))if(/^\d{1,2}$/.test(id)&&Number(id)<max)try{result[id]=normalizeConfig(config);}catch{}
  return result;
 };
 const wirelessChannels={};
 for(const [id,value]of Object.entries(raw.wirelessChannels||{}).slice(0,32))if(id.length<=160&&!/[\u0000-\u001f]/.test(id)&&!['__proto__','constructor','prototype'].includes(id))wirelessChannels[id]=configs(value);
 const cable=raw.cable==='2x8'?'dual8pin':raw.cable;
 const result={mode:raw.mode==='separate'?'separate':'all',previewFamily:raw.previewFamily==='plus-v2'?'plus-v2':'wireless',cable:STRIMER_CABLE_TYPES.some(type=>type.id===cable)?cable:'24pin',wirelessCable:STRIMER_WIRELESS_CABLE_TYPES.some(type=>type.id===raw.wirelessCable)?raw.wirelessCable:'wireless-24pin',channels:configs(raw.channels,6),wirelessChannels};
 if(/^lianli-wireless:[a-f0-9]{12}$/.test(raw.deviceChoice||''))result.deviceChoice=raw.deviceChoice;
 try{if(raw.offlineConfig)result.offlineConfig=normalizeConfig(raw.offlineConfig);}catch{}
 return result;
}
