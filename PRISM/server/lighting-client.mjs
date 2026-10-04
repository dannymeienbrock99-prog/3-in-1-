import { EventEmitter } from 'node:events';
import { WindowsLightingClient } from './windows-lighting.mjs';
import { KingstonServiceClient } from './kingston-service.mjs';
import { LianLiLightingClient } from './lianli-lighting.mjs';
import { BridgeError, publicController } from './openrgb.mjs';
import { assertDeviceAllowed } from './device-policy.mjs';

/** Independent sessions keep a missing manufacturer's service from hiding other devices. */
export class LightingClient extends EventEmitter {
  constructor({ clients } = {}) {
    super();
    this.clients = clients || [new WindowsLightingClient(), new KingstonServiceClient(), new LianLiLightingClient()];
    this.backend = 'windows'; this.host = null; this.port = null; this.protocol = null;
    this.devices = []; this.details = {}; this.routes = new Map(); this.errors = new Map(); this.invalid = false;
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
  owner(device) {
    const client = this.routes.get(device.id);
    if (this.invalid || !client?.connected || !client.devices?.some(current => current === device)) throw new BridgeError('Dieses RGB-Gerät ist nicht mehr verbunden. Bitte erneut suchen.', 'DEVICE_NOT_FOUND', 404);
    assertDeviceAllowed(device);
    return client;
  }
  selectDirect(device) { return this.owner(device).selectDirect(device); }
  update(device, colors) { return this.owner(device).update(device, colors); }
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
  close() { const closing = Promise.allSettled(this.clients.map(client => client.close())); this.devices = []; this.routes.clear(); return closing; }
  async disconnect() {
    await Promise.allSettled(this.clients.map(client => client.disconnect ? client.disconnect() : client.close()));
    this.devices = []; this.routes.clear();
  }
}
