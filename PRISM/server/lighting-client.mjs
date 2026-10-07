import { EventEmitter } from 'node:events';
import { WindowsLightingClient } from './windows-lighting.mjs';
import { KingstonServiceClient } from './kingston-service.mjs';
import { LianLiLightingClient } from './lianli-lighting.mjs';
import { LianLiWirelessClient } from './lianli-wireless.mjs';
import { BridgeError, publicController } from './openrgb.mjs';
import { assertDeviceAllowed } from './device-policy.mjs';
import { StrimerControl } from './strimer-control.mjs';
import { integratedClients, InProcessStrimerControl } from './in-process-lighting.mjs';

/** Independent sessions keep a missing manufacturer's service from hiding other devices. */
export class LightingClient extends EventEmitter {
  constructor({ clients, strimerControl, hardware, corsairDirectControl } = {}) {
    super();
    this.clients = clients || (hardware ? integratedClients(hardware,corsairDirectControl) : [new WindowsLightingClient(), new KingstonServiceClient(), new LianLiLightingClient(), new LianLiWirelessClient()]);
    this.backend = 'windows'; this.host = null; this.port = null; this.protocol = null;
    this.devices = []; this.details = {}; this.routes = new Map(); this.errors = new Map(); this.invalid = false;
    this.hardware = hardware; this.controlQueue = Promise.resolve(); this.quitting = false; this.hardwareQuitPromise = null;
    this.windowsSuspended=false;
    this.strimerControl = strimerControl ?? (hardware ? new InProcessStrimerControl(hardware) : new StrimerControl());
    this.strimerControl.on('lost', error => {
      const provider=this.wirelessProvider();
      if(!provider)return;
      const ids=this.devices.filter(device=>this.routes.get(device.id)===provider).map(device=>device.id);
      // Closing this provider releases WinUSB before the guard restores L-Connect.
      void provider.close();this.errors.set(provider,error.message);this.refresh();
      this.emit('providerDisconnected',{deviceIds:ids,message:error.message});
    });
    for (const client of this.clients) {
      const invalidate = error => {
        const ids = this.devices.filter(device => this.routes.get(device.id) === client).map(device => device.id);
        this.errors.set(client, error?.message || 'Geräteliste geändert. Bitte erneut suchen.');
        try { this.refresh(); } catch (failure) { this.emit('disconnected', failure); return; }
        this.emit('providerDisconnected', { deviceIds: ids, message: this.errors.get(client) });
        if (!this.connected) this.emit('disconnected', error || new BridgeError(this.errors.get(client), 'RGB_DISCONNECTED'));
      };
      client.on('disconnected', invalidate);
      client.on('devicesChanged', () => invalidate());
      client.on('controlLost', error => {
        const ids = this.devices.filter(device => this.routes.get(device.id) === client).map(device => device.id);
        this.emit('providerDisconnected', { deviceIds: ids, message: error.message });
      });
    }
  }
  get connected() { return !this.invalid && this.clients.some(client => client.connected); }
  get process() { return this.clients.find(client => client instanceof WindowsLightingClient)?.process ?? null; }
  setUiPort(port) { for (const client of this.clients) if (typeof client.setUiPort === 'function') client.setUiPort(port); }
  refresh() {
    try {
    const devices = [], routes = new Map(), details = { warnings: [], discovery: [] };
    for (const client of this.clients) {
      const value = client.details || {};
      for (const [key, status] of Object.entries(value)) {
        if (!['warnings', 'discovery'].includes(key)) details[key] = status;
      }
      details.warnings.push(...(Array.isArray(value.warnings) ? value.warnings : []));
      details.discovery.push(...(Array.isArray(value.discovery) ? value.discovery : []));
      if (this.errors.has(client)) details.warnings.push(this.errors.get(client));
      if (!client.connected) continue;
      for (const device of client.devices || []) {
        assertDeviceAllowed(device);
        if (!Number.isInteger(device.id) || device.id < 0 || routes.has(device.id)) throw new BridgeError('Die Hersteller-Anbindungen melden widersprüchliche Geräte-IDs.', 'RGB_ID_COLLISION', 502);
        routes.set(device.id, client); devices.push(device);
      }
    }
    details.warnings = [...new Set(details.warnings)];
    this.devices = devices; this.routes = routes; this.details = details; this.invalid = false;
    } catch (error) { this.devices = []; this.routes.clear(); this.invalid = true; throw error; }
  }
  async connect() { return this.scan(); }
  windowsProviders(){return this.clients.filter(client=>client instanceof WindowsLightingClient||client.nativeProvider==='windows');}
  beginWindowsLightingSuspend(){
    this.windowsSuspended=true;
    const providers=this.windowsProviders(),ids=this.devices.filter(device=>providers.includes(this.routes.get(device.id))).map(device=>device.id);
    for(const provider of providers)provider.beginCorsairSuspend?.();
    if(ids.length)this.emit('providerDisconnected',{deviceIds:ids,message:'Die iCUE-Anbindung wird vor dem direkten Corsair-Zugriff freigegeben.'});
    this.refresh();
  }
  async suspendWindowsLighting(){
    this.beginWindowsLightingSuspend();
    for(const provider of this.windowsProviders()){
      try{if(!provider.suspendCorsair)throw new BridgeError('Diese Windows-Anbindung unterstützt keine sichere iCUE-Übergabe.','CORSAIR_SDK_UNSUPPORTED',422);await provider.suspendCorsair();this.errors.delete(provider);}
      catch(error){this.errors.set(provider,error.message);this.refresh();throw error;}
    }
    this.windowsSuspended=false;this.refresh();return this.devices.map(publicController);
  }
  async resumeWindowsLighting(){
    this.beginWindowsLightingSuspend();
    for(const provider of this.windowsProviders()){
      try{if(!provider.resumeCorsair)throw new BridgeError('Diese Windows-Anbindung unterstützt keine sichere iCUE-Rückgabe.','CORSAIR_SDK_UNSUPPORTED',422);await provider.resumeCorsair();this.errors.delete(provider);}
      catch(error){this.errors.set(provider,error.message);this.refresh();throw error;}
    }
    this.windowsSuspended=false;this.refresh();return this.devices.map(publicController);
  }
  wirelessProvider() { const values=this.clients.filter(client=>client instanceof LianLiWirelessClient||client.backend==='lianli-wireless');return values.length===1?values[0]:null; }
  setStrimerControl(enabled, confirmed=false) {
    if (typeof enabled !== 'boolean') return Promise.reject(new BridgeError('Bitte die Strimer-Steuerung ein- oder ausschalten.','INVALID_STRIMER_CONTROL',400));
    if (enabled && this.quitting) return Promise.reject(new BridgeError('Batto gibt die Geräte gerade zum Beenden zurück. Eine neue Übernahme ist gesperrt.','RGB_QUITTING',409));
    const operation = this.controlQueue.then(() => this.setStrimerControlInternal(enabled,confirmed));
    this.controlQueue = operation.catch(() => {});
    return operation;
  }
  async setStrimerControlInternal(enabled, confirmed=false) {
    const provider=this.wirelessProvider();
    if(!provider)throw new BridgeError('Die Strimer-Wireless-Anbindung ist nicht eindeutig verfügbar.','WIRELESS_PROVIDER_UNAVAILABLE',422);
    if(enabled && confirmed!==true && this.strimerControl.status.requiresServicePause!==false)throw new BridgeError('Bestätige zuerst die vorübergehende Pause der L-Connect-Dienste.','WIRELESS_CONSENT_REQUIRED',400);
    if(enabled && this.strimerControl.status.enabled && this.strimerControl.status.phase==='active')return this.devices.map(publicController);
    const ids=this.devices.filter(device=>this.routes.get(device.id)===provider).map(device=>device.id);
    if(ids.length)this.emit('providerDisconnected',{deviceIds:ids,message:'Die Strimer-Steuerung wird übergeben.'});
    await provider.close();this.refresh();
    if(enabled) {
      try {
        await this.strimerControl.start(confirmed);if(!this.strimerControl.inProcess)provider.setLeaseOwner?.({pid:process.pid,startTicks:this.strimerControl.ownerStartUtcTicks});const devices=await this.refreshStrimer();
        if(!provider.connected || !provider.devices.length)throw new BridgeError(this.strimerControl.inProcess?'Batto kann den Wireless-Controller noch nicht öffnen. Der gemeldete Zugriffsfehler muss zuerst behoben werden.':'Batto konnte trotz Übergabe keine Strimer-Kabel öffnen. L-Connect wird wieder gestartet.','WIRELESS_HANDOFF_NO_CABLES',422);
        return devices;
      } catch(error) {
        try { await provider.close(); } finally { provider.setLeaseOwner?.(null);try { await this.strimerControl.stop(); } finally { this.refresh(); } }throw error;
      }
    }
    provider.setLeaseOwner?.(null);try { await this.strimerControl.stop(); } finally { this.refresh(); }return this.devices.map(publicController);
  }
  prepareHardwareQuit() {
    if (this.hardwareQuitPromise) return this.hardwareQuitPromise;
    // Freeze new takeovers synchronously, before waiting for an accepted start
    // whose native service pause may already precede its JavaScript reply.
    this.quitting = true;
    const operation = this.controlQueue.then(async () => {
      let lease = await this.nativeControlLease();
      const status = this.strimerControl.status;
      if (this.leaseNeedsRelease(lease) || status.enabled || ['starting','restoring','active','error'].includes(status.phase)) {
        if (lease) this.strimerControl.updateLease?.(lease);
        if (this.wirelessProvider()) await this.setStrimerControlInternal(false);
        else await this.strimerControl.stop(); // No device list is needed to return an owned service lease.
        lease = await this.nativeControlLease();
      }
      if (this.leaseNeedsRelease(lease) || this.strimerControl.status.enabled
        || ['starting','restoring','active'].includes(this.strimerControl.status.phase))
        throw new BridgeError('Die Rückgabe der Strimer-Steuerung wurde nicht vollständig bestätigt. Bitte erneut ausschalten.','WIRELESS_RESTORE_FAILED',422);
    });
    this.controlQueue = operation.catch(() => {});
    this.hardwareQuitPromise = operation.catch(error => {
      this.quitting = false; // Preserve the same client and lease for an OFF retry.
      throw error;
    }).finally(() => { this.hardwareQuitPromise = null; });
    return this.hardwareQuitPromise;
  }
  async nativeControlLease() {
    // A missing, never-loaded engine cannot own a native lease. Once loaded,
    // failure to inspect that engine must prevent shutdown rather than guess.
    if (!this.hardware || (!this.hardware.component && this.hardware.available === false)) return null;
    let lease;
    try { lease = await this.hardware.request('wireless','control-status'); }
    catch (error) {
      if (!error.state || typeof error.state.active !== 'boolean' || typeof error.state.released !== 'boolean') throw error;
      lease = error.state;
    }
    if (!lease || typeof lease.active !== 'boolean' || typeof lease.released !== 'boolean'
      || typeof lease.retryRequired !== 'boolean' || !Array.isArray(lease.remaining)
      || lease.remaining.some(value => typeof value !== 'string'))
      throw new BridgeError('Der tatsächliche Strimer-Freigabestatus konnte nicht bestätigt werden.','WIRELESS_INVALID_DATA',502);
    return lease;
  }
  leaseNeedsRelease(lease) {
    return !!lease && (lease.active || lease.released !== true || lease.retryRequired || lease.remaining.length > 0);
  }
  async scan() {
    const results = await Promise.allSettled(this.clients.map(client => client.connected ? client.scan() : client.connect()));
    results.forEach((result, index) => {
      const client = this.clients[index];
      if (result.status === 'fulfilled') this.errors.delete(client);
      else { this.errors.set(client, result.reason?.message || 'Die Hersteller-Anbindung ist nicht erreichbar.'); client.devices = []; }
    });
    this.refresh();
    return this.devices.map(publicController);
  }
  async refreshStrimer() {
    const providers = this.clients.filter(client => client instanceof LianLiWirelessClient || client.backend === 'lianli-wireless');
    if (providers.length !== 1) throw new BridgeError('Die Strimer-Wireless-Anbindung ist nicht eindeutig verfügbar.', 'WIRELESS_PROVIDER_UNAVAILABLE', 422);
    const provider = providers[0];
    const previousIds = this.devices.filter(device => this.routes.get(device.id) === provider).map(device => device.id);
    // Invalidate only this provider's cached jobs. Receiver loops keep playing;
    // enumeration sends no blackout, PWM, pairing or lighting upload command.
    if (previousIds.length) this.emit('providerDisconnected', {deviceIds:previousIds, message:'Strimer Wireless wird neu geprüft. Bereits übertragene Kabelschleifen können weiterlaufen.'});
    try {
      if (provider.connected) await provider.scan(); else await provider.connect();
      this.errors.delete(provider);
    } catch (error) {
      this.errors.set(provider, error?.message || 'Strimer Wireless ist nicht erreichbar.');
      provider.devices = [];
    }
    this.refresh();
    return this.devices.map(publicController);
  }
  async refreshCorsairDirect(){
    const providers=this.clients.filter(client=>client.backend==='corsair-direct');
    if(providers.length!==1)throw new BridgeError('Die gemeinsame Corsair-Anbindung ist nicht eindeutig verfügbar.','CORSAIR_CONTROL_MISSING',422);
    const provider=providers[0],ids=this.devices.filter(device=>this.routes.get(device.id)===provider).map(device=>device.id);
    if(ids.length)this.emit('providerDisconnected',{deviceIds:ids,message:'Die direkte Corsair-Geräteliste wird aktualisiert.'});
    try{await provider.scan();this.errors.delete(provider);}
    catch(error){this.errors.set(provider,error.message);provider.devices=[];this.refresh();throw error;}
    this.refresh();return this.devices.map(publicController);
  }
  owner(device) {
    const client = this.routes.get(device.id);
    if(this.windowsSuspended&&this.windowsProviders().includes(client))throw new BridgeError('Die iCUE-Geräte werden gerade sicher übergeben.','CORSAIR_SDK_SUSPENDED',409);
    if (this.invalid || !client?.connected || !client.devices?.some(current => current === device)) throw new BridgeError('Dieses RGB-Gerät ist nicht mehr verbunden. Bitte erneut suchen.', 'DEVICE_NOT_FOUND', 404);
    assertDeviceAllowed(device);
    return client;
  }
  selectDirect(device) { return this.owner(device).selectDirect(device); }
  update(device, colors) { return this.owner(device).update(device, colors); }
  applySoftwareEffect(device, settings, zones) { return this.owner(device).applySoftwareEffect(device, settings, zones); }
  freezeSoftwareEffect(device) { return this.owner(device).freezeSoftwareEffect(device); }
  applyNativeEffect(device, effectId, options) {
    const client = this.owner(device);
    if (!client.applyNativeEffect) throw new BridgeError('Diese Anbindung bietet keine Herstellereffekte an.', 'NATIVE_EFFECT_UNSUPPORTED', 422);
    return client.applyNativeEffect(device, effectId, options);
  }
  async readTelemetry() {
    const results = await Promise.allSettled(this.clients.filter(client => client.connected && client.readTelemetry).map(client => client.readTelemetry()));
    return results.filter(result => result.status === 'fulfilled').flatMap(result => result.value);
  }
  showWindow(url) {
    const client = this.clients.find(value => value instanceof WindowsLightingClient);
    if (!client) throw new BridgeError('Das Windows-Steuerfenster ist nicht verfügbar.', 'WINDOW_UNAVAILABLE', 422);
    return client.showWindow(url);
  }
  async close() { await Promise.allSettled(this.clients.map(client => client.close())); await this.strimerControl.stop(); this.devices = []; this.routes.clear(); }
  async disconnect() {
    await Promise.allSettled(this.clients.map(client => client.disconnect ? client.disconnect() : client.close()));
    await this.strimerControl.stop();
    this.devices = []; this.routes.clear();
  }
}
