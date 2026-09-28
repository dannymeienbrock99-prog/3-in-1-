"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "src", "renderer", "restored-tools.js");
let source = fs.readFileSync(file, "utf8");

if (source.includes("BATTO_PLUGIN_TRUTHFUL_STATUS")) {
  console.log("Plugin-Anzeige bereits korrigiert.");
  process.exit(0);
}

const summaryOld = '$("plugin-summary-restored").innerHTML = `<article class="restored-card"><h3>Plugins</h3><strong>${plugins.length}</strong><small>${native} native · ${external} erkannt</small></article><article class="restored-card"><h3>Icon-Packs</h3><strong>${Array.isArray(snapshot.iconPacks) ? snapshot.iconPacks.length : 0}</strong><small>Creator Hub / Elgato / Batto</small></article><article class="restored-card"><h3>Quelle</h3><strong>02.08.2026 kompatibel</strong><small>Installierte Manifest-Pakete werden erkannt.</small></article>`;';
const summaryNew = '// BATTO_PLUGIN_TRUTHFUL_STATUS\n    $("plugin-summary-restored").innerHTML = `<article class="restored-card"><h3>Plugins</h3><strong>${plugins.length}</strong><small>${native} Batto-nativ · ${external} extern erkannt</small></article><article class="restored-card"><h3>Icon-Packs</h3><strong>${Array.isArray(snapshot.iconPacks) ? snapshot.iconPacks.length : 0}</strong><small>Creator Hub / Elgato / Batto</small></article><article class="restored-card"><h3>Touch-Deck 02.08.2026</h3><button id="plugin-open-touchdeck" class="primary">Touch-Deck öffnen</button><small>Plugins werden dort per Rechtsklick → „Plugin laden…“ einer Taste zugeordnet.</small></article>`;\n    $("plugin-open-touchdeck")?.addEventListener("click", async () => { try { await window.batto.invoke("deck:open-original-0802"); } catch (e) { toast(e?.message || e); } });';
if (!source.includes(summaryOld)) throw new Error("Plugin-Patch: Zusammenfassung nicht gefunden.");
source = source.replace(summaryOld, summaryNew);

const rowOld = 'return `<article class="plugin-entry" data-plugin-id="${escapeHtml(plugin.id)}"><div><strong>${escapeHtml(plugin.name || plugin.id)}</strong><small>${escapeHtml(plugin.description || plugin.status || "")}</small><div class="plugin-badges"><span>${plugin.native ? "Batto nativ" : "Extern erkannt"}</span><span>${actions.length} Aktionen</span>${plugin.version ? `<span>v${escapeHtml(plugin.version)}</span>` : ""}</div></div><label><input class="plugin-toggle" type="checkbox" ${plugin.enabled !== false ? "checked" : ""}> aktiv</label></article>`;';
const rowNew = 'const runtimeReady = plugin.native === true;\n      const state = runtimeReady ? `<label><input class="plugin-toggle" type="checkbox" ${plugin.enabled !== false ? "checked" : ""}> aktiv</label>` : `<strong class="restored-status warn">nur erkannt</strong>`;\n      const actionLabel = runtimeReady ? `${actions.length} ausführbare Aktionen` : `${actions.length} Manifest-Aktionen · Laufzeit nicht bestätigt`;\n      return `<article class="plugin-entry" data-plugin-id="${escapeHtml(plugin.id)}"><div><strong>${escapeHtml(plugin.name || plugin.id)}</strong><small>${escapeHtml(plugin.description || plugin.status || "")}</small><div class="plugin-badges"><span>${runtimeReady ? "Batto nativ" : "Externes Manifest"}</span><span>${actionLabel}</span>${plugin.version ? `<span>v${escapeHtml(plugin.version)}</span>` : ""}</div></div>${state}</article>`;';
if (!source.includes(rowOld)) throw new Error("Plugin-Patch: Plugin-Zeile nicht gefunden.");
source = source.replace(rowOld, rowNew);

fs.writeFileSync(file, source, "utf8");
console.log("Plugin-Anzeige korrigiert: externe Manifeste werden nicht mehr als aktiv/funktionierend dargestellt.");
