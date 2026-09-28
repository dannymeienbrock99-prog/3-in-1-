"use strict";
(() => {
  const PLATFORMS = ["tiktok", "twitch", "cng", "youtube"];
  const MOD_KEY = "batto-moderation-v1";
  let selectedPlatform = "tiktok";

  const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const cleanUser = (v) => String(v || "").trim().replace(/^@/, "").slice(0, 80);
  const emptyPlatform = () => ({ moderators:[], muted:[], blocked:[], audit:[] });

  function loadMod() {
    try {
      const value = JSON.parse(localStorage.getItem(MOD_KEY) || "{}");
      for (const p of PLATFORMS) if (!value[p]) value[p] = emptyPlatform();
      return value;
    } catch { return Object.fromEntries(PLATFORMS.map((p) => [p, emptyPlatform()])); }
  }

  let mod = loadMod();
  function saveMod() { localStorage.setItem(MOD_KEY, JSON.stringify(mod)); renderModeration(); }
  function entryIndex(list, user) { return list.findIndex((x) => cleanUser(x.username).toLowerCase() === cleanUser(user).toLowerCase()); }
  function addAudit(platform, username, action, reason, lastMessage, result = "Lokal") {
    const p = mod[platform] || (mod[platform] = emptyPlatform());
    p.audit.unshift({ time:new Date().toISOString(), username, action, reason:reason || "", lastMessage:lastMessage || "", by:"Crazy_Batto", result });
    p.audit = p.audit.slice(0, 500);
  }

  function applyModeration(platform, username, action, lastMessage) {
    platform = PLATFORMS.includes(platform) ? platform : "tiktok";
    username = cleanUser(username);
    if (!username) return;
    const p = mod[platform] || (mod[platform] = emptyPlatform());
    let reason = "";
    if (["mute", "block"].includes(action)) reason = prompt(action === "mute" ? "Grund für Stummschaltung" : "Grund für Blockierung", "") || "";
    if (action === "mod-add" && entryIndex(p.moderators, username) < 0) p.moderators.push({ username, since:Date.now() });
    if (action === "mod-remove") p.moderators = p.moderators.filter((x) => cleanUser(x.username).toLowerCase() !== username.toLowerCase());
    if (action === "mute" && entryIndex(p.muted, username) < 0) p.muted.push({ username, reason, lastMessage, since:Date.now() });
    if (action === "unmute") p.muted = p.muted.filter((x) => cleanUser(x.username).toLowerCase() !== username.toLowerCase());
    if (action === "block" && entryIndex(p.blocked, username) < 0) p.blocked.push({ username, reason, lastMessage, since:Date.now() });
    if (action === "unblock") p.blocked = p.blocked.filter((x) => cleanUser(x.username).toLowerCase() !== username.toLowerCase());
    const labels = {"mod-add":"Moderator hinzugefügt","mod-remove":"Moderator entfernt",mute:"Gestummt",unmute:"Entstummt",block:"Blockiert",unblock:"Entblockt"};
    addAudit(platform, username, labels[action] || action, reason, lastMessage, "Lokal");
    saveMod();
  }

  function openContext(event, userEl) {
    event.preventDefault();
    document.querySelector(".batto-context-menu")?.remove();
    const row = userEl.closest(".chat-row");
    const username = cleanUser(userEl.textContent);
    const platform = row?.dataset?.platform || PLATFORMS.find((p) => (row?.querySelector(".chat-role")?.textContent || "").toLowerCase().includes(p)) || "tiktok";
    const lastMessage = row?.querySelector(".chat-message")?.textContent || "";
    const menu = document.createElement("div");
    menu.className = "batto-context-menu";
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 320)}px`;
    menu.innerHTML = `<div class="context-user">${esc(username)} <small>${esc(platform.toUpperCase())}</small></div><button data-a="mod-add">Als Moderator hinzufügen</button><button data-a="mod-remove">Als Moderator entfernen</button><hr><button data-a="mute">Stummen</button><button data-a="block">Blockieren</button><button data-a="unmute">Entstummen</button><button data-a="unblock">Entblocken</button>`;
    menu.querySelectorAll("button").forEach((button) => button.onclick = () => { applyModeration(platform, username, button.dataset.a, lastMessage); menu.remove(); });
    document.body.appendChild(menu);
  }

  document.addEventListener("contextmenu", (event) => { const user = event.target.closest?.(".chat-user"); if (user) openContext(event, user); });
  document.addEventListener("click", (event) => { if (!event.target.closest?.(".batto-context-menu")) document.querySelector(".batto-context-menu")?.remove(); });

  function switchCustom(name, title, subtitle) {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.customView === name));
    const h = document.getElementById("page-title");
    const s = document.getElementById("page-subtitle");
    if (h) h.textContent = title;
    if (s) s.textContent = subtitle;
    if (name === "moderation") renderModeration();
    if (name === "cohost") renderCohost();
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-custom-view]");
    if (!button) return;
    const name = button.dataset.customView;
    if (name === "moderation") switchCustom(name, "Moderation", "TikTok, Twitch, CNG und YouTube getrennt verwalten.");
    if (name === "cohost") switchCustom(name, "Co-Host", "OBS-Browserlayouts für TikTok- und Twitch-Format.");
  });

  function renderModeration() {
    const host = document.getElementById("view-moderation");
    if (!host) return;
    const p = mod[selectedPlatform] || emptyPlatform();
    const list = (items, action, label) => items.length ? items.map((x) => `<div class="mod-list-row"><div><strong>${esc(x.username)}</strong>${x.reason ? `<small>${esc(x.reason)}</small>` : ""}${x.lastMessage ? `<small>Letzte Nachricht: ${esc(x.lastMessage)}</small>` : ""}</div><button class="td-button" data-mod-user="${esc(x.username)}" data-mod-action="${action}">${label}</button></div>`).join("") : '<p class="result-copy">Keine Einträge.</p>';
    host.innerHTML = `<div class="section-heading"><div><span class="eyebrow">GETRENNT NACH PLATTFORM</span><h2>Moderation</h2><p>Rechtsklick auf einen Namen im Multi-Chat öffnet die Moderationsaktionen.</p></div></div><div class="mod-dashboard"><div class="mod-platform-tabs">${PLATFORMS.map((x) => `<button class="td-button ${x === selectedPlatform ? "active" : ""}" data-mod-platform="${x}">${x === "cng" ? "CNG" : x[0].toUpperCase() + x.slice(1)}</button>`).join("")}</div><div class="mod-columns"><article class="panel mod-list"><h3>Moderatoren</h3>${list(p.moderators, "mod-remove", "Entfernen")}</article><article class="panel mod-list"><h3>Stummgeschaltet</h3>${list(p.muted, "unmute", "Entstummen")}</article><article class="panel mod-list"><h3>Blockiert</h3>${list(p.blocked, "unblock", "Entblocken")}</article></div><article class="panel mod-audit"><h3>Moderationsverlauf</h3><table><thead><tr><th>Zeit</th><th>Name</th><th>Aktion</th><th>Grund</th><th>Letzte Nachricht</th><th>Durch</th><th>Ergebnis</th></tr></thead><tbody>${p.audit.map((a) => `<tr><td>${new Date(a.time).toLocaleString("de-DE")}</td><td>${esc(a.username)}</td><td>${esc(a.action)}</td><td>${esc(a.reason)}</td><td>${esc(a.lastMessage)}</td><td>${esc(a.by)}</td><td>${esc(a.result)}</td></tr>`).join("") || '<tr><td colspan="7">Noch keine Aktionen.</td></tr>'}</tbody></table></article></div>`;
    host.querySelectorAll("[data-mod-platform]").forEach((button) => button.onclick = () => { selectedPlatform = button.dataset.modPlatform; renderModeration(); });
    host.querySelectorAll("[data-mod-action]").forEach((button) => button.onclick = () => applyModeration(selectedPlatform, button.dataset.modUser, button.dataset.modAction, ""));
  }

  // BATTO_COHOST_REAL_URLS
  function cohostSources() { return Array.from({ length:8 }, (_, i) => document.getElementById(`cohost-source-${i + 1}`)?.value?.trim?.() || ""); }

  async function cohostBaseUrl() {
    try {
      const status = await window.batto?.chatOverlayStatus?.();
      const chatUrl = String(status?.url || "");
      if (chatUrl) return chatUrl.replace(/\/chat-overlay.*$/i, "");
    } catch {}
    return "http://127.0.0.1:48621";
  }

  async function saveCohostRuntime(base, payload) {
    const response = await fetch(`${base}/api/cohost`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Co-Host-Server: HTTP ${response.status}`);
    return response.json();
  }

  function renderCohost() {
    const host = document.getElementById("view-cohost");
    if (!host) return;
    const saved = JSON.parse(localStorage.getItem("batto-cohost-v1") || "null") || { format:"tiktok", slots:4, sources:Array(8).fill("") };
    host.innerHTML = `<div class="section-heading"><div><span class="eyebrow">OBS-BROWSERQUELLE</span><h2>Co-Host</h2><p>Plätze frei einstellen und als TikTok-Hochformat oder Twitch-Querformat in OBS einbinden.</p></div></div><div class="cohost-layout"><article class="panel form-panel"><label>Format<select id="cohost-format"><option value="tiktok" ${saved.format === "tiktok" ? "selected" : ""}>TikTok · 1080 × 1920</option><option value="twitch" ${saved.format === "twitch" ? "selected" : ""}>Twitch · 1920 × 1080</option></select></label><label>Plätze<select id="cohost-slots">${[1,2,3,4,5,6,7,8].map((n) => `<option ${saved.slots === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><div class="cohost-sources">${Array.from({ length:8 }, (_, i) => `<label>Platz ${i + 1}<input id="cohost-source-${i + 1}" value="${esc(saved.sources?.[i] || "")}" placeholder="Quelle / Gast-URL"></label>`).join("")}</div><div class="button-row"><button class="primary" id="cohost-apply">Übernehmen</button></div><div class="url-bar"><span>TikTok OBS</span><code id="cohost-url-tiktok">Wird geladen …</code><button id="cohost-copy-tiktok">URL kopieren</button></div><div class="url-bar"><span>Twitch OBS</span><code id="cohost-url-twitch">Wird geladen …</code><button id="cohost-copy-twitch">URL kopieren</button></div><output id="cohost-status" class="inline-message"></output></article><article class="panel"><h3>Vorschau</h3><div id="cohost-preview"></div></article></div>`;

    let baseUrl = "http://127.0.0.1:48621";
    const update = () => {
      const format = document.getElementById("cohost-format").value;
      const slots = Number(document.getElementById("cohost-slots").value);
      const preview = document.getElementById("cohost-preview");
      const cols = slots <= 1 ? 1 : slots <= 4 ? 2 : 3;
      preview.className = `cohost-grid-preview ${format}`;
      preview.style.gridTemplateColumns = `repeat(${cols},1fr)`;
      preview.innerHTML = Array.from({ length:slots }, (_, i) => `<div class="cohost-slot">Gast ${i + 1}</div>`).join("");
      document.getElementById("cohost-url-tiktok").textContent = `${baseUrl}/cohost/tiktok`;
      document.getElementById("cohost-url-twitch").textContent = `${baseUrl}/cohost/twitch`;
    };

    const payload = () => ({ format:document.getElementById("cohost-format").value, slots:Number(document.getElementById("cohost-slots").value), sources:cohostSources() });
    const copy = async (id) => { try { await navigator.clipboard.writeText(document.getElementById(id).textContent); } catch {} };
    document.getElementById("cohost-format").onchange = update;
    document.getElementById("cohost-slots").onchange = update;
    host.querySelectorAll("[id^=cohost-source]").forEach((input) => input.oninput = update);
    document.getElementById("cohost-copy-tiktok").onclick = () => copy("cohost-url-tiktok");
    document.getElementById("cohost-copy-twitch").onclick = () => copy("cohost-url-twitch");
    document.getElementById("cohost-apply").onclick = async () => {
      const data = payload();
      localStorage.setItem("batto-cohost-v1", JSON.stringify(data));
      const status = document.getElementById("cohost-status");
      try {
        await saveCohostRuntime(baseUrl, data);
        status.textContent = "Co-Host gespeichert. Beide OBS-Adressen sind aktiv.";
      } catch (error) {
        status.textContent = `Co-Host konnte nicht an den lokalen Overlay-Server übergeben werden: ${error?.message || error}`;
      }
      update();
    };

    cohostBaseUrl().then((value) => { baseUrl = value; update(); }).catch(() => update());
    update();
  }

  renderModeration();
})();
