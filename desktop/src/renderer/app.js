"use strict";

(() => {
  const api = window.batto;
  const byId = (id) => document.getElementById(id);
  const pageMeta = {
    jarvis: ['Jarvis', 'Sir Crazy · Sprache, Moderator-Nachrichten und OBS-Szenen'],
    sensors: ['PC-Messwerte', 'Messwerte auswählen, benennen und Ansagen einstellen'],
    fans: ['Lüfterbühne', 'Deine Lüfterbilder · Temperatur in der Mitte · OBS'],
    overview: ["Übersicht", "OBS, TikTok, Multi-Chat, Touch-Deck und Overlays an einem Ort."],
    obs: ["OBS-Verbindung", "OBS WebSocket 5 lokal verbinden und steuern."],
    chat: ["Multi-Chat", "TikTok, Twitch, YouTube und CNG in einem gemeinsamen Verlauf."],
    "deck-pro": ["Touch-Deck Pro", "Profile, Ordner, Tasten und OBS-Aktionen konfigurieren."],
    holo: ["Twitch-Hologramm", "Twitch-Namen und Chatfarben als OBS-Browserquelle."],
    settings: ["Einstellungen", "Plattformen, TikTok LIVE Studio, Secrets, Chat und Overlays konfigurieren."]
  };

  let state = null;
  let latestObs = null;
  let toastTimer = null;

  function showToast(message, type = "success") {
    const toast = byId("toast");
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.className = `toast${type === "error" ? " error" : ""}`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function errorMessage(error) {
    return String(error?.message || error || "Unbekannter Fehler");
  }

  function switchView(name) {
    if (!pageMeta[name]) return;
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    if (byId("page-title")) byId("page-title").textContent = pageMeta[name][0];
    if (byId("page-subtitle")) byId("page-subtitle").textContent = pageMeta[name][1];
    if (name === "holo") void loadHoloFrame();
  }

  function setObsConnected(connected, details = {}) {
    const pill = byId("obs-pill");
    if (pill) {
      pill.textContent = connected ? "OBS verbunden" : "OBS getrennt";
      pill.className = `status-pill ${connected ? "online" : "offline"}`;
    }
    const large = byId("obs-status-large");
    if (large) {
      large.textContent = connected ? "Verbunden" : "Nicht verbunden";
      large.className = `large-status ${connected ? "online" : "offline"}`;
    }
    if (byId("summary-obs")) byId("summary-obs").textContent = connected ? "Verbunden" : "Nicht verbunden";
    if (details.version?.obsVersion && byId("summary-obs-extra")) byId("summary-obs-extra").textContent = `OBS ${details.version.obsVersion}`;
    document.querySelectorAll("[data-obs-action]").forEach((button) => { button.disabled = !connected; });
    if (byId("obs-set-scene")) byId("obs-set-scene").disabled = !connected;
  }

  function renderTikTokStudio(input = {}) {
    const details = input.details && typeof input.details === "object" ? input.details : input;
    const running = Boolean(details.running || input.state === "connected");
    const installed = Boolean(details.installed || details.available || running || input.state === "ready");
    const enabled = input.enabled !== false && input.state !== "disabled";
    const path = String(details.executablePath || "").trim();

    let label = "Nicht aktiviert";
    let summary = "LIVE Studio deaktiviert";
    let className = "neutral";
    if (enabled && running) {
      label = "TikTok Studio läuft";
      summary = "LIVE Studio geöffnet";
      className = "online";
    } else if (enabled && installed) {
      label = "TikTok Studio bereit";
      summary = "LIVE Studio installiert";
      className = "neutral";
    } else if (enabled) {
      label = "TikTok Studio fehlt";
      summary = "LIVE Studio nicht gefunden";
      className = "offline";
    }

    const pill = byId("tiktok-studio-pill");
    if (pill) {
      pill.textContent = label;
      pill.className = `status-pill ${className}`;
    }
    if (byId("summary-tiktok-studio")) byId("summary-tiktok-studio").textContent = summary;
    if (byId("summary-tiktok-extra")) {
      byId("summary-tiktok-extra").textContent = path ? path.split(/[\\/]/).slice(-2).join("\\") : "LIVE Studio + API";
      byId("summary-tiktok-extra").title = path;
    }
  }

  function renderObs(snapshot = latestObs) {
    latestObs = snapshot || {};
    setObsConnected(Boolean(latestObs.connected), latestObs);
    if (byId("obs-message")) byId("obs-message").textContent = latestObs.lastError || latestObs.error?.message || "";
    const details = [
      ["Verbindung", latestObs.connected ? "Verbunden" : "Getrennt"],
      ["OBS-Version", latestObs.version?.obsVersion],
      ["WebSocket-Version", latestObs.version?.obsWebSocketVersion],
      ["Ausgabeauflösung", latestObs.video?.outputWidth && latestObs.video?.outputHeight ? `${latestObs.video.outputWidth} × ${latestObs.video.outputHeight}` : null]
    ];
    const target = byId("obs-details");
    if (target) target.innerHTML = details.map(([label, value]) => `<div><dt>${label}</dt><dd>${value || "–"}</dd></div>`).join("");
    const scenes = latestObs.scenes?.scenes || [];
    const select = byId("obs-scene-select");
    if (select) {
      select.innerHTML = scenes.length ? scenes.map((scene) => `<option>${String(scene.sceneName || "")}</option>`).join("") : "<option>Keine Szenen geladen</option>";
      if (latestObs.scenes?.currentProgramSceneName) select.value = latestObs.scenes.currentProgramSceneName;
    }
  }

  async function refreshObs() {
    try { renderObs(await api.getObsSnapshot()); }
    catch (error) { showToast(errorMessage(error), "error"); }
  }

  async function refreshTikTokStudio() {
    try {
      const statuses = await api.hybridStatus();
      if (statuses?.tiktokLiveStudio) renderTikTokStudio(statuses.tiktokLiveStudio);
      else renderTikTokStudio(await api.detectTikTokLiveStudio());
    } catch (error) {
      renderTikTokStudio({ state: "unavailable", enabled: true });
      console.error("TikTok LIVE Studio Status konnte nicht geladen werden:", error);
    }
  }

  async function connectObs() {
    const button = byId("obs-connect");
    if (button) button.disabled = true;
    try {
      const result = await api.connectObs({
        host: "127.0.0.1",
        port: Number(byId("obs-port")?.value || 4455),
        password: byId("obs-password")?.value || "",
        rememberPassword: byId("obs-remember")?.checked !== false
      });
      if (byId("obs-password")) byId("obs-password").value = "";
      renderObs(await api.getObsSnapshot());
      showToast(result?.connected === false ? "OBS konnte nicht verbunden werden." : "OBS verbunden.", result?.connected === false ? "error" : "success");
    } catch (error) {
      showToast(`OBS-Verbindung fehlgeschlagen: ${errorMessage(error)}`, "error");
      await refreshObs();
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function executeObs(action, payload = {}) {
    try {
      await api.executeObs(action, payload);
      await refreshObs();
      showToast(`OBS-Aktion ausgeführt: ${action}`);
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  async function loadHoloFrame() {
    try {
      const status = await api.getHoloStatus();
      if (byId("holo-url")) byId("holo-url").textContent = status.overlayUrl || "Nicht gestartet";
      const frame = byId("holo-frame");
      if (frame && status.editorUrl && frame.src !== status.editorUrl) frame.src = status.editorUrl;
    } catch (error) {
      showToast(errorMessage(error), "error");
    }
  }

  function bindEvents() {
    document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
    document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.jump)));
    byId("overview-connect-obs")?.addEventListener("click", () => switchView("obs"));
    byId("obs-connect")?.addEventListener("click", () => void connectObs());
    byId("obs-disconnect")?.addEventListener("click", async () => { await api.disconnectObs(); renderObs(await api.getObsSnapshot()); });
    byId("obs-forget-password")?.addEventListener("click", async () => { await api.forgetObsPassword(); showToast("Gespeichertes OBS-Passwort entfernt."); });
    byId("obs-refresh")?.addEventListener("click", () => void refreshObs());
    document.querySelectorAll("[data-obs-action]").forEach((button) => button.addEventListener("click", () => void executeObs(button.dataset.obsAction)));
    byId("obs-set-scene")?.addEventListener("click", () => void executeObs("scene.set", { sceneName: byId("obs-scene-select")?.value || "" }));
    byId("holo-copy")?.addEventListener("click", async () => {
      try { showToast(`OBS-Adresse kopiert: ${await api.copyHoloUrl()}`); }
      catch (error) { showToast(errorMessage(error), "error"); }
    });
    byId("holo-external")?.addEventListener("click", () => void api.openHoloEditor());
    api.onObsStatusChanged?.((status) => setObsConnected(Boolean(status?.connected), status || {}));
    api.onConnectionStatus?.((status) => {
      if (status?.name === "tiktokLiveStudio") renderTikTokStudio(status);
    });
  }

  async function initialize() {
    if (!api) throw new Error("Batto Desktop API ist nicht verfügbar.");
    state = await api.getState();
    latestObs = state.obs || {};
    if (byId("version-label")) byId("version-label").textContent = `Version ${state.product.version}`;
    if (byId("obs-port")) byId("obs-port").value = state.settings?.obs?.port || 4455;
    renderObs(latestObs);
    bindEvents();
    switchView("jarvis");
    await refreshTikTokStudio();
    window.__battoRendererReady = { ok: true, version: state.product.version };
  }

  initialize().catch((error) => {
    console.error(error);
    window.__battoRendererReady = { ok: false, error: errorMessage(error) };
    showToast(`Batto OBS Tool konnte nicht geladen werden: ${errorMessage(error)}`, "error");
  });
})();
