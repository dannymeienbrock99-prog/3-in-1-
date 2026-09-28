"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const toast = (message) => {
    const node = $("toast");
    if (!node) return;
    node.textContent = String(message || "");
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 3200);
  };

  function activate(viewName) {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName || button.dataset.customView === viewName));
    const labels = { "stream-overlay": "Stream-Overlay", plugins: "Plugins", mobile: "Handy verbinden" };
    if ($("page-title") && labels[viewName]) $("page-title").textContent = labels[viewName];
  }

  document.querySelectorAll("[data-restored-view]").forEach((button) => button.addEventListener("click", () => activate(button.dataset.restoredView)));

  async function loadOverlay() {
    const host = $("stream-overlay-status");
    if (!host) return;
    try {
      const status = await window.batto.chatOverlayStatus();
      const active = Boolean(status.active);
      host.innerHTML = `<div class="restored-grid">
        <article class="restored-card"><h3>Lokaler Overlay-Server</h3><strong class="restored-status ${active ? "ok" : "warn"}">${active ? "Läuft" : "Nicht gestartet"}</strong><small>Chat, Gifts und Live-Ereignisse für OBS.</small></article>
        <article class="restored-card"><h3>OBS-Browserquelle</h3><div class="tool-url"><code>${escapeHtml(status.url || "Noch keine URL")}</code></div></article>
        <article class="restored-card"><h3>OBS</h3><strong class="restored-status ${status.obs?.connected ? "ok" : "offline"}">${status.obs?.connected ? "Verbunden" : "Getrennt"}</strong><small>Browserquelle kann automatisch in OBS angelegt werden.</small></article>
      </div>`;
      $("stream-overlay-url").textContent = status.url || "Overlay-Server wird gestartet …";
    } catch (error) {
      host.innerHTML = `<div class="empty-state">Overlay-Status konnte nicht geladen werden: ${escapeHtml(error?.message || error)}</div>`;
    }
  }

  $("stream-overlay-copy")?.addEventListener("click", async () => { try { const url = await window.batto.chatOverlayCopyUrl(); toast(`Kopiert: ${url}`); } catch (e) { toast(e?.message || e); } });
  $("stream-overlay-open")?.addEventListener("click", async () => { try { await window.batto.chatOverlayOpen(); } catch (e) { toast(e?.message || e); } });
  $("stream-overlay-install")?.addEventListener("click", async () => {
    try {
      const sourceName = $("stream-overlay-source")?.value || "Batto Multi-Chat";
      const sceneName = $("stream-overlay-scene")?.value || "";
      await window.batto.chatOverlayInstall({ sourceName, sceneName, width: 1920, height: 1080, autoInstall: true });
      toast("OBS-Browserquelle eingerichtet.");
      await loadOverlay();
    } catch (e) { toast(e?.message || e); }
  });
  $("stream-overlay-remove")?.addEventListener("click", async () => { try { await window.batto.chatOverlayRemove(); toast("OBS-Browserquelle entfernt."); await loadOverlay(); } catch (e) { toast(e?.message || e); } });

  function renderPlugins(snapshot = {}) {
    const root = $("plugin-list-restored");
    if (!root) return;
    const plugins = Array.isArray(snapshot.plugins) ? snapshot.plugins : [];
    const native = plugins.filter((plugin) => plugin.native).length;
    const external = plugins.length - native;
    // BATTO_PLUGIN_TRUTHFUL_STATUS
    $("plugin-summary-restored").innerHTML = `<article class="restored-card"><h3>Plugins</h3><strong>${plugins.length}</strong><small>${native} Batto-nativ · ${external} extern erkannt</small></article><article class="restored-card"><h3>Icon-Packs</h3><strong>${Array.isArray(snapshot.iconPacks) ? snapshot.iconPacks.length : 0}</strong><small>Creator Hub / Elgato / Batto</small></article><article class="restored-card"><h3>Touch-Deck 02.08.2026</h3><button id="plugin-open-touchdeck" class="primary">Touch-Deck öffnen</button><small>Plugins werden dort per Rechtsklick → „Plugin laden…“ einer Taste zugeordnet.</small></article>`;
    $("plugin-open-touchdeck")?.addEventListener("click", async () => { try { await window.batto.invoke("deck:open-original-0802"); } catch (e) { toast(e?.message || e); } });
    if (!plugins.length) { root.innerHTML = `<div class="empty-state">Keine Plugins gefunden.</div>`; return; }
    root.innerHTML = plugins.map((plugin) => {
      const actions = Array.isArray(plugin.actions) ? plugin.actions : [];
      const runtimeReady = plugin.native === true;
      const state = runtimeReady ? `<label><input class="plugin-toggle" type="checkbox" ${plugin.enabled !== false ? "checked" : ""}> aktiv</label>` : `<strong class="restored-status warn">nur erkannt</strong>`;
      const actionLabel = runtimeReady ? `${actions.length} ausführbare Aktionen` : `${actions.length} Manifest-Aktionen · Laufzeit nicht bestätigt`;
      return `<article class="plugin-entry" data-plugin-id="${escapeHtml(plugin.id)}"><div><strong>${escapeHtml(plugin.name || plugin.id)}</strong><small>${escapeHtml(plugin.description || plugin.status || "")}</small><div class="plugin-badges"><span>${runtimeReady ? "Batto nativ" : "Externes Manifest"}</span><span>${actionLabel}</span>${plugin.version ? `<span>v${escapeHtml(plugin.version)}</span>` : ""}</div></div>${state}</article>`;
    }).join("");
    root.querySelectorAll(".plugin-toggle").forEach((toggle) => toggle.addEventListener("change", async () => {
      const id = toggle.closest("[data-plugin-id]")?.dataset.pluginId;
      try { renderPlugins(await window.batto.enablePlugin(id, toggle.checked)); } catch (e) { toggle.checked = !toggle.checked; toast(e?.message || e); }
    }));
  }

  async function scanPlugins() {
    const root = $("plugin-list-restored");
    if (root) root.innerHTML = `<div class="empty-state">Plugins werden gesucht …</div>`;
    try { renderPlugins(await window.batto.scanPlugins()); } catch (e) { if (root) root.innerHTML = `<div class="empty-state">Plugin-Scan fehlgeschlagen: ${escapeHtml(e?.message || e)}</div>`; }
  }
  $("plugins-rescan")?.addEventListener("click", scanPlugins);

  function clientRows(items, kind) {
    if (!Array.isArray(items) || !items.length) return `<div class="empty-state">Keine ${kind === "pending" ? "offenen Anfragen" : "verbundenen Geräte"}.</div>`;
    return items.map((client) => `<div class="client-row"><div><strong>${escapeHtml(client.name || "Handy")}</strong><small>${escapeHtml(client.address || "")}</small></div><div class="restored-actions">${kind === "pending" ? `<button data-mobile-approve="${escapeHtml(client.id)}">Zulassen</button><button data-mobile-reject="${escapeHtml(client.id)}">Ablehnen</button>` : `<button data-mobile-disconnect="${escapeHtml(client.id)}">Trennen</button>`}</div></div>`).join("");
  }

  async function loadMobile() {
    try {
      const status = await window.batto.mobileStatus();
      $("mobile-runtime-status").textContent = status.running ? "Läuft lokal" : "Nicht gestartet";
      $("mobile-runtime-status").className = `restored-status ${status.running ? "ok" : "warn"}`;
      $("mobile-pin-restored").textContent = status.pin || "------";
      const pairing = status.pairing || {};
      const qr = pairing.battoQr || pairing.legacyQr || "";
      if (qr) { $("mobile-qr-restored").src = qr; $("mobile-qr-restored").hidden = false; } else $("mobile-qr-restored").hidden = true;
      $("mobile-url-restored").textContent = pairing.browserUrl || "Noch keine Kopplungsadresse";
      $("mobile-addresses-restored").innerHTML = (status.addresses || []).map((entry) => `<code>${escapeHtml(entry.url || entry.address || entry)}</code>`).join("") || `<span>Keine lokale Adresse.</span>`;
      $("mobile-pending-restored").innerHTML = clientRows(status.pendingClients, "pending");
      $("mobile-connected-restored").innerHTML = clientRows(status.connectedClients, "connected");
      $("mobile-approval-restored").checked = status.requireApproval !== false;
      document.querySelectorAll("[data-mobile-approve]").forEach((button) => button.onclick = async () => { await window.batto.mobileApprove(button.dataset.mobileApprove); await loadMobile(); });
      document.querySelectorAll("[data-mobile-reject]").forEach((button) => button.onclick = async () => { await window.batto.mobileReject(button.dataset.mobileReject); await loadMobile(); });
      document.querySelectorAll("[data-mobile-disconnect]").forEach((button) => button.onclick = async () => { await window.batto.mobileDisconnect(button.dataset.mobileDisconnect); await loadMobile(); });
    } catch (e) { $("mobile-runtime-status").textContent = `Fehler: ${e?.message || e}`; $("mobile-runtime-status").className = "restored-status offline"; }
  }
  $("mobile-start-restored")?.addEventListener("click", async () => { try { await window.batto.mobileStart(); await loadMobile(); } catch (e) { toast(e?.message || e); } });
  $("mobile-pin-new-restored")?.addEventListener("click", async () => { try { await window.batto.mobileRegeneratePin(); await loadMobile(); } catch (e) { toast(e?.message || e); } });
  $("mobile-approval-restored")?.addEventListener("change", async (event) => { try { await window.batto.mobileSetApproval(event.target.checked); await loadMobile(); } catch (e) { toast(e?.message || e); } });

  loadOverlay();
  scanPlugins();
  loadMobile();
  setInterval(() => { if ($("view-mobile")?.classList.contains("active")) loadMobile(); }, 2500).unref?.();
})();
