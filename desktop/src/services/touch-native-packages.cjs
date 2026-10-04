'use strict';
const fs=require('node:fs'),path=require('node:path');
const EXTENSIONS=new Set(['.streamdeckplugin','.streamdeckiconpack','.streamdeckprofile']);
function validateNativePackage(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||/[\x00-\x1f]/.test(file)||!EXTENSIONS.has(path.extname(file).toLowerCase()))throw Error('Bitte ein Stream-Deck-Plugin, Icon-Paket oder Profil auswählen.');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size<4||stat.size>256*1024*1024)throw Error('Die Stream-Deck-Datei ist ungültig oder zu groß.');
 const fd=fs.openSync(file,'r');try{const header=Buffer.alloc(4);fs.readSync(fd,header,0,4,0);if(header.readUInt32LE(0)!==0x04034b50)throw Error('Die Datei ist kein Stream-Deck-Paket.');}finally{fs.closeSync(fd);}
 return path.resolve(file);
}
async function openNativePackage(file,shell){const error=await shell.openPath(validateNativePackage(file));if(error)throw Error('Elgato konnte die Datei nicht öffnen. Bitte Stream Deck installieren oder die Dateizuordnung reparieren.');return {opened:true,installed:false};}
module.exports={validateNativePackage,openNativePackage};
