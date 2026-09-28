"use strict";

(() => {
  const stage = document.getElementById("stage");
  const viewport = document.getElementById("viewport");
  const elements = new Map();
  const timers = new Map();
  let config = { resolution: { width: 1920, height: 1080 }, elements: [] };
  let socket = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  const startedAt = Date.now();

  function text(value) { return String(value ?? ""); }
  function safeColor(value, fallback) { return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text(value)) || /^(?:rgba?|hsla?)\(/i.test(text(value)) || value === "transparent" ? text(value) : fallback; }

  function fitStage() {
    const width = Number(config.resolution?.width) || 1920;
    const height = Number(config.resolution?.height) || 1080;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    const scale = Math.min(viewport.clientWidth / width, viewport.clientHeight / height);
    stage.style.transform = `scale(${scale || 1})`;
  }

  function styleElement(node, item) {
    node.style.left = `${item.x}px`;
    node.style.top = `${item.y}px`;
    node.style.width = `${item.width}px`;
    node.style.height = `${item.height}px`;
    node.style.setProperty("--opacity", item.opacity);
    node.style.setProperty("--color", safeColor(item.color, "#ffffff"));
    node.style.setProperty("--accent", safeColor(item.accent, "#55d6ff"));
    node.style.setProperty("--background", safeColor(item.background, "transparent"));
    node.style.setProperty("--border-color", safeColor(item.borderColor, "transparent"));
    node.style.setProperty("--border-width", `${item.borderWidth || 0}px`);
    node.style.setProperty("--radius", `${item.radius || 0}px`);
    node.style.setProperty("--font-size", `${item.fontSize || 28}px`);
    node.style.setProperty("--font", item.fontFamily || "Inter, Segoe UI, Arial");
    node.classList.toggle("hidden", item.visible === false);
  }

  function createBase(item) {
    const node = document.createElement("section");
    node.className = `overlay-element type-${item.type}`;
    node.dataset.id = item.id;
    styleElement(node, item);
    return node;
  }

  function createTitle(item) {
    const title = document.createElement("div");
    title.className = "element-title";
    title.textContent = item.title || "";
    return title;
  }

  function renderItem(item) {
    const node = createBase(item);
    const title = createTitle(item);
    if (item.type !== "image") node.append(title);

    if (item.type === "image") {
      const image = document.createElement("img");
      image.src = item.src || "/team-logo.svg";
      image.alt = item.title || "";
      image.style.setProperty("--fit", item.fit || "contain");
      image.style.objectFit = item.fit || "contain";
      node.append(image);
    } else if (item.type === "goal") {
      const row = document.createElement("div"); row.className = "goal-row";
      const value = document.createElement("strong"); value.className = "element-value"; value.textContent = formatGoal(item.value, item.target);
      const target = document.createElement("span"); target.textContent = `Ziel ${formatNumber(item.target)}`;
      const bar = document.createElement("div"); bar.className = "goal-bar"; bar.append(document.createElement("span"));
      row.append(value, target); node.append(row, bar);
      updateGoal(node, item.value, item.target);
    } else if (item.type === "timer") {
      const value = document.createElement("div"); value.className = "element-value"; value.dataset.role = "timer"; node.append(value);
      updateTimer(value);
    } else if (["chat", "giftFeed", "topList"].includes(item.type)) {
      const list = document.createElement("div"); list.className = "message-list"; list.dataset.role = "messages"; node.append(list);
    } else if (item.type === "giftAlarm") {
      const hero = document.createElement("div"); hero.className = "gift-hero"; hero.dataset.role = "gift-hero"; hero.textContent = "Bereit"; node.append(hero);
    } else if (item.type === "likeCounter") {
      const value = document.createElement("div"); value.className = "element-value"; value.dataset.role = "likes"; value.textContent = formatNumber(item.value); node.append(value);
    } else if (item.type === "heartRate") {
      const value = document.createElement("div"); value.className = "element-value"; value.dataset.role = "heart"; value.textContent = `${formatNumber(item.value || 0)} BPM`; node.append(value);
    } else if (item.type === "coHost") {
      const list = document.createElement("div"); list.className = "cohost-list"; list.dataset.role = "cohosts"; node.append(list);
    } else if (item.type === "wheel") {
      const result = document.createElement("div"); result.className = "wheel-result element-value"; result.dataset.role = "wheel"; result.textContent = item.text || "Bereit"; node.append(result);
    } else if (item.type === "poll") {
      const result = document.createElement("div"); result.className = "poll-result"; result.dataset.role = "poll-title"; result.textContent = item.text || "Umfrage";
      const bars = document.createElement("div"); bars.className = "poll-bars"; bars.dataset.role = "poll-bars"; node.append(result, bars);
    } else if (item.type === "wordcloud") {
      const cloud = document.createElement("div"); cloud.className = "wordcloud"; cloud.dataset.role = "wordcloud"; cloud.textContent = item.text || "Wortwolke"; node.append(cloud);
    } else if (item.type === "gamepad") {
      const grid = document.createElement("div"); grid.className = "gamepad-grid"; grid.dataset.role = "gamepad";
      for (const key of ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "↑", "↓", "←", "→"]) { const button = document.createElement("span"); button.className = "gamepad-key"; button.dataset.key = key; button.textContent = key; grid.append(button); }
      node.append(grid);
    } else {
      const value = document.createElement("div"); value.className = "element-value"; value.dataset.role = "value"; value.textContent = item.text || formatNumber(item.value); node.append(value);
    }
    return node;
  }

  function applyConfig(next) {
    config = next && typeof next === "object" ? next : config;
    stage.replaceChildren(); elements.clear();
    for (const item of config.elements || []) {
      const node = renderItem(item);
      stage.append(node); elements.set(item.id, { item, node });
    }
    fitStage();
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("de-DE", { maximumFractionDigits: 1 }) : text(value || "0");
  }
  function formatGoal(value, target) { return `${formatNumber(value)} / ${formatNumber(target)}`; }
  function updateGoal(node, value, target) {
    const safeTarget = Math.max(1, Number(target) || 1); const safeValue = Math.max(0, Number(value) || 0);
    node.querySelector(".goal-row strong").textContent = formatGoal(safeValue, safeTarget);
    node.querySelector(".goal-row span").textContent = `Ziel ${formatNumber(safeTarget)}`;
    node.querySelector(".goal-bar span").style.width = `${Math.min(100, safeValue / safeTarget * 100)}%`;
  }
  function updateTimer(node) {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60); const remaining = seconds % 60;
    node.textContent = [hours, minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":");
  }

  function addMessage(item, event, gift = false) {
    const list = item.node.querySelector('[data-role="messages"]');
    if (!list) return;
    const row = document.createElement("article"); row.className = "message-row"; row.dataset.messageId = event.id || ""; row.dataset.userId = event.userId || "";
    const name = document.createElement("strong"); name.textContent = event.name || event.displayName || event.user || (gift ? "Geschenk" : "Zuschauer");
    if (event.color) name.style.setProperty("--name-color", safeColor(event.color, "var(--accent)"));
    const message = document.createElement("span"); message.textContent = gift ? `${event.text || "Geschenk"}${event.value ? ` × ${formatNumber(event.value)}` : ""}` : event.text || "";
    row.append(name, message); list.append(row);
    const maximum = item.item.maxMessages || 10;
    while (list.children.length > maximum) list.firstElementChild?.remove();
    const displayMs = item.item.displayMs || 20000;
    const timer = setTimeout(() => removeRow(row), displayMs); timers.set(event.id, timer);
  }

  function removeRow(row) {
    if (!row?.isConnected) return;
    row.classList.add("removing"); setTimeout(() => row.remove(), 300);
  }

  function showGiftHero(item, event) {
    const hero = item.node.querySelector('[data-role="gift-hero"]'); if (!hero) return;
    hero.replaceChildren();
    if (event.image) { const image = document.createElement("img"); image.src = event.image; image.alt = ""; hero.append(image); }
    const name = document.createElement("strong"); name.textContent = event.text || "Geschenk"; const user = document.createElement("span"); user.textContent = event.name || "Zuschauer"; hero.append(name, user);
    hero.animate([{ opacity: 0, transform: "scale(.3) rotate(-8deg)" }, { opacity: 1, transform: "scale(1.08) rotate(2deg)", offset: .75 }, { transform: "scale(1)" }], { duration: 650, easing: "cubic-bezier(.2,.9,.2,1)" });
    clearTimeout(item.heroTimer); item.heroTimer = setTimeout(() => { hero.textContent = "Bereit"; }, item.item.displayMs || 7000);
  }

  function handleEvent(event) {
    const type = text(event.type).toLowerCase();
    if (type === "clearchat") { document.querySelectorAll('.message-list').forEach((list) => list.replaceChildren()); return; }
    if (type === "deletechat") { document.querySelectorAll(`[data-message-id="${CSS.escape(text(event.id))}"]`).forEach((row) => row.remove()); return; }
    if (type === "clearuser") { document.querySelectorAll(`[data-user-id="${CSS.escape(text(event.userId))}"]`).forEach((row) => row.remove()); return; }
    for (const item of elements.values()) {
      const itemType = item.item.type;
      if (type === "chat" && itemType === "chat") addMessage(item, event, false);
      if (type === "gift" && itemType === "giftFeed") addMessage(item, event, true);
      if (type === "gift" && itemType === "giftAlarm") showGiftHero(item, event);
      if ((type === "like" || type === "likes") && itemType === "likeCounter") item.node.querySelector('[data-role="likes"]').textContent = formatNumber(event.value);
      if ((type === "heartrate" || type === "heart") && itemType === "heartRate") item.node.querySelector('[data-role="heart"]').textContent = `${formatNumber(event.value)} BPM`;
      if (type === "goal" && itemType === "goal") updateGoal(item.node, event.value, event.target || item.item.target);
      if (type === "cohost" && itemType === "coHost") {
        const root = item.node.querySelector('[data-role="cohosts"]'); root.replaceChildren();
        const names = Array.isArray(event.data?.users) ? event.data.users : [event.name || event.text].filter(Boolean);
        names.forEach((name) => { const chip = document.createElement("span"); chip.className = "cohost-chip"; chip.textContent = text(name); root.append(chip); });
      }
      if (type === "wheel" && itemType === "wheel") item.node.querySelector('[data-role="wheel"]').textContent = event.text || event.data?.winner || "Ergebnis";
      if (type === "poll" && itemType === "poll") renderPoll(item, event);
      if (type === "wordcloud" && itemType === "wordcloud") item.node.querySelector('[data-role="wordcloud"]').textContent = Array.isArray(event.data?.words) ? event.data.words.join(" · ") : event.text || "";
      if (type === "gamepad" && itemType === "gamepad") {
        const active = new Set(event.data?.buttons || []); item.node.querySelectorAll(".gamepad-key").forEach((key) => key.classList.toggle("active", active.has(key.dataset.key)));
      }
      if (["text", "portal", "treasure"].includes(type) && itemType.toLowerCase() === type) { const target = item.node.querySelector('[data-role="value"]'); if (target) target.textContent = event.text || formatNumber(event.value); }
    }
  }

  function renderPoll(item, event) {
    item.node.querySelector('[data-role="poll-title"]').textContent = event.text || event.data?.question || "Umfrage";
    const bars = item.node.querySelector('[data-role="poll-bars"]'); bars.replaceChildren();
    const options = Array.isArray(event.data?.options) ? event.data.options : [];
    const total = options.reduce((sum, option) => sum + (Number(option.votes) || 0), 0) || 1;
    options.forEach((option) => {
      const row = document.createElement("div"); row.className = "poll-row";
      const label = document.createElement("span"); label.textContent = option.label || option.name || "Option";
      const track = document.createElement("div"); track.className = "poll-track"; const fill = document.createElement("span"); fill.style.width = `${(Number(option.votes) || 0) / total * 100}%`; track.append(fill);
      const value = document.createElement("strong"); value.textContent = formatNumber(option.votes || 0); row.append(label, track, value); bars.append(row);
    });
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(`${protocol}//${location.host}/ws`); socket = current;
    current.addEventListener("open", () => { reconnectDelay = 1000; });
    current.addEventListener("message", (message) => {
      try {
        const envelope = JSON.parse(message.data);
        if (envelope.type === "config") applyConfig(envelope.config);
        if (envelope.type === "event") handleEvent(envelope.event);
      } catch {}
    });
    current.addEventListener("close", () => { if (socket !== current) return; socket = null; reconnectTimer = setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(30000, reconnectDelay * 2); });
    current.addEventListener("error", () => current.close());
  }

  fetch("/api/config", { cache: "no-store" }).then((response) => response.json()).then(applyConfig).catch(() => {});
  setInterval(() => document.querySelectorAll('[data-role="timer"]').forEach(updateTimer), 1000);
  addEventListener("resize", fitStage);
  connect();
})();
