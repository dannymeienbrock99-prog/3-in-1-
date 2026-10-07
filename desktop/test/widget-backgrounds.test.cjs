'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const {WidgetBackgrounds, backgroundState, fitValue, rasterHeader, MAX_SOURCE_BYTES} = require('../electron/widget-backgrounds.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
function pngHeader(width = 1, height = 1, animation = false) {
  const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13); ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12); ihdr[16] = 8; ihdr[17] = 6;
  const end = Buffer.alloc(12); end.write('IEND', 4);
  const animated = Buffer.alloc(20); animated.writeUInt32BE(8); animated.write('acTL', 4);
  return Buffer.concat([PNG.subarray(0, 8), ihdr, ...(animation ? [animated] : []), end]);
}
function jpeg(width, height) {
  const data = Buffer.alloc(23); data[0] = 0xff; data[1] = 0xd8; data[2] = 0xff; data[3] = 0xc0;
  data.writeUInt16BE(17, 4); data[6] = 8; data.writeUInt16BE(height, 7); data.writeUInt16BE(width, 9); data[11] = 3;
  data[21] = 0xff; data[22] = 0xd9; return data;
}
function webp(width, height, animation = false) {
  const data = Buffer.alloc(30); data.write('RIFF'); data.writeUInt32LE(22, 4); data.write('WEBP', 8);
  data.write('VP8X', 12); data.writeUInt32LE(10, 16); data[20] = animation ? 2 : 0;
  data.writeUIntLE(width - 1, 24, 3); data.writeUIntLE(height - 1, 27, 3); return data;
}
function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batto-widget-background-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const source = path.join(directory, 'Mein Bild.png'); fs.writeFileSync(source, PNG);
  const calls = {decode: [], resize: [], dialog: []};
  const image = {isEmpty: () => false, getSize: () => ({width: 1, height: 1}), toPNG: () => PNG,
    resize: options => { calls.resize.push(options); return {toPNG: () => pngHeader(options.width, options.height)}; }, ...overrides.image};
  const electron = {
    dialog: {showOpenDialog: async (...args) => { calls.dialog.push(args); return overrides.choice || {canceled: false, filePaths: [source]}; }},
    nativeImage: {createFromBuffer: data => { calls.decode.push(data); return image; }}
  };
  return {directory, source, calls, image, electron, backgrounds: new WidgetBackgrounds(directory, electron)};
}

test('background restoration accepts only managed opaque PNG identifiers and known fits', () => {
  assert.deepEqual(backgroundState(), {file: '', name: '', fit: 'cover'});
  for (const file of ['../secret.png', 'C:/secret.png', 'https://example.org/x.png', 'background.png', '../' + 'a'.repeat(32) + '.png']) {
    assert.deepEqual(backgroundState({file, name: 'Unsafe', fit: 'stretch'}), {file: '', name: '', fit: 'stretch'});
  }
  assert.deepEqual(backgroundState({file: 'a'.repeat(32) + '.png', name: 'My\nImage', fit: 'contain'}), {file: 'a'.repeat(32) + '.png', name: 'MyImage', fit: 'contain'});
  assert.equal(backgroundState({fit: 'remote-url'}).fit, 'cover');
  assert.throws(() => fitValue('url(file:///C:/secret.png)'));
});

test('static PNG and JPEG dimensions are known before native image decoding', () => {
  assert.deepEqual(rasterHeader(PNG), {width: 1, height: 1, type: 'png'});
  assert.deepEqual(rasterHeader(jpeg(1920, 1080)), {width: 1920, height: 1080, type: 'jpeg'});
  assert.throws(() => rasterHeader(webp(1920, 1080)), /PNG- oder JPEG/);
});

test('oversized raster dimensions and animation are rejected before any native decoder runs', t => {
  const {backgrounds, source, calls} = fixture(t);
  for (const data of [pngHeader(16385, 1), pngHeader(10000, 10000), pngHeader(2, 2, true)]) {
    fs.writeFileSync(source, data);
    assert.throws(() => backgrounds.import(source), /zu groß|statisches/);
  }
  fs.writeFileSync(source.replace(/png$/u, 'webp'), webp(1920, 1080, true));
  assert.throws(() => backgrounds.import(source.replace(/png$/u, 'webp')), /statisches/);
  assert.equal(calls.decode.length, 0);
  assert.equal(fs.existsSync(backgrounds.root), false);
});

test('truncated, invalid and disguised non-raster files fail before decode', t => {
  const {backgrounds, source, calls} = fixture(t);
  for (const data of [PNG.subarray(0, 28), Buffer.from('<svg width="100" height="100"></svg>'), webp(1, 1).subarray(0, 22)]) {
    fs.writeFileSync(source, data); assert.throws(() => backgrounds.import(source));
  }
  fs.writeFileSync(source, jpeg(100, 100));
  assert.throws(() => backgrounds.import(source), /Bildformat/);
  assert.equal(calls.decode.length, 0);
});

test('source size, extension and absolute path checks happen before decode', t => {
  const {backgrounds, source, calls} = fixture(t);
  assert.throws(() => backgrounds.import('relative.png'), /Dateiauswahl/);
  assert.throws(() => backgrounds.import(source.replace(/png$/u, 'svg')), /statisches/);
  const descriptor = fs.openSync(source, 'w'); fs.ftruncateSync(descriptor, MAX_SOURCE_BYTES + 1); fs.closeSync(descriptor);
  assert.throws(() => backgrounds.import(source), /10 MB/);
  assert.equal(calls.decode.length, 0);
});

test('import decodes once, stores normalized PNG under an opaque id and preserves source', t => {
  const {backgrounds, source, calls} = fixture(t);
  const imported = backgrounds.import(source);
  assert.match(imported.file, /^[a-f0-9]{32}\.png$/u);
  assert.equal(imported.name, 'Mein Bild.png');
  assert.equal(calls.decode.length, 1);
  assert.equal(calls.resize.length, 0);
  const status = backgrounds.status({...imported, fit: 'contain'});
  assert.deepEqual({...status, imageUrl: ''}, {hasImage: true, name: 'Mein Bild.png', fit: 'contain', imageUrl: ''});
  assert.equal(path.dirname(fileURLToPath(status.imageUrl)), backgrounds.root);
  assert.deepEqual(fs.readFileSync(fileURLToPath(status.imageUrl)), PNG);
  assert.deepEqual(fs.readFileSync(source), PNG);
});

test('large valid images are resized once to a maximum 3200-pixel side', t => {
  const {backgrounds, source, calls} = fixture(t, {image: {getSize: () => ({width: 6000, height: 4000})}});
  fs.writeFileSync(source, pngHeader(6000, 4000));
  const imported = backgrounds.import(source);
  assert.deepEqual(calls.resize, [{width: 3200, height: 2133, quality: 'good'}]);
  assert.equal(calls.decode.length, 1);
  assert.equal(backgrounds.status(imported).hasImage, true);
});

test('native decoder errors and empty images leave no managed files', t => {
  const {backgrounds, source} = fixture(t, {image: {isEmpty: () => true}});
  assert.throws(() => backgrounds.import(source), /nicht geöffnet/);
  assert.equal(fs.existsSync(backgrounds.root), false);
});

test('native chooser cancellation makes no managed directory or decoder call', async t => {
  const {backgrounds, calls} = fixture(t, {choice: {canceled: true, filePaths: []}});
  const parent = {isDestroyed: () => false};
  assert.equal(await backgrounds.choose(parent), null);
  assert.equal(calls.dialog[0][0], parent);
  assert.deepEqual(calls.dialog[0][1].properties, ['openFile']);
  assert.deepEqual(calls.dialog[0][1].filters[0].extensions, ['png', 'jpg', 'jpeg']);
  assert.equal(calls.decode.length, 0);
  assert.equal(fs.existsSync(backgrounds.root), false);
});

test('removal deletes only unused managed images and never original sources or outside paths', t => {
  const {backgrounds, source} = fixture(t);
  const imported = backgrounds.import(source), target = fileURLToPath(backgrounds.status(imported).imageUrl);
  backgrounds.removeUnused(imported.file, [{background: imported}]); assert.equal(fs.existsSync(target), true);
  backgrounds.removeUnused('../Mein Bild.png', []); assert.equal(fs.existsSync(source), true);
  backgrounds.removeUnused(imported.file, []); assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(source), true);
});

test('missing and foreign files never produce renderer file URLs', t => {
  const {backgrounds, directory} = fixture(t);
  const file = 'b'.repeat(32) + '.png';
  assert.equal(backgrounds.status({file, name: 'Gone'}).hasImage, false);
  fs.mkdirSync(backgrounds.root); fs.writeFileSync(path.join(backgrounds.root, file), Buffer.alloc(40, 9));
  assert.equal(backgrounds.status({file, name: 'Foreign'}).imageUrl, '');
  assert.equal(backgrounds.status({file: path.join(directory, 'Mein Bild.png')}).imageUrl, '');
});

test('a managed-directory junction cannot redirect an import or delete outside storage', t => {
  const {backgrounds, source, directory} = fixture(t);
  const outside = path.join(directory, 'outside'); fs.mkdirSync(outside);
  try { fs.symlinkSync(outside, backgrounds.root, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Filesystem cannot create a test junction.'); throw error; }
  assert.throws(() => backgrounds.import(source), /Speicherordner/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('hard-linked managed files are neither exposed nor deleted', t => {
  const {backgrounds, source} = fixture(t); fs.mkdirSync(backgrounds.root);
  const file = 'c'.repeat(32) + '.png'; fs.linkSync(source, path.join(backgrounds.root, file));
  assert.equal(backgrounds.status({file}).hasImage, false);
  backgrounds.removeUnused(file, []);
  assert.equal(fs.existsSync(path.join(backgrounds.root, file)), true);
  assert.deepEqual(fs.readFileSync(source), PNG);
});
