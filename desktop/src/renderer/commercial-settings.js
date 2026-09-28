"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const view = $("view-settings");
  if (!view || !window.batto?.getState || !window.batto?.saveSettings) return;

  const toggle = (id, title, hint = "") => `<label class="cs-toggle"><input id="${id}" type="checkbox"><span><strong>${title}</strong>${hint ? `<small>${hint}</small>` : ""}</span></label>`;
  const statusLine = (id, label) => `<div class="cs-status-line"><span>${label}</span><strong id="${id}">–</strong></div>`;

  view.innerHTML = `
    <div class="section-heading cs-heading">
      <div><span class="eyebrow">BATTO OBS TOOL 2.1.0</span><h2>Produkt-Einstellungen</h2><p>OBS als Produktionskern, TikTok LIVE Studio für TikTok-spezifische Funktionen und getrennte APIs für Chat, Events und Moderation.</p></div>
      <div class="button-row"><span id="cs-save-state" class="inline-message"></span><button id="cs-health" type="button">Systemcheck</button><button id="cs-save" class="primary" type="button">Alles speichern</button></div>
    </div>
    <div class="cs-layout">
      <nav class="cs-tabs" aria-label="Einstellungskategorien">
        <button class="active" data-cs-tab="general">Allgemein</button>
        <button data-cs-tab="obs">OBS Studio</button>
        <button data-cs-tab="tiktok-studio">TikTok LIVE Studio</button>
        <button data-cs-tab="tiktok-api">TikTok LIVE API</button>
        <button data-cs-tab="twitch">Twitch</button>
        <button data-cs-tab="youtube">YouTube</button>
        <button data-cs-tab="cng">CNG</button>
        <button data-cs-tab="chat">Multi-Chat</button>
        <button data-cs-tab="moderation">Moderation</button>
        <button data-cs-tab="overlays">Overlays</button>
        <button data-cs-tab="status">Systemstatus</button>
      </nav>
      <div class="cs-content">
        <section class="cs-page active" data-cs-page="general"><article class="panel form-panel"><h3>Allgemein</h3>
          <label>Sprache<select id="cs-language"><option value="de-DE">Deutsch</option><option value="en-US">English</option></select></label>
          <label>Standardplattform<select id="cs-platform"><option value="tiktok">TikTok</option><option value="twitch">Twitch</option><option value="youtube">YouTube</option><option value="cng">CNG</option><option value="recording">Lokale Aufnahme</option><option value="custom">Eigene Plattform</option></select></label>
          <label>Zielauflösung<select id="cs-resolution"><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option><option value="3840x2160">3840 × 2160</option></select></label>
          <label>FPS<select id="cs-fps"><option value="30">30</option><option value="60">60</option><option value="120">120</option></select></label>
          ${toggle("cs-updates", "Nach Updates suchen")}
          ${toggle("cs-diagnostics", "Diagnosefunktionen aktivieren")}
          ${toggle("cs-launch-health", "Systemcheck beim Start vorbereiten", "Fehlende Plattformzugänge dürfen den Programmstart nicht blockieren.")}
        </article></section>

        <section class="cs-page" data-cs-page="obs"><article class="panel form-panel"><h3>OBS Studio – Produktionskern</h3>
          <label>Host<input id="cs-obs-host" value="127.0.0.1" readonly></label>
          <label>WebSocket-Port<input id="cs-obs-port" type="number" min="1" max="65535"></label>
          ${toggle("cs-obs-auto", "Beim Start automatisch verbinden")}
          ${toggle("cs-obs-reconnect", "Automatisch wiederverbinden")}
          <label>Reconnect-Verzögerung<input id="cs-obs-delay" type="number" min="1000" max="30000" step="500"><small>Millisekunden</small></label>
          ${toggle("cs-obs-scenes", "Szenenstatus synchronisieren")}
          ${toggle("cs-obs-browser", "Browser-Overlays automatisch aktualisieren")}
          <div class="info-banner">OBS steuert Szenen, Quellen, Audio, Aufnahme, Stream, virtuelle Kamera und Browser-Overlays. Das WebSocket-Passwort bleibt verschlüsselt im SecretStore.</div>
        </article></section>

        <section class="cs-page" data-cs-page="tiktok-studio"><article class="panel form-panel"><h3>TikTok LIVE Studio</h3>
          ${toggle("cs-tiktok-enabled", "TikTok aktivieren")}
          <label>TikTok @Name<input id="cs-tiktok-user" placeholder="@deinname"></label>
          ${toggle("cs-tiktok-auto", "TikTok beim Programmstart initialisieren")}
          ${toggle("cs-tiktok-prefer-studio", "LIVE Studio bevorzugen", "TikTok-spezifische Funktionen zuerst über die lokale LIVE-Studio-Ebene behandeln.")}
          ${toggle("cs-tiktok-fallback", "Bei Bedarf auf LIVE API zurückfallen")}
          ${toggle("cs-studio-enabled", "LIVE-Studio-Integration aktivieren")}
          ${toggle("cs-studio-detect", "Installationspfad automatisch erkennen")}
          ${toggle("cs-studio-launch", "LIVE Studio mit Batto OBS Tool starten")}
          <label>Optionaler EXE-Pfad<input id="cs-studio-path" placeholder="Automatisch erkennen oder vollständigen Pfad eintragen"></label>
          <div class="button-row"><button id="cs-studio-detect-button" type="button">LIVE Studio erkennen</button><button id="cs-studio-launch-button" type="button">LIVE Studio öffnen</button></div>
          <div id="cs-studio-result" class="info-banner">Status noch nicht geprüft.</div>
        </article></section>

        <section class="cs-page" data-cs-page="tiktok-api"><article class="panel form-panel"><h3>TikTok LIVE API / Euler</h3>
          ${toggle("cs-tiktok-api-enabled", "Event-/API-Ebene aktivieren")}
          <label>Provider<select id="cs-tiktok-provider"><option value="eulerstream">Euler Stream Sign API</option><option value="connector">TikTok LIVE Connector</option></select></label>
          <label>Euler Sign API Key<input id="cs-euler-key" type="password" autocomplete="new-password" placeholder="Leer lassen, um vorhandenen Key zu behalten"></label>
          <div class="button-row"><button id="cs-euler-save" type="button">Key verschlüsselt speichern</button><button id="cs-euler-forget" type="button">Key entfernen</button><span id="cs-euler-state" class="inline-message"></span></div>
          ${toggle("cs-api-reconnect", "API automatisch wiederverbinden")}
          ${toggle("cs-api-ratelimit", "Rate-Limit-Schutz verwenden")}
          <label>Min. Reconnect<input id="cs-api-min" type="number" min="1000" max="60000" step="1000"><small>Millisekunden</small></label>
          <label>Max. Reconnect<input id="cs-api-max" type="number" min="5000" max="300000" step="5000"><small>Millisekunden</small></label>
          <div class="cs-check-grid">${toggle("cs-api-chat", "Chat")}${toggle("cs-api-gifts", "Geschenke")}${toggle("cs-api-follows", "Follower")}${toggle("cs-api-shares", "Shares")}${toggle("cs-api-likes", "Likes")}${toggle("cs-api-joins", "Joins")}${toggle("cs-api-subs", "Subscriptions")}${toggle("cs-api-mod", "Moderation")}</div>
          <div class="info-banner">Fehlt Euler oder ist das Rate Limit erreicht, bleibt OBS und der Rest der App betriebsbereit. Plattformfehler werden als Status behandelt, nicht als Programmabsturz.</div>
        </article></section>

        <section class="cs-page" data-cs-page="twitch"><article class="panel form-panel"><h3>Twitch</h3>
          ${toggle("cs-twitch-enabled", "Twitch aktivieren")}
          <label>Kanal<input id="cs-twitch-channel"></label><label>Benutzername<input id="cs-twitch-user"></label>
          <label>Transport<select id="cs-twitch-transport"><option value="eventsub">EventSub WebSocket</option></select></label>
          <label>OAuth Token<input id="cs-twitch-token" type="password" autocomplete="new-password" placeholder="Leer lassen, um vorhandenen Token zu behalten"></label>
          <div class="button-row"><button id="cs-twitch-token-save" type="button">Token speichern</button><button id="cs-twitch-token-forget" type="button">Token entfernen</button><span id="cs-twitch-token-state"></span></div>
          ${toggle("cs-twitch-auto", "Automatisch verbinden")}${toggle("cs-twitch-chat", "Chat")}${toggle("cs-twitch-mod", "Moderation")}${toggle("cs-twitch-subs", "Subs")}${toggle("cs-twitch-bits", "Bits")}${toggle("cs-twitch-raids", "Raids")}${toggle("cs-twitch-holo", "Hologramm")}
        </article></section>

        <section class="cs-page" data-cs-page="youtube"><article class="panel form-panel"><h3>YouTube Live</h3>
          ${toggle("cs-youtube-enabled", "YouTube aktivieren")}
          <label>Channel-ID<input id="cs-youtube-channel"></label><label>Live-Chat-ID<input id="cs-youtube-chatid"></label>
          <label>Transport<select id="cs-youtube-transport"><option value="streamList">LiveChat streamList</option></select></label>
          <label>OAuth Token<input id="cs-youtube-token" type="password" autocomplete="new-password" placeholder="Leer lassen, um vorhandenen Token zu behalten"></label>
          <div class="button-row"><button id="cs-youtube-token-save" type="button">Token speichern</button><button id="cs-youtube-token-forget" type="button">Token entfernen</button><span id="cs-youtube-token-state"></span></div>
          ${toggle("cs-youtube-auto", "Automatisch verbinden")}${toggle("cs-youtube-chat", "Live-Chat")}
        </article></section>

        <section class="cs-page" data-cs-page="cng"><article class="panel form-panel"><h3>CNG – Kleine Creator. Große Zukunft.</h3>
          ${toggle("cs-cng-enabled", "CNG aktivieren")}
          <label>Profilname<input id="cs-cng-user"></label><label>Plattform-URL<input id="cs-cng-base"></label><label>Profil-URL<input id="cs-cng-profile"></label><label>API-Basis-URL<input id="cs-cng-api" placeholder="Optional"></label><label>WebSocket-URL<input id="cs-cng-ws" placeholder="Optional"></label>
          ${toggle("cs-cng-auto", "Automatisch verbinden")}${toggle("cs-cng-chat", "Chat")}
        </article></section>

        <section class="cs-page" data-cs-page="chat"><article class="panel form-panel"><h3>Multi-Chat</h3>
          ${toggle("cs-chat-enabled", "Unified Multi-Chat aktivieren")}${toggle("cs-chat-badge", "Plattform-Badge anzeigen")}${toggle("cs-chat-time", "Zeitstempel anzeigen")}${toggle("cs-chat-avatar", "Avatare anzeigen")}${toggle("cs-chat-links", "Links filtern")}${toggle("cs-chat-words", "Wortfilter aktivieren")}${toggle("cs-chat-tts", "Text-to-Speech")}
          <label>Maximale Nachrichten<input id="cs-chat-max" type="number" min="50" max="5000"></label>
        </article></section>

        <section class="cs-page" data-cs-page="moderation"><article class="panel form-panel"><h3>Moderation</h3>
          ${toggle("cs-mod-context", "Rechtsklick-Aktionen im Chat", "Plattformfähigkeiten bestimmen, welche Aktionen angeboten werden.")}${toggle("cs-mod-ban", "Sperren immer bestätigen")}${toggle("cs-mod-timeout", "Stummschalten bestätigen")}${toggle("cs-mod-blocked", "Liste gesperrter Nutzer behalten")}${toggle("cs-mod-muted", "Liste stummgeschalteter Nutzer behalten")}
        </article></section>

        <section class="cs-page" data-cs-page="overlays"><article class="panel form-panel"><h3>OBS Browser-Overlays</h3>
          ${toggle("cs-overlay-chat", "Chat-Overlay")}${toggle("cs-overlay-gifts", "Geschenke-Overlay")}${toggle("cs-overlay-alerts", "Alerts")}${toggle("cs-overlay-monitor", "Monitoring-Overlay")}
          <label>BrowserSource-Port<input id="cs-overlay-port" type="number" min="1" max="65535"></label>
        </article></section>

        <section class="cs-page" data-cs-page="status"><article class="panel"><header><div><h3>Systemstatus</h3><p>Eine fehlende Plattform darf niemals die gesamte Anwendung blockieren.</p></div><button id="cs-status-refresh" type="button">Aktualisieren</button></header>
          <div class="cs-status-grid">${statusLine("cs-status-settings", "Settings")}${statusLine("cs-status-obs", "OBS")}${statusLine("cs-status-studio", "TikTok LIVE Studio")}${statusLine("cs-status-api", "TikTok LIVE API")}${statusLine("cs-status-twitch", "Twitch")}${statusLine("cs-status-youtube", "YouTube")}${statusLine("cs-status-cng", "CNG")}</div>
          <div id="cs-health-result" class="info-banner">Noch kein Systemcheck ausgeführt.</div>
        </article></section>
      </div>
    </div>`;

  document.querySelectorAll("[data-cs-tab]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-cs-tab]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-cs-page]").forEach((page) => page.classList.toggle("active", page.dataset.csPage === button.dataset.csTab));
  }));

  const setChecked = (id, value) => { if ($(id)) $(id).checked = Boolean(value); };
  const setValue = (id, value) => { if ($(id)) $(id).value = value ?? ""; };
  const checked = (id) => Boolean($(id)?.checked);
  const value = (id) => $(id)?.value ?? "";

  async function load() {
    const snapshot = await window.batto.getState();
    const s = snapshot.settings || {};
    setValue("cs-language", s.product?.language || "de-DE"); setValue("cs-platform", s.preferences?.platform || "twitch"); setValue("cs-resolution", s.preferences?.targetResolution || "1920x1080"); setValue("cs-fps", String(s.preferences?.targetFps || 60));
    setChecked("cs-updates", s.product?.checkForUpdates !== false); setChecked("cs-diagnostics", s.product?.diagnosticsEnabled !== false); setChecked("cs-launch-health", s.product?.launchHealthCheck !== false);
    setValue("cs-obs-port", s.obs?.port || 4455); setChecked("cs-obs-auto", s.obs?.autoConnect !== false); setChecked("cs-obs-reconnect", s.obs?.reconnect !== false); setValue("cs-obs-delay", s.obs?.reconnectDelayMs || 3000); setChecked("cs-obs-scenes", s.obs?.sceneSync !== false); setChecked("cs-obs-browser", s.obs?.browserOverlayAutoRefresh !== false);

    const t = s.platforms?.tiktok || {}, ls = t.liveStudio || {}, api = t.api || {};
    setChecked("cs-tiktok-enabled", t.enabled); setValue("cs-tiktok-user", t.username); setChecked("cs-tiktok-auto", t.autoConnect); setChecked("cs-tiktok-prefer-studio", t.preferLiveStudio !== false); setChecked("cs-tiktok-fallback", t.fallbackToApi !== false);
    setChecked("cs-studio-enabled", ls.enabled !== false); setChecked("cs-studio-detect", ls.detectAutomatically !== false); setChecked("cs-studio-launch", ls.launchWithApp); setValue("cs-studio-path", ls.executablePath);
    setChecked("cs-tiktok-api-enabled", api.enabled !== false); setValue("cs-tiktok-provider", api.provider || "eulerstream"); setChecked("cs-api-reconnect", api.reconnect !== false); setChecked("cs-api-ratelimit", api.rateLimitGuard !== false); setValue("cs-api-min", api.reconnectMinMs || 5000); setValue("cs-api-max", api.reconnectMaxMs || 60000);
    for (const [id, key] of [["cs-api-chat","chat"],["cs-api-gifts","gifts"],["cs-api-follows","follows"],["cs-api-shares","shares"],["cs-api-likes","likes"],["cs-api-joins","joins"],["cs-api-subs","subscriptions"],["cs-api-mod","moderation"]]) setChecked(id, api[key] !== false);

    const tw = s.platforms?.twitch || {}; setChecked("cs-twitch-enabled", tw.enabled); setValue("cs-twitch-channel", tw.channel); setValue("cs-twitch-user", tw.username); setValue("cs-twitch-transport", tw.transport || "eventsub"); setChecked("cs-twitch-auto", tw.autoConnect); setChecked("cs-twitch-chat", tw.chat !== false); setChecked("cs-twitch-mod", tw.moderation !== false); setChecked("cs-twitch-subs", tw.subs !== false); setChecked("cs-twitch-bits", tw.bits !== false); setChecked("cs-twitch-raids", tw.raids !== false); setChecked("cs-twitch-holo", tw.holoOverlay !== false);
    const yt = s.platforms?.youtube || {}; setChecked("cs-youtube-enabled", yt.enabled); setValue("cs-youtube-channel", yt.channelId); setValue("cs-youtube-chatid", yt.liveChatId); setValue("cs-youtube-transport", yt.transport || "streamList"); setChecked("cs-youtube-auto", yt.autoConnect); setChecked("cs-youtube-chat", yt.chat !== false);
    const c = s.platforms?.cng || {}; setChecked("cs-cng-enabled", c.enabled); setValue("cs-cng-user", c.username); setValue("cs-cng-base", c.baseUrl || "https://cng-plattform.com"); setValue("cs-cng-profile", c.profileUrl || "https://cng-plattform.com/profile"); setValue("cs-cng-api", c.apiBaseUrl); setValue("cs-cng-ws", c.websocketUrl); setChecked("cs-cng-auto", c.autoConnect); setChecked("cs-cng-chat", c.chat !== false);
    const ch = s.chat || {}; setChecked("cs-chat-enabled", ch.unifiedEnabled !== false); setChecked("cs-chat-badge", ch.showPlatformBadge !== false); setChecked("cs-chat-time", ch.showTimestamps !== false); setChecked("cs-chat-avatar", ch.showAvatars !== false); setChecked("cs-chat-links", ch.filterLinks); setChecked("cs-chat-words", ch.filterBlockedWords); setChecked("cs-chat-tts", ch.ttsEnabled); setValue("cs-chat-max", ch.maxMessages || 500);
    const m = s.moderation || {}; setChecked("cs-mod-context", m.rightClickActions !== false); setChecked("cs-mod-ban", m.confirmBan !== false); setChecked("cs-mod-timeout", m.confirmTimeout); setChecked("cs-mod-blocked", m.keepBlockedList !== false); setChecked("cs-mod-muted", m.keepMutedList !== false);
    const o = s.overlays || {}; setChecked("cs-overlay-chat", o.chatEnabled !== false); setChecked("cs-overlay-gifts", o.giftsEnabled !== false); setChecked("cs-overlay-alerts", o.alertsEnabled !== false); setChecked("cs-overlay-monitor", o.monitoringEnabled !== false); setValue("cs-overlay-port", o.browserSourcePort || 17824);

    const secrets = snapshot.platformSecrets || await window.batto.getPlatformSecretStatus?.() || {};
    $("cs-euler-state").textContent = secrets.eulerSignApiKey ? "Key gespeichert" : "Kein Key gespeichert";
    $("cs-twitch-token-state").textContent = secrets.twitchOauthToken ? "Token gespeichert" : "Kein Token";
    $("cs-youtube-token-state").textContent = secrets.youtubeOauthToken ? "Token gespeichert" : "Kein Token";
  }

  async function save() {
    const status = $("cs-save-state"); status.textContent = "Speichere …";
    try {
      await window.batto.saveSettings({
        product: { language: value("cs-language"), checkForUpdates: checked("cs-updates"), diagnosticsEnabled: checked("cs-diagnostics"), launchHealthCheck: checked("cs-launch-health") },
        obs: { host: "127.0.0.1", port: Number(value("cs-obs-port")), autoConnect: checked("cs-obs-auto"), reconnect: checked("cs-obs-reconnect"), reconnectDelayMs: Number(value("cs-obs-delay")), sceneSync: checked("cs-obs-scenes"), browserOverlayAutoRefresh: checked("cs-obs-browser") },
        preferences: { platform: value("cs-platform"), targetResolution: value("cs-resolution"), targetFps: Number(value("cs-fps")) },
        platforms: {
          tiktok: { enabled: checked("cs-tiktok-enabled"), username: value("cs-tiktok-user"), autoConnect: checked("cs-tiktok-auto"), preferLiveStudio: checked("cs-tiktok-prefer-studio"), fallbackToApi: checked("cs-tiktok-fallback"), liveStudio: { enabled: checked("cs-studio-enabled"), detectAutomatically: checked("cs-studio-detect"), launchWithApp: checked("cs-studio-launch"), preferForTikTokFeatures: checked("cs-tiktok-prefer-studio"), executablePath: value("cs-studio-path") }, api: { enabled: checked("cs-tiktok-api-enabled"), provider: value("cs-tiktok-provider"), reconnect: checked("cs-api-reconnect"), rateLimitGuard: checked("cs-api-ratelimit"), reconnectMinMs: Number(value("cs-api-min")), reconnectMaxMs: Number(value("cs-api-max")), chat: checked("cs-api-chat"), gifts: checked("cs-api-gifts"), follows: checked("cs-api-follows"), shares: checked("cs-api-shares"), likes: checked("cs-api-likes"), joins: checked("cs-api-joins"), subscriptions: checked("cs-api-subs"), moderation: checked("cs-api-mod") } },
          twitch: { enabled: checked("cs-twitch-enabled"), channel: value("cs-twitch-channel"), username: value("cs-twitch-user"), transport: value("cs-twitch-transport"), autoConnect: checked("cs-twitch-auto"), chat: checked("cs-twitch-chat"), moderation: checked("cs-twitch-mod"), subs: checked("cs-twitch-subs"), bits: checked("cs-twitch-bits"), raids: checked("cs-twitch-raids"), holoOverlay: checked("cs-twitch-holo") },
          youtube: { enabled: checked("cs-youtube-enabled"), channelId: value("cs-youtube-channel"), liveChatId: value("cs-youtube-chatid"), transport: value("cs-youtube-transport"), autoConnect: checked("cs-youtube-auto"), chat: checked("cs-youtube-chat") },
          cng: { enabled: checked("cs-cng-enabled"), username: value("cs-cng-user"), baseUrl: value("cs-cng-base"), profileUrl: value("cs-cng-profile"), apiBaseUrl: value("cs-cng-api"), websocketUrl: value("cs-cng-ws"), autoConnect: checked("cs-cng-auto"), chat: checked("cs-cng-chat") }
        },
        chat: { unifiedEnabled: checked("cs-chat-enabled"), showPlatformBadge: checked("cs-chat-badge"), showTimestamps: checked("cs-chat-time"), showAvatars: checked("cs-chat-avatar"), filterLinks: checked("cs-chat-links"), filterBlockedWords: checked("cs-chat-words"), ttsEnabled: checked("cs-chat-tts"), maxMessages: Number(value("cs-chat-max")) },
        moderation: { rightClickActions: checked("cs-mod-context"), confirmBan: checked("cs-mod-ban"), confirmTimeout: checked("cs-mod-timeout"), keepBlockedList: checked("cs-mod-blocked"), keepMutedList: checked("cs-mod-muted") },
        overlays: { chatEnabled: checked("cs-overlay-chat"), giftsEnabled: checked("cs-overlay-gifts"), alertsEnabled: checked("cs-overlay-alerts"), monitoringEnabled: checked("cs-overlay-monitor"), browserSourcePort: Number(value("cs-overlay-port")) }
      });
      status.textContent = "Gespeichert";
      await runHealth();
    } catch (error) { status.textContent = `Fehler: ${error?.message || error}`; }
  }

  async function saveSecret(name, inputId, stateId) {
    const secret = value(inputId);
    if (!secret) { $(stateId).textContent = "Kein neuer Wert eingegeben"; return; }
    const result = await window.batto.setPlatformSecret(name, secret);
    setValue(inputId, ""); $(stateId).textContent = result.configured ? "Verschlüsselt gespeichert" : "Nicht gespeichert";
  }
  async function forgetSecret(name, stateId) { await window.batto.setPlatformSecret(name, ""); $(stateId).textContent = "Entfernt"; }

  async function detectStudio() {
    const output = $("cs-studio-result");
    try {
      const s = await window.batto.detectTikTokLiveStudio();
      output.textContent = s.installed ? `Gefunden: ${s.executablePath}${s.running ? " · läuft" : " · nicht gestartet"}` : "TikTok LIVE Studio wurde nicht gefunden. Optional den EXE-Pfad eintragen.";
      if (s.executablePath && !value("cs-studio-path")) setValue("cs-studio-path", s.executablePath);
    } catch (error) { output.textContent = `Fehler: ${error?.message || error}`; }
  }

  async function runHealth() {
    const result = await window.batto.runHealthCheck();
    const map = { settings: "cs-status-settings", obs: "cs-status-obs", tiktokLiveStudio: "cs-status-studio", tiktokApi: "cs-status-api", twitch: "cs-status-twitch", youtube: "cs-status-youtube", cng: "cs-status-cng" };
    for (const [key, id] of Object.entries(map)) {
      const check = result.checks?.[key]; if (!check) continue;
      $(id).textContent = check.ok ? `OK${check.detail ? ` · ${check.detail}` : ""}` : `Prüfen${check.detail ? ` · ${check.detail}` : ""}`;
      $(id).className = check.ok ? "cs-ok" : "cs-warn";
    }
    $("cs-health-result").textContent = result.ready ? "Produktstatus: BEREIT. Aktivierte Kernfunktionen sind konfiguriert." : "Produktstatus: BETRIEBSBEREIT MIT HINWEISEN. Fehlende optionale Plattformzugänge blockieren OBS und die übrige App nicht.";
    return result;
  }

  $("cs-save").addEventListener("click", save);
  $("cs-health").addEventListener("click", runHealth); $("cs-status-refresh").addEventListener("click", runHealth);
  $("cs-studio-detect-button").addEventListener("click", detectStudio);
  $("cs-studio-launch-button").addEventListener("click", async () => { try { await window.batto.launchTikTokLiveStudio(); await detectStudio(); } catch (e) { $("cs-studio-result").textContent = `Fehler: ${e?.message || e}`; } });
  $("cs-euler-save").addEventListener("click", () => saveSecret("tiktok-euler-sign-api-key", "cs-euler-key", "cs-euler-state")); $("cs-euler-forget").addEventListener("click", () => forgetSecret("tiktok-euler-sign-api-key", "cs-euler-state"));
  $("cs-twitch-token-save").addEventListener("click", () => saveSecret("twitch-oauth-token", "cs-twitch-token", "cs-twitch-token-state")); $("cs-twitch-token-forget").addEventListener("click", () => forgetSecret("twitch-oauth-token", "cs-twitch-token-state"));
  $("cs-youtube-token-save").addEventListener("click", () => saveSecret("youtube-oauth-token", "cs-youtube-token", "cs-youtube-token-state")); $("cs-youtube-token-forget").addEventListener("click", () => forgetSecret("youtube-oauth-token", "cs-youtube-token-state"));

  load().then(() => Promise.allSettled([detectStudio(), runHealth()])).catch((error) => { $("cs-save-state").textContent = `Ladefehler: ${error?.message || error}`; });
})();
