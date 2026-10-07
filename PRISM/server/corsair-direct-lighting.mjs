import {EventEmitter} from 'node:events';
import {BridgeError,colorHex,publicController} from './openrgb.mjs';
import {assertDeviceAllowed} from './device-policy.mjs';

const BASE_ID=70000,MAX_DEVICES=256;
const error=(message,code='CORSAIR_DIRECT_ERROR')=>new BridgeError(message,code,422);
const signature=devices=>JSON.stringify(devices.map(device=>[device.nativeId,device.ledCount,device.zones]));

// Cooling and RGB share one explicit controller lease. Opening this RGB client
// never pauses iCUE, takes a fan, or switches a hub's hardware/software mode.
export class CorsairDirectLightingClient extends EventEmitter {
  constructor({control}={}) {
    super();if(!control||typeof control.snapshot!=='function'||typeof control.setColors!=='function')throw error('Die gemeinsame Corsair-Steuerung fehlt.','CORSAIR_CONTROL_MISSING');
    this.control=control;this.backend='corsair-direct';this.inProcess=true;this.devices=[];this.details=null;this.ready=false;this.closing=false;
    this.identities=new Map();this.nextId=BASE_ID;this.revision=0;
    this.onState=state=>this.observe(state);
    control.on('state',this.onState);this.listening=true;
  }
  get connected(){return this.ready&&!this.closing&&this.control.ready===true;}
  observe(state) {
    const wasConnected=this.ready&&!this.closing;
    if(!state?.active||!state.enabled||state.phase!=='ready') {
      if(wasConnected||this.devices.length)this.revision++;
      this.ready=false;this.devices=[];
      if(wasConnected)this.emit('disconnected',error(state?.error||'Die direkte Corsair-Steuerung ist nicht aktiv.','CORSAIR_NOT_ACTIVE'));
      return;
    }
    if(!this.ready||this.closing)return;
    const next=this.mapDevices(state.devices);
    if(signature(next)!==signature(this.devices)) {
      this.devices=[];this.ready=false;this.revision++;
      this.emit('devicesChanged');
    }
    // A telemetry heartbeat retains object identities and known RGB frame state.
  }
  mapDevices(values) {
    if(!Array.isArray(values)||values.length>16)throw error('Corsair hat eine ungültige RGB-Geräteliste geliefert.','CORSAIR_INVALID_DATA');
    const seen=new Set();
    return values.map(value=>{
      if(!value||typeof value.id!=='string'||!/^corsair-link-[a-f0-9]{16}$/.test(value.id)||seen.has(value.id)
        ||!Number.isInteger(value.ledCount)||value.ledCount<1||value.ledCount>8192||!Array.isArray(value.zones)||!value.zones.length||value.zones.length>128)
        throw error('Corsair hat keine bestätigte LED-Anordnung geliefert.','CORSAIR_INVALID_DATA');
      seen.add(value.id);
      let id=this.identities.get(value.id);
      if(id===undefined){if(this.nextId>=BASE_ID+MAX_DEVICES)throw error('Zu viele unterschiedliche Corsair-Controller. Bitte die RGB-Anbindung neu öffnen.','CORSAIR_ID_EXHAUSTED');id=this.nextId++;this.identities.set(value.id,id);}
      const zoneIds=new Set(),coverage=new Set();
      const zones=value.zones.map(zone=>{
        if(!zone||!Number.isInteger(zone.id)||zone.id<0||zoneIds.has(zone.id)||!Number.isInteger(zone.startIndex)||zone.startIndex<0
          ||!Number.isInteger(zone.ledCount)||zone.ledCount<1||zone.startIndex+zone.ledCount>value.ledCount)throw error('Ungültige Corsair-LED-Zone.','CORSAIR_INVALID_DATA');
        zoneIds.add(zone.id);
        for(let i=zone.startIndex;i<zone.startIndex+zone.ledCount;i++){if(coverage.has(i))throw error('Corsair-LED-Zonen überlappen.','CORSAIR_INVALID_DATA');coverage.add(i);}
        return {id:zone.id,name:String(zone.name||`LED-Zone ${zone.id+1}`),startIndex:zone.startIndex,ledCount:zone.ledCount,hardwareLedCount:zone.ledCount,type:0};
      });
      if(coverage.size!==value.ledCount)throw error('Die Corsair-LED-Anordnung ist unvollständig.','CORSAIR_INVALID_DATA');
      const device={id,nativeId:value.id,hubId:value.id,name:String(value.name||'iCUE LINK System Hub'),vendor:'Corsair',serial:String(value.serial||''),provider:this.backend,backend:this.backend,type:3,
        ledCount:value.ledCount,physicalLedCount:value.ledCount,layoutValid:true,ledGranularity:'led',directMode:true,directModeId:0,
        colors:Array(value.ledCount).fill(0),colorsKnown:false,leds:Array.from({length:value.ledCount},(_,index)=>({id:index,name:`LED ${index+1}`,color:'#000000'})),
        zones,modes:[{id:0,name:'Batto direkt'}],nativeEffects:[],physicalVerification:false};
      assertDeviceAllowed(device);return device;
    });
  }
  async connect(){return this.scan();}
  async scan() {
    if(!this.listening){this.control.on('state',this.onState);this.listening=true;}
    this.closing=false;this.ready=false;this.devices=[];const revision=++this.revision;
    // The validated shared snapshot also avoids a queue cycle: takeover waits
    // for existing RGB operations, so RGB discovery cannot wait behind it.
    if(this.closing||this.revision!==revision)throw error('Die Corsair-RGB-Abfrage wurde geschlossen.','CORSAIR_DEVICE_CHANGED');
    const state=this.control.snapshot();
    this.details={corsairDirect:{status:state.active&&state.enabled&&state.phase==='ready'?'active':'off',inProcess:true,message:state.error||'Direkte Corsair-Steuerung erst nach ausdrücklicher Übernahme.',releaseVerification:state.releaseVerification,physicalVerification:false},warnings:state.error?[state.error]:[]};
    if(!state.active||!state.enabled||state.phase!=='ready')return [];
    this.devices=this.mapDevices(state.devices);this.ready=true;return this.devices.map(publicController);
  }
  target(device) {
    if(!this.connected||!this.devices.includes(device))throw error('Dieses Corsair-Gerät ist nicht mehr verbunden. Bitte erneut suchen.','CORSAIR_DEVICE_CHANGED');
    assertDeviceAllowed(device);return device;
  }
  async selectDirect(device){this.target(device);}
  async update(device,colors) {
    this.target(device);
    if(!Array.isArray(colors)||colors.length!==device.ledCount||colors.some(color=>!Number.isInteger(color)||color<0||color>0xffffff))throw error('Ungültige Corsair-LED-Farben.','INVALID_COLORS');
    const revision=this.revision,frame=[...colors];
    const result=await this.control.setColors(device.nativeId,frame.map(colorHex));
    if(this.revision!==revision||!this.connected||!this.devices.includes(device))throw error('Die Corsair-Verbindung hat sich während der Farbübertragung geändert.','CORSAIR_DEVICE_CHANGED');
    if(result?.applied!==true||result.deviceId!==device.nativeId||result.ledCount!==device.ledCount)throw error('Die Corsair-Farbübertragung wurde nicht bestätigt.','CORSAIR_RGB_UNCONFIRMED');
    device.colors=frame;device.colorsKnown=true;device.leds.forEach((led,index)=>{led.color=colorHex(frame[index]);});
    return {applied:true,deviceId:device.id,ledCount:frame.length,physicalVerification:false};
  }
  async readTelemetry(){return [];}
  async close(){this.closing=true;this.ready=false;this.devices=[];this.revision++;if(this.listening){this.control.off('state',this.onState);this.listening=false;}}
  async disconnect(){return this.close();}
  dispose(){return this.close();}
}
