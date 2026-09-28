"use strict";

(() => {
  const api = window.batto;
  const root = document.getElementById("multi-chat-root");
  if (!api || !root) return;
  if (root.dataset.initialized === "1") return;
  root.dataset.initialized = "1";

  const META = {
    all: ["Alle", "#5aa7ff", "✦"],
    twitch: ["Twitch", "#9146ff", "◉"],
    cng: ["CNG", "#2f9cff", "◆"],
    tiktok: ["TikTok", "#25f4ee", "♪"],
    youtube: ["YouTube", "#ff3030", "▶"]
  };
  const TIKFINITY_URL = "ws://127.0.0.1:21213/";
  const MOD_KEY = "batto-moderation-v1";

  let filter = "all";
  let messages = [];
  let tikfinity = null;
  let tikfinityRetry = null;
  let tikfinityState = "Getrennt";
  let listenersBound = false;
  let ttsConfig = { enabled:false, language:"de-DE", rate:1, pitch:1, volume:1, cooldownMs:1200, maxQueue:20, maxCommentLength:220, chat:true, announcePlatforms:["twitch","cng","tiktok","youtube"], blockUsers:[], allowUsers:[] };
  const ttsQueue = [];
  let ttsRunning = false;
  let lastTts = 0;

  const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const cleanUser = (value) => String(value || "").trim().replace(/^@/, "").slice(0, 80);
  const val = (id) => root.querySelector(`#${id}`)?.value?.trim?.() || "";

  function isSuppressed(platform, username) {
    try {
      const mod = JSON.parse(localStorage.getItem(MOD_KEY) || "{}");
      const p = mod?.[platform] || {};
      const name = cleanUser(username).toLowerCase();
      return [...(p.muted || []), ...(p.blocked || [])].some((x) => cleanUser(x?.username).toLowerCase() === name);
    } catch { return false; }
  }

  function normalizeMessage(input = {}, fallbackPlatform = "tiktok") {
    const platform = String(input.platform || fallbackPlatform).toLowerCase();
    const username = cleanUser(input.username || input.uniqueId || input.nickname || input.displayName || input.userId || "TikTok User");
    const message = String(input.message || input.comment || input.text || "").trim();
    if (!message || !username || isSuppressed(platform, username)) return null;
    return {
      id: input.id || `${platform}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      platform,
      username,
      message,
      role: input.role || "",
      color: input.color || META[platform]?.[1] || "#5aa7ff",
      timestamp: input.timestamp || Date.now(),
      source: input.source || "platform"
    };
  }

  function accept(input, fallbackPlatform) {
    const items = Array.isArray(input) ? input : [input];
    let changed = false;
    for (const item of items) {
      const msg = normalizeMessage(item, fallbackPlatform);
      if (!msg) continue;
      if (messages.some((x) => x.id === msg.id)) continue;
      messages.push(msg);
      changed = true;
      speak(msg);
    }
    if (messages.length > 500) messages = messages.slice(-500);
    if (changed) updateBody();
  }

  function settingsHtml() {
    return `<div class="settings-section"><h3>Verbindungen</h3><div class="status-grid" id="chat-status-grid"></div></div>
      <div class="settings-section"><h3>TikFinity lokal</h3><div class="status-card"><strong>TikTok ohne Euler im Batto-UI</strong><small><span class="dot ${tikfinityState === "Verbunden" ? "on" : ""}"></span><span id="tikfinity-state">${esc(tikfinityState)}</span></small></div><small>${TIKFINITY_URL} · TikFinity Desktop muss laufen und mit dem LIVE verbunden sein.</small><div class="settings-actions"><button id="tikfinity-connect">Verbinden</button><button id="tikfinity-disconnect">Trennen</button></div></div>
      <div class="settings-section"><h3>Twitch</h3><label>Kanal oder Twitch-Link<input id="cfg-twitch-channel" placeholder="crazy_batto oder https://www.twitch.tv/crazy_batto"></label><button id="cfg-twitch-connect">Twitch verbinden</button><small>Kein OAuth-Token im Multi-Chat. Vorhandene Twitch-Anmeldedaten werden intern verwendet.</small></div>
      <div class="settings-section"><h3>CNG</h3><label>Persönliche Chat-URL<input id="cfg-cng-chat" placeholder="https://cng-plattform.com/chat-popout/…"></label><label>Persönliche Alert-URL<input id="cfg-cng-alert" placeholder="https://cng-plattform.com/alert-overlay…"></label><div class="settings-actions"><button id="cfg-cng-save">Speichern</button><button id="cfg-cng-connect">Verbinden</button></div></div>
      <div class="settings-section"><h3>TikTok direkt</h3><label>LIVE-Username<input id="cfg-tiktok-user" placeholder="@username"></label><button id="cfg-tiktok-connect">Direkt verbinden</button><small>Ist der Account nicht LIVE, wird nur „Offline“ angezeigt.</small></div>
      <div class="settings-section"><h3>YouTube</h3><label>Live-Chat-/Video-ID<input id="cfg-youtube-video" placeholder="Live-ID"></label><button id="cfg-youtube-connect">YouTube verbinden</button></div>
      <div class="settings-section"><h3>Batto TTS</h3><label><input id="tts-enabled" type="checkbox"> Chat-TTS aktiv</label><label>Sprache<select id="tts-language"><option>de-DE</option><option>en-US</option><option>en-GB</option><option>es-ES</option></select></label><label>Geschwindigkeit<input id="tts-rate" type="range" min="0.5" max="2" step="0.05" value="1"></label><label>Lautstärke<input id="tts-volume" type="range" min="0" max="1" step="0.05" value="1"></label></div>
      <div class="settings-actions"><button id="chat-clear">Chat leeren</button><button id="chat-settings-close">Schließen</button></div>`;
  }

  function render() {
    root.innerHTML = `<div class="multi-chat">
      <header class="chat-head"><div class="chat-title"><span>✦</span><div><strong>BATTO MULTI-CHAT</strong><small>Twitch · CNG · TikTok · YouTube</small></div></div><div class="chat-actions"><button class="icon-btn" id="chat-settings-btn">⚙</button><button class="icon-btn" id="chat-undock-btn">↗</button></div></header>
      <nav class="chat-tabs">${Object.entries(META).map(([key,v]) => `<button class="chat-tab ${filter === key ? "active" : ""}" data-filter="${key}" ${key !== "all" ? `data-platform="${key}"` : ""}>${v[0]}</button>`).join("")}</nav>
      <section class="chat-body" id="chat-body"></section>
      <footer class="chat-footer"><span id="chat-status">● Initialisiere …</span><span id="chat-count">0 Nachrichten</span></footer>
      <aside class="chat-settings" id="chat-settings" hidden>${settingsHtml()}</aside>
    </div>`;
    bindUi();
    updateBody();
  }

  function setStatus(text, error = false) {
    const el = root.querySelector("#chat-status");
    if (!el) return;
    el.textContent = `● ${text}`;
    el.dataset.error = error ? "1" : "0";
  }

  function updateBody() {
    const body = root.querySelector("#chat-body");
    if (!body) return;
    const visible = messages.filter((m) => filter === "all" || m.platform === filter).slice(-300);
    const count = root.querySelector("#chat-count");
    if (count) count.textContent = `${visible.length} Nachrichten`;
    if (!visible.length) {
      body.innerHTML = '<div class="chat-empty"><div><strong>Noch keine Nachrichten</strong><br><small>TikFinity wird lokal automatisch gesucht. Twitch, CNG und YouTube können zusätzlich verbunden werden.</small></div></div>';
      return;
    }
    body.innerHTML = visible.map((m) => {
      const meta = META[m.platform] || META.all;
      return `<div class="chat-row" data-platform="${esc(m.platform)}"><span class="platform-badge" style="background:${esc(m.color || meta[1])}">${meta[2]}</span><div><div class="chat-meta"><span class="chat-user" style="color:${esc(m.color || meta[1])}">${esc(m.username)}</span><span class="chat-role">${esc(meta[0])}</span>${m.role ? `<span class="chat-role">${esc(m.role)}</span>` : ""}${m.source === "tikfinity" ? '<span class="chat-role">TikFinity</span>' : ""}</div><div class="chat-message">${esc(m.message)}</div></div></div>`;
    }).join("");
    body.scrollTop = body.scrollHeight;
  }

  function bindUi() {
    root.querySelectorAll("[data-filter]").forEach((button) => button.onclick = () => { filter = button.dataset.filter; render(); });
    root.querySelector("#chat-settings-btn").onclick = () => { const panel = root.querySelector("#chat-settings"); panel.hidden = !panel.hidden; if (!panel.hidden) void refreshSettings(); };
    root.querySelector("#chat-settings-close").onclick = () => root.querySelector("#chat-settings").hidden = true;
    root.querySelector("#chat-undock-btn").onclick = () => api.chatToggleWindow().catch((e) => setStatus(e.message, true));
    root.querySelector("#chat-clear").onclick = async () => { try { if (filter !== "tiktok") await api.chatClear(filter); messages = filter === "all" ? [] : messages.filter((m) => m.platform !== filter); updateBody(); } catch (e) { setStatus(e.message, true); } };
    root.querySelector("#tikfinity-connect").onclick = () => void connectTikfinityBackend(true);
    root.querySelector("#tikfinity-disconnect").onclick = () => void disconnectTikfinityBackend();
    root.querySelector("#cfg-twitch-connect").onclick = () => connectPlatform("twitch", { channel:normalizeTwitchChannel(val("cfg-twitch-channel")) });
    root.querySelector("#cfg-cng-save").onclick = async () => { try { await api.saveCngConfig({ chat:{url:val("cfg-cng-chat")}, alerts:{url:val("cfg-cng-alert")} }); setStatus("CNG gespeichert"); } catch (e) { setStatus(e.message, true); } };
    root.querySelector("#cfg-cng-connect").onclick = async () => { try { await api.chatConnect("cng", await api.getCngConfig()); setStatus("CNG verbunden"); await refreshSettings(); } catch (e) { setStatus(e.message, true); } };
    root.querySelector("#cfg-tiktok-connect").onclick = async () => { try { const status = await api.chatConnect("tiktok", { username:val("cfg-tiktok-user"), directOnly:true }); setStatus(status?.offline ? "TikTok offline · nicht LIVE" : "TikTok direkt verbunden"); await refreshSettings(); } catch (e) { setStatus(e.message, true); } };
    root.querySelector("#cfg-youtube-connect").onclick = () => connectPlatform("youtube", { videoId:val("cfg-youtube-video"), liveChatId:val("cfg-youtube-video") });
    root.querySelector("#tts-enabled").onchange = () => void saveTts();
    ["tts-language","tts-rate","tts-volume"].forEach((id) => root.querySelector(`#${id}`).onchange = () => void saveTts());
  }

  async function connectPlatform(platform, config) {
    try { await api.chatConnect(platform, config); setStatus(`${META[platform]?.[0] || platform}: verbunden`); await refreshSettings(); }
    catch (e) { setStatus(`${META[platform]?.[0] || platform}: ${e.message || e}`, true); }
  }

  async function refreshSettings() {
    try {
      const statuses = await api.chatStatuses();
      const grid = root.querySelector("#chat-status-grid");
      if (grid) {
        const cards = Object.entries(statuses || {}).map(([p,s]) => `<div class="status-card"><strong>${esc(META[p]?.[0] || p)}</strong><small><span class="dot ${s.connected ? "on" : ""}"></span>${s.connected ? "Verbunden" : s.offline ? "Offline" : "Getrennt"}</small></div>`);
        cards.unshift(`<div class="status-card"><strong>TikFinity</strong><small><span class="dot ${tikfinityState === "Verbunden" ? "on" : ""}"></span>${esc(tikfinityState)}</small></div>`);
        grid.innerHTML = cards.join("");
      }
      const cng = await api.getCngConfig();
      if (root.querySelector("#cfg-cng-chat")) root.querySelector("#cfg-cng-chat").value = cng?.chat?.url || "";
      if (root.querySelector("#cfg-cng-alert")) root.querySelector("#cfg-cng-alert").value = cng?.alerts?.url || "";
      const tts = await api.getTtsConfig();
      if (tts) ttsConfig = { ...ttsConfig, ...tts };
      if (root.querySelector("#tts-enabled")) root.querySelector("#tts-enabled").checked = !!ttsConfig.enabled;
      if (root.querySelector("#tts-language")) root.querySelector("#tts-language").value = ttsConfig.language || "de-DE";
      if (root.querySelector("#tts-rate")) root.querySelector("#tts-rate").value = ttsConfig.rate || 1;
      if (root.querySelector("#tts-volume")) root.querySelector("#tts-volume").value = ttsConfig.volume ?? 1;
    } catch (e) { setStatus(e.message || "Chat-Einstellungen nicht verfügbar", true); }
  }

  async function saveTts() {
    try {
      ttsConfig = await api.saveTtsConfig({ ...ttsConfig, enabled:root.querySelector("#tts-enabled").checked, language:val("tts-language"), rate:Number(root.querySelector("#tts-rate").value), volume:Number(root.querySelector("#tts-volume").value) });
    } catch (e) { setStatus(e.message, true); }
  }

  function pick(obj, keys) {
    for (const key of keys) if (obj?.[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
    return "";
  }

  function handleTikfinity(raw) {
    let packet;
    try { packet = JSON.parse(String(raw)); } catch { return; }
    const event = String(packet.event || packet.type || packet.eventType || "").toLowerCase();
    const data = packet.data || packet.payload || packet;
    if (!event.includes("chat") && !event.includes("comment")) return;
    const username = pick(data, ["uniqueId","username","nickname","displayName","userId"]);
    const message = pick(data, ["comment","message","text"]);
    accept({ platform:"tiktok", username, message, source:"tikfinity", id:pick(data,["msgId","messageId","id"]) || undefined }, "tiktok");
  }

  function updateTikfinityState(text) {
    tikfinityState = text;
    const el = root.querySelector("#tikfinity-state");
    if (el) el.textContent = text;
  }

  async function connectTikfinityBackend(manual = false) {
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
      if (manual) setStatus(`TikFinity: ${error?.message || error}`, true);
      return null;
    }
  }

  async function disconnectTikfinityBackend() {
    try { await api.chatDisconnect("tiktok"); } catch {}
    updateTikfinityState("Getrennt");
    await refreshSettings();
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    api.onChatMessages((batch) => accept(batch));
    api.onChatStatus((status) => {
      const name = META[status?.platform]?.[0] || status?.platform || "Chat";
      if (status?.error) setStatus(`${name}: ${status.error}`, true);
      else if (status?.offline) setStatus(`${name}: offline · nicht LIVE`);
      else if (status?.connected) setStatus(`${name}: verbunden`);
      if (!root.querySelector("#chat-settings")?.hidden) void refreshSettings();
    });
    api.onChatWindow((state) => { const button = root.querySelector("#chat-undock-btn"); if (button) button.textContent = state?.undocked ? "↙" : "↗"; });
    window.addEventListener("batto:external-chat", (event) => accept(event.detail));
  }

  async function init() {
    render();
    bindListeners();
    try {
      const history = await api.chatHistory({ limit:300 });
      messages = Array.isArray(history) ? history.map((m) => normalizeMessage(m)).filter(Boolean) : [];
      updateBody();
      setStatus("Chat bereit");
    } catch (e) {
      setStatus(`Chat-Backend: ${e.message || e}`, true);
    }
    try { ttsConfig = { ...ttsConfig, ...(await api.getTtsConfig()) }; } catch {}
    await connectTikfinityBackend(false);
  }

  void init();
})();
