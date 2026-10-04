'use strict';
const fs=require('node:fs'),path=require('node:path');
function cleanText(value,label,max){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw Error(`${label}: Bitte 1 bis ${max} Zeichen eingeben.`);
 return value.trim();
}
function curveForExport(value,curves=[]){
 const source=typeof value==='string'?curves.find(c=>c.id===value):value?.curve;
 if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Bitte eine Lüfterkurve auswählen oder erstellen.');
 const name=cleanText(source.name,'Kurvenname',100),sensorLabel=cleanText(source.sensorLabel,'Temperaturbezug',200);
 if(!Array.isArray(source.points)||source.points.length<2||source.points.length>20)throw Error('Eine Kurve braucht 2 bis 20 Punkte.');
 const points=source.points.map(p=>{
  if(!p||!Number.isFinite(p.temperature)||!Number.isFinite(p.duty)||p.temperature<0||p.temperature>120||p.duty<0||p.duty>100)throw Error('Temperaturen müssen zwischen 0 und 120 °C liegen, Lüfterleistung zwischen 0 und 100 %.');
  return {temperature:p.temperature,duty:p.duty};
 }).sort((a,b)=>a.temperature-b.temperature);
 if(points.some((p,i)=>i>0&&p.temperature===points[i-1].temperature))throw Error('Temperaturen dürfen sich nicht wiederholen.');
 return {id:typeof source.id==='string'&&source.id.length<=150?source.id:'',name,sensorLabel,isCustom:true,points};
}
function curveTable(curve){
 const number=value=>String(value).replace('.',',');
 return [curve.name,'Temperaturbezug: '+curve.sensorLabel,'Temperatur (°C)\tLüfterleistung (%)',...curve.points.map(p=>number(p.temperature)+'\t'+number(p.duty))].join('\r\n');
}
function icueExecutable({env=process.env,exists=fs.existsSync}={}){
 const roots=[env.ProgramW6432,env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean);
 for(const root of new Set(roots))for(const folder of ['Corsair iCUE5 Software','CORSAIR iCUE 4 Software','CORSAIR iCUE Software']){
  const file=path.join(root,'Corsair',folder,'iCUE.exe');if(exists(file))return file;
 }
 throw Error('iCUE wurde nicht im üblichen Installationsordner gefunden. Bitte iCUE über das Startmenü öffnen.');
}
module.exports={curveForExport,curveTable,icueExecutable};
