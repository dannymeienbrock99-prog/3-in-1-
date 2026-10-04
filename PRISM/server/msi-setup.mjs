import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { BridgeError } from './openrgb.mjs';

export const MSI_DOWNLOAD_URL = 'https://download.msi.com/uti_exe/Mystic_light_SDK.zip';
export const MSI_HELP_URL = 'https://www.msi.com/Landing/mystic-light-rgb-gaming-pc/how-to';
const ZIP_SHA = '799f06c8cbaba8854d6b30883c3e15c2d992c0a86130427fdc7df5f5f2dc7307';
const DLL_SHA = 'ad1bd5a464c120f086839631cf9cb7a56e8e7373209158e66c628a89be06d166';
const LIMIT = 4 * 1024 * 1024;
const sdkPath = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PRISM RGB Studio', 'SDK', 'MysticLight_SDK_x64.dll');
const sha = data => createHash('sha256').update(data).digest('hex');
let installing = null;

export async function msiSetupStatus() {
  let sdkInstalled = false;
  try { sdkInstalled = sha(await readFile(sdkPath)) === DLL_SHA; } catch { /* Optional local SDK. */ }
  return { sdkInstalled, sdkVersion: '1.0.0.08', downloadUrl: MSI_DOWNLOAD_URL, helpUrl: MSI_HELP_URL, needsMysticLight: true };
}

// Fixed vendor hash and destination; archive paths never become output paths.
export function extractMsiDll(zip) {
  const invalid = () => new BridgeError('Der MSI-Download stimmt nicht mit der geprüften offiziellen Version überein.', 'MSI_DOWNLOAD_INVALID', 502);
  if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > LIMIT || sha(zip) !== ZIP_SHA) throw invalid();
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw invalid();
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (count > 1000) throw invalid();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20), size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > zip.length) throw invalid();
    const filename = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    offset = next;
    if (!/(^|\/)MysticLight_SDK_x64\.dll$/i.test(filename)) continue;
    if (flags & 1 || ![0, 8].includes(method) || size > LIMIT || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw invalid();
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (start + compressedSize > zip.length) throw invalid();
    let dll;
    try { dll = method === 0 ? zip.subarray(start, start + compressedSize) : inflateRawSync(zip.subarray(start, start + compressedSize), { maxOutputLength: LIMIT }); }
    catch { throw invalid(); }
    if (dll.length !== size || sha(dll) !== DLL_SHA) throw invalid();
    return dll;
  }
  throw invalid();
}

export async function installMsiSdk({ acceptDownload } = {}) {
  if (acceptDownload !== true) throw new BridgeError('Bitte dem optionalen Download der offiziellen MSI-Anbindung zustimmen.', 'MSI_DOWNLOAD_CONSENT_REQUIRED', 400);
  if (process.platform !== 'win32') throw new BridgeError('Die MSI-Anbindung benötigt Windows.', 'WINDOWS_REQUIRED', 422);
  if ((await msiSetupStatus()).sdkInstalled) return { ready: true, message: 'MSI-Anbindung ist bereits eingerichtet.' };
  if (installing) return installing;
  installing = (async () => {
    let response;
    try { response = await fetch(MSI_DOWNLOAD_URL, { signal: AbortSignal.timeout(25000) }); }
    catch { throw new BridgeError('MSI-Download nicht erreichbar. Die einmalige Einrichtung benötigt Internet.', 'MSI_DOWNLOAD_FAILED', 502); }
    if (!response.ok || !response.body) throw new BridgeError('Der offizielle MSI-Download ist derzeit nicht erreichbar.', 'MSI_DOWNLOAD_FAILED', 502);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > LIMIT) throw new BridgeError('Der MSI-Download überschreitet die erwartete Größe.', 'MSI_DOWNLOAD_INVALID', 502);
      chunks.push(chunk);
    }
    const dll = extractMsiDll(Buffer.concat(chunks));
    await mkdir(path.dirname(sdkPath), { recursive: true });
    const temporary = sdkPath + '.download';
    try { await writeFile(temporary, dll); await rename(temporary, sdkPath); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
    return { ready: true, message: 'MSI-Anbindung eingerichtet. MSI Center mit Mystic Light öffnen und Geräte erneut suchen.' };
  })().finally(() => { installing = null; });
  return installing;
}
