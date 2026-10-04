'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),Module=require('node:module'),{EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url');
test('real preload exports and copies visible drafts without changing fan state or launching arbitrary paths',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'batto-fan-ipc-')),file=path.join(directory,'draft.json'),bootstrap=require.resolve('../src/suite-bootstrap.cjs'),load=Module._load,handlers=new Map();let ready,api,clipboard='',opened='',canceled=false;
 const source={id:'saved',name:'Old name',sensorLabel:'CPU',points:[{temperature:30,duty:30},{temperature:70,duty:90}]};
 const expectedExecutable=path.join(directory,'Corsair','Corsair iCUE5 Software','iCUE.exe');fs.mkdirSync(path.dirname(expectedExecutable),{recursive:true});fs.writeFileSync(expectedExecutable,'never executed');
 const previous=process.env.ProgramW6432;process.env.ProgramW6432=directory;
 const event={senderFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/renderer/index.html')).href}};
 class Runtime extends EventEmitter{constructor(){super();this.fan={catalog:{curves:[source]},configure(){throw Error('Export must not persist fan configuration');}};}async start(){} async close(){}}
 const electron={app:{getPath:()=>directory,isPackaged:false,whenReady:()=>({then(fn){ready=fn;return {catch(){}};}})},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},ipcRenderer:{invoke:(name,value)=>handlers.get(name)(event,value)},contextBridge:{exposeInMainWorld(name,value){api=value;}},BrowserWindow:{getAllWindows:()=>[]},dialog:{showSaveDialog:async()=>({canceled,filePath:file})},clipboard:{writeText(text){clipboard=text;}},shell:{async openPath(file){opened=file;return '';}}};
 Module._load=function(request,parent,main){if(request==='electron')return electron;if(parent?.filename===bootstrap&&request==='./services/suite-runtime.cjs')return {SuiteRuntime:Runtime};if(parent?.filename===bootstrap&&request==='../electron/main21.cjs')return {getObsClient:()=>({})};return load.call(this,request,parent,main);};
 let host;
 try{
  delete require.cache[bootstrap];host=require(bootstrap);await ready();
  const preload=path.resolve(__dirname,'../electron/preload.cjs');vm.runInNewContext(fs.readFileSync(preload,'utf8'),{require:()=>electron},{filename:preload});
  const visible={...source,name:'Edited curve',points:[{temperature:80,duty:100},{temperature:40,duty:20}]};
  assert.equal((await api.suite('export-curve',{curve:visible})).ok,true);const exported=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(exported.name,'Edited curve');assert.equal(exported.points[0].duty,20);assert.equal(source.name,'Old name');
  const copy=await api.suite('copy-curve',{curve:visible});assert.equal(copy.hardwareApplied,false);assert.match(clipboard,/Edited curve.*\r\nTemperaturbezug: CPU/);assert.match(clipboard,/40\t20\r\n80\t100/);
  await assert.rejects(api.suite('copy-curve',{curve:{...visible,points:[]}}),/2 bis 20/);assert.match(clipboard,/Edited curve/);
  canceled=true;fs.writeFileSync(file,'unchanged');assert.equal((await api.suite('export-curve',{curve:visible})).ok,false);assert.equal(fs.readFileSync(file,'utf8'),'unchanged');
  await api.suite('open-icue',{path:'C:/untrusted.exe'});assert.equal(opened,expectedExecutable);
  await assert.rejects(handlers.get('suite:copy-curve')({senderFrame:{url:'https://example.invalid/'}},{curve:visible}),/nicht berechtigt/);
 }finally{await host?.close();delete require.cache[bootstrap];Module._load=load;if(previous===undefined)delete process.env.ProgramW6432;else process.env.ProgramW6432=previous;fs.rmSync(directory,{recursive:true,force:true});}
});
