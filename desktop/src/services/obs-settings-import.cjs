'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {migrateConfig}=require('../core/config-store.cjs');
const {assertValidConfig}=require('../core/settings/schema.cjs');
const CORE='Batto-OBS-Tool',PENDING='obs-import-pending.json',REPORT='obs-import-result.json';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
function copy(source,target){
 const stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('Verknüpfte Einstellungsdateien werden nicht automatisch übernommen.');
 if(stat.isDirectory()){fs.mkdirSync(target,{recursive:true});for(const name of fs.readdirSync(source))copy(path.join(source,name),path.join(target,name));}
 else if(stat.isFile()){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}
}
function rewrite(value,source,target){
 if(Array.isArray(value))return value.map(v=>rewrite(v,source,target));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,source,target)]));
 if(typeof value!=='string')return value;
 for(const [from,to]of [[source,target],[source.replaceAll('\\','/'),target.replaceAll('\\','/')],[pathToFileURL(source).href,pathToFileURL(target).href]]){
  if(value.toLowerCase()===from.toLowerCase()||value.toLowerCase().startsWith((from+path.sep).toLowerCase())||value.toLowerCase().startsWith((from+'/').toLowerCase()))return to+value.slice(from.length);
 }
 return value;
}
function counts(c){return {commands:c.commands.length,events:c.events.length,actionChains:c.actionChains.length,hotkeys:c.hotkeys.length,broadcasts:c.autoBroadcast.items.length,legacyBroadcasts:c.autoBroadcast.messages.length,broadcastEnabled:c.autoBroadcast.enabled,botConfigured:!!c.streamerbot,profiles:true};}
function prepareImport(sourceUserData,targetUserData){
 const source=path.resolve(sourceUserData,CORE),target=path.resolve(targetUserData,CORE);
 if(source.toLowerCase()===target.toLowerCase()||target.toLowerCase().startsWith(source.toLowerCase()+path.sep))throw Error('Quelle und Ziel müssen getrennt sein.');
 const sourceFile=path.join(source,'settings.json'),sourceHash=hash(sourceFile);
 const cfg=migrateConfig(rewrite(read(sourceFile),source,target));
 // Separate local listeners allow the original program and suite to coexist.
 cfg.http.port=17787;cfg.navigation.port=17788;assertValidConfig(cfg);
 const name='obs-import-stage-'+crypto.randomUUID(),stage=path.join(targetUserData,name);fs.mkdirSync(stage,{recursive:true});
 for(const entry of ['assets','profiles','data','secrets.bin','broadcast-echoes.json']){
  const from=path.join(source,entry);if(fs.existsSync(from))copy(from,path.join(stage,entry));
 }
 // Saved profiles may reference files inside the original data directory too.
 const profileDir=path.join(stage,'profiles');
 if(fs.existsSync(profileDir))for(const name of fs.readdirSync(profileDir)){const file=path.join(profileDir,name);if(name.endsWith('.json')&&fs.statSync(file).isFile())atomic(file,rewrite(read(file),source,target));}
 atomic(path.join(stage,'settings.json'),cfg);
 const sourceState=path.join(sourceUserData,'Local State');
 const cryptoState=fs.existsSync(sourceState)?read(sourceState).os_crypt:null;
 if(cryptoState?.encrypted_key)atomic(path.join(stage,'import-os-crypt.json'),cryptoState);
 if(sourceHash!==hash(sourceFile))throw Error('Das Original hat seine Einstellungen während des Kopierens verändert. Bitte erneut übernehmen.');
 const sourceSecrets=path.join(source,'secrets.bin'),stagedSecrets=path.join(stage,'secrets.bin');
 if(fs.existsSync(sourceSecrets)&&hash(sourceSecrets)!==hash(stagedSecrets))throw Error('Zugangsdaten haben sich beim Kopieren verändert. Bitte erneut übernehmen.');
 const pending={version:1,stage:name,sourceHash,settingsHash:hash(path.join(stage,'settings.json')),secretsHash:fs.existsSync(stagedSecrets)?hash(stagedSecrets):null,cryptoHash:cryptoState?.encrypted_key?hash(path.join(stage,'import-os-crypt.json')):null,preparedUtc:new Date().toISOString(),counts:counts(cfg)};
 atomic(path.join(targetUserData,PENDING),pending);return pending;
}
function applyPending(targetUserData){
 const pendingFile=path.join(targetUserData,PENDING);if(!fs.existsSync(pendingFile))return null;
 const pending=read(pendingFile);if(!/^obs-import-stage-[a-f0-9-]{36}$/.test(pending.stage))throw Error('Ungültiger Importordner.');
 const stage=path.join(targetUserData,pending.stage),target=path.join(targetUserData,CORE);
 assertValidConfig(read(path.join(stage,'settings.json')));
 if(hash(path.join(stage,'settings.json'))!==pending.settingsHash||pending.secretsHash&&hash(path.join(stage,'secrets.bin'))!==pending.secretsHash)throw Error('Die vorbereiteten Einstellungen wurden verändert.');
 if(pending.cryptoHash&&hash(path.join(stage,'import-os-crypt.json'))!==pending.cryptoHash)throw Error('Der geschützte Importschlüssel wurde verändert.');
 const backup='obs-before-import-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID();
 const localState=path.join(targetUserData,'Local State'),stateBackup=path.join(targetUserData,backup+'-local-state.json');
 const previousState=fs.existsSync(localState)?fs.readFileSync(localState):null;
 let backedUp=false;
 try{
  if(fs.existsSync(target)){fs.renameSync(target,path.join(targetUserData,backup));backedUp=true;}
  // Chromium must receive the source DPAPI-protected key BEFORE app.ready.
  // Keep the suite's previous Local State beside its settings backup for recovery.
  if(pending.cryptoHash){
   if(previousState)fs.writeFileSync(stateBackup,previousState);
   atomic(localState,{...(previousState?JSON.parse(previousState.toString('utf8')):{}),os_crypt:read(path.join(stage,'import-os-crypt.json'))});
  }
  fs.renameSync(stage,target);
 }catch(e){
  if(backedUp&&!fs.existsSync(target))fs.renameSync(path.join(targetUserData,backup),target);
  if(pending.cryptoHash){if(previousState)fs.writeFileSync(localState,previousState);else if(fs.existsSync(localState))fs.unlinkSync(localState);}
  throw e;
 }
 const result={ok:true,appliedUtc:new Date().toISOString(),backup:backedUp?backup:null,counts:pending.counts};
 atomic(path.join(targetUserData,REPORT),result);
 fs.renameSync(pendingFile,path.join(targetUserData,'obs-import-applied-'+crypto.randomUUID()+'.json'));
 return result;
}
function status(targetUserData){
 try{if(fs.existsSync(path.join(targetUserData,PENDING)))return {pending:true,counts:read(path.join(targetUserData,PENDING)).counts};if(fs.existsSync(path.join(targetUserData,REPORT)))return read(path.join(targetUserData,REPORT));}catch{}
 try{if(fs.existsSync(path.join(targetUserData,'obs-import-error.json')))return {ok:false,error:read(path.join(targetUserData,'obs-import-error.json')).message};}catch{}
 return {ok:false,pending:false};
}
function initialize(app){
 if(process.env.BATTO_OBS_DATA||process.argv.includes('--batto-qa-suite'))return;
 const target=app.getPath('userData');
 try{
  if(!fs.existsSync(path.join(target,PENDING))&&!fs.existsSync(path.join(target,REPORT))){const source=path.join(app.getPath('appData'),'batto-obs-tool');if(fs.existsSync(path.join(source,CORE,'settings.json')))prepareImport(source,target);}
  applyPending(target);
 }catch(e){atomic(path.join(target,'obs-import-error.json'),{message:e.message,time:new Date().toISOString()});}
}
module.exports={prepareImport,applyPending,initialize,status,rewrite};
if(require.main===module){const [source,target]=process.argv.slice(2);if(!source||!target)throw Error('Quelle und Ziel fehlen.');console.log(JSON.stringify({prepared:true,...prepareImport(source,target).counts}));}
