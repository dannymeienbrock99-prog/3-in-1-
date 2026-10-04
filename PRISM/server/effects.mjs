import { BridgeError } from './openrgb.mjs';
import { assertDeviceAllowed } from './device-policy.mjs';
import { EFFECTS, renderFrame, validateCustomSettings, isAnimatedEffect } from './effect-renderer.mjs';

export { EFFECTS, renderFrame };
function number(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new BridgeError(`${name}: Wert von ${min} bis ${max} erwartet.`, 'INVALID_SETTINGS', 400);
  return value;
}

export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BridgeError('Effekteinstellungen fehlen.', 'INVALID_SETTINGS', 400);
  const effect = input.effect ?? 'static';
  if (!EFFECTS.includes(effect)) throw new BridgeError('Unbekannter RGB-Effekt.', 'INVALID_EFFECT', 400);
  const colors = input.colors ?? ['#8b5cf6', '#06b6d4'];
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 8 || colors.some(value => typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw new BridgeError('Eine bis acht Farben im Format #RRGGBB erwartet.', 'INVALID_COLORS', 400);
  if (input.direction !== undefined && !['forward', 'reverse'].includes(input.direction)) throw new BridgeError('Ungültige Effektrichtung.', 'INVALID_SETTINGS', 400);
  const settings = { effect, colors: colors.map(value => value.toLowerCase()), brightness: number(input.brightness, 80, 0, 100, 'Helligkeit'), speed: number(input.speed, 50, 1, 100, 'Tempo'), scale: number(input.scale, 40, 1, 100, 'Effektgröße'), direction: input.direction ?? 'forward' };
  if (effect === 'custom') {
    try { settings.custom = validateCustomSettings(input.custom); }
    catch (error) { throw new BridgeError(error.message, 'INVALID_SETTINGS', 400); }
  }
  return settings;
}

export class EffectEngine {
  constructor(client, { fps = 24, now = () => performance.now() } = {}) {
    this.client = client; this.fps = fps; this.now = now; this.jobs = new Map(); this.timer = null; this.framePromise = null; this.lastError = null;
    client.on('providerDisconnected', value => { this.stop(value.deviceIds); this.lastError = value.message; });
    client.on('disconnected', error => { this.stop(); this.lastError = error.message; });
    client.on('devicesChanged', () => { this.stop(); this.lastError = 'Die Geräteliste wurde geändert. Bitte Geräte erneut erkennen.'; });
  }
  get running() { return [...this.jobs.values()].some(job => isAnimatedEffect(job.settings)); }
  get streaming() { return [...this.jobs.values()].some(job => !job.uploaded && isAnimatedEffect(job.settings)); }
  get active() { return [...this.jobs].map(([deviceId, job]) => ({ deviceId, settings: job.settings, zones: job.zones, appliedAt: job.appliedAt, ...(job.uploaded ? { uploaded: true, confirmation: job.upload?.confirmation ?? 'transmitted', acknowledgement: job.upload?.acknowledgement ?? null } : {}) })); }
  validateTargets(input) {
    if (!Array.isArray(input.deviceIds) || input.deviceIds.length === 0 || input.deviceIds.length > 128 || input.deviceIds.some(id => !Number.isInteger(id) || id < 0)) throw new BridgeError('Bitte mindestens ein gültiges Gerät auswählen.', 'INVALID_TARGETS', 400);
    if (input.zoneIds !== undefined && (!input.zoneIds || typeof input.zoneIds !== 'object' || Array.isArray(input.zoneIds))) throw new BridgeError('Ungültige Zonenauswahl.', 'INVALID_ZONES', 400);
    return [...new Set(input.deviceIds)].map(id => {
      const device = this.client.devices.find(device => device.id === id);
      if (!device) throw new BridgeError('Ausgewähltes Gerät nicht mehr verfügbar. Bitte erneut erkennen.', 'DEVICE_NOT_FOUND', 404);
      assertDeviceAllowed(device);
      if (!device.directMode) throw new BridgeError(`${device.name}: kein Modus für sichere LED-Effekte verfügbar.`, 'DIRECT_UNSUPPORTED', 422);
      const zones = input.zoneIds?.[id];
      if (zones !== undefined && (!Array.isArray(zones) || zones.length === 0 || zones.some(zone => !Number.isInteger(zone) || !device.zones.some(value => value.id === zone && value.ledCount > 0)))) throw new BridgeError(`${device.name}: ungültige oder leere RGB-Zone.`, 'INVALID_ZONES', 400);
      if (device.colorsKnown === false && zones) {
        const covered = new Set();
        for (const zoneId of new Set(zones)) {
          const zone = device.zones.find(value => value.id === zoneId);
          for (let index = zone.startIndex; index < zone.startIndex + zone.ledCount; index++) covered.add(index);
        }
        if (covered.size < device.colors.length) throw new BridgeError(`${device.name}: Aktuelle Farben sind nicht bekannt. Bitte alle LED-Zonen auswählen oder die RGB-Geräte erneut suchen, damit andere Anschlüsse unverändert bleiben.`, 'CURRENT_COLORS_UNAVAILABLE', 422);
      }
      return { device, zones: zones ? [...new Set(zones)] : null };
    });
  }
  async apply(input) {
    if (!this.client.connected) throw new BridgeError('Für echte RGB-Steuerung bitte zuerst kompatible Windows-RGB-Geräte suchen.', 'RGB_DISCONNECTED');
    const settings = validateSettings(input), targets = this.validateTargets(input);
    if (targets.some(({device}) => device.effectUpload === true) && typeof this.client.applySoftwareEffect !== 'function') throw new BridgeError('Die Effektübertragung für dieses Gerät ist nicht verfügbar.', 'DIRECT_UNSUPPORTED', 422);
    const uploads = [];
    const previousUploads = new Map(targets.map(({device}) => [device.id,this.jobs.get(device.id)]).filter(([,job])=>job?.uploaded));
    this.lastError = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.framePromise) await this.framePromise;
    // Validate the whole selection before switching any device mode.
    try {
      for (const { device } of targets) if (device.effectUpload !== true) { await this.client.selectDirect(device); delete device.activeNativeEffect; }
      const started = this.now();
      const appliedAt = Date.now();
      for (const { device, zones } of targets) {
        if (device.effectUpload === true) {
          const upload = await this.client.applySoftwareEffect(device, settings, zones);
          const acknowledgement = { deviceId: device.id, confirmation: upload?.confirmation ?? 'transmitted', acknowledgement: upload?.acknowledgement ?? null };
          delete device.activeNativeEffect;
          this.jobs.set(device.id, { device, zones, settings, started, appliedAt, uploaded: true, upload: acknowledgement });
          uploads.push(acknowledgement);
        } else this.jobs.set(device.id, { device, zones, settings, started, appliedAt });
      }
      await this.tick();
    } catch (error) {
      const uploadedIds = new Set(uploads.map(value => value.deviceId));
      const preservedIds = new Set(uploadedIds);
      for (const [id,job] of previousUploads) if (this.client.connected && this.client.devices.includes(job.device)) {
        if (!uploadedIds.has(id)) this.jobs.set(id,job);
        preservedIds.add(id);
      }
      this.stop(targets.filter(({device})=>!preservedIds.has(device.id)).map(({device})=>device.id));
      if (uploads.length) error.appliedDeviceIds = [...uploadedIds];
      throw error;
    }
    finally { this.ensureTimer(); }
    if (!this.streaming && this.timer) { clearInterval(this.timer); this.timer = null; }
    return { applied: targets.map(({ device }) => device.id), effect: settings.effect, settings, streamed: targets.some(({device})=>device.effectUpload !== true), ...(uploads.length ? { uploads } : {}) };
  }
  ensureTimer() {
    if (!this.timer && this.streaming) {
      this.timer = setInterval(() => this.tick().catch(error => { this.lastError = error.message; }), 1000 / this.fps);
      this.timer.unref();
    }
  }
  tick() {
    if (this.framePromise) return this.framePromise;
    this.framePromise = this.renderTick().finally(() => { this.framePromise = null; });
    return this.framePromise;
  }
  async renderTick() {
      let failure = null;
      for (const job of this.jobs.values()) {
        if (job.uploaded) continue;
        try {
        const elapsed = (this.now() - job.started) / 1000;
        const frame = job.device.colors.slice();
        if (job.zones) {
          for (const zoneId of job.zones) {
            const zone = job.device.zones.find(zone => zone.id === zoneId);
            const colors = renderFrame(zone.ledCount, job.settings, elapsed);
            colors.forEach((color, index) => { frame[zone.startIndex + index] = color; });
          }
        } else {
          const colors = renderFrame(frame.length, job.settings, elapsed);
          colors.forEach((color, index) => { frame[index] = color; });
        }
        await this.client.update(job.device, frame);
        } catch (error) { this.stop([job.device.id]); failure ||= error; }
      }
      if (failure) { this.lastError = failure.message; throw failure; }
  }
  stop(deviceIds) {
    if (deviceIds) for (const id of deviceIds) this.jobs.delete(id); else this.jobs.clear();
    if (!this.streaming && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
