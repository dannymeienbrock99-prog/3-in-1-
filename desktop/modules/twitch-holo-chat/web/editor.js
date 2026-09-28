"use strict";

(() => {
  const STORAGE_KEY = "batto-obs-tool-twitch-holo-config-v1";
  const byId = (id) => document.getElementById(id);
  const ui = {
    enabled: byId("effect-enabled"),
    applyName: byId("effect-name"),
    applyMessage: byId("effect-message"),
    transparentBubbles: byId("transparent-bubbles"),
    reducedMotion: byId("reduced-motion"),
    target: byId("style-target"),
    userNameRow: byId("user-name-row"),
    userName: byId("user-name"),
    colorCount: byId("color-count"),
    colors: [1, 2, 3, 4, 5, 6].map((index) => byId(`color-${index}`)),
    angle: byId("angle"),
    angleValue: byId("angle-value"),
    speed: byId("speed"),
    speedValue: byId("speed-value"),
    glow: byId("glow"),
    glowValue: byId("glow-value"),
    brightness: byId("brightness"),
    brightnessValue: byId("brightness-value"),
    saturation: byId("saturation"),
    saturationValue: byId("saturation-value"),
    save: byId("save-style"),
    removeUserStyle: byId("remove-user-style"),
    exportConfig: byId("export-config"),
    status: byId("editor-status"),
    preview: byId("preview-frame"),
    previewStreamer: byId("preview-streamer"),
    previewMod: byId("preview-mod"),
    previewViewer: byId("preview-viewer"),
    previewClear: byId("preview-clear")
  };

  const DEFAULT_CONFIG = {
    enabled: true,
    applyToName: true,
    applyToMessage: true,
    useOriginalTwitchColorWhenDisabled: true,
    reducedMotion: false,
    transparentBubbles: false,
    showRole: false,
    showTime: false,
    align: "left",
    newest: "bottom",
    maximumMessages: 40,
    displayMs: 20000,
    defaultStyle: {
      enabled: true,
      colors: ["#54f4ff", "#9867ff", "#ff55c8", "#ffe66d"],
      angle: 110,
      speedSeconds: 4.5,
      glow: 18,
      brightness: 1.15,
      saturation: 1.2,
      fontWeight: 800
    },
    roleStyles: {
      broadcaster: {
        enabled: true,
        colors: ["#ff3b3b", "#ffb347", "#fff08a", "#ff3b3b"],
        angle: 110,
        speedSeconds: 3.2,
        glow: 22,
        brightness: 1.15,
        saturation: 1.2,
        fontWeight: 800
      },
      moderator: {
        enabled: true,
        colors: ["#00f5a0", "#00d9f5", "#6dffb8"],
        angle: 110,
        speedSeconds: 4,
        glow: 18,
        brightness: 1.15,
        saturation: 1.2,
        fontWeight: 800
      },
      vip: {
        enabled: true,
        colors: ["#ff4ecd", "#8d5cff", "#ff8fe7"],
        angle: 110,
        speedSeconds: 3.8,
        glow: 20,
        brightness: 1.15,
        saturation: 1.2,
        fontWeight: 800
      },
      subscriber: {
        enabled: true,
        colors: ["#ffd166", "#ff8c42", "#fff1a8"],
        angle: 110,
        speedSeconds: 5,
        glow: 14,
        brightness: 1.15,
        saturation: 1.2,
        fontWeight: 800
      },
      viewer: {
        enabled: true,
        colors: ["#54f4ff", "#9867ff", "#ff55c8", "#ffe66d"],
        angle: 110,
        speedSeconds: 5.5,
        glow: 14,
        brightness: 1.15,
        saturation: 1.2,
        fontWeight: 800
      }
    },
    userStyles: {}
  };

  const PRESETS = {
    "discord-like": {
      colors: ["#7dd3fc", "#a78bfa", "#f0abfc", "#fde68a", "#7dd3fc"],
      angle: 115,
      speedSeconds: 3.8,
      glow: 20,
      brightness: 1.2,
      saturation: 1.25
    },
    "cyan-purple": {
      colors: ["#39f5ff", "#5a7cff", "#c653ff", "#39f5ff"],
      angle: 100,
      speedSeconds: 4.2,
      glow: 19,
      brightness: 1.18,
      saturation: 1.3
    },
    gold: {
      colors: ["#fff7ae", "#ffd166", "#ff9f1c", "#fff7ae"],
      angle: 95,
      speedSeconds: 5,
      glow: 16,
      brightness: 1.16,
      saturation: 1.1
    },
    "red-gold": {
      colors: ["#ff3b3b", "#ff8c42", "#ffe66d", "#ff3b3b"],
      angle: 110,
      speedSeconds: 3.5,
      glow: 22,
      brightness: 1.2,
      saturation: 1.3
    },
    "green-cyan": {
      colors: ["#00f5a0", "#00d9f5", "#8affdf", "#00f5a0"],
      angle: 105,
      speedSeconds: 4,
      glow: 18,
      brightness: 1.15,
      saturation: 1.25
    }
  };

  let config = loadConfig();
  let previewReady = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeUserKey(value) {
    return String(value || "").trim().replace(/^@/, "").toLowerCase().slice(0, 80);
  }

  function loadConfig() {
    try {
      const loaded = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return clone(DEFAULT_CONFIG);
      return {
        ...clone(DEFAULT_CONFIG),
        ...loaded,
        defaultStyle: { ...clone(DEFAULT_CONFIG.defaultStyle), ...(loaded.defaultStyle || {}) },
        roleStyles: { ...clone(DEFAULT_CONFIG.roleStyles), ...(loaded.roleStyles || {}) },
        userStyles: loaded.userStyles && typeof loaded.userStyles === "object"
          ? loaded.userStyles
          : {}
      };
    } catch {
      return clone(DEFAULT_CONFIG);
    }
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    applyConfigToPreview();
  }

  function previewApi() {
    return ui.preview.contentWindow?.BattoHoloChat || null;
  }

  function applyConfigToPreview() {
    const api = previewApi();
    if (!previewReady || !api) return;
    api.configure(config);
  }

  function setStatus(message, error = false) {
    ui.status.textContent = message;
    ui.status.style.color = error ? "#ff9fa8" : "#7ee3ab";
  }

  function currentTargetStyle() {
    const target = ui.target.value;
    if (target === "user") {
      const key = normalizeUserKey(ui.userName.value);
      return key && config.userStyles[key]
        ? config.userStyles[key]
        : config.defaultStyle;
    }
    return config.roleStyles[target] || config.defaultStyle;
  }

  function updateRangeOutputs() {
    ui.angleValue.value = `${Math.round(Number(ui.angle.value))}°`;
    ui.speedValue.value = `${Number(ui.speed.value).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
    ui.glowValue.value = `${Math.round(Number(ui.glow.value))} px`;
    ui.brightnessValue.value = `${Math.round(Number(ui.brightness.value) * 100)} %`;
    ui.saturationValue.value = `${Math.round(Number(ui.saturation.value) * 100)} %`;
  }

  function fillStyle(style) {
    const colors = Array.isArray(style?.colors) && style.colors.length >= 2
      ? style.colors
      : DEFAULT_CONFIG.defaultStyle.colors;
    ui.colorCount.value = String(Math.max(2, Math.min(6, colors.length)));
    ui.colors.forEach((input, index) => {
      input.value = colors[index] || colors[index % colors.length] || "#ffffff";
      input.closest("label").hidden = index >= Number(ui.colorCount.value);
    });
    ui.angle.value = String(style?.angle ?? 110);
    ui.speed.value = String(style?.speedSeconds ?? 4.5);
    ui.glow.value = String(style?.glow ?? 18);
    ui.brightness.value = String(style?.brightness ?? 1.15);
    ui.saturation.value = String(style?.saturation ?? 1.2);
    updateRangeOutputs();
  }

  function styleFromInputs() {
    const colorCount = Number(ui.colorCount.value);
    return {
      enabled: true,
      colors: ui.colors.slice(0, colorCount).map((input) => input.value),
      angle: Number(ui.angle.value),
      speedSeconds: Number(ui.speed.value),
      glow: Number(ui.glow.value),
      brightness: Number(ui.brightness.value),
      saturation: Number(ui.saturation.value),
      fontWeight: 800
    };
  }

  function updateGlobalConfigFromInputs() {
    config.enabled = ui.enabled.checked;
    config.applyToName = ui.applyName.checked;
    config.applyToMessage = ui.applyMessage.checked;
    config.transparentBubbles = ui.transparentBubbles.checked;
    config.reducedMotion = ui.reducedMotion.checked;
  }

  function loadGlobalInputs() {
    ui.enabled.checked = config.enabled !== false;
    ui.applyName.checked = config.applyToName !== false;
    ui.applyMessage.checked = config.applyToMessage !== false;
    ui.transparentBubbles.checked = Boolean(config.transparentBubbles);
    ui.reducedMotion.checked = Boolean(config.reducedMotion);
  }

  function updateTargetUi() {
    const isUser = ui.target.value === "user";
    ui.userNameRow.hidden = !isUser;
    ui.removeUserStyle.hidden = !isUser;
    fillStyle(currentTargetStyle());
  }

  function saveCurrentStyle() {
    updateGlobalConfigFromInputs();
    const style = styleFromInputs();
    if (ui.target.value === "user") {
      const key = normalizeUserKey(ui.userName.value);
      if (!key) {
        setStatus("Bitte zuerst einen Twitch-Namen eintragen.", true);
        ui.userName.focus();
        return;
      }
      config.userStyles[key] = style;
      setStatus(`Eigener Hologramm-Stil für @${key} gespeichert.`);
    } else {
      config.roleStyles[ui.target.value] = style;
      setStatus(`Hologramm-Stil für „${ui.target.selectedOptions[0].textContent}“ gespeichert.`);
    }
    saveConfig();
    showPreviewForTarget();
  }

  function removeCurrentUserStyle() {
    const key = normalizeUserKey(ui.userName.value);
    if (!key) {
      setStatus("Bitte den Twitch-Namen des Benutzerstils eintragen.", true);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(config.userStyles, key)) {
      setStatus(`Für @${key} ist kein eigener Stil gespeichert.`, true);
      return;
    }
    delete config.userStyles[key];
    saveConfig();
    fillStyle(config.defaultStyle);
    setStatus(`Eigener Stil für @${key} entfernt. Jetzt greift wieder der Rollenstil.`);
  }

  function rolesForTarget(target) {
    return {
      broadcaster: { broadcaster: true },
      moderator: { moderator: true },
      vip: { vip: true },
      subscriber: { subscriber: true },
      viewer: {}
    }[target] || {};
  }

  function showPreviewForTarget() {
    const api = previewApi();
    if (!api) return;
    const target = ui.target.value;
    const userKey = normalizeUserKey(ui.userName.value) || "Test_User";
    api.addMessage({
      id: `editor-${Date.now()}`,
      displayName: target === "user" ? userKey : ui.target.selectedOptions[0].textContent,
      username: target === "user" ? userKey : target,
      text: "So erscheinen Name und Chatfarbe im Twitch-Overlay.",
      color: "#55d6ff",
      roles: rolesForTarget(target)
    });
  }

  async function copyConfig() {
    updateGlobalConfigFromInputs();
    saveConfig();
    const text = JSON.stringify(config, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Hologramm-Konfiguration wurde kopiert.");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setStatus("Hologramm-Konfiguration wurde kopiert.");
    }
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    const count = Math.max(2, Math.min(6, preset.colors.length));
    ui.colorCount.value = String(count);
    ui.colors.forEach((input, index) => {
      input.value = preset.colors[index] || preset.colors[index % preset.colors.length];
      input.closest("label").hidden = index >= count;
    });
    ui.angle.value = String(preset.angle);
    ui.speed.value = String(preset.speedSeconds);
    ui.glow.value = String(preset.glow);
    ui.brightness.value = String(preset.brightness);
    ui.saturation.value = String(preset.saturation);
    updateRangeOutputs();
    setStatus("Vorlage geladen. Mit „Stil übernehmen“ wird sie gespeichert.");
    previewTemporaryStyle();
  }

  function previewTemporaryStyle() {
    updateGlobalConfigFromInputs();
    const temporary = clone(config);
    const target = ui.target.value;
    if (target === "user") {
      const key = normalizeUserKey(ui.userName.value) || "test_user";
      temporary.userStyles[key] = styleFromInputs();
    } else {
      temporary.roleStyles[target] = styleFromInputs();
    }
    previewApi()?.configure(temporary);
    showPreviewForTarget();
  }

  ui.preview.addEventListener("load", () => {
    previewReady = true;
    applyConfigToPreview();
    previewApi()?.clear();
    previewApi()?.addMessage({
      displayName: "Crazy_Batto",
      username: "crazy_batto",
      text: "Kostenloser Hologramm-Stil wie bei Discord – aber ohne Server-Boost.",
      roles: { broadcaster: true }
    });
  });

  ui.target.addEventListener("change", updateTargetUi);
  ui.userName.addEventListener("change", updateTargetUi);
  ui.userName.addEventListener("input", () => {
    if (ui.target.value === "user") fillStyle(currentTargetStyle());
  });
  ui.colorCount.addEventListener("change", () => {
    ui.colors.forEach((input, index) => {
      input.closest("label").hidden = index >= Number(ui.colorCount.value);
    });
    previewTemporaryStyle();
  });

  for (const input of [
    ui.enabled,
    ui.applyName,
    ui.applyMessage,
    ui.transparentBubbles,
    ui.reducedMotion
  ]) {
    input.addEventListener("change", () => {
      updateGlobalConfigFromInputs();
      saveConfig();
      setStatus("Anzeigeoption gespeichert.");
    });
  }

  for (const input of [ui.angle, ui.speed, ui.glow, ui.brightness, ui.saturation, ...ui.colors]) {
    input.addEventListener("input", () => {
      updateRangeOutputs();
      previewTemporaryStyle();
    });
  }

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  ui.save.addEventListener("click", saveCurrentStyle);
  ui.removeUserStyle.addEventListener("click", removeCurrentUserStyle);
  ui.exportConfig.addEventListener("click", () => void copyConfig());
  ui.previewClear.addEventListener("click", () => previewApi()?.clear());
  ui.previewStreamer.addEventListener("click", () => previewApi()?.addMessage({
    displayName: "Crazy_Batto",
    text: "Streamer-Hologramm in Rot, Gold oder eigener Farbe.",
    roles: { broadcaster: true }
  }));
  ui.previewMod.addEventListener("click", () => previewApi()?.addMessage({
    displayName: "Moderator",
    text: "Moderator-Stil kann separat geändert werden.",
    roles: { moderator: true }
  }));
  ui.previewViewer.addEventListener("click", () => previewApi()?.addMessage({
    displayName: "Zuschauer",
    text: "Auch normale Zuschauer können einen kostenlosen Hologramm-Stil bekommen.",
    roles: {}
  }));

  loadGlobalInputs();
  updateTargetUi();
  updateRangeOutputs();
  setStatus("Bereit. Keine Discord-Verbindung und kein Server-Boost erforderlich.");
})();
