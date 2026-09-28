"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const ui = {
    profileName: byId("profile-name"),
    profileList: byId("profile-list"),
    resolutionPreset: byId("resolution-preset"),
    overlayWidth: byId("overlay-width"),
    overlayHeight: byId("overlay-height"),
    applyResolution: byId("apply-resolution"),
    snapEnabled: byId("snap-enabled"),
    gridSize: byId("grid-size"),
    guidesEnabled: byId("guides-enabled"),
    copyOverlayUrl: byId("copy-overlay-url"),

    exportLayout: byId("export-layout"),
    importLayout: byId("import-layout"),
    importFile: byId("import-file"),
    saveState: byId("save-state"),
    metricSearch: byId("metric-search"),
    metricList: byId("metric-list"),
    stageViewport: byId("stage-viewport"),
    stageScaler: byId("stage-scaler"),
    stage: byId("stage"),
    stageSize: byId("stage-size"),
    guideX: byId("guide-x"),
    guideY: byId("guide-y"),
    propertyTitle: byId("property-title"),
    propertySubtitle: byId("property-subtitle"),
    propertyEditor: byId("property-editor"),
    confirmDialog: byId("confirm-dialog"),
    confirmTitle: byId("confirm-title"),
    confirmText: byId("confirm-text")
  };

  let config = null;
  let telemetry = null;
  let catalog = [];
  let catalogById = new Map();
  let selectedId = "";
  let currentProfile = "Standard";
  let stageScale = 1;
  let saveTimer = null;
  let propertyRenderGuard = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setState(message, type = "") {
    ui.saveState.textContent = message;
    ui.saveState.className = `save-state${type ? ` ${type}` : ""}`;
  }

  function normalizeProfileName(value) {
    return String(value || "Standard")
      .replace(/[\u0000-\u001f]/g, "")
      .trim()
      .slice(0, 120) || "Standard";
  }

  function profileLayout(profile = currentProfile) {
    const name = normalizeProfileName(profile);
    config.layoutsByProfile ||= {};
    if (!Array.isArray(config.layoutsByProfile[name])) {
      const source = config.layoutsByProfile.Standard || [];
      config.layoutsByProfile[name] = source.map((entry) => ({ ...entry }));
    }
    return config.layoutsByProfile[name];
  }

  function cardById(id) {
    return profileLayout().find((entry) => entry.id === id) || null;
  }

  function metricById(id) {
    return catalogById.get(id) || null;
  }

  function gridSize() {
    const value = Number(config?.gridSize || ui.gridSize.value || 10);
    return Math.max(1, Math.min(100, Number.isFinite(value) ? value : 10));
  }

  function snap(value) {
    if (!config?.snapToGrid) return Math.round(Number(value) || 0);
    const step = gridSize();
    return Math.round((Number(value) || 0) / step) * step;
  }

  function clampCard(card) {
    const width = Number(config.overlayWidth) || 1920;
    const height = Number(config.overlayHeight) || 1080;
    card.width = Math.max(90, Math.min(width, Math.round(Number(card.width) || 190)));
    card.height = Math.max(54, Math.min(height, Math.round(Number(card.height) || 92)));
    card.x = Math.max(0, Math.min(width - card.width, Math.round(Number(card.x) || 0)));
    card.y = Math.max(0, Math.min(height - card.height, Math.round(Number(card.y) || 0)));
  }

  function stageDimensions() {
    return {
      width: Math.max(320, Number(config?.overlayWidth) || 1920),
      height: Math.max(180, Number(config?.overlayHeight) || 1080)
    };
  }

  function resizeStage() {
    if (!config) return;
    const { width, height } = stageDimensions();
    const availableWidth = Math.max(280, ui.stageViewport.clientWidth - 28);
    const availableHeight = Math.max(280, ui.stageViewport.clientHeight - 28);
    stageScale = Math.min(1, availableWidth / width, availableHeight / height);
    ui.stage.style.width = `${width}px`;
    ui.stage.style.height = `${height}px`;
    ui.stage.style.transform = `scale(${stageScale})`;
    ui.stageScaler.style.width = `${width * stageScale}px`;
    ui.stageScaler.style.height = `${height * stageScale}px`;
    ui.stageSize.textContent = `${width} × ${height}`;
  }

  function currentValue(metric) {
    if (!metric || !telemetry) return "Nicht verfügbar";
    if (metric.id === "obs.encoder") return telemetry.encoder?.name || "Nicht verfügbar";
    if (metric.kind === "lineChart") return "Frametime-Verlauf";
    if (metric.kind === "coreBars") return "C1 38% · C2 44% · …";
    const raw = metric.computed ? computedValue(metric) : getByPath(telemetry, metric.path);
    if (raw === null || raw === undefined || raw === "") return "Nicht verfügbar";
    if (["text", "status", "timecode"].includes(metric.kind)) return String(raw);
    if (metric.kind === "bytes") return formatBytes(raw);
    if (metric.kind === "bitrate") return `${(Number(raw) * 8 / 1_000_000).toFixed(2)} Mbit/s`;
    if (metric.kind === "kilobits") return `${Number(raw).toLocaleString("de-DE", { maximumFractionDigits: 0 })} Kbit/s`;
    if (metric.kind === "megabytes") return Number(raw) >= 1024 ? `${(Number(raw) / 1024).toFixed(2)} GB` : `${Number(raw).toFixed(0)} MB`;
    const card = cardById(metric.id);
    const decimals = Math.max(0, Math.min(4, Number(card?.decimals ?? metric.decimals) || 0));
    const unit = card?.unit ?? metric.unit ?? "";
    return `${Number(raw).toLocaleString("de-DE", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    })}${unit ? ` ${unit}` : ""}`;
  }

  function dynamicLabel(metric) {
    if (metric.id === "obs.encoder") {
      return telemetry?.encoder?.label === "Aktiver Encoder" ? "Aktiver Encoder" : "Encoder";
    }
    return metric.label;
  }

  function getByPath(value, path) {
    return String(path || "")
      .split(".")
      .filter(Boolean)
      .reduce((current, key) => current == null ? undefined : current[key], value);
  }

  function computedValue(metric) {
    if (metric.computed === "vramPercent") {
      const used = Number(telemetry?.gpu?.memoryUsedMb);
      const total = Number(telemetry?.gpu?.memoryTotalMb);
      return total > 0 ? used / total * 100 : null;
    }
    if (metric.computed === "streamStatus") return telemetry?.output?.streamActive ? "LIVE" : "Nicht aktiv";
    if (metric.computed === "recordStatus") return telemetry?.output?.recordActive ? "AUFNAHME" : "Nicht aktiv";
    if (metric.computed === "networkStatus") return telemetry?.system?.network?.connected ? "Verbunden" : "Getrennt";
    if (metric.computed === "networkWarning") return telemetry?.system?.network?.unstable ? "Verbindung instabil" : "Verbindung stabil";
    return null;
  }

  function formatBytes(value) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let current = Math.max(0, Number(value) || 0);
    let index = 0;
    while (current >= 1024 && index < units.length - 1) {
      current /= 1024;
      index += 1;
    }
    return `${current.toFixed(index < 2 ? 0 : 2)} ${units[index]}`;
  }

  function renderMetricList() {
    const query = String(ui.metricSearch.value || "").trim().toLowerCase();
    const groups = [...new Set(catalog.map((entry) => entry.group))];
    ui.metricList.innerHTML = groups.map((group) => {
      const metrics = catalog.filter((metric) =>
        metric.group === group
        && (!query || `${metric.label} ${metric.id}`.toLowerCase().includes(query))
      );
      if (!metrics.length) return "";
      return `
        <details class="metric-group" open>
          <summary>${escapeHtml(group)}</summary>
          ${metrics.map((metric) => {
            const card = cardById(metric.id);
            return `<label class="metric-toggle"><input type="checkbox" data-metric-id="${escapeHtml(metric.id)}" ${card?.enabled ? "checked" : ""}><span>${escapeHtml(metric.label)}</span></label>`;
          }).join("")}
        </details>
      `;
    }).join("");

    ui.metricList.querySelectorAll("[data-metric-id]").forEach((input) => {
      input.addEventListener("change", () => {
        const card = cardById(input.dataset.metricId);
        if (!card) return;
        card.enabled = input.checked;
        if (card.enabled) selectedId = card.id;
        renderStage();
        renderProperties();
        queueLayoutSave();
      });
    });
  }

  function applyCardStyle(element, card) {
    element.style.left = `${card.x}px`;
    element.style.top = `${card.y}px`;
    element.style.width = `${card.width}px`;
    element.style.height = `${card.height}px`;
    element.style.fontFamily = card.fontFamily;
    element.style.color = card.fontColor;
    element.style.backgroundColor = hexWithOpacity(card.backgroundColor, card.opacity);
    element.style.borderColor = card.borderColor;
    element.style.borderWidth = `${card.borderWidth}px`;
    element.style.borderRadius = `${card.borderRadius}px`;
    element.style.setProperty("--card-accent", card.accentColor);
    const value = element.querySelector(".editor-card-value");
    if (value) value.style.fontSize = `${card.fontSize}px`;
  }

  function renderStage() {
    if (!config) return;
    resizeStage();
    ui.stage.querySelectorAll(".editor-card").forEach((entry) => entry.remove());
    const fragment = document.createDocumentFragment();
    for (const card of profileLayout().filter((entry) => entry.enabled)) {
      const metric = metricById(card.id);
      if (!metric) continue;
      const element = document.createElement("article");
      element.className = `editor-card${card.id === selectedId ? " selected" : ""}`;
      element.dataset.metricId = card.id;
      const label = document.createElement("span");
      label.className = "editor-card-label";
      label.textContent = dynamicLabel(metric);
      element.append(label);
      if (metric.kind === "lineChart") {
        const chart = document.createElement("div");
        chart.className = "editor-chart-placeholder";
        chart.textContent = "Frametime-Diagramm";
        element.append(chart);
      } else {
        const value = document.createElement("strong");
        value.className = "editor-card-value";
        value.textContent = currentValue(metric);
        element.append(value);
      }
      const handle = document.createElement("i");
      handle.className = "resize-handle";
      handle.setAttribute("aria-hidden", "true");
      element.append(handle);
      applyCardStyle(element, card);
      bindCardInteractions(element, card, handle);
      fragment.append(element);
    }
    ui.stage.append(fragment);
  }

  function bindCardInteractions(element, card, handle) {
    const begin = (event, mode) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectCard(card.id);
      const startX = event.clientX;
      const startY = event.clientY;
      const initial = { x: card.x, y: card.y, width: card.width, height: card.height };
      element.setPointerCapture?.(event.pointerId);

      const move = (moveEvent) => {
        const dx = (moveEvent.clientX - startX) / stageScale;
        const dy = (moveEvent.clientY - startY) / stageScale;
        const dimensions = stageDimensions();
        if (mode === "move") {
          card.x = Math.max(0, Math.min(dimensions.width - card.width, snap(initial.x + dx)));
          card.y = Math.max(0, Math.min(dimensions.height - card.height, snap(initial.y + dy)));
          showGuide("x", card.x);
          showGuide("y", card.y);
        } else {
          card.width = Math.max(90, Math.min(dimensions.width - card.x, snap(initial.width + dx)));
          card.height = Math.max(54, Math.min(dimensions.height - card.y, snap(initial.height + dy)));
          showGuide("x", card.x + card.width);
          showGuide("y", card.y + card.height);
        }
        applyCardStyle(element, card);
        fillPropertyInputs(card);
      };
      const end = () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", end);
        element.removeEventListener("pointercancel", end);
        hideGuides();
        clampCard(card);
        queueLayoutSave();
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", end);
      element.addEventListener("pointercancel", end);
    };

    element.addEventListener("pointerdown", (event) => {
      if (event.target === handle || event.target.closest(".resize-handle")) return;
      begin(event, "move");
    });
    handle.addEventListener("pointerdown", (event) => begin(event, "resize"));
    element.addEventListener("click", () => selectCard(card.id));
  }

  function showGuide(axis, value) {
    if (!config.showAlignmentGuides) return;
    const guide = axis === "x" ? ui.guideX : ui.guideY;
    guide.hidden = false;
    if (axis === "x") guide.style.left = `${value}px`;
    else guide.style.top = `${value}px`;
  }

  function hideGuides() {
    ui.guideX.hidden = true;
    ui.guideY.hidden = true;
  }

  function selectCard(id) {
    selectedId = id;
    renderStage();
    renderProperties();
  }

  const PROPERTY_FIELDS = [
    ["enabled", "Messwert anzeigen", "checkbox"],
    ["x", "Position X", "number", { min: 0, max: 7680, step: 1 }],
    ["y", "Position Y", "number", { min: 0, max: 4320, step: 1 }],
    ["width", "Breite", "number", { min: 90, max: 7680, step: 1 }],
    ["height", "Höhe", "number", { min: 54, max: 4320, step: 1 }],
    ["fontFamily", "Schriftart", "text"],
    ["fontSize", "Schriftgröße", "number", { min: 8, max: 96, step: 1 }],
    ["fontColor", "Schriftfarbe", "color"],
    ["backgroundColor", "Hintergrundfarbe", "color"],
    ["borderColor", "Rahmenfarbe", "color"],
    ["borderWidth", "Rahmenstärke", "number", { min: 0, max: 12, step: 0.5 }],
    ["borderRadius", "Eckenradius", "number", { min: 0, max: 60, step: 1 }],
    ["accentColor", "Akzentfarbe", "color"],
    ["opacity", "Deckkraft", "range", { min: 0, max: 1, step: 0.05 }],
    ["unit", "Einheit", "text"],
    ["decimals", "Nachkommastellen", "number", { min: 0, max: 4, step: 1 }],
    ["warning", "Warnschwelle", "number", { step: 0.1 }],
    ["critical", "Kritische Schwelle", "number", { step: 0.1 }],
    ["updateMs", "Aktualisierung in ms", "number", { min: 250, max: 10000, step: 250 }],
    ["groupId", "Gruppenname", "text"]
  ];

  function renderProperties() {
    if (propertyRenderGuard) return;
    propertyRenderGuard = true;
    try {
      const card = cardById(selectedId) || profileLayout().find((entry) => entry.enabled);
      if (!card) {
        ui.propertyTitle.textContent = "Messwert auswählen";
        ui.propertySubtitle.textContent = "Karte anklicken oder links aktivieren.";
        ui.propertyEditor.innerHTML = '<p class="empty-property">Es ist kein Messwert aktiv. Aktiviere links einen Wert, um ihn zu gestalten.</p>';
        return;
      }
      selectedId = card.id;
      const metric = metricById(card.id);
      ui.propertyTitle.textContent = metric?.label || card.id;
      ui.propertySubtitle.textContent = `${metric?.group || "Messwert"} · ${card.id}`;
      const fields = [...PROPERTY_FIELDS];
      if (metric?.kind === "lineChart") {
        fields.push(
          ["chartSeconds", "Diagramm-Zeitraum in Sekunden", "number", { min: 10, max: 300, step: 5 }],
          ["chartMaximum", "Diagramm-Maximum in ms", "number", { min: 5, max: 200, step: 1 }]
        );
      }
      ui.propertyEditor.innerHTML = [
        '<div class="two-column">',
        fields.slice(1, 5).map((field) => propertyInput(field, card)).join(""),
        '</div>',
        propertyInput(fields[0], card),
        '<div class="property-divider"></div>',
        ...fields.slice(5).map((field) => propertyInput(field, card)),
        '<p class="property-note">Warn- und kritische Schwellen ändern die Kartenfarbe automatisch. Ein leeres Feld deaktiviert die jeweilige Schwelle.</p>'
      ].join("");
      bindPropertyInputs(card, fields);
    } finally {
      propertyRenderGuard = false;
    }
  }

  function propertyInput(field, card) {
    const [name, label, type, limits = {}] = field;
    if (type === "checkbox") {
      return `<label class="property-check"><input id="property-${name}" type="checkbox" ${card[name] ? "checked" : ""}> ${escapeHtml(label)}</label>`;
    }
    const attributes = Object.entries(limits)
      .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
      .join(" ");
    const value = card[name] ?? "";
    return `<label>${escapeHtml(label)}<input id="property-${name}" type="${type}" ${attributes} value="${escapeHtml(value)}"></label>`;
  }

  function bindPropertyInputs(card, fields) {
    fields.forEach(([name, , type]) => {
      const input = byId(`property-${name}`);
      if (!input) return;
      const apply = () => {
        if (type === "checkbox") card[name] = input.checked;
        else if (type === "number" || type === "range") {
          card[name] = input.value === "" ? null : Number(input.value);
        } else card[name] = input.value;
        if (["x", "y", "width", "height"].includes(name)) {
          card[name] = snap(card[name]);
          clampCard(card);
        }
        if (name === "enabled") renderMetricList();
        renderStage();
        queueLayoutSave();
      };
      input.addEventListener("input", apply);
      input.addEventListener("change", apply);
    });
  }

  function fillPropertyInputs(card) {
    if (!card || card.id !== selectedId) return;
    for (const [name, , type] of PROPERTY_FIELDS) {
      const input = byId(`property-${name}`);
      if (!input) continue;
      if (type === "checkbox") input.checked = Boolean(card[name]);
      else input.value = card[name] ?? "";
    }
  }

  function queueLayoutSave() {
    clearTimeout(saveTimer);
    setState("Nicht gespeicherte Layoutänderung", "saving");
    saveTimer = setTimeout(() => void saveLayout(), 320);
  }

  async function saveLayout() {
    clearTimeout(saveTimer);
    setState("Layout wird gespeichert …", "saving");
    try {
      const response = await fetch("/api/profile/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileName: currentProfile,
          layout: profileLayout()
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Layout konnte nicht gespeichert werden.");
      config = result;
      setState(`Layout für OBS-Profil „${currentProfile}“ gespeichert`);
    } catch (error) {
      setState(String(error?.message || error), "error");
    }
  }

  async function saveGlobalConfig() {
    setState("Einstellungen werden gespeichert …", "saving");
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Einstellungen konnten nicht gespeichert werden.");
    config = result;
    setState("Overlay-Einstellungen gespeichert");
  }

  async function applyPreset(name) {
    setState(`Vorlage „${name}“ wird angewendet …`, "saving");
    try {
      const response = await fetch("/api/layout/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, profileName: currentProfile })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Vorlage konnte nicht angewendet werden.");
      config = result;
      selectedId = profileLayout().find((entry) => entry.enabled)?.id || "";
      renderAll();
      setState(`Vorlage „${name}“ für „${currentProfile}“ angewendet`);
    } catch (error) {
      setState(String(error?.message || error), "error");
    }
  }

  async function applyResolution() {
    const width = Math.round(Number(ui.overlayWidth.value));
    const height = Math.round(Number(ui.overlayHeight.value));
    if (!Number.isFinite(width) || width < 320 || width > 7680 || !Number.isFinite(height) || height < 180 || height > 4320) {
      setState("Die Auflösung ist außerhalb des erlaubten Bereichs.", "error");
      return;
    }
    const confirmed = await confirmChange(
      "Overlay-Auflösung ändern",
      `Auf ${width} × ${height} umstellen? Karten bleiben erhalten und werden nur innerhalb der neuen Auflösung begrenzt.`
    );
    if (!confirmed) return;
    setState("Auflösung wird angepasst …", "saving");
    try {
      const response = await fetch("/api/resolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width, height })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Auflösung konnte nicht geändert werden.");
      config = result;
      syncGlobalInputs();
      renderAll();
      setState(`Overlay-Auflösung: ${width} × ${height}`);
    } catch (error) {
      setState(String(error?.message || error), "error");
    }
  }

  function confirmChange(title, text) {
    if (!ui.confirmDialog?.showModal) return Promise.resolve(window.confirm(text));
    ui.confirmTitle.textContent = title;
    ui.confirmText.textContent = text;
    ui.confirmDialog.showModal();
    return new Promise((resolve) => {
      const close = () => {
        ui.confirmDialog.removeEventListener("close", close);
        resolve(ui.confirmDialog.returnValue === "confirm");
      };
      ui.confirmDialog.addEventListener("close", close);
    });
  }

  async function exportLayout() {
    try {
      const response = await fetch(`/api/layout/export?profile=${encodeURIComponent(currentProfile)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Layout konnte nicht exportiert werden.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Batto-OBS-Overlay-${currentProfile.replace(/[^a-z0-9_-]+/gi, "-") || "Standard"}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setState("Layout exportiert");
    } catch (error) {
      setState(String(error?.message || error), "error");
    }
  }

  async function importLayout(file) {
    const payload = JSON.parse(await file.text());
    const response = await fetch("/api/layout/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Layout konnte nicht importiert werden.");
    config = result;
    currentProfile = config.activeProfile;
    selectedId = profileLayout().find((entry) => entry.enabled)?.id || "";
    syncGlobalInputs();
    renderAll();
    setState(`Layout für „${currentProfile}“ importiert`);
  }

  async function copyOverlayUrl() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const result = await response.json();
      const url = result.status?.overlayUrl || `${location.origin}/overlay`;
      await navigator.clipboard.writeText(url);
      setState(`OBS-Adresse kopiert: ${url}`);
    } catch (error) {
      setState(`Kopieren fehlgeschlagen: ${String(error?.message || error)}`, "error");
    }
  }

  function switchProfile(rawName) {
    currentProfile = normalizeProfileName(rawName);
    config.activeProfile = currentProfile;
    profileLayout(currentProfile);
    selectedId = profileLayout().find((entry) => entry.enabled)?.id || "";
    syncGlobalInputs();
    renderAll();
    void saveGlobalConfig().catch((error) => setState(String(error?.message || error), "error"));
  }

  function syncGlobalInputs() {
    ui.profileName.value = currentProfile;
    ui.profileList.innerHTML = Object.keys(config.layoutsByProfile || {})
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join("");
    ui.overlayWidth.value = config.overlayWidth;
    ui.overlayHeight.value = config.overlayHeight;
    const preset = `${config.overlayWidth}x${config.overlayHeight}`;
    ui.resolutionPreset.value = [...ui.resolutionPreset.options].some((option) => option.value === preset)
      ? preset
      : "custom";
    ui.snapEnabled.checked = config.snapToGrid !== false;
    ui.gridSize.value = config.gridSize || 10;
    ui.guidesEnabled.checked = config.showAlignmentGuides !== false;
  }

  function renderAll() {
    renderMetricList();
    renderStage();
    renderProperties();
  }

  function hexWithOpacity(hex, opacity) {
    const normalized = /^#[0-9a-f]{6}$/i.test(String(hex || "")) ? String(hex) : "#0a1018";
    const alpha = Math.max(0, Math.min(1, Number(opacity) || 0));
    const red = parseInt(normalized.slice(1, 3), 16);
    const green = parseInt(normalized.slice(3, 5), 16);
    const blue = parseInt(normalized.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  ui.metricSearch.addEventListener("input", renderMetricList);
  ui.profileName.addEventListener("change", () => switchProfile(ui.profileName.value));
  ui.profileName.addEventListener("blur", () => switchProfile(ui.profileName.value));
  ui.resolutionPreset.addEventListener("change", () => {
    if (ui.resolutionPreset.value === "custom") return;
    const [width, height] = ui.resolutionPreset.value.split("x").map(Number);
    ui.overlayWidth.value = width;
    ui.overlayHeight.value = height;
  });
  ui.applyResolution.addEventListener("click", () => void applyResolution());
  ui.snapEnabled.addEventListener("change", () => {
    config.snapToGrid = ui.snapEnabled.checked;
    void saveGlobalConfig().catch((error) => setState(String(error?.message || error), "error"));
  });
  ui.gridSize.addEventListener("change", () => {
    config.gridSize = Math.max(1, Math.min(100, Math.round(Number(ui.gridSize.value) || 10)));
    ui.gridSize.value = config.gridSize;
    void saveGlobalConfig().catch((error) => setState(String(error?.message || error), "error"));
  });
  ui.guidesEnabled.addEventListener("change", () => {
    config.showAlignmentGuides = ui.guidesEnabled.checked;
    void saveGlobalConfig().catch((error) => setState(String(error?.message || error), "error"));
  });
  ui.copyOverlayUrl.addEventListener("click", () => void copyOverlayUrl());

  ui.exportLayout.addEventListener("click", () => void exportLayout());
  ui.importLayout.addEventListener("click", () => ui.importFile.click());
  ui.importFile.addEventListener("change", async () => {
    try {
      if (ui.importFile.files?.[0]) await importLayout(ui.importFile.files[0]);
    } catch (error) {
      setState(String(error?.message || error), "error");
    } finally {
      ui.importFile.value = "";
    }
  });
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => void applyPreset(button.dataset.preset));
  });
  window.addEventListener("resize", resizeStage);

  const eventStream = new EventSource("/events");
  eventStream.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "telemetry") {
        telemetry = message.telemetry;
        renderStage();
      } else if (message.type === "config") {
        config = message.config;
        currentProfile = normalizeProfileName(config.activeProfile || currentProfile);
        syncGlobalInputs();
        renderAll();
      } else if (message.type === "snapshot") {
        config = message.config || config;
        telemetry = message.telemetry || telemetry;
        catalog = message.catalog || catalog;
        catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
      }
    } catch {
      // Invalid live data must not break the editor.
    }
  });

  fetch("/api/status", { cache: "no-store" })
    .then((response) => response.json())
    .then((result) => {
      config = result.config;
      telemetry = result.telemetry;
      catalog = result.catalog || [];
      catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
      currentProfile = normalizeProfileName(telemetry?.profileName || config.activeProfile || "Standard");
      profileLayout(currentProfile);
      selectedId = profileLayout().find((entry) => entry.enabled)?.id || "";
      syncGlobalInputs();
      renderAll();
      setState(`Bereit · OBS-Adresse: ${result.status?.overlayUrl || `${location.origin}/overlay`}`);
    })
    .catch((error) => setState(`Editor konnte nicht geladen werden: ${String(error?.message || error)}`, "error"));
})();
