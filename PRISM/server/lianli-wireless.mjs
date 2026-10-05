import { LianLiLightingClient } from './lianli-lighting.mjs';
import { BridgeError, publicController } from './openrgb.mjs';
import { assertDeviceAllowed, isProtectedDevice } from './device-policy.mjs';
import { renderFrame, isAnimatedEffect } from './effect-renderer.mjs';
import { validateSettings } from './effects.mjs';
import { wirelessCableLayout } from './strimer-capabilities.mjs';

const layouts = new Map([[1,116],[2,132],[3,174],[4,88]]);
const tx = (vid,pid) => vid === 0x0416 && pid === 0x8040 || vid === 0x1a86 && pid === 0xe304;
const rx = (vid,pid) => vid === 0x0416 && pid === 0x8041 || vid === 0x1a86 && pid === 0xe305;
const mac = value => typeof value === 'string' && /^[a-f0-9]{12}$/i.test(value) && !/^(?:0{12}|f{12})$/i.test(value);
const invalid = () => new BridgeError('Ungültige Daten des Strimer-Wireless-Controllers. Bitte erneut suchen.','WIRELESS_INVALID_DATA',502);
const toRaw = frames => Buffer.from(frames.flatMap(frame => frame.flatMap(c => [c & 255,(c >>> 8) & 255,(c >>> 16) & 255]))).toString('base64');

export function wirelessAnimation(device, settings, zoneIds, maximumFrames = 64) {
  const animated = isAnimatedEffect(settings);
  const durationMs = settings.effect === 'custom' ? Math.round(settings.custom.cycleSeconds * 1000) : Math.round(2500 + (100-settings.speed)*55);
  const count = animated ? Math.min(Math.max(2,maximumFrames), Math.max(2,Math.floor(durationMs / 20))) : 1;
  const intervalMs = animated ? Math.max(20,Math.round(durationMs/count)) : 100;
  const frames = Array.from({length:count},(_,index) => {
    const elapsed = index*intervalMs/1000, colors = [...device.colors];
    if (zoneIds) for (const id of zoneIds) {
      const zone = device.zones.find(value=>value.id===id);
      if (!zone) throw new BridgeError('Ungültige Strimer-Zone.','INVALID_ZONES',400);
      renderFrame(zone.ledCount,settings,elapsed).forEach((color,i)=>{colors[zone.startIndex+i]=color;});
    } else renderFrame(device.ledCount,settings,elapsed).forEach((color,i)=>{colors[i]=color;});
    return colors;
  });
  return { frames,intervalMs,rgb:toRaw(frames),frameCount:count };
}

// Own WinUSB process; the wired HID provider remains independent. Firmware
// loops play locally rather than repeatedly uploading RGB packets every frame.
export class LianLiWirelessClient extends LianLiLightingClient {
  constructor(options = {}) {
    super({...options,args:['--wireless',...(options.args || [])],timeout:options.timeout ?? 30000});
    this.backend='lianli-wireless'; this.animations=new Map();
    this.details={lianliWireless:{status:'not-scanned',message:'Strimer Wireless noch nicht geprüft.'}};
  }
  ensureHelper() {
    if (this.platform!=='win32') throw new BridgeError('Strimer Wireless benötigt Windows und den vorhandenen WinUSB-Treiber.','WINDOWS_REQUIRED',422);
    return super.ensureHelper();
  }
  async scan() {
    this.ready=false; this.devices=[]; this.animations.clear();
    const result=await this.request('enumerate');
    if (!Array.isArray(result?.devices) || result.devices.length>32) throw invalid();
    const ids=new Set(), addresses=new Set();
    this.devices=result.devices.map(value=>{
      if (!value || typeof value!=='object' || Array.isArray(value)) throw invalid();
      assertDeviceAllowed(value);
      if (!Number.isInteger(value.id)||value.id<60000||value.id>=60256||ids.has(value.id)
        ||!tx(value.vendorId,value.productId)||!rx(value.receiverVendorId,value.receiverProductId)
        ||!layouts.has(value.receiverType)||value.ledCount!==layouts.get(value.receiverType)
        ||!mac(value.mac)||!mac(value.masterMac)||addresses.has(value.mac.toLowerCase())
        ||!Number.isInteger(value.channel)||value.channel<1||value.channel>39
        ||!Number.isInteger(value.rxType)||value.rxType<1||value.rxType>254
        ||value.motherboardSync!==false||value.directMode!==true||value.effectUpload!==true) throw invalid();
      ids.add(value.id); addresses.add(value.mac.toLowerCase());
      const name=String(value.name||'Lian Li Strimer Wireless').slice(0,180)+' · '+value.mac.slice(-6).toUpperCase();
      return {...value,name,vendor:'Lian Li',provider:'lianli-wireless',backend:'lianli-wireless',category:'strip',type:4,
        ...wirelessCableLayout(value.receiverType,value.ledCount),separateChannelOutput:false,physicalOutputVerified:false,
        wholeControllerOnly:false,controllerScope:undefined,confirmWholeController:undefined,
        effectUpload:true,directMode:true,directModeId:0,layoutValid:true,physicalLedCount:value.ledCount,ledGranularity:'led',
        colors:Array(value.ledCount).fill(0),leds:Array.from({length:value.ledCount},(_,id)=>({id,name:`LED ${id+1}`,color:'#000000'})),
        modes:[{id:0,name:'Eigene RGB-Schleife'}],nativeEffects:[],zones:[{id:0,name:'Ganzes Strimer-Kabel',startIndex:0,ledCount:value.ledCount,hardwareLedCount:value.ledCount,type:0}]};
    });
    this.details={...(result.environment||{}),discovery:Array.isArray(result.discovery)?result.discovery.filter(d=>!isProtectedDevice(d)).slice(0,64):[],warnings:Array.isArray(result.warnings)?result.warnings.map(String).slice(0,64):[]};
    this.ready=true; return this.devices.map(publicController);
  }
  target(device) {
    if (!this.connected||!this.devices.includes(device)||!device.effectUpload) throw new BridgeError('Strimer Wireless ist nicht mehr verbunden. Bitte erneut suchen.','DEVICE_LIST_CHANGED',409);
    assertDeviceAllowed(device);
  }
  async selectDirect(device) { this.target(device); }
  async upload(device, animation) {
    this.target(device);
    const result=await this.request('animation',{deviceId:device.id,frameCount:animation.frameCount,intervalMs:animation.intervalMs,rgb:animation.rgb});
    if (result?.deviceId!==device.id||result.transmitted!==true||typeof result.confirmed!=='boolean'
      ||!/^[a-f0-9]{8}$/i.test(result.effectIndex||'')||result.frameCount!==animation.frameCount||result.intervalMs!==animation.intervalMs) throw invalid();
    device.colors=[...animation.frames[0]];
    device.leds.forEach((led,i)=>{const c=device.colors[i];led.color='#'+[c&255,(c>>>8)&255,(c>>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('');});
    this.animations.set(device.id,{...animation,started:Date.now()});
    const acknowledgement=result.confirmed?'Funkempfänger bestätigt den Effekt':'Übertragen; Funkbestätigung steht aus';
    device.uploadConfirmation=result.confirmed?'receiver':'transmitted';device.uploadAcknowledgement=acknowledgement;
    return {deviceId:device.id,transmitted:true,confirmed:result.confirmed,confirmation:device.uploadConfirmation,acknowledgement,effectIndex:result.effectIndex,frameCount:result.frameCount,intervalMs:result.intervalMs};
  }
  async applySoftwareEffect(device, input, zones) {
    this.target(device);
    const settings=validateSettings(input);
    if (zones!=null && (!Array.isArray(zones)||zones.length!==1||zones[0]!==0)) throw new BridgeError('Dieses Kabel hat einen vollständig erkannten RGB-Bereich.','INVALID_ZONES',400);
    for (const maximum of [64,32,16,8,4,2]) {
      const animation=wirelessAnimation(device,settings,zones,maximum);
      try { return await this.upload(device,animation); }
      catch (error) { if (error.code!=='WIRELESS_ANIMATION_TOO_LARGE'||animation.frameCount<=2) throw error; }
    }
  }
  async update(device, colors) {
    this.target(device);
    if (!Array.isArray(colors)||colors.length!==device.ledCount||colors.some(c=>!Number.isInteger(c)||c<0||c>0xffffff)) throw new BridgeError('Ungültige Strimer-LED-Farben.','INVALID_COLORS',400);
    return this.upload(device,{frames:[[...colors]],frameCount:1,intervalMs:100,rgb:toRaw([colors])});
  }
  async freezeSoftwareEffect(device) {
    this.target(device);
    const current=this.animations.get(device.id);
    const frame=current?current.frames[Math.floor((Date.now()-current.started)/current.intervalMs)%current.frameCount]:device.colors;
    return this.update(device,frame);
  }
  async readTelemetry() { return []; }
  fail(error) {
    this.ready=false;this.devices=[];
    this.details.lianliWireless={status:'unavailable',message:error.message};this.animations.clear();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer);pending.reject(error); } this.pending.clear();
    const child=this.process;this.process=null;if(child&&!child.killed)child.kill();
    if(!this.closing)this.emit('disconnected',error);
  }
  async close() { this.animations.clear(); return super.close(); }
}
