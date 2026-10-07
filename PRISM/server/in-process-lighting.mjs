import {WindowsLightingClient} from './windows-lighting.mjs';
import {LianLiLightingClient} from './lianli-lighting.mjs';
import {LianLiWirelessClient} from './lianli-wireless.mjs';
import {KingstonServiceClient,validateKingstonServiceIdentity} from './kingston-service.mjs';
import {BridgeError} from './openrgb.mjs';
import {EventEmitter} from 'node:events';
import {CorsairDirectLightingClient} from './corsair-direct-lighting.mjs';

const nativeRequest = (client,command,values={}) => client.hardware.request(client.nativeProvider,command,values).catch(error=>{
  const failure=new BridgeError(error.message,error.code||'INTEGRATED_HARDWARE_ERROR',422);failure.state=error.state;throw failure;
});
const open = client => {if(client.platform!=='win32'||!client.hardware?.available)throw new BridgeError('Die integrierte Geräteanbindung ist nicht verfügbar.','INTEGRATED_HARDWARE_MISSING',422);client.closing=false;};

export class InProcessWindowsLightingClient extends WindowsLightingClient {
  constructor(hardware,options={}){super(options);this.hardware=hardware;this.nativeProvider='windows';this.inProcess=true;this.sdkTransitioning=false;this.sdkGeneration=0;this.nativeRequests=new Set();}
  get connected(){return this.ready&&!this.closing&&!this.sdkTransitioning;}
  ensureHelper(){open(this);}
  request(command,values={}){try{if(this.sdkTransitioning)throw new BridgeError('Die Windows-RGB-Anbindung wird gerade übergeben.','CORSAIR_SDK_SUSPENDED',409);open(this);const job=nativeRequest(this,command,values);this.nativeRequests.add(job);void job.then(()=>this.nativeRequests.delete(job),()=>this.nativeRequests.delete(job));return job;}catch(error){return Promise.reject(error);}}
  async scan(){const generation=this.sdkGeneration;const result=await super.scan();if(generation!==this.sdkGeneration||this.sdkTransitioning){this.ready=false;this.devices=[];throw new BridgeError('Die Windows-RGB-Abfrage wurde während der Übergabe beendet.','DEVICE_LIST_CHANGED',409);}this.details={...this.details,windows:{...this.details?.windows,inProcess:true,showWindowAvailable:false}};return result;}
  beginCorsairSuspend(){if(!this.sdkTransitioning)this.sdkGeneration++;this.sdkTransitioning=true;this.ready=false;this.devices=[];}
  async transitionCorsair(suspended){this.beginCorsairSuspend();await Promise.allSettled([...this.nativeRequests]);const reply=await nativeRequest(this,suspended?'suspend-corsair':'resume-corsair');if(reply?.suspended!==suspended||reply.inProcess!==true)throw new BridgeError('Die iCUE-SDK-Übergabe wurde nicht bestätigt.','CORSAIR_SDK_UNCONFIRMED',502);this.sdkTransitioning=false;return this.scan();}
  suspendCorsair(){return this.transitionCorsair(true);}
  resumeCorsair(){return this.transitionCorsair(false);}
  async release(){if(this.hardware?.component)await nativeRequest(this,'release');}
  async showWindow(){throw new BridgeError('Die RGB-Ansicht ist in Batto integriert. Für Windows-Beleuchtung Batto in den Vordergrund holen.','INTEGRATED_UI',422);}
  async close(){this.sdkGeneration++;this.closing=true;this.ready=false;this.devices=[];await Promise.allSettled([...this.nativeRequests]);if(this.hardware?.component)await nativeRequest(this,'close');}
  fail(error){this.ready=false;this.devices=[];this.emit('disconnected',error);}
}
export class InProcessLianLiLightingClient extends LianLiLightingClient {
  constructor(hardware,options={}){super(options);this.hardware=hardware;this.nativeProvider='lianli';this.inProcess=true;}
  get connected(){return this.ready&&!this.closing;}
  ensureHelper(){open(this);}
  request(command,values={}){try{open(this);return nativeRequest(this,command,values);}catch(error){return Promise.reject(error);}}
  async close(){this.closing=true;this.ready=false;this.devices=[];if(this.hardware?.component)await nativeRequest(this,'close');}
  fail(error){this.ready=false;this.devices=[];this.emit('disconnected',error);}
}
export class InProcessLianLiWirelessClient extends LianLiWirelessClient {
  constructor(hardware,options={}){super(options);this.hardware=hardware;this.nativeProvider='wireless';this.inProcess=true;}
  get connected(){return this.ready&&!this.closing;}
  ensureHelper(){open(this);}
  request(command,values={}){try{open(this);return nativeRequest(this,command,values);}catch(error){return Promise.reject(error);}}
  setLeaseOwner(){/* The native library has the same lifetime as Batto. */}
  async close(){this.closing=true;this.ready=false;this.devices=[];this.animations.clear();if(this.hardware?.component)await nativeRequest(this,'close');}
  fail(error){this.ready=false;this.devices=[];this.animations.clear();this.emit('disconnected',error);}
}

// Only an explicitly confirmed takeover pauses the two verified services.
// The service lease and WinUSB session share Batto's process and lifetime.
export class InProcessStrimerControl extends EventEmitter {
  constructor(hardware){super();this.hardware=hardware;this.inProcess=true;this.enabled=false;this.phase='off';this.message='Batto greift direkt auf den Funkcontroller zu. Eine Übernahme pausiert L-Connect erst nach deiner Bestätigung.';this.remaining=[];}
  get status(){return {available:this.hardware?.available===true,inProcess:true,requiresServicePause:true,enabled:this.enabled,phase:this.phase,message:this.message,remaining:[...this.remaining]};}
  updateLease(reply){if(!reply||typeof reply.active!=='boolean')return false;this.enabled=reply.active===true||reply.retryRequired===true;this.remaining=Array.isArray(reply.remaining)?reply.remaining.filter(value=>typeof value==='string'):[];return true;}
  async start(confirmed=false){
    if(confirmed!==true)throw new BridgeError('Bestätige zuerst die vorübergehende Pause der L-Connect-Dienste.','WIRELESS_CONSENT_REQUIRED',400);
    this.phase='starting';this.message='Batto prüft den direkten Controllerzugriff.';this.emit('change',this.status);
    try{
      const reply=await this.hardware.request('wireless','take-control',{confirmLConnectPause:true});
      if(!this.updateLease(reply)||reply.ok!==true||reply.active!==true)throw Object.assign(Error('Die Controllerübernahme wurde nicht bestätigt.'),{state:reply});
      this.phase='active';this.message='Der direkte Zugriff ist übernommen. Die gekoppelten Kabel werden jetzt geprüft.';this.emit('change',this.status);return this.status;
    }catch(error){this.updateLease(error.state);this.phase='error';this.message=error.message;this.emit('change',this.status);throw error;}
  }
  async stop(){
    this.phase='restoring';this.message='Batto gibt den Controller frei und stellt L-Connect wieder her.';this.emit('change',this.status);
    try{
      const reply=await this.hardware.request('wireless','release-control');
      if(!this.updateLease(reply)||reply.ok!==true||reply.released!==true||this.enabled)throw Object.assign(Error('Die Wiederherstellung wurde nicht vollständig bestätigt. Bitte erneut ausschalten.'),{state:reply});
      this.phase='off';this.message='Direkte Strimer-Steuerung ausgeschaltet. Der vorherige L-Connect-Zustand ist wiederhergestellt.';this.emit('change',this.status);return this.status;
    }catch(error){this.updateLease(error.state);this.phase='error';this.message=error.message;this.emit('change',this.status);throw error;}
  }
}

export function integratedClients(hardware,corsairDirectControl){return [new InProcessWindowsLightingClient(hardware),new KingstonServiceClient({verifyService:async()=>{
  const proof=await hardware.request('inventory','kingston');
  if(proof?.unavailable===true)throw new BridgeError('Kingston FURY CTRL läuft nicht oder seine Dienstidentität ist nicht lesbar. Die originale Herstellerinstallation wird separat benötigt.','KINGSTON_UNAVAILABLE',503);
  return validateKingstonServiceIdentity(proof);
}}),new InProcessLianLiLightingClient(hardware),new InProcessLianLiWirelessClient(hardware),...(corsairDirectControl?[new CorsairDirectLightingClient({control:corsairDirectControl})]:[])];}
