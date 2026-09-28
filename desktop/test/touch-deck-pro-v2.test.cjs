"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-pro-v2.js"), "utf8");
const css = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-pro-v2.css"), "utf8");
const creatorScript = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-creatorhub.js"), "utf8");
const creatorCss = fs.readFileSync(path.join(root, "bootstrap-2.0/src/renderer/touch-deck-creatorhub.css"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts/prepare-touch-deck-pro-v2.cjs"), "utf8");
const deckBootstrap = fs.readFileSync(path.join(root, "src/deck-bootstrap.cjs"), "utf8");
const pluginRegistry = fs.readFileSync(path.join(root, "bootstrap-2.0/src/services/plugin-registry.cjs"), "utf8");
const deckStore = fs.readFileSync(path.join(root, "bootstrap-2.0/src/services/deck-store.cjs"), "utf8");

test("Touch-Deck-Pro-V2 JavaScript ist syntaktisch gültig", () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotThrow(() => new vm.Script(creatorScript));
});

test("Touch-Deck Pro kombiniert Pluginleiste, Deck und Inspector", () => {
  for (const marker of [
    "tdp-library", "tdp-search", "tdp-tab-actions", "tdp-tab-plugins",
    "tdp-grid", "tdp-inspector", "tdp-action-type", "tdp-save-key"
  ]) assert.match(script, new RegExp(marker));
  assert.match(css, /grid-template-columns:\s*minmax\(260px, 315px\)\s+minmax\(430px, 1fr\)\s+minmax\(300px, 340px\)/);
});

test("Pluginaktionen können angeklickt und per Drag-and-drop zugewiesen werden", () => {
  assert.match(script, /application\/x-batto-touch-deck-action/);
  assert.match(script, /addLibraryAction/);
  assert.match(script, /dataTransfer\.setData\(actionTransferType/);
  assert.match(script, /dataTransfer\.getData\(actionTransferType/);
});

test("Leere Tasten bleiben ohne sichtbare Standardbeschriftung", () => {
  assert.match(script, /if \(used\) \{/);
  assert.doesNotMatch(script, /button\.title \|\| \(button\.folderId \? "Ordner" : `Taste \$\{index \+ 1\}`\)/);
  assert.match(script, /Unbelegte Taste \$\{index \+ 1\}/);
});

test("Rasteränderungen bewahren verdeckte Belegungen", () => {
  assert.match(script, /slice\(newCapacity\)\.filter\(isUsed\)/);
  assert.match(script, /nur ausgeblendet, aber nicht gelöscht/);
  assert.match(script, /deck:update-folder/);
});

test("Produktionsvorbereitung lädt V2-Deck und 1.8.6-Präsentation", () => {
  for (const file of [
    "touch-deck-pro-v2.css", "touch-deck-pro-v2.js",
    "touch-deck-creatorhub.css", "touch-deck-creatorhub.js"
  ]) assert.match(prepare, new RegExp(file.replaceAll(".", "\\.")));
});

test("1.8.6 Touch-Deck startet mit 5x3 Raster und bewusster Bearbeitung", () => {
  for (const marker of [
    "PROFILE · ORDNER · PLUGIN-AKTIONEN",
    "Touch-Deck",
    "Tasten frei belegen",
    "Tasten belegen",
    "Vollbild",
    "creatorhub-editing",
    "deck:execute-button"
  ]) assert.match(creatorScript, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(creatorScript, /creatorhub-audio/);
  assert.match(creatorCss, /132px/);
  assert.match(creatorCss, /creatorhub-deck:not\(\.creatorhub-editing\)/);
  assert.match(deckStore, /rows:\s*3,\s*columns:\s*5/);
  assert.match(deckStore, /name:\s*"Standard"/);
  assert.match(deckStore, /name:\s*"Hauptseite"/);
});

test("Creator-Hub- und Elgato-Pluginpfade bleiben als Importquelle erhalten", () => {
  assert.match(pluginRegistry, /"Creator Hub", "Plugins"/);
  assert.match(pluginRegistry, /"Elgato", "StreamDeck", "Plugins"/);
  assert.match(pluginRegistry, /"Creator Hub", "IconPacks"/);
  assert.match(pluginRegistry, /"Elgato", "StreamDeck", "IconPacks"/);
});

test("Touch-Deck bietet nur Aktionen an, die Batto 2.1 wirklich ausführen kann", () => {
  assert.match(deckBootstrap, /SUPPORTED_ACTION_TYPES/);
  for (const action of [
    "obs.scene", "obs.source.toggle", "obs.stream.toggle", "obs.record.toggle",
    "system.launch", "system.url", "system.hotkey",
    "media.playpause", "media.next", "media.previous", "media.mute",
    "youtube.dashboard", "tiktok.live-studio.launch", "discord.launch", "obsbot.center"
  ]) assert.match(deckBootstrap, new RegExp(action.replaceAll(".", "\\.")));
  assert.match(deckBootstrap, /if \(!plugin\.native\)/);
  assert.match(deckBootstrap, /plugin\.actions = \[\]/);
  assert.match(deckBootstrap, /SUPPORTED_ACTION_TYPES\.has/);
});
