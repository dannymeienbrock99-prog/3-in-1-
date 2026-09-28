"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    status: $("#connection-status"), orientation: $("#orientation-select"), url: $("#overlay-url"), copy: $("#copy-url"), save: $("#save-config"),
    palette: $("#element-palette"), canvas: $("#editor-canvas"), shell: $("#canvas-shell"), empty: $("#empty-inspector"), form: $("#inspector-form"),
    title: $("#field-title"), text: $("#field-text"), value: $("#field-value"), target: $("#field-target"), fontSize: $("#field-font-size"), fontSizeOutput: $("#font-size-output"),
    font: $("#field-font"), textColor: $("#field-text-color"), accent: $("#field-accent"), background: $("#field-background"), backgroundOpacity: $("#field-background-opacity"), backgroundOpacityOutput: $("#background-opacity-output"),
    borderColor: $("#field-border-color"), borderWidth: $("#field-border-width"), radius: $("#field-radius"), width: $("#field-width"), height: $("#field-height"), alignment: $("#field-alignment"), visible: $("#field-visible"), locked: $("#field-locked"), deleteElement: $("#delete-element"),
    testType: $("#test-type"), testName: $("#test-name"), testText: $("#test-text"), testValue: $("#test-value"), triggerTest: $("#trigger-test"),
    testChat: $("#test-chat"), testGift: $("#test-gift"), clear: $("#clear-events"), close: $("#close-button"), toast: $("#toast")
  };
  const palette = [
    ["text", "Text", "Freier Hinweis"], ["goal", "Ziel", "Follower oder Likes"], ["timer", "Timer", "Stream-Laufzeit"],
    ["chat", "Chat", "Live-Nachrichten"], ["giftFeed", "Geschenk-Feed", "Geschenke in Echtzeit"], ["giftAlarm", "Geschenk-Alarm", "Letztes Geschenk groß"],
    ["topList", "Topliste", "Top-Gifter"], ["likeCounter", "Like-Zähler", "Aktuelle Likes"], ["coHost", "Co-Host", "Gastname und Status"],
    ["treasure", "Schatztruhe", "Truhen-Ereignisse"], ["portal", "Portal", "Portal-Ereignisse"], ["tiktokEvents", "TikTok-Ereignisse", "Lokaler Ereignisfeed"],
    ["heartRate", "Herzfrequenz", "Pulsoid oder lokaler Sensor"], ["wheel", "Glücksrad", "Lokales Wheel"], ["poll", "Umfrage", "Abstimmung"],
    ["wordCloud", "Wortwolke", "Häufige Chatwörter"], ["logo", "Team-Logo", "Crazy_Batto / Team Alpha"], ["image", "Bild", "Eigene Bildquelle"]
  ];
  let config = { width: 1920, height: 1080, elements: [] };
  let selectedId = "";
  let socket = null;
  let drag = null;
  let saveTimer = null;

  function toast(message, error = false) {
    ui.toast.textContent = message;
    ui.toast.style.borderColor = error ? "#a33d4b" : "#4c697e";
    ui.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ui.toast.classList.remove("show"), 2200);
  }

  function selected() { return config.elements.find((element) => element.id === selectedId) || null; }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, Number(value) || 0)); }
  function debounceSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(false), 450); }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(`${protocol}//${location.host}/ws`);
    socket = current;
    current.addEventListener("open", () => { ui.status.textContent = "Lokal aktiv"; current.send(JSON.stringify({ type: "get-config" })); });
    current.addEventListener("message", (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === "config") { config = packet.config; updateOrientation(); render(); }
        if (packet.type === "saved") toast(packet.ok ? "Overlay gespeichert" : packet.error || "Speichern fehlgeschlagen", !packet.ok);
      } catch {}
    });
    current.addEventListener("close", () => { ui.status.textContent = "Verbindung unterbrochen"; setTimeout(connect, 1800); });
    current.addEventListener("error", () => current.close());
  }

  function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  function save(showMessage = true) {
    config.updatedAt = Date.now();
    send({ type: "save-config", config });
    if (showMessage) toast("Speichern angefordert");
  }

  function updateOrientation() {
    ui.orientation.value = `${config.width}x${config.height}`;
    ui.canvas.style.setProperty("--aspect", String(config.width / config.height));
    ui.url.value = `${location.origin}/overlay`;
  }

  function elementStyle(node, item) {
    node.style.left = `${item.x}%`;
    node.style.top = `${item.y}%`;
    node.style.width = `${item.width}%`;
    node.style.height = `${item.height}%`;
    node.style.zIndex = item.zIndex;
    node.style.setProperty("--padding", `${item.padding}px`);
    node.style.setProperty("--border-width", `${item.borderWidth}px`);
    node.style.setProperty("--border-color", item.borderColor);
    node.style.setProperty("--radius", `${item.borderRadius}px`);
    node.style.setProperty("--text-color", item.textColor);
    node.style.setProperty("--background", item.backgroundColor);
    node.style.setProperty("--background-opacity", String(item.backgroundOpacity));
    node.style.setProperty("--shadow", `${item.shadow}px`);
    node.style.setProperty("--accent", item.accentColor);
    node.style.setProperty("--font", item.fontFamily);
    node.style.setProperty("--font-size", `${item.fontSize}px`);
    node.style.setProperty("--font-weight", item.fontWeight);
    node.style.setProperty("--alignment", item.alignment);
    node.hidden = !item.visible;
  }

  function previewContent(item) {
    const fragment = document.createDocumentFragment();
    if (["logo", "image"].includes(item.type)) {
      const image = document.createElement("img");
      image.src = item.source || "/assets/team-logo";
      image.alt = "";
      fragment.append(image);
      return fragment;
    }
    const title = document.createElement("div");
    title.className = "element-title";
    title.textContent = item.title;
    fragment.append(title);
    const value = document.createElement("div");
    const samples = {
      text: item.text || "Freier Hinweis", goal: `${item.value || 0} / ${item.target || 1000}`, timer: "02:47:13", chat: "Noch keine Chat-Nachricht",
      giftFeed: "Noch kein Geschenk", giftAlarm: "Geschenk-Alarm", topList: "1. Top-Gifter", likeCounter: "12.450",
      coHost: "Kein Co-Host", treasure: "Schatztruhe", portal: "Portal", tiktokEvents: "TikTok-Ereignisse",
      heartRate: "♥ 82 BPM", wheel: "GLÜCKSRAD", poll: "Umfrage", wordCloud: "Batto  OBS  Live"
    };
    value.textContent = samples[item.type] || item.text || item.title;
    fragment.append(value);
    return fragment;
  }

  function render() {
    const nodes = config.elements.map((item) => {
      const node = document.createElement("article");
      node.className = `editor-element${item.id === selectedId ? " selected" : ""}${item.locked ? " locked" : ""}`;
      node.dataset.id = item.id;
      node.dataset.type = item.type;
      elementStyle(node, item);
      node.append(previewContent(item));
      const handle = document.createElement("span");
      handle.className = "resize-handle";
      handle.hidden = item.locked;
      handle.addEventListener("pointerdown", (event) => beginDrag(event, item, "resize"));
      node.append(handle);
      node.addEventListener("pointerdown", (event) => {
        selectedId = item.id;
        renderInspector();
        document.querySelectorAll(".editor-element").forEach((element) => element.classList.toggle("selected", element.dataset.id === selectedId));
        if (!item.locked && !event.target.classList.contains("resize-handle")) beginDrag(event, item, "move");
      });
      return node;
    });
    ui.canvas.replaceChildren(...nodes);
    renderInspector();
  }

  function beginDrag(event, item, mode) {
    event.preventDefault();
    const rect = ui.canvas.getBoundingClientRect();
    drag = { mode, id: item.id, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, width: item.width, height: item.height, rect };
    event.target.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const item = config.elements.find((element) => element.id === drag.id);
    if (!item) return;
    const dx = (event.clientX - drag.startX) / drag.rect.width * 100;
    const dy = (event.clientY - drag.startY) / drag.rect.height * 100;
    if (drag.mode === "move") {
      item.x = clamp(drag.x + dx, 0, 100 - item.width);
      item.y = clamp(drag.y + dy, 0, 100 - item.height);
    } else {
      item.width = clamp(drag.width + dx, 2, 100 - item.x);
      item.height = clamp(drag.height + dy, 2, 100 - item.y);
    }
    const node = ui.canvas.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    if (node) elementStyle(node, item);
    fillInspectorPosition(item);
  }

  function endDrag() { if (drag) { drag = null; debounceSave(); } }

  function renderInspector() {
    const item = selected();
    ui.empty.hidden = Boolean(item);
    ui.form.hidden = !item;
    if (!item) return;
    ui.title.value = item.title || "";
    ui.text.value = item.text || "";
    ui.value.value = item.value ?? 0;
    ui.target.value = item.target ?? 0;
    ui.fontSize.value = item.fontSize;
    ui.fontSizeOutput.value = `${item.fontSize}px`;
    ui.font.value = item.fontFamily;
    ui.textColor.value = item.textColor;
    ui.accent.value = item.accentColor;
    ui.background.value = item.backgroundColor;
    ui.backgroundOpacity.value = item.backgroundOpacity;
    ui.backgroundOpacityOutput.value = `${Math.round(item.backgroundOpacity * 100)}%`;
    ui.borderColor.value = item.borderColor;
    ui.borderWidth.value = item.borderWidth;
    ui.radius.value = item.borderRadius;
    ui.width.value = item.width.toFixed(1);
    ui.height.value = item.height.toFixed(1);
    ui.alignment.value = item.alignment;
    ui.visible.checked = item.visible;
    ui.locked.checked = item.locked;
  }

  function fillInspectorPosition(item) {
    if (selectedId !== item.id) return;
    ui.width.value = item.width.toFixed(1);
    ui.height.value = item.height.toFixed(1);
  }

  function updateSelected(patch) {
    const item = selected();
    if (!item) return;
    Object.assign(item, patch);
    render();
    debounceSave();
  }

  function addElement(type) {
    fetch("/api/config").then(() => {
      const id = `${type}-${crypto.randomUUID?.() || Date.now()}`;
      const base = {
        id, type, title: palette.find((entry) => entry[0] === type)?.[1] || type, text: type === "text" ? "Freier Hinweis" : "",
        x: 8 + config.elements.length % 5 * 8, y: 8 + config.elements.length % 4 * 8, width: type === "logo" ? 18 : 24, height: type === "logo" ? 20 : 14,
        zIndex: config.elements.length + 1, visible: true, locked: false, fontSize: 34, fontFamily: "Inter, Segoe UI, Arial, sans-serif", fontWeight: 800,
        textColor: "#ffffff", accentColor: "#4fd8ff", backgroundColor: "#0b1522", backgroundOpacity: ["logo", "image"].includes(type) ? 0 : .72,
        borderColor: "#33546b", borderWidth: ["logo", "image"].includes(type) ? 0 : 1, borderRadius: 14, padding: 14, alignment: "center", shadow: 18,
        value: 0, target: 1000, durationMs: 20000, maximumItems: 8, source: type === "logo" ? "/assets/team-logo" : "", settings: {}
      };
      config.elements.push(base);
      selectedId = id;
      render();
      save(false);
    });
  }

  ui.palette.replaceChildren(...palette.map(([type, name, description]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-item";
    const strong = document.createElement("strong");
    strong.textContent = name;
    const small = document.createElement("small");
    small.textContent = description;
    button.append(strong, small);
    button.addEventListener("click", () => addElement(type));
    return button;
  }));

  const bindings = [
    [ui.title, "input", () => ({ title: ui.title.value })], [ui.text, "input", () => ({ text: ui.text.value })],
    [ui.value, "input", () => ({ value: Number(ui.value.value) || 0 })], [ui.target, "input", () => ({ target: Number(ui.target.value) || 0 })],
    [ui.fontSize, "input", () => { ui.fontSizeOutput.value = `${ui.fontSize.value}px`; return { fontSize: Number(ui.fontSize.value) }; }],
    [ui.font, "change", () => ({ fontFamily: ui.font.value })], [ui.textColor, "input", () => ({ textColor: ui.textColor.value })],
    [ui.accent, "input", () => ({ accentColor: ui.accent.value })], [ui.background, "input", () => ({ backgroundColor: ui.background.value })],
    [ui.backgroundOpacity, "input", () => { ui.backgroundOpacityOutput.value = `${Math.round(ui.backgroundOpacity.value * 100)}%`; return { backgroundOpacity: Number(ui.backgroundOpacity.value) }; }],
    [ui.borderColor, "input", () => ({ borderColor: ui.borderColor.value })], [ui.borderWidth, "input", () => ({ borderWidth: Number(ui.borderWidth.value) })],
    [ui.radius, "input", () => ({ borderRadius: Number(ui.radius.value) })], [ui.width, "input", () => ({ width: clamp(ui.width.value, 2, 100 - (selected()?.x || 0)) })],
    [ui.height, "input", () => ({ height: clamp(ui.height.value, 2, 100 - (selected()?.y || 0)) })], [ui.alignment, "change", () => ({ alignment: ui.alignment.value })],
    [ui.visible, "change", () => ({ visible: ui.visible.checked })], [ui.locked, "change", () => ({ locked: ui.locked.checked })]
  ];
  for (const [control, event, build] of bindings) control.addEventListener(event, () => updateSelected(build()));

  ui.deleteElement.addEventListener("click", () => {
    if (!selectedId) return;
    config.elements = config.elements.filter((element) => element.id !== selectedId);
    selectedId = "";
    render();
    save(false);
  });
  ui.orientation.addEventListener("change", () => {
    const [width, height] = ui.orientation.value.split("x").map(Number);
    config.width = width;
    config.height = height;
    config.orientation = height > width ? "portrait" : "landscape";
    updateOrientation();
    save(false);
  });
  ui.copy.addEventListener("click", async () => { await navigator.clipboard.writeText(ui.url.value); toast("OBS-Adresse kopiert"); });
  ui.save.addEventListener("click", () => save(true));
  ui.triggerTest.addEventListener("click", () => send({ type: "event", event: { type: ui.testType.value, platform: "local", name: ui.testName.value, text: ui.testText.value, value: Number(ui.testValue.value) || 0, timestamp: Date.now() } }));
  ui.testChat.addEventListener("click", () => send({ type: "event", event: { type: "chat", platform: "twitch", name: "Crazy_Batto", text: "Testnachricht aus Batto OBS Tool", timestamp: Date.now() } }));
  ui.testGift.addEventListener("click", () => send({ type: "event", event: { type: "gift", platform: "tiktok", name: "Zuschauer", text: "Team-Alpha-Geschenk", value: 10, timestamp: Date.now() } }));
  ui.clear.addEventListener("click", () => send({ type: "clear" }));
  ui.close.addEventListener("click", () => window.close());
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  connect();
})();
