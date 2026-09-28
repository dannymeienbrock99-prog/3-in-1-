"use strict";

(() => {
  const api = window.batto;
  if (!api) {
    document.body.textContent = "Batto OBS Tool konnte die sichere Desktop-Brücke nicht laden.";
    return;
  }

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    data: null,
    page: "overview",
    currentProfileId: "",
    currentFolderId: "root",
    editingButtonIndex: -1,
    editingActions: [],
    initialized: false,
    chatMessages: []
  };

  const pageMeta = {
    overview: ["Übersicht", "Lokale Steuerung, Diagnose und Stream-Werkzeuge."],
    hardware: ["Hardwarediagnose", "Tatsächlich verbaute Komponenten und installierte Geräte lokal erfassen."],
    internet: ["Internettest", "Upload, Download und Latenz unter realen Bedingungen prüfen."],
    obs: ["OBS-Verbindung", "OBS WebSocket lokal verbinden und steuern."],
    encoder: ["Encoder-Empfehlung", "Passende OBS-Werte aus Hardware und Verbindung ableiten."],
    load: ["Belastungstest", "Bestätigungspflichtige CPU- und OBS-Aufnahmetests."],
    monitoring: ["Monitoring-Overlay", "Das neue transparente Hardware- und Encoder-Monitoring."],
    "stream-overlay": ["Stream-Overlay", "Chat, Ziele, Geschenke, Wheel und Team-Logo."],
    multichat: ["Multi-Chat", "Twitch, YouTube und lokale Plattform-Webhooks."],
    guests: ["OBS-Gäste", "Co-Host- und Gastquellen in OBS verwalten."],
    hologram: ["Twitch-Hologramm", "Kostenlose Hologrammfarben für Namen und Nachrichten."],
    deck: ["Touch-Deck", "Profile, Ordner, Mehrfachaktionen und Plugin-Aktionen."],
    plugins: ["Plugins", "Native Batto-Aktionen und erkannte Plugin-Pakete."],
    mobile: ["Handy verbinden", "Lokale Kopplung über QR-Code, PIN und WebSocket."],
    settings: ["Einstellungen", "Startverhalten, Migration und lokale Datenspeicherung."]
  };

  const ACTION_TYPES = [
    ["delay", "Warten / Verzögerung"],
    ["system.launch", "Programm oder Datei öffnen"],
    ["system.openUrl", "Webseite öffnen"],
    ["system.hotkey", "Tastenkombination senden"],
    ["system.media", "Mediensteuerung"],
    ["system.volume", "Systemlautstärke"],
    ["obs.scene", "OBS-Szene schalten"],
    ["obs.source.toggle", "OBS-Quelle ein/aus"],
    ["obs.mute", "OBS-Audio Mute umschalten"],
    ["obs.stream.toggle", "OBS-Stream Start/Stop"],
    ["obs.record.toggle", "OBS-Aufnahme Start/Stop"],
    ["obs.virtualCam.toggle", "OBS virtuelle Kamera"],
    ["overlay.event", "Stream-Overlay-Ereignis"],
    ["overlay.wheel", "Glücksrad drehen"],
    ["multichat.send", "Chatnachricht senden"],
    ["tts.speak", "Text vorlesen"],
    ["discord.open", "Discord öffnen"],
    ["spotify.media", "Spotify/Medienbefehl"],
    ["youtube.open", "YouTube öffnen"],
    ["youtube.refresh", "YouTube-Ticker aktualisieren"],
    ["tiktok.open", "TikTok LIVE Studio öffnen"],
    ["tikfinity.open", "TikFinity öffnen"],
    ["obsbot.open", "OBSBOT Center öffnen"],
    ["plugin.action", "Erkannte Plugin-Aktion"]
  ];

  function node(tag, options = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
      if (key === "class") element.className = value;
      else if (key === "text") element.textContent = value == null ? "" : String(value);
      else if (key === "dataset") Object.assign(element.dataset, value);
      else if (key === "style" && value && typeof value === "object") Object.assign(element.style, value);
      else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child == null) continue;
      element.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return element;
  }

  function clear(element) {
    element?.replaceChildren();
  }

  function value(path, fallback = "") {
    const paths = Array.isArray(path) ? path : [path];
    for (const candidate of paths) {
      const parts = String(candidate).split(".");
      let current = state.data;
      for (const part of parts) current = current?.[part];
      if (current !== undefined && current !== null && current !== "") return current;
    }
    return fallback;
  }

  function formatNumber(input, digits = 1) {
    const number = Number(input);
    return Number.isFinite(number) ? number.toLocaleString("de-DE", { maximumFractionDigits: digits }) : "Nicht verfügbar";
  }

  function formatBytes(bytes) {
    const number = Number(bytes);
    if (!Number.isFinite(number)) return "Nicht verfügbar";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let index = 0;
    let result = number;
    while (result >= 1024 && index < units.length - 1) { result /= 1024; index += 1; }
    return `${formatNumber(result, index < 2 ? 0 : 2)} ${units[index]}`;
  }

  function normalizeError(error) {
    if (error?.message) return error.message;
    if (typeof error === "string") return error;
    try { return JSON.stringify(error); } catch { return "Unbekannter Fehler"; }
  }

  function toast(message, error = false) {
    const target = $("toast");
    target.textContent = String(message || "");
    target.className = `toast show${error ? " error" : ""}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { target.className = "toast"; target.textContent = ""; }, 5000);
  }

  async function invoke(channel, payload, successMessage = "") {
    try {
      const result = await api.invoke(channel, payload);
      if (result?.ok === false) throw new Error(result.error?.message || result.error || "Aktion fehlgeschlagen");
      if (successMessage) toast(successMessage);
      if (result?.state) applyState(result.state);
      return result;
    } catch (error) {
      toast(normalizeError(error), true);
      throw error;
    }
  }

  async function confirmAction(title, text) {
    const dialog = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    return new Promise((resolve) => {
      const handler = () => {
        dialog.removeEventListener("close", handler);
        resolve(dialog.returnValue === "ok");
      };
      dialog.addEventListener("close", handler);
      dialog.showModal();
    });
  }

  function showPage(page) {
    if (!pageMeta[page]) page = "overview";
    state.page = page;
    $$("[data-page-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
    $$("#main-nav [data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
    $("page-title").textContent = pageMeta[page][0];
    $("page-description").textContent = pageMeta[page][1];
    document.querySelector(".page-container")?.scrollTo({ top: 0, behavior: "instant" });
    if (page === "guests") renderGuests();
    if (page === "plugins") renderPlugins();
    if (page === "deck") renderDeck();
  }

  function metricCard(label, main, detail = "", kind = "") {
    return node("article", { class: `metric-card ${kind}`.trim() },
      node("div", { class: "label", text: label }),
      node("strong", { text: main }),
      node("small", { text: detail })
    );
  }

  function keyValue(label, content) {
    return node("div", { class: "key-value" }, node("span", { text: label }), node("strong", { text: content ?? "Nicht verfügbar" }));
  }

  function statusPill(element, active, activeText, inactiveText) {
    element.textContent = active ? activeText : inactiveText;
    element.className = `pill ${active ? "success" : "danger"}`;
  }

  function applyState(nextState) {
    if (!nextState || typeof nextState !== "object") return;
    state.data = nextState;
    $("version-label").textContent = `Version ${nextState.version || "2.0.0"}`;
    statusPill($("obs-status"), Boolean(nextState.obs?.connected), "OBS verbunden", "OBS getrennt");
    const hwReady = Boolean(nextState.hardware && !nextState.hardwareBusy);
    $("hardware-status").textContent = nextState.hardwareBusy ? "Diagnose läuft" : hwReady ? "Hardware erkannt" : "Hardware ausstehend";
    $("hardware-status").className = `pill ${hwReady ? "success" : nextState.hardwareBusy ? "warning" : ""}`;
    $("hardware-progress").hidden = !nextState.hardwareBusy;
    renderOverview();
    renderHardware();
    renderInternet();
    renderObs();
    renderRecommendation();
    renderModules();
    renderChat();
    renderDeck();
    renderPlugins();
    renderMobile();
    renderSettings();
    if (!state.initialized) {
      state.initialized = true;
      const startPage = nextState.settings?.startPage || "overview";
      showPage(startPage);
    }
  }

  function renderOverview() {
    const root = $("overview-cards");
    clear(root);
    const hw = state.data?.hardware || {};
    const preferredGpu = hw.preferredGpu || hw.gpus?.find?.((gpu) => gpu.preferred) || hw.gpus?.[0] || {};
    root.append(
      metricCard("Prozessor", hw.cpu?.model || hw.cpu?.name || "Noch nicht gescannt", hw.cpu ? `${hw.cpu.cores || "?"} Kerne · ${hw.cpu.threads || "?"} Threads` : "Hardwarediagnose starten"),
      metricCard("Grafikkarte", preferredGpu.name || preferredGpu.model || "Noch nicht erkannt", preferredGpu.memoryGb ? `${formatNumber(preferredGpu.memoryGb, 1)} GB VRAM` : "Dedizierte GPU wird bevorzugt"),
      metricCard("OBS", state.data?.obs?.connected ? "Verbunden" : "Getrennt", state.data?.obs?.connected ? `${state.data.obs.currentScene || "Szene unbekannt"}` : "127.0.0.1:4455", state.data?.obs?.connected ? "success" : "danger"),
      metricCard("Handy", `${state.data?.mobile?.clients?.length || state.data?.mobile?.connectedClients?.length || 0} verbunden`, state.data?.mobile?.running ? `Port ${state.data.mobile.port || 48620}` : "Lokaler Server nicht aktiv", state.data?.mobile?.running ? "success" : "warning")
    );
  }

  function renderHardware() {
    const root = $("hardware-cards");
    if (!root || !state.data) return;
    clear(root);
    const hw = state.data.hardware;
    if (!hw) {
      root.append(metricCard("Hardware", "Noch nicht erfasst", "Mit „PC jetzt scannen“ die lokale Diagnose starten."));
      return;
    }
    const cpu = hw.cpu || {};
    const ram = hw.ram || hw.memory || {};
    const board = hw.mainboard || hw.board || {};
    const obs = hw.obs || hw.obsStudio || {};
    const cpuPanel = node("article", { class: "panel" }, node("h2", { text: "Prozessor" }),
      keyValue("Modell", cpu.model || cpu.name), keyValue("Hersteller", cpu.manufacturer || cpu.vendor),
      keyValue("Kerne / Threads", `${cpu.cores ?? "?"} / ${cpu.threads ?? "?"}`), keyValue("Maximaler Takt", cpu.maxClockMhz ? `${formatNumber(cpu.maxClockMhz, 0)} MHz` : "Nicht verfügbar"), keyValue("Sockel", cpu.socket));
    const ramPanel = node("article", { class: "panel" }, node("h2", { text: "Arbeitsspeicher" }),
      keyValue("Gesamt", ram.totalGb != null ? `${formatNumber(ram.totalGb, 1)} GB` : ram.total), keyValue("Module", ram.modules?.length ?? ram.moduleCount),
      keyValue("Takt", ram.speedMts ? `${formatNumber(ram.speedMts, 0)} MT/s` : ram.speed), keyValue("Teilenummern", ram.modules?.map?.((item) => item.partNumber).filter(Boolean).join(", ") || ram.partNumbers));
    const boardPanel = node("article", { class: "panel" }, node("h2", { text: "Mainboard und BIOS" }),
      keyValue("Hersteller", board.manufacturer || board.vendor), keyValue("Mainboard", board.model || board.product),
      keyValue("Version", board.version), keyValue("BIOS", hw.bios?.version || board.biosVersion), keyValue("BIOS-Hersteller", hw.bios?.manufacturer || board.biosVendor));
    const obsPanel = node("article", { class: "panel" }, node("h2", { text: "OBS Studio" }),
      keyValue("Installiert", obs.installed === false ? "Nein" : obs.installed === true ? "Ja" : obs.version ? "Ja" : "Nicht erkannt"),
      keyValue("Version", obs.version), keyValue("Pfad", obs.path || obs.executable));
    const gpuPanel = node("article", { class: "panel", style: { gridColumn: "1 / -1" } }, node("h2", { text: "Grafikkarten" }));
    const gpus = Array.isArray(hw.gpus) ? hw.gpus : hw.gpu ? [hw.gpu] : [];
    if (!gpus.length) gpuPanel.append(keyValue("GPU", "Nicht erkannt"));
    gpus.forEach((gpu, index) => {
      const suffix = gpu.preferred || gpu.dedicated && !gpu.integrated ? " · bevorzugt" : "";
      gpuPanel.append(keyValue(`GPU ${index + 1}${suffix}`, gpu.name || gpu.model), keyValue("Speicher / Treiber", `${gpu.memoryGb != null ? `${formatNumber(gpu.memoryGb, 2)} GB` : "?"} · ${gpu.driverVersion || "Treiber unbekannt"}`));
    });
    const extraPanel = node("article", { class: "panel", style: { gridColumn: "1 / -1" } }, node("h2", { text: "Weitere Geräte" }));
    const monitors = hw.monitors || [];
    const disks = hw.disks || hw.storage || [];
    const networks = hw.networkAdapters || hw.network || [];
    extraPanel.append(
      keyValue("Monitore", Array.isArray(monitors) ? monitors.map((item) => item.name || item.model || `${item.width}×${item.height}`).filter(Boolean).join(" · ") : monitors),
      keyValue("Datenträger", Array.isArray(disks) ? disks.map((item) => `${item.model || item.name}${item.sizeGb ? ` (${formatNumber(item.sizeGb, 0)} GB)` : ""}`).join(" · ") : disks),
      keyValue("Netzwerk", Array.isArray(networks) ? networks.filter((item) => item.connected || item.active).map((item) => `${item.name || item.description}${item.speedMbps ? ` · ${formatNumber(item.speedMbps, 0)} Mbit/s` : ""}`).join(" · ") : networks)
    );
    root.append(cpuPanel, ramPanel, boardPanel, obsPanel, gpuPanel, extraPanel);
  }

  function renderInternet() {
    const root = $("internet-results");
    if (!root) return;
    clear(root);
    const result = state.data?.internet;
    root.append(
      metricCard("Download", result?.downloadMbps != null ? `${formatNumber(result.downloadMbps, 2)} Mbit/s` : "Nicht getestet", "Gemessene Empfangsrate"),
      metricCard("Upload", result?.uploadMbps != null ? `${formatNumber(result.uploadMbps, 2)} Mbit/s` : "Nicht getestet", "Für Stream-Bitrate entscheidend"),
      metricCard("Latenz", result?.latencyMs != null ? `${formatNumber(result.latencyMs, 0)} ms` : "Nicht getestet", "Antwortzeit der Verbindung"),
      metricCard("Status", result?.success ? "Erfolgreich" : result?.error ? "Fehler" : "Bereit", result?.error?.message || result?.provider || "Test noch nicht gestartet", result?.success ? "success" : result?.error ? "danger" : "")
    );
  }

  function renderObs() {
    const obs = state.data?.obs || {};
    if (!state.initialized || !document.activeElement?.matches?.("#obs-host,#obs-port,#obs-password")) {
      $("obs-host").value = obs.settings?.host || obs.host || "127.0.0.1";
      $("obs-port").value = obs.settings?.port || obs.port || 4455;
      $("obs-auto").checked = obs.settings?.autoConnect !== false;
    }
    $("obs-error").textContent = obs.error?.message || obs.lastError?.message || "";
    const encoderRoot = $("active-encoder");
    clear(encoderRoot);
    const output = obs.output || obs.snapshot?.output || {};
    const encoder = obs.encoder || obs.snapshot?.encoder || {};
    encoderRoot.append(node("h2", { text: output.active || output.streamActive || output.recordActive ? "Aktiver Encoder" : "Encoder" }),
      node("div", { class: "encoder-name", text: encoder.name || encoder.id || encoder.encoder || "Nicht verfügbar" }),
      keyValue("Codec", encoder.codec || encoder.videoFormat), keyValue("Rate Control", encoder.rateControl || encoder.rate_control),
      keyValue("Preset", encoder.preset), keyValue("Profil", encoder.profile), keyValue("Bitrate", encoder.bitrateKbps != null ? `${formatNumber(encoder.bitrateKbps, 0)} Kbit/s` : encoder.bitrate),
      keyValue("Auflösung", obs.video?.outputWidth ? `${obs.video.outputWidth} × ${obs.video.outputHeight}` : obs.video?.resolution), keyValue("FPS", obs.video?.fps || obs.video?.outputFps));

    fillSelect($("obs-scene-select"), obs.scenes || obs.snapshot?.scenes || [], obs.currentScene || obs.snapshot?.currentScene, (item) => typeof item === "string" ? item : item.sceneName || item.name);
    fillSelect($("obs-audio-select"), obs.audioSources || obs.snapshot?.audioSources || obs.inputs || [], "", (item) => typeof item === "string" ? item : item.inputName || item.name);
    fillSelect($("guest-scene"), obs.scenes || [], $("guest-scene").value, (item) => typeof item === "string" ? item : item.sceneName || item.name);

    const details = $("obs-details");
    clear(details);
    details.append(node("h2", { text: "OBS-Status" }),
      keyValue("Verbindung", obs.connected ? "Verbunden" : "Getrennt"),
      keyValue("OBS-Version", obs.obsVersion || obs.version || obs.snapshot?.obsVersion),
      keyValue("WebSocket-Version", obs.obsWebSocketVersion || obs.websocketVersion),
      keyValue("Aktuelle Szene", obs.currentScene || obs.snapshot?.currentScene),
      keyValue("Stream", output.streamActive ? "Aktiv" : "Inaktiv"),
      keyValue("Aufnahme", output.recordActive ? "Aktiv" : "Inaktiv"),
      keyValue("OBS-CPU", obs.stats?.cpuUsage != null ? `${formatNumber(obs.stats.cpuUsage, 1)} %` : "Nicht verfügbar"),
      keyValue("Render-Lag", obs.stats?.renderSkippedFrames ?? obs.stats?.renderMissedFrames),
      keyValue("Encoding-Lag", obs.stats?.outputSkippedFrames ?? obs.stats?.skippedFrames),
      keyValue("Netzwerk-Drops", output.droppedFrames ?? obs.stats?.droppedFrames));
  }

  function fillSelect(select, items, selected, labelGetter) {
    if (!select) return;
    const current = selected || select.value;
    clear(select);
    if (!items?.length) {
      select.append(node("option", { value: "", text: state.data?.obs?.connected ? "Keine Einträge" : "OBS verbinden" }));
      return;
    }
    for (const item of items) {
      const label = labelGetter(item);
      const option = node("option", { value: label, text: label });
      if (label === current) option.selected = true;
      select.append(option);
    }
  }

  function renderRecommendation() {
    const recommendation = state.data?.recommendation;
    const root = $("recommendation-card");
    clear(root);
    if (!recommendation) {
      root.append(node("h2", { text: "Noch keine Empfehlung" }), node("p", { text: "Hardware scannen, Internettest ausführen und anschließend neu berechnen." }));
      return;
    }
    root.append(node("h2", { text: recommendation.title || "Empfohlene OBS-Ausgabe" }));
    const grid = node("div", { class: "recommendation-grid" });
    const entries = [
      ["GPU", recommendation.gpu || recommendation.gpuName], ["Encoder", recommendation.encoder], ["Codec", recommendation.codec],
      ["Rate Control", recommendation.rateControl], ["Bitrate", recommendation.bitrateKbps != null ? `${formatNumber(recommendation.bitrateKbps, 0)} Kbit/s` : recommendation.bitrate],
      ["Preset", recommendation.preset], ["Profil", recommendation.profile], ["Keyframe", recommendation.keyframeInterval != null ? `${recommendation.keyframeInterval} s` : recommendation.keyframe],
      ["B-Frames", recommendation.bFrames], ["Look-ahead", recommendation.lookahead], ["Psycho Visual Tuning", recommendation.psychoVisualTuning], ["Multipass", recommendation.multipass]
    ];
    entries.forEach(([label, val]) => grid.append(metricCard(label, val ?? "Nicht verfügbar")));
    root.append(grid);
    if (recommendation.notes?.length) root.append(node("div", { class: "notice warning" }, node("strong", { text: "Hinweise" }), ...recommendation.notes.map((note) => node("p", { text: note }))));
  }

  function renderModules() {
    const modules = state.data?.modules || {};
    const monitoring = modules.monitoring || state.data?.monitoring || {};
    const streamOverlay = modules.streamOverlay || state.data?.streamOverlay || {};
    const holo = modules.hologram || modules.holo || state.data?.hologram || {};
    renderModuleCards($("monitoring-info"), monitoring, "Monitoring", 17822);
    renderModuleCards($("stream-overlay-info"), streamOverlay, "Stream-Overlay", 48621);
    renderModuleCards($("holo-info"), holo, "Twitch-Hologramm", 17821);
    $("local-chat-url").value = state.data?.chat?.localIngestUrl || streamOverlay.chatIngestUrl || "http://127.0.0.1:48621/api/chat";
  }

  function renderModuleCards(root, module, label, fallbackPort) {
    if (!root) return;
    clear(root);
    root.append(
      metricCard("Status", module.running || module.active ? "Lokal aktiv" : module.error ? "Fehler" : "Nicht aktiv", module.error?.message || "Keine Cloud-Verbindung erforderlich", module.running || module.active ? "success" : module.error ? "danger" : "warning"),
      metricCard("Lokaler Port", module.port || fallbackPort, module.host || "127.0.0.1"),
      metricCard("OBS-Browserquelle", module.overlayUrl || module.url || `http://127.0.0.1:${module.port || fallbackPort}/overlay`, "Nur lokal erreichbar")
    );
  }

  function renderChat() {
    const chat = state.data?.chat || {};
    if (!state.initialized) {
      $("chat-forward-overlay").checked = chat.settings?.forwardToOverlay !== false;
      $("tts-enabled").checked = Boolean(chat.settings?.tts?.enabled);
      $("twitch-channel").value = chat.settings?.twitch?.channel || "";
      $("youtube-chat-id").value = chat.settings?.youtube?.liveChatId || "";
    }
    const toggles = $("platform-toggles");
    clear(toggles);
    const platforms = ["Twitch", "YouTube", "TikTok", "TikFinity", "Tiktory"];
    platforms.forEach((platform) => {
      const key = platform.toLowerCase();
      const input = node("input", { type: "checkbox", checked: chat.settings?.platforms?.[key] !== false });
      input.checked = chat.settings?.platforms?.[key] !== false;
      input.addEventListener("change", () => updateChatSettings());
      toggles.append(node("label", { class: "check" }, input, platform));
    });
    $("chat-status").textContent = [chat.twitch?.connected ? "Twitch verbunden" : "Twitch getrennt", chat.youtube?.connected ? "YouTube verbunden" : "YouTube getrennt"].join(" · ");
    if (Array.isArray(chat.messages) && chat.messages.length) state.chatMessages = chat.messages.slice(-300);
    drawChatMessages();
  }

  function drawChatMessages() {
    const root = $("chat-messages");
    clear(root);
    if (!state.chatMessages.length) {
      root.append(node("p", { text: "Noch keine Nachricht empfangen.", style: { textAlign: "center", color: "#8092a3", marginTop: "40px" } }));
      return;
    }
    for (const message of state.chatMessages.slice(-300)) {
      root.append(node("article", { class: "chat-message" },
        node("span", { class: "platform", text: message.platform || "lokal" }),
        node("span", { class: "user", text: message.displayName || message.user || message.username || "Zuschauer" }),
        node("span", { class: "text", text: message.text || "" })
      );
    }
    root.scrollTop = root.scrollHeight;
  }

  function currentProfile() {
    const profiles = state.data?.deck?.profiles || [];
    if (!state.currentProfileId || !profiles.some((profile) => profile.id === state.currentProfileId)) {
      state.currentProfileId = state.data?.deck?.activeProfileId || profiles[0]?.id || "";
    }
    return profiles.find((profile) => profile.id === state.currentProfileId) || null;
  }

  function folderMap(profile) {
    const result = new Map();
    const folders = profile?.folders || [];
    result.set("root", { id: "root", name: "Hauptseite", parentId: null, buttons: profile?.buttons || [] });
    folders.forEach((folder) => result.set(folder.id, folder));
    return result;
  }

  function currentFolder(profile) {
    const map = folderMap(profile);
    if (!map.has(state.currentFolderId)) state.currentFolderId = "root";
    return map.get(state.currentFolderId);
  }

  function renderDeck() {
    if (!state.data || state.page !== "deck" && !$("deck-profile")) return;
    const deck = state.data.deck || { profiles: [] };
    const profiles = deck.profiles || [];
    const profileSelect = $("deck-profile");
    if (!profileSelect) return;
    const profile = currentProfile();
    clear(profileSelect);
    profiles.forEach((item) => profileSelect.append(node("option", { value: item.id, text: item.name || "Profil", selected: item.id === state.currentProfileId })));
    if (!profile) {
      $("deck-grid").replaceChildren(node("p", { text: "Noch kein Profil vorhanden." }));
      return;
    }
    const folders = folderMap(profile);
    const folder = currentFolder(profile);
    const folderSelect = $("deck-folder");
    clear(folderSelect);
    [...folders.values()].forEach((item) => folderSelect.append(node("option", { value: item.id, text: item.name, selected: item.id === folder.id })));
    $("deck-rows").value = folder.rows || profile.rows || 3;
    $("deck-columns").value = folder.columns || profile.columns || 5;
    $("deck-hide-unused").checked = Boolean(folder.hideUnused ?? profile.hideUnused);
    $("deck-button-size").value = folder.buttonSize || profile.buttonSize || 112;
    $("deck-gap").value = folder.gap ?? profile.gap ?? 10;
    const crumbs = [];
    let cursor = folder;
    while (cursor) { crumbs.unshift(cursor); cursor = cursor.parentId ? folders.get(cursor.parentId) : null; }
    $("deck-breadcrumb").textContent = crumbs.map((item) => item.name).join(" › ");
    const rows = Number($("deck-rows").value) || 3;
    const columns = Number($("deck-columns").value) || 5;
    const total = Math.max(1, Math.min(100, rows * columns));
    const buttons = Array.isArray(folder.buttons) ? folder.buttons : [];
    const grid = $("deck-grid");
    grid.style.gridTemplateColumns = `repeat(${columns}, var(--deck-size, 112px))`;
    grid.style.setProperty("--deck-size", `${Number($("deck-button-size").value)}px`);
    grid.style.setProperty("--deck-gap", `${Number($("deck-gap").value)}px`);
    clear(grid);
    for (let index = 0; index < total; index += 1) {
      const button = buttons[index] || null;
      if (!button && $("deck-hide-unused").checked) continue;
      const item = node("button", {
        type: "button",
        class: `deck-button${button ? "" : " empty"}`,
        draggable: "true",
        dataset: { index: String(index) },
        style: { background: button?.color || (button ? "#182536" : "#0c131c"), color: button?.textColor || "#ffffff" }
      });
      if (button?.folderId) item.append(node("span", { class: "folder-indicator", text: "▸" }));
      if (button?.icon) item.append(node("img", { src: button.icon, alt: "" }));
      item.append(node("strong", { text: button?.title || (button ? "Taste" : `Taste ${index + 1}`) }));
      if (button?.subtitle) item.append(node("small", { text: button.subtitle }));
      item.addEventListener("click", async (event) => {
        if (event.detail > 1) return;
        if (!button) return openButtonEditor(index);
        if (button.folderId && folders.has(button.folderId)) { state.currentFolderId = button.folderId; renderDeck(); return; }
        await invoke("deck:command", { command: "execute", profileId: profile.id, folderId: folder.id, index });
      });
      item.addEventListener("dblclick", (event) => { event.preventDefault(); openButtonEditor(index); });
      item.addEventListener("contextmenu", (event) => { event.preventDefault(); openButtonEditor(index); });
      item.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", String(index)); item.classList.add("dragging"); });
      item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (event) => event.preventDefault());
      item.addEventListener("drop", async (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer.getData("text/plain"));
        if (!Number.isInteger(from) || from === index) return;
        await invoke("deck:command", { command: "moveButton", profileId: profile.id, folderId: folder.id, from, to: index });
      });
      grid.append(item);
    }
  }

  function openButtonEditor(index) {
    const profile = currentProfile();
    const folder = currentFolder(profile);
    const button = folder?.buttons?.[index] || {};
    state.editingButtonIndex = index;
    state.editingActions = Array.isArray(button.actions) ? structuredClone(button.actions) : button.action ? [structuredClone(button.action)] : [];
    $("button-title").value = button.title || "";
    $("button-subtitle").value = button.subtitle || "";
    $("button-color").value = /^#[0-9a-f]{6}$/i.test(button.color || "") ? button.color : "#182536";
    $("button-text-color").value = /^#[0-9a-f]{6}$/i.test(button.textColor || "") ? button.textColor : "#ffffff";
    $("button-icon").value = button.icon || "";
    const target = $("button-folder-target");
    clear(target);
    target.append(node("option", { value: "", text: "Keine Ordnernavigation" }));
    for (const item of folderMap(profile).values()) {
      if (item.id === folder.id || item.id === "root" && folder.id === "root") continue;
      target.append(node("option", { value: item.id, text: item.name, selected: item.id === button.folderId }));
    }
    renderActionEditor();
    $("button-dialog").showModal();
  }

  function renderActionEditor() {
    const root = $("button-action-list");
    clear(root);
    if (!state.editingActions.length) root.append(node("p", { text: "Keine Aktion. Mit „Aktion hinzufügen“ eine Aktion anlegen.", style: { color: "#8297a9" } }));
    state.editingActions.forEach((action, index) => {
      const select = node("select");
      ACTION_TYPES.forEach(([value, label]) => select.append(node("option", { value, text: label, selected: value === action.type })));
      select.value = action.type || "delay";
      const settings = { ...action };
      delete settings.type;
      delete settings.delayMs;
      const textarea = node("textarea", { class: "action-settings", rows: "2" });
      textarea.value = JSON.stringify(settings, null, 0);
      const delay = node("input", { type: "number", min: "0", max: "600000", value: action.delayMs || 0 });
      select.addEventListener("change", () => { state.editingActions[index].type = select.value; });
      textarea.addEventListener("change", () => {
        try {
          const parsed = textarea.value.trim() ? JSON.parse(textarea.value) : {};
          state.editingActions[index] = { type: select.value, delayMs: Number(delay.value) || 0, ...parsed };
          textarea.setCustomValidity("");
        } catch { textarea.setCustomValidity("Gültiges JSON erforderlich"); textarea.reportValidity(); }
      });
      delay.addEventListener("change", () => { state.editingActions[index].delayMs = Number(delay.value) || 0; });
      root.append(node("div", { class: "action-editor-row" },
        node("span", { class: "handle", text: "⋮⋮" }),
        node("label", {}, "Aktion", select),
        node("label", {}, "Einstellungen als JSON", textarea),
        node("label", {}, "Warten ms", delay),
        node("button", { type: "button", text: "✕", class: "danger-button", onclick: () => { state.editingActions.splice(index, 1); renderActionEditor(); } })
      ));
    });
  }

  async function saveButtonEditor(clearButton = false) {
    const profile = currentProfile();
    const folder = currentFolder(profile);
    if (!profile || !folder || state.editingButtonIndex < 0) return;
    if (clearButton) {
      await invoke("deck:command", { command: "setButton", profileId: profile.id, folderId: folder.id, index: state.editingButtonIndex, button: null }, "Taste wurde geleert.");
    } else {
      const actions = [];
      for (const [index, row] of $$(".action-editor-row").entries()) {
        const select = row.querySelector("select");
        const textarea = row.querySelector("textarea");
        const delay = row.querySelector('input[type="number"]');
        let parsed = {};
        try { parsed = textarea.value.trim() ? JSON.parse(textarea.value) : {}; }
        catch { textarea.setCustomValidity("Gültiges JSON erforderlich"); textarea.reportValidity(); return; }
        actions.push({ type: select.value, delayMs: Number(delay.value) || 0, ...parsed });
        state.editingActions[index] = actions[index];
      }
      const button = {
        title: $("button-title").value.trim(), subtitle: $("button-subtitle").value.trim(), color: $("button-color").value,
        textColor: $("button-text-color").value, icon: $("button-icon").value.trim(), folderId: $("button-folder-target").value || null, actions
      };
      await invoke("deck:command", { command: "setButton", profileId: profile.id, folderId: folder.id, index: state.editingButtonIndex, button }, "Taste gespeichert.");
    }
    $("button-dialog").close();
  }

  function renderPlugins() {
    const plugins = state.data?.plugins || {};
    const list = Array.isArray(plugins.items) ? plugins.items : Array.isArray(plugins.plugins) ? plugins.plugins : [];
    const summary = $("plugin-summary");
    clear(summary);
    summary.append(metricCard("Plugins", list.length, "Native und erkannte Pakete"), metricCard("Aktiv", list.filter((item) => item.enabled !== false).length, "Deaktivierte Pakete werden nicht ausgeführt"), metricCard("Icon-Pakete", plugins.iconPacks?.length || 0, "LS25 und weitere erkannte Sammlungen"));
    const root = $("plugin-list");
    clear(root);
    if (!list.length) { root.append(node("div", { class: "panel", text: "Noch keine Plugins erkannt." })); return; }
    const groups = new Map();
    for (const plugin of list) {
      const category = plugin.category || plugin.categories?.[0] || "Weitere";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(plugin);
    }
    for (const [category, items] of groups) {
      const body = node("div", { class: "plugin-body" });
      items.forEach((plugin) => {
        const actions = plugin.actions || [];
        const toggle = node("input", { type: "checkbox" });
        toggle.checked = plugin.enabled !== false;
        toggle.addEventListener("change", () => invoke("plugins:setEnabled", { id: plugin.id, enabled: toggle.checked }));
        const icon = plugin.icon ? node("img", { src: plugin.icon, alt: "" }) : node("div", { class: "plugin-placeholder", text: "◈" });
        body.append(node("article", { class: "plugin-card" }, icon,
          node("div", {}, node("h3", { text: `${plugin.name || plugin.id}${plugin.version ? ` · ${plugin.version}` : ""}` }), node("p", { text: plugin.description || plugin.source || "" }), node("div", { class: "plugin-actions" }, ...actions.slice(0, 25).map((action) => node("span", { class: "plugin-action-chip", text: action.name || action.title || action.id })) )),
          node("label", { class: "check" }, toggle, "Aktiv")
        ));
      });
      const group = node("section", { class: "plugin-group" });
      const toggle = node("button", { type: "button" }, node("strong", { text: category }), node("span", { text: `${items.length} Paket(e) ▾` }));
      toggle.addEventListener("click", () => { body.hidden = !body.hidden; });
      group.append(toggle, body); root.append(group);
    }
  }

  function renderMobile() {
    const mobile = state.data?.mobile || {};
    $("mobile-pin").textContent = mobile.pin || "000000";
    $("require-mobile-approval").checked = mobile.requireApproval !== false;
    const pair = mobile.pairing || mobile.qr || {};
    $("batto-qr").src = pair.battoQr || pair.battoDataUrl || mobile.battoQr || "";
    $("legacy-qr").src = pair.legacyQr || pair.legacyDataUrl || mobile.legacyQr || "";
    $("batto-pair-url").textContent = pair.battoUrl || mobile.battoUrl || "";
    $("legacy-pair-url").textContent = pair.legacyUrl || mobile.legacyUrl || "";
    const addresses = $("mobile-addresses"); clear(addresses);
    const values = mobile.addresses || mobile.urls || [];
    (Array.isArray(values) ? values : [values]).filter(Boolean).forEach((entry) => addresses.append(keyValue(entry.type || entry.interface || "Adresse", entry.url || entry.address || entry)));
    renderClients($("pending-mobile-clients"), mobile.pending || mobile.pendingClients || [], true);
    renderClients($("connected-mobile-clients"), mobile.clients || mobile.connectedClients || [], false);
  }

  function renderClients(root, clients, pending) {
    clear(root);
    if (!clients.length) { root.append(node("p", { text: pending ? "Keine offene Anfrage." : "Kein Handy verbunden.", style: { color: "#8295a7" } })); return; }
    clients.forEach((client) => {
      const actions = node("div", { class: "button-row" });
      if (pending) {
        actions.append(node("button", { type: "button", text: "Annehmen", class: "primary", onclick: () => invoke("mobile:command", { command: "approve", clientId: client.id }) }), node("button", { type: "button", text: "Ablehnen", class: "danger-button", onclick: () => invoke("mobile:command", { command: "reject", clientId: client.id }) }));
      } else actions.append(node("button", { type: "button", text: "Trennen", onclick: () => invoke("mobile:command", { command: "disconnect", clientId: client.id }) }));
      root.append(node("article", { class: "client-card" }, node("div", {}, node("strong", { text: client.name || client.deviceName || "Handy" }), node("small", { text: client.address || client.id || "" })), actions));
    });
  }

  function renderGuests() {
    const profile = state.data?.guests || {};
    const root = $("guest-slots");
    clear(root);
    const items = profile.slots || [];
    if (!items.length) { root.append(node("p", { text: "Noch kein Gastplatz. Wähle eine OBS-Szene und lade die Quellen.", style: { textAlign: "center", color: "#8092a3", marginTop: "70px" } })); return; }
    items.forEach((slot, index) => {
      const enabled = node("input", { type: "checkbox" }); enabled.checked = slot.visible !== false;
      const select = node("select");
      (profile.sources || []).forEach((source) => select.append(node("option", { value: source.name || source.sourceName, text: source.name || source.sourceName, selected: (source.name || source.sourceName) === slot.sourceName })));
      const name = node("input", { value: slot.name || `Gastplatz ${index + 1}` });
      const remove = node("button", { type: "button", text: "Löschen", class: "danger-button" });
      remove.addEventListener("click", () => { state.data.guests.slots.splice(index, 1); renderGuests(); });
      root.append(node("div", { class: "guest-row", dataset: { index: String(index) } }, name, select, node("label", { class: "check" }, enabled, "Sichtbar"), remove));
    });
  }

  function collectGuestConfig() {
    return {
      sceneName: $("guest-scene").value,
      showAll: $("show-all-guest-sources").checked,
      slots: $$(".guest-row").map((row) => ({ name: row.querySelector("input:not([type=checkbox])").value.trim(), sourceName: row.querySelector("select").value, visible: row.querySelector('input[type="checkbox"]').checked }))
    };
  }

  function renderSettings() {
    const settings = state.data?.settings || {};
    if (!state.initialized) {
      $("setting-obs-autoconnect").checked = settings.obs?.autoConnect !== false;
      $("setting-mobile-enabled").checked = settings.mobile?.enabled !== false;
      $("setting-start-page").value = settings.startPage || "overview";
    }
    $("migration-status").textContent = JSON.stringify(state.data?.migration || {}, null, 2);
  }

  async function updateChatSettings() {
    const platformInputs = $$("#platform-toggles input");
    const platforms = {};
    ["twitch", "youtube", "tiktok", "tikfinity", "tiktory"].forEach((key, index) => { platforms[key] = platformInputs[index]?.checked !== false; });
    await invoke("multichat:update", { platforms, forwardToOverlay: $("chat-forward-overlay").checked, tts: { enabled: $("tts-enabled").checked } });
  }

  function bindEvents() {
    $$("#main-nav [data-page]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
    $$('[data-go]').forEach((button) => button.addEventListener("click", () => showPage(button.dataset.go)));
    $("close-app").addEventListener("click", () => api.invoke("app:close"));

    $("scan-hardware").addEventListener("click", () => invoke("hardware:scan", null, "Hardwarediagnose abgeschlossen."));
    $("save-hardware-report").addEventListener("click", () => invoke("hardware:saveReport", null, "Diagnosebericht gespeichert."));
    $("run-internet-test").addEventListener("click", () => invoke("internet:test", null, "Internettest abgeschlossen."));

    $("obs-form").addEventListener("submit", (event) => { event.preventDefault(); invoke("obs:connect", { host: $("obs-host").value, port: Number($("obs-port").value), password: $("obs-password").value, autoConnect: $("obs-auto").checked }, "OBS wurde verbunden."); });
    $("obs-disconnect").addEventListener("click", () => invoke("obs:disconnect", null, "OBS getrennt."));
    $("obs-refresh").addEventListener("click", () => invoke("obs:refresh"));
    $("obs-switch-scene").addEventListener("click", () => invoke("obs:call", { requestType: "SetCurrentProgramScene", requestData: { sceneName: $("obs-scene-select").value } }));
    $("obs-toggle-mute").addEventListener("click", () => invoke("obs:call", { requestType: "ToggleInputMute", requestData: { inputName: $("obs-audio-select").value } }));
    $$('[data-obs-call]').forEach((button) => button.addEventListener("click", () => invoke("obs:call", { requestType: button.dataset.obsCall, requestData: {} })));

    $("build-recommendation").addEventListener("click", () => invoke("recommendation:build", { platform: $("encoder-platform").value, resolution: $("encoder-resolution").value, fps: Number($("encoder-fps").value) }, "Empfehlung wurde neu berechnet."));
    $("run-cpu-test").addEventListener("click", async () => { if (!await confirmAction("CPU-Test starten?", "Der Prozessor wird für die gewählte Zeit stark belastet. Der Test kann jederzeit durch Schließen des Programms beendet werden.")) return; const result = await invoke("test:cpu", { seconds: Number($("cpu-test-seconds").value) }); $("test-results").textContent = JSON.stringify(result?.result || result, null, 2); });
    $("run-record-test").addEventListener("click", async () => { if (!await confirmAction("Echte OBS-Aufnahme starten?", "OBS nimmt die aktuell ausgewählte Szene für wenige Sekunden auf. Während eines laufenden Streams wird der Test nicht gestartet.")) return; const result = await invoke("test:record", { seconds: Number($("record-test-seconds").value) }); $("test-results").textContent = JSON.stringify(result?.result || result, null, 2); });

    $("open-monitoring").addEventListener("click", () => invoke("monitoring:open"));
    $("copy-monitoring-url").addEventListener("click", () => invoke("monitoring:copyUrl", null, "Monitoring-Adresse kopiert."));
    $$('[data-action="monitoring:open"]').forEach((button) => button.addEventListener("click", () => invoke("monitoring:open")));
    $("open-stream-overlay").addEventListener("click", () => invoke("streamOverlay:open"));
    $("copy-stream-overlay-url").addEventListener("click", () => invoke("streamOverlay:copyUrl", null, "Stream-Overlay-Adresse kopiert."));
    $$('[data-action="stream-overlay:open"]').forEach((button) => button.addEventListener("click", () => invoke("streamOverlay:open")));
    $("trigger-overlay-event").addEventListener("click", () => invoke("streamOverlay:event", { type: $("overlay-event-type").value, name: $("overlay-event-name").value, text: $("overlay-event-text").value, value: Number($("overlay-event-value").value) }));

    $("connect-twitch").addEventListener("click", () => invoke("multichat:connectTwitch", { channel: $("twitch-channel").value, oauthToken: $("twitch-oauth").value }));
    $("disconnect-twitch").addEventListener("click", () => invoke("multichat:disconnectTwitch"));
    $("connect-youtube").addEventListener("click", () => invoke("multichat:connectYouTube", { apiKey: $("youtube-api-key").value, liveChatId: $("youtube-chat-id").value }));
    $("disconnect-youtube").addEventListener("click", () => invoke("multichat:disconnectYouTube"));
    $("chat-forward-overlay").addEventListener("change", updateChatSettings);
    $("tts-enabled").addEventListener("change", updateChatSettings);
    $("tts-skip").addEventListener("click", () => invoke("multichat:tts", { command: "skip" }));
    $("tts-clear").addEventListener("click", () => invoke("multichat:tts", { command: "clear" }));
    $("test-chat-message").addEventListener("click", () => invoke("multichat:test", { platform: "tiktok", displayName: "Crazy_Batto", text: "Lokale Multi-Chat-Testnachricht" }));
    $("clear-chat").addEventListener("click", () => invoke("multichat:clear"));
    $("copy-local-chat-url").addEventListener("click", async () => { await navigator.clipboard.writeText($("local-chat-url").value); toast("Webhook-Adresse kopiert."); });

    $("load-guest-scene").addEventListener("click", async () => { const result = await invoke("guests:load", { sceneName: $("guest-scene").value, showAll: $("show-all-guest-sources").checked }); if (result?.guests) { state.data.guests = result.guests; renderGuests(); } });
    $("save-guests").addEventListener("click", () => invoke("guests:save", collectGuestConfig(), "Gastplätze gespeichert."));
    $("apply-guests").addEventListener("click", () => invoke("guests:apply", collectGuestConfig(), "Gastquellen wurden in OBS angewendet."));

    $("open-holo").addEventListener("click", () => invoke("holo:open"));
    $("copy-holo-url").addEventListener("click", () => invoke("holo:copyUrl", null, "Hologramm-Adresse kopiert."));
    $("holo-test").addEventListener("click", () => invoke("holo:test", { displayName: $("holo-name").value, text: $("holo-text").value, role: $("holo-role").value }));
    $("holo-clear").addEventListener("click", () => invoke("holo:clear"));

    $("deck-profile").addEventListener("change", () => { state.currentProfileId = $("deck-profile").value; state.currentFolderId = "root"; renderDeck(); invoke("deck:command", { command: "setActiveProfile", profileId: state.currentProfileId }).catch(() => {}); });
    $("deck-folder").addEventListener("change", () => { state.currentFolderId = $("deck-folder").value; renderDeck(); });
    $("new-profile").addEventListener("click", async () => { const name = prompt("Name des neuen Profils:", "Neues Profil"); if (name) await invoke("deck:command", { command: "createProfile", name }); });
    $("rename-profile").addEventListener("click", async () => { const profile = currentProfile(); if (!profile) return; const name = prompt("Neuer Profilname:", profile.name); if (name) await invoke("deck:command", { command: "renameProfile", profileId: profile.id, name }); });
    $("delete-profile").addEventListener("click", async () => { const profile = currentProfile(); if (!profile || !await confirmAction("Profil löschen?", `Das Profil „${profile.name}“ wird vollständig gelöscht.`)) return; await invoke("deck:command", { command: "deleteProfile", profileId: profile.id }); state.currentProfileId = ""; state.currentFolderId = "root"; });
    $("new-folder").addEventListener("click", async () => { const profile = currentProfile(); const folder = currentFolder(profile); const name = prompt("Name des neuen Ordners:", "Neuer Ordner"); if (name) await invoke("deck:command", { command: "createFolder", profileId: profile.id, parentId: folder.id, name }); });
    $("delete-folder").addEventListener("click", async () => { const profile = currentProfile(); const folder = currentFolder(profile); if (!profile || !folder || folder.id === "root") return toast("Die Hauptseite kann nicht gelöscht werden.", true); if (!await confirmAction("Ordner löschen?", `Der Ordner „${folder.name}“ und seine Inhalte werden gelöscht.`)) return; await invoke("deck:command", { command: "deleteFolder", profileId: profile.id, folderId: folder.id }); state.currentFolderId = folder.parentId || "root"; });
    $("save-deck-layout").addEventListener("click", () => { const profile = currentProfile(); const folder = currentFolder(profile); invoke("deck:command", { command: "updateLayout", profileId: profile.id, folderId: folder.id, rows: Number($("deck-rows").value), columns: Number($("deck-columns").value), hideUnused: $("deck-hide-unused").checked, buttonSize: Number($("deck-button-size").value), gap: Number($("deck-gap").value) }, "Raster gespeichert."); });
    $("deck-button-size").addEventListener("input", renderDeck); $("deck-gap").addEventListener("input", renderDeck); $("deck-hide-unused").addEventListener("change", renderDeck);
    $("deck-export").addEventListener("click", () => invoke("deck:command", { command: "export" }, "Deck-Konfiguration exportiert."));
    $("deck-import").addEventListener("click", () => invoke("deck:command", { command: "import" }, "Deck-Konfiguration importiert."));
    $("add-button-action").addEventListener("click", () => { state.editingActions.push({ type: "delay", delayMs: 0 }); renderActionEditor(); });
    $("save-current-button").addEventListener("click", () => saveButtonEditor(false));
    $("clear-current-button").addEventListener("click", () => saveButtonEditor(true));

    $("scan-plugins").addEventListener("click", () => invoke("plugins:scan", null, "Plugin-Suche abgeschlossen."));
    $("import-plugin").addEventListener("click", () => invoke("plugins:import", null, "Plugin-Ordner importiert."));

    $("regenerate-pin").addEventListener("click", () => invoke("mobile:command", { command: "regeneratePin" }, "Neue Kopplungs-PIN erzeugt."));
    $("require-mobile-approval").addEventListener("change", () => invoke("mobile:command", { command: "setApproval", requireApproval: $("require-mobile-approval").checked }));

    $("save-settings").addEventListener("click", () => invoke("app:saveSettings", { startPage: $("setting-start-page").value, obs: { autoConnect: $("setting-obs-autoconnect").checked }, mobile: { enabled: $("setting-mobile-enabled").checked } }, "Einstellungen gespeichert."));
    $("run-migration").addEventListener("click", () => invoke("migration:run", null, "Datenmigration geprüft."));
  }

  api.onState(applyState);
  api.onChat((message) => { state.chatMessages.push(message); if (state.chatMessages.length > 300) state.chatMessages.shift(); drawChatMessages(); });
  api.onError((error) => toast(normalizeError(error), true));
  bindEvents();
  invoke("app:getState").then((result) => applyState(result?.state || result)).catch(() => {});
})();
