'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const source=path.resolve(__dirname,'../src/core/physical-input.cs'),output=source.replace(/\.cs$/,'.exe');
const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const result=spawnSync(compiler,['/nologo','/target:exe','/optimize+','/reference:System.Web.Extensions.dll','/reference:System.Windows.Forms.dll','/out:'+output,source,path.resolve(__dirname,'../src/core/keyboard-output.cs')],{windowsHide:true,encoding:'utf8'});
if(result.status!==0)throw new Error(result.stdout||result.stderr||result.error?.message||'Eingabehilfe konnte nicht gebaut werden.');
const test=spawnSync(output,['--self-test'],{windowsHide:true,encoding:'utf8'});if(test.status!==0)throw new Error('Eingabehilfe-Selbsttest fehlgeschlagen.');console.log('Physische Eingabehilfe gebaut und Parser geprüft (keine Eingaben erzeugt).');
