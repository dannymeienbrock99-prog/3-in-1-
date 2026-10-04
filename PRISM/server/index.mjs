import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BridgeError, publicController } from './openrgb.mjs';
import { LightingClient } from './lighting-client.mjs';
import { msiSetupStatus, installMsiSdk } from './msi-setup.mjs';
import { applyNativeEffect } from './native-effects.mjs';
import { APP_VERSION } from './version.mjs';
import { assertDeviceAllowed, PROTECTED_DEVICES } from './device-policy.mjs';
import { corsairSetupStatus, installCorsairSdk } from './corsair-setup.mjs';
import { EffectEngine, EFFECTS } from './effects.mjs';
import { systemInventory } from './system.mjs';
import { buildCoverage, createRazerProbe } from './provider-coverage.mjs';
import { readProfiles, saveProfiles } from './profiles.mjs';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value));
}

async function readJson(request, limit = 64 * 1024) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) throw new BridgeError('JSON-Inhalt erwartet.', 'INVALID_CONTENT_TYPE', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new BridgeError('Die Anfrage ist zu groß.', 'REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new BridgeError('Ungültiger JSON-Inhalt.', 'INVALID_JSON', 400); }
}

export function createBridge({ client = new LightingClient(), dist = path.resolve(serverDirectory, '../dist'), port = 4783, embedded = false, profileDirectory = null, inventory = systemInventory } = {}) {
  const engine = new EffectEngine(client);
  const readRazer = createRazerProbe();
  let lastError = null, operation = Promise.resolve();
  const serialize = task => { const result = operation.then(task); operation = result.catch(() => {}); return result; };
  client.on('disconnected', error => { lastError = error.message; });
  client.on('devicesChanged', () => { lastError = 'Geräte wurden geändert. Bitte Geräte erneut erkennen.'; });
  client.on('controlLost', error => { engine.stop(); lastError = error.message; });
  const status = () => ({ app: 'PRISM', version: APP_VERSION, backend: client.backend ?? 'test', connected: client.connected, host: client.host, port: client.port, protocol: client.protocol, deviceCount: client.devices.length, protectedDevices: PROTECTED_DEVICES, native: client.details ?? null, effectRunning: engine.running, active: engine.active, nativeActive:client.connected ? client.devices.filter(device=>device.activeNativeEffect).map(device=>({deviceId:device.id,provider:device.provider,...device.activeNativeEffect})) : [], effects: EFFECTS, error: engine.lastError || lastError });

  const server = http.createServer(async (request, response) => {
    try {
      const hostname = new URL(`http://${request.headers.host || 'invalid'}`).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname) || !LOOPBACK.has(request.socket.remoteAddress)) throw new BridgeError('Zugriff ist nur von diesem PC erlaubt.', 'LOCAL_ONLY', 403);
      const origin = request.headers.origin;
      if (origin) {
        let originUrl; try { originUrl = new URL(origin); } catch { throw new BridgeError('Ungültiger Browser-Ursprung.', 'INVALID_ORIGIN', 403); }
        const allowedPorts = new Set([String(server.address()?.port || port), '5173', '4173']);
        if (originUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(originUrl.hostname) || !allowedPorts.has(originUrl.port)) throw new BridgeError('Dieser Browser-Ursprung ist nicht erlaubt.', 'INVALID_ORIGIN', 403);
      }
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, status());
        if (request.method === 'GET' && url.pathname === '/api/fans') return json(response, 200, {fans:client.readTelemetry ? await client.readTelemetry() : []});
        if (embedded && profileDirectory && request.method === 'GET' && url.pathname === '/api/profiles') return json(response, 200, { profiles: await readProfiles(profileDirectory) });
        if (request.method === 'GET' && url.pathname === '/api/devices') return json(response, 200, { devices: client.devices.map(publicController), connected: client.connected });
        if (request.method === 'GET' && url.pathname === '/api/system') return json(response, 200, await inventory());
        if (request.method === 'GET' && url.pathname === '/api/msi') return json(response, 200, await msiSetupStatus());
        if (request.method === 'GET' && url.pathname === '/api/corsair') return json(response, 200, await corsairSetupStatus());
        if (request.method === 'GET' && url.pathname === '/api/coverage') {
          const [pcInventory, corsair, razer, msi] = await Promise.allSettled([inventory(), corsairSetupStatus(), readRazer(), msiSetupStatus()]);
          return json(response, 200, buildCoverage({
            inventory:pcInventory.status === 'fulfilled' ? pcInventory.value : {warnings:['Windows-Informationen konnten nicht gelesen werden.']},
            msi:msi.status === 'fulfilled' ? msi.value : {}, corsair:corsair.status === 'fulfilled' ? corsair.value : {}, razer:razer.status === 'fulfilled' ? razer.value : {},
            native:{connected:client.connected, devices:client.devices.map(publicController), details:client.details}
          }));
        }
        if (url.pathname.startsWith('/api/openrgb')) throw new BridgeError('Diese PRISM-Version verwendet direkte Windows-RGB-Steuerung und startet kein OpenRGB.', 'OPENRGB_DISABLED', 410);
        if (request.method !== 'POST') throw new BridgeError('API-Endpunkt oder Methode nicht gefunden.', 'NOT_FOUND', 404);
        const body = await readJson(request, embedded && profileDirectory && url.pathname === '/api/profiles' ? 128 * 1024 : 64 * 1024);
        if (embedded && profileDirectory && url.pathname === '/api/profiles') return json(response, 200, await serialize(async () => ({ profiles: await saveProfiles(profileDirectory, body.profiles) })));
        if (url.pathname === '/api/system/refresh') return json(response, 200, await inventory({ force: true }));
        if (url.pathname === '/api/msi/setup') return json(response, 200, await installMsiSdk(body));
        if (url.pathname === '/api/corsair/setup') return json(response, 200, await installCorsairSdk(body));
        if (url.pathname === '/api/window/show') {
          if (!client.showWindow) throw new BridgeError('Diese Testverbindung hat kein Programmfenster.', 'WINDOW_UNAVAILABLE', 422);
          return json(response, 200, await client.showWindow(`http://127.0.0.1:${server.address().port}/`));
        }
        if (url.pathname === '/api/discover') return json(response, 200, await serialize(async () => {
          // Startup discovery never resets an existing device session or running effect.
          // Available devices are reused; an empty scan can recover when iCUE becomes ready.
          const shouldScan = !client.connected || (client.devices.length === 0 && engine.active.length === 0);
          const devices = shouldScan ? await client.connect() : client.devices.map(publicController);
          if (shouldScan) { lastError = null; engine.lastError = null; }
          return { status: status(), devices, message: devices.length ? 'Unterstützte RGB-Geräte erkannt.' : 'Windows-Gerätenamen werden unabhängig von der RGB-Unterstützung angezeigt.' };
        }));
        if (['/api/connect', '/api/rescan'].includes(url.pathname)) return json(response, 200, await serialize(async () => {
          engine.stop();
          if (engine.framePromise) await engine.framePromise;
          const devices = client.connected ? await client.scan() : await client.connect();
          lastError = null; engine.lastError = null;
          return { status: status(), devices, message: devices.length ? 'Direkt unterstützte RGB-Geräte erkannt.' : 'Keine direkt unterstützten RGB-Geräte gemeldet. PC-Komponenten werden unabhängig davon über Windows erkannt. Für Corsair die iCUE-Anbindung einrichten.' };
        }));
        if (url.pathname === '/api/native-effect') return json(response, 200, await serialize(async () => { const result = await applyNativeEffect(client, engine, body); lastError = null; engine.lastError = null; return result; }));
        if (url.pathname === '/api/apply') return json(response, 200, await serialize(async () => {
          const result = await engine.apply(body);
          lastError = null;
          return result;
        }));
        if (url.pathname === '/api/stop') return json(response, 200, await serialize(async () => {
          if (body.deviceIds !== undefined && (!Array.isArray(body.deviceIds) || body.deviceIds.some(id => !Number.isInteger(id) || id < 0))) throw new BridgeError('Ungültige Geräteauswahl.', 'INVALID_TARGETS', 400);
          const uploaded = [...engine.jobs.values()].filter(job => job.uploaded && (!body.deviceIds || body.deviceIds.includes(job.device.id))).map(job=>job.device);
          let targets=[];
          if (body.blackout) {
            if (!client.connected) throw new BridgeError('Die Windows-RGB-Verbindung ist nicht aktiv.', 'RGB_DISCONNECTED');
            targets = body.deviceIds ? client.devices.filter(device => body.deviceIds.includes(device.id)) : client.devices.filter(device => device.directMode);
            if (!targets.length) throw new BridgeError('Bitte ein Gerät mit direkter LED-Steuerung auswählen. Herstellereffekte können am jeweiligen Gerät auf „Aus“ gestellt werden.', 'INVALID_TARGETS', 400);
            if (body.deviceIds && targets.length !== new Set(body.deviceIds).size) throw new BridgeError('Ein ausgewähltes Gerät ist nicht mehr verfügbar.', 'DEVICE_NOT_FOUND', 404);
            for (const device of targets) assertDeviceAllowed(device);
          }
          // Keep autonomous receiver loops active in status until their stop
          // command succeeds. Ordinary frame jobs can stop immediately.
          engine.stop([...engine.jobs.values()].filter(job=>!job.uploaded && (!body.deviceIds || body.deviceIds.includes(job.device.id))).map(job=>job.device.id));
          if (engine.framePromise) await engine.framePromise;
          if (body.blackout) for (const device of targets) { await client.selectDirect(device); const result=await client.update(device,device.colors.map(()=>0)); if(device.effectUpload && result?.confirmed!==true) throw new BridgeError('Ausschalten wurde übertragen; Funkbestätigung steht aus. Der bisherige Effekt bleibt im Status erhalten.','WIRELESS_ACK_PENDING',409);engine.stop([device.id]); }
          else for (const device of uploaded) { const result=await client.freezeSoftwareEffect(device);if(result?.confirmed!==true)throw new BridgeError('Pause wurde übertragen; Funkbestätigung steht aus. Der bisherige Effekt bleibt im Status erhalten.','WIRELESS_ACK_PENDING',409);engine.stop([device.id]); }
          lastError = null; engine.lastError = null;
          return { stopped: true, blackout: !!body.blackout };
        }));
        if (url.pathname === '/api/disconnect') return json(response, 200, await serialize(async () => { engine.stop(); if (engine.framePromise) await engine.framePromise; if (client.disconnect) await client.disconnect(); else client.close(); lastError = null; engine.lastError = null; return { disconnected: true }; }));
        throw new BridgeError('API-Endpunkt nicht gefunden.', 'NOT_FOUND', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new BridgeError('Methode nicht erlaubt.', 'METHOD_NOT_ALLOWED', 405);
      let requestedPath; try { requestedPath = decodeURIComponent(url.pathname); } catch { throw new BridgeError('Ungültiger Pfad.', 'INVALID_PATH', 400); }
      const filename = path.resolve(dist, '.' + requestedPath);
      if (!filename.startsWith(dist + path.sep) && filename !== dist) throw new BridgeError('Ungültiger Dateipfad.', 'INVALID_PATH', 403);
      let target = filename;
      try { if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
      catch { target = path.join(dist, 'index.html'); }
      let data;
      try { data = await readFile(target); }
      catch { return json(response, 404, { error: 'Die Oberfläche ist noch nicht gebaut. „npm run build“ ausführen oder die Entwicklungsoberfläche starten.', code: 'UI_NOT_BUILT' }); }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (response.headersSent) return response.destroy();
      if (!(error instanceof BridgeError)) console.error(error);
      const message = error instanceof BridgeError ? error.message : 'Interner Fehler in der lokalen RGB-Verbindung.';
      lastError = message;
      json(response, error.status || 500, { error: message, message, code: error.code || 'INTERNAL_ERROR', ...(error.appliedDeviceIds?.length ? { appliedDeviceIds:error.appliedDeviceIds } : {}), status: status() });
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  server.on('close', () => { engine.stop(); client.close(); });
  return { server, client, engine, status, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); try { const address = server.address(); client.setUiPort?.(address.port); resolve(address); } catch (error) { server.close(() => reject(error)); } }); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.AURA_PORT || 4783);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('AURA_PORT muss zwischen 1024 und 65535 liegen.');
  const bridge = createBridge({ port });
  await bridge.listen();
  console.log(`PRISM ist bereit: http://127.0.0.1:${port}`);
  const stop = () => { bridge.engine.stop(); bridge.client.close(); bridge.server.close(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
