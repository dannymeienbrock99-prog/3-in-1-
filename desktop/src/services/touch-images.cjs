'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
// Fixed thumbnails, a bounded cache, and no external SVG image resolver.
const cache=new Map();
function thumbnail(input){
 const {nativeImage}=require('electron');let bytes,svg=false;
 if(Buffer.isBuffer(input)){bytes=input;svg=bytes.subarray(0,300).toString().includes('<svg');}
 else if(typeof input==='string'&&input.startsWith('data:image/')){
  if(input.length>3*1024*1024)throw Error('Das Tastenbild ist zu groß.');
  const match=/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)(;base64)?,([\s\S]*)$/.exec(input);if(!match)throw Error('Unbekanntes Bildformat.');
  bytes=match[2]?Buffer.from(match[3],'base64'):Buffer.from(decodeURIComponent(match[3]));svg=match[1]==='svg+xml';
 }else{
  if(typeof input!=='string'||!fs.existsSync(input)||fs.statSync(input).size>10*1024*1024)throw Error('Bitte ein Bild unter 10 MB wählen.');
  bytes=fs.readFileSync(input);svg=/\.svg$/i.test(input);
 }
 if(bytes.length>10*1024*1024)throw Error('Das Tastenbild ist zu groß.');
 const key=crypto.createHash('sha256').update(bytes).digest('hex');if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;}
 if(svg){
  if(bytes.length>2*1024*1024)throw Error('SVG-Tastenbilder dürfen höchstens 2 MB groß sein.');
  const text=bytes.toString('utf8');if(/<!ENTITY|<!DOCTYPE/i.test(text))throw Error('Dieses SVG enthält nicht unterstützte Dokumentverweise.');
  const {Resvg}=require('@resvg/resvg-js');const options={font:{loadSystemFonts:false},logLevel:'off'};
  const probe=new Resvg(text,options);if(!Number.isFinite(probe.width)||!Number.isFinite(probe.height)||probe.width<=0||probe.height<=0)throw Error('Ungültige SVG-Bildgröße.');
  if(probe.imagesToResolve().length)throw Error('Externe Bildverweise werden in Tastenbildern nicht geladen.');
  bytes=new Resvg(text,{...options,fitTo:{mode:probe.width>=probe.height?'width':'height',value:144}}).render().asPng();
 }
 if(bytes.length>=24&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&(bytes.readUInt32BE(16)>8192||bytes.readUInt32BE(20)>8192))throw Error('Das Bild ist zu groß. Bitte höchstens 8192 × 8192 Pixel verwenden.');
 const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('Das Tastenbild konnte nicht gelesen werden.');
 const size=image.getSize();if(size.width>8192||size.height>8192)throw Error('Das Bild ist zu groß.');
 const value=image.resize(size.width>=size.height?{width:144}:{height:144}).toDataURL();
 cache.set(key,value);while(cache.size>96)cache.delete(cache.keys().next().value);return value;
}
module.exports={thumbnail,clearCache:()=>cache.clear()};
