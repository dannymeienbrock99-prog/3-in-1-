(() => {
  'use strict';

  const api = window.batto;
  const mounts = new WeakMap();
  const active = new Set();
  let nextId = 0;
  let current = null;
  let revision = 0;
  let devices = [];
  let devicesError = '';
  let deviceRequest = null;
  let initialRequest = null;
  let devicesLoaded = false;

  function normalized(config) {
    const value = config?.audioOutput || {};
    const volume = Number(value.volume ?? 1);
    return {
      mode: value.mode === 'obs' ? 'obs' : 'app',
      deviceId: String(value.deviceId || 'default'),
      deviceLabel: String(value.deviceLabel || 'Systemstandard'),
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1
    };
  }

  function eachMount(callback) {
    for (const item of active) {
      if (!item.element.isConnected) active.delete(item);
      else callback(item);
    }
  }

  function update(config) {
    if (!config) return;
    revision += 1;
    const next = normalized(config);
    const changed = JSON.stringify(current) !== JSON.stringify(next);
    current = next;
    if (changed) eachMount(item => item.populate(next));
  }

  async function initialize() {
    if (current) return;
    if (!initialRequest) {
      const started = revision;
      initialRequest = Promise.resolve().then(() => api.getState()).then(state => {
        if (started === revision) update(state.config);
      }).catch(error => {
        eachMount(item => item.status(error.message || 'Tonausgabe konnte nicht geladen werden.', true));
      }).finally(() => { initialRequest = null; });
    }
    await initialRequest;
  }

  async function refreshDevices() {
    if (deviceRequest) return deviceRequest;
    if (!devicesLoaded) navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (!document.hidden) void refreshDevices(); });
    devicesLoaded = true;
    deviceRequest = (async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Geräteliste nicht verfügbar.');
        const available = await navigator.mediaDevices.enumerateDevices();
        const unique = new Map();
        for (const device of available.filter(item => item.kind === 'audiooutput')) {
          if (device.deviceId && device.deviceId !== 'default') {
            unique.set(device.deviceId, {
              id: device.deviceId,
              label: device.label || `Ausgabegerät ${unique.size + 1}`
            });
          }
        }
        devices = [...unique.values()];
        devicesError = '';
      } catch {
        devicesError = 'Geräte konnten nicht geladen werden. Du kannst die Liste erneut laden oder Systemstandard wählen.';
      }
      eachMount(item => item.populateDevices());
    })().finally(() => { deviceRequest = null; });
    return deviceRequest;
  }

  function mount(container, options = {}) {
    if (!container) return null;
    const previous = mounts.get(container);
    if (previous && container.contains(previous.element)) {
      active.add(previous);
      return previous.element;
    }
    const id = `batto-audio-output-${++nextId}`;
    const element = document.createElement('section');
    element.className = `audio-output-settings panel-section${options.compact ? ' audio-output-compact' : ''}`;
    element.dataset.audioOutputSettings = '';
    element.setAttribute('aria-labelledby', `${id}-heading`);
    element.innerHTML = `
      <h3 id="${id}-heading">Tonausgabe</h3>
      <p class="audio-output-intro">Für Sounds und Videos aus Events, Aktionen und Auto-Broadcast.</p>
      <div class="audio-output-fields">
        <label for="${id}-mode">Ton abspielen
          <select id="${id}-mode" data-audio-mode>
            <option value="app">Über Batto abspielen</option>
            <option value="obs">Über OBS abspielen</option>
          </select>
        </label>
        <label for="${id}-device">Ausgabegerät
          <select id="${id}-device" data-audio-device><option value="default">Systemstandard</option></select>
        </label>
      </div>
      <div class="audio-output-volume">
        <label for="${id}-volume">Lautstärke <output id="${id}-level" for="${id}-volume">100 %</output></label>
        <input id="${id}-volume" data-audio-volume type="range" min="0" max="100" step="1" value="100" aria-describedby="${id}-level">
      </div>
      <p class="audio-output-hint" data-audio-hint></p>
      <div class="audio-output-buttons">
        <button type="button" data-audio-refresh>Geräte neu laden</button>
        <button type="button" data-audio-test>Testton</button>
        <button type="button" class="primary" data-audio-save>Speichern</button>
      </div>
      <p class="audio-output-status" data-audio-status role="status" aria-live="polite"></p>`;
    container.append(element);
    const mode = element.querySelector('[data-audio-mode]');
    const device = element.querySelector('[data-audio-device]');
    const volume = element.querySelector('[data-audio-volume]');
    const level = element.querySelector('output');
    const hint = element.querySelector('[data-audio-hint]');
    const refresh = element.querySelector('[data-audio-refresh]');
    const test = element.querySelector('[data-audio-test]');
    const save = element.querySelector('[data-audio-save]');
    const result = element.querySelector('[data-audio-status]');
    let selectedLabel = 'Systemstandard';
    let busy = false;

    function status(text, error = false) {
      result.textContent = text || '';
      result.classList.toggle('error', error);
    }

    function controls() {
      const obs = mode.value === 'obs';
      const locked = busy || !current;
      mode.disabled = locked;
      volume.disabled = locked;
      device.disabled = locked || obs;
      refresh.disabled = locked || obs;
      test.disabled = locked || obs;
      save.disabled = locked;
      level.value = `${volume.value} %`;
      volume.setAttribute('aria-valuetext', `${volume.value} Prozent`);
      const missing = devicesLoaded && device.value !== 'default' && !devices.some(item => item.id === device.value);
      hint.textContent = obs
        ? 'Das Ausgabegerät und das Mithören stellst du in OBS ein. Die Lautstärke gilt auch dort.'
        : devicesError || (missing
          ? 'Dieses Gerät ist nicht verbunden. Verbinde es erneut oder wähle ein anderes Gerät. Ein Wechsel zum Systemstandard wird beim Abspielen angezeigt.'
          : Number(volume.value) === 0
            ? 'Der Ton ist stummgeschaltet. Erhöhe die Lautstärke, um den Testton zu hören.'
            : 'Der Testton verwendet die Auswahl hier. Mit Speichern gilt sie für deine Sounds.');
      hint.classList.toggle('warning', !obs && Boolean(devicesError || missing));
    }

    function populateDevices() {
      const wanted = device.value || 'default';
      device.replaceChildren(new Option('Systemstandard', 'default'));
      for (const item of devices) device.add(new Option(item.label, item.id));
      if (wanted !== 'default' && !devices.some(item => item.id === wanted)) {
        device.add(new Option(devicesLoaded ? `${selectedLabel} (nicht verbunden)` : selectedLabel, wanted));
      }
      device.value = wanted;
      controls();
    }

    function populate(value) {
      mode.value = value.mode;
      volume.value = Math.round(value.volume * 100);
      selectedLabel = value.deviceLabel;
      if (![...device.options].some(option => option.value === value.deviceId)) {
        device.add(new Option(value.deviceLabel, value.deviceId));
      }
      device.value = value.deviceId;
      populateDevices();
    }

    function selection() {
      const deviceId = device.value || 'default';
      return {
        mode: mode.value === 'obs' ? 'obs' : 'app',
        deviceId,
        deviceLabel: deviceId === 'default' ? 'Systemstandard' : devices.find(item => item.id === deviceId)?.label || selectedLabel,
        volume: Number(volume.value) / 100
      };
    }

    async function run(action) {
      busy = true;
      controls();
      status('');
      try { await action(); }
      catch (error) { status(error.message || 'Die Tonausgabe konnte nicht geändert werden.', true); }
      finally { busy = false; controls(); }
    }

    mode.onchange = () => { status('Noch nicht gespeichert.'); controls(); };
    device.onchange = () => {
      selectedLabel = devices.find(item => item.id === device.value)?.label || selectedLabel;
      status('Noch nicht gespeichert.');
      controls();
    };
    device.addEventListener('focus', () => { if (!devicesLoaded) void refreshDevices(); });
    volume.oninput = () => { status('Noch nicht gespeichert.'); controls(); };
    refresh.onclick = () => run(refreshDevices);
    test.onclick = () => run(async () => {
      if (!api.testAudioOutput) throw new Error('Bitte Batto neu starten, damit der Testton verfügbar ist.');
      const value = selection();
      const response = await api.testAudioOutput({ deviceId: value.deviceId, volume: value.volume, mode: 'app' });
      if (!response?.ok) throw new Error(response?.error || 'Der Testton konnte nicht abgespielt werden.');
      status(response.warning || response.message || 'Testton abgespielt.', Boolean(response.warning));
    });
    save.onclick = () => run(async () => {
      const config = await api.saveConfig({ audioOutput: selection() });
      if (config?.ok === false) throw new Error(config.error || 'Speichern fehlgeschlagen.');
      update(config);
      eachMount(item => item.status('Tonausgabe gespeichert.'));
    });

    const item = { element, populate, populateDevices, status };
    mounts.set(container, item);
    active.add(item);
    populate(current || normalized({}));
    initialize();
    return element;
  }

  api.onConfigChanged?.(update);
  window.BattoAudioOutputUI = Object.freeze({ mount });
})();
