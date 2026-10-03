'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {initialize,prepareImport}=require('../src/services/obs-settings-import.cjs');
const {ConfigStore}=require('../src/core/config-store.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batto-import-start-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'batto-obs-tool'),target=path.join(dir,'suite');
 new ConfigStore(source).merge({general:{displayName:'Original fixture'}});
 return {source,target,app:{getPath:key=>key==='userData'?target:dir}};
}
test('automatic startup import never replaces already configured suite settings',t=>{
 const f=fixture(t);new ConfigStore(f.target).merge({general:{displayName:'Saved suite fixture'}});
 const file=path.join(f.target,'Batto-OBS-Tool','settings.json'),before=fs.readFileSync(file);
 initialize(f.app);assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.existsSync(path.join(f.target,'obs-import-result.json')),false);
});
test('new suite still imports original on first start; explicit import still works',t=>{
 const f=fixture(t);initialize(f.app);assert.equal(new ConfigStore(f.target).get().general.displayName,'Original fixture');
 new ConfigStore(f.source).merge({general:{displayName:'Updated original'}});prepareImport(f.source,f.target);initialize(f.app);
 assert.equal(new ConfigStore(f.target).get().general.displayName,'Updated original');
});
test('all QA modes leave original profiles out of the test',t=>{
 const f=fixture(t);process.argv.push('--batto-qa-editor');t.after(()=>process.argv.pop());initialize(f.app);assert.equal(fs.existsSync(f.target),false);
});
