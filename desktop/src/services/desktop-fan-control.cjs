'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ElevatedFanHost } = require('./elevated-fan-host.cjs');

const execute = promisify(execFile);
const MAX_LINE = 512 * 1024;
const PORTABLE_CHASSIS = new Set([8, 9, 10, 11, 12, 14, 30, 31, 32]);
const DESKTOP_CHASSIS = new Set([3, 4, 5, 6, 7, 13, 15, 16, 24, 35, 36]);
const copy = value => JSON.parse(JSON.stringify(value));
const text = (value, max = 240) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : '';
const blankPlatform = () => ({ kind: 'unknown', brand: 'other', manufacturer: '', model: '', chassisTypes: [] });
const prerequisitesFrom = value => ({ administrator: typeof value?.administrator === 'boolean' ? value.administrator : null,
  pawnIO: typeof value?.pawnIO === 'boolean' ? value.pawnIO : null });

function platformFromMetadata(value) {
  const board = value?.board || {}, system = value?.system || {};
  const manufacturer = text(board.Manufacturer || board.manufacturer);
  const model = text(board.Product || board.product || board.model);
  const chassisTypes = [...new Set((Array.isArray(value?.chassisTypes) ? value.chassisTypes : [])
    .filter(number => Number.isInteger(number) && number >= 1 && number <= 40))];
  const systemType = Number(system.PCSystemType ?? system.pcSystemType);
  // A laptop marker takes precedence over a misleading OEM enclosure value.
  const portable = systemType === 2 || chassisTypes.some(type => PORTABLE_CHASSIS.has(type));
  const desktop = !portable && (systemType === 1 || chassisTypes.some(type => DESKTOP_CHASSIS.has(type)));
  const brand = /(?:^|\b)(?:asus|asustek)(?:\b|$)/i.test(manufacturer) ? 'asus'
    : /(?:^|\b)(?:msi|micro[- ]?star)(?:\b|$)/i.test(manufacturer) ? 'msi' : 'other';
  return { kind: portable ? 'portable' : desktop ? 'desktop' : 'unknown', brand, manufacturer, model, chassisTypes };
}

async function readWindowsMetadata({ platform = process.platform, exec = execute, env = process.env } = {}) {
  if (platform !== 'win32') return blankPlatform();
  // This script contains only fixed, read-only Windows metadata queries.
  const script = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$board=Get-CimInstance -ClassName Win32_BaseBoard -Property Manufacturer,Product -OperationTimeoutSec 5 | Select-Object -First 1 Manufacturer,Product
$system=Get-CimInstance -ClassName Win32_ComputerSystem -Property PCSystemType -OperationTimeoutSec 5 | Select-Object -First 1 PCSystemType
$enclosure=@(Get-CimInstance -ClassName Win32_SystemEnclosure -Property ChassisTypes -OperationTimeoutSec 5 | Select-Object -ExpandProperty ChassisTypes)
$administrator=$null
try {
  $identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
  try { $principal=[System.Security.Principal.WindowsPrincipal]::new($identity); $administrator=$principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator) }
  finally { $identity.Dispose() }
} catch { $administrator=$null }
$pawnIO=$null
try {
  $registry=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
  try {
    $key=$registry.OpenSubKey('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO',$false)
    try { $parsedVersion=$null; $pawnIO=($null -ne $key -and [System.Version]::TryParse([string]$key.GetValue('DisplayVersion'),[ref]$parsedVersion)) }
    finally { if($null -ne $key){$key.Dispose()} }
  } finally { $registry.Dispose() }
} catch { $pawnIO=$null }
[ordered]@{board=$board;system=$system;chassisTypes=$enclosure;prerequisites=[ordered]@{administrator=$administrator;pawnIO=$pawnIO}} | ConvertTo-Json -Depth 4 -Compress`;
  const executable = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = await exec(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 20_000, maxBuffer: 32_768, encoding: 'utf8' });
  const metadata = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  return { ...platformFromMetadata(metadata), prerequisites: prerequisitesFrom(metadata.prerequisites) };
}

function helperLocation() {
  let packaged = false;
  if (process.versions.electron) try { packaged = require('electron').app?.isPackaged === true; } catch {}
  return path.join(packaged ? process.resourcesPath : path.resolve(__dirname, '../../..'), 'DesktopFanControl', 'BattoFanControl.exe');
}

function physicalId(value, label = 'Lüfter') {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw Error(`${label}: Die Gerätekennung ist ungültig.`);
  return value;
}

function normalizeNativeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.channels) || !Array.isArray(value.sensors)
    || value.channels.length > 128 || value.sensors.length > 512) throw Error('Der Lüfterdienst hat ungültige Geräteinformationen geliefert.');
  const ids = new Set();
  const channels = value.channels.filter(channel => channel?.kind === 'fan' && !/pump|pumpe|power supply|netzteil|gpu|nvidia|radeon|geforce/i.test(`${channel.name || ''} ${channel.device || ''}`)).map(channel => {
    const id = physicalId(channel.id);
    if (ids.has(id)) throw Error('Der Lüfterdienst meldet eine Gerätekennung doppelt.');
    ids.add(id);
    const minDuty = Number.isFinite(channel.minDuty) ? Math.max(30, channel.minDuty) : 30;
    const maxDuty = Number.isFinite(channel.maxDuty) ? Math.min(100, channel.maxDuty) : 100;
    if (minDuty > maxDuty || minDuty > 100 || maxDuty < 30) throw Error('Der zulässige Lüfterbereich ist ungültig.');
    return { id, name: text(channel.name) || 'PC-Lüfter', provider: text(channel.provider, 80), device: text(channel.device), kind: 'fan',
      rpm: Number.isFinite(channel.rpm) && channel.rpm >= 0 ? channel.rpm : null,
      duty: Number.isFinite(channel.duty) && channel.duty >= 0 && channel.duty <= 100 ? channel.duty : null, minDuty, maxDuty };
  });
  const sensorIds = new Set();
  const sensors = value.sensors.map(sensor => {
    const id = physicalId(sensor?.id, 'Temperatursensor');
    if (sensorIds.has(id)) throw Error('Der Lüfterdienst meldet einen Temperatursensor doppelt.');
    sensorIds.add(id);
    const stamp = typeof sensor.updatedUtc === 'string' && Number.isFinite(Date.parse(sensor.updatedUtc)) ? sensor.updatedUtc : '';
    return { id, name: text(sensor.name) || 'Temperatursensor', celsius: Number.isFinite(sensor.celsius) && sensor.celsius >= 0 && sensor.celsius <= 120 ? sensor.celsius : null, updatedUtc: stamp };
  });
  return { channels, sensors };
}

class JsonLineNativeHost {
  constructor({ helperPath, spawnProcess = spawn, timeoutMs = 10_000, closeTimeoutMs = 4000, onState = () => {}, onExit = () => {} }) {
    Object.assign(this, { helperPath, spawnProcess, timeoutMs, closeTimeoutMs, onState, onExit });
    this.child = null; this.pending = new Map(); this.nextId = 0; this.buffer = ''; this.ended = false; this.closePromise = null;
  }
  async start() {
    if (this.child || this.ended) throw Error('Der Lüfterdienst kann nicht erneut verwendet werden.');
    const child = this.spawnProcess(this.helperPath, ['--parent-pid', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      this.buffer += chunk;
      if (this.buffer.length > MAX_LINE) { this.fail(Error('Die Antwort des Lüfterdienstes ist zu groß.')); this.endInput(); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        let value;
        try { value = JSON.parse(line); } catch { this.fail(Error('Der Lüfterdienst antwortet in einem ungültigen Format.')); this.endInput(); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || value.type !== 'state' && (!Number.isInteger(value.requestId) || value.requestId < 1 || value.requestId > 2_147_483_647)) {
          this.fail(Error('Der Lüfterdienst antwortet in einem ungültigen Format.')); this.endInput(); return;
        }
        if (value.type === 'state') {
          try { this.onState(value.state); } catch { this.fail(Error('Der Lüfterdienst meldet einen ungültigen Gerätezustand.')); this.endInput(); return; }
          continue;
        }
        const job = this.pending.get(value.requestId);
        if (!job) continue;
        this.pending.delete(value.requestId); clearTimeout(job.timer);
        if (value.ok !== true) job.reject(Error(text(value.message, 500) || 'Der Lüfterdienst hat die Aktion nicht bestätigt.'));
        else job.resolve(value);
      }
    });
    // Drain stderr, but never echo native device paths or untrusted messages.
    child.stderr.on('data', () => {});
    child.on('error', () => this.fail(Error('Der PC-Lüfterdienst konnte nicht gestartet werden.')));
    child.stdin.on('error', () => this.fail(Error('Die Verbindung zum PC-Lüfterdienst wurde unterbrochen.')));
    const exited = () => { if (this.ended) return; this.ended = true; this.fail(Error('Der PC-Lüfterdienst wurde beendet.')); this.onExit(); };
    child.on('exit', exited); child.on('close', exited);
  }
  request(command, value = {}) {
    if (!this.child || this.ended || this.child.exitCode !== null) return Promise.reject(Error('Der PC-Lüfterdienst ist nicht erreichbar.'));
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error('Der PC-Lüfterdienst hat die Aktion nicht rechtzeitig bestätigt.'));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.child.stdin.write(JSON.stringify({ ...value, requestId, command }) + '\n'); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(Error('Die Verbindung zum PC-Lüfterdienst wurde unterbrochen.')); }
    });
  }
  fail(error) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
  }
  endInput() { try { this.child?.stdin.end(); } catch {} }
  close() {
    if (!this.child || this.ended || this.child.exitCode !== null) { this.endInput(); return Promise.resolve(); }
    if (this.closePromise) return this.closePromise;
    this.closePromise = new Promise((resolve, reject) => {
      const child = this.child;
      const cleanup = () => { clearTimeout(timer); child.removeListener('exit', finish); child.removeListener('close', finish); };
      const finish = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); this.closePromise = null; reject(Error('Der eigene PC-Lüfterdienst hat das Beenden nicht bestätigt.')); }, this.closeTimeoutMs);
      child.once('exit', finish); child.once('close', finish);
      this.endInput();
    }).catch(error => { this.closePromise = null; throw error; });
    return this.closePromise;
  }
}

class DesktopFanService {
  constructor({ helperPath = helperLocation(), platform = process.platform, readMetadata = readWindowsMetadata,
    exists = fs.existsSync, nativeFactory, inProcess = false, spawnProcess = spawn, requestTimeoutMs = 10_000,
    now = Date.now, onChange = () => {}, external = {}, heartbeatMs = 2000,
    schedule = setInterval, unschedule = clearInterval } = {}) {
    Object.assign(this, { helperPath, platformName: platform, readMetadata, exists, nativeFactory, inProcess, spawnProcess, requestTimeoutMs, now, onChange, heartbeatMs, schedule, unschedule });
    this.platform = blankPlatform(); this.prerequisites = prerequisitesFrom(); this.enabled = false; this.phase = 'off'; this.error = ''; this.channels = []; this.sensors = [];
    this.native = null; this.inspected = false; this.ownsControl = false; this.releaseAcknowledged = false; this.closed = false; this.queue = Promise.resolve(); this.closePromise = null; this.heartbeatTimer = null; this.heartbeatPromise = null; this.releaseVerification = 'none';
    this.quitLatch = false; this.quitPreparing = false; this.quitPromise = null;
    this.external = { path: text(external.path, 1024), version: text(external.version, 100), pluginPresent: external.pluginPresent === true, status: 'not-configured' };
  }
  snapshot() {
    const helperExists = this.exists(this.helperPath), supportedBrand = ['asus', 'msi'].includes(this.platform.brand);
    const missingPawn = this.prerequisites.pawnIO === false, missingAdmin = this.prerequisites.administrator !== true;
    const eligible = this.platformName === 'win32' && helperExists && this.platform.kind === 'desktop' && supportedBrand && !missingPawn;
    const native = eligible && (!this.inProcess || !missingAdmin);
    const reason = this.platformName !== 'win32' ? 'Die PC-Lüftersteuerung benötigt Windows.'
      : !helperExists ? 'Die PC-Lüfterkomponente fehlt. Bitte die Installation reparieren.'
      : this.platform.kind === 'portable' ? 'Diese Steuerung ist ausschließlich für Desktop-PCs verfügbar.'
      : this.platform.kind === 'unknown' ? 'Der Desktop-PC wurde noch nicht sicher erkannt.'
      : !supportedBrand ? 'Die Mainboard-Lüftersteuerung unterstützt ASUS- und MSI-Desktop-PCs.'
      : missingPawn ? 'Für die direkte Mainboardsteuerung fehlt PawnIO.'
      : this.inProcess && missingAdmin ? 'Für direkten Mainboardzugriff Batto als Administrator starten. Es wird kein eigener Lüfterhelfer geöffnet.'
      : '';
    const curveAvailable = this.enabled && this.phase === 'ready' && this.sensors.some(sensor => this.freshTemperature(sensor));
    return copy({ enabled: this.enabled, phase: this.phase, platform: this.platform, channels: this.channels, sensors: this.sensors,
      error: this.error, prerequisites: this.prerequisites, availability: { native, reason, inProcess: this.inProcess, requiresElevation: eligible && missingAdmin }, external: this.external, releaseVerification: this.releaseVerification,
      curveAvailability: { available: curveAvailable, reason: curveAvailable ? '' : 'Temperaturkurven benötigen einen Sensor mit nachweislich aktuellem Messzeitpunkt. Dieser Dienst liefert derzeit keinen solchen Sensor.' } });
  }
  changed() { try { this.onChange(this.snapshot()); } catch {} }
  serial(action) {
    if (this.closed) return Promise.reject(Error('Die PC-Lüftersteuerung ist geschlossen.'));
    const task = this.queue.then(action); this.queue = task.catch(() => {}); return task;
  }
  async inspectInternal() {
    try {
      const value = await this.readMetadata({ platform: this.platformName });
      this.prerequisites = prerequisitesFrom(value?.prerequisites || value?.prereqs);
      this.platform = value?.kind ? { kind: value.kind, brand: value.brand, manufacturer: text(value.manufacturer), model: text(value.model), chassisTypes: [...(value.chassisTypes || [])] } : platformFromMetadata(value);
      if (!['desktop', 'portable', 'unknown'].includes(this.platform.kind) || !['asus', 'msi', 'other'].includes(this.platform.brand)) throw Error('Ungültige Windows-Geräteinformationen.');
      this.inspected = true;
      if (!this.enabled) { this.error = ''; this.phase = this.platform.kind === 'desktop' ? 'off' : 'blocked'; }
      this.changed(); return this.snapshot();
    } catch {
      this.platform = blankPlatform(); this.prerequisites = prerequisitesFrom(); this.inspected = false;
      if (!this.enabled) this.phase = 'blocked';
      this.error = 'Windows konnte Mainboard und Desktop-Gerätetyp nicht sicher erkennen.'; this.changed(); throw Error(this.error);
    }
  }
  inspect() { return this.serial(() => this.inspectInternal()); }
  enable(value) {
    if (typeof value !== 'boolean') return Promise.reject(Error('Bitte die PC-Lüftersteuerung ein- oder ausschalten.'));
    if (value && this.quitLatch) return Promise.reject(Error('Die PC-Lüftersteuerung wird gerade für das Beenden freigegeben.'));
    return this.serial(() => value ? this.enableInternal() : this.disableInternal());
  }
  prepareHardwareQuit() {
    if (this.quitPromise) return this.quitPromise;
    // Set this synchronously, before waiting for any already accepted start or
    // manual/curve operation. Those queued operations finish before release.
    this.quitLatch = true; this.quitPreparing = true;
    this.quitPromise = this.serial(() => this.disableInternal()).then(result => {
      this.quitPreparing = false; return result;
    }, error => {
      this.quitLatch = false; this.quitPreparing = false; this.quitPromise = null; throw error;
    });
    return this.quitPromise;
  }
  cancelHardwareQuit() {
    if (this.quitPreparing) throw Error('Die laufende Rückgabe der PC-Lüftersteuerung muss zuerst abgeschlossen werden.');
    this.quitLatch = false; this.quitPromise = null;
  }
  ensureOpen() { if (this.closed) throw Error('Die PC-Lüftersteuerung ist geschlossen.'); }
  nativeState(state) {
    const result = normalizeNativeState(state); this.channels = result.channels; this.sensors = result.sensors;
    this.releaseVerification = state.releaseVerification === 'api-only' ? 'api-only' : 'none';
  }
  makeNative() {
    let owned;
    const handlers = {
      helperPath: this.helperPath, spawnProcess: this.spawnProcess, timeoutMs: this.requestTimeoutMs,
      onState: state => { if (this.native !== owned || !this.enabled || this.closed) return; try { this.nativeState(state); this.changed(); } catch (error) { this.error = error.message; this.phase = 'error'; this.changed(); } },
      onExit: () => {
        if (this.native !== owned || this.closed || !this.enabled) return;
        this.stopHeartbeat();
        if (this.releaseAcknowledged) return;
        this.phase = 'error'; this.error = 'Der Lüfterdienst wurde beendet. Die Rückgabe der Steuerung konnte nicht bestätigt werden.'; this.changed();
      }
    };
    owned = this.nativeFactory ? this.nativeFactory(handlers) : this.prerequisites.administrator !== true ? new ElevatedFanHost(handlers) : new JsonLineNativeHost(handlers);
    return owned;
  }
  startHeartbeat(native) {
    this.stopHeartbeat();
    this.heartbeatTimer = this.schedule(() => {
      if (this.closed || this.native !== native || !this.enabled || this.heartbeatPromise) return;
      this.heartbeatPromise = Promise.resolve().then(() => native.request('heartbeat')).then(result => {
        if (this.native !== native || !this.enabled || this.closed) return;
        if (result.state?.enabled !== true) throw Error('Die PC-Lüftersteuerung ist nicht mehr aktiv.');
        this.nativeState(result.state); this.changed();
      }).catch(error => {
        if (this.native !== native || !this.enabled || this.closed) return;
        this.phase = 'error'; this.error = error.message; this.stopHeartbeat(); this.changed();
      }).finally(() => { this.heartbeatPromise = null; });
    }, this.heartbeatMs);
    this.heartbeatTimer?.unref?.();
  }
  stopHeartbeat() { if (this.heartbeatTimer !== null) this.unschedule(this.heartbeatTimer); this.heartbeatTimer = null; }
  async enableInternal() {
    this.ensureOpen();
    if (this.enabled && this.phase === 'ready') return this.snapshot();
    if (this.native || this.enabled || this.ownsControl) throw Error('Die vorherige Lüftersteuerung muss zuerst sicher ausgeschaltet werden.');
    await this.inspectInternal(); this.ensureOpen();
    const availability = this.snapshot().availability;
    if (availability.reason) { this.phase = 'blocked'; this.error = availability.reason; this.changed(); throw Error(this.error); }
    this.phase = 'starting'; this.error = ''; this.changed();
    const native = this.makeNative(); this.native = native;
    try {
      await native.start(); this.ensureOpen();
      const scanned = await native.request('scan'); this.ensureOpen(); this.nativeState(scanned.state);
      if (!this.channels.length) throw Error('Für diesen PC wurde kein steuerbarer Desktop-Lüfterkanal gefunden.');
      // Enabling makes the module available. It must not change PWM values;
      // ownership is acquired only by a confirmed manual/curve command.
      const result = await native.request('enable');
      this.ensureOpen();
      if (result.state?.enabled !== true) throw Error('Der Lüfterdienst hat das Einschalten nicht bestätigt.');
      this.nativeState(result.state); this.enabled = true; this.phase = 'ready'; this.error = ''; this.startHeartbeat(native); this.changed(); return this.snapshot();
    } catch (error) {
      if (this.ownsControl) {
        this.enabled = true; this.phase = 'error'; this.error = error.message; this.changed();
        try { await this.disableInternal(); } catch {}
      } else {
        this.native = null; await native.close().catch(() => {}); this.channels = []; this.sensors = [];
        this.enabled = false; this.phase = 'blocked'; this.error = error.message; this.changed();
      }
      throw error;
    }
  }
  async disableInternal() {
    this.stopHeartbeat();
    const native = this.native;
    if (!native) {
      if (this.ownsControl) { this.phase = 'error'; this.error = 'Die Rückgabe der Lüftersteuerung konnte nicht bestätigt werden.'; this.changed(); throw Error(this.error); }
      this.enabled = false; this.phase = 'off'; this.error = ''; this.changed(); return this.snapshot();
    }
    this.phase = 'releasing'; this.changed();
    try {
      if (!this.releaseAcknowledged) {
        const result = await native.request('disable');
        if (result.released !== true || result.state?.enabled !== false) throw Error('Die Rückgabe der Lüftersteuerung wurde nicht bestätigt.');
        this.releaseVerification = result.state.releaseVerification === 'api-only' || result.releaseVerification === 'api-only' ? 'api-only' : 'none';
        this.releaseAcknowledged = true; this.ownsControl = false;
      }
      // A release acknowledgement need not carry telemetry; the cleared list
      // below prevents stale channels being shown as available after OFF.
      await native.close(); this.native = null; this.enabled = false; this.releaseAcknowledged = false; this.channels = []; this.sensors = []; this.phase = 'off'; this.error = ''; this.changed(); return this.snapshot();
    } catch (error) {
      // The visible switch remains available for OFF retry until the owned
      // helper actually closes, even if the driver already acknowledged release.
      this.enabled = true; this.phase = 'error'; this.error = error.message; this.changed(); throw error;
    }
  }
  readyChannel(id) {
    this.ensureOpen();
    physicalId(id);
    if (!this.enabled || this.phase !== 'ready' || !this.native) throw Error('Bitte die PC-Lüftersteuerung zuerst einschalten.');
    const channel = this.channels.find(item => item.id === id);
    if (!channel) throw Error('Der ausgewählte Lüfter ist nicht mehr verfügbar. Bitte die Geräte neu prüfen.');
    return channel;
  }
  freshTemperature(sensor) {
    const stamp = Date.parse(sensor?.updatedUtc), current = this.now();
    return !!sensor && Number.isFinite(sensor.celsius) && Number.isFinite(stamp) && current - stamp <= 10_000 && stamp - current <= 2_000;
  }
  setManual(value) {
    if (this.quitLatch) return Promise.reject(Error('Die PC-Lüftersteuerung wird gerade für das Beenden freigegeben.'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isInteger(value.duty) || value.duty < 30 || value.duty > 100)
      return Promise.reject(Error('Die Lüfterleistung muss eine ganze Zahl zwischen 30 und 100 Prozent sein.'));
    if (value.fanConfirmed !== true) return Promise.reject(Error('Bitte bestätigen, dass der ausgewählte Anschluss einen Lüfter und keine Pumpe steuert.'));
    return this.serial(async () => {
      const channel = this.readyChannel(value.id);
      if (value.duty < channel.minDuty || value.duty > channel.maxDuty) throw Error(`Dieser Lüfter unterstützt ${channel.minDuty} bis ${channel.maxDuty} Prozent.`);
      this.ownsControl = true;
      try {
        const result = await this.native.request('manual', { id: channel.id, duty: value.duty, fanConfirmed: true });
        if (result.applied !== true || result.id !== channel.id || result.duty !== value.duty) throw Error('Die neue Lüfterleistung wurde nicht bestätigt.');
        this.nativeState(result.state); this.error = ''; this.changed(); return this.snapshot();
      } catch (error) { this.phase = 'error'; this.error = error.message; this.changed(); throw error; }
    });
  }
  setCurve(value) {
    if (this.quitLatch) return Promise.reject(Error('Die PC-Lüftersteuerung wird gerade für das Beenden freigegeben.'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 20)
      return Promise.reject(Error('Eine Lüfterkurve benötigt 2 bis 20 Punkte.'));
    if (value.fanConfirmed !== true) return Promise.reject(Error('Bitte bestätigen, dass der ausgewählte Anschluss einen Lüfter und keine Pumpe steuert.'));
    const points = value.points.map(point => ({ temperature: point?.temperature, duty: point?.duty }));
    if (points.some((point, index) => !Number.isFinite(point.temperature) || point.temperature < 0 || point.temperature > 120
      || !Number.isFinite(point.duty) || point.duty < 30 || point.duty > 100 || index > 0 && (point.temperature <= points[index - 1].temperature || point.duty < points[index - 1].duty)))
      return Promise.reject(Error('Kurven brauchen aufsteigende Temperaturen von 0 bis 120 °C und eine gleichbleibende oder steigende Lüfterleistung von 30 bis 100 Prozent.'));
    return this.serial(async () => {
      const channel = this.readyChannel(value.id); physicalId(value.sensorId, 'Temperatursensor');
      if (points.some(point => point.duty < channel.minDuty || point.duty > channel.maxDuty)) throw Error(`Dieser Lüfter unterstützt ${channel.minDuty} bis ${channel.maxDuty} Prozent.`);
      const sensor = this.sensors.find(item => item.id === value.sensorId);
      if (!this.freshTemperature(sensor))
        throw Error('Die Kurve benötigt einen aktuellen Temperatursensor dieses Lüfterdienstes.');
      this.ownsControl = true;
      try {
        const result = await this.native.request('curve', { id: channel.id, sensorId: sensor.id, points, failsafeDuty: 100, fanConfirmed: true });
        if (result.applied !== true || result.id !== channel.id || result.sensorId !== sensor.id || result.failsafeDuty !== 100)
          throw Error('Die Lüfterkurve und ihre Absicherung wurden nicht bestätigt.');
        this.nativeState(result.state); this.error = ''; this.changed(); return this.snapshot();
      } catch (error) { this.phase = 'error'; this.error = error.message; this.changed(); throw error; }
    });
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true; this.stopHeartbeat();
    this.closePromise = (async () => {
      await this.queue.catch(() => {});
      try { await this.disableInternal(); }
      finally {
        // EOF is also a native fail-safe release trigger. Never kill another
        // controller program or manufacture an acknowledgement after failure.
        if (this.native) { try { await this.native.close(); } catch {} }
      }
    })();
    return this.closePromise;
  }
}

module.exports = { DesktopFanService, JsonLineNativeHost, platformFromMetadata, readWindowsMetadata, normalizeNativeState };
