'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {EventEmitter} = require('node:events');
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
let definitions;

function loadComponent(root, ffi = require('koffi')) {
  const runtime = path.join(root, 'runtime');
  const hostPath = path.join(runtime, 'host', 'fxr', '8.0.31', 'hostfxr.dll');
  const config = path.join(root, 'Batto.Hardware.runtimeconfig.json');
  const assembly = path.join(root, 'Batto.Hardware.dll');
  for (const file of [hostPath, config, assembly]) if (!fs.existsSync(file)) throw Error('Die integrierte Batto-Geräteanbindung fehlt. Bitte die Installation reparieren.');
  if (!definitions) definitions = {
    parameters: ffi.struct({size:'size_t',host_path:'str16',dotnet_root:'str16'}),
    loader: ffi.proto('int32_t __stdcall (const char16_t *, const char16_t *, const char16_t *, void *, void *, _Out_ void **)'),
    invoke: ffi.proto('int32_t __cdecl (const uint8_t *, int32_t, _Out_ void **, _Out_ int32_t *)'),
    free: ffi.proto('void __cdecl (void *)')
  };
  const library = ffi.load(hostPath);
  const initialize = library.func('hostfxr_initialize_for_runtime_config', 'int32_t', ['str16', ffi.pointer(definitions.parameters), ffi.out(ffi.pointer('void *'))]);
  const getDelegate = library.func('int32_t __cdecl hostfxr_get_runtime_delegate(void *, int32_t, _Out_ void **)');
  const close = library.func('int32_t __cdecl hostfxr_close(void *)');
  const context = [null];
  const code = initialize(config, {size:ffi.sizeof(definitions.parameters),host_path:process.execPath,dotnet_root:runtime}, context);
  if (code < 0 || !context[0]) throw Error('Die integrierte Batto-Geräteanbindung konnte nicht geladen werden.');
  const pointer = [null];
  try {if (getDelegate(context[0], 5, pointer) < 0 || !pointer[0]) throw Error('Die integrierte Geräteanbindung ist nicht verfügbar.');}
  finally {close(context[0]);}
  const loader = ffi.decode(pointer[0], definitions.loader);
  const bind = (method, type) => {
    const target = [null];
    if (loader(assembly, 'Batto.Hardware.NativeExports, Batto.Hardware', method, -1n, null, target) < 0 || !target[0]) throw Error('Die integrierte Geräteanbindung passt nicht zu dieser Batto-Version.');
    return ffi.decode(target[0], type);
  };
  // Keep hostfxr alive: unloading a runtime still referenced by managed code
  // is unsupported. No EXE, subprocess or external controller is started.
  return {library,ffi,invoke:bind('Invoke',definitions.invoke),free:bind('Free',definitions.free)};
}

class BattoHardware extends EventEmitter {
  constructor({root,platform=process.platform,load=loadComponent}={}) {
    super();Object.assign(this,{root,platform,load});this.component=null;this.sequence=0;this.queues=new Map();this.providers=new Set();this.closed=false;this.pending=0;
  }
  get available(){return this.platform==='win32' && !!this.root && fs.existsSync(path.join(this.root,'Batto.Hardware.dll'));}
  get status(){return {available:this.available,loaded:!!this.component,inProcess:true,processId:process.pid,pending:this.pending};}
  request(provider,command,values={}) {
    if (this.closed) return Promise.reject(Error('Die Batto-Geräteanbindung ist geschlossen.'));
    if(this.closePromise&&!['close','shutdown','disable','release','release-control'].includes(command))return Promise.reject(Error('Die Batto-Geräteanbindung wird geschlossen.'));
    if (!['wireless','fan','windows','lianli','inventory','corsair-direct'].includes(provider) || typeof command!=='string' || !/^[a-z][a-z-]{0,40}$/.test(command)) return Promise.reject(Error('Ungültige Geräteanfrage.'));
    const requestId=++this.sequence;
    const input=Buffer.from(JSON.stringify({...values,provider,command,requestId}),'utf8');
    if (input.length>MAX_BYTES) return Promise.reject(Error('Die Geräteanfrage ist zu groß.'));
    const task=(this.queues.get(provider)||Promise.resolve()).then(async()=>{
      if (!this.available) throw Error('Die integrierte Geräteanbindung benötigt Windows und die vollständige Batto-Installation.');
      if (!this.component) this.component=this.load(this.root);
      const component=this.component, response=[null], length=[0];this.pending++;this.providers.add(provider);
      try {
        const code=await new Promise((resolve,reject)=>component.invoke.async(input,input.length,response,length,(error,result)=>error?reject(error):resolve(result)));
        if (code!==0 || !response[0] || !Number.isInteger(length[0]) || length[0]<2 || length[0]>MAX_RESPONSE_BYTES) throw Error('Die integrierte Geräteanbindung hat ungültig geantwortet.');
        const bytes=component.ffi.decode(response[0],'uint8_t',length[0]);
        const reply=JSON.parse(Buffer.from(bytes).toString('utf8'));
        if (!reply || reply.requestId!==requestId || typeof reply.ok!=='boolean') throw Error('Die Geräteantwort konnte nicht zugeordnet werden.');
        if (!reply.ok) {const error=Error(reply.error?.message||reply.message||'Der Gerätezugriff ist fehlgeschlagen.');error.code=reply.error?.code||'BATTO_HARDWARE_ERROR';error.state=reply.result||reply.error?.state;throw error;}
        return Object.hasOwn(reply,'result')?reply.result:reply;
      } finally {if(response[0]) component.free(response[0]);this.pending--;}
    });
    this.queues.set(provider,task.catch(()=>{}));return task;
  }
  close(){if(this.closed)return Promise.resolve();if(this.closePromise)return this.closePromise;this.closePromise=Promise.resolve().then(async()=>{const results=await Promise.allSettled([...this.providers].map(provider=>this.request(provider,provider==='fan'?'shutdown':'close')));const failed=results.find(value=>value.status==='rejected');if(failed)throw failed.reason;this.closed=true;}).finally(()=>{this.closePromise=null;});return this.closePromise;}
}

// The fan service keeps its existing confirmed-command schema. All native
// requests now enter the library in the existing Batto process.
class InProcessFanHost {
  constructor({hardware,onState=()=>{},onExit=()=>{}}){Object.assign(this,{hardware,onState,onExit});this.ended=false;}
  async start(){if(this.ended)throw Error('Die Lüfteranbindung ist geschlossen.');await this.hardware.request('fan','status');}
  async request(command,values={}){if(this.ended)throw Error('Die Lüfteranbindung ist geschlossen.');return this.hardware.request('fan',command,values);}
  async close(){if(this.ended)return;await this.hardware.request('fan','shutdown');this.ended=true;this.onExit();}
}
module.exports={BattoHardware,InProcessFanHost,loadComponent};
