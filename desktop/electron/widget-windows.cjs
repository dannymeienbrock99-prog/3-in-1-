'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const {WidgetBackgrounds, backgroundState, fitValue} = require('./widget-backgrounds.cjs');

const SLOT_IDS = Object.freeze(Array.from({length: 6}, (_, index) => `slot-${index + 1}`));
const WINDOW_IDS = Object.freeze(['widget-1', 'widget-2']);
const TOOLBAR_HEIGHT = 88;
const MAX_STATE_BYTES = 65536;

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Bitte eine gültige HTTPS-Adresse ohne Steuerzeichen eingeben.');
  }
  const text = value.trim();
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch { throw new Error('Bitte eine vollständige HTTPS-Adresse eingeben.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('Nur HTTPS-Adressen ohne Benutzername oder Passwort sind erlaubt.');
  }
  return url.href;
}

function safeName(value, fallback) {
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Der Name darf höchstens 80 Zeichen enthalten.');
  }
  return value.trim() || fallback;
}

function defaultState() {
  return {
    version: 1,
    slots: SLOT_IDS.map((id, index) => ({id, name: index === 0 ? 'TikFinity' : `Platz ${index + 1}`, url: ''})),
    windows: WINDOW_IDS.map((id, index) => ({id, name: `Fenster ${index + 2}`, slotId: SLOT_IDS[index], bounds: null, alwaysOnTop: false,
      background: backgroundState()}))
  };
}

function savedBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) return null;
  if (value.width <= 0 || value.height <= 0 || Math.abs(value.x) > 100000 || Math.abs(value.y) > 100000) return null;
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(value[key])]));
}

function restoreState(input) {
  const state = defaultState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return state;
  for (const slot of state.slots) {
    const previous = Array.isArray(input.slots) ? input.slots.find(value => value?.id === slot.id) : null;
    if (!previous) continue;
    try { slot.name = safeName(previous.name, slot.name); slot.url = httpsUrl(previous.url); } catch {}
  }
  for (const window of state.windows) {
    const previous = Array.isArray(input.windows) ? input.windows.find(value => value?.id === window.id) : null;
    if (!previous) continue;
    if (SLOT_IDS.includes(previous.slotId)) window.slotId = previous.slotId;
    window.bounds = savedBounds(previous.bounds);
    window.alwaysOnTop = previous.alwaysOnTop === true;
    window.background = backgroundState(previous.background);
  }
  return state;
}

function windowBounds(bounds, screen) {
  const displays = screen.getAllDisplays();
  const previous = savedBounds(bounds);
  const display = previous && displays.find(({workArea: area}) =>
    previous.x + previous.width > area.x && previous.x < area.x + area.width &&
    previous.y + previous.height > area.y && previous.y < area.y + area.height);
  const area = (display || screen.getPrimaryDisplay()).workArea;
  const width = Math.min(area.width, Math.max(360, previous?.width || 580));
  const height = Math.min(area.height, Math.max(240, previous?.height || 740));
  const position = display ? {
    x: Math.round(Math.max(area.x, Math.min(previous.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(previous.y, area.y + area.height - height)))
  } : {};
  return {width, height, minWidth: Math.min(360, area.width), minHeight: Math.min(240, area.height), ...position};
}

class WidgetWindows {
  constructor({directory, onChange, onAllClosed, electron, uiFile, preloadFile, initialState, loadTimeoutMs = 30000} = {}) {
    if (typeof directory !== 'string' || !directory) throw new Error('Speicherort für Zusatzfenster fehlt.');
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'widget-windows.json');
    this.uiFile = path.resolve(uiFile || path.join(__dirname, '../src/renderer/widget-window.html'));
    this.preloadFile = path.resolve(preloadFile || path.join(__dirname, 'widget-window-preload.cjs'));
    this.electron = electron;
    this.backgrounds = new WidgetBackgrounds(this.directory, electron);
    this.backgroundChoices = new Map();
    this.onChange = onChange;
    this.onAllClosed = onAllClosed;
    this.loadTimeoutMs = Number.isFinite(loadTimeoutMs) ? Math.max(10, Math.min(60000, loadTimeoutMs)) : 30000;
    this.records = new Map();
    this.securedSessions = new WeakSet();
    this.storageError = null;
    this.writeSerial = 0;
    let stored = initialState;
    if (stored === undefined) {
      try {
        if (fs.statSync(this.file).size > MAX_STATE_BYTES) throw new Error('Datei zu groß.');
        stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') this.storageError = 'Die gespeicherten Zusatzfenster konnten nicht gelesen werden.';
      }
    }
    this.state = restoreState(stored);
  }

  _electron() { return this.electron || (this.electron = require('electron')); }
  _window(id) {
    const value = this.state.windows.find(window => window.id === id);
    if (!value) throw new Error('Unbekanntes Zusatzfenster.');
    return value;
  }
  _slot(id) {
    const value = this.state.slots.find(slot => slot.id === id);
    if (!value) throw new Error('Unbekannter HTTPS-Platz.');
    return value;
  }
  _record(id) {
    const record = this.records.get(id);
    return record && !record.window.isDestroyed() ? record : null;
  }
  _changed() {
    const state = this.status();
    for (const record of this.records.values()) {
      if (!record.window.isDestroyed() && !record.window.webContents.isDestroyed()) {
        try { record.window.webContents.send('widget-windows:update', {...state, windowId: record.id}); } catch {}
      }
    }
    this.onChange?.(state);
    return state;
  }
  _persist(next = this.state) {
    const temporary = path.join(this.directory, `.widget-windows-${process.pid}-${++this.writeSerial}.tmp`);
    try {
      fs.mkdirSync(this.directory, {recursive: true});
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), {encoding: 'utf8', mode: 0o600});
      fs.renameSync(temporary, this.file);
      this.storageError = null;
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch {}
      throw new Error('Die Zusatzfenster konnten nicht gespeichert werden.', {cause: error});
    }
  }
  status() {
    return {
      ok: true,
      slots: this.state.slots.map(slot => ({...slot})),
      windows: this.state.windows.map(window => {
        const record = this._record(window.id);
        return {...window, background: this.backgrounds.status(window.background), bounds: window.bounds ? {...window.bounds} : null, open: !!record,
          loading: record?.loading === true, error: record?.error || null,
          url: record ? record.url : this._slot(window.slotId).url};
      }),
      ...(this.storageError ? {error: this.storageError} : {})
    };
  }
  getOpenCount() { return this.state.windows.filter(window => this._record(window.id)).length; }
  saveSlot({id, name, url} = {}) {
    const previous = this._slot(id);
    const replacement = {id, name: safeName(name, previous.name), url: httpsUrl(url)};
    const next = {...this.state, slots: this.state.slots.map(slot => slot.id === id ? replacement : slot)};
    this._persist(next);
    this.state = next;
    // Saving an address never loads it. Opening, selecting or reloading is explicit.
    return this._changed();
  }
  isToolbar(sender, frame, windowId) {
    const record = this._record(windowId);
    if (!record || sender !== record.window.webContents || frame !== sender.mainFrame) return false;
    try { return path.resolve(fileURLToPath(frame.url)) === this.uiFile; } catch { return false; }
  }
  toolbarWindowId(sender, frame) {
    return WINDOW_IDS.find(id => this.isToolbar(sender, frame, id)) || null;
  }
  statusForToolbar(sender, frame) {
    const windowId = this.toolbarWindowId(sender, frame);
    if (!windowId) throw new Error('Diese Fensterleiste ist nicht berechtigt.');
    return {...this.status(), windowId};
  }
  _remember(record) {
    if (record.window.isDestroyed()) return;
    const state = this._window(record.id);
    state.bounds = savedBounds(record.window.getNormalBounds());
    state.alwaysOnTop = record.window.isAlwaysOnTop();
    try { this._persist(); } catch { this.storageError = 'Die Fensterposition konnte nicht gespeichert werden.'; }
  }
  _scheduleRemember(record) {
    clearTimeout(record.rememberTimer);
    record.rememberTimer = setTimeout(() => { record.rememberTimer = null; this._remember(record); }, 250);
  }
  _fit(record) {
    if (!record.view || record.window.isDestroyed()) return;
    const [width, height] = record.window.getContentSize();
    record.view.setBounds({x: 0, y: TOOLBAR_HEIGHT, width: Math.max(0, width), height: Math.max(0, height - TOOLBAR_HEIGHT)});
  }
  _clearRemote(record) {
    const view = record.view;
    record.view = null;
    if (view) {
      if (!record.window.isDestroyed()) record.window.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  }
  _remote(record) {
    if (record.view) return record.view;
    const {WebContentsView} = this._electron();
    const view = new WebContentsView({webPreferences: {
      partition: `batto-widget-${record.id}`, sandbox: true, nodeIntegration: false,
      contextIsolation: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false, backgroundThrottling: false
    }});
    // Native view transparency preserves the HTTPS page itself and reveals our local background below it.
    view.setBackgroundColor('#00000000');
    record.view = view;
    const contents = view.webContents;
    if (!this.securedSessions.has(contents.session)) {
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      contents.session.setPermissionCheckHandler(() => false);
      contents.session.on('will-download', event => event.preventDefault());
      this.securedSessions.add(contents.session);
    }
    contents.setWindowOpenHandler(() => ({action: 'deny'}));
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('content-bounds-updated', event => event.preventDefault());
    const preventUnsafe = (event, destination) => {
      try { if (!httpsUrl(destination)) event.preventDefault(); } catch { event.preventDefault(); }
    };
    contents.on('will-navigate', preventUnsafe);
    contents.on('will-redirect', preventUnsafe);
    contents.on('will-frame-navigate', details => preventUnsafe(details, details.url));
    contents.on('will-prevent-unload', event => event.preventDefault());
    const current = () => this._record(record.id) === record && record.view === view;
    contents.on('did-navigate', (_event, destination) => {
      if (!current()) return;
      try { record.url = httpsUrl(destination); } catch { return; }
      record.loading = false; record.error = null; this._changed();
    });
    contents.on('did-fail-load', (_event, code, _description, destination, isMainFrame) => {
      if (!current() || !isMainFrame || code === -3 || destination !== record.url) return;
      record.loading = false;
      record.error = `Die HTTPS-Seite konnte nicht geladen werden (${Number(code) || 'Fehler'}).`;
      this._changed();
    });
    contents.on('render-process-gone', () => {
      if (!current()) return;
      record.loading = false; record.error = 'Die Seite wurde beendet. Bitte erneut laden.'; this._changed();
    });
    record.window.contentView.addChildView(view);
    this._fit(record);
    return view;
  }
  async _navigate(record) {
    const url = httpsUrl(this._slot(this._window(record.id).slotId).url);
    const revision = ++record.revision;
    record.url = url; record.error = null; record.loading = !!url;
    this._changed();
    if (!url) { this._clearRemote(record); return this._changed(); }
    const contents = this._remote(record).webContents;
    let timer;
    try {
      const deadline = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          if (this._record(record.id) === record && revision === record.revision && !contents.isDestroyed()) contents.stop();
          reject(new Error('HTTPS page load timed out.'));
        }, this.loadTimeoutMs);
      });
      await Promise.race([contents.loadURL(url), deadline]);
      if (this._record(record.id) === record && revision === record.revision) {
        record.loading = false; record.error = null;
      }
    } catch (error) {
      if (this._record(record.id) === record && revision === record.revision) {
        record.loading = false;
        record.error = 'Die HTTPS-Seite konnte nicht geladen werden. Prüfe die Adresse und die Verbindung.';
      }
    } finally { clearTimeout(timer); }
    return this._changed();
  }
  async open({id, slotId} = {}) {
    const state = this._window(id);
    if (slotId !== undefined) this._slot(slotId);
    if (slotId !== undefined && state.slotId !== slotId) {
      const next = {...this.state, windows: this.state.windows.map(window => window.id === id ? {...window, slotId} : window)};
      this._persist(next); this.state = next;
    }
    let record = this._record(id);
    if (record) {
      if (record.opening) await record.opening;
      if (!record.window.isDestroyed()) {
        if (record.window.isMinimized()) record.window.restore();
        record.window.show(); record.window.focus();
        if (slotId !== undefined) await this._navigate(record);
      }
      return this._changed();
    }
    const {BrowserWindow, screen} = this._electron();
    const current = this._window(id);
    const window = new BrowserWindow({
      ...windowBounds(current.bounds, screen), title: `Batto – ${current.name}`,
      backgroundColor: '#10110f', autoHideMenuBar: true, show: false,
      alwaysOnTop: current.alwaysOnTop,
      webPreferences: {preload: this.preloadFile, additionalArguments: [`--batto-widget-window=${id}`],
        sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true,
        webviewTag: false, navigateOnDragDrop: false, partition: `batto-widget-toolbar-${id}`}
    });
    record = {id, window, view: null, loading: false, error: null, url: '', revision: 0, opening: null, rememberTimer: null};
    this.records.set(id, record);
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-redirect', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.on('resize', () => { this._fit(record); this._scheduleRemember(record); });
    window.on('move', () => this._scheduleRemember(record));
    window.on('close', () => { clearTimeout(record.rememberTimer); record.rememberTimer = null; this._remember(record); });
    window.on('closed', () => {
      clearTimeout(record.rememberTimer);
      this._clearRemote(record);
      if (this.records.get(id) === record) this.records.delete(id);
      this._changed();
      if (this.getOpenCount() === 0) this.onAllClosed?.();
    });
    const opening = (async () => {
      try {
        await window.loadFile(this.uiFile);
        if (window.isDestroyed()) return;
        window.show();
        await this._navigate(record);
      } catch (error) {
        if (!window.isDestroyed()) window.destroy();
        throw error;
      }
    })();
    record.opening = opening;
    try { await opening; } finally { if (record.opening === opening) record.opening = null; }
    return this._changed();
  }
  async selectSlot({id, slotId} = {}) {
    const window = this._window(id);
    this._slot(slotId);
    const next = {...this.state, windows: this.state.windows.map(value => value.id === id ? {...value, slotId} : value)};
    this._persist(next); this.state = next;
    const record = this._record(id);
    if (record) await this._navigate(record);
    return this._changed();
  }
  async reload(id) {
    this._window(id);
    const record = this._record(id);
    if (!record) throw new Error('Bitte das Zusatzfenster zuerst öffnen.');
    await this._navigate(record);
    return this.status();
  }
  setAlwaysOnTop({id, value} = {}) {
    const window = this._window(id);
    if (typeof value !== 'boolean') throw new Error('Bitte eine gültige Fenstereinstellung wählen.');
    const next = {...this.state, windows: this.state.windows.map(item => item.id === id ? {...item, alwaysOnTop: value} : item)};
    this._persist(next); this.state = next;
    this._record(id)?.window.setAlwaysOnTop(value);
    return this._changed();
  }
  async chooseBackground({id} = {}, parentWindow) {
    this._window(id);
    if (this.backgroundChoices.has(id)) throw new Error('Die Bildauswahl für dieses Fenster ist bereits geöffnet.');
    const choice = {active: true};
    this.backgroundChoices.set(id, choice);
    try {
      const source = await this.backgrounds.choose(parentWindow);
      if (!source || !choice.active) return {...this.status(), canceled: true};
      const imported = this.backgrounds.import(source);
      const previous = this._window(id).background;
      const background = {...imported, fit: previous.fit};
      const next = {...this.state, windows: this.state.windows.map(window => window.id === id ? {...window, background} : window)};
      try { this._persist(next); }
      catch (error) { this.backgrounds.removeUnused(imported.file, this.state.windows); throw error; }
      this.state = next;
      this.backgrounds.removeUnused(previous.file, next.windows);
      return this._changed();
    } finally { if (this.backgroundChoices.get(id) === choice) this.backgroundChoices.delete(id); }
  }
  setBackground({id, fit} = {}) {
    const previous = this._window(id);
    const background = {...previous.background, fit: fitValue(fit)};
    const next = {...this.state, windows: this.state.windows.map(window => window.id === id ? {...window, background} : window)};
    this._persist(next); this.state = next;
    return this._changed();
  }
  clearBackground({id} = {}) {
    const previous = this._window(id);
    const background = backgroundState({fit: previous.background.fit});
    const next = {...this.state, windows: this.state.windows.map(window => window.id === id ? {...window, background} : window)};
    this._persist(next);
    this.state = next;
    const pending = this.backgroundChoices.get(id);
    if (pending) pending.active = false;
    this.backgrounds.removeUnused(previous.background.file, next.windows);
    return this._changed();
  }
  close(id) {
    this._window(id);
    const record = this._record(id);
    if (record) record.window.close();
    return this._changed();
  }
  closeAll() {
    for (const id of WINDOW_IDS) this._record(id)?.window.close();
    return this.status();
  }
}

module.exports = {WidgetWindows, SLOT_IDS, WINDOW_IDS, TOOLBAR_HEIGHT, httpsUrl, restoreState, windowBounds};
