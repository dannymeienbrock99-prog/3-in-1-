'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {EventEmitter} = require('node:events');
const {WidgetWindows, httpsUrl, restoreState, windowBounds, TOOLBAR_HEIGHT} = require('../electron/widget-windows.cjs');

function fixture(t, {initialState, readStored = false, fileLoad, loadTimeoutMs} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-widget-windows-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const windows = [], views = [], sessions = new Map(), changes = [];
  class Session extends EventEmitter {
    setPermissionRequestHandler(value) { this.permissionRequest = value; }
    setPermissionCheckHandler(value) { this.permissionCheck = value; }
  }
  function session(partition) {
    if (!sessions.has(partition)) sessions.set(partition, new Session());
    return sessions.get(partition);
  }
  class Contents extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.loads = []; this.destroyed = false;
      this.mainFrame = {url: ''}; this.session = session(options.partition); this.sent = [];
    }
    isDestroyed() { return this.destroyed; }
    setWindowOpenHandler(value) { this.popup = value; }
    loadURL(url) {
      this.loads.push(url); this.mainFrame.url = url;
      return this.pendingLoad ? this.pendingLoad(url) : Promise.resolve();
    }
    send(channel, value) { this.sent.push({channel, value}); }
    close() { this.destroyed = true; this.emit('destroyed'); }
    stop() { this.stopped = true; }
  }
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.bounds = {x: 15, y: 25, width: options.width, height: options.height};
      this.webContents = new Contents(options.webPreferences); this.alwaysOnTop = !!options.alwaysOnTop; this.shows = 0;
      this.children = []; this.contentView = {addChildView: view => this.children.push(view), removeChildView: view => { this.children = this.children.filter(item => item !== view); }};
      windows.push(this);
    }
    loadFile(file) { this.loadedFile = file; this.webContents.mainFrame.url = pathToFileURL(file).href; return fileLoad ? fileLoad() : Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() { this.restored = true; }
    show() { this.shows++; }
    focus() { this.focused = true; }
    getNormalBounds() { return {...this.bounds}; }
    getContentSize() { return [this.bounds.width, this.bounds.height]; }
    isAlwaysOnTop() { return this.alwaysOnTop; }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    close() { this.emit('close'); this.destroy(); }
    destroy() { this.destroyed = true; this.webContents.close(); this.emit('closed'); }
  }
  class View {
    constructor(options) { this.options = options; this.webContents = new Contents(options.webPreferences); views.push(this); }
    setBounds(value) { this.bounds = value; }
  }
  const screen = {getAllDisplays: () => [{workArea: {x: 0, y: 0, width: 1920, height: 1080}}], getPrimaryDisplay: () => ({workArea: {x: 0, y: 0, width: 1920, height: 1080}})};
  const manager = new WidgetWindows({directory, electron: {BrowserWindow: Window, WebContentsView: View, screen},
    onChange: state => changes.push(state), loadTimeoutMs, ...(readStored ? {} : {initialState})});
  return {directory, manager, windows, views, sessions, changes, screen};
}

function populated() {
  return {slots: [{id: 'slot-1', name: 'Widget A', url: 'https://example.org/widget-a'}, {id: 'slot-2', name: 'Widget B', url: 'https://example.org/widget-b'}]};
}

test('construction defines two independent windows and six empty slots without loading any page', t => {
  const {manager, windows, views, directory} = fixture(t);
  assert.equal(manager.status().slots.length, 6);
  assert.deepEqual(manager.status().windows.map(window => window.name), ['Fenster 2', 'Fenster 3']);
  assert.ok(manager.status().slots.every(slot => slot.url === ''));
  assert.equal(manager.getOpenCount(), 0);
  assert.equal(windows.length + views.length, 0);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('HTTPS slots reject unsafe protocols, embedded credentials and control characters', () => {
  for (const value of ['http://example.org', 'javascript:alert(1)', 'data:text/html,x', 'file:///C:/secret', 'https://name:pass@example.org', 'https://example.org\n/path', 'https://example.org\u0000', 'https://']) {
    assert.throws(() => httpsUrl(value), /HTTPS|Steuerzeichen/);
  }
  assert.equal(httpsUrl('  https://example.org/page?q=one#section  '), 'https://example.org/page?q=one#section');
  assert.equal(httpsUrl(''), '');
  assert.throws(() => httpsUrl(null));
});

test('saved files cannot add a third window or a seventh URL slot and invalid URLs stay empty', () => {
  const state = restoreState({slots: [{id: 'slot-1', name: 'Test', url: 'javascript:evil()'}, {id: 'slot-7', name: 'Hidden', url: 'https://example.org'}], windows: [{id: 'widget-3', slotId: 'slot-7', open: true}]});
  assert.equal(state.slots.length, 6);
  assert.equal(state.windows.length, 2);
  assert.equal(state.slots[0].url, '');
  assert.equal(state.windows[0].slotId, 'slot-1');
  assert.equal('open' in state.windows[0], false);
});

test('saving a URL changes only widget-windows.json and does not fetch it', t => {
  const {manager, directory, windows, views} = fixture(t);
  const chat = path.join(directory, 'chat-window.json');
  fs.writeFileSync(chat, '{"untouched":true}');
  manager.saveSlot({id: 'slot-3', name: 'Meine Seite', url: 'https://example.org/extra'});
  assert.equal(fs.readFileSync(chat, 'utf8'), '{"untouched":true}');
  assert.deepEqual(fs.readdirSync(directory).sort(), ['chat-window.json', 'widget-windows.json']);
  assert.equal(windows.length + views.length, 0);
  const stored = JSON.parse(fs.readFileSync(manager.file, 'utf8'));
  assert.equal(stored.slots[2].url, 'https://example.org/extra');
});

test('invalid slot edits are atomic and leave both memory and saved state intact', t => {
  const {manager} = fixture(t);
  manager.saveSlot({id: 'slot-1', name: 'Good', url: 'https://example.org/good'});
  const before = fs.readFileSync(manager.file, 'utf8');
  assert.throws(() => manager.saveSlot({id: 'slot-1', name: 'Bad', url: 'http://example.org'}));
  assert.throws(() => manager.saveSlot({id: 'slot-7', name: 'Bad', url: 'https://example.org'}));
  assert.equal(manager.status().slots[0].name, 'Good');
  assert.equal(fs.readFileSync(manager.file, 'utf8'), before);
});

test('remote widget uses a separate sandboxed WebContentsView without preload or Batto bridge', async t => {
  const {manager, windows, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  assert.equal(windows.length, 1);
  assert.equal(views.length, 1);
  const options = views[0].options.webPreferences;
  assert.equal(options.preload, undefined);
  assert.equal(options.sandbox, true);
  assert.equal(options.nodeIntegration, false);
  assert.equal(options.contextIsolation, true);
  assert.equal(options.webSecurity, true);
  assert.equal(options.allowRunningInsecureContent, false);
  assert.equal(options.partition.startsWith('persist:'), false);
  assert.notEqual(options.partition, windows[0].options.webPreferences.partition);
  assert.equal(windows[0].options.parent, undefined);
  assert.deepEqual(views[0].webContents.loads, ['https://example.org/widget-a']);
  assert.equal(views[0].bounds.y, TOOLBAR_HEIGHT);
});

test('toolbar identity accepts only the exact local window and its own main frame', async t => {
  const {manager, windows, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  const local = windows[0].webContents;
  assert.equal(manager.isToolbar(local, local.mainFrame, 'widget-1'), true);
  assert.equal(manager.toolbarWindowId(local, local.mainFrame), 'widget-1');
  assert.equal(manager.statusForToolbar(local, local.mainFrame).windowId, 'widget-1');
  assert.equal(manager.isToolbar(local, {...local.mainFrame}, 'widget-1'), false);
  assert.equal(manager.isToolbar(local, local.mainFrame, 'widget-2'), false);
  assert.equal(manager.isToolbar(views[0].webContents, views[0].webContents.mainFrame, 'widget-1'), false);
  local.mainFrame.url = 'https://example.org';
  assert.equal(manager.isToolbar(local, local.mainFrame, 'widget-1'), false);
});

test('permissions, popups, downloads, webviews and unsafe redirects are denied only for widget contents', async t => {
  const {manager, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  const contents = views[0].webContents;
  assert.deepEqual(contents.popup({url: 'https://example.org/popup'}), {action: 'deny'});
  let permitted = true;
  contents.session.permissionRequest(contents, 'media', value => { permitted = value; });
  assert.equal(permitted, false);
  assert.equal(contents.session.permissionCheck(contents, 'clipboard-read'), false);
  for (const eventName of ['will-navigate', 'will-redirect']) {
    let blocked = false;
    contents.emit(eventName, {preventDefault: () => { blocked = true; }}, 'file:///C:/secret.txt');
    assert.equal(blocked, true);
    blocked = false;
    contents.emit(eventName, {preventDefault: () => { blocked = true; }}, 'https://example.org/new');
    assert.equal(blocked, false);
  }
  for (const eventName of ['will-download', 'will-attach-webview', 'content-bounds-updated']) {
    let blocked = false;
    (eventName === 'will-download' ? contents.session : contents).emit(eventName, {preventDefault: () => { blocked = true; }});
    assert.equal(blocked, true);
  }
  let blockedFrame = false;
  contents.emit('will-frame-navigate', {url: 'javascript:evil()', preventDefault: () => { blockedFrame = true; }});
  assert.equal(blockedFrame, true);
});

test('both detachable windows load their own selected slot and closing one leaves the other open', async t => {
  const {manager, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  await manager.open({id: 'widget-2'});
  assert.equal(manager.getOpenCount(), 2);
  manager.close('widget-1');
  assert.equal(manager.getOpenCount(), 1);
  assert.equal(views[0].webContents.isDestroyed(), true);
  assert.equal(views[1].webContents.isDestroyed(), false);
  assert.equal(manager.status().windows[1].open, true);
});

test('opening an already detached widget focuses its existing window without creating another', async t => {
  const {manager, windows, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  await manager.open({id: 'widget-1'});
  assert.equal(windows.length, 1);
  assert.equal(views.length, 1);
  assert.equal(windows[0].focused, true);
});

test('selecting a slot on a closed window only remembers it; explicit open performs the request', async t => {
  const {manager, windows, views} = fixture(t, {initialState: populated()});
  await manager.selectSlot({id: 'widget-2', slotId: 'slot-1'});
  assert.equal(windows.length + views.length, 0);
  await manager.open({id: 'widget-2'});
  assert.deepEqual(views[0].webContents.loads, ['https://example.org/widget-a']);
});

test('editing a slot while it is displayed does not reload the widget until the user requests it', async t => {
  const {manager, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  manager.saveSlot({id: 'slot-1', name: 'Changed', url: 'https://example.org/changed'});
  assert.deepEqual(views[0].webContents.loads, ['https://example.org/widget-a']);
  assert.equal(manager.status().windows[0].url, 'https://example.org/widget-a');
  await manager.reload('widget-1');
  assert.deepEqual(views[0].webContents.loads, ['https://example.org/widget-a', 'https://example.org/changed']);
});

test('choosing an empty slot clears and closes remote content without requesting another page', async t => {
  const {manager, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  await manager.selectSlot({id: 'widget-1', slotId: 'slot-6'});
  assert.equal(views[0].webContents.isDestroyed(), true);
  assert.equal(manager.status().windows[0].open, true);
  assert.equal(manager.status().windows[0].url, '');
  assert.deepEqual(views[0].webContents.loads, ['https://example.org/widget-a']);
});

test('a failed page load leaves the independent toolbar available for retry or close', async t => {
  const {manager, windows, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  views[0].webContents.pendingLoad = () => Promise.reject(new Error('Fixture network failure'));
  const state = await manager.reload('widget-1');
  assert.equal(state.windows[0].loading, false);
  assert.match(state.windows[0].error, /nicht geladen/);
  assert.equal(windows[0].isDestroyed(), false);
  views[0].webContents.pendingLoad = null;
  await manager.reload('widget-1');
  assert.equal(manager.status().windows[0].error, null);
});

test('saved window bounds and always-on-top state survive closing and reopening', async t => {
  const {manager, windows, directory} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  windows[0].bounds = {x: 130, y: 90, width: 880, height: 680};
  manager.setAlwaysOnTop({id: 'widget-1', value: true});
  manager.close('widget-1');
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'widget-windows.json'), 'utf8'));
  assert.deepEqual(stored.windows[0].bounds, {x: 130, y: 90, width: 880, height: 680});
  assert.equal(stored.windows[0].alwaysOnTop, true);
  await manager.open({id: 'widget-1'});
  assert.equal(windows[1].options.x, 130);
  assert.equal(windows[1].options.width, 880);
  assert.equal(windows[1].options.alwaysOnTop, true);
});

test('window coordinates are clamped to attached displays after a monitor is removed', () => {
  const screen = {getAllDisplays: () => [{workArea: {x: 0, y: 0, width: 800, height: 600}}], getPrimaryDisplay: () => ({workArea: {x: 0, y: 0, width: 800, height: 600}})};
  const bounds = windowBounds({x: 6000, y: 100, width: 1400, height: 1000}, screen);
  assert.equal(bounds.width, 800);
  assert.equal(bounds.height, 600);
  assert.equal(bounds.x, undefined);
  const clipped = windowBounds({x: -100, y: 50, width: 500, height: 400}, screen);
  assert.equal(clipped.x, 0);
  assert.equal(clipped.y, 50);
});

test('a malformed widget file recovers without affecting other configuration files', t => {
  const {directory} = fixture(t);
  fs.writeFileSync(path.join(directory, 'widget-windows.json'), '{bad json');
  fs.writeFileSync(path.join(directory, 'chat-window.json'), 'original chat');
  const manager = new WidgetWindows({directory});
  assert.equal(manager.status().slots.length, 6);
  assert.match(manager.status().error, /nicht gelesen/);
  assert.equal(fs.readFileSync(path.join(directory, 'chat-window.json'), 'utf8'), 'original chat');
  assert.equal(fs.readFileSync(path.join(directory, 'widget-windows.json'), 'utf8'), '{bad json');
});

test('reopening uses one session download guard instead of accumulating event handlers', async t => {
  const {manager, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  const session = views[0].webContents.session;
  manager.close('widget-1');
  await manager.open({id: 'widget-1'});
  assert.equal(views[1].webContents.session, session);
  assert.equal(session.listenerCount('will-download'), 1);
});

test('closing while local toolbar load is pending cannot create a hidden remote page afterward', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const {manager, views} = fixture(t, {initialState: populated(), fileLoad: () => pending});
  const opened = manager.open({id: 'widget-1'});
  manager.close('widget-1');
  finish(); await opened;
  assert.equal(manager.getOpenCount(), 0);
  assert.equal(views.length, 0);
});

test('closing all widget windows releases both remote WebContents without changing URL slots', async t => {
  const {manager, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'}); await manager.open({id: 'widget-2'});
  manager.closeAll();
  assert.equal(manager.getOpenCount(), 0);
  assert.ok(views.every(view => view.webContents.isDestroyed()));
  assert.equal(manager.status().slots[0].url, 'https://example.org/widget-a');
});

test('a slow webpage is bounded and leaves its visible local toolbar usable', async t => {
  const {manager, views, windows} = fixture(t, {initialState: populated(), loadTimeoutMs: 15});
  await manager.open({id: 'widget-1'});
  views[0].webContents.pendingLoad = () => new Promise(() => {});
  const state = await manager.reload('widget-1');
  assert.ok(windows[0].shows > 0);
  assert.equal(views[0].webContents.stopped, true);
  assert.equal(state.windows[0].loading, false);
  assert.match(state.windows[0].error, /nicht geladen/);
});

test('a late failed navigation cannot overwrite a newer successful explicit selection', async t => {
  const {manager, views} = fixture(t, {initialState: populated()});
  await manager.open({id: 'widget-1'});
  let rejectOld;
  views[0].webContents.pendingLoad = () => new Promise((_resolve, reject) => { rejectOld = reject; });
  const old = manager.reload('widget-1');
  views[0].webContents.pendingLoad = null;
  await manager.selectSlot({id: 'widget-1', slotId: 'slot-2'});
  rejectOld(new Error('Cancelled old load')); await old;
  assert.equal(manager.status().windows[0].url, 'https://example.org/widget-b');
  assert.equal(manager.status().windows[0].error, null);
  assert.equal(manager.status().windows[0].loading, false);
});
