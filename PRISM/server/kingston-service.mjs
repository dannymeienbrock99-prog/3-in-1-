import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { BridgeError, publicController } from './openrgb.mjs';
import { assertDeviceAllowed } from './device-policy.mjs';

const codecPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native-kingston/bin/PRISM-KingstonCodec.exe');
const execFileAsync = promisify(execFile);
const ENDPOINT = 'ws://127.0.0.1:55599/';
const MAX_TEXT = 256 * 1024;
const READ_APIS = new Set(['get_version', 'get_dram_type', 'get_dram_api', 'get_dram_info']);
const COLOR_WRITE = Symbol('validated Kingston color write');
const SERVICE_NAMES = new Set(['furycontroller_service', 'furycontorller_service']);
const SERVICE_FILES = new Set(['furycontroller_service.exe', 'furycontorller_service.exe']);

// Independent schema binding, researched in the user-supplied CLI repository.
// Values identify vendor modes; they are not USB/SMBus writes. Racing is fixed
// by the service and is unavailable on its API 2 implementation.
const NATIVE_MODES = [
  ['static_color', 0, 'Statisch', { colorsMax: 1, speed: false }],
  ['all_off', 1, 'Aus', { colorsMax: 0, speed: false, brightness: false }],
  ['rainbow_1', 17, 'Regenbogen', { colorsMax: 0, control: 'ctrl', extended: true }],
  ['rainbow_2', 274, 'Regenbogen-Welle', { colorsMax: 0, control: 'ctrl', ir: [2, 6, 2], extended: true }],
  ['rainbow_3', 19, 'Regenbogen-Verlauf', { colorsMax: 0, control: 'ctrl', ir: [2, 4, 4], extended: true }],
  ['ecg', 32, 'EKG', { colorsMax: 1, direction: false, ir: [2, 5, 3], background: true }],
  ['breath', 48, 'Atmen', { direction: false }],
  ['dynamic_color', 64, 'Farbwechsel', { direction: false }],
  ['running', 80, 'Lauflicht', { ir: [0, 32, 0], length: [1, 32, 12], extended: true }],
  ['slide', 81, 'Gleiten', { ir: [1, 4, 3], length: [1, 12, 4], extended: true, defaultDirection: 2 }],
  ['cross', 82, 'Kreuzen', { direction: false, length: [1, 12, 3], extended: true }],
  ['snake', 83, 'Schlange', { direction: false, length: [1, 32, 12], extended: true }],
  ['comet', 96, 'Komet', { ir: [0, 20, 0], length: [1, 18, 7] }],
  ['rain', 97, 'Regen', { defaultDirection: 2 }],
  ['firework', 98, 'Feuerwerk', {}],
  ['racing', 99, 'Rennen', { apiMin: 3, colorsMax: 0, control: 'def', speed: false, brightness: false, direction: false }],
  ['electric_current', 112, 'Stromfluss', { colorsMax: 1, direction: false, background: true }],
  ['count_down', 128, 'Countdown', { background: true }],
  ['flame', 144, 'Flamme', { colorsMax: 0, background: true }],
  ['starry_sky', 256, 'Sternenhimmel', { colorsMax: 0, direction: false }],
  ['fury', 272, 'FURY', { background: true }],
].map(([id, value, name, settings]) => Object.freeze({ id, value, name, settings: Object.freeze(settings) }));

function invalid(message = 'Kingston FURY CTRL hat ungültige Daten geliefert.') {
  return new BridgeError(message, 'KINGSTON_INVALID_DATA', 422);
}
function unavailable(message, code = 'KINGSTON_UNAVAILABLE') { return new BridgeError(message, code, 503); }
function text(value, maximum = 200) { return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f]/g, '').slice(0, maximum) : ''; }
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value, fallback, minimum, maximum, label) {
  const number = value === undefined ? fallback : value;
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new BridgeError(`Ungültiger Kingston-Wert: ${label}.`, 'INVALID_NATIVE_EFFECT', 400);
  return number;
}
function rgb(value) {
  if (typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)) return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
  if (Array.isArray(value) && value.length === 3 && value.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) return [...value];
  throw new BridgeError('Ungültige Kingston-RGB-Farbe.', 'INVALID_NATIVE_EFFECT', 400);
}

export function kingstonNativeEffects(apiVersion) {
  return NATIVE_MODES.filter(mode => apiVersion >= (mode.settings.apiMin ?? 2)).map(mode => ({
    id: mode.id, value: mode.value, name: mode.name, provider: 'kingston', supported: true,
    speedMin: 0, speedMax: 100, brightnessMin: 0, brightnessMax: 100,
    colorsMin: 0, colorsMax: mode.settings.colorsMax ?? 10,
    controls: { speed: mode.settings.speed !== false, brightness: mode.settings.brightness !== false,
      colors: (mode.settings.colorsMax ?? 10) > 0, direction: mode.settings.direction !== false && mode.id !== 'static_color' && mode.id !== 'all_off',
      background: !!mode.settings.background, irDelay: !!mode.settings.ir, length: !!mode.settings.length,
      width: !!mode.settings.extended && apiVersion >= 3, hue: !!mode.settings.extended && apiVersion >= 3,
      multicolor: ['running', 'slide', 'cross', 'snake'].includes(mode.id) && apiVersion >= 3 },
    ...(mode.settings.ir ? { irDelayMin: mode.settings.ir[0], irDelayMax: mode.settings.ir[1] } : {}),
    ...(mode.settings.length ? { lengthMin: mode.settings.length[0], lengthMax: mode.settings.length[1] } : {}),
    warning: 'Experimentelle FURY-CTRL-Anbindung; Dienstbestätigung ist keine physische LED-Messung.'
  }));
}

export function buildKingstonEffect(device, effectId, options = {}) {
  const mode = NATIVE_MODES.find(entry => entry.id === effectId || entry.value === effectId);
  if (!mode || !device.nativeEffects.some(effect => effect.id === mode.id)) throw new BridgeError('Dieser Kingston-Effekt wird von der erkannten FURY-Version nicht unterstützt.', 'NATIVE_EFFECT_UNSUPPORTED', 422);
  if (!object(options)) throw new BridgeError('Ungültige Kingston-Einstellungen.', 'INVALID_NATIVE_EFFECT', 400);
  const s = mode.settings;
  const maxColors = s.colorsMax ?? 10;
  const supplied = options.colors ?? ['#ff0080'];
  if (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 10) throw new BridgeError('Kingston benötigt 1 bis 10 Farben.', 'INVALID_NATIVE_EFFECT', 400);
  const colors = supplied.map(rgb);
  if (maxColors > 0 && colors.length > maxColors) throw new BridgeError(`Dieser Kingston-Effekt erlaubt maximal ${maxColors} Farbe(n).`, 'INVALID_NATIVE_EFFECT', 400);
  const brightness = bounded(options.brightness, 80, 0, 100, 'Helligkeit');
  const speed = bounded(options.speed, 50, 0, 100, 'Geschwindigkeit');
  const requestedDirection = options.direction === 'forward' ? 1 : options.direction === 'reverse' ? 2 : options.direction;
  const direction = bounded(requestedDirection, s.defaultDirection ?? 1, 1, 2, 'Richtung');
  const ir = s.ir ?? [0, 0, 0];
  const irDelay = bounded(options.irDelay, ir[2], ir[0], ir[1], 'IR-Verzögerung');
  const length = s.length ?? [0, 0, 0];
  const ledNumber = bounded(options.length, length[2], length[0], length[1], 'Effektlänge');
  const width = bounded(options.width, 0, 0, s.extended && device.apiVersion >= 3 ? 4 : 0, 'Breite');
  const hue = bounded(options.hue, 0, 0, s.extended && device.apiVersion >= 3 ? 80 : 0, 'Farbton');
  if (mode.id.startsWith('rainbow') && ![0, 20, 40, 60, 80].includes(hue)) throw new BridgeError('Kingston-Regenbogen unterstützt Farbton 0, 20, 40, 60 oder 80.', 'INVALID_NATIVE_EFFECT', 400);
  if (options.multicolor !== undefined && typeof options.multicolor !== 'boolean' || options.powerSaving !== undefined && typeof options.powerSaving !== 'boolean') throw new BridgeError('Ungültige Kingston-Schalter.', 'INVALID_NATIVE_EFFECT', 400);
  if (options.multicolor && !(device.apiVersion >= 3 && ['running', 'slide', 'cross', 'snake'].includes(mode.id))) throw new BridgeError('Mehrfarbig wird von diesem Kingston-Effekt nicht unterstützt.', 'NATIVE_EFFECT_UNSUPPORTED', 422);
  return { index: device.slotIndex, mode: mode.id, ctrl_mode: s.control ?? 'ctrl_color', multicolor: options.multicolor ?? false,
    reset_default_effect: false, reset_color_table: false, direction, ir_delay: irDelay,
    speed, brightness, width, hue, led_number: ledNumber, power_saving: options.powerSaving ?? false,
    number_colors: maxColors === 0 ? 0 : colors.length,
    color_table: colors, background_color: options.background === undefined ? [16, 16, 16] : rgb(options.background) };
}

// The inspection itself is read-only. No service start/stop, driver installation,
// process termination or vendor executable launch occurs here.
const INSPECT_SERVICE = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $names = @('FuryController_Service', 'FuryContorller_Service')
  $services = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -in $names -and $_.State -eq 'Running' -and $_.ProcessId -gt 0 })
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 55599 -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' })
  $matches = @($services | Where-Object { $_.ProcessId -in $listeners.OwningProcess })
  if ($matches.Count -ne 1) { throw 'FURY_NOT_FOUND' }
  $service = $matches[0]
  $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $service.ProcessId)
  if (-not $owner.ExecutablePath) { throw 'FURY_IDENTITY_UNAVAILABLE' }
  $exe = [IO.Path]::GetFullPath($owner.ExecutablePath)
  $file = Get-Item -LiteralPath $exe
  if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'FURY_REPARSE' }
  $signature = Get-AuthenticodeSignature -LiteralPath $exe
  $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { '' }
  @{ serviceName=$service.Name; servicePath=$service.PathName; processPath=$exe; processId=[int]$service.ProcessId; startTime=([string]$owner.CreationDate); signatureStatus=([string]$signature.Status); signer=$signer; listenerAddress='127.0.0.1'; listenerPort=55599; programFiles=@($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'), $env:ProgramW6432) } | ConvertTo-Json -Compress
} catch { @{ unavailable=$true } | ConvertTo-Json -Compress }
`;

export function validateKingstonServiceIdentity(proof) {
  if (!object(proof) || !SERVICE_NAMES.has(String(proof.serviceName).toLowerCase()) || !Number.isInteger(proof.processId) || proof.processId < 1
    || proof.listenerAddress !== '127.0.0.1' || proof.listenerPort !== 55599 || proof.signatureStatus !== 'Valid'
    || !/^Kingston Technology(?: Company)?(?:,? Inc\.?)?$/i.test(String(proof.signer))) throw unavailable('Der lokale Kingston-Dienst konnte nicht als unveränderte Herstellerinstallation bestätigt werden.', 'KINGSTON_SERVICE_UNVERIFIED');
  const file = path.win32.resolve(String(proof.processPath ?? ''));
  const serviceImage = /^\s*"([^"]+)"\s*$/.exec(String(proof.servicePath))?.[1] ?? /^\s*([^"\r\n]+\.exe)\s*$/i.exec(String(proof.servicePath))?.[1];
  if (!serviceImage || path.win32.resolve(serviceImage).toLowerCase() !== file.toLowerCase() || !SERVICE_FILES.has(path.win32.basename(file).toLowerCase())) throw unavailable('Die Kingston-Dienstdatei stimmt nicht mit der lokalen Verbindung überein.', 'KINGSTON_SERVICE_UNVERIFIED');
  const roots = Array.isArray(proof.programFiles) ? proof.programFiles.filter(root => typeof root === 'string' && path.win32.isAbsolute(root)) : [];
  const folders = ['Kingston\\FURYCTRL', 'Kingston\\FURYCTRL_SDK', 'FURYCTRL', 'FURYCTRL_SDK'];
  const allowed = roots.some(root => folders.some(folder => file.toLowerCase().startsWith(path.win32.resolve(root, folder).toLowerCase() + '\\')));
  if (!allowed || !text(proof.startTime)) throw unavailable('Kingston FURY CTRL wurde nicht in einem bekannten geschützten Installationsordner gefunden.', 'KINGSTON_SERVICE_UNVERIFIED');
  return { processId: proof.processId, path: file, startTime: text(proof.startTime), serviceName: text(proof.serviceName), verified: true };
}

export async function inspectKingstonService() {
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const encoded = Buffer.from(INSPECT_SERVICE, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 8000, maxBuffer: MAX_TEXT });
    const proof = JSON.parse(stdout.trim().replace(/^\ufeff/, ''));
    if (proof.unavailable) throw unavailable('Kingston FURY CTRL läuft nicht oder seine Dienstidentität ist nicht lesbar. Die originale Herstellerinstallation wird separat benötigt.');
    return validateKingstonServiceIdentity(proof);
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw unavailable('Die lokale Kingston-Dienstidentität konnte nicht geprüft werden.', 'KINGSTON_SERVICE_UNVERIFIED');
  }
}

export class KingstonCodec {
  constructor({ executable = codecPath, timeout = 4000 } = {}) { this.executable = executable; this.timeout = timeout; this.child = null; this.sequence = 0; this.pending = new Map(); this.buffer = ''; }
  start() {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    const child = spawn(this.executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child; this.buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > MAX_TEXT * 2) return this.fail(invalid('Der Kingston-Protokollcodec meldet zu große Daten.'));
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).replace(/^\ufeff/, '').trim(); this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line), pending = this.pending.get(message.requestId);
          if (!pending) continue;
          this.pending.delete(message.requestId); clearTimeout(pending.timer);
          if (message.ok === true && typeof message.result === 'string') pending.resolve(message.result);
          else pending.reject(invalid('Der Kingston-Protokollcodec konnte die Nachricht nicht lesen.'));
        } catch { this.fail(invalid('Der Kingston-Protokollcodec meldet ungültige Daten.')); }
      }
    });
    child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
    child.on('error', () => { if (this.child === child) this.fail(unavailable('Der Kingston-Protokollcodec fehlt. Bitte die aktuelle PRISM-Version erneut installieren.', 'KINGSTON_CODEC_UNAVAILABLE')); });
    child.on('exit', () => { if (this.child === child) this.fail(unavailable('Der Kingston-Protokollcodec wurde beendet.', 'KINGSTON_CODEC_UNAVAILABLE')); });
  }
  request(command, data) {
    if (!['encrypt', 'decrypt'].includes(command) || typeof data !== 'string' || Buffer.byteLength(data) > MAX_TEXT) return Promise.reject(invalid());
    this.start(); const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(unavailable('Der Kingston-Protokollcodec antwortet nicht.', 'KINGSTON_CODEC_TIMEOUT')), this.timeout);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ requestId, command, data }) + '\n', error => { if (error) this.fail(unavailable('Der Kingston-Protokollcodec ist nicht erreichbar.', 'KINGSTON_CODEC_UNAVAILABLE')); });
    });
  }
  encrypt(data) { return this.request('encrypt', data); }
  decrypt(data) { return this.request('decrypt', data); }
  fail(error) {
    const child = this.child; this.child = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear();
    // This is only PRISM's own text codec, never a Kingston process.
    if (child && child.exitCode === null && !child.killed) child.kill();
  }
  close() { this.fail(unavailable('Kingston-Protokollcodec geschlossen.', 'KINGSTON_DISCONNECTED')); }
}

export class KingstonServiceClient extends EventEmitter {
  constructor({ codec = new KingstonCodec(), verifyService = inspectKingstonService, createSocket = url => new WebSocket(url), timeout = 6000, platform = process.platform } = {}) {
    super(); this.codec = codec; this.verifyService = verifyService; this.createSocket = createSocket; this.timeout = timeout; this.platform = platform;
    this.backend = 'kingston'; this.host = '127.0.0.1'; this.port = 55599; this.protocol = null;
    this.socket = null; this.identity = null; this.ready = false; this.devices = []; this.details = null; this.pending = null; this.queue = Promise.resolve();
  }
  get connected() { return this.ready && this.socket?.readyState === 1; }
  async connect() {
    if (this.platform !== 'win32') throw unavailable('Die Kingston-FURY-Anbindung benötigt Windows.', 'WINDOWS_REQUIRED');
    if (this.socket?.readyState === 1) return this.scan();
    this.close();
    try {
      this.identity = await this.verifyService();
      if (!this.identity?.verified) throw unavailable('Die Kingston-Dienstidentität wurde nicht bestätigt.', 'KINGSTON_SERVICE_UNVERIFIED');
    } catch (error) { this.fail(error, false); throw error; }
    const socket = this.createSocket(ENDPOINT); this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(unavailable('Kingston FURY CTRL antwortet nicht rechtzeitig.', 'KINGSTON_TIMEOUT')); }, this.timeout);
      const settle = fn => value => { clearTimeout(timer); fn(value); };
      socket.addEventListener('open', settle(resolve), { once: true });
      socket.addEventListener('error', settle(() => { this.close(); reject(unavailable('Die lokale Kingston-FURY-Verbindung ist nicht erreichbar.')); }), { once: true });
      socket.addEventListener('close', settle(() => reject(unavailable('Kingston FURY CTRL hat die Verbindung geschlossen.', 'KINGSTON_DISCONNECTED'))), { once: true });
    });
    if (this.socket !== socket || socket.readyState !== 1) throw unavailable('Kingston-Verbindung geschlossen.', 'KINGSTON_DISCONNECTED');
    socket.addEventListener('message', event => { if (this.socket === socket) this.receive(event.data).catch(error => this.fail(error)); });
    socket.addEventListener('error', () => { if (this.socket === socket) this.fail(unavailable('Kingston FURY CTRL ist nicht erreichbar.')); });
    socket.addEventListener('close', () => { if (this.socket === socket) this.fail(unavailable('Kingston FURY CTRL wurde getrennt.', 'KINGSTON_DISCONNECTED')); });
    return this.scan();
  }
  async receive(data) {
    if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_TEXT) throw invalid();
    const decoded = await this.codec.decrypt(data);
    let message; try { message = JSON.parse(decoded); } catch { throw invalid(); }
    if (!object(message?.root) || typeof message.root.api !== 'string' || !this.pending || message.root.api !== this.pending.api) throw invalid('Kingston FURY CTRL hat eine unerwartete Antwort geliefert.');
    const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
    if (String(message.root.status) === '0') pending.resolve(message.root);
    else pending.reject(new BridgeError(`Kingston FURY CTRL hat die Anfrage abgelehnt (Status ${text(String(message.root.status), 16)}).`, 'KINGSTON_REJECTED', 422));
  }
  request(api, values = {}, authorization) {
    if (!READ_APIS.has(api) && !(api === 'set_dram_led' && authorization === COLOR_WRITE)) return Promise.reject(new BridgeError('Diese Kingston-Funktion ist nicht freigegeben.', 'KINGSTON_API_FORBIDDEN', 400));
    const run = async () => {
      if (this.socket?.readyState !== 1) throw unavailable('Kingston-Verbindung geschlossen.', 'KINGSTON_DISCONNECTED');
      const socket = this.socket;
      const packet = await this.codec.encrypt(JSON.stringify({ root: { ...values, api } }));
      if (this.socket !== socket || socket.readyState !== 1) throw unavailable('Kingston-Verbindung geschlossen.', 'KINGSTON_DISCONNECTED');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.fail(unavailable('Kingston FURY CTRL antwortet nicht rechtzeitig. Bitte erneut verbinden.', 'KINGSTON_TIMEOUT')), this.timeout);
        this.pending = { api, resolve, reject, timer };
        try { socket.send(packet); } catch { this.fail(unavailable('Die Kingston-Anfrage konnte nicht gesendet werden.', 'KINGSTON_DISCONNECTED')); }
      });
    };
    const operation = this.queue.then(run, run); this.queue = operation.catch(() => {}); return operation;
  }
  async scan() {
    if (this.socket?.readyState !== 1) return this.connect();
    this.ready = false; this.devices = [];
    try {
      const version = await this.request('get_version');
      const type = await this.request('get_dram_type');
      const api = await this.request('get_dram_api');
      const info = await this.request('get_dram_info');
      if (![2, 3, 4].includes(api.dram_api) || type.dram_type !== 2) throw new BridgeError('Diese Kingston-Schnittstelle unterstützt nur DDR5-RGB mit FURY-API 2, 3 oder 4.', 'KINGSTON_DDR5_UNSUPPORTED', 422);
      if (!object(info.dram) || Object.keys(info.dram).length < 1 || Object.keys(info.dram).length > 8) throw invalid('Kingston FURY CTRL meldet keinen verfügbaren RGB-Arbeitsspeicher.');
      const warnings = [], indices = new Set(), devices = [];
      for (const [key, slot] of Object.entries(info.dram)) {
        if (!object(slot) || !/^slot_[0-7]$/.test(key) || !Number.isInteger(slot.index) || key !== `slot_${slot.index}` || indices.has(slot.index)) throw invalid('Die Kingston-RAM-Steckplätze sind nicht eindeutig.');
        indices.add(slot.index);
        if (slot.type !== 2 || ![2, 3, 4].includes(slot.api_ver) || slot.api_ver !== api.dram_api || !/^KingstonFury_(Beast|Renegade)_DDR5(?:_[A-Za-z0-9]+)*$/.test(text(slot.manufac))) {
          warnings.push(`Steckplatz ${slot.index + 1}: Kingston-Modell oder Schnittstelle wird nicht sicher unterstützt.`); continue;
        }
        const product = text(slot.product) || (text(slot.manufac).includes('Renegade') ? 'Renegade' : 'Beast');
        const part = text(slot.part_number, 64);
        devices.push({ id: 40000 + slot.index, name: `Kingston FURY ${product} RGB DDR5${part ? ` · ${part}` : ''} · Slot ${slot.index + 1}`,
          vendor: 'Kingston', provider: 'kingston', backend: 'kingston', type: 1, slotKey: key, slotIndex: slot.index,
          apiVersion: slot.api_ver, modelId: Number.isInteger(slot.model_id) ? slot.model_id : null, partNumber: part,
          location: `Kingston FURY CTRL / ${key}`, description: 'Herstellereffekte über den bestehenden Kingston-FURY-Dienst.',
          ledCount: 0, hardwareLedCount: null, leds: [], zones: [], colors: [], colorsKnown: false,
          modes: [], nativeEffects: kingstonNativeEffects(slot.api_ver), directMode: false, directModeId: null, layoutValid: false,
          colorControlScope: 'memory-module', experimental: true });
      }
      this.details = { kingston: { status: devices.length ? 'connected' : 'unsupported', serviceVersion: text(version.version, 64), apiVersion: api.dram_api,
        experimental: true, reason: 'Kingston-Herstellereffekte; physische LED-Anzahl wird nicht gemeldet.' }, warnings };
      this.protocol = api.dram_api; this.devices = devices; this.ready = true;
      return devices.map(publicController);
    } catch (error) { this.fail(error, false); throw error; }
  }
  async applyNativeEffect(device, effectId, options = {}) {
    assertDeviceAllowed(device);
    if (!this.connected || !this.devices.includes(device)) throw new BridgeError('Kingston-RAM nicht mehr verfügbar. Bitte erneut suchen.', 'DEVICE_LIST_CHANGED', 409);
    const payload = buildKingstonEffect(device, effectId, options);
    let verified;
    try { verified = await this.verifyService(); }
    catch (error) { this.fail(error); throw error; }
    if (!verified?.verified || verified.processId !== this.identity?.processId || verified.startTime !== this.identity?.startTime || verified.path !== this.identity?.path) {
      this.fail(unavailable('Der Kingston-Dienst hat sich geändert. Bitte erneut verbinden.', 'KINGSTON_SERVICE_CHANGED'));
      throw unavailable('Der Kingston-Dienst hat sich geändert. Bitte erneut verbinden.', 'KINGSTON_SERVICE_CHANGED');
    }
    await this.request('set_dram_led', { ctrl_settings_ddr5: { [device.slotKey]: payload } }, COLOR_WRITE);
    device.activeNativeEffect = payload.mode;
    return { accepted: true, provider: 'kingston', effect: payload.mode, slotIndex: device.slotIndex, physicalVerification: false };
  }
  async selectDirect() { throw new BridgeError('Kingston meldet keine geprüfte LED-Anordnung. Bitte einen Kingston-Herstellereffekt wählen.', 'DIRECT_UNSUPPORTED', 422); }
  async update() { throw new BridgeError('Für diesen Kingston-RAM sind nur Herstellereffekte verfügbar.', 'DIRECT_UNSUPPORTED', 422); }
  fail(error, emit = true) {
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    this.close(); this.details = { kingston: { status: 'unavailable', reason: error.message, code: error.code, experimental: true }, warnings: [error.message] };
    if (emit) this.emit('disconnected', error);
  }
  close() {
    this.ready = false; this.devices = []; this.identity = null;
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(unavailable('Kingston-Verbindung geschlossen.', 'KINGSTON_DISCONNECTED')); }
    const socket = this.socket; this.socket = null;
    if (socket) { try { socket.close(); } catch {} }
    this.codec.close();
  }
  async disconnect() { this.close(); }
}
