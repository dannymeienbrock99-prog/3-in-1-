(() => {
  'use strict';
  // Only presentation resources rest. Chat ingestion, OBS, alerts and broadcasts
  // continue in the main process, including while the window is minimized.
  const frames = new Map();
  let requested = false, override = false, savedAutoStart;
  const chatVisible = () => !document.hidden && (detached || S.view === 'dashboard');
  const enabled = () => override ? requested : S.config?.performance?.webWidgetsAutoStart === true;
  function applyFrame(frame, url) {
    const slot = frame.closest('.chat-extra-slot');
    const active = frame.isConnected && chatVisible() && enabled() && (!slot || slot.style.visibility === 'visible');
    if (active) {
      if (frame.getAttribute('src') !== url) frame.src = url;
    } else if (frame.hasAttribute('src')) {
      // Navigating to the empty document releases the embedded site's page,
      // network connections and animations; its saved URL stays private here.
      frame.removeAttribute('src');
    }
  }
  function refresh() {
    for (const [frame, url] of frames) {
      if (!frame.isConnected) frames.delete(frame);
      else applyFrame(frame, url);
    }
    const host = document.querySelector('.chat-head-actions');
    let button = document.getElementById('resourceWidgets');
    if (host && !button) {
      button = document.createElement('button');
      button.id = 'resourceWidgets'; button.type = 'button';
      button.onclick = () => { requested = !enabled(); override = true; refresh(); };
      host.prepend(button);
    }
    if (button) {
      button.textContent = enabled() ? 'Widgets stoppen' : 'Widgets starten';
      button.title = 'Sparmodus: Externe Web-Widgets nur bei Bedarf laden. Chat, Bot und Auto-Broadcast laufen weiter.';
      button.setAttribute('aria-pressed', String(enabled()));
    }
    document.querySelectorAll('[data-resource-note]').forEach(el => { el.hidden = enabled(); });
  }
  window.BattoResources = {
    chatVisible,
    setFrameSource(frame, url) {
      frames.set(frame, url); applyFrame(frame, url);
    },
    refresh,
    activate() { requested = true; override = true; refresh(); }
  };
  // Register source policy before any widget script, but wrap renderer functions
  // only after every presentation module has installed its own extensions.
  document.addEventListener('DOMContentLoaded', () => {
  // Defer chat DOM work while preserving every incoming message in S.messages.
  for (const name of ['renderChat', 'renderModeration', 'renderHistory', 'renderConnections']) {
    const original = window[name];
    window[name] = function (...args) { if (chatVisible()) return original.apply(this, args); };
  }
  function onView() {
    refresh();
    if (chatVisible() && S.config) {
      renderChat(); renderModeration(); renderHistory(); renderConnections();
      window.BattoBattlebar?.apply();
    }
  }
  document.addEventListener('batto:view', onView);
  document.addEventListener('visibilitychange', onView);
  savedAutoStart = S.config?.performance?.webWidgetsAutoStart === true;
  api.onConfigChanged?.(() => queueMicrotask(() => {
    const next = S.config?.performance?.webWidgetsAutoStart === true;
    if (next !== savedAutoStart) override = false;
    savedAutoStart = next; refresh();
  }));
  const settings = renderSettingsModule;
  renderSettingsModule = function (...args) {
    const result = settings.apply(this, args);
    const section = document.createElement('section'); section.className = 'panel-section';
    section.innerHTML = '<h3>Leistung sparen</h3><p>Web-Widgets wie Schnee und Geschenk-Webseiten brauchen zusätzliche Browserprozesse. Im Sparmodus startest du sie bei Bedarf im Multi-Chat. Unsichtbare Widgets werden immer entladen. Bot, Auto-Broadcast, OBS und Messwerte laufen weiter.</p><label class="check"><input id="resourceAutoStart" type="checkbox">Web-Widgets automatisch starten (höherer Verbrauch)</label><button id="resourceSave" class="primary">Leistungseinstellung speichern</button>';
    document.getElementById('settingsModule').append(section);
    section.querySelector('input').checked = S.config?.performance?.webWidgetsAutoStart === true;
    section.querySelector('button').onclick = async () => {
      try { await saveAndSync({ performance: { webWidgetsAutoStart: section.querySelector('input').checked } }, 'Leistungseinstellung gespeichert.'); }
      catch (error) { toast(error.message, true); }
    };
    return result;
  };
  refresh();
  }, { once:true });
})();
