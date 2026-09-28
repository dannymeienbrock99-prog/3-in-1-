"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    config: { version: 2, resolution: { width: 1920, height: 1080 }, background: "transparent", elements: [] },
    selectedId: "",
    scale: 1,
    pointer: null,
    dirty: false
  };

  const TYPE_DEFAULTS = Object.freeze({
    text: { title: "Text", text: "Freier Hinweis", width: 360, height: 90, fontSize: 34, accent: "#55d6ff" },
    goal: { title: "Follower-Ziel", value: 0, target: 1000, width: 410, height: 105, fontSize: 30, accent: "#55d6ff" },
    timer: { title: "Stream-Timer", width: 330, height: 104, fontSize: 34, accent: "#8d5cff" },
    chat: { title: "Live-Chat", width: 500, height: 360, fontSize: 27, maxMessages: 8, displayMs: 20000, accent: "#55d6ff" },
    giftFeed: { title: "Geschenke", width: 500, height: 360, fontSize: 27, maxMessages: 8, displayMs: 20000, accent: "#ff4f95" },
    giftAlarm: { title: "Geschenk-Alarm", width: 500, height: 300, fontSize: 30, displayMs: 7000, accent: "#ff4f95" },
    topList: { title: "Top-Gifter", width: 420, height: 300, fontSize: 26, accent: "#ffd166" },
    likeCounter: { title: "Likes", value: 0, width: 260, height: 110, fontSize: 35, accent: "#ff668e" },
    coHost: { title: "Co-Host", width: 420, height: 170, fontSize: 26, accent: "#55d6ff" },
    heartRate: { title: "Herzfrequenz", value: 80, width: 300, height: 120, fontSize: 35, accent: "#ff4d70" },
    wheel: { title: "Glücksrad", text: "Bereit", width: 420, height: 180, fontSize: 34, accent: "#ffd166" },
    poll: { title: "Umfrage", text: "Welche Option gewinnt?", width: 500, height: 260, fontSize: 26, accent: "#55d6ff" },
    wordcloud: { title: "Wortwolke", text: "Streaming · Gaming · Team Alpha", width: 520, height: 260, fontSize: 32, accent: "#8d5cff" },
    gamepad: { title: "Gamepad", width: 420, height: 240, fontSize: 28, accent: "#55d6ff" },
    image: { title: "Team Alpha", src: "/team-logo.svg", width: 180, height: 180, fit: "contain", background: "transparent", borderColor: "transparent", borderWidth: 0, radius: 0 }
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, number(value, minimum)));
  }

  function colorForInput(value, fallback = "#ffffff") {
    const text = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text;
    if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text.slice(1).split("").map((entry) => entry + entry).join("")}`;
    return fallback;
  }

  function selected() {
    return state.config.elements.find((item) => item.id === state.selectedId) || null;
  }

  function markDirty(message = "Nicht gespeicherte Änderungen") {
    state.dirty = true;
    $("config-state").textContent = message;
    $("config-state").style.color = "#ffd16d";
  }

  function markSaved(message = "Lokale Einstellungen gespeichert") {
    state.dirty = false;
    $("config-state").textContent = message;
    $("config-state").style.color = "#5de09a";
  }

  function toast(message, error = false) {
    const output = $("toast");
    output.textContent = String(message || "");
    output.className = `show${error ? " error" : ""}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { output.className = ""; output.textContent = ""; }, 4500);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    let body;
    const contentType = response.headers.get("content-type") || "";
    body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(body?.error?.message || body?.error || body || `HTTP ${response.status}`);
    return body;
  }

  function normalizeElement(input = {}) {
    const width = state.config.resolution.width;
    const height = state.config.resolution.height;
    const defaults = TYPE_DEFAULTS[input.type] || TYPE_DEFAULTS.text;
    const item = {
      id: String(input.id || `${input.type || "text"}-${crypto.randomUUID()}`),
      type: String(input.type || "text"),
      title: String(input.title ?? defaults.title ?? input.type ?? "Element").slice(0, 160),
      text: String(input.text ?? defaults.text ?? "").slice(0, 5000),
      x: number(input.x, 40),
      y: number(input.y, 40),
      width: clamp(input.width ?? defaults.width ?? 300, 40, width),
      height: clamp(input.height ?? defaults.height ?? 100, 30, height),
      opacity: clamp(input.opacity ?? 1, 0, 1),
      visible: input.visible !== false,
      value: number(input.value, defaults.value || 0),
      target: Math.max(1, number(input.target, defaults.target || 1000)),
      fontSize: clamp(input.fontSize ?? defaults.fontSize ?? 28, 8, 200),
      fontFamily: String(input.fontFamily || "Inter, Segoe UI, Arial").slice(0, 200),
      color: String(input.color || "#ffffff").slice(0, 120),
      accent: String(input.accent || defaults.accent || "#55d6ff").slice(0, 120),
      background: String(input.background ?? defaults.background ?? "rgba(10,18,29,.72)").slice(0, 160),
      borderColor: String(input.borderColor ?? defaults.borderColor ?? "#33485d").slice(0, 120),
      borderWidth: clamp(input.borderWidth ?? defaults.borderWidth ?? 1, 0, 20),
      radius: clamp(input.radius ?? defaults.radius ?? 16, 0, 100),
      src: String(input.src ?? defaults.src ?? "").slice(0, 4000),
      fit: ["contain", "cover", "fill"].includes(input.fit) ? input.fit : defaults.fit || "contain",
      maxMessages: clamp(input.maxMessages ?? defaults.maxMessages ?? 10, 1, 100),
      displayMs: clamp(input.displayMs ?? defaults.displayMs ?? 20000, 1000, 300000),
      options: input.options && typeof input.options === "object" ? clone(input.options) : {}
    };
    item.x = clamp(item.x, 0, Math.max(0, width - item.width));
    item.y = clamp(item.y, 0, Math.max(0, height - item.height));
    return item;
  }

  function normalizeConfig(input = {}) {
    const width = clamp(input.resolution?.width || input.width || 1920, 320, 7680);
    const height = clamp(input.resolution?.height || input.height || 1080, 240, 4320);
    state.config = { version: 2, resolution: { width, height }, background: "transparent", elements: [] };
    state.config.elements = (Array.isArray(input.elements) ? input.elements : []).map(normalizeElement).slice(0, 250);
    return state.config;
  }

  function determineResolutionOption() {
    const value = `${state.config.resolution.width}x${state.config.resolution.height}`;
    const option = [...$("resolution").options].find((entry) => entry.value === value);
    $("resolution").value = option ? value : "custom";
    const custom = $("resolution").value === "custom";
    $("custom-width-row").hidden = !custom;
    $("custom-height-row").hidden = !custom;
    $("custom-width").value = state.config.resolution.width;
    $("custom-height").value = state.config.resolution.height;
  }

  function updateScale() {
    const scroll = $("preview-scroll");
    const availableWidth = Math.max(240, scroll.clientWidth - 28);
    const availableHeight = Math.max(200, scroll.clientHeight - 28);
    const { width, height } = state.config.resolution;
    state.scale = Math.min(1, availableWidth / width, availableHeight / height);
    const stage = $("preview-stage");
    stage.style.width = `${width * state.scale}px`;
    stage.style.height = `${height * state.scale}px`;
  }

  function previewText(item) {
    if (item.type === "goal") return `${item.title}\n${item.value} / ${item.target}`;
    if (item.type === "timer") return `${item.title}\n00:47:13`;
    if (item.type === "chat") return `${item.title}\nCrazy_Batto: Vorschau-Nachricht`;
    if (item.type === "giftFeed") return `${item.title}\nZuschauer: Geschenk × 1`;
    if (item.type === "giftAlarm") return `${item.title}\nLetztes Geschenk`;
    if (item.type === "topList") return `${item.title}\n1. Crazy_Batto`;
    if (item.type === "likeCounter") return `${item.title}\n${item.value || 0}`;
    if (item.type === "coHost") return `${item.title}\nGast 1 · Gast 2`;
    if (item.type === "heartRate") return `${item.title}\n♥ ${item.value || 80} BPM`;
    if (item.type === "wheel") return `${item.title}\n${item.text || "Bereit"}`;
    if (item.type === "poll") return `${item.title}\n${item.text || "Umfrage"}`;
    if (item.type === "wordcloud") return item.text || item.title;
    if (item.type === "gamepad") return `${item.title}\nA  B  X  Y`;
    return item.text || item.title || item.type;
  }

  function renderPreview() {
    updateScale();
    const stage = $("preview-stage");
    stage.replaceChildren();
    for (const item of state.config.elements) stage.append(renderElement(item));
    fillProperties();
  }

  function renderElement(item) {
    const element = document.createElement("article");
    element.className = `preview-element${item.id === state.selectedId ? " selected" : ""}${item.visible === false ? " hidden" : ""}`;
    element.dataset.id = item.id;
    element.style.left = `${item.x * state.scale}px`;
    element.style.top = `${item.y * state.scale}px`;
    element.style.width = `${item.width * state.scale}px`;
    element.style.height = `${item.height * state.scale}px`;
    element.style.setProperty("--opacity", item.opacity);
    element.style.setProperty("--color", item.color);
    element.style.setProperty("--accent", item.accent);
    element.style.setProperty("--background", item.background);
    element.style.setProperty("--border-color", item.borderColor);
    element.style.setProperty("--border-width", `${item.borderWidth * state.scale}px`);
    element.style.setProperty("--radius", `${item.radius * state.scale}px`);
    element.style.setProperty("--font-size", `${Math.max(8, item.fontSize * state.scale)}px`);
    element.style.setProperty("--font", item.fontFamily);
    if (item.type === "image") {
      const image = document.createElement("img");
      image.src = item.src || "/team-logo.svg";
      image.alt = item.title || "";
      image.style.objectFit = item.fit || "contain";
      element.append(image);
    } else {
      const content = document.createElement("strong");
      content.textContent = previewText(item);
      content.style.whiteSpace = "pre-line";
      element.append(content);
    }
    const handle = document.createElement("span");
    handle.className = "resize-handle";
    handle.title = "Größe ändern";
    element.append(handle);
    element.addEventListener("pointerdown", (event) => beginPointer(event, item, event.target === handle ? "resize" : "move"));
    element.addEventListener("click", (event) => { event.stopPropagation(); state.selectedId = item.id; renderPreview(); });
    return element;
  }

  function beginPointer(event, item, mode) {
    event.preventDefault();
    event.stopPropagation();
    state.selectedId = item.id;
    state.pointer = {
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: item.x,
      startY: item.y,
      startWidth: item.width,
      startHeight: item.height
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", movePointer);
    document.addEventListener("pointerup", endPointer, { once: true });
    renderPreview();
  }

  function movePointer(event) {
    const pointer = state.pointer;
    const item = selected();
    if (!pointer || !item || event.pointerId !== pointer.pointerId) return;
    const deltaX = (event.clientX - pointer.startClientX) / state.scale;
    const deltaY = (event.clientY - pointer.startClientY) / state.scale;
    const { width: canvasWidth, height: canvasHeight } = state.config.resolution;
    if (pointer.mode === "move") {
      item.x = clamp(pointer.startX + deltaX, 0, canvasWidth - item.width);
      item.y = clamp(pointer.startY + deltaY, 0, canvasHeight - item.height);
    } else {
      item.width = clamp(pointer.startWidth + deltaX, 40, canvasWidth - item.x);
      item.height = clamp(pointer.startHeight + deltaY, 30, canvasHeight - item.y);
    }
    markDirty();
    renderPreview();
  }

  function endPointer() {
    document.removeEventListener("pointermove", movePointer);
    state.pointer = null;
  }

  function fillProperties() {
    const item = selected();
    $("empty-properties").hidden = Boolean(item);
    $("property-form").hidden = !item;
    if (!item) return;
    $("prop-title").value = item.title;
    $("prop-text").value = item.text;
    $("prop-value").value = item.value;
    $("prop-target").value = item.target;
    $("prop-x").value = Math.round(item.x);
    $("prop-y").value = Math.round(item.y);
    $("prop-width").value = Math.round(item.width);
    $("prop-height").value = Math.round(item.height);
    $("prop-font-size").value = item.fontSize;
    $("prop-font-size-output").value = `${Math.round(item.fontSize)} px`;
    $("prop-font-family").value = item.fontFamily;
    $("prop-color").value = colorForInput(item.color, "#ffffff");
    $("prop-accent").value = colorForInput(item.accent, "#55d6ff");
    $("prop-border-color").value = colorForInput(item.borderColor, "#33485d");
    $("prop-background").value = item.background;
    $("prop-opacity").value = item.opacity;
    $("prop-opacity-output").value = `${Math.round(item.opacity * 100)} %`;
    $("prop-border-width").value = item.borderWidth;
    $("prop-radius").value = item.radius;
    $("prop-src").value = item.src;
    $("prop-fit").value = item.fit;
    $("prop-visible").checked = item.visible !== false;
    const image = item.type === "image";
    $("prop-src-row").hidden = !image;
    $("prop-fit-row").hidden = !image;
  }

  function updateSelectedFromForm() {
    const item = selected();
    if (!item) return;
    const canvas = state.config.resolution;
    item.title = $("prop-title").value.slice(0, 160);
    item.text = $("prop-text").value.slice(0, 5000);
    item.value = number($("prop-value").value, 0);
    item.target = Math.max(1, number($("prop-target").value, 1));
    item.width = clamp($("prop-width").value, 40, canvas.width);
    item.height = clamp($("prop-height").value, 30, canvas.height);
    item.x = clamp($("prop-x").value, 0, canvas.width - item.width);
    item.y = clamp($("prop-y").value, 0, canvas.height - item.height);
    item.fontSize = clamp($("prop-font-size").value, 8, 200);
    item.fontFamily = $("prop-font-family").value;
    item.color = $("prop-color").value;
    item.accent = $("prop-accent").value;
    item.borderColor = $("prop-border-color").value;
    item.background = $("prop-background").value.trim() || "transparent";
    item.opacity = clamp($("prop-opacity").value, 0, 1);
    item.borderWidth = clamp($("prop-border-width").value, 0, 20);
    item.radius = clamp($("prop-radius").value, 0, 100);
    item.src = $("prop-src").value.trim();
    item.fit = $("prop-fit").value;
    item.visible = $("prop-visible").checked;
    markDirty();
    renderPreview();
  }

  function addElement(type) {
    const defaults = TYPE_DEFAULTS[type] || TYPE_DEFAULTS.text;
    const offset = state.config.elements.length * 18;
    const item = normalizeElement({
      id: `${type}-${crypto.randomUUID()}`,
      type,
      ...defaults,
      x: 40 + offset % Math.max(80, state.config.resolution.width - (defaults.width || 300) - 80),
      y: 40 + offset % Math.max(80, state.config.resolution.height - (defaults.height || 100) - 80)
    });
    state.config.elements.push(item);
    state.selectedId = item.id;
    markDirty("Neues Element – noch nicht gespeichert");
    renderPreview();
  }

  function duplicateSelected() {
    const item = selected();
    if (!item) return;
    const copy = normalizeElement({ ...clone(item), id: `${item.type}-${crypto.randomUUID()}`, x: item.x + 25, y: item.y + 25, title: `${item.title} Kopie` });
    state.config.elements.push(copy);
    state.selectedId = copy.id;
    markDirty("Element dupliziert – noch nicht gespeichert");
    renderPreview();
  }

  function deleteSelected() {
    if (!state.selectedId) return;
    state.config.elements = state.config.elements.filter((item) => item.id !== state.selectedId);
    state.selectedId = "";
    markDirty("Element gelöscht – noch nicht gespeichert");
    renderPreview();
  }

  function changeResolution(width, height) {
    state.config.resolution.width = clamp(width, 320, 7680);
    state.config.resolution.height = clamp(height, 240, 4320);
    state.config.elements = state.config.elements.map((item) => normalizeElement(item));
    markDirty("Auflösung geändert – noch nicht gespeichert");
    determineResolutionOption();
    renderPreview();
  }

  async function saveConfig() {
    const result = await request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.config)
    });
    normalizeConfig(result.config || state.config);
    determineResolutionOption();
    renderPreview();
    markSaved();
    toast("Overlay wurde lokal gespeichert.");
  }

  async function triggerTest() {
    const type = $("test-type").value;
    const event = {
      type,
      name: $("test-name").value,
      text: $("test-text").value,
      value: number($("test-value").value, 1),
      target: selected()?.target || 1000
    };
    if (type === "poll") event.data = { question: event.text || "Umfrage", options: [{ label: "Option A", votes: 7 }, { label: "Option B", votes: 4 }, { label: "Option C", votes: 2 }] };
    if (type === "wordcloud") event.data = { words: ["Gaming", "Stream", "Team Alpha", "OBS", "Crazy_Batto"] };
    if (type === "gamepad") event.data = { buttons: ["A", "RB", "↑"] };
    if (type === "coHost") event.data = { users: [event.name || "Gast 1", "Gast 2"] };
    await request("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) });
    toast("Testereignis wurde ausgelöst.");
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function bind() {
    $("preview-stage").addEventListener("click", (event) => { if (event.target === $("preview-stage")) { state.selectedId = ""; renderPreview(); } });
    $$('[data-add]').forEach((button) => button.addEventListener("click", () => addElement(button.dataset.add)));
    $("save-config").addEventListener("click", () => saveConfig().catch((error) => toast(error.message, true)));
    $("copy-url").addEventListener("click", async () => { await copyText($("obs-url").value); toast("OBS-Adresse kopiert."); });
    $("open-overlay").addEventListener("click", () => window.open($("obs-url").value, "_blank", "noopener"));
    $("duplicate-element").addEventListener("click", duplicateSelected);
    $("delete-element").addEventListener("click", deleteSelected);
    $("trigger-test").addEventListener("click", () => triggerTest().catch((error) => toast(error.message, true)));

    const propertyInputs = [
      "prop-title", "prop-text", "prop-value", "prop-target", "prop-x", "prop-y", "prop-width", "prop-height",
      "prop-font-size", "prop-font-family", "prop-color", "prop-accent", "prop-border-color", "prop-background",
      "prop-opacity", "prop-border-width", "prop-radius", "prop-src", "prop-fit", "prop-visible"
    ];
    propertyInputs.forEach((id) => $(id).addEventListener(id.includes("range") ? "input" : "input", updateSelectedFromForm));
    $("prop-visible").addEventListener("change", updateSelectedFromForm);
    $("resolution").addEventListener("change", () => {
      const custom = $("resolution").value === "custom";
      $("custom-width-row").hidden = !custom;
      $("custom-height-row").hidden = !custom;
      if (!custom) {
        const [width, height] = $("resolution").value.split("x").map(Number);
        changeResolution(width, height);
      }
    });
    for (const id of ["custom-width", "custom-height"]) $(id).addEventListener("change", () => changeResolution($("custom-width").value, $("custom-height").value));
    addEventListener("resize", renderPreview);
    addEventListener("beforeunload", (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
  }

  async function initialize() {
    bind();
    const status = await request("/api/status");
    $("server-state").textContent = status.running ? `Lokal aktiv · ${status.sources || 0} Quelle(n)` : "Lokaler Server nicht aktiv";
    $("obs-url").value = status.overlayUrl || `${location.origin}/overlay.html`;
    normalizeConfig(await request("/api/config"));
    determineResolutionOption();
    renderPreview();
    markSaved("Lokale Einstellungen geladen");
  }

  initialize().catch((error) => {
    $("server-state").textContent = "Fehler";
    $("server-state").style.color = "#ff8d9c";
    toast(error.message, true);
  });
})();
