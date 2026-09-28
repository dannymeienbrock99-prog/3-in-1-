"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function patch(relative, replacements) {
  const file = path.join(root, relative);
  let content = fs.readFileSync(file, "utf8");
  for (const [search, replacement] of replacements) {
    if (!content.includes(search)) throw new Error(`Patchpunkt fehlt in ${relative}: ${search}`);
    content = content.replace(search, replacement);
  }
  fs.writeFileSync(file, content, "utf8");
}

patch("src/services/deck-manager-v2.cjs", [
  [
    'if (!profile || !folderId || folderId === "root") return profile ? { ...profile, id: "root", parentId: null } : null;',
    'if (!profile || !folderId || folderId === "root") return profile || null;'
  ],
  [
    'const folder = normalizeFolder({ id: safeId("folder"), name: payload.name || "Neuer Ordner", parentId: parent.id === "root" ? "root" : parent.id }, profile);',
    'const folder = normalizeFolder({ id: safeId("folder"), name: payload.name || "Neuer Ordner", parentId: !payload.parentId || payload.parentId === "root" ? "root" : parent.id }, profile);'
  ]
]);

patch("src/preload.cjs", [
  [
    '  "app:close",',
    '  "app:close",\n  "app:copyText",'
  ]
]);

patch("src/main.cjs", [
  [
    '  handle("app:close", async () => { app.quit(); return true; });',
    '  handle("app:close", async () => { app.quit(); return true; });\n  handle("app:copyText", async (payload) => { clipboard.writeText(String(payload.text || "")); return true; });'
  ]
]);

patch("src/renderer/app.js", [
  [
    '$("copy-local-chat-url").addEventListener("click", async () => { await navigator.clipboard.writeText($("local-chat-url").value); toast("Webhook-Adresse kopiert."); });',
    '$("copy-local-chat-url").addEventListener("click", () => invoke("app:copyText", { text: $("local-chat-url").value }, "Webhook-Adresse kopiert."));'
  ]
]);

console.log("Batto OBS Tool 2.0.0: Laufzeit-Patches angewendet.");
