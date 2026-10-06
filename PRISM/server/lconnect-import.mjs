import {STRIMER_WIRELESS_CABLE_TYPES} from './strimer-capabilities.mjs';

// Shared browser/server data reader. It never discovers devices, writes files,
// changes pairing or converts L-Connect mode numbers into hardware commands.
export const MAX_LCONNECT_FILE_BYTES = 1024 * 1024;
export const MAX_LCONNECT_BACKUP_BYTES = 1024 * 1024;
const MAX_DATA_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const labels = {Rainbow:'Regenbogen',Wave:'Welle',StaticColor:'Statische Farbe',Breathing:'Atmen',RainbowMorph:'Regenbogen-Verwandlung',Paint:'Farbauftrag',RainbowWave:'Regenbogenwelle'};
const previewEffects = {Rainbow:'rainbow',Wave:'wave',StaticColor:'static',Breathing:'breathing'};
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => {throw new Error(message);};
const size = text => new TextEncoder().encode(text).length;
const utf8 = bytes => {try {return new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {return fail('Die Sicherung enthält keinen gültigen UTF-8-Text.');}};

function json(text,maximum) {
 if (typeof text !== 'string' || size(text)>maximum) fail('Die L-Connect-Sicherung ist zu groß. Maximal 1 MB ist erlaubt.');
 let value;try {value=JSON.parse(text.replace(/^\uFEFF/,''));} catch {fail('Die Datei enthält keine gültige L-Connect-JSON-Sicherung.');}
 const pending=[[value,0]];let nodes=0;
 while(pending.length) {
  const [item,depth]=pending.pop();if(++nodes>40000||depth>40) fail('Die Struktur der L-Connect-Sicherung ist zu groß oder zu tief.');
  if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)) {
   if(['__proto__','constructor','prototype'].includes(key))fail('Die Sicherung enthält einen ungültigen Konfigurationsschlüssel.');
   pending.push([child,depth+1]);
  }
 }
 return value;
}
function data(entry) {
 if(typeof entry.Data!=='string'||entry.Data.length>Math.ceil(MAX_DATA_BYTES/3)*4||entry.Data.length%4!==0||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.Data))fail('Ein L-Connect-Datensatz ist beschädigt oder zu groß.');
 let binary;try {binary=atob(entry.Data);} catch {fail('Ein L-Connect-Datensatz ist nicht korrekt kodiert.');}
 if(binary.length>MAX_DATA_BYTES)fail('Ein L-Connect-Datensatz ist zu groß.');
 return json(utf8(Uint8Array.from(binary,char=>char.charCodeAt(0))),MAX_DATA_BYTES);
}
function normalizedMac(value) {
 if(typeof value!=='string'||! /^(?:[a-f0-9]{12}|(?:[a-f0-9]{2}:){5}[a-f0-9]{2})$/i.test(value))fail('Eine Kabelkennung in der Sicherung ist ungültig.');
 const mac=value.replaceAll(':','').toLowerCase();if(/^(?:0{12}|f{12})$/.test(mac))fail('Eine Kabelkennung in der Sicherung ist nicht eindeutig.');return mac;
}
function catalog(value) {
 if(!record(value)||Object.keys(value).length>64)fail('Der gespeicherte Effektkatalog ist ungültig.');
 const byMode=new Map();
 for(const [name,setting]of Object.entries(value)) {
  if(!/^[A-Za-z][A-Za-z0-9]{0,59}$/.test(name)||!record(setting)||!Number.isInteger(setting.Mode)||setting.Mode<0||setting.Mode>65535)fail('Der gespeicherte Effektkatalog ist ungültig.');
  byMode.set(setting.Mode,byMode.has(setting.Mode)?null:name);
 }
 return byMode;
}
function rawNumber(value,key) {
 if(value[key]===null||value[key]===undefined)return null;
 if(!Number.isFinite(value[key])||Math.abs(value[key])>1000000)fail('Ein gespeicherter Effektparameter ist ungültig.');return value[key];
}
function setting(value,byMode) {
 if(!record(value)||!Number.isInteger(value.Mode)||value.Mode<0||value.Mode>65535||!Array.isArray(value.Colors)||value.Colors.length>32)fail('Eine gespeicherte Beleuchtungsgruppe ist ungültig.');
 const colors=value.Colors.map(color=>{
  if(!record(color)||['R','G','B','A'].some(key=>!Number.isInteger(color[key])||color[key]<0||color[key]>255))fail('Eine gespeicherte Farbe ist ungültig.');
  return {hex:'#'+['R','G','B'].map(key=>color[key].toString(16).padStart(2,'0')).join(''),alpha:color.A};
 });
 const sourceName=byMode.get(value.Mode)||null,brightness=rawNumber(value,'Brightness');
 const result={sourceName,sourceLabel:sourceName?(labels[sourceName]||sourceName):'Nicht eindeutig benannter Herstellermodus',sourceMode:value.Mode,colors,brightness,speed:rawNumber(value,'Speed'),direction:rawNumber(value,'Direction'),previewPatch:null,warnings:[]};
 const effect=sourceName&&own(previewEffects,sourceName)?previewEffects[sourceName]:null;
 if(effect) {
  const patch={effect};
  // RGB byte channels and 0..100 brightness are directly understandable.
  // Speed, direction, alpha and numeric mode IDs have no confirmed mapping.
  if(sourceName!=='Rainbow'&&colors.length&&colors.length<=8&&colors.every(color=>color.alpha===255))patch.colors=colors.map(color=>color.hex);
  if(brightness!==null&&brightness>=0&&brightness<=100)patch.brightness=brightness;
  result.previewPatch=patch;
  result.warnings.push('Der benannte Effekt wird als ähnliche Batto-Vorschau übernommen; die Herstelleranimation wird nicht exakt nachgebildet.');
 } else result.warnings.push('Dieser Herstellermodus bleibt als Quelleninformation erhalten; der bisherige Batto-Vorschaueffekt bleibt bestehen.');
 if(colors.some(color=>color.alpha!==255)||colors.length>8)result.warnings.push('Die gespeicherte Farbpalette kann nicht vollständig in die Batto-Vorschau übernommen werden.');
 if(brightness!==null&&(brightness<0||brightness>100))result.warnings.push('Die gespeicherte Helligkeit liegt außerhalb der Vorschauwerte und wird nicht übernommen.');
 return result;
}

export function parseLConnectBackup(text) {
 const backup=json(text,MAX_LCONNECT_BACKUP_BYTES);
 if(!record(backup)||typeof backup.Version!=='string'||!/^2\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(backup.Version)||!Array.isArray(backup.Datas)||backup.Datas.length<1||backup.Datas.length>32)fail('Keine unterstützte L-Connect-3-Sicherung der Version 2.');
 if(backup.Type!==0)fail('Bitte die Sicherung „Lighting / Fan Speed“ wählen. Eine LCD-Assets-Sicherung wird nicht als Beleuchtung importiert.');
 if(typeof backup.CreatedAt!=='string'||backup.CreatedAt.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(backup.CreatedAt)||!Number.isFinite(Date.parse(backup.CreatedAt)))fail('Das Exportdatum der Sicherung ist ungültig.');
 const cables=[],identities=new Set(),warnings=[];let totalDataBytes=0;
 for(const entry of backup.Datas) {
  if(!record(entry)||!Number.isInteger(entry.MainType))fail('Die L-Connect-Datensatzliste ist ungültig.');
  if(entry.MainType!==0)continue;
  if(typeof entry.Metadata!=='string'||entry.Metadata.length>512)fail('Die gespeicherte Senderzuordnung ist ungültig.');
  const match=/^usb\\+vid_([a-f0-9]{4})&pid_([a-f0-9]{4})(?:&mi_[a-f0-9]{2})?\\+/i.exec(entry.Metadata);
  if(!match||!['0416:8040','1a86:e304'].includes(`${match[1].toLowerCase()}:${match[2].toLowerCase()}`)){warnings.push('Eine andere Controllerfamilie wurde ausgelassen.');continue;}
  totalDataBytes+=entry.Data?.length||0;if(totalDataBytes>Math.ceil(MAX_DATA_BYTES/3)*4)fail('Die gespeicherten Controllerdaten sind zu groß.');
  const profile=data(entry);
  if(!record(profile)||!Array.isArray(profile.SubProfiles)||profile.SubProfiles.length>10)fail('Die gespeicherte Wireless-Kabelliste ist ungültig.');
  for(const value of profile.SubProfiles) {
   if(value===null)continue;
   if(!record(value))fail('Ein gespeichertes Wireless-Profil ist ungültig.');
   if(value.Type!=='LWirelessStrimerSubProfile'){warnings.push('Ein Profil für ein anderes Wireless-Gerät wurde ausgelassen.');continue;}
   if(cables.length>=10)fail('Die Sicherung enthält zu viele Strimer-Kabel.');
   const mac=normalizedMac(value.MacStr);
   if(identities.has(mac))fail('Die Sicherung enthält dieselbe Kabelkennung mehrfach.');identities.add(mac);
   const layout=STRIMER_WIRELESS_CABLE_TYPES.find(cable=>cable.ledCount===value.LedNum);
   if(!layout)fail('Ein Kabel meldet eine noch nicht unterstützte LED-Gesamtzahl.');
   if(typeof value.GroupName!=='string'||!value.GroupName.trim()||value.GroupName.length>80||/[\u0000-\u001f\u007f]/.test(value.GroupName))fail('Ein gespeicherter Kabelname ist ungültig.');
   if(typeof value.IsSeparate!=='boolean'||!Array.isArray(value.CurrentLightSettingSeparateArray)||value.CurrentLightSettingSeparateArray.length>6)fail('Die gespeicherten Beleuchtungsgruppen sind ungültig.');
   const single=catalog(value.SingleLightingSettings),all=catalog(value.AllLightingSettings);
   const groups=value.CurrentLightSettingSeparateArray.map((group,index)=>({index,...setting(group,single)}));
   const common=setting(value.CurrentLightSettingAll,all);
   cables.push({name:value.GroupName.trim(),mac,identity:`lianli-wireless:${mac}`,family:'wireless',cableType:layout.id,ledCount:layout.ledCount,layoutKnown:true,physicalStrandMapVerified:false,sourceSeparate:value.IsSeparate,groups,common,warnings:[]});
  }
 }
 if(!cables.length)fail('Die Sicherung enthält keine unterstützten Strimer-Wireless-Kabel.');
 const result={version:1,source:{application:'L-Connect 3',version:backup.Version,createdAt:backup.CreatedAt,type:'LightingFanSpeed'},cables,warnings:[...new Set(warnings)]};
 if(size(JSON.stringify(result))>MAX_RESULT_BYTES)fail('Die importierten Vorschauinformationen sind zu groß.');
 return result;
}

function crc32(bytes) {
 let crc=0xffffffff;
 for(const value of bytes) {crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function zipBackup(bytes) {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const u16=offset=>view.getUint16(offset,true),u32=offset=>view.getUint32(offset,true);
 const invalid=()=>fail('Das ZIP ist beschädigt oder keine unterstützte L-Connect-Sicherung.');
 let end=-1;
 for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(u32(offset)===0x06054b50&&offset+22+u16(offset+20)===bytes.length){end=offset;break;}
 if(end<0||u16(end+4)!==0||u16(end+6)!==0||u16(end+8)!==1||u16(end+10)!==1)invalid();
 const central=u32(end+16),centralSize=u32(end+12);
 if(central+centralSize!==end||centralSize<46||central+46>end||u32(central)!==0x02014b50)invalid();
 const flags=u16(central+8),method=u16(central+10),crc=u32(central+16),compressedSize=u32(central+20),length=u32(central+24),nameLength=u16(central+28),extraLength=u16(central+30),commentLength=u16(central+32),local=u32(central+42);
 if(flags&~0x080e||![0,8].includes(method)||u16(central+34)!==0||local!==0||nameLength<1||nameLength>64||extraLength>4096||46+nameLength+extraLength+commentLength!==centralSize||length<1||length>MAX_LCONNECT_BACKUP_BYTES||compressedSize<1||compressedSize>MAX_LCONNECT_FILE_BYTES||((u32(central+38)>>>16)&0xf000)===0xa000)invalid();
 const name=utf8(bytes.subarray(central+46,central+46+nameLength));if(name!=='backup')fail('Das ZIP muss genau die L-Connect-Datei „backup“ enthalten.');
 // ZIP64 is unnecessary for these small files, and is deliberately unsupported.
 for(let offset=central+46+nameLength;offset<central+46+nameLength+extraLength;){if(offset+4>central+46+nameLength+extraLength)invalid();const tag=u16(offset),n=u16(offset+2);if(tag===1||offset+4+n>central+46+nameLength+extraLength)invalid();offset+=4+n;}
 if(central<30||u32(0)!==0x04034b50||u16(6)!==flags||u16(8)!==method)invalid();
 const localName=u16(26),localExtra=u16(28),start=30+localName+localExtra;
 if(localName!==nameLength||localExtra>4096||start>central||utf8(bytes.subarray(30,30+localName))!==name||start+compressedSize>central)invalid();
 if(!(flags&8)&&(u32(14)!==crc||u32(18)!==compressedSize||u32(22)!==length))invalid();
 const remaining=central-start-compressedSize;
 if(flags&8){const descriptor=start+compressedSize,shift=remaining===16&&u32(descriptor)===0x08074b50?4:0;if(remaining!==12+shift||u32(descriptor+shift)!==crc||u32(descriptor+shift+4)!==compressedSize||u32(descriptor+shift+8)!==length)invalid();}
 else if(remaining!==0)invalid();
 return {method,crc,length,compressed:bytes.subarray(start,start+compressedSize)};
}
async function browserInflateRaw(bytes,maximum) {
 if(typeof DecompressionStream!=='function')fail('ZIP-Import ist in dieser Ansicht nicht verfügbar. Bitte die Datei „backup“ als JSON öffnen.');
 let stream;try {stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));} catch {fail('ZIP-Import ist in dieser Ansicht nicht verfügbar. Bitte die Datei „backup“ als JSON öffnen.');}
 const reader=stream.getReader(),chunks=[];let length=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maximum){await reader.cancel();fail('Die entpackte L-Connect-Sicherung ist zu groß.');}chunks.push(value);}}
 catch(error){if(error?.message?.includes('L-Connect'))throw error;fail('Die komprimierte L-Connect-Sicherung ist beschädigt.');}
 const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}

export async function readLConnectImport(input,{inflateRaw=browserInflateRaw}={}) {
 if(typeof input==='string')return parseLConnectBackup(input);
 if(!(input instanceof Uint8Array)||input.length<1||input.length>MAX_LCONNECT_FILE_BYTES)fail('Bitte eine L-Connect-Sicherung mit maximal 1 MB wählen.');
 if(input[0]!==0x50||input[1]!==0x4b)return parseLConnectBackup(utf8(input));
 const entry=zipBackup(input);let bytes;
 try {bytes=entry.method===0?entry.compressed:await inflateRaw(entry.compressed,entry.length);}catch(error){if(error?.message?.includes('L-Connect')||error?.message?.includes('ZIP-Import'))throw error;fail('Die komprimierte L-Connect-Sicherung ist beschädigt.');}
 if(!(bytes instanceof Uint8Array)||bytes.length!==entry.length||crc32(bytes)!==entry.crc)fail('Die ZIP-Prüfsumme der L-Connect-Sicherung stimmt nicht.');
 return parseLConnectBackup(utf8(bytes));
}

export function lconnectPreviewSelection(document,identity,selection) {
 const cable=document?.cables?.find(value=>value.identity===identity);
 if(!cable)fail('Bitte ein Kabel aus der geladenen Sicherung wählen.');
 const setting=selection==='common'?cable.common:cable.groups.find(value=>String(value.index)===String(selection));
 if(!setting)fail('Bitte eine gespeicherte Beleuchtungsgruppe wählen.');
 return structuredClone({source:document.source,cable,selection:selection==='common'?{kind:'common'}:{kind:'group',index:setting.index},setting,previewPatch:setting.previewPatch});
}
