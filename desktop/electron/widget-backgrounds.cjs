'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {pathToFileURL} = require('node:url');

const FITS = Object.freeze(['cover', 'contain', 'stretch']);
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 48 * 1024 * 1024;
const MAX_SOURCE_SIDE = 16384;
const MAX_SOURCE_PIXELS = 40000000;
const MAX_IMAGE_SIDE = 3200;
const FILE_PATTERN = /^[a-f0-9]{32}\.png$/u;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function backgroundState(value) {
  const fit = FITS.includes(value?.fit) ? value.fit : 'cover';
  const file = typeof value?.file === 'string' && FILE_PATTERN.test(value.file) ? value.file : '';
  const name = file && typeof value?.name === 'string' ? value.name.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 160).trim() : '';
  return {file, name: file ? name || 'Hintergrundbild' : '', fit};
}

function fitValue(value) {
  if (!FITS.includes(value)) throw new Error('Bitte Ausfüllen, Ganzes Bild oder Strecken wählen.');
  return value;
}

function dimensions(width, height, type) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE || width * height > MAX_SOURCE_PIXELS) {
    throw new Error('Das Bild ist zu groß. Erlaubt sind höchstens 40 Megapixel und 16.384 Pixel pro Seite.');
  }
  return {width, height, type};
}

// Check dimensions and animation headers before passing bounded data to the image decoder.
function rasterHeader(data) {
  if (!Buffer.isBuffer(data) || data.length < 20) throw new Error('Die Bilddatei ist ungültig.');
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (data.length < 33 || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Die PNG-Datei ist ungültig.');
    const result = dimensions(data.readUInt32BE(16), data.readUInt32BE(20), 'png');
    let position = 8, ended = false;
    while (position + 12 <= data.length) {
      const length = data.readUInt32BE(position);
      if (length > data.length - position - 12) throw new Error('Die PNG-Datei ist unvollständig.');
      const type = data.toString('ascii', position + 4, position + 8);
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('Bitte ein statisches Bild verwenden; animierte Bilder werden nicht unterstützt.');
      position += length + 12;
      if (type === 'IEND') { ended = true; break; }
    }
    if (!ended) throw new Error('Die PNG-Datei ist unvollständig.');
    return result;
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let position = 2;
    while (position < data.length) {
      if (data[position++] !== 0xff) throw new Error('Die JPEG-Datei ist ungültig.');
      while (data[position] === 0xff) position++;
      const marker = data[position++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (position + 2 > data.length) break;
      const length = data.readUInt16BE(position);
      if (length < 2 || position + length > data.length) throw new Error('Die JPEG-Datei ist unvollständig.');
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) throw new Error('Die JPEG-Datei ist ungültig.');
        return dimensions(data.readUInt16BE(position + 5), data.readUInt16BE(position + 3), 'jpeg');
      }
      position += length;
    }
    throw new Error('Die JPEG-Datei enthält keine unterstützten Bilddaten.');
  }
  throw new Error('Bitte ein statisches PNG- oder JPEG-Bild wählen.');
}

class WidgetBackgrounds {
  constructor(directory, electron) {
    this.directory = path.resolve(directory);
    this.root = path.join(this.directory, 'WidgetBackgrounds');
    this.electron = electron;
  }
  _root(create = false) {
    try {
      if (create) { fs.mkdirSync(this.directory, {recursive: true}); fs.mkdirSync(this.root, {recursive: true}); }
      if (fs.lstatSync(this.root).isSymbolicLink() || !fs.statSync(this.root).isDirectory()) return null;
      const parent = fs.realpathSync(this.directory), root = fs.realpathSync(this.root);
      if (path.dirname(root).toLowerCase() !== parent.toLowerCase() || path.basename(root) !== 'WidgetBackgrounds') return null;
      return root;
    } catch { return null; }
  }
  _path(file, existing = true) {
    if (typeof file !== 'string' || !FILE_PATTERN.test(file)) return null;
    const root = this._root(!existing);
    if (!root) return null;
    const target = path.join(root, file);
    if (!existing) return target;
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size < 33 || stat.size > MAX_STORED_BYTES) return null;
      if (path.dirname(fs.realpathSync(target)).toLowerCase() !== root.toLowerCase()) return null;
      return target;
    } catch { return null; }
  }
  status(value) {
    const background = backgroundState(value), target = this._path(background.file);
    let valid = false;
    if (target) {
      let descriptor;
      try {
        descriptor = fs.openSync(target, 'r');
        const header = Buffer.alloc(33);
        fs.readSync(descriptor, header, 0, header.length, 0);
        valid = header.subarray(0, 8).equals(PNG_SIGNATURE) && header.readUInt32BE(8) === 13 &&
          header.toString('ascii', 12, 16) === 'IHDR' && header.readUInt32BE(16) > 0 && header.readUInt32BE(16) <= MAX_IMAGE_SIDE &&
          header.readUInt32BE(20) > 0 && header.readUInt32BE(20) <= MAX_IMAGE_SIDE;
      } catch {} finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    }
    return {hasImage: valid, name: valid ? background.name : '', fit: background.fit, imageUrl: valid ? pathToFileURL(target).href : ''};
  }
  async choose(parentWindow) {
    const electron = this.electron || (this.electron = require('electron'));
    const options = {title: 'Hintergrundbild für das Widget-Fenster auswählen', buttonLabel: 'Bild verwenden',
      properties: ['openFile'], filters: [{name: 'Bilder (PNG, JPEG)', extensions: ['png', 'jpg', 'jpeg']}]};
    const result = parentWindow && !parentWindow.isDestroyed() ? await electron.dialog.showOpenDialog(parentWindow, options) : await electron.dialog.showOpenDialog(options);
    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) return null;
    return result.filePaths[0];
  }
  import(source) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('Bitte ein Bild über die Dateiauswahl wählen.');
    const extension = path.extname(source).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('Bitte ein statisches PNG- oder JPEG-Bild wählen.');
    let descriptor, data;
    try {
      descriptor = fs.openSync(source, 'r');
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size < 20 || stat.size > MAX_SOURCE_BYTES) throw new Error('Das Hintergrundbild darf höchstens 10 MB groß sein.');
      data = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < data.length) {
        const count = fs.readSync(descriptor, data, offset, data.length - offset, offset);
        if (!count) throw new Error('Die Bilddatei konnte nicht vollständig gelesen werden.');
        offset += count;
      }
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    const header = rasterHeader(data);
    if ((extension === '.png') !== (header.type === 'png')) throw new Error('Dateiendung und Bildformat passen nicht zusammen.');
    const electron = this.electron || (this.electron = require('electron'));
    let image = electron.nativeImage.createFromBuffer(data);
    if (image.isEmpty()) throw new Error('Das Bild konnte nicht geöffnet werden. Bitte eine andere Bilddatei wählen.');
    const size = image.getSize();
    dimensions(size.width, size.height, header.type);
    if (Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
      const ratio = MAX_IMAGE_SIDE / Math.max(size.width, size.height);
      image = image.resize({width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)), quality: 'good'});
    }
    const normalized = image.toPNG();
    if (!normalized.length || normalized.length > MAX_STORED_BYTES) throw new Error('Das Bild konnte nicht als Hintergrund gespeichert werden.');
    const verified = rasterHeader(normalized);
    if (verified.type !== 'png' || Math.max(verified.width, verified.height) > MAX_IMAGE_SIDE) throw new Error('Das Bild konnte nicht als Hintergrund gespeichert werden.');
    const file = `${randomBytes(16).toString('hex')}.png`, target = this._path(file, false);
    if (!target) throw new Error('Der Speicherordner für Hintergrundbilder ist nicht verfügbar.');
    let output, created = false;
    try {
      output = fs.openSync(target, 'wx', 0o600); created = true;
      fs.writeFileSync(output, normalized);
    } catch (error) {
      if (output !== undefined) { fs.closeSync(output); output = undefined; }
      if (created) { try { fs.unlinkSync(target); } catch {} }
      throw new Error('Das Hintergrundbild konnte nicht gespeichert werden.', {cause: error});
    } finally { if (output !== undefined) fs.closeSync(output); }
    return {file, name: path.basename(source).replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 160) || 'Hintergrundbild'};
  }
  removeUnused(file, windows) {
    if (!file || windows.some(window => backgroundState(window.background).file === file)) return;
    const target = this._path(file);
    if (target) { try { fs.unlinkSync(target); } catch {} }
  }
}

module.exports = {WidgetBackgrounds, backgroundState, fitValue, rasterHeader, FITS, MAX_SOURCE_BYTES, MAX_SOURCE_PIXELS, MAX_SOURCE_SIDE, MAX_IMAGE_SIDE};
