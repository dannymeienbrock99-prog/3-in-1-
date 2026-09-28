"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function patch(relative, search, replacement) {
  const file = path.join(root, relative);
  let content = fs.readFileSync(file, "utf8");
  if (!content.includes(search)) throw new Error(`Overlay-Kompatibilitäts-Patchpunkt fehlt in ${relative}`);
  content = content.replace(search, replacement);
  fs.writeFileSync(file, content, "utf8");
}

patch(
  "src/stream-overlay/editor.html",
  '      <button data-add="coHost"><strong>Co-Host</strong><small>Gäste und Status</small></button>\n      <button data-add="heartRate"><strong>Herzfrequenz</strong><small>Pulsoid oder lokaler Sensor</small></button>',
  '      <button data-add="coHost"><strong>Co-Host</strong><small>Gäste und Status</small></button>\n      <button data-add="treasure"><strong>Schatztruhe</strong><small>Truhen-Ereignisse</small></button>\n      <button data-add="portal"><strong>Portal</strong><small>Portal-Ereignisse</small></button>\n      <button data-add="tiktokEvent"><strong>TikTok-Ereignis</strong><small>Beliebiges lokales LIVE-Ereignis</small></button>\n      <button data-add="heartRate"><strong>Herzfrequenz</strong><small>Pulsoid oder lokaler Sensor</small></button>'
);

patch(
  "src/stream-overlay/editor.js",
  '    coHost: { title: "Co-Host", width: 420, height: 170, fontSize: 26, accent: "#55d6ff" },\n    heartRate:',
  '    coHost: { title: "Co-Host", width: 420, height: 170, fontSize: 26, accent: "#55d6ff" },\n    treasure: { title: "Schatztruhe", text: "Truhe bereit", width: 420, height: 210, fontSize: 31, accent: "#ffd166" },\n    portal: { title: "Portal", text: "Portal bereit", width: 420, height: 210, fontSize: 31, accent: "#8d5cff" },\n    tiktokEvent: { title: "TikTok-Ereignis", text: "LIVE-Ereignis", width: 440, height: 170, fontSize: 30, accent: "#55d6ff" },\n    heartRate:'
);

patch(
  "src/stream-overlay/overlay.js",
  '      if (["text", "portal", "treasure"].includes(type) && itemType.toLowerCase() === type) { const target = item.node.querySelector(\'[data-role="value"]\'); if (target) target.textContent = event.text || formatNumber(event.value); }',
  '      if (["text", "portal", "treasure", "tiktokevent"].includes(type) && itemType.toLowerCase() === type) { const target = item.node.querySelector(\'[data-role="value"]\'); if (target) target.textContent = event.text || formatNumber(event.value); }'
);

console.log("Batto OBS Tool 2.0.0: Schatztruhe, Portal und TikTok-Ereignisse im Stream-Overlay wiederhergestellt.");
