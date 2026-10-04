import net from 'node:net';
import { EventEmitter } from 'node:events';

export const MAX_PROTOCOL = 5;
const MAX_PACKET = 8 * 1024 * 1024;
const MAX_DEVICES = 128;
const MAX_LEDS = 8192;
export const PACKET = { COUNT: 0, DATA: 1, VERSION: 40, NAME: 50, LIST_UPDATED: 100, UPDATE: 1050, MODE: 1101 };
// The numeric ordering follows OpenRGB's public device_type enum.
export const DEVICE_TYPES = [
  'Mainboard', 'Arbeitsspeicher', 'Grafikkarte', 'Kühlung', 'LED-Streifen',
  'Tastatur', 'Maus', 'Mauspad', 'Headset', 'Headset-Ständer', 'Gamepad',
  'Leuchte', 'Lautsprecher', 'Virtuelles Gerät', 'Speicherlaufwerk', 'Gehäuse',
  'Mikrofon', 'Zubehör', 'Tastenfeld', 'Laptop', 'Monitor', 'RGB-Gerät',
];

export class BridgeError extends Error {
  constructor(message, code = 'OPENRGB_ERROR', status = 503) { super(message); this.code = code; this.status = status; }
}

export function packet(deviceId, command, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(16);
  header.write('ORGB', 0, 'ascii');
  header.writeUInt32LE(deviceId, 4);
  header.writeUInt32LE(command, 8);
  header.writeUInt32LE(data.length, 12);
  return Buffer.concat([header, data]);
}

function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }

class Reader {
  constructor(buffer) { this.buffer = buffer; this.offset = 0; }
  take(n) {
    if (!Number.isSafeInteger(n) || n < 0 || this.offset + n > this.buffer.length) throw new BridgeError('OpenRGB hat unvollständige Gerätedaten geliefert.', 'INVALID_PACKET');
    const result = this.buffer.subarray(this.offset, this.offset + n); this.offset += n; return result;
  }
  u16() { return this.take(2).readUInt16LE(); }
  u32() { return this.take(4).readUInt32LE(); }
  i32() { return this.take(4).readInt32LE(); }
  string() { return this.take(this.u16()).toString('utf8').replace(/\0+$/, ''); }
  count(max, label) { const count = this.u16(); if (count > max) throw new BridgeError(`Zu viele ${label} in den OpenRGB-Gerätedaten.`, 'INVALID_PACKET'); return count; }
}

export function colorHex(value) {
  return '#' + [value & 255, (value >>> 8) & 255, (value >>> 16) & 255].map(c => c.toString(16).padStart(2, '0')).join('');
}

function readMode(reader, protocol, id) {
  const start = reader.offset;
  const name = reader.string();
  const value = reader.i32(), flags = reader.u32(), speedMin = reader.u32(), speedMax = reader.u32();
  const brightnessMin = protocol >= 3 ? reader.u32() : 0;
  const brightnessMax = protocol >= 3 ? reader.u32() : 100;
  const colorsMin = reader.u32(), colorsMax = reader.u32(), speed = reader.u32();
  const brightness = protocol >= 3 ? reader.u32() : 100;
  const direction = reader.u32(), colorMode = reader.u32();
  const colorCount = reader.count(MAX_LEDS, 'Modusfarben');
  reader.take(colorCount * 4);
  return { id, name, value, flags, speedMin, speedMax, brightnessMin, brightnessMax, colorsMin, colorsMax, speed, brightness, direction, colorMode, raw: reader.buffer.subarray(start, reader.offset) };
}

export function parseController(buffer, protocol, id) {
  const reader = new Reader(buffer);
  const declaredSize = reader.u32();
  if (declaredSize !== buffer.length) throw new BridgeError('Ungültige OpenRGB-Gerätedatenlänge.', 'INVALID_PACKET');
  const type = reader.i32(), name = reader.string(), vendor = protocol >= 1 ? reader.string() : '';
  const description = reader.string(), version = reader.string(), serial = reader.string(), location = reader.string();
  const modeCount = reader.count(1024, 'Modi'), activeMode = reader.i32();
  const modes = Array.from({ length: modeCount }, (_, i) => readMode(reader, protocol, i));
  const zoneCount = reader.count(1024, 'Zonen');
  let startIndex = 0;
  const zones = Array.from({ length: zoneCount }, (_, zoneId) => {
    const zoneName = reader.string(), zoneType = reader.i32(), ledsMin = reader.u32(), ledsMax = reader.u32(), hardwareLedCount = reader.u32();
    if (hardwareLedCount > 65535) throw new BridgeError('Ungültige LED-Anzahl.', 'INVALID_PACKET');
    reader.take(reader.u16()); // Matrix maps are represented by a bounded length-prefixed block.
    const segments = [];
    if (protocol >= 4) {
      const segmentCount = reader.count(2048, 'Segmente');
      for (let i = 0; i < segmentCount; i++) segments.push({ name: reader.string(), type: reader.i32(), startIndex: reader.u32(), ledCount: reader.u32() });
    }
    const flags = protocol >= 5 ? reader.u32() : 0;
    const ledCount = (flags & 1) ? Math.min(1, hardwareLedCount) : hardwareLedCount;
    const zone = { id: zoneId, name: zoneName, type: zoneType, ledsMin, ledsMax, ledCount, hardwareLedCount, startIndex, flags, segments };
    startIndex += ledCount;
    return zone;
  });
  const ledCount = reader.count(MAX_LEDS, 'LEDs');
  const leds = Array.from({ length: ledCount }, (_, ledId) => ({ id: ledId, name: reader.string(), value: reader.u32() }));
  const colorCount = reader.count(MAX_LEDS, 'Farben');
  const colors = Array.from({ length: colorCount }, () => reader.u32());
  let flags = 0;
  if (protocol >= 5) {
    const alternateCount = reader.count(MAX_LEDS, 'LED-Namen');
    for (let i = 0; i < alternateCount; i++) { const alternate = reader.string(); if (leds[i] && alternate) leds[i].name = alternate; }
    flags = reader.u32();
  }
  if (reader.offset !== buffer.length) throw new BridgeError('Nicht unterstützte OpenRGB-Gerätedaten.', 'INVALID_PACKET');
  for (const led of leds) led.color = colorHex(colors[led.id] || 0);
  const direct = ['Direct', 'Custom', 'Static'].flatMap(modeName => modes.filter(mode => mode.name === modeName && mode.colorMode === 1 && !(mode.flags & (1 << 9))))[0];
  const layoutValid = zones.length === 0 || startIndex === colorCount;
  return { id, name, vendor, type, description, version, serial, location, activeMode, ledCount, zones, leds, modes, colors, flags, directMode: !!direct && colorCount > 0 && layoutValid, directModeId: direct?.id ?? null, layoutValid };
}

export function publicController(device) {
  const { colors, modes, ...rest } = device;
  return { ...rest, typeName: DEVICE_TYPES[device.type] ?? 'RGB-Gerät', modes: modes.map(({ raw, ...mode }) => mode) };
}

export class OpenRGBClient extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 6742, timeout = 3000 } = {}) {
    super();
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new BridgeError('Nur eine lokale OpenRGB-Verbindung ist erlaubt.', 'LOCAL_ONLY', 400);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BridgeError('Ungültiger OpenRGB-Port.', 'INVALID_PORT', 400);
    this.host = host === 'localhost' ? '127.0.0.1' : host; this.port = port; this.timeout = timeout;
    this.socket = null; this.protocol = null; this.devices = []; this.buffer = Buffer.alloc(0); this.pending = new Map(); this.ready = false; this.generation = 0;
  }
  get connected() { return !!this.socket && !this.socket.destroyed && this.ready; }
  async connect() {
    this.close();
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket; this.buffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    socket.on('data', data => { try { this.receive(data); } catch (error) { this.fail(error); } });
    socket.on('error', error => this.fail(new BridgeError(`OpenRGB nicht erreichbar (${error.code || 'Verbindungsfehler'}). SDK-Server auf Port ${this.port} starten.`, 'OPENRGB_UNAVAILABLE')));
    socket.on('close', () => { if (this.socket === socket) this.fail(new BridgeError('Die Verbindung zu OpenRGB wurde geschlossen.', 'OPENRGB_DISCONNECTED')); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); socket.destroy(); reject(new BridgeError('Zeitüberschreitung beim Verbinden mit OpenRGB.', 'OPENRGB_TIMEOUT')); }, this.timeout);
      const onConnect = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new BridgeError(`OpenRGB nicht erreichbar. SDK-Server auf 127.0.0.1:${this.port} starten.`, 'OPENRGB_UNAVAILABLE')); };
      const cleanup = () => { clearTimeout(timer); socket.off('connect', onConnect); socket.off('error', onError); };
      socket.once('connect', onConnect); socket.once('error', onError);
    });
    let version;
    try { version = await this.request(0, PACKET.VERSION, u32(MAX_PROTOCOL)); }
    catch (error) { if (error.code !== 'OPENRGB_TIMEOUT') throw error; version = u32(0); }
    if (version.length !== 4) { this.fail(new BridgeError('Ungültige OpenRGB-Protokollantwort.', 'INVALID_PACKET')); throw new BridgeError('Ungültige OpenRGB-Protokollantwort.', 'INVALID_PACKET'); }
    this.protocol = Math.min(MAX_PROTOCOL, version.readUInt32LE());
    await this.send(0, PACKET.NAME, Buffer.from('Aura RGB\0', 'utf8'));
    this.ready = true;
    try { return await this.scan(); } catch (error) { this.fail(error); throw error; }
  }
  receive(data) {
    if (this.buffer.length + data.length > MAX_PACKET + 16) throw new BridgeError('OpenRGB-Puffer überschreitet das Limit.', 'INVALID_PACKET');
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 16) {
      if (this.buffer.toString('ascii', 0, 4) !== 'ORGB') throw new BridgeError('Ungültige OpenRGB-Paketkennung.', 'INVALID_PACKET');
      const deviceId = this.buffer.readUInt32LE(4), command = this.buffer.readUInt32LE(8), size = this.buffer.readUInt32LE(12);
      if (size > MAX_PACKET) throw new BridgeError('OpenRGB-Paket überschreitet das Limit.', 'INVALID_PACKET');
      if (this.buffer.length < 16 + size) return;
      const body = this.buffer.subarray(16, 16 + size); this.buffer = this.buffer.subarray(16 + size);
      if (command === PACKET.LIST_UPDATED) {
        this.generation++; this.devices = []; this.emit('devicesChanged');
      }
      const key = `${deviceId}:${command}`, pending = this.pending.get(key);
      if (pending) { this.pending.delete(key); clearTimeout(pending.timer); pending.resolve(body); }
    }
  }
  async request(deviceId, command, data = Buffer.alloc(0)) {
    const key = `${deviceId}:${command}`;
    if (this.pending.has(key)) throw new BridgeError('Eine OpenRGB-Abfrage läuft bereits.', 'BUSY', 409);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(key); reject(new BridgeError('OpenRGB antwortet nicht rechtzeitig.', 'OPENRGB_TIMEOUT')); }, this.timeout);
      this.pending.set(key, { resolve, reject, timer });
      this.send(deviceId, command, data).catch(error => { const p = this.pending.get(key); if (p) { this.pending.delete(key); clearTimeout(timer); reject(error); } });
    });
  }
  async send(deviceId, command, data = Buffer.alloc(0)) {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new BridgeError('Keine Verbindung zu OpenRGB.', 'OPENRGB_DISCONNECTED');
    if (socket.writableLength > 256 * 1024) throw new BridgeError('OpenRGB verarbeitet die Effekte zu langsam.', 'OPENRGB_BACKPRESSURE');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new BridgeError('OpenRGB nimmt keine Daten an.', 'OPENRGB_TIMEOUT')); this.fail(new BridgeError('OpenRGB nimmt keine Daten an.', 'OPENRGB_TIMEOUT')); }, this.timeout);
      socket.write(packet(deviceId, command, data), error => { clearTimeout(timer); error ? reject(new BridgeError('OpenRGB konnte nicht aktualisiert werden.', 'OPENRGB_DISCONNECTED')) : resolve(); });
    });
  }
  async scan() {
    if (!this.connected) throw new BridgeError('OpenRGB ist nicht verbunden.', 'OPENRGB_DISCONNECTED');
    const generation = this.generation;
    this.devices = [];
    const countData = await this.request(0, PACKET.COUNT);
    if (countData.length !== 4) throw new BridgeError('Ungültige OpenRGB-Geräteanzahl.', 'INVALID_PACKET');
    const count = countData.readUInt32LE();
    if (count > MAX_DEVICES) throw new BridgeError('OpenRGB meldet mehr als 128 Geräte.', 'TOO_MANY_DEVICES');
    const devices = [];
    for (let id = 0; id < count; id++) {
      if (this.generation !== generation) throw new BridgeError('Geräteliste geändert. Bitte erneut erkennen.', 'DEVICE_LIST_CHANGED', 409);
      const data = await this.request(id, PACKET.DATA, this.protocol ? u32(this.protocol) : Buffer.alloc(0));
      devices.push(parseController(data, this.protocol, id));
    }
    if (this.generation !== generation) throw new BridgeError('Geräteliste geändert. Bitte erneut erkennen.', 'DEVICE_LIST_CHANGED', 409);
    this.devices = devices; return devices.map(publicController);
  }
  async selectDirect(device) {
    const mode = device.modes.find(mode => mode.id === device.directModeId);
    if (!device.directMode || !mode) throw new BridgeError(`${device.name}: kein sicherer Modus für einzelne LEDs verfügbar.`, 'DIRECT_UNSUPPORTED', 422);
    const body = Buffer.alloc(8 + mode.raw.length);
    body.writeUInt32LE(body.length); body.writeInt32LE(mode.id, 4); mode.raw.copy(body, 8);
    await this.send(device.id, PACKET.MODE, body);
    device.activeMode = mode.id;
  }
  async update(device, colors) {
    if (!this.devices.includes(device)) throw new BridgeError('Geräteliste geändert. Bitte erneut erkennen.', 'DEVICE_LIST_CHANGED', 409);
    if (colors.length !== device.colors.length || colors.length > MAX_LEDS) throw new BridgeError('Ungültige LED-Farbenanzahl.', 'INVALID_COLORS', 400);
    const body = Buffer.alloc(6 + colors.length * 4);
    body.writeUInt32LE(body.length); body.writeUInt16LE(colors.length, 4);
    colors.forEach((color, index) => body.writeUInt32LE(color >>> 0, 6 + index * 4));
    await this.send(device.id, PACKET.UPDATE, body);
    device.colors = colors;
    device.leds.forEach(led => { led.color = colorHex(colors[led.id] || 0); });
  }
  fail(error) {
    this.ready = false; this.devices = []; this.protocol = null;
    const socket = this.socket; this.socket = null;
    if (socket && !socket.destroyed) socket.destroy();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.emit('disconnected', error);
  }
  close() {
    this.fail(new BridgeError('OpenRGB-Verbindung beendet.', 'OPENRGB_DISCONNECTED'));
  }
}
