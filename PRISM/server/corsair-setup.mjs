import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { access, mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { BridgeError } from './openrgb.mjs';

const SDK_URL = 'https://github.com/CorsairOfficial/cue-sdk/releases/download/v4.0.84/iCUESDK_4.0.84.zip';
const ZIP_SHA = 'eb4414cf505145f3e507dc839ad587bf7ca684d64be3d9a834f416a136736d5d';
const DLL_SHA = 'd72fd819b91fd1d3b0c3db2ea17a47dcfe3b38e26269aa967ecfee10d2e93884';
export const CORSAIR_LICENSE_URL = 'https://corsairofficial.github.io/cue-sdk/#end-user-license-agreement';
const cacheRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PRISM RGB Studio', 'SDK');
const sdkPath = path.join(cacheRoot, 'iCUESDK.x64_2019.dll');
let installing = null;
const sha256 = data => createHash('sha256').update(data).digest('hex');

export async function corsairSetupStatus() {
  let sdkInstalled = false;
  try { await access(sdkPath); sdkInstalled = sha256(await readFile(sdkPath)) === DLL_SHA; } catch { /* Optional SDK not yet installed. */ }
  return { sdkInstalled, licenseUrl: CORSAIR_LICENSE_URL, sdkVersion: '4.0.84', needsICue: true };
}

// Extract only one known manufacturer DLL into a fixed destination. No archive
// filenames become filesystem paths, and both archive and DLL are hash pinned.
export function extractCorsairDll(zip) {
  if (!Buffer.isBuffer(zip) || zip.length > 1024 * 1024 || sha256(zip) !== ZIP_SHA) throw new BridgeError('Der Corsair-Download stimmt nicht mit der geprüften offiziellen Version überein.', 'CUE_DOWNLOAD_INVALID', 502);
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65557); offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new BridgeError('Ungültiges Corsair-SDK-Archiv.', 'CUE_DOWNLOAD_INVALID', 502);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (count > 1000) throw new BridgeError('Ungültiges Corsair-SDK-Archiv.', 'CUE_DOWNLOAD_INVALID', 502);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20), size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const filename = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/(^|\/)redist\/x64\/iCUESDK\.x64_2019\.dll$/i.test(filename)) continue;
    if (flags & 1 || ![0, 8].includes(method) || size > 1024 * 1024 || localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) break;
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    if (start + compressedSize > zip.length) break;
    const compressed = zip.subarray(start, start + compressedSize);
    const dll = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 1024 * 1024 });
    if (dll.length === size && sha256(dll) === DLL_SHA) return dll;
    break;
  }
  throw new BridgeError('Die geprüfte Corsair-Schnittstelle fehlt im Download.', 'CUE_DOWNLOAD_INVALID', 502);
}

export async function installCorsairSdk({ acceptLicense } = {}) {
  if (acceptLicense !== true) throw new BridgeError('Bitte die Corsair-Lizenzbedingungen lesen und dem optionalen Download zustimmen.', 'CUE_LICENSE_REQUIRED', 400);
  if (process.platform !== 'win32') throw new BridgeError('Die Corsair-Anbindung benötigt Windows.', 'WINDOWS_REQUIRED', 422);
  if ((await corsairSetupStatus()).sdkInstalled) return { ready: true, message: 'Corsair-Anbindung ist bereits eingerichtet.' };
  if (installing) return installing;
  installing = (async () => {
    let response;
    try { response = await fetch(SDK_URL, { signal: AbortSignal.timeout(25000) }); }
    catch { throw new BridgeError('Corsair-Download nicht erreichbar. Für die einmalige Einrichtung wird Internet benötigt.', 'CUE_DOWNLOAD_FAILED', 502); }
    if (!response.ok) throw new BridgeError('Der offizielle Corsair-Download ist derzeit nicht erreichbar.', 'CUE_DOWNLOAD_FAILED', 502);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 1024 * 1024) throw new BridgeError('Der Corsair-Download überschreitet die erwartete Größe.', 'CUE_DOWNLOAD_INVALID', 502);
      chunks.push(chunk);
    }
    const dll = extractCorsairDll(Buffer.concat(chunks));
    await mkdir(cacheRoot, { recursive: true });
    const temporary = sdkPath + '.download';
    await writeFile(temporary, dll);
    await rename(temporary, sdkPath);
    return { ready: true, message: 'Offizielle Corsair-Anbindung eingerichtet. iCUE öffnen, SDK-Zugriff erlauben und Geräte erneut suchen.' };
  })().finally(() => { installing = null; });
  return installing;
}
