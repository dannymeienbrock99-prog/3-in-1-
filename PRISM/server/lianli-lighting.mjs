import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { BridgeError, publicController } from './openrgb.mjs';
import { assertDeviceAllowed, isProtectedDevice } from './device-policy.mjs';

const helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native-lianli/bin/PRISM-LianLi.exe');
const catalog = JSON.parse(readFileSync(new URL('./lianli-effects.json', import.meta.url), 'utf8'));
export const LIANLI_EFFECT_CATALOG = Object.freeze(catalog.modes.map(mode => Object.freeze({ ...mode })));
const familyNames = new Map([[0xa100, 'SL Fan'], [0xa101, 'AL Fan'], [0xa102, 'SL Infinity'], [0xa103, 'SL V2 Fan'], [0xa104, 'AL V2 Fan'], [0xa105, 'SL V2A Fan'], [0xa106, 'SL Redragon'], [0x7372, 'TL']]);
const isDual = pid => [0xa101, 0xa102, 0xa104].includes(pid);
const isV2 = pid => [0xa103, 0xa104, 0xa105].includes(pid);
const isEne = (vid, pid) => vid === 0x0cf2 && pid >= 0xa100 && pid <= 0xa106;
const isTl = (vid, pid) => vid === 0x0416 && pid === 0x7372;
export function lianliSupportedEffects({ productId, ring = 'all' }) {
  if (!familyNames.has(productId)) return [];
  const candidates = productId === 0x7372 ? catalog.tlFanModes : productId === 0xa102 ? catalog.slInfinityModes : isDual(productId)
    ? [...catalog.dualModes, ...(productId === 0xa104 ? catalog.alV2Extra : [])]
    : [...catalog.singleModes, ...(isV2(productId) ? catalog.v2Extra : [])];
  const key = productId === 0x7372 ? 'tl' : productId === 0xa102 ? 'slInf' : isDual(productId) ? ring === 'outer' ? productId === 0xa104 ? 'alV2Outer' : 'alOuter' : 'alInner' : 'single';
  return LIANLI_EFFECT_CATALOG.filter(mode => candidates.includes(mode.id) && Object.hasOwn(catalog.mappings[key], mode.id)
    && (ring === 'outer' || !['StaticColorful', 'BreathingColorful'].includes(mode.id))).map(mode => ({ ...mode, firmwareModeId: catalog.mappings[key][mode.id] }));
}
export function lianliCatalogForDevice(device) {
  const available = new Set((device?.nativeEffects ?? []).map(effect => effect.id));
  return LIANLI_EFFECT_CATALOG.map(mode => ({ ...mode, available: available.has(mode.id), reason: available.has(mode.id) ? null
    : mode.id === 'Direct' ? 'Dieses Protokoll bietet hier keine geprüfte Steuerung einzelner LEDs.'
      : device?.productId === 0x7372 && Object.hasOwn(catalog.mappings.tl, mode.id) ? 'Dieser TL-Gruppeneffekt benötigt eine Gruppen-Konfiguration. Diese wird nicht automatisch verändert.'
        : 'Für diesen Controller und Bereich steht dieser Effekt nicht über die geprüfte Schnittstelle zur Verfügung.' }));
}
export function validateLianLiNativeEffect(device, effectId, options = {}) {
  assertDeviceAllowed(device);
  const effect = device?.nativeEffects?.find(item => item.id === effectId);
  if (!effect || !lianliSupportedEffects(device).some(item => item.id === effectId)) throw new BridgeError('Dieser Lian-Li-Effekt ist für den gewählten Anschluss nicht verfügbar.', 'NATIVE_EFFECT_UNSUPPORTED', 422);
  const settings = { colors: options.colors ?? ['#ffffff'], brightness: options.brightness ?? 100, speed: options.speed ?? 50, direction: options.direction ?? 'forward' };
  if (!Array.isArray(settings.colors) || settings.colors.length < 1 || settings.colors.length > (effect.colorsMax ?? effect.maxColors ?? 4) || settings.colors.some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) throw new BridgeError('Ungültige Lian-Li-Farbpalette.', 'INVALID_COLORS', 400);
  if (!Number.isInteger(settings.brightness) || settings.brightness < 0 || settings.brightness > 100 || !Number.isInteger(settings.speed) || settings.speed < 1 || settings.speed > 100 || !['forward', 'reverse'].includes(settings.direction)) throw new BridgeError('Ungültige Lian-Li-Einstellungen.', 'INVALID_SETTINGS', 400);
  return { effectId, ...settings, colors: [...settings.colors] };
}

// Own helper, built from source. It queries only known Lian Li HID controller
// IDs and sends lighting packets only after an explicit native effect request.
export class LianLiLightingClient extends EventEmitter {
  constructor({ executable = helperPath, args = [], timeout = 15000, platform = process.platform, spawnFn = spawn } = {}) {
    super(); Object.assign(this, { executable, args, timeout, platform, spawnFn });
    this.backend = 'lianli'; this.devices = []; this.process = null; this.ready = false; this.pending = new Map(); this.sequence = 0; this.buffer = ''; this.closing = false;
    this.details = { lianli: { status: 'not-scanned', message: 'Lian-Li-Controller noch nicht geprüft.', effectCatalogCount: LIANLI_EFFECT_CATALOG.length } };
  }
  get connected() { return this.ready && this.process?.exitCode === null && !this.process.killed; }
  ensureHelper() {
    if (this.platform !== 'win32') throw new BridgeError('Die Lian-Li-Anbindung benötigt Windows und einen vorhandenen kompatiblen HID-Treiber.', 'WINDOWS_REQUIRED', 422);
    if (this.process?.exitCode === null && !this.process.killed) return;
    this.closing = false; this.buffer = ''; this.ready = false;
    const child = this.spawnFn(this.executable, this.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); this.process = child;
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
      if (this.process !== child) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) { this.fail(new BridgeError('Lian Li meldet zu viele Daten.', 'NATIVE_INVALID_DATA')); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        try { this.receive(JSON.parse(line)); } catch { this.fail(new BridgeError('Ungültige Antwort der Lian-Li-Anbindung.', 'NATIVE_INVALID_DATA')); return; }
      }
    });
    child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
    child.on('error', () => { if (this.process === child) this.fail(new BridgeError('Die Lian-Li-Anbindung konnte nicht gestartet werden. Bitte das aktuelle Tool installieren.', 'NATIVE_START_FAILED')); });
    child.on('exit', () => { if (this.process === child && !this.closing) this.fail(new BridgeError('Die Lian-Li-Anbindung wurde beendet.', 'NATIVE_DISCONNECTED')); });
  }
  receive(message) {
    const pending = this.pending.get(message?.requestId); if (!pending) return;
    this.pending.delete(message.requestId); clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message.result);
    else pending.reject(new BridgeError(String(message.error?.message || 'Die Lian-Li-Anfrage ist fehlgeschlagen.'), String(message.error?.code || 'LIANLI_ERROR'), 422));
  }
  request(command, values = {}) {
    try { this.ensureHelper(); } catch (error) { return Promise.reject(error); }
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new BridgeError('Die Lian-Li-Anbindung antwortet nicht rechtzeitig.', 'NATIVE_TIMEOUT')), this.timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ requestId, command, ...values }) + '\n', error => { if (error) this.fail(new BridgeError('Die Lian-Li-Anbindung ist nicht erreichbar.', 'NATIVE_DISCONNECTED')); });
    });
  }
  async connect() { return this.scan(); }
  async scan() {
    this.ready = false; this.devices = [];
    const result = await this.request('enumerate');
    if (!Array.isArray(result?.devices) || result.devices.length > 128) throw new BridgeError('Ungültige Lian-Li-Geräteliste.', 'NATIVE_INVALID_DATA');
    const ids = new Set();
    const devices = result.devices.filter(device => !isProtectedDevice(device)).map(device => {
      if (!Number.isInteger(device.id) || device.id < 50000 || device.id >= 50256 || ids.has(device.id)
        || (!isEne(device.vendorId, device.productId) && !isTl(device.vendorId, device.productId)) || !Number.isInteger(device.port) || device.port < 0 || device.port > 3
        || !(isDual(device.productId) ? ['inner', 'outer'] : ['all']).includes(device.ring)) throw new BridgeError('Ungültige Lian-Li-Gerätekennung.', 'NATIVE_INVALID_DATA');
      ids.add(device.id);
      const possible = lianliSupportedEffects(device);
      if (!Array.isArray(device.nativeEffects) || device.nativeEffects.length < 1 || device.nativeEffects.length > 94 || device.nativeEffects.some(effect => !possible.some(item => item.id === effect.id)) || new Set(device.nativeEffects.map(effect => effect.id)).size !== device.nativeEffects.length) throw new BridgeError('Ungültiger Lian-Li-Effektkatalog.', 'NATIVE_INVALID_DATA');
      const fanIds = device.detectedFanIds ?? [];
      if (!Array.isArray(fanIds) || fanIds.length > 16 || fanIds.some(id => !Number.isInteger(id) || id < 0 || id > 15) || new Set(fanIds).size !== fanIds.length
        || isTl(device.vendorId, device.productId) && (fanIds.length < 1 || device.fanCount !== fanIds.length)) throw new BridgeError('Ungültige Lian-Li-Lüfterpositionen.', 'NATIVE_INVALID_DATA');
      const maxColors = device.productId === 0xa104 ? 6 : 4;
      const nativeEffects = device.nativeEffects.map(effect => ({ id: effect.id, name: possible.find(item => item.id === effect.id).name, colorsMax: maxColors, maxColors,
        supportsBrightness: effect.id !== 'Off', supportsSpeed: !['Off', 'Static', 'StaticColorful'].includes(effect.id), directions: ['forward', 'reverse'],
        controls: { colors: !['Off'].includes(effect.id) && !(device.productId === 0xa104 && ['Rainbow','RainbowMorph','MeteorRainbow'].includes(effect.id)),
          brightness: effect.id !== 'Off', speed: !['Off', 'Static', 'StaticColorful'].includes(effect.id), direction: !['Off', 'Static', 'StaticColorful'].includes(effect.id) },
        firmwareModeId: possible.find(item => item.id === effect.id).firmwareModeId }));
      const resultDevice = { ...device, name: String(device.name || `Lian Li UNI FAN ${familyNames.get(device.productId)} · Anschluss ${device.port + 1}`), vendor: 'Lian Li', provider: 'lianli', backend: 'lianli', type: 21,
        directMode: false, directModeId: null, ledCount: 0, physicalLedCount: null, colors: [], leds: [], zones: [], modes: [], ledGranularity: 'area', layoutValid: false,
        nativeEffects, detectedFanIds: [...fanIds], fanCount: isTl(device.vendorId, device.productId) ? fanIds.length : null, telemetryCapturedAt: new Date().toISOString() };
      if (device.rpm != null && (!Number.isInteger(device.rpm) || device.rpm < 0 || device.rpm > 65535)
        || device.fanRpms != null && (!Array.isArray(device.fanRpms) || device.fanRpms.length !== fanIds.length || new Set(device.fanRpms.map(fan => fan.index)).size !== fanIds.length
          || device.fanRpms.some(fan => !fanIds.includes(fan.index) || !Number.isInteger(fan.rpm) || fan.rpm < 0 || fan.rpm > 65535))) throw new BridgeError('Ungültige Lian-Li-Drehzahlquelle.', 'NATIVE_INVALID_DATA');
      resultDevice.rpm = device.rpm ?? null; resultDevice.fanRpms = device.fanRpms ?? null;
      resultDevice.nativeEffectCatalog = lianliCatalogForDevice(resultDevice); return resultDevice;
    });
    this.details = { ...(result.environment ?? {}), discovery: Array.isArray(result.discovery) ? result.discovery.filter(item => !isProtectedDevice(item)).slice(0, 32) : [], warnings: Array.isArray(result.warnings) ? result.warnings.map(String).slice(0, 64) : [] };
    this.details.lianli = { ...(this.details.lianli ?? {}), effectCatalogCount: LIANLI_EFFECT_CATALOG.length, telemetryCapturedAt: new Date().toISOString() };
    this.devices = devices; this.ready = true; return devices.map(publicController);
  }
  async applyNativeEffect(device, effectId, options = {}) {
    if (!this.connected || !this.devices.includes(device)) throw new BridgeError('Lian-Li-Gerät nicht mehr verfügbar. Bitte erneut suchen.', 'DEVICE_LIST_CHANGED', 409);
    const settings = validateLianLiNativeEffect(device, effectId, options);
    const result = await this.request('effect', { deviceId: device.id, ...settings });
    if (result?.deviceId !== device.id || result.effectId !== effectId || result.transmitted !== true) throw new BridgeError('Die Lian-Li-Übertragung wurde nicht bestätigt.', 'NATIVE_INVALID_DATA');
    device.activeNativeEffect = effectId; device.nativeSettings = { ...settings };
    return { deviceId: device.id, effectId, transmitted: true, acknowledgement: 'Windows-HID-Übertragung' };
  }
  async readTelemetry() {
    if (!this.connected) return [];
    const result = await this.request('telemetry');
    if (!Array.isArray(result?.devices) || result.devices.length > 128) throw new BridgeError('Ungültige Lian-Li-Drehzahlen.', 'NATIVE_INVALID_DATA');
    if (result.layoutChanged === true) { this.devices = []; this.emit('devicesChanged'); return []; }
    const capturedAt = new Date().toISOString();
    if (new Set(result.devices.map(value => value.deviceId)).size !== result.devices.length) throw new BridgeError('Doppelte Lian-Li-Drehzahlquelle.', 'NATIVE_INVALID_DATA');
    return result.devices.map(value => {
      const device = this.devices.find(item => item.id === value.deviceId);
      if (!device) throw new BridgeError('Unbekannte Lian-Li-Drehzahlquelle.', 'NATIVE_INVALID_DATA');
      const rpm = Number.isInteger(value.rpm) && value.rpm >= 0 && value.rpm <= 65535 ? value.rpm : null;
      const fanRpms = Array.isArray(value.fanRpms) ? value.fanRpms.map(fan => {
        if (!device.detectedFanIds.includes(fan.index) || !Number.isInteger(fan.rpm) || fan.rpm < 0 || fan.rpm > 65535) throw new BridgeError('Ungültige Lian-Li-Lüfterdrehzahl.', 'NATIVE_INVALID_DATA');
        return { index: fan.index, rpm: fan.rpm };
      }) : null;
      Object.assign(device, { rpm, fanRpms, telemetryCapturedAt: capturedAt });
      return { deviceId: device.id, name: device.name, rpm, fanRpms, capturedAt };
    });
  }
  async selectDirect() { throw new BridgeError('Dieser Lian-Li-Anschluss unterstützt hier Hersteller-Effekte. Einzelne LEDs sind nicht über eine geprüfte Schnittstelle verfügbar.', 'DIRECT_UNSUPPORTED', 422); }
  async update() { throw new BridgeError('Für diesen Lian-Li-Anschluss einen Hersteller-Effekt auswählen.', 'DIRECT_UNSUPPORTED', 422); }
  async release() {}
  async disconnect() { return this.close(); }
  fail(error) {
    this.ready = false; this.devices = [];
    this.details.lianli = { status: 'unavailable', message: error.message, effectCatalogCount: LIANLI_EFFECT_CATALOG.length };
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear();
    const child = this.process; this.process = null; if (child && !child.killed) child.kill();
    if (!this.closing) this.emit('disconnected', error);
  }
  async close() {
    this.closing = true; this.ready = false; this.devices = [];
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new BridgeError('Lian-Li-Verbindung geschlossen.', 'NATIVE_DISCONNECTED')); } this.pending.clear();
    const child = this.process; this.process = null;
    if (!child || child.exitCode !== null) return;
    await new Promise(resolve => { const timer = setTimeout(() => { if (!child.killed) child.kill(); resolve(); }, 1500); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.stdin.end(); });
  }
}
