import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { BridgeError, publicController } from './openrgb.mjs';
import { assertDeviceAllowed, isProtectedDevice, PROTECTED_DEVICES } from './device-policy.mjs';

const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native/bin/PRISM-Lighting.exe');
const MAX_MESSAGE = 8 * 1024 * 1024;

// Uses only Windows' supported LampArray interface. It never opens arbitrary HID
// devices, starts OpenRGB, installs drivers or terminates another application's process.
export class WindowsLightingClient extends EventEmitter {
  constructor({ executable = helperPath, args = [], timeout = 15000, platform = process.platform } = {}) {
    super();
    this.executable = executable; this.args = args; this.timeout = timeout; this.platform = platform;
    this.backend = 'windows'; this.host = null; this.port = null; this.protocol = null;
    this.process = null; this.ready = false; this.devices = []; this.pending = new Map();
    this.sequence = 0; this.buffer = ''; this.details = null; this.closing = false;
    this.protectedDevices = PROTECTED_DEVICES;
  }
  get connected() { return this.ready && !!this.process && this.process.exitCode === null; }
  ensureHelper() {
    if (this.platform !== 'win32') throw new BridgeError('Die direkte RGB-Steuerung benötigt Windows 10/11 und kompatible LampArray-Geräte.', 'WINDOWS_REQUIRED', 422);
    if (this.process && this.process.exitCode === null && !this.process.killed) return;
    this.closing = false; this.buffer = ''; this.ready = false;
    const child = spawn(this.executable, this.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.process !== child) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > MAX_MESSAGE) return this.fail(new BridgeError('Windows-RGB hat zu viele Gerätedaten geliefert.', 'NATIVE_INVALID_DATA'));
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try { this.receive(JSON.parse(line)); }
        catch { this.fail(new BridgeError('Ungültige Antwort der Windows-RGB-Anbindung.', 'NATIVE_INVALID_DATA')); return; }
      }
    });
    // Drain diagnostics; device IDs and process output are not exposed in the UI.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', error => {
      if (this.process === child) this.fail(new BridgeError(error.code === 'ENOENT' ? 'Die Windows-RGB-Anbindung fehlt. Bitte die aktuelle PRISM-Version erneut installieren.' : 'Die Windows-RGB-Anbindung konnte nicht gestartet werden.', 'NATIVE_START_FAILED'));
    });
    child.on('exit', () => {
      if (this.process === child && !this.closing) this.fail(new BridgeError('Die direkte Windows-RGB-Anbindung wurde beendet.', 'NATIVE_DISCONNECTED'));
    });
  }
  receive(message) {
    if (message.event) {
      if (message.event === 'closed' || message.event === 'windowClosed') { this.emit('windowClosed'); return; }
      if (message.event === 'devicesChanged') { this.devices = []; this.emit('devicesChanged'); }
      if (message.event === 'ownershipLost') this.emit('controlLost', new BridgeError('Windows hat die Beleuchtungssteuerung an eine andere Anwendung übergeben. PRISM erneut in den Vordergrund holen.', 'LIGHTING_NOT_FOREGROUND', 409));
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId); clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message.result);
    else pending.reject(new BridgeError(message.error?.message || 'Die Windows-RGB-Anfrage ist fehlgeschlagen.', message.error?.code || 'WINDOWS_LIGHTING_ERROR', 422));
  }
  request(command, values = {}) {
    try { this.ensureHelper(); } catch (error) { return Promise.reject(error); }
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new BridgeError('Die Windows-RGB-Anbindung antwortet nicht rechtzeitig.', 'NATIVE_TIMEOUT'));
      }, this.timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ requestId, command, ...values }) + '\n', error => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(requestId); reject(new BridgeError('Die Windows-RGB-Anbindung ist nicht erreichbar.', 'NATIVE_DISCONNECTED')); }
      });
    });
  }
  async connect() { return this.scan(); }
  async scan() {
    this.ready = false; this.devices = [];
    const result = await this.request('enumerate');
    const raw = Array.isArray(result) ? result : result?.devices;
    if (!Array.isArray(raw) || raw.length > 128) throw new BridgeError('Windows hat ungültige RGB-Gerätedaten gemeldet.', 'NATIVE_INVALID_DATA');
    const ids = new Set();
    const devices = raw.filter(device => !isProtectedDevice(device)).map(device => {
      if (!Number.isInteger(device.id) || device.id < 0 || ids.has(device.id) || !Number.isInteger(device.ledCount) || device.ledCount < 1 || device.ledCount > 8192) throw new BridgeError('Windows hat eine ungültige LED-Anordnung gemeldet.', 'NATIVE_INVALID_DATA');
      ids.add(device.id);
      const zones = Array.isArray(device.zones) && device.zones.length > 0 && device.zones.length <= 128
        && device.zones.every(zone => Number.isInteger(zone.id) && zone.id >= 0 && Number.isInteger(zone.startIndex) && zone.startIndex >= 0
          && Number.isInteger(zone.ledCount) && zone.ledCount > 0 && zone.startIndex + zone.ledCount <= device.ledCount)
        && new Set(device.zones.map(zone => zone.id)).size === device.zones.length
        ? device.zones.map(zone => ({ ...zone, name: String(zone.name || `LED-Zone ${zone.id + 1}`) }))
        : [{ id: 0, name: 'Alle LEDs', startIndex: 0, ledCount: device.ledCount }];
      return { ...device, name: String(device.name || (device.provider === 'corsair' ? 'Corsair-RGB-Gerät' : 'Windows-RGB-Gerät')), type: device.type ?? 21,
        colors: Array.from({ length: device.ledCount }, (_, i) => device.colors?.[i] >>> 0 || 0),
        leds: Array.from({ length: device.ledCount }, (_, id) => ({ id, name: `LED ${id + 1}`, color: '#000000' })),
        zones,
        modes: [{ id: 0, name: device.provider === 'corsair' ? 'Corsair iCUE direkt' : 'Windows direkt' }], directMode: device.directMode !== false,
        directModeId: 0, backend: device.provider ?? 'windows', layoutValid: true };
    });
    this.details = Array.isArray(result) ? null : {
      ...(result?.environment ?? {}),
      discovery: Array.isArray(result?.discovery) ? result.discovery.filter(item => !isProtectedDevice(item)).slice(0, 256) : [],
      warnings: Array.isArray(result?.warnings) ? result.warnings.map(String).slice(0, 256) : [],
      excludedCount: Number.isInteger(result?.excludedCount) ? result.excludedCount : 0
    };
    this.devices = devices; this.ready = true;
    return devices.map(publicController);
  }
  async selectDirect(device) {
    assertDeviceAllowed(device);
    if (!this.devices.includes(device) || !device.directMode) throw new BridgeError('Dieses Gerät unterstützt keine direkte Windows-RGB-Steuerung.', 'DIRECT_UNSUPPORTED', 422);
    // LampArray requires no hardware mode change. Ownership is checked by the
    // helper immediately before the first actual color write.
  }
  async update(device, colors) {
    assertDeviceAllowed(device);
    if (!this.connected || !this.devices.includes(device)) throw new BridgeError('RGB-Gerät nicht mehr verfügbar. Bitte erneut suchen.', 'DEVICE_LIST_CHANGED', 409);
    if (!Array.isArray(colors) || colors.length !== device.ledCount || colors.some(color => !Number.isInteger(color) || color < 0 || color > 0xffffff)) throw new BridgeError('Ungültige LED-Farben.', 'INVALID_COLORS', 400);
    await this.request('set', { deviceId: device.id, colors });
    device.colors = [...colors];
    device.colorsKnown = true;
  }
  async showWindow(url) {
    const value = new URL(url);
    if (value.protocol !== 'http:' || value.hostname !== '127.0.0.1' || value.port !== '4783' || value.pathname !== '/' || value.search || value.hash || value.username || value.password) throw new BridgeError('Ungültige lokale Programm-Adresse.', 'INVALID_URL', 400);
    return this.request('show', { url });
  }
  async release(deviceIds) {
    if (this.process && this.process.exitCode === null) await this.request('release', { deviceIds });
  }
  async disconnect() {
    await this.release(); this.ready = false; this.devices = [];
  }
  fail(error) {
    this.ready = false; this.devices = [];
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
    const child = this.process; this.process = null;
    if (child && !child.killed) child.kill();
    if (!this.closing) this.emit('disconnected', error);
  }
  async close() {
    this.closing = true;
    this.ready = false; this.devices = [];
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new BridgeError('Windows-RGB-Verbindung geschlossen.', 'NATIVE_DISCONNECTED')); }
    this.pending.clear();
    const child = this.process; this.process = null;
    if (!child || child.exitCode !== null) return;
    // EOF lets the native helper release Windows/iCUE ownership before exiting.
    await new Promise(resolve => {
      const timer = setTimeout(() => { if (child.exitCode === null && !child.killed) child.kill(); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }
}
