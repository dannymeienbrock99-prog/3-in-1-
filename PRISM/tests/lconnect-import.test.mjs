import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {MAX_LCONNECT_FILE_BYTES,parseLConnectBackup,readLConnectImport,lconnectPreviewSelection} from '../server/lconnect-import.mjs';

const color=(R=20,G=40,B=60,A=255)=>({R,G,B,A});
const lighting=(Mode=2,patch={})=>({Mode,Colors:[color()],Brightness:80,Speed:3,Direction:0,...patch});
const cable=(patch={})=>({Type:'LWirelessStrimerSubProfile',MacStr:'01:02:03:04:05:06',GroupName:'GPU-Kabel',LedNum:174,IsSeparate:true,SingleLightingSettings:{Rainbow:lighting(1),Wave:lighting(2),StaticColor:lighting(3),Breathing:lighting(4),Paint:lighting(6)},AllLightingSettings:{RainbowWave:lighting(20)},CurrentLightSettingAll:lighting(20),CurrentLightSettingSeparateArray:Array.from({length:6},()=>lighting()),...patch});
function backup(profiles=[cable()],patch={}) {
 return {Version:'2.1.29.0',CreatedAt:'2026-01-02T12:34:56.1234567Z',Type:0,Datas:[{MainType:0,SubType:16973824,Metadata:'usb\\vid_0416&pid_8040\\generic-instance',Data:Buffer.from(JSON.stringify({SubProfiles:[...profiles,...Array(10-profiles.length).fill(null)]})).toString('base64')},{MainType:1,Data:'unused'}],...patch};
}
const parse=value=>parseLConnectBackup(JSON.stringify(value));
const inflate=(bytes,maximum)=>inflateRawSync(bytes,{maxOutputLength:maximum});
function crc32(bytes){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(text,{method=8,descriptor=false,name='backup'}={}) {
 const raw=Buffer.from(text),compressed=method===8?deflateRawSync(raw):raw,filename=Buffer.from(name),crc=crc32(raw),flags=descriptor?8:0;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);local.writeUInt16LE(filename.length,26);
 if(!descriptor){local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);}
 const trailing=descriptor?Buffer.alloc(16):Buffer.alloc(0);if(descriptor){trailing.writeUInt32LE(0x08074b50);trailing.writeUInt32LE(crc,4);trailing.writeUInt32LE(compressed.length,8);trailing.writeUInt32LE(raw.length,12);}
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(local.length+filename.length+compressed.length+trailing.length,16);
 return Buffer.concat([local,filename,compressed,trailing,central,filename,end]);
}

test('imports stable cable identities, known total layouts and six source groups without physical addresses',()=>{
 const input=backup([cable(),cable({MacStr:'112233445566',GroupName:'24-Pin',LedNum:132})]),before=JSON.stringify(input),result=parse(input);
 assert.equal(JSON.stringify(input),before);
 assert.equal(result.cables.length,2);assert.equal(result.cables[0].identity,'lianli-wireless:010203040506');assert.equal(result.cables[0].cableType,'wireless-gpu12');assert.equal(result.cables[1].cableType,'wireless-24pin');assert.equal(result.cables[0].groups.length,6);assert.equal(result.cables[0].physicalStrandMapVerified,false);
 assert.deepEqual(Object.keys(result.cables[0].groups[0].previewPatch).sort(),['brightness','colors','effect']);assert.equal(result.cables[0].groups[0].sourceName,'Wave');assert.equal(result.cables[0].groups[0].speed,3);assert.equal(result.cables[0].groups[0].direction,0);
 assert.equal(result.cables[0].deviceId,undefined);assert.equal(result.cables[0].groups[0].startIndex,undefined);assert.equal(result.cables[0].groups[0].previewPatch.speed,undefined);assert.equal(result.cables[0].groups[0].previewPatch.direction,undefined);assert.equal(result.cables[0].groups[0].previewPatch.mode,undefined);
});
test('resolves effects only through the export catalog, never hardcoded numeric mode IDs',()=>{
 const profile=cable({SingleLightingSettings:{Wave:lighting(41),Paint:lighting(2)},CurrentLightSettingSeparateArray:[lighting(41),lighting(2)]}),result=parse(backup([profile]));
 assert.equal(result.cables[0].groups[0].previewPatch.effect,'wave');assert.equal(result.cables[0].groups[1].sourceName,'Paint');assert.equal(result.cables[0].groups[1].previewPatch,null);
 const ambiguous=cable({SingleLightingSettings:{Wave:lighting(2),Paint:lighting(2)}});assert.equal(parse(backup([ambiguous])).cables[0].groups[0].previewPatch,null);
});
test('keeps unknown or unsupported effects source-only and retains untranslatable source values',()=>{
 const profile=cable({CurrentLightSettingSeparateArray:[lighting(999,{Speed:-1,Direction:777,Brightness:-1})]});const group=parse(backup([profile])).cables[0].groups[0];assert.equal(group.sourceName,null);assert.equal(group.sourceMode,999);assert.equal(group.previewPatch,null);assert.equal(group.speed,-1);assert.equal(group.direction,777);assert.equal(group.brightness,-1);
});
test('does not copy rainbow placeholder colours, translucent palettes or unsupported brightness into previews',()=>{
 const profile=cable({CurrentLightSettingSeparateArray:[lighting(1,{Colors:[color(0,0,0)]}),lighting(2,{Colors:[color(20,40,60,10)],Brightness:999})]}),groups=parse(backup([profile])).cables[0].groups;
 assert.deepEqual(groups[0].previewPatch,{effect:'rainbow',brightness:80});assert.deepEqual(groups[1].previewPatch,{effect:'wave'});assert.equal(groups[1].colors[0].alpha,10);assert.ok(groups[1].warnings.length>=2);
});
test('supports only known 116/132/174/88 LED totals without treating names as hardware evidence',()=>{
 for(const [ledCount,type]of [[116,'wireless-gpu8'],[132,'wireless-24pin'],[174,'wireless-gpu12'],[88,'wireless-cpu8']])assert.equal(parse(backup([cable({LedNum:ledCount,GroupName:'Beliebiger Benutzername'})])).cables[0].cableType,type);
 assert.throws(()=>parse(backup([cable({LedNum:170})])),/LED-Gesamtzahl/);
});
test('rejects LCD backups, unknown formats, duplicate identities, invalid colours and oversized groups',()=>{
 for(const value of [backup([], {Type:1}),backup([], {Version:'3.0.0'}),backup([], {CreatedAt:'yesterday'}),backup([cable(),cable()]),backup([cable({MacStr:'not-a-mac'})]),backup([cable({MacStr:'00:00:00:00:00:00'})]),backup([cable({CurrentLightSettingSeparateArray:Array(7).fill(lighting())})]),backup([cable({CurrentLightSettingSeparateArray:[lighting(2,{Colors:[color(256)]})]})])])assert.throws(()=>parse(value));
 assert.throws(()=>parse(backup([cable({CurrentLightSettingSeparateArray:[lighting(2,{Speed:1000001})]})])),/parameter/);
});
test('rejects invalid encoding and hostile JSON structure without inspecting unrelated hardware metadata',()=>{
 const value=backup();value.Datas[0].Data='###=';assert.throws(()=>parse(value),/Datensatz/);
 assert.throws(()=>parseLConnectBackup('{"__proto__":{},"Version":"2.1.29.0"}'),/Konfigurationsschlüssel/);
 assert.throws(()=>parseLConnectBackup(JSON.stringify({nested:Array.from({length:40001},()=>0)})),/Struktur/);
 assert.throws(()=>parse(backup([cable({GroupName:'Bad\u0000name'})])),/Kabelname/);
 const other=backup();other.Datas[0].Metadata='usb\\vid_1a86&pid_8091\\generic';assert.throws(()=>parse(other),/keine unterstützten/);
});
test('plain UTF-8 JSON, stored ZIP, deflate ZIP and descriptor ZIP yield the same local-only result',async()=>{
 const text=JSON.stringify(backup()),expected=parseLConnectBackup(text);
 for(const bytes of [Buffer.from(text),zip(text,{method:0}),zip(text),zip(text,{descriptor:true})])assert.deepEqual(await readLConnectImport(bytes,{inflateRaw:inflate}),expected);
});
test('browser-native bounded decompression reads an ordinary deflate backup',async()=>{
 assert.deepEqual(await readLConnectImport(zip(JSON.stringify(backup()))),parse(backup()));
});
test('ZIP validation rejects checksum corruption, encryption, path entries, split archives, extra entries and zip bombs',async()=>{
 const text=JSON.stringify(backup()),mutations=[];
 const stored=zip(text,{method:0});stored[40]^=1;mutations.push(stored);
 const encrypted=zip(text);encrypted.writeUInt16LE(1,6);const central=encrypted.readUInt32LE(encrypted.length-6);encrypted.writeUInt16LE(1,central+8);mutations.push(encrypted);
 mutations.push(zip(text,{name:'../backup'}));
 const split=zip(text);split.writeUInt16LE(1,split.length-18);mutations.push(split);
 const multi=zip(text);multi.writeUInt16LE(2,multi.length-14);multi.writeUInt16LE(2,multi.length-12);mutations.push(multi);
 const bomb=zip(text);const bombCentral=bomb.readUInt32LE(bomb.length-6);bomb.writeUInt32LE(MAX_LCONNECT_FILE_BYTES+1,bombCentral+24);mutations.push(bomb);
 mutations.push(zip(text).subarray(0,15));
 for(const bytes of mutations)await assert.rejects(readLConnectImport(bytes,{inflateRaw:inflate}));
 await assert.rejects(readLConnectImport(Buffer.alloc(MAX_LCONNECT_FILE_BYTES+1)),/maximal/);
 await assert.rejects(readLConnectImport(zip(text),{inflateRaw:()=>new Uint8Array(1)}),/Prüfsumme/);
});
test('explicit preview selection carries its stable identity and source groups without touching input or guessing another cable',()=>{
 const document=parse(backup()),before=JSON.stringify(document),result=lconnectPreviewSelection(document,document.cables[0].identity,'0');assert.equal(JSON.stringify(document),before);assert.equal(result.cable.identity,document.cables[0].identity);assert.deepEqual(result.selection,{kind:'group',index:0});assert.deepEqual(result.previewPatch,{effect:'wave',colors:['#14283c'],brightness:80});
 result.cable.name='Modified draft';assert.equal(document.cables[0].name,'GPU-Kabel');assert.throws(()=>lconnectPreviewSelection(document,'lianli-wireless:112233445566','0'),/Kabel/);assert.throws(()=>lconnectPreviewSelection(document,document.cables[0].identity,'99'),/Beleuchtungsgruppe/);
 assert.equal(lconnectPreviewSelection(document,document.cables[0].identity,'common').previewPatch,null);
});
