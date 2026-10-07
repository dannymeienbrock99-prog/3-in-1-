'use strict';
const {EventEmitter} = require('node:events');

const PROVIDER = 'corsair-direct';
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (message, code='CORSAIR_DIRECT_ERROR') => Object.assign(Error(message), {code});
const clean = (value, maximum=240) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,maximum) : '';
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
const offState = () => ({enabled:false,active:false,ownsControl:false,released:true,retryRequired:false,remaining:[],phase:'off',error:'',hubs:[],channels:[],sensors:[],devices:[],releaseVerification:'none',physicalVerification:false,inProcess:true,requiresICue:false});

function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.active !== 'boolean' || typeof input.enabled !== 'boolean' || typeof input.ownsControl !== 'boolean'
    || typeof input.released !== 'boolean' || typeof input.retryRequired !== 'boolean'
    || !Array.isArray(input.remaining) || input.remaining.length > 64 || input.remaining.some(value => !identifier(value)))
    throw fail('Der direkte Corsair-Freigabestatus konnte nicht bestätigt werden.','CORSAIR_INVALID_DATA');
  for (const [name, maximum] of [['hubs',16],['channels',128],['sensors',512],['devices',16]])
    if (!Array.isArray(input[name]) || input[name].length > maximum) throw fail('Corsair hat ungültige Geräteinformationen geliefert.','CORSAIR_INVALID_DATA');
  if (input.released && (input.active || input.enabled || input.ownsControl || input.retryRequired || input.remaining.length))
    throw fail('Corsair hat widersprüchliche Besitzinformationen geliefert.','CORSAIR_INVALID_DATA');
  const hubIds = new Set();
  const hubs = input.hubs.map(value => {
    if (!value || !/^corsair-link-[a-f0-9]{16}$/.test(value.id) || hubIds.has(value.id)
      || value.vendorId !== 0x1b1c || value.productId !== 0x0c3f)
      throw fail('Der gemeldete Corsair-Controller ist nicht eindeutig unterstützt.','CORSAIR_INVALID_DATA');
    hubIds.add(value.id);
    return {id:value.id,name:clean(value.name)||'iCUE LINK System Hub',serial:clean(value.serial,512),firmware:clean(value.firmware,80),vendorId:value.vendorId,productId:value.productId,opened:value.opened===true};
  });
  const channelIds = new Set();
  const channels = input.channels.filter(value => value?.kind === 'fan' && !/pump|pumpe|power supply|netzteil/i.test(`${value.name||''} ${value.device||''}`)).map(value => {
    if (!identifier(value.id) || channelIds.has(value.id) || !hubIds.has(value.hubId)
      || !Number.isInteger(value.channel) || value.channel < 0 || value.channel > 255)
      throw fail('Corsair meldet einen ungültigen Lüfteranschluss.','CORSAIR_INVALID_DATA');
    channelIds.add(value.id);
    return {id:value.id,hubId:value.hubId,channel:value.channel,name:clean(value.name)||'iCUE LINK Lüfter',provider:PROVIDER,device:clean(value.device)||'iCUE LINK System Hub',kind:'fan',
      rpm:Number.isFinite(value.rpm)&&value.rpm>=0&&value.rpm<=65535?value.rpm:null,
      duty:Number.isFinite(value.duty)&&value.duty>=0&&value.duty<=100?value.duty:null,minDuty:30,maxDuty:100};
  });
  const sensorIds = new Set();
  const sensors = input.sensors.map(value => {
    if (!identifier(value?.id) || sensorIds.has(value.id)) throw fail('Corsair meldet einen ungültigen Temperatursensor.','CORSAIR_INVALID_DATA');
    sensorIds.add(value.id);
    return {id:value.id,name:clean(value.name)||'Corsair-Temperatur',celsius:Number.isFinite(value.celsius)&&value.celsius>=0&&value.celsius<=120?value.celsius:null,
      updatedUtc:typeof value.updatedUtc==='string'&&Number.isFinite(Date.parse(value.updatedUtc))?value.updatedUtc:''};
  });
  const deviceIds = new Set();
  const devices = input.devices.map(value => {
    if (!value || !identifier(value.id) || deviceIds.has(value.id) || !hubIds.has(value.id)
      || !Number.isInteger(value.ledCount) || value.ledCount < 1 || value.ledCount > 8192
      || !Array.isArray(value.zones) || value.zones.length < 1 || value.zones.length > 128)
      throw fail('Corsair hat keine eindeutige LED-Anordnung geliefert.','CORSAIR_INVALID_DATA');
    deviceIds.add(value.id);
    const zoneIds = new Set(), coverage = new Set();
    const zones = value.zones.map(zone => {
      if (!zone || !Number.isInteger(zone.id) || zone.id<0 || zoneIds.has(zone.id)
        || !Number.isInteger(zone.startIndex) || zone.startIndex<0 || !Number.isInteger(zone.ledCount) || zone.ledCount<1 || zone.startIndex+zone.ledCount>value.ledCount)
        throw fail('Corsair hat eine ungültige LED-Zone geliefert.','CORSAIR_INVALID_DATA');
      zoneIds.add(zone.id);
      for (let i=zone.startIndex;i<zone.startIndex+zone.ledCount;i++) {
        if (coverage.has(i)) throw fail('Corsair-LED-Zonen überlappen.','CORSAIR_INVALID_DATA');
        coverage.add(i);
      }
      return {id:zone.id,name:clean(zone.name)||`LED-Zone ${zone.id+1}`,startIndex:zone.startIndex,ledCount:zone.ledCount,type:0};
    });
    if (coverage.size!==value.ledCount) throw fail('Die Corsair-LED-Anordnung ist unvollständig.','CORSAIR_INVALID_DATA');
    return {id:value.id,name:clean(value.name)||'iCUE LINK System Hub',serial:clean(value.serial,512),provider:PROVIDER,type:3,ledCount:value.ledCount,zones};
  });
  return {...offState(),enabled:input.enabled,active:input.active,ownsControl:input.ownsControl,released:input.released,retryRequired:input.retryRequired,remaining:[...input.remaining],
    phase:clean(input.phase,40)||'off',error:clean(input.error,1000),hubs,channels,sensors,devices,
    releaseVerification:['device-ack','unconfirmed','none'].includes(input.releaseVerification)?input.releaseVerification:'unconfirmed'};
}

class CorsairDirectControl extends EventEmitter {
  constructor({hardware,beforeTakeover=async()=>{},afterRelease=async()=>{},onChange=()=>{},heartbeatMs=2000,schedule=setInterval,unschedule=clearInterval}={}) {
    super();Object.assign(this,{hardware,beforeTakeover,afterRelease,onChange,heartbeatMs,schedule,unschedule});
    this.state=offState();this.queue=Promise.resolve();this.leasePotential=false;this.sdkSuppressed=false;this.revision=0;
    this.quitting=false;this.closed=false;this.quitPromise=null;this.closePromise=null;this.timer=null;this.heartbeatPromise=null;this.probes=[];
  }
  snapshot() {
    return copy({...this.state,probes:this.probes,sdkSuppressed:this.sdkSuppressed,returnRequired:this.returnRequired||this.sdkSuppressed,enabled:this.state.enabled||this.leasePotential,availability:{native:this.hardware?.available===true,inProcess:true,requiresElevation:process.platform==='win32',
      reason:this.hardware?.available===true?'':'Die integrierte Corsair-Anbindung fehlt. Bitte die Installation reparieren.'},
      curveAvailability:{available:false,reason:'Direkte Corsair-Temperaturkurven werden von dieser Anbindung noch nicht angeboten.'}});
  }
  get ready(){return !this.closed&&!this.quitting&&this.state.active&&this.state.enabled&&this.state.phase==='ready';}
  get returnRequired(){return this.leasePotential||this.state.active||this.state.ownsControl||!this.state.released||this.state.retryRequired||this.state.remaining.length>0;}
  changed(){const state=this.snapshot();this.emit('state',state);try{this.onChange(state);}catch{}}
  serial(action){if(this.closed)return Promise.reject(fail('Die Corsair-Steuerung ist geschlossen.','CORSAIR_CLOSED'));const task=this.queue.then(action);this.queue=task.catch(()=>{});return task;}
  async native(command,values={}){if(!this.hardware?.available)throw fail('Die integrierte Corsair-Anbindung ist nicht verfügbar.','CORSAIR_UNAVAILABLE');return this.hardware.request(PROVIDER,command,values);}
  adopt(value) {
    const next=normalizeSnapshot(value);
    const topology=state=>JSON.stringify([state.hubs.map(hub=>[hub.id,hub.serial]),state.channels.map(channel=>channel.id),state.devices.map(device=>[device.id,device.ledCount,device.zones])]);
    if(next.active!==this.state.active||topology(next)!==topology(this.state))this.revision++;
    next.phase=next.active&&next.enabled&&next.phase!=='error'?'ready':next.phase;
    this.state=next;this.leasePotential=!next.released||next.active||next.ownsControl||next.retryRequired||next.remaining.length>0;
    this.changed();return next;
  }
  failed(error) {
    if(error.state)try{this.adopt(error.state.state||error.state);}catch{}
    this.state.phase='error';this.state.error=clean(error.message,1000)||'Die direkte Corsair-Steuerung ist fehlgeschlagen.';
    if(this.returnRequired)this.leasePotential=true;
    this.stopHeartbeat();this.changed();return error;
  }
  async restoreSdk(){if(!this.sdkSuppressed)return;await this.afterRelease();this.sdkSuppressed=false;}
  inspect(){return this.serial(async()=>{try{const next=this.adopt(await this.native('status'));if(next.released)await this.restoreSdk();return this.snapshot();}catch(error){throw this.failed(error);}});}
  enumerate(){
    if(this.quitting)return Promise.reject(fail('Batto gibt die Corsair-Geräte gerade zurück.','CORSAIR_QUITTING'));
    return this.serial(async()=>{
      if(this.returnRequired)throw fail('Die Corsair-Steuerung zuerst ausschalten, bevor die USB-Erkennung neu geprüft wird.','CORSAIR_RELEASE_REQUIRED');
      try{const reply=await this.native('enumerate');this.adopt(reply.state||reply);
        if(reply.readOnly!==true||reply.hardwareModeChanged!==false||reply.pwmWrites!==0||!Array.isArray(reply.probes)||reply.probes.length>16)
          throw fail('Die lesende Corsair-Erkennung wurde nicht bestätigt.','CORSAIR_INVALID_DATA');
        this.probes=reply.probes.map(value=>{if(!value||!this.state.hubs.some(hub=>hub.id===value.id)||typeof value.readable!=='boolean')throw fail('Ungültige Corsair-Erkennungsantwort.','CORSAIR_INVALID_DATA');return {id:value.id,readable:value.readable,firmware:clean(value.firmware,80),connected:Number.isInteger(value.connected)&&value.connected>=0&&value.connected<=24?value.connected:null,reason:clean(value.reason,500)};});
        this.changed();return this.snapshot();
      }catch(error){throw this.failed(error);}
    });
  }
  enable(enabled,{confirmICuePause=false,hubId}={}) {
    if(typeof enabled!=='boolean')return Promise.reject(fail('Bitte die Corsair-Steuerung ein- oder ausschalten.','CORSAIR_INVALID_CONTROL'));
    if(enabled&&confirmICuePause!==true)return Promise.reject(fail('Bestätige zuerst die vorübergehende Pause von iCUE.','CORSAIR_CONSENT_REQUIRED'));
    if(enabled&&this.quitting)return Promise.reject(fail('Batto gibt die Corsair-Geräte gerade zurück.','CORSAIR_QUITTING'));
    if(hubId!==undefined&&!/^corsair-link-[a-f0-9]{16}$/.test(hubId))return Promise.reject(fail('Ungültige Corsair-Controllerkennung.','CORSAIR_INVALID_TARGET'));
    return this.serial(()=>enabled?this.enableInternal(hubId):this.disableInternal());
  }
  async enableInternal(hubId) {
    if(this.state.active&&this.state.enabled&&this.state.phase==='ready')return this.snapshot();
    if(this.returnRequired)throw fail('Die vorherige Corsair-Steuerung muss zuerst vollständig zurückgegeben werden.','CORSAIR_RELEASE_REQUIRED');
    this.state.phase='starting';this.state.error='';this.changed();
    try {
      // Root stops existing SDK/effect writes before the native library may pause iCUE.
      this.sdkSuppressed=true;await this.beforeTakeover({hubId});
      this.leasePotential=true;this.revision++;
      const reply=await this.native('take-control',{confirmICuePause:true,...(hubId?{hubId}:{})});
      this.adopt(reply);
      if(!this.state.active||!this.state.enabled||this.state.released)throw fail('Die direkte Corsair-Übernahme wurde nicht bestätigt.','CORSAIR_TAKEOVER_FAILED');
      this.state.phase='ready';this.state.error='';this.startHeartbeat();this.changed();return this.snapshot();
    }catch(error){this.failed(error);if(!this.returnRequired)try{await this.restoreSdk();}catch(restoreError){this.state.error+=' '+clean(restoreError.message);this.changed();}throw error;}
  }
  async disableInternal() {
    this.stopHeartbeat();this.state.phase='releasing';this.changed();
    try {
      if(!this.returnRequired&&!this.hardware?.component){this.state=offState();await this.restoreSdk();this.changed();return this.snapshot();}
      const reply=await this.native('release-control');this.adopt(reply.state||reply);
      if(reply.released!==true||reply.ok===false||this.returnRequired||this.state.released!==true)throw fail('Die Corsair-Steuerung wurde nicht vollständig zurückgegeben. Bitte erneut ausschalten.','CORSAIR_RESTORE_FAILED');
      this.state.phase='off';this.state.error='';this.revision++;
      await this.restoreSdk();this.changed();return this.snapshot();
    }catch(error){throw this.failed(error);}
  }
  target(id,kind) {
    if(!this.ready)throw fail('Bitte die direkte Corsair-Steuerung zuerst ausdrücklich übernehmen.','CORSAIR_NOT_ACTIVE');
    const target=this.state[kind].find(value=>value.id===id);
    if(!target)throw fail('Das ausgewählte Corsair-Gerät ist nicht mehr verfügbar.','CORSAIR_DEVICE_CHANGED');
    return target;
  }
  setManual(value) {
    if(!value||!identifier(value.id)||!Number.isInteger(value.duty)||value.duty<30||value.duty>100||value.fanConfirmed!==true)
      return Promise.reject(fail('Bestätige einen Lüfter und eine ganze Leistung zwischen 30 und 100 Prozent.','CORSAIR_INVALID_FAN'));
    const revision=this.revision;
    return this.serial(async()=>{
      if(revision!==this.revision)throw fail('Die Corsair-Übernahme hat sich geändert. Bitte erneut auswählen.','CORSAIR_DEVICE_CHANGED');
      this.target(value.id,'channels');
      try{const reply=await this.native('manual',{id:value.id,duty:value.duty,fanConfirmed:true});
        if(reply?.applied!==true||reply.id!==value.id||reply.duty!==value.duty)throw fail('Die gewünschte Lüfterleistung wurde nicht bestätigt.','CORSAIR_FAN_UNCONFIRMED');
        this.adopt(reply.state);return this.snapshot();
      }catch(error){throw this.failed(error);}
    });
  }
  setColors(deviceId,colors) {
    if(!identifier(deviceId)||!Array.isArray(colors)||colors.length<1||colors.length>8192||colors.some(color=>typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color)))
      return Promise.reject(fail('Ungültige Corsair-LED-Farben.','CORSAIR_INVALID_COLORS'));
    const frame=[...colors],revision=this.revision;
    return this.serial(async()=>{
      if(revision!==this.revision)throw fail('Die Corsair-Übernahme hat sich geändert. Bitte erneut auswählen.','CORSAIR_DEVICE_CHANGED');
      const device=this.target(deviceId,'devices');if(frame.length!==device.ledCount)throw fail('Die Farben müssen genau zur erkannten LED-Anzahl passen.','CORSAIR_INVALID_COLORS');
      try{const reply=await this.native('set',{deviceId,colors:frame});
        if(reply?.applied!==true||reply.deviceId!==deviceId||reply.ledCount!==frame.length)throw fail('Die Corsair-Farbübertragung wurde nicht für dieses Gerät bestätigt.','CORSAIR_RGB_UNCONFIRMED');
        this.adopt(reply.state);return {applied:true,deviceId,ledCount:frame.length,physicalVerification:false};
      }catch(error){throw this.failed(error);}
    });
  }
  startHeartbeat(){this.stopHeartbeat();this.timer=this.schedule(()=>{if(this.closed||this.quitting||!this.state.active||this.heartbeatPromise)return;
    this.heartbeatPromise=this.serial(async()=>{if(!this.state.active||this.quitting)return;try{this.adopt(await this.native('heartbeat'));if(!this.state.active){this.stopHeartbeat();if(this.state.released)await this.restoreSdk();else throw fail('Die Corsair-Übernahme ist unterbrochen. Bitte ausschalten.','CORSAIR_CONTROL_LOST');}}catch(error){throw this.failed(error);}}).catch(()=>{}).finally(()=>{this.heartbeatPromise=null;});
  },this.heartbeatMs);this.timer?.unref?.();}
  stopHeartbeat(){if(this.timer!==null)this.unschedule(this.timer);this.timer=null;}
  prepareHardwareQuit() {
    if(this.quitPromise)return this.quitPromise;this.quitting=true;this.stopHeartbeat();
    const operation=this.queue.then(async()=>{
      if(this.hardware?.component||this.returnRequired){this.adopt(await this.native('status'));}
      if(this.returnRequired||this.sdkSuppressed)await this.disableInternal();
      if(this.returnRequired)throw fail('Corsair konnte nicht vollständig freigegeben werden.','CORSAIR_RESTORE_FAILED');
    });
    this.queue=operation.catch(()=>{});
    this.quitPromise=operation.catch(error=>{this.quitting=false;throw this.failed(error);}).finally(()=>{this.quitPromise=null;});return this.quitPromise;
  }
  cancelHardwareQuit(){if(this.closed||this.quitPromise||this.returnRequired||this.sdkSuppressed)return false;this.quitting=false;return true;}
  close(){if(this.closed)return Promise.resolve();if(this.closePromise)return this.closePromise;this.closePromise=this.prepareHardwareQuit().then(()=>{this.closed=true;}).finally(()=>{this.closePromise=null;});return this.closePromise;}
}
module.exports={CorsairDirectControl,normalizeSnapshot};
