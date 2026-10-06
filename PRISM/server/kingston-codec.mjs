import path from 'node:path';
import { createRequire } from 'node:module';
import { pbkdf2, randomBytes as secureRandomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { BridgeError } from './openrgb.mjs';

// Independently bound legacy Kingston wire format. This public format constant
// is not a user credential. No executable, hardware or network access occurs.
const PROTOCOL_KEY = '3m23s45i599';
const BLOCK_BYTES = 32;
const HEADER_BYTES = 64;
const MAX_TEXT = 256 * 1024;
const MAX_PACKET_BYTES = MAX_TEXT / 4 * 3;
const MAX_PLAIN_BYTES = MAX_PACKET_BYTES - HEADER_BYTES - 1;
const derive = promisify(pbkdf2);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const ownRequire = createRequire(import.meta.url);
const sourceRequire = createRequire(new URL('../../desktop/package.json', import.meta.url));

export const KINGSTON_CODEC_LIMITS = Object.freeze({
  maximumTextBytes: MAX_TEXT, maximumPlainBytes: MAX_PLAIN_BYTES,
  maximumPacketBytes: MAX_PACKET_BYTES, blockBytes: BLOCK_BYTES,
});

const invalid = () => new BridgeError('Der Kingston-Protokollcodec konnte die Nachricht nicht lesen.', 'KINGSTON_INVALID_DATA', 422);
const disconnected = () => new BridgeError('Kingston-Protokollcodec geschlossen.', 'KINGSTON_DISCONNECTED', 503);
const unavailable = () => new BridgeError('Die integrierte Kingston-Protokollkomponente fehlt. Bitte die Installation reparieren.', 'KINGSTON_CODEC_UNAVAILABLE', 503);

function loadRijndael() {
  const loaders = [ownRequire, sourceRequire];
  if (process.versions.electron && typeof process.resourcesPath === 'string')
    loaders.unshift(createRequire(path.join(process.resourcesPath, 'app.asar', 'package.json')));
  for (const require of loaders) {
    try {
      const type = require('rijndael-js');
      if (typeof type !== 'function') throw unavailable();
      return type;
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw unavailable();
    }
  }
  throw unavailable();
}

function text(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || Buffer.byteLength(value, 'utf8') > MAX_TEXT) throw invalid();
  return value;
}
function bytes(value, size) {
  if (!(Array.isArray(value) || value instanceof Uint8Array) || value.length !== size
    || !value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw invalid();
  return Buffer.from(value);
}
function decodePacket(value) {
  text(value);
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid();
  const packet = Buffer.from(value, 'base64');
  if (packet.length < HEADER_BYTES + BLOCK_BYTES || packet.length > MAX_PACKET_BYTES
    || (packet.length - HEADER_BYTES) % BLOCK_BYTES !== 0 || packet.toString('base64') !== value) throw invalid();
  return packet;
}
function pad(plain) {
  const count = BLOCK_BYTES - plain.length % BLOCK_BYTES;
  return Buffer.concat([plain, Buffer.alloc(count, count)]);
}
function unpad(padded) {
  const count = padded[padded.length - 1];
  if (!Number.isInteger(count) || count < 1 || count > BLOCK_BYTES || count > padded.length) throw invalid();
  let mismatch = 0;
  for (let offset = 1; offset <= BLOCK_BYTES; offset++)
    if (offset <= count) mismatch |= padded[padded.length - offset] ^ count;
  if (mismatch !== 0) throw invalid();
  return padded.subarray(0, padded.length - count);
}

export class KingstonCodec {
  constructor({ Rijndael, randomBytes = secureRandomBytes, deriveKey = derive } = {}) {
    this.Rijndael = Rijndael; this.randomBytes = randomBytes; this.deriveKey = deriveKey; this.generation = 0;
  }
  start() {
    this.Rijndael ??= loadRijndael();
    if (typeof this.Rijndael !== 'function') throw unavailable();
  }
  async request(command, value) {
    const generation = this.generation;
    let key;
    try {
      if (command !== 'encrypt' && command !== 'decrypt') throw invalid();
      text(value);
      // Validate packet structure and size before deriving a key or loading the
      // cipher. The entire message fits the existing bounded WebSocket frame.
      const packet = command === 'decrypt' ? decodePacket(value) : null;
      const plain = command === 'encrypt' ? Buffer.from(value, 'utf8') : null;
      if (plain && plain.length > MAX_PLAIN_BYTES) throw invalid();
      const salt = packet ? packet.subarray(0, BLOCK_BYTES) : bytes(this.randomBytes(BLOCK_BYTES), BLOCK_BYTES);
      const iv = packet ? packet.subarray(BLOCK_BYTES, HEADER_BYTES) : bytes(this.randomBytes(BLOCK_BYTES), BLOCK_BYTES);
      this.start();
      // .NET Rfc2898DeriveBytes(password,salt,1000) uses PBKDF2-HMAC-SHA1.
      key = bytes(await this.deriveKey(PROTOCOL_KEY, salt, 1000, BLOCK_BYTES, 'sha1'), BLOCK_BYTES);
      if (generation !== this.generation) throw disconnected();
      const cipher = new this.Rijndael(key, 'cbc');
      if (plain) {
        const padded = pad(plain);
        const encrypted = bytes(cipher.encrypt(padded, 256, iv), padded.length);
        return Buffer.concat([salt, iv, encrypted]).toString('base64');
      }
      const encrypted = packet.subarray(HEADER_BYTES);
      const padded = bytes(cipher.decrypt(encrypted, 256, iv), encrypted.length);
      return utf8.decode(unpad(padded));
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw invalid();
    } finally { key?.fill(0); }
  }
  encrypt(value) { return this.request('encrypt', value); }
  decrypt(value) { return this.request('decrypt', value); }
  // Existing Kingston clients close the codec before reconnecting. Cancel
  // pending results, while keeping later independent requests usable.
  close() { this.generation++; }
}
