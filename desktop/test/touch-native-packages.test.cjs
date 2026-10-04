'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {validateNativePackage,openNativePackage}=require('../src/services/touch-native-packages.cjs');
function file(t,extension='.streamDeckPlugin',bytes=Buffer.from('504b0304','hex')){const root=fs.mkdtempSync(path.join(os.tmpdir(),'batto-nativepack-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const name=path.join(root,'safe'+extension);fs.writeFileSync(name,bytes);return name;}
test('hands only archive packages to Elgato without claiming installed status',async t=>{const name=file(t),calls=[];const result=await openNativePackage(name,{openPath:async value=>{calls.push(value);return '';}});assert.deepEqual(calls,[name]);assert.deepEqual(result,{opened:true,installed:false});});
test('refuses executables, relative paths, and misleading package bytes',t=>{assert.throws(()=>validateNativePackage(file(t,'.exe')),/auswählen/);assert.throws(()=>validateNativePackage('x.streamDeckPlugin'),/auswählen/);assert.throws(()=>validateNativePackage(file(t,'.streamDeckPlugin',Buffer.from('MZexe'))),/kein Stream-Deck-Paket/);});
test('native app open failure surfaces instead of installation success',async t=>{await assert.rejects(openNativePackage(file(t),{openPath:async()=> 'no association'}),/Dateizuordnung/);});
