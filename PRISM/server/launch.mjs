import { createBridge } from './index.mjs';
import { APP_VERSION } from './version.mjs';
import { spawn } from 'node:child_process';

const url = 'http://127.0.0.1:4783';
const noWindow = process.argv.includes('--no-browser') || process.argv.includes('--no-window');
function openBrowser() {
  if (noWindow) return;
  const child = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => console.log(`Bitte im Browser öffnen: ${url}`));
}
const bridge = createBridge({ port: 4783 });
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  bridge.engine.stop();
  if (bridge.engine.framePromise) await bridge.engine.framePromise.catch(() => {});
  await bridge.client.close();
  bridge.server.close(() => process.exit(0));
};
try {
  await bridge.listen();
  console.log(`\n  PRISM RGB Studio ${APP_VERSION}\n  Direkte Windows-Anbindung\n`);
  console.log(`  Lokale Oberfläche: ${url}\n`);
  console.log('  Zum Beenden das PRISM-Fenster schließen oder hier Strg+C drücken.\n');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  bridge.client.once('windowClosed', stop);
  if (!noWindow) {
    try { await bridge.client.showWindow(url); }
    catch (error) {
      console.log(`  Programmfenster nicht verfügbar: ${error.message}`);
      console.log('  Öffne die PC-Erkennung im Browser. RGB-Steuerung benötigt das native PRISM-Fenster.\n');
      openBrowser();
    }
  }
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(url + '/api/status', { signal: AbortSignal.timeout(1500) });
      const value = await response.json();
      if (value.app !== 'PRISM') throw new Error('Fremdes Programm');
      if (value.version !== APP_VERSION) {
        console.error(`PRISM ${value.version} läuft noch. Bitte das alte PRISM-Serverfenster schließen und Version ${APP_VERSION} erneut starten.`);
        process.exitCode = 1;
      } else if (!noWindow) {
        const show = await fetch(url + '/api/window/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(18000) });
        if (!show.ok) openBrowser();
      }
    } catch {
      console.error('Port 4783 wird von einem anderen Programm verwendet. PRISM konnte nicht gestartet werden.');
      process.exitCode = 1;
    }
  } else {
    console.error('PRISM konnte nicht gestartet werden:', error.message);
    process.exitCode = 1;
  }
}
