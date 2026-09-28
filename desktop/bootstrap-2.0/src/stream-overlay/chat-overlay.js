"use strict";

(() => {
  const root = document.getElementById("chat");
  const query = new URLSearchParams(location.search);
  const selectedPlatform = String(query.get("platform") || "all").toLowerCase();
  const maximum = Math.max(1, Math.min(50, Number(query.get("max")) || 12));
  const messages = [];
  const platformColors = { twitch: "#9146ff", cng: "#2f9cff", tiktok: "#69f6ef", youtube: "#ff3030", local: "#5aa7ff" };
  let reconnectDelay = 1000;

  function accepts(event) {
    return event?.type === "chat" && (selectedPlatform === "all" || event.platform === selectedPlatform);
  }

  function render() {
    root.replaceChildren(...messages.slice(-maximum).map((message) => {
      const row = document.createElement("article");
      row.className = "message";
      const color = /^#[0-9a-f]{6}$/i.test(message.data?.color || "") ? message.data.color : platformColors[message.platform] || platformColors.local;
      row.style.setProperty("--platform", platformColors[message.platform] || platformColors.local);
      row.style.setProperty("--user", color);
      const dot = document.createElement("span");
      dot.className = "platform";
      const line = document.createElement("div");
      line.className = "line";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = message.name || "Zuschauer";
      line.append(name);
      if (message.data?.role) {
        const role = document.createElement("span");
        role.className = "badge";
        role.textContent = message.data.role;
        line.append(role);
      }
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = `: ${message.text || ""}`;
      line.append(text);
      row.append(dot, line);
      return row;
    }));
  }

  function ingest(event) {
    if (!accepts(event)) return;
    messages.push(event);
    if (messages.length > maximum) messages.splice(0, messages.length - maximum);
    render();
  }

  function clear(platform = "all") {
    if (platform === "all" || platform === selectedPlatform || selectedPlatform === "all") {
      if (platform === "all") messages.length = 0;
      else for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].platform === platform) messages.splice(index, 1);
      render();
    }
  }

  function connect() {
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.addEventListener("open", () => { reconnectDelay = 1000; });
    socket.addEventListener("message", (message) => {
      try {
        const packet = JSON.parse(message.data);
        if (packet.type === "history") for (const event of packet.events || []) ingest(event);
        if (packet.type === "event") ingest(packet.event);
        if (packet.type === "clear") clear("all");
        if (packet.type === "chat-clear") clear(String(packet.platform || "all"));
      } catch {}
    });
    socket.addEventListener("close", () => {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(15000, reconnectDelay * 1.7);
    });
  }

  connect();
})();
