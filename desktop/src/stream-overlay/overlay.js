"use strict";

(() => {
  const stage = document.getElementById("stage");
  let config = { elements: [], backgroundOpacity: 0, backgroundColor: "#000000" };
  let socket = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  const events = [];
  const timers = new Map();
  const state = { likes: 0, goal: 0, heartRate: 0, coHost: "", chat: [], gifts: [], words: new Map(), poll: {} };

  function css(element, item) {
    element.style.left = `${item.x}%`;
    element.style.top = `${item.y}%`;
    element.style.width = `${item.width}%`;
    element.style.height = `${item.height}%`;
    element.style.zIndex = String(item.zIndex || 1);
    element.style.setProperty("--padding", `${item.padding || 0}px`);
    element.style.setProperty("--border-width", `${item.borderWidth || 0}px`);
    element.style.setProperty("--border-color", item.borderColor || "#33546b");
    element.style.setProperty("--radius", `${item.borderRadius || 0}px`);
    element.style.setProperty("--text", item.textColor || "#ffffff");
    element.style.setProperty("--background", item.backgroundColor || "#0b1522");
    element.style.setProperty("--background-opacity", String(item.backgroundOpacity ?? .72));
    element.style.setProperty("--shadow", `${item.shadow || 0}px`);
    element.style.setProperty("--accent", item.accentColor || "#4fd8ff");
    element.style.setProperty("--font", item.fontFamily || "Inter, Segoe UI, Arial, sans-serif");
    element.style.setProperty("--font-size", `${item.fontSize || 28}px`);
    element.style.setProperty("--weight", String(item.fontWeight || 800));
    element.style.setProperty("--align", item.alignment || "center");
  }

  function text(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(value ?? "");
    return element;
  }

  function createShell(item) {
    const element = document.createElement("section");
    element.className = "overlay-element";
    element.dataset.id = item.id;
    element.dataset.type = item.type;
    css(element, item);
    if (!["logo", "image"].includes(item.type) && item.title) element.append(text("div", "overlay-title", item.title));
    return element;
  }

  function renderFeed(element, rows) {
    const feed = document.createElement("div");
    feed.className = "feed";
    for (const row of rows.slice(-12)) {
      const entry = document.createElement("div");
      entry.className = "feed-row";
      const name = text("strong", "", row.name || row.platform || "Live");
      entry.append(name, document.createTextNode(` ${row.text || ""}`));
      feed.append(entry);
    }
    element.append(feed);
  }

  function renderElement(item) {
    const element = createShell(item);
    if (!item.visible) element.hidden = true;
    switch (item.type) {
      case "logo":
      case "image": {
        const image = document.createElement("img");
        image.src = item.source || "/assets/team-logo";
        image.alt = item.title || "";
        image.referrerPolicy = "no-referrer";
        element.append(image);
        break;
      }
      case "text": element.append(text("div", "overlay-value", item.text)); break;
      case "goal": {
        const current = Number(item.value || state.goal || 0);
        const target = Math.max(1, Number(item.target || 1000));
        const wrap = document.createElement("div");
        wrap.className = "goal-wrap";
        wrap.append(text("div", "goal-value", `${current.toLocaleString("de-DE")} / ${target.toLocaleString("de-DE")}`));
        const track = document.createElement("div");
        track.className = "goal-track";
        const bar = document.createElement("span");
        bar.style.setProperty("--progress", `${Math.min(100, current / target * 100)}%`);
        track.append(bar);
        wrap.append(track);
        element.append(wrap);
        break;
      }
      case "timer": {
        const value = text("div", "overlay-value", "00:00:00");
        element.append(value);
        const started = Number(item.settings?.startedAt) || Date.now();
        const update = () => {
          const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
          const hours = Math.floor(seconds / 3600);
          const minutes = Math.floor((seconds % 3600) / 60);
          value.textContent = [hours, minutes, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
        };
        update();
        timers.set(item.id, setInterval(update, 1000));
        break;
      }
      case "chat": renderFeed(element, state.chat); break;
      case "giftFeed": renderFeed(element, state.gifts); break;
      case "giftAlarm": {
        const last = state.gifts.at(-1);
        const value = text("div", "overlay-value alarm", last ? `${last.name}: ${last.text}` : item.text || "Noch kein Geschenk");
        element.append(value);
        break;
      }
      case "topList": {
        const grouped = new Map();
        for (const gift of state.gifts) grouped.set(gift.name || "Zuschauer", (grouped.get(gift.name || "Zuschauer") || 0) + (gift.value || 1));
        const top = [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, item.maximumItems || 5);
        renderFeed(element, top.map(([name, value], index) => ({ name: `${index + 1}. ${name}`, text: String(value) })));
        break;
      }
      case "likeCounter": element.append(text("div", "overlay-value", state.likes.toLocaleString("de-DE"))); break;
      case "coHost": element.append(text("div", "overlay-value", state.coHost || item.text || "Kein Co-Host")); break;
      case "treasure": element.append(text("div", "overlay-value", item.text || "Schatztruhe bereit")); break;
      case "portal": element.append(text("div", "overlay-value", item.text || "Portal")); break;
      case "tiktokEvents": renderFeed(element, events.filter((event) => event.platform === "tiktok")); break;
      case "heartRate": {
        const heart = document.createElement("div");
        heart.className = "heart";
        heart.append(text("div", "pulse", "♥"), text("div", "bpm", state.heartRate ? `${state.heartRate} BPM` : "– BPM"));
        element.append(heart);
        break;
      }
      case "wheel": {
        const wheel = document.createElement("div");
        wheel.className = "wheel";
        if (item.settings?.spinning) wheel.classList.add("spinning");
        element.append(wheel);
        break;
      }
      case "poll": {
        const poll = document.createElement("div");
        poll.className = "poll";
        const values = Object.entries(state.poll);
        const total = Math.max(1, values.reduce((sum, [, value]) => sum + value, 0));
        for (const [label, value] of values.length ? values : [["Option A", 0], ["Option B", 0]]) {
          const row = document.createElement("div");
          row.className = "poll-option";
          row.append(text("span", "", label), text("span", "", `${Math.round(value / total * 100)}%`));
          const bar = document.createElement("div");
          bar.className = "poll-bar";
          const fill = document.createElement("span");
          fill.style.setProperty("--percent", `${value / total * 100}%`);
          bar.append(fill);
          row.append(bar);
          poll.append(row);
        }
        element.append(poll);
        break;
      }
      case "wordCloud": {
        const cloud = document.createElement("div");
        cloud.className = "word-cloud";
        const words = [...state.words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
        for (const [word, count] of words.length ? words : [["Batto", 3], ["OBS", 2], ["Live", 1]]) {
          const itemWord = text("span", "", word);
          itemWord.style.fontSize = `${Math.min(1.6, .65 + count / 10)}em`;
          cloud.append(itemWord);
        }
        element.append(cloud);
        break;
      }
      default: element.append(text("div", "overlay-value", item.text || item.title));
    }
    return element;
  }

  function render() {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
    stage.style.background = config.backgroundOpacity > 0
      ? `color-mix(in srgb, ${config.backgroundColor || "#000"} ${config.backgroundOpacity * 100}%, transparent)`
      : "transparent";
    stage.replaceChildren(...(config.elements || []).map(renderElement));
  }

  function ingest(event) {
    events.push(event);
    if (events.length > 200) events.splice(0, events.length - 200);
    const type = String(event.type || "").toLowerCase();
    if (type === "chat") {
      state.chat.push(event);
      state.chat = state.chat.slice(-30);
      for (const word of String(event.text || "").toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []) state.words.set(word, (state.words.get(word) || 0) + 1);
    }
    if (/gift|geschenk/.test(type)) { state.gifts.push(event); state.gifts = state.gifts.slice(-30); }
    if (type === "like" || type === "likes") state.likes = Number(event.value) || state.likes + 1;
    if (type === "goal") state.goal = Number(event.value) || 0;
    if (type === "heartrate" || type === "heart-rate" || type === "pulse") state.heartRate = Number(event.value) || 0;
    if (type === "cohost" || type === "co-host") state.coHost = event.name || event.text || "";
    if (type === "poll") {
      const option = event.text || event.data?.option || "Option";
      state.poll[option] = (state.poll[option] || 0) + (Number(event.value) || 1);
    }
    if (type === "wheel") {
      const wheel = config.elements.find((item) => item.type === "wheel");
      if (wheel) {
        wheel.settings ||= {};
        wheel.settings.spinning = true;
        setTimeout(() => { wheel.settings.spinning = false; render(); }, 3600);
      }
    }
    render();
  }

  function clear() {
    events.length = 0;
    state.chat = [];
    state.gifts = [];
    state.words.clear();
    state.poll = {};
    render();
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(`${protocol}//${location.host}/ws`);
    socket = current;
    current.addEventListener("open", () => { reconnectDelay = 1000; current.send(JSON.stringify({ type: "get-config" })); });
    current.addEventListener("message", (message) => {
      try {
        const packet = JSON.parse(message.data);
        if (packet.type === "config") { config = packet.config || config; render(); }
        if (packet.type === "event") ingest(packet.event || {});
        if (packet.type === "history") for (const event of packet.events || []) ingest(event);
        if (packet.type === "clear") clear();
        if (packet.type === "chat-clear") {
          const platform = String(packet.platform || "all");
          state.chat = platform === "all" ? [] : state.chat.filter((event) => event.platform !== platform);
          render();
        }
      } catch {}
    });
    current.addEventListener("close", () => {
      if (socket !== current) return;
      socket = null;
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(30000, reconnectDelay * 2);
    });
    current.addEventListener("error", () => current.close());
  }

  connect();
})();
