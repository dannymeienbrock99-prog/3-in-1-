"use strict";

(() => {
  const api = window.batto;
  if (!api?.invoke) return;

  const pages = [
    ["stream-overlay", "◈", "Stream-Overlay", "Frei positionierbare lokale Browserquelle für Chat, Ziele, Geschenke, Logo und Ereignisse."],
    ["multi-chat", "◧", "Multi-Chat", "Twitch, YouTube und lokale TikTok-/TikFinity-/Tiktory-Ereignisse zusammenführen."],
    ["obs-guests", "♙", "OBS Gäste", "Vorhandene OBS-Quellen als Gastplätze in einer Szene ein- und ausblenden."],
    ["plugins", "◆", "Plugins", "Installierte Stream-Deck-Pakete und native Batto-Aktionen verwalten."],
    ["deck-pro", "▦", "Touch-Deck Pro", "Profile, Ordner, variable Raster, Mehrfachaktionen und Verzögerungen verwalten."],
    ["mobile", "▯", "Handy verbinden", "Lokale Kopplung über QR-Code, sechsstellige PIN und WebSocket."],
    ["integration", "⚒", "Übernahme & Diagnose", "Altdaten übernehmen und alle integrierten Module prüfen."]
  ];

  let state = null;
  let activeIntegratedPage = "";
  let pluginCategoryState = {};
  let selectedDeckButtonIndex = -1;
  let editingDeckButton = null;
  let guestItems = [];
  let guestSceneName = "";
  let pendingToast = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function showToast(message, error = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.className = `toast${error ? " error" : ""}`;
    toast.hidden = false;
    clearTimeout(pendingToast);
    pendingToast = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  async function call(channel, payload = {}) {
    try {
      const value = await api.invoke(channel, payload);
      return value;
    } catch (error) {
      showToast(error?.message || error, true);
      throw error;
    }
  }

  function statusPill(active, on = "Aktiv", off = "Nicht aktiv") {
    return `<span class="status-pill ${active ? "online" : "offline"}">${escapeHtml(active ? on : off)}</span>`;
  }

  function addNavigationAndViews() {
    const nav = document.querySelector(".sidebar nav");
    const content = document.querySelector("main.content");
    const settingsButton = nav?.querySelector('[data-view="settings"]');
    if (!nav || !content || document.querySelector('[data-view="stream-overlay"]')) return;

    for (const [id, icon, label] of pages) {
      const button = document.createElement("button");
      button.className = "nav-button integrated-nav";
      button.dataset.view = id;
      button.innerHTML = `<span>${icon}</span> ${escapeHtml(label)}`;
      nav.insertBefore(button, settingsButton || null);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        switchIntegratedPage(id);
      });
    }

    const viewMarkup = {
      "stream-overlay": streamOverlayMarkup(),
      "multi-chat": multiChatMarkup(),
      "obs-guests": guestsMarkup(),
      plugins: pluginsMarkup(),
      "deck-pro": deckMarkup(),
      mobile: mobileMarkup(),
      integration: integrationMarkup()
    };
    for (const [id, markup] of Object.entries(viewMarkup)) {
      const section = document.createElement("section");
      section.id = `view-${id}`;
      section.className = "view integrated-view";
      section.innerHTML = markup;
      content.append(section);
    }
    bindIntegratedEvents();
  }

  function switchIntegratedPage(id) {
    const meta = pages.find((page) => page[0] === id);
    if (!meta) return;
    activeIntegratedPage = id;
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${id}`));
    $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === id));
    const title = document.getElementById("page-title");
    const subtitle = document.getElementById("page-subtitle");
    if (title) title.textContent = meta[2];
    if (subtitle) subtitle.textContent = meta[3];
    renderIntegratedPage(id);
  }

  function streamOverlayMarkup() {
    return `
      <div class="section-heading">
        <div><span class="eyebrow">LOKAL · TRANSPARENT · OHNE CLOUD</span><h2>Stream-Overlay</h2><p>Das neue Encoder-Monitoring bleibt vollständig erhalten. Dieses Modul ergänzt die frei gestaltbare Stream-Ebene aus dem früheren Setup.</p></div>
        <div class="button-row"><button id="stream-overlay-copy">OBS-Adresse kopieren</button><button id="stream-overlay-open" class="primary">Editor öffnen</button></div>
      </div>
      <div id="stream-overlay-status" class="module-status-grid"></div>
      <div class="two-column-cards">
        <article class="panel"><h3>Lokale Ereignisse testen</h3><p>Testdaten werden ausschließlich lokal in das Overlay gesendet.</p><div class="form-grid compact-form"><label>Typ<select id="stream-test-type"><option value="chat">Chat</option><option value="gift">Geschenk</option><option value="like">Likes</option><option value="heartRate">Herzfrequenz</option><option value="coHost">Co-Host</option><option value="wheel">Glücksrad</option><option value="poll">Umfrage</option></select></label><label>Name<input id="stream-test-name" value="Crazy_Batto"></label><label>Text / Ereignis<input id="stream-test-text" value="Testnachricht"></label><label>Wert<input id="stream-test-value" type="number" value="1"></label></div><div class="button-row"><button id="stream-test-send">Test auslösen</button><button id="stream-events-clear">Ereignisse leeren</button></div></article>
        <article class="panel"><h3>Enthaltene Elemente</h3><div class="tag-cloud"><span>Text</span><span>Follower-Ziel</span><span>Timer</span><span>Live-Chat</span><span>Geschenk-Feed</span><span>Topliste</span><span>Likes</span><span>Co-Host</span><span>Schatztruhe</span><span>Portal</span><span>Herzfrequenz</span><span>Umfrage</span><span>Wortwolke</span><span>Glücksrad</span><span>Team-Logo</span></div></article>
      </div>`;
  }

  function multiChatMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">TWITCH · YOUTUBE · LOKALE WEBHOOKS</span><h2>Multi-Chat</h2><p>TikTok, TikFinity und Tiktory senden weiterhin über den lokalen Stream-Overlay-Webhook. Twitch und YouTube können direkt verbunden werden.</p></div><div class="button-row"><button id="chat-test">Testnachricht</button><button id="chat-clear">Leeren</button></div></div>
      <div class="integrated-split">
        <aside class="panel chat-settings-panel">
          <h3>Plattformen</h3>
          <div class="toggle-grid" id="chat-platforms"></div>
          <label class="check-line"><input id="chat-forward" type="checkbox"> Nachrichten ins Stream-Overlay senden</label>
          <hr>
          <h3>Twitch</h3>
          <label>Kanal<input id="chat-twitch-channel" placeholder="crazy_batto"></label>
          <label>Bot-/Kontoname<input id="chat-twitch-name" placeholder="optional"></label>
          <label>OAuth-Token<input id="chat-twitch-token" type="password" placeholder="gespeichertes Token verwenden"></label>
          <div class="button-row"><button id="chat-twitch-connect">Verbinden</button><button id="chat-twitch-disconnect">Trennen</button></div>
          <hr>
          <h3>YouTube Live</h3>
          <label>API-Schlüssel<input id="chat-youtube-key" type="password" placeholder="gespeicherten Schlüssel verwenden"></label>
          <label>Live-Chat-ID<input id="chat-youtube-id"></label>
          <div class="button-row"><button id="chat-youtube-connect">Verbinden</button><button id="chat-youtube-disconnect">Trennen</button></div>
          <hr>
          <h3>Text-to-Speech</h3>
          <label class="check-line"><input id="chat-tts-enabled" type="checkbox"> Nachrichten lokal vorlesen</label>
          <label>Maximale Zeichen<input id="chat-tts-length" type="number" min="20" max="500" value="240"></label>
          <div class="button-row"><button id="chat-settings-save" class="primary">Einstellungen speichern</button><button id="chat-tts-clear">TTS stoppen</button></div>
        </aside>
        <section class="panel chat-live-panel"><header><div><h3>Live-Nachrichten</h3><p id="chat-status-line">Noch nicht verbunden.</p></div></header><div id="chat-message-list" class="chat-message-list"></div></section>
      </div>`;
  }

  function guestsMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">OBS-QUELLEN ALS GASTPLÄTZE</span><h2>OBS Co-Host- und Gästemodus</h2><p>Das Modul schaltet vorhandene Browser-, Kamera-, NDI- oder Aufnahmequellen innerhalb einer OBS-Szene. Es sendet keine Einladungen an TikTok-Server.</p></div></div>
      <article class="panel"><div class="guest-toolbar"><label>OBS-Szene<select id="guest-scene"><option>OBS verbinden</option></select></label><button id="guest-load">Quellen neu laden</button><button id="guest-add-all">Alle anzeigen</button><button id="guest-apply" class="primary">In OBS anwenden</button></div><div class="info-banner warning">TikTok-LIVE-Einladungen und Plattform-Co-Host-Sitzungen müssen weiterhin in TikTok selbst gestartet werden.</div><div id="guest-list" class="guest-list empty-state"><p>OBS verbinden und eine Szene auswählen.</p></div></article>`;
  }

  function pluginsMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">NATIVE AKTIONEN + INSTALLIERTE PAKETE</span><h2>Plugin-System</h2><p>Manifeste, Aktionen, Zustände und Icons installierter Pakete werden eingelesen. Nicht unterstützte Laufzeiten melden einen Fehler, statt Erfolg vorzutäuschen.</p></div><div class="button-row"><button id="plugins-import">Plugin-Ordner importieren</button><button id="plugins-scan" class="primary">Neu scannen</button></div></div>
      <div id="plugin-summary" class="module-status-grid"></div>
      <div id="plugin-list" class="plugin-list"></div>`;
  }

  function deckMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">PROFILE · ORDNER · MEHRFACHAKTIONEN</span><h2>Touch-Deck Pro</h2><p>Raster von 1 × 1 bis 10 × 10. Beim Verkleinern bleiben verdeckte Belegungen gespeichert.</p></div><div class="button-row"><button id="deck-pro-import">Importieren</button><button id="deck-pro-export">Exportieren</button></div></div>
      <div class="deck-pro-toolbar panel"><label>Profil<select id="deck-pro-profile"></select></label><button id="deck-pro-add-profile">+ Profil</button><label>Ordner<select id="deck-pro-folder"></select></label><button id="deck-pro-back-folder">← Zurück</button><button id="deck-pro-add-folder">+ Ordner</button></div>
      <div class="deck-pro-layout">
        <section class="panel deck-pro-stage-panel">
          <div class="deck-grid-controls"><label>Zeilen<input id="deck-pro-rows" type="number" min="1" max="10"></label><label>Spalten<input id="deck-pro-columns" type="number" min="1" max="10"></label><label>Tastengröße<input id="deck-pro-size" type="number" min="64" max="260"></label><label>Abstand<input id="deck-pro-gap" type="number" min="0" max="40"></label><label class="check-line"><input id="deck-pro-hide-unused" type="checkbox"> Unbenutzte Tasten ausblenden</label><button id="deck-pro-apply-grid">Raster übernehmen</button></div>
          <p id="deck-pro-capacity" class="muted-line"></p>
          <div id="deck-pro-grid" class="deck-pro-grid"></div>
        </section>
        <aside class="panel deck-pro-inspector">
          <h3>Taste bearbeiten</h3><p id="deck-pro-selected" class="muted-line">Keine Taste ausgewählt.</p>
          <label>Titel<input id="deck-pro-title" maxlength="120"></label>
          <label>Untertitel<input id="deck-pro-subtitle" maxlength="160"></label>
          <div class="two-column-fields"><label>Tastenfarbe<input id="deck-pro-color" type="color" value="#152130"></label><label>Schriftfarbe<input id="deck-pro-text-color" type="color" value="#ffffff"></label></div>
          <label>Zielordner<select id="deck-pro-target-folder"><option value="">Kein Ordner</option></select></label>
          <hr><h3>Mehrfachaktionen</h3>
          <div id="deck-pro-actions" class="deck-action-list"></div>
          <label>Aktion<select id="deck-pro-action-type"></select></label>
          <label>Einstellungen als JSON<textarea id="deck-pro-action-settings" rows="5">{}</textarea></label>
          <label>Verzögerung in ms<input id="deck-pro-action-delay" type="number" min="0" max="120000" value="0"></label>
          <div class="button-row"><button id="deck-pro-add-action">Aktion hinzufügen</button><button id="deck-pro-save-key" class="primary">Taste speichern</button><button id="deck-pro-clear-key">Leeren</button></div>
        </aside>
      </div>`;
  }

  function mobileMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">LOKAL ÜBER WLAN · LAN · USB-TETHERING</span><h2>Handy verbinden</h2><p>QR-Code und PIN werden nur im lokalen Netzwerk verwendet. Es gibt keine Cloud-Anmeldung.</p></div><div class="button-row"><button id="mobile-new-pin">Neue PIN</button><button id="mobile-copy-address">Adresse kopieren</button></div></div>
      <div class="mobile-connect-layout">
        <article class="panel mobile-qr-card"><div id="mobile-active-pill"></div><img id="mobile-qr" alt="QR-Code für die Handy-Verbindung"><h3 id="mobile-pin">PIN ––––––</h3><code id="mobile-address">Server wird gestartet …</code><label class="check-line"><input id="mobile-approval" type="checkbox"> Neue Handys am PC bestätigen</label><details><summary>Kompatibilität mit der alten APK</summary><p>Zusätzlich wird ein QR-Code mit dem alten <code>creatorhub://pair</code>-Schema bereitgestellt.</p><img id="mobile-legacy-qr" alt="Kompatibilitäts-QR-Code"></details></article>
        <section class="panel"><h3>Kopplungsanfragen</h3><div id="mobile-pending" class="connection-list"></div><hr><h3>Verbundene Handys</h3><div id="mobile-clients" class="connection-list"></div><hr><h3>Netzwerkschnittstellen</h3><div id="mobile-networks" class="connection-list"></div></section>
      </div>`;
  }

  function integrationMarkup() {
    return `
      <div class="section-heading"><div><span class="eyebrow">DATENSICHERHEIT UND MODULSTATUS</span><h2>Übernahme & Diagnose</h2><p>Profile, Plugin-Daten und Icon-Pakete aus einer vorhandenen 1.8.6-Installation werden nur ergänzt. Neue Batto-Daten werden nicht überschrieben.</p></div><button id="migration-run" class="primary">Altdaten erneut suchen</button></div>
      <div id="integration-status" class="diagnostic-grid"></div>
      <article class="panel"><h3>Abnahmebedingungen</h3><ul class="check-list"><li>Eine Hauptanwendung und ein Installer</li><li>Kein separater alter Prozess</li><li>Lokale OBS-Adresse 127.0.0.1:4455</li><li>Dedizierte GPU wird bevorzugt</li><li>Monitoring-Overlay bleibt transparent</li><li>Touch-Deck-Belegungen bleiben bei Rasteränderungen erhalten</li><li>Plugin-Fehler werden sichtbar gemeldet</li><li>Handy-Verbindung läuft lokal mit PIN</li></ul></article>`;
  }

  function bindIntegratedEvents() {
    $("#stream-overlay-open")?.addEventListener("click", () => call("stream-overlay:open"));
    $("#stream-overlay-copy")?.addEventListener("click", async () => showToast(`OBS-Adresse kopiert: ${await call("stream-overlay:copy-url")}`));
    $("#stream-test-send")?.addEventListener("click", () => call("stream-overlay:event", { type: $("#stream-test-type").value, platform: "local", name: $("#stream-test-name").value, text: $("#stream-test-text").value, value: Number($("#stream-test-value").value) || 0 }));
    $("#stream-events-clear")?.addEventListener("click", () => call("stream-overlay:clear"));

    $("#chat-settings-save")?.addEventListener("click", saveChatSettings);
    $("#chat-twitch-connect")?.addEventListener("click", connectTwitch);
    $("#chat-twitch-disconnect")?.addEventListener("click", () => call("chat:twitch-disconnect"));
    $("#chat-youtube-connect")?.addEventListener("click", connectYouTube);
    $("#chat-youtube-disconnect")?.addEventListener("click", () => call("chat:youtube-disconnect"));
    $("#chat-test")?.addEventListener("click", () => call("chat:test", { platform: "twitch", name: "Crazy_Batto", text: "Lokale Multi-Chat-Testnachricht", role: "broadcaster" }));
    $("#chat-clear")?.addEventListener("click", () => call("chat:clear"));
    $("#chat-tts-clear")?.addEventListener("click", () => call("chat:tts-clear"));

    $("#guest-load")?.addEventListener("click", loadGuests);
    $("#guest-scene")?.addEventListener("change", loadGuests);
    $("#guest-add-all")?.addEventListener("click", () => $$('#guest-list input[type="checkbox"]').forEach((input) => { input.checked = true; }));
    $("#guest-apply")?.addEventListener("click", applyGuests);

    $("#plugins-scan")?.addEventListener("click", () => call("plugins:scan").then((plugins) => { state.plugins = plugins; renderPlugins(); }));
    $("#plugins-import")?.addEventListener("click", () => call("plugins:import").then(() => call("plugins:scan")).then((plugins) => { state.plugins = plugins; renderPlugins(); }));

    $("#deck-pro-profile")?.addEventListener("change", () => call("deck:activate-profile", { profileId: $("#deck-pro-profile").value }).then(refreshState));
    $("#deck-pro-folder")?.addEventListener("change", () => { selectedDeckButtonIndex = -1; editingDeckButton = null; renderDeckPro(); });
    $("#deck-pro-add-profile")?.addEventListener("click", createDeckProfile);
    $("#deck-pro-add-folder")?.addEventListener("click", createDeckFolder);
    $("#deck-pro-back-folder")?.addEventListener("click", goBackFolder);
    $("#deck-pro-apply-grid")?.addEventListener("click", applyDeckGrid);
    $("#deck-pro-add-action")?.addEventListener("click", addDeckAction);
    $("#deck-pro-save-key")?.addEventListener("click", saveDeckButton);
    $("#deck-pro-clear-key")?.addEventListener("click", clearDeckButton);
    $("#deck-pro-export")?.addEventListener("click", () => call("deck:export"));
    $("#deck-pro-import")?.addEventListener("click", () => call("deck:import", { mode: "merge" }).then(refreshState));

    $("#mobile-new-pin")?.addEventListener("click", () => call("mobile:regenerate-pin").then((mobile) => { state.mobile = mobile; renderMobile(); }));
    $("#mobile-copy-address")?.addEventListener("click", async () => { const value = state?.mobile?.qr?.web || ""; await navigator.clipboard.writeText(value); showToast("Handy-Adresse kopiert."); });
    $("#mobile-approval")?.addEventListener("change", () => call("mobile:approval", { required: $("#mobile-approval").checked }).then((mobile) => { state.mobile = mobile; renderMobile(); }));

    $("#migration-run")?.addEventListener("click", () => call("migration:run").then((migration) => { state.migration = migration; renderIntegration(); }));
  }

  async function refreshState() {
    state = await call("state:get");
    renderIntegratedPage(activeIntegratedPage);
    return state;
  }

  function renderIntegratedPage(id) {
    if (!state) return;
    if (id === "stream-overlay") renderStreamOverlay();
    if (id === "multi-chat") renderMultiChat();
    if (id === "obs-guests") renderGuests();
    if (id === "plugins") renderPlugins();
    if (id === "deck-pro") renderDeckPro();
    if (id === "mobile") renderMobile();
    if (id === "integration") renderIntegration();
  }

  function renderStreamOverlay() {
    const status = state?.modules?.streamOverlay || {};
    const target = $("#stream-overlay-status");
    if (!target) return;
    target.innerHTML = `
      <article><span>Status</span><strong>${statusPill(Boolean(status.active))}</strong></article>
      <article><span>OBS-Browserquelle</span><code>${escapeHtml(status.overlayUrl || "Nicht verfügbar")}</code></article>
      <article><span>Lokaler Webhook</span><code>${escapeHtml(status.eventUrl || "Nicht verfügbar")}</code></article>
      <article><span>Aktive Browserquellen</span><strong>${escapeHtml(status.clients ?? 0)}</strong></article>`;
  }

  function chatSettingsFromUi() {
    const platforms = {};
    $$('#chat-platforms input[data-platform]').forEach((input) => { platforms[input.dataset.platform] = input.checked; });
    return {
      enabledPlatforms: platforms,
      forwardToOverlay: $("#chat-forward").checked,
      twitch: { channel: $("#chat-twitch-channel").value.trim(), nickname: $("#chat-twitch-name").value.trim() },
      youtube: { liveChatId: $("#chat-youtube-id").value.trim() },
      tts: { enabled: $("#chat-tts-enabled").checked, maximumLength: Number($("#chat-tts-length").value) || 240 }
    };
  }

  async function saveChatSettings() {
    const payload = { settings: chatSettingsFromUi() };
    if ($("#chat-twitch-token").value) payload.twitchOauth = $("#chat-twitch-token").value;
    if ($("#chat-youtube-key").value) payload.youtubeApiKey = $("#chat-youtube-key").value;
    state.chat = await call("chat:update-settings", payload);
    $("#chat-twitch-token").value = "";
    $("#chat-youtube-key").value = "";
    renderMultiChat();
    showToast("Multi-Chat-Einstellungen gespeichert.");
  }

  async function connectTwitch() {
    await saveChatSettings();
    state.chat = await call("chat:twitch-connect", { channel: $("#chat-twitch-channel").value.trim(), nickname: $("#chat-twitch-name").value.trim() });
    renderMultiChat();
  }

  async function connectYouTube() {
    await saveChatSettings();
    state.chat = await call("chat:youtube-connect", { liveChatId: $("#chat-youtube-id").value.trim() });
    renderMultiChat();
  }

  function renderMultiChat() {
    const chat = state?.chat || {};
    const settings = chat.settings || {};
    const platforms = settings.enabledPlatforms || {};
    const platformTarget = $("#chat-platforms");
    if (!platformTarget) return;
    platformTarget.innerHTML = ["twitch", "youtube", "tiktok", "tikfinity", "tiktory"].map((platform) => `<label class="check-line"><input type="checkbox" data-platform="${platform}" ${platforms[platform] !== false ? "checked" : ""}> ${escapeHtml(platform === "youtube" ? "YouTube" : platform === "twitch" ? "Twitch" : platform === "tiktok" ? "TikTok" : platform === "tikfinity" ? "TikFinity" : "Tiktory")}</label>`).join("");
    $("#chat-forward").checked = settings.forwardToOverlay !== false;
    $("#chat-twitch-channel").value = settings.twitch?.channel || "";
    $("#chat-twitch-name").value = settings.twitch?.nickname || "";
    $("#chat-youtube-id").value = settings.youtube?.liveChatId || "";
    $("#chat-tts-enabled").checked = Boolean(settings.tts?.enabled);
    $("#chat-tts-length").value = String(settings.tts?.maximumLength || 240);
    $("#chat-status-line").textContent = `Twitch: ${chat.status?.twitch ? "verbunden" : "getrennt"} · YouTube: ${chat.status?.youtube ? "verbunden" : "getrennt"} · Lokaler Webhook: ${chat.status?.localWebhook ? "aktiv" : "inaktiv"}`;
    const list = $("#chat-message-list");
    list.innerHTML = (chat.messages || []).slice(-200).reverse().map((message) => `<article class="chat-row platform-${escapeHtml(message.platform)}"><header><strong>${escapeHtml(message.name)}</strong><span>${escapeHtml(message.platform)} · ${new Date(message.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span></header><p>${escapeHtml(message.text)}</p></article>`).join("") || '<div class="empty-state"><p>Noch keine Nachricht empfangen.</p></div>';
  }

  function renderGuests() {
    const select = $("#guest-scene");
    if (!select) return;
    const scenes = state?.obs?.scenes || [];
    const current = guestSceneName || state?.obs?.currentProgramSceneName || scenes[0]?.sceneName || "";
    select.innerHTML = scenes.length ? scenes.map((scene) => `<option value="${escapeHtml(scene.sceneName)}" ${scene.sceneName === current ? "selected" : ""}>${escapeHtml(scene.sceneName)}</option>`).join("") : "<option>OBS verbinden</option>";
    guestSceneName = select.value || current;
    const target = $("#guest-list");
    if (!guestItems.length) {
      target.className = "guest-list empty-state";
      target.innerHTML = `<p>${state?.obs?.connected ? "Quellen für die ausgewählte Szene neu laden." : "OBS ist nicht verbunden."}</p>`;
      return;
    }
    target.className = "guest-list";
    target.innerHTML = guestItems.map((item) => `<label class="guest-row"><input type="checkbox" data-scene-item-id="${Number(item.sceneItemId)}" ${item.sceneItemEnabled ? "checked" : ""}><span><strong>${escapeHtml(item.sourceName)}</strong><small>${escapeHtml(item.inputKind || item.sourceType || "OBS-Quelle")}</small></span></label>`).join("");
  }

  async function loadGuests() {
    guestSceneName = $("#guest-scene").value;
    const result = await call("guests:list", { sceneName: guestSceneName });
    guestItems = result.items || [];
    renderGuests();
  }

  async function applyGuests() {
    const slots = $$('#guest-list input[data-scene-item-id]').map((input) => ({ sceneItemId: Number(input.dataset.sceneItemId), enabled: input.checked }));
    await call("guests:apply", { sceneName: guestSceneName, slots });
    showToast("Gastquellen in OBS aktualisiert.");
    await loadGuests();
  }

  function renderPlugins() {
    const snapshot = state?.plugins || { plugins: [], iconPacks: [] };
    const plugins = snapshot.plugins || [];
    const summary = $("#plugin-summary");
    if (!summary) return;
    summary.innerHTML = `<article><span>Aktive Plugins</span><strong>${plugins.filter((plugin) => plugin.enabled).length}</strong></article><article><span>Erkannte Aktionen</span><strong>${plugins.reduce((sum, plugin) => sum + (plugin.actions?.length || 0), 0)}</strong></article><article><span>Icon-Pakete</span><strong>${snapshot.iconPacks?.length || 0}</strong></article><article><span>Scan</span><strong>${snapshot.scannedAt ? new Date(snapshot.scannedAt).toLocaleTimeString("de-DE") : "Noch nicht"}</strong></article>`;
    const groups = Map.groupBy ? Map.groupBy(plugins, (plugin) => plugin.category || "Plugin") : plugins.reduce((map, plugin) => { const key = plugin.category || "Plugin"; if (!map.has(key)) map.set(key, []); map.get(key).push(plugin); return map; }, new Map());
    const list = $("#plugin-list");
    list.replaceChildren(...[...groups.entries()].map(([category, items]) => {
      const section = document.createElement("section");
      section.className = "plugin-category panel";
      const open = pluginCategoryState[category] !== false;
      section.innerHTML = `<button type="button" class="plugin-category-toggle"><span>${open ? "⌄" : "›"}</span><strong>${escapeHtml(category)}</strong><small>${items.length}</small></button><div class="plugin-category-body" ${open ? "" : "hidden"}></div>`;
      const body = $(".plugin-category-body", section);
      body.replaceChildren(...items.map((plugin) => pluginCard(plugin)));
      $(".plugin-category-toggle", section).addEventListener("click", () => { pluginCategoryState[category] = !open; renderPlugins(); });
      return section;
    }));
  }

  function pluginCard(plugin) {
    const card = document.createElement("article");
    card.className = `plugin-card${plugin.enabled ? "" : " disabled"}`;
    card.innerHTML = `<header>${plugin.icon ? `<img src="${escapeHtml(plugin.icon)}" alt="">` : ""}<div><strong>${escapeHtml(plugin.name)}</strong><span>${escapeHtml(plugin.version || "")}${plugin.native ? " · Native Batto-Aktion" : ""}</span></div><label class="switch"><input type="checkbox" ${plugin.enabled ? "checked" : ""}><span></span></label></header><p>${escapeHtml(plugin.description || plugin.status || "")}</p><details><summary>${plugin.actions?.length || 0} Aktion(en)</summary><div class="plugin-actions">${(plugin.actions || []).map((action) => `<div><strong>${escapeHtml(action.name)}</strong><code>${escapeHtml(action.id)}</code></div>`).join("") || "<p>Keine Aktionen im Manifest.</p>"}</div></details><small class="plugin-status">${escapeHtml(plugin.status || "")}</small>`;
    $("input[type=checkbox]", card).addEventListener("change", async (event) => {
      state.plugins = await call("plugins:enable", { pluginId: plugin.id, enabled: event.target.checked });
      renderPlugins();
    });
    return card;
  }

  function deckProfile() {
    const profiles = state?.deck?.profiles || [];
    const id = $("#deck-pro-profile")?.value || state?.deck?.activeProfileId;
    return profiles.find((profile) => profile.id === id) || profiles[0] || null;
  }

  function deckFolder(profile = deckProfile()) {
    if (!profile) return null;
    const id = $("#deck-pro-folder")?.value || profile.activeFolderId || "root";
    return profile.folders?.find((folder) => folder.id === id) || profile.folders?.[0] || null;
  }

  function allActionOptions() {
    const actions = [];
    for (const plugin of state?.plugins?.plugins || []) {
      if (!plugin.enabled) continue;
      for (const action of plugin.actions || []) actions.push({ id: action.id, name: `${plugin.name} · ${action.name}` });
    }
    const unique = new Map(actions.map((action) => [action.id, action]));
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  function renderDeckPro() {
    const profileSelect = $("#deck-pro-profile");
    if (!profileSelect) return;
    const deck = state?.deck;
    if (!deck) return;
    profileSelect.innerHTML = deck.profiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === deck.activeProfileId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("");
    const profile = deckProfile();
    if (!profile) return;
    const folderSelect = $("#deck-pro-folder");
    folderSelect.innerHTML = profile.folders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${folder.id === profile.activeFolderId ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("");
    const folder = deckFolder(profile);
    if (!folder) return;
    $("#deck-pro-rows").value = folder.rows;
    $("#deck-pro-columns").value = folder.columns;
    $("#deck-pro-size").value = folder.buttonSize;
    $("#deck-pro-gap").value = folder.gap;
    $("#deck-pro-hide-unused").checked = Boolean(folder.hideUnused);
    $("#deck-pro-back-folder").disabled = !folder.parentId;
    $("#deck-pro-capacity").textContent = `${folder.buttons.filter((button) => button.actions?.length || button.folderId).length} von ${folder.rows * folder.columns} sichtbaren Tasten belegt · verdeckte Tasten bleiben gespeichert.`;
    const grid = $("#deck-pro-grid");
    grid.style.setProperty("--columns", String(folder.columns));
    grid.style.setProperty("--button-size", `${folder.buttonSize}px`);
    grid.style.setProperty("--button-gap", `${folder.gap}px`);
    const visible = folder.buttons.slice(0, folder.rows * folder.columns);
    grid.replaceChildren(...visible.map((button, index) => {
      const used = Boolean(button.actions?.length || button.folderId || button.title || button.icon);
      const element = document.createElement("button");
      element.type = "button";
      element.className = `deck-pro-key${used ? " used" : ""}${index === selectedDeckButtonIndex ? " selected" : ""}`;
      element.style.setProperty("--key-color", button.color || "#152130");
      element.style.setProperty("--key-text", button.textColor || "#ffffff");
      element.draggable = true;
      element.dataset.index = index;
      if (button.icon && /^data:image\//.test(button.icon)) element.innerHTML = `<img src="${escapeHtml(button.icon)}" alt="">`;
      element.insertAdjacentHTML("beforeend", `<strong>${escapeHtml(button.title || (button.folderId ? "Ordner" : `Taste ${index + 1}`))}</strong><small>${button.actions?.length > 1 ? `${button.actions.length} Aktionen` : button.actions?.[0]?.type || ""}</small>`);
      element.hidden = folder.hideUnused && !used;
      element.addEventListener("click", () => selectDeckButton(index, button));
      element.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", String(index)));
      element.addEventListener("dragover", (event) => event.preventDefault());
      element.addEventListener("drop", async (event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData("text/plain")); await call("deck:move-button", { profileId: profile.id, folderId: folder.id, fromIndex: from, toIndex: index }); await refreshState(); });
      return element;
    }));
    const targetFolder = $("#deck-pro-target-folder");
    targetFolder.innerHTML = '<option value="">Kein Ordner</option>' + profile.folders.filter((item) => item.id !== folder.id).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    const actionSelect = $("#deck-pro-action-type");
    actionSelect.innerHTML = allActionOptions().map((action) => `<option value="${escapeHtml(action.id)}">${escapeHtml(action.name)}</option>`).join("");
    renderDeckInspector();
  }

  function selectDeckButton(index, button) {
    selectedDeckButtonIndex = index;
    editingDeckButton = structuredClone(button || {});
    editingDeckButton.actions ||= [];
    renderDeckPro();
  }

  function renderDeckInspector() {
    const selected = editingDeckButton;
    $("#deck-pro-selected").textContent = selectedDeckButtonIndex >= 0 ? `Taste ${selectedDeckButtonIndex + 1}` : "Keine Taste ausgewählt.";
    $("#deck-pro-title").value = selected?.title || "";
    $("#deck-pro-subtitle").value = selected?.subtitle || "";
    $("#deck-pro-color").value = selected?.color || "#152130";
    $("#deck-pro-text-color").value = selected?.textColor || "#ffffff";
    $("#deck-pro-target-folder").value = selected?.folderId || "";
    const list = $("#deck-pro-actions");
    list.replaceChildren(...(selected?.actions || []).map((action, index) => {
      const row = document.createElement("div");
      row.className = "deck-action-row";
      row.innerHTML = `<span><strong>${escapeHtml(action.title || action.type)}</strong><code>${escapeHtml(action.type)}</code><small>${Number(action.delayMs || 0)} ms</small></span><button type="button">Entfernen</button>`;
      $("button", row).addEventListener("click", () => { editingDeckButton.actions.splice(index, 1); renderDeckInspector(); });
      return row;
    }));
  }

  async function createDeckProfile() {
    const name = prompt("Name des neuen Profils:", "Neues Profil")?.trim();
    if (!name) return;
    await call("deck:create-profile", { name });
    selectedDeckButtonIndex = -1;
    editingDeckButton = null;
    await refreshState();
  }

  async function createDeckFolder() {
    const profile = deckProfile();
    const folder = deckFolder(profile);
    const name = prompt("Name des neuen Ordners:", "Neuer Ordner")?.trim();
    if (!name) return;
    await call("deck:create-folder", { profileId: profile.id, name, parentId: folder.id });
    selectedDeckButtonIndex = -1;
    editingDeckButton = null;
    await refreshState();
  }

  async function goBackFolder() {
    const profile = deckProfile();
    const folder = deckFolder(profile);
    if (!folder?.parentId) return;
    await call("deck:activate-folder", { profileId: profile.id, folderId: folder.parentId });
    await refreshState();
  }

  async function applyDeckGrid() {
    const profile = deckProfile();
    const folder = deckFolder(profile);
    await call("deck:update-folder", { profileId: profile.id, folderId: folder.id, patch: { rows: Number($("#deck-pro-rows").value), columns: Number($("#deck-pro-columns").value), buttonSize: Number($("#deck-pro-size").value), gap: Number($("#deck-pro-gap").value), hideUnused: $("#deck-pro-hide-unused").checked } });
    await refreshState();
    showToast("Raster gespeichert. Verdeckte Tasten wurden nicht gelöscht.");
  }

  function addDeckAction() {
    if (selectedDeckButtonIndex < 0) return showToast("Zuerst eine Taste auswählen.", true);
    let settings;
    try { settings = JSON.parse($("#deck-pro-action-settings").value || "{}"); }
    catch { return showToast("Die Aktionseinstellungen enthalten kein gültiges JSON.", true); }
    const type = $("#deck-pro-action-type").value;
    const label = $("#deck-pro-action-type").selectedOptions[0]?.textContent || type;
    editingDeckButton.actions.push({ id: `action-${Date.now()}`, type, title: label, settings, delayMs: Number($("#deck-pro-action-delay").value) || 0 });
    renderDeckInspector();
  }

  async function saveDeckButton() {
    if (selectedDeckButtonIndex < 0) return showToast("Zuerst eine Taste auswählen.", true);
    const profile = deckProfile();
    const folder = deckFolder(profile);
    editingDeckButton.title = $("#deck-pro-title").value.trim();
    editingDeckButton.subtitle = $("#deck-pro-subtitle").value.trim();
    editingDeckButton.color = $("#deck-pro-color").value;
    editingDeckButton.textColor = $("#deck-pro-text-color").value;
    editingDeckButton.folderId = $("#deck-pro-target-folder").value;
    await call("deck:update-button", { profileId: profile.id, folderId: folder.id, buttonIndex: selectedDeckButtonIndex, button: editingDeckButton });
    await refreshState();
    showToast("Taste gespeichert.");
  }

  async function clearDeckButton() {
    if (selectedDeckButtonIndex < 0) return;
    const profile = deckProfile();
    const folder = deckFolder(profile);
    await call("deck:clear-button", { profileId: profile.id, folderId: folder.id, buttonIndex: selectedDeckButtonIndex });
    selectedDeckButtonIndex = -1;
    editingDeckButton = null;
    await refreshState();
  }

  function renderMobile() {
    const mobile = state?.mobile || {};
    if (!$("#mobile-active-pill")) return;
    $("#mobile-active-pill").innerHTML = statusPill(Boolean(mobile.active), "Lokaler Server aktiv", "Server nicht aktiv");
    $("#mobile-pin").textContent = `PIN ${mobile.pin || "––––––"}`;
    $("#mobile-address").textContent = mobile.qr?.web || "Nicht verfügbar";
    $("#mobile-approval").checked = mobile.requireApproval !== false;
    $("#mobile-qr").src = mobile.qr?.webDataUrl || "";
    $("#mobile-legacy-qr").src = mobile.qr?.legacyDataUrl || "";
    $("#mobile-pending").innerHTML = (mobile.pendingClients || []).map((client) => `<article><span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.address)} · ${client.legacy ? "alte APK" : "Batto"}</small></span><div><button data-approve="${escapeHtml(client.requestId)}">Annehmen</button><button data-reject="${escapeHtml(client.requestId)}">Ablehnen</button></div></article>`).join("") || '<p class="muted-line">Keine offene Anfrage.</p>';
    $("#mobile-clients").innerHTML = (mobile.connectedClients || []).map((client) => `<article><span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.address)}</small></span><button data-revoke="${escapeHtml(client.clientId)}">Trennen</button></article>`).join("") || '<p class="muted-line">Kein Handy verbunden.</p>';
    $("#mobile-networks").innerHTML = (mobile.addresses || []).map((entry) => `<article><span><strong>${escapeHtml(entry.type)}</strong><small>${escapeHtml(entry.interfaceName)}</small></span><code>${escapeHtml(entry.address)}</code></article>`).join("") || '<p class="muted-line">Keine lokale IPv4-Adresse gefunden.</p>';
    $$('#mobile-pending [data-approve]').forEach((button) => button.addEventListener("click", () => call("mobile:approve", { requestId: button.dataset.approve }).then((value) => { state.mobile = value; renderMobile(); })));
    $$('#mobile-pending [data-reject]').forEach((button) => button.addEventListener("click", () => call("mobile:reject", { requestId: button.dataset.reject }).then((value) => { state.mobile = value; renderMobile(); })));
    $$('#mobile-clients [data-revoke]').forEach((button) => button.addEventListener("click", () => call("mobile:revoke", { clientId: button.dataset.revoke }).then((value) => { state.mobile = value; renderMobile(); })));
  }

  function renderIntegration() {
    const target = $("#integration-status");
    if (!target) return;
    const modules = state?.modules || {};
    const migration = state?.migration || {};
    const checks = [
      ["Hardwarediagnose", Boolean(state.hardware), state.hardware?.preferredGpu?.name || "Noch nicht gescannt"],
      ["OBS WebSocket", Boolean(state.obs?.connected), state.obs?.connected ? `${state.obs.host}:${state.obs.port}` : state.obs?.lastError || "Nicht verbunden"],
      ["Monitoring-Overlay", Boolean(modules.monitoring?.active || modules.monitoring?.running), modules.monitoring?.overlayUrl || modules.monitoring?.error || "Nicht aktiv"],
      ["Stream-Overlay", Boolean(modules.streamOverlay?.active), modules.streamOverlay?.overlayUrl || modules.streamOverlay?.error || "Nicht aktiv"],
      ["Twitch-Hologramm", Boolean(modules.twitchHolo?.active), modules.twitchHolo?.overlayUrl || modules.twitchHolo?.error || "Nicht aktiv"],
      ["Handy-Brücke", Boolean(state.mobile?.active), state.mobile?.active ? `Port ${state.mobile.port}` : "Nicht aktiv"],
      ["Plugin-Registry", Boolean(state.plugins?.plugins?.length), `${state.plugins?.plugins?.length || 0} Plugins · ${state.plugins?.iconPacks?.length || 0} Icon-Pakete`],
      ["Altdaten-Übernahme", !(migration.errors?.length), `${migration.profilesAdded || 0} Profile ergänzt · ${migration.copied?.length || 0} Dateien kopiert`]
    ];
    target.innerHTML = checks.map(([name, ok, detail]) => `<article class="diagnostic-card ${ok ? "ok" : "warning"}"><span>${ok ? "✓" : "!"}</span><div><strong>${escapeHtml(name)}</strong><p>${escapeHtml(detail)}</p></div></article>`).join("");
  }

  async function initialize() {
    addNavigationAndViews();
    state = await api.invoke("state:get");
    api.onStateChanged((next) => {
      state = next;
      if (activeIntegratedPage) renderIntegratedPage(activeIntegratedPage);
    });
    api.onPairRequest((request) => {
      showToast(`Handy „${request.name}“ möchte gekoppelt werden.`);
      if (activeIntegratedPage === "mobile") renderMobile();
    });
  }

  initialize().catch((error) => console.error("Integrated UI:", error));
})();
