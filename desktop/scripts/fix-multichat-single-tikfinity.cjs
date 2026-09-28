"use strict";

const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "renderer", "multi-chat.js");
let source = fs.readFileSync(file, "utf8");

source = source.replace(
  'root.querySelector("#tikfinity-connect").onclick = () => connectTikfinity(true);',
  'root.querySelector("#tikfinity-connect").onclick = () => void connectTikfinityBackend(true);'
);
source = source.replace(
  'root.querySelector("#tikfinity-disconnect").onclick = () => disconnectTikfinity(false);',
  'root.querySelector("#tikfinity-disconnect").onclick = () => void disconnectTikfinityBackend();'
);
source = source.replace(
  'api.chatConnect("tiktok", { username:val("cfg-tiktok-user") })',
  'api.chatConnect("tiktok", { username:val("cfg-tiktok-user"), directOnly:true })'
);

// Twitch im normalen Multi-Chat bewusst einfach halten: kein sichtbares Tokenfeld,
// kein doppeltes Usernamefeld und Twitch-URL oder Kanalname gleichermaßen akzeptieren.
source = source.replace(
  '<div class="settings-section"><h3>Twitch</h3><label>Kanal<input id="cfg-twitch-channel" placeholder="dein_channel"></label><label>OAuth-Token<input id="cfg-twitch-token" type="password" placeholder="oauth-…"></label><label>Username<input id="cfg-twitch-user" placeholder="batto_reader"></label><button id="cfg-twitch-connect">Twitch verbinden</button></div>',
  '<div class="settings-section"><h3>Twitch</h3><label>Kanal oder Twitch-Link<input id="cfg-twitch-channel" placeholder="crazy_batto oder https://www.twitch.tv/crazy_batto"></label><button id="cfg-twitch-connect">Twitch verbinden</button><small>Kein OAuth-Token im Multi-Chat. Vorhandene Twitch-Anmeldedaten werden intern verwendet.</small></div>'
);

if (!source.includes('function normalizeTwitchChannel')) {
  source = source.replace(
    '  const val = (id) => root.querySelector(`#${id}`)?.value?.trim?.() || "";\n',
    '  const val = (id) => root.querySelector(`#${id}`)?.value?.trim?.() || "";\n  function normalizeTwitchChannel(value) {\n    let text = String(value || "").trim();\n    if (!text) return "";\n    try {\n      if (/^https?:\\/\\//i.test(text)) {\n        const url = new URL(text);\n        if (/^(?:www\\.)?twitch\\.tv$/i.test(url.hostname)) text = url.pathname.split("/").filter(Boolean)[0] || "";\n      }\n    } catch {}\n    return text.replace(/^#/, "").replace(/^@/, "").replace(/^\\/+|\\/+$/g, "").toLowerCase();\n  }\n'
  );
}

source = source.replace(
  'root.querySelector("#cfg-twitch-connect").onclick = () => connectPlatform("twitch", { channel:val("cfg-twitch-channel"), token:val("cfg-twitch-token"), username:val("cfg-twitch-user") });',
  'root.querySelector("#cfg-twitch-connect").onclick = () => connectPlatform("twitch", { channel:normalizeTwitchChannel(val("cfg-twitch-channel")) });'
);

const transportBlock = /  function scheduleTikfinityRetry\(\) \{[\s\S]*?\n  function bindListeners\(\) \{/;
if (transportBlock.test(source)) {
  source = source.replace(transportBlock, `  async function connectTikfinityBackend(manual = false) {
    updateTikfinityState("Verbinde …");
    try {
      const status = await api.chatConnect("tiktok", { tikfinityUrl:TIKFINITY_URL, directFallback:false });
      if (status?.connected && status?.source === "tikfinity") {
        updateTikfinityState("Verbunden");
        setStatus("TikFinity lokal verbunden");
      } else {
        updateTikfinityState("Nicht erreichbar");
        if (manual) setStatus("TikFinity Desktop ist lokal nicht erreichbar. Batto versucht die Verbindung im Hintergrund erneut.", true);
      }
      await refreshSettings();
      return status;
    } catch (error) {
      updateTikfinityState("Nicht erreichbar");
      if (manual) setStatus(\`TikFinity: \${error?.message || error}\`, true);
      return null;
    }
  }

  async function disconnectTikfinityBackend() {
    try { await api.chatDisconnect("tiktok"); } catch {}
    updateTikfinityState("Getrennt");
    await refreshSettings();
  }

  function bindListeners() {`);
}

source = source.replace('    connectTikfinity(false);', '    await connectTikfinityBackend(false);');
source = source.replace(/\n  window\.addEventListener\("beforeunload", \(\) => \{ clearTimeout\(tikfinityRetry\); try \{ tikfinity\?\.close\(\); \} catch \{\} \}\);/, "");
source = source.replace('  let tikfinity = null;\n  let tikfinityRetry = null;\n', '');

if (source.includes('new WebSocket(TIKFINITY_URL)')) throw new Error("Renderer öffnet weiterhin einen eigenen TikFinity-WebSocket.");
if (!source.includes('connectTikfinityBackend')) throw new Error("Backend-TikFinity-Verbindung wurde nicht eingebaut.");
if (!source.includes('directFallback:false')) throw new Error("TikFinity-Button ist nicht auf den lokalen Backend-Transport festgelegt.");
if (!source.includes('directOnly:true')) throw new Error("Der explizite TikTok-Direkt-Button ist nicht als Direktverbindung markiert.");
if (source.includes('id="cfg-twitch-token"') || source.includes('id="cfg-twitch-user"')) throw new Error("Alte Twitch-Token-/Username-Felder sind noch im Multi-Chat sichtbar.");
if (!source.includes('normalizeTwitchChannel')) throw new Error("Twitch-Kanalnormalisierung fehlt.");

fs.writeFileSync(file, source, "utf8");
console.log("Multi-Chat: TikFinity besitzt genau einen Backend-Transport; Twitch-UI ist tokenfrei und akzeptiert Kanalname oder Twitch-Link.");
