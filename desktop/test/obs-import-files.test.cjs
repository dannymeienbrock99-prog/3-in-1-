'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {listCollections,localCollectionFile,readCollectionFile,MAX_BYTES}=require('../src/dual-stream/obs-import-files.cjs');
function temporary(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-obs-files-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
test('local collection list exposes only labels and opaque ids, and resolves only current listed files',t=>{
 const directory=temporary(t),file=path.join(directory,'Meine Szenen.json');fs.writeFileSync(file,'{}');fs.writeFileSync(path.join(directory,'private.json.bak'),'{}');fs.mkdirSync(path.join(directory,'folder.json'));
 const result=listCollections(directory);assert.equal(result.truncated,false);assert.equal(result.collections.length,1);const row=result.collections[0];assert.equal(row.name,'Meine Szenen');assert.match(row.id,/^[a-f0-9]{64}$/);assert.deepEqual(Object.keys(row),['id','name']);assert.equal(localCollectionFile(directory,{id:row.id}),file);
 for(const value of [null,[],{},row.id,{id:'../Meine Szenen.json'},{id:file},{id:'a'.repeat(64)}])assert.throws(()=>localCollectionFile(directory,value),/auswählen|nicht mehr/);
 fs.unlinkSync(file);assert.throws(()=>localCollectionFile(directory,{id:row.id}),/nicht mehr vorhanden/);assert.deepEqual(listCollections(path.join(directory,'missing')),{collections:[],truncated:false});
});
test('local collection discovery stays bounded and reports additional files',t=>{
 const directory=temporary(t);for(let i=0;i<101;i++)fs.writeFileSync(path.join(directory,'Szene-'+i+'.json'),'{}');const result=listCollections(directory);assert.equal(result.collections.length,100);assert.equal(result.truncated,true);assert.equal(new Set(result.collections.map(x=>x.id)).size,100);
});
test('OBS file reader handles BOMs, rejects oversize and non-files, and gives safe actionable errors',t=>{
 const directory=temporary(t),file=path.join(directory,'Sammlung.json'),data={name:'Example',sources:[{id:'scene',name:'Start',settings:{items:[]}}]};fs.writeFileSync(file,'\ufeff'+JSON.stringify(data));assert.deepEqual(readCollectionFile(file),data);
 fs.writeFileSync(file,'{broken');assert.throws(()=>readCollectionFile(file),error=>error.message.includes('„Sammlung.json“')&&error.message.includes('Szenensammlung → Exportieren')&&!error.message.includes(directory));
 fs.truncateSync(file,MAX_BYTES+1);assert.throws(()=>readCollectionFile(file),/maximal 4 MB/);assert.throws(()=>readCollectionFile(directory),/normale OBS-JSON/);assert.throws(()=>readCollectionFile(path.join(directory,'missing.json')),error=>error.message.includes('erneut auswählen')&&!error.message.includes(directory));
});
test('Batto exports point to project import instead of pretending to be malformed OBS scenes',t=>{
 const directory=temporary(t),file=path.join(directory,'Batto-Dual-Stream.json');for(const data of [{version:1,sources:{camera:{}},layouts:{}},{document_type:'project_configuration_specification'}]){fs.writeFileSync(file,JSON.stringify(data));assert.throws(()=>readCollectionFile(file),/Batto-Dual-Stream-Projekt.*Projekt importieren.*Direkt aus OBS/);}
});
test('a file growing during selection is rejected without an unbounded read',t=>{
 const directory=temporary(t),file=path.join(directory,'Changing.json');fs.writeFileSync(file,'{}');const original=fs.readSync;let changed=false;
 try{fs.readSync=function(...args){if(!changed){changed=true;fs.appendFileSync(file,' '.repeat(1000));}assert(args[1].length<=3);return original.apply(this,args);};assert.throws(()=>readCollectionFile(file),/gerade geändert.*erneut auswählen/);}
 finally{fs.readSync=original;}
});
