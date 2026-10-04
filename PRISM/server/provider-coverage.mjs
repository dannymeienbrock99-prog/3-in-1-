import { createHash } from 'node:crypto';
import { isProtectedDevice } from './device-policy.mjs';

// These are manufacturer aliases, never a list of allowed hardware models.
// Unlisted manufacturers and models remain visible from the current PC's metadata.
const FAMILIES = [
  ['elgato', 'Elgato', /\belgato\b|stream[\s_-]*deck/i],
  ['corsair', 'Corsair', /\bcorsair\b/i],
  ['asus', 'ASUS', /\basus\b|\basustek\b|\brog\b/i],
  ['msi', 'MSI', /\bmsi\b|micro[\s-]*star/i],
  ['gigabyte', 'Gigabyte', /\bgigabyte\b|\baorus\b/i],
  ['asrock', 'ASRock', /\basrock\b/i],
  ['lianli', 'Lian Li', /\blian[\s-]*li\b/i],
  ['razer', 'Razer', /\brazer\b/i],
  ['nzxt', 'NZXT', /\bnzxt\b/i],
  ['gskill', 'G.Skill', /\bg\.?\s*skill\b/i],
  ['kingston', 'Kingston / HyperX', /\bkingston\b|\bhyperx\b/i],
  ['thermaltake', 'Thermaltake', /\bthermaltake\b/i],
  ['coolermaster', 'Cooler Master', /\bcooler[\s-]*master\b/i],
  ['logitech', 'Logitech', /\blogitech\b/i],
  ['steelseries', 'SteelSeries', /\bsteelseries\b/i],
  ['aquacomputer', 'Aqua Computer', /\baqua[\s-]*computer\b/i],
  ['intel', 'Intel', /\bintel\b/i], ['amd', 'AMD', /\bamd\b|advanced micro devices/i],
  ['nvidia', 'NVIDIA', /\bnvidia\b/i],
];
const clean = value => typeof value === 'string' ? value.trim() : '';
const genericVendor = value => !value || /microsoft|generic|generisch|allgemein|^winusb[-\s]|standard|\bunknown\b|unbekannt|nicht gemeldet|acpi|hid.*konform|usb.*hostcontroller/i.test(value);
const docs = {
  corsair: 'https://corsairofficial.github.io/cue-sdk/',
  asus: 'https://www.asus.com/campaign/aura/us/SDK.php',
  msi: 'https://storage-asset.msi.com/files/pdf/Mystic_Light_Software_Development_Kit.pdf',
  gigabyte: 'https://www.gigabyte.com/us/mb/rgb/sdk',
  lianli: 'https://lian-li.com/l-connect3/',
  razer: 'https://doc.wyvrn.com/docs/chroma-sdk/chroma-rgb-rest-api/',
};

function manufacturer(device) {
  if (device.protected || isProtectedDevice(device)) return { id: 'elgato', name: 'Elgato', known: true };
  for (const candidate of [device.manufacturer, device.vendor, device.name]) {
    const match = FAMILIES.find(([, , pattern]) => pattern.test(clean(candidate)));
    if (match) return { id: match[0], name: match[1], known: true };
  }
  const actualVendor = [device.manufacturer, device.vendor].map(clean).find(value => device.controlled ? Boolean(value) : !genericVendor(value));
  if (actualVendor) return { id: 'vendor-' + createHash('sha256').update(actualVendor.toLocaleLowerCase('de-DE')).digest('hex').slice(0, 12), name: actualVendor, known: false };
  return device.controlled ? {id:'rgb-unknown',name:'Hersteller nicht gemeldet',known:false} : null;
}

export function buildCoverage({ inventory = {}, native = {}, corsair = {}, razer = {}, msi = {} } = {}) {
  const observed = (inventory.devices || []).filter(device => !['system', 'processor'].includes(device.category)).map(device => ({...device, source: device.source || 'Windows'}));
  for (const [field, category, name] of [
    ['cpus', 'processor', d => d.name], ['motherboard', 'motherboard', d => [d.manufacturer, d.name].filter(Boolean).join(' ')],
    ['memory', 'memory', d => [d.modelName || [d.manufacturer, d.partNumber].filter(Boolean).join(' '), d.capacityGb ? `${d.capacityGb} GB` : ''].filter(Boolean).join(' ')],
    ['gpus', 'gpu', d => d.name], ['drives', 'storage', d => d.model],
  ]) for (const [index, device] of (inventory[field] || []).entries()) {
    const label = clean(name(device));
    if (label && label !== 'Nicht verfügbar') observed.push({...device, id:`pc:${field}:${index}`, name:label, category, source:'Windows-PC-Informationen', protected:false});
  }
  for (const [index,monitor] of (inventory.monitors || []).entries()) {
    const instanceId=clean(monitor.instanceId).replace(/_\d+$/,'').toUpperCase();
    if (!observed.some(device=>device.category==='monitor' && instanceId && clean(device.instanceId).toUpperCase()===instanceId)) observed.push({...monitor,id:`monitor:${monitor.instanceId || index}`,category:'monitor',source:'Windows-EDID',controlled:false});
  }
  const controlled = native.connected ? (native.devices || []).filter(device => (device.directMode || device.nativeEffects?.some(effect => effect.supported !== false)) && !isProtectedDevice(device)) : [];
  const sources = { corsair:'iCUE', windows:'Windows-RGB', msi:'MSI Mystic Light', kingston:'Kingston FURY CTRL', lianli:'Lian Li USB' };
  if (native.connected) {
    observed.push(...(native.devices || []).map(device => ({...device, id:`rgb:${device.id}`, manufacturer:device.vendor, source:sources[device.provider] || 'RGB-Anbindung', category:device.typeName || 'RGB', controlled:controlled.includes(device)})));
    observed.push(...(native.details?.discovery || []).filter(device=>device.status !== 'connected' && !(native.devices || []).some(target=>device.deviceId !== undefined && target.id === device.deviceId)).map((device,index) => ({...device, id:`diagnostic:${index}`, manufacturer:device.vendor, source:device.provider === 'corsair' ? 'iCUE · derzeit nicht steuerbar' : 'Windows-RGB · derzeit nicht steuerbar', category:'RGB', controlled:false})));
  }
  const groups = new Map(), unidentified = [];
  for (const device of observed) {
    const row = { id:String(device.id), name:clean(device.name) || 'Name nicht gemeldet', source:device.source, category:device.category, protected:isProtectedDevice(device) };
    const family = manufacturer(device);
    if (!family) { unidentified.push(row); continue; }
    if (!groups.has(family.id)) groups.set(family.id, {...family, devices:[], controlledNames:[]});
    const group = groups.get(family.id);
    if (!group.devices.some(item => item.id === row.id)) group.devices.push(row);
    if (device.controlled && !group.controlledNames.includes(row.name)) group.controlledNames.push(row.name);
  }
  const brands = [...groups.values()].map(group => {
    let status = 'detected', integration = { name:group.name, status:group.known ? 'adapter-missing' : 'not-verified', message:'Hersteller aus den gemeldeten Gerätenamen erkannt. Für diese Einträge ist keine Lichtsteuerung bestätigt.', url:docs[group.id] || null };
    if (group.id === 'elgato') { status = 'excluded'; integration = {...integration, status:'excluded', message:'Gerätenamen werden angezeigt. Stream Deck und Elgato bleiben von der Lichtsteuerung ausgeschlossen.'}; }
    else if (group.controlledNames.length) { status = 'controllable'; integration = {...integration, status:'ready', message:'RGB-Steuerung ist für die unten ausdrücklich genannten RGB-Ziele verfügbar. Weitere Einträge dieses Herstellers sind damit nicht automatisch steuerbar.'}; }
    else if (group.id === 'corsair' && !corsair.sdkInstalled) integration = {...integration, status:'setup-required', message:'Geräte erkannt. Für die Beleuchtung die Corsair-Anbindung einrichten und iCUE mit erlaubtem SDK-Zugriff starten.'};
    else if (group.id === 'corsair' && (!native.connected || native.details?.corsair?.status !== 'connected')) integration = {...integration, status:'provider-required', message:'Geräte erkannt. iCUE läuft noch nicht mit erreichbarer SDK-Steuerung.'};
    else if (group.id === 'corsair') integration = {...integration, status:'no-targets', message:'Die iCUE-Anbindung ist verbunden, meldet derzeit aber kein steuerbares Corsair-RGB-Ziel.'};
    else if (group.id === 'msi' && !msi.sdkInstalled) integration = {...integration, status:'setup-required', message:'Für MSI-RGB die optionale MSI-Anbindung einrichten und MSI Center mit Mystic Light öffnen.'};
    else if (group.id === 'msi') integration = {...integration, status:'provider-required', message:native.details?.msi?.message || 'Mystic Light meldet aktuell kein steuerbares RGB-Ziel.'};
    else if (group.id === 'kingston') integration = {...integration, status:'provider-required', message:native.details?.kingston?.message || 'FURY-RAM erkannt. Die Herstellereffekte benötigen einen erreichbaren offiziellen FURY-CTRL-Dienst.'};
    else if (group.id === 'lianli') integration = {...integration, status:'provider-required', message:native.details?.lianli?.message || 'Lian-Li-Geräte erkannt. RGB-Steuerung benötigt einen unterstützten USB-HID-Controller.'};
    else if (group.id === 'razer' && razer.status === 'available') integration = {...integration, status:'runtime-only', message:'Razer Chroma wurde zusätzlich erkannt. Diese Version liest den SDK-Status, bietet über Chroma noch keine Farbübertragung an.'};
    return {...group, status, integration};
  }).sort((a,b) => a.name.localeCompare(b.name,'de-DE'));
  const windowsCount = controlled.filter(device => device.provider === 'windows').length;
  const corsairCount = controlled.filter(device => device.provider === 'corsair').length;
  return { scope:'current-pc', readOnly:true, modelSpecific:false, brands, unidentified,
    message:'Die Erkennung liest den PC, auf dem PRISM läuft. Keine Hardwaremodelle sind fest vorgegeben. Ein Windows-Eintrag oder erkannter Hersteller garantiert keine RGB-Schnittstelle.',
    warnings:[...new Set([...(Array.isArray(inventory.warnings) ? inventory.warnings : []),...(native.connected && Array.isArray(native.details?.warnings) ? native.details.warnings : [])])],
    providers:[
      {id:'windows',name:'Windows · Dynamische Beleuchtung',status:native.connected ? native.details?.windows?.status || 'not-verified' : 'disconnected',deviceCount:windowsCount,message:native.connected ? native.details?.windows?.message || 'Kompatible LampArray-Geräte werden separat über Windows gesucht.' : 'Die Windows-RGB-Verbindung ist derzeit nicht aktiv. Die PC-Geräteliste bleibt verfügbar.'},
      {id:'corsair',name:'iCUE · bereitgestellte Hersteller',status:native.connected ? native.details?.corsair?.status || (corsair.sdkInstalled ? 'not-verified' : 'sdkMissing') : corsair.sdkInstalled ? 'disconnected' : 'sdkMissing',deviceCount:corsairCount,message:native.connected ? native.details?.corsair?.message || 'Geräteliste über iCUE, sofern die optionale Anbindung eingerichtet ist.' : 'Keine aktive iCUE-Gerätesitzung. Die erkannten Windows-Namen bestätigen noch keine RGB-Steuerung.'},
      {id:'razer',name:'Razer Chroma · Erkennung',status:razer.status || 'unavailable',version:razer.version || null,message:razer.message || 'Keine antwortende Chroma-Schnittstelle gefunden. Es wird keine Chroma-Sitzung geöffnet.'},
      ...[['msi','MSI · Mystic Light'],['kingston','Kingston · FURY CTRL'],['lianli','Lian Li · USB-Controller']].map(([id,name]) => ({id,name,status:native.connected ? native.details?.[id]?.status || 'not-verified' : 'disconnected',deviceCount:controlled.filter(device=>device.provider===id).length,message:native.details?.[id]?.message || 'RGB-Gerätesuche prüft die Hersteller-Anbindung.'})),
    ] };
}

// Fixed loopback GET only. No session registration, heartbeat or LED/category calls.
export async function probeRazerRuntime({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const response = await fetchImpl('http://127.0.0.1:54235/razer/chromasdk', {method:'GET',redirect:'error',signal:AbortSignal.timeout(1500)});
    if (!response.ok) throw new Error('Nicht erreichbar');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try { while (true) { const {done,value} = await reader.read(); if (done) break; length += value.byteLength; if (length > 4096) { await reader.cancel(); throw new Error('Ungültige Antwort'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const raw = data.version?.core ?? data.version ?? data.core;
    const version = typeof raw === 'string' && /^\d+(?:\.\d+){1,3}$/.test(raw) ? raw : null;
    if (!version) throw new Error('Version nicht gemeldet');
    return {status:'available',version,message:`Razer Chroma SDK ${version} erkannt. Reine Statusabfrage; keine Gerätesitzung und keine Farbübertragung.`};
  } catch { return {status:'unavailable',version:null,message:'Keine antwortende Razer-Chroma-Schnittstelle erkannt. Windows-Gerätenamen bleiben unabhängig davon verfügbar.'}; }
}

export function createRazerProbe(read = probeRazerRuntime, now = Date.now) {
  let cache = null, pending = null;
  return () => {
    if (cache && now() - cache.time < 10000) return Promise.resolve(cache.value);
    if (!pending) pending = Promise.resolve().then(read).then(value => { cache = {time:now(),value}; return value; }).finally(() => {pending=null;});
    return pending;
  };
}
