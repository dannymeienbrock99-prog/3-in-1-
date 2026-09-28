"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const htmlFile = path.join(root, "src", "renderer", "index.html");
let html = fs.readFileSync(htmlFile, "utf8");

// Übersicht immer auf die skalierbare Multi-Chat-Grafik setzen. Der Patch muss
// idempotent bleiben, egal ob vorher noch bg.jpg oder bereits eine andere
// overview-bg-Quelle eingetragen war.
html = html.replace(
  /<img\s+class="overview-bg"\s+src="[^"]+"\s+alt="[^"]*"\s*>/,
  '<img class="overview-bg" src="./assets/multi-chat-dashboard.svg" alt="Crazy_Batto Multi Chat – TikTok, Twitch, YouTube und CNG">'
);
if (!html.includes('class="overview-bg"')) throw new Error("Overview-Bildplatzhalter fehlt.");

const cssTag = '<link rel="stylesheet" href="./restored-tools.css">';
if (!html.includes(cssTag)) {
  const marker = '<link rel="stylesheet" href="./integration-20260904.css">';
  if (!html.includes(marker)) throw new Error("Integration-CSS marker fehlt.");
  html = html.replace(marker, `${marker}\n    ${cssTag}`);
}

const settingsNav = '<button class="nav-button" data-view="settings"><span>☷</span> Einstellungen</button>';
if (!html.includes('data-restored-view="stream-overlay"')) {
  const restoredNav = `<button class="nav-button" data-restored-view="stream-overlay"><span>▤</span> Stream-Overlay</button>\n          <button class="nav-button" data-restored-view="plugins"><span>◈</span> Plugins</button>\n          <button class="nav-button" data-restored-view="mobile"><span>▯</span> Handy verbinden</button>\n          `;
  if (!html.includes(settingsNav)) throw new Error("Einstellungen-Navigation fehlt.");
  html = html.replace(settingsNav, restoredNav + settingsNav);
}

if (!html.includes('id="view-stream-overlay"')) {
  const settingsView = '<section id="view-settings" class="view">';
  const restoredViews = `
          <section id="view-stream-overlay" class="view">
            <div class="section-heading"><div><span class="eyebrow">OBS-BROWSERQUELLE</span><h2>Stream- und Chat-Overlay</h2><p>Chat und Live-Ereignisse als lokale Browserquelle in OBS. Dieser Bereich bleibt zusätzlich zu Multi-Chat und Hologramm erhalten.</p></div><div class="button-row"><button id="stream-overlay-copy">OBS-Adresse kopieren</button><button id="stream-overlay-open" class="primary">Overlay öffnen</button></div></div>
            <article class="panel"><div id="stream-overlay-status"><div class="empty-state">Overlay-Status wird geladen …</div></div></article>
            <article class="panel form-panel"><h3>OBS-Browserquelle</h3><div class="tool-url"><code id="stream-overlay-url">Wird geladen …</code></div><label>Quellenname<input id="stream-overlay-source" value="Batto Multi-Chat"></label><label>OBS-Szene<input id="stream-overlay-scene" placeholder="Leer = aktuelle Szene"></label><div class="restored-actions"><button id="stream-overlay-install" class="primary">In OBS einrichten</button><button id="stream-overlay-remove">Aus OBS entfernen</button></div></article>
          </section>

          <section id="view-plugins" class="view">
            <div class="section-heading"><div><span class="eyebrow">02.08.2026 · CREATOR HUB · ELGATO</span><h2>Plugin-System</h2><p>Installierte Plugin-Manifeste und Icon-Packs werden aus den bekannten Creator-Hub-, Batto- und Stream-Deck-Verzeichnissen geladen.</p></div><button id="plugins-rescan" class="primary">Plugins neu scannen</button></div>
            <div id="plugin-summary-restored" class="restored-grid"></div>
            <article class="panel"><div class="info-banner">Das originale Touch-Deck vom 02.08.2026 besitzt zusätzlich seinen eigenen Plugin-Scan und Rechtsklick auf eine Taste. Drittanbieter-Stream-Deck-Pakete werden nur ausgeführt, wenn eine kompatible Laufzeit vorhanden ist; erkannte Pakete werden nicht als funktionierend vorgetäuscht.</div><div id="plugin-list-restored"><div class="empty-state">Plugins werden geladen …</div></div></article>
          </section>

          <section id="view-mobile" class="view">
            <div class="section-heading"><div><span class="eyebrow">WLAN · LAN · USB-TETHERING</span><h2>Handy verbinden</h2><p>Lokale Kopplung mit PIN und QR-Code. Keine Cloud-Verbindung erforderlich.</p></div><div class="button-row"><strong id="mobile-runtime-status" class="restored-status warn">Prüft …</strong><button id="mobile-start-restored">Server starten</button><button id="mobile-pin-new-restored">Neue PIN</button></div></div>
            <div class="restored-grid"><article class="restored-card"><h3>QR-Code</h3><img id="mobile-qr-restored" class="mobile-qr" alt="Batto Handy Kopplungs-QR" hidden><code id="mobile-url-restored">Noch keine Adresse</code></article><article class="restored-card"><h3>PIN</h3><strong id="mobile-pin-restored" class="mobile-pin">------</strong><label><input id="mobile-approval-restored" type="checkbox" checked> Kopplung am PC bestätigen</label><div id="mobile-addresses-restored" class="restored-actions"></div></article></div>
            <div class="two-column-cards"><article class="panel"><h3>Offene Kopplungsanfragen</h3><div id="mobile-pending-restored"></div></article><article class="panel"><h3>Verbundene Handys</h3><div id="mobile-connected-restored"></div></article></div>
          </section>

          `;
  if (!html.includes(settingsView)) throw new Error("Einstellungen-View fehlt.");
  html = html.replace(settingsView, restoredViews + settingsView);
}

const addonTag = '<script src="./eulerless-settings-addon.js"></script>';
const toolsTag = '<script src="./restored-tools.js"></script>';
if (!html.includes(addonTag)) {
  const commercialTag = '<script src="./commercial-settings.js"></script>';
  if (!html.includes(commercialTag)) throw new Error("commercial-settings.js muss vor dem Eulerless-Addon eingebunden sein.");
  html = html.replace(commercialTag, `${commercialTag}\n  ${addonTag}`);
}
if (!html.includes(toolsTag)) html = html.replace('</body>', `  ${toolsTag}\n  </body>`);

for (const forbidden of ["Hardwarediagnose", "Encoder- und Hardware-Monitoring", "CPU-Belastungstest", './assets/bg.jpg']) {
  if (html.includes(forbidden)) throw new Error(`Entfernte Alt-Funktion wieder im Produktions-Renderer gefunden: ${forbidden}`);
}
for (const required of ["view-stream-overlay", "view-plugins", "view-mobile", "multi-chat-dashboard.svg", "view-deck-0802", "view-moderation", "view-cohost", "view-holo"]) {
  if (!html.includes(required)) throw new Error(`Vollständiger 2.1-Bereich fehlt: ${required}`);
}

fs.writeFileSync(htmlFile, html, "utf8");
console.log("Vollständige Batto-UI wiederhergestellt: Stream-Overlay, Plugins, Mobile; Hardwarediagnose bleibt entfernt.");
