import path from 'node:path';
import net from 'node:net';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BridgeError } from './openrgb.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export { systemInventory } from './inventory.mjs';
let launchPromise = null;

export function openrgbCandidates() {
  if (process.platform !== 'win32') return [];
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  return [...new Set([
    ...roots.map(root => path.join(root, 'OpenRGB', 'OpenRGB.exe')),
    ...roots.map(root => path.join(root, 'Programs', 'OpenRGB', 'OpenRGB.exe')),
    path.join(appRoot, 'OpenRGB', 'OpenRGB.exe'),
    path.join(appRoot, 'openrgb', 'OpenRGB.exe'),
    path.join(path.dirname(appRoot), 'OpenRGB', 'OpenRGB.exe'),
  ])];
}

export async function sdkAvailable({ port = 6742, timeout = 500 } = {}) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let finished = false;
    const done = available => { if (finished) return; finished = true; clearTimeout(timer); socket.destroy(); resolve(available); };
    const timer = setTimeout(() => done(false), timeout);
    socket.once('connect', () => done(true)); socket.once('error', () => done(false));
  });
}

export async function openrgbInstallation() {
  const candidates = openrgbCandidates();
  const found = await Promise.all(candidates.map(async candidate => { try { await access(candidate); return candidate; } catch { return null; } }));
  return { installed: found.some(Boolean), paths: found.filter(Boolean), sdkDetected: await sdkAvailable(), searchedPaths: candidates, downloadUrl: 'https://openrgb.org/releases.html' };
}

export async function launchOpenRGB() {
  if (launchPromise) return launchPromise;
  launchPromise = start().finally(() => { launchPromise = null; });
  return launchPromise;
}

async function start() {
  const installation = await openrgbInstallation();
  if (installation.sdkDetected) return { started: false, alreadyRunning: true, ...installation };
  if (process.platform !== 'win32') throw new BridgeError('OpenRGB bitte selbst starten und den lokalen SDK-Server auf Port 6742 einschalten.', 'OPENRGB_START_UNSUPPORTED', 422);
  if (!installation.installed) throw new BridgeError('OpenRGB wurde nicht gefunden. OpenRGB installieren oder den entpackten OpenRGB-Ordner neben PRISM ablegen. Danach erneut versuchen.', 'OPENRGB_NOT_INSTALLED', 404);
  const executable = installation.paths[0];
  await new Promise((resolve, reject) => {
    // Only an executable found in the fixed installation paths can be launched.
    const child = spawn(executable, ['--server', '--server-host', '127.0.0.1', '--server-port', '6742', '--startminimized'], { cwd: path.dirname(executable), windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', error => reject(new BridgeError(error.code === 'EACCES' ? 'OpenRGB benötigt möglicherweise Administratorrechte. Bitte OpenRGB einmal selbst starten.' : 'OpenRGB konnte nicht gestartet werden. Bitte OpenRGB selbst öffnen und den SDK-Server einschalten.', 'OPENRGB_START_FAILED')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return { started: true, alreadyRunning: false, path: executable, sdkDetected: false, message: 'OpenRGB wurde gestartet. Die Geräteerkennung kann etwas dauern. Danach „Verbinden“ wählen. Für RAM und manche Mainboards können OpenRGB-Administratorrechte und der offizielle Treiber nötig sein.' };
}
