(() => {
  'use strict';
  const root = document.getElementById('touch-deck-root');
  if (!root) return;
  const $ = id => document.getElementById('td-' + id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => crypto.randomUUID();
  const symbols = ['◆', '▶', '⏸', '■', '🎙', '🔊', '🔇', '📷', '💡', '🌡', '🌀', '📁', '↗', '★'];
  let state, draft, catalog = {actions:[]}, path = [], selected = -1;
  let dirty = false, editing = false, busy = false, loading = false, initialized = false;
  let sensorTimer, pollBusy = false, catalogBusy = false, dragIndex = -1, confirmCallback, pendingFocus;
  const active = () => !document.hidden && !window.BattoResources?.suspended && document.getElementById('view-touchdeck')?.classList.contains('active');
  const call = (command, value) => window.batto.touch(command, value);
  const configOf = value => ({version:1, activeProfile:value.activeProfile, profiles:clone(value.profiles)});
  const profile = () => draft?.profiles.find(item => item.id === draft.activeProfile) || draft?.profiles[0];
  const page = () => { let items = profile()?.buttons || []; for (const index of path) { if (items[index]?.type !== 'folder') return []; items = items[index].buttons; } return items; };
  const current = () => page()[selected];
  const option = (id, name, value) => `<option value="${esc(id)}"${String(id) === String(value) ? ' selected' : ''}>${esc(name)}</option>`;
  function message(text, error = false) { if (!$('message')) return; $('message').textContent = text; $('message').classList.toggle('td-error', error); }
  function cleanError(error) { return String(error?.message || error).replace(/^Error invoking remote method [^:]+: Error: /, ''); }
  function run(fn) {
    return async event => {
      event?.preventDefault();
      if (busy) return;
      busy = true;
      root.setAttribute('aria-busy', 'true');
      const locked = [...root.querySelectorAll('button, input, select')].map(el => [el, el.disabled]);
      locked.forEach(([el]) => { el.disabled = true; });
      try { await fn(event); }
      catch (error) { message(cleanError(error), true); }
      finally {
        busy = false;
        root.removeAttribute('aria-busy');
        locked.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; });
        if (pendingFocus) { $(pendingFocus)?.focus(); pendingFocus = null; }
        status(); scheduleSensors();
      }
    };
  }
  const on = (id, fn) => $(id)?.addEventListener('click', run(fn));
  function changed() { dirty = true; status(); }
  function status() {
    if (!initialized) return;
    $('save').disabled = busy || !dirty;
    $('discard').disabled = busy || !dirty;
    $('dirty').textContent = dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert';
    $('dirty').classList.toggle('td-unsaved', dirty);
    $('mode').textContent = editing ? 'Zur Bedienung' : 'Tasten bearbeiten';
    $('mode').setAttribute('aria-pressed', String(editing));
    $('mode-note').textContent = editing ? 'Bearbeiten: Taste wählen oder an eine andere Position ziehen. Dabei werden keine Aktionen ausgelöst.' : dirty ? 'Bitte zuerst speichern oder Änderungen verwerfen. Danach sind die Tasten wieder bedienbar.' : 'Bedienen: Eine Taste auslösen oder einen Ordner öffnen.';
    root.classList.toggle('td-editing', editing);
  }
  function ask(text, callback) {
    confirmCallback = callback;
    $('confirm-text').textContent = text;
    $('confirm').hidden = false;
    pendingFocus = 'confirm-no';
  }
  function closeConfirm() { $('confirm').hidden = true; confirmCallback = null; }
  function build() {
    root.innerHTML = `<div class="td-heading"><div><h2>Batto Touch Deck</h2><p>Deine Tasten für Jarvis, Szenen, Bot und PC-Messwerte.</p></div><button id="td-mode" aria-pressed="false">Tasten bearbeiten</button></div>
      <div class="td-toolbar"><button id="td-save" class="primary">Änderungen speichern</button><button id="td-discard">Verwerfen</button><span id="td-dirty" class="td-help"></span><div class="td-spacer"></div><button id="td-import">Importieren</button><button id="td-export">Exportieren</button></div>
      <div id="td-message" class="td-message" role="status" aria-live="polite"></div>
      <div id="td-confirm" class="td-confirm" hidden><span id="td-confirm-text"></span><div class="td-toolbar"><button id="td-confirm-yes">Bestätigen</button><button id="td-confirm-no" class="primary">Abbrechen</button></div></div>
      <article class="td-panel"><div class="td-profilebar"><label>Profil<select id="td-profile" aria-label="Touch-Deck-Profil"></select></label><label class="td-edit-only">Name<input id="td-profile-name" maxlength="60"></label><button id="td-profile-add" class="td-edit-only">Neues Profil</button><button id="td-profile-delete" class="td-edit-only td-danger">Profil löschen</button><label class="td-edit-only">Raster<select id="td-grid-size"><option value="3x2">3 × 2 · große Tasten</option><option value="5x3">5 × 3 · Standard</option><option value="8x4">8 × 4 · viele Tasten</option></select></label></div>
      <div class="td-workspace"><div class="td-deck-area"><nav id="td-breadcrumb" class="td-breadcrumb" aria-label="Touch-Deck-Ordner"></nav><p id="td-mode-note" class="td-help"></p><div id="td-grid" class="td-grid" aria-label="Touch-Deck-Tasten"></div></div><aside id="td-editor" class="td-editor td-edit-only" aria-label="Taste bearbeiten"></aside></div></article>
      <details class="td-panel td-mobile-panel"><summary>Handy &amp; Tablet verbinden <span id="td-mobile-summary" class="td-help"></span></summary><p class="td-help">Im selben privaten WLAN die Adresse im Browser öffnen und mit der PIN verbinden. Nur wenn du die Verbindung einschaltest, läuft der kleine Handy-Dienst. Deine Tasten funktionieren dann auch im Gaming-Modus.</p><div id="td-mobile"></div></details>
      <p class="td-footnote">Das Touch Deck nutzt die vorhandenen Batto-Aktionen. PC-Werte werden nur bei sichtbaren Messwert-Tasten aktualisiert.</p>`;
    on('save', save);
    on('discard', () => ask('Alle ungespeicherten Änderungen am Touch Deck verwerfen?', () => { adopt(state, true); message('Änderungen verworfen.'); }));
    on('mode', async () => { if (!editing) await refreshCatalog(); editing = !editing; selected = -1; render(); });
    on('confirm-yes', async () => { const next = confirmCallback; closeConfirm(); await next?.(); });
    on('confirm-no', closeConfirm);
    on('profile-add', () => {
      if (draft.profiles.length >= 20) throw Error('Es sind höchstens 20 Profile möglich.');
      let name = 'Neues Profil', suffix = 2;
      while (draft.profiles.some(p => p.name === name)) name = 'Neues Profil ' + suffix++;
      const p = {id:uid(),name,columns:5,rows:3,buttons:Array(15).fill(null)};
      draft.profiles.push(p); draft.activeProfile = p.id; path = []; selected = -1; changed(); render(); pendingFocus = 'profile-name';
    });
    on('profile-delete', () => {
      if (draft.profiles.length <= 1) throw Error('Mindestens ein Profil muss bleiben.');
      const item = profile();
      ask(`Profil „${item.name}“ mit seinen Tasten und Ordnern löschen?`, () => { draft.profiles = draft.profiles.filter(p => p.id !== item.id); draft.activeProfile = draft.profiles[0].id; path = []; selected = -1; changed(); render(); });
    });
    $('profile').onchange = run(async () => { const wasDirty = dirty; draft.activeProfile = $('profile').value; path = []; selected = -1; closeConfirm(); changed(); render(); if (!wasDirty) { await save(); message(`Profil „${profile().name}“ ausgewählt.`); } });
    $('profile-name').oninput = () => { profile().name = $('profile-name').value; changed(); const selectedOption = $('profile').selectedOptions[0]; if (selectedOption) selectedOption.textContent = profile().name || 'Unbenannt'; renderBreadcrumb(); };
    $('grid-size').onchange = () => {
      const p = profile(), [columns, rows] = $('grid-size').value.split('x').map(Number), size = columns * rows;
      const overflow = list => list.slice(size).some(Boolean) || list.some(item => item?.type === 'folder' && overflow(item.buttons || []));
      if (overflow(p.buttons)) { $('grid-size').value = `${p.columns}x${p.rows}`; message('Das kleinere Raster würde belegte Tasten abschneiden. Verschiebe oder lösche diese Tasten zuerst, auch in Ordnern.', true); return; }
      const resize = list => Array.from({length:size}, (_, index) => { const item = list[index] || null; if (item?.type === 'folder') item.buttons = resize(item.buttons || []); return item; });
      p.columns = columns; p.rows = rows; p.buttons = resize(p.buttons); selected = -1; changed(); render();
    };
    on('import', async () => {
      if (dirty) throw Error('Bitte Änderungen vor dem Import speichern oder verwerfen.');
      const next = await call('import');
      if (next && !next.canceled) { adopt(next, true); message('Touch-Deck-Projekt importiert. Prüfe die Tastenbelegungen vor dem Bedienen.'); }
    });
    on('export', async () => { if (dirty) throw Error('Bitte Änderungen vor dem Export speichern.'); const result = await call('export'); if (result?.ok || result?.saved) message('Touch-Deck-Projekt exportiert.'); });
    const grid = $('grid');
    grid.addEventListener('click', run(async event => {
      const tile = event.target.closest('[data-td-key]');
      if (!tile) return;
      const index = Number(tile.dataset.tdKey), item = page()[index];
      closeConfirm();
      if (editing) { selected = index; renderGrid(); renderEditor(); return; }
      if (item?.type === 'folder') { path.push(index); selected = -1; renderDeck(); return; }
      if (!item) return;
      if (item.type === 'sensor') { message('Diese Taste zeigt einen PC-Messwert an.'); return; }
      if (dirty) throw Error('Bitte zuerst Änderungen speichern oder verwerfen.');
      const result = await call('press', {profileId:profile().id,path:[...path],index});
      if (result?.ok === false) throw Error(result.error || 'Die Tastenaktion konnte nicht ausgeführt werden.');
      message(`„${item.title || 'Taste ' + (index + 1)}“ ausgeführt.`);
    }));
    grid.addEventListener('dragstart', event => {
      const tile = event.target.closest('[data-td-key]');
      if (!editing || busy || !tile || !page()[Number(tile.dataset.tdKey)]) { event.preventDefault(); return; }
      dragIndex = Number(tile.dataset.tdKey); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(dragIndex)); tile.classList.add('td-dragging');
    });
    grid.addEventListener('dragover', event => { if (editing && dragIndex >= 0 && event.target.closest('[data-td-key]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
    grid.addEventListener('drop', event => {
      const tile = event.target.closest('[data-td-key]');
      if (!editing || busy || dragIndex < 0 || !tile) return;
      event.preventDefault(); swap(dragIndex, Number(tile.dataset.tdKey)); dragIndex = -1;
    });
    grid.addEventListener('dragend', () => { dragIndex = -1; root.querySelectorAll('.td-dragging').forEach(el => el.classList.remove('td-dragging')); });
  }
  function normalizePath() {
    let items = profile()?.buttons || [];
    for (let i = 0; i < path.length; i++) { if (items[path[i]]?.type !== 'folder') { path = path.slice(0, i); break; } items = items[path[i]].buttons; }
    if (selected >= page().length) selected = -1;
  }
  function adopt(next, force = false) {
    if (!next?.profiles?.length) return;
    const previous = draft && JSON.stringify(draft);
    state = clone(next);
    if (force || !dirty) {
      const incoming = configOf(next);
      // Keep handlers attached to the same draft objects on metadata-only updates.
      if (force || previous !== JSON.stringify(incoming)) draft = incoming;
      dirty = false; normalizePath(); if (force) { path = []; selected = -1; }
    }
    if (force || previous !== JSON.stringify(draft)) render();
    else { renderMobile(); updateSensorValues(); status(); }
    if (next.error) message(next.error, true);
  }
  async function save() {
    if (!draft.profiles.every(p => p.name.trim())) throw Error('Bitte jedem Profil einen Namen geben.');
    const next = await call('save', clone(draft));
    const oldPath = [...path], oldSelected = selected;
    adopt(next, true); path = oldPath; selected = oldSelected; normalizePath(); render(); message('Touch Deck gespeichert. Die Tasten sind auch auf verbundenen Geräten verfügbar.');
  }
  function render() {
    if (!draft) return;
    $('profile').innerHTML = draft.profiles.map(p => option(p.id, p.name || 'Unbenannt', draft.activeProfile)).join('');
    $('profile-name').value = profile().name;
    const size = `${profile().columns}x${profile().rows}`;
    const sizes = [['3x2','3 × 2 · große Tasten'],['5x3','5 × 3 · Standard'],['8x4','8 × 4 · viele Tasten']];
    if (!sizes.some(([id]) => id === size)) sizes.push([size,`${profile().columns} × ${profile().rows} · importiertes Raster`]);
    $('grid-size').innerHTML = sizes.map(([id,name]) => option(id,name,size)).join('');
    $('profile-delete').disabled = draft.profiles.length <= 1;
    renderDeck(); renderMobile(); status();
  }
  function renderDeck() { renderBreadcrumb(); renderGrid(); renderEditor(); scheduleSensors(); }
  function renderBreadcrumb() {
    const crumbs = [{name:profile().name || 'Unbenannt', depth:0}];
    let items = profile().buttons;
    path.forEach((index, offset) => { crumbs.push({name:items[index]?.title || 'Ordner', depth:offset + 1}); items = items[index]?.buttons || []; });
    $('breadcrumb').innerHTML = crumbs.map(crumb => `<button data-td-depth="${crumb.depth}"${crumb.depth === path.length ? ' aria-current="page"' : ''}>${esc(crumb.name)}</button>`).join('<span aria-hidden="true">›</span>');
    $('breadcrumb').querySelectorAll('button').forEach(button => { button.onclick = () => { if (busy) return; path = path.slice(0, Number(button.dataset.tdDepth)); selected = -1; closeConfirm(); renderDeck(); }; });
  }
  function safeIcon(value) { return typeof value === 'string' && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(value) ? value : ''; }
  function sensorText(item) {
    const sensor = state?.sensors?.find(value => value.id === item.sensorId);
    if (!sensor || sensor.value === null || sensor.value === undefined || sensor.value === '' || !Number.isFinite(Number(sensor.value))) return '—';
    const value = Number(sensor.value), formatted = Number.isInteger(value) ? String(value) : value.toLocaleString('de-DE', {maximumFractionDigits:1});
    return `${formatted}${sensor.unit ? ' ' + sensor.unit : ''}`;
  }
  function renderGrid() {
    $('grid').style.setProperty('--td-columns', profile().columns);
    $('grid').style.setProperty('--td-rows', profile().rows);
    $('grid').classList.toggle('td-grid-dense', profile().columns > 5);
    $('grid').innerHTML = page().map((item, index) => {
      const icon = safeIcon(item?.icon), title = item?.title || (item?.type === 'folder' ? 'Ordner' : `Taste ${index + 1}`);
      return `<button class="td-key${!item ? ' td-empty' : ''}${editing && selected === index ? ' td-selected' : ''}" data-td-key="${index}" draggable="${editing && !!item}" aria-label="${esc(!item ? (editing ? 'Leere Taste ' + (index + 1) + ' belegen' : 'Leere Taste ' + (index + 1)) : title)}"${editing ? ` aria-pressed="${selected === index}"` : ''}${!item && !editing ? ' disabled' : ''}><span class="td-key-number">${index + 1}</span>${item ? `<span class="td-key-art">${icon ? `<img src="${icon}" alt="" draggable="false">` : `<span class="td-symbol" aria-hidden="true">${esc(item.symbol || (item.type === 'folder' ? '📁' : '◆'))}</span>`}${item.type === 'sensor' ? `<strong class="td-key-value" data-td-sensor-value="${index}">${esc(sensorText(item))}</strong>` : ''}</span><span class="td-key-title">${esc(title)}</span><span class="td-key-kind">${item.type === 'folder' ? 'Ordner öffnen' : item.type === 'sensor' ? 'PC-Messwert' : item.steps?.length > 1 ? item.steps.length + ' Aktionen' : ''}</span>` : '<span class="td-plus" aria-hidden="true">+</span><span class="td-key-title">' + (editing ? 'Belegen' : 'Frei') + '</span>'}</button>`;
    }).join('');
  }
  function updateSensorValues() { $('grid')?.querySelectorAll('[data-td-sensor-value]').forEach(el => { const item = page()[Number(el.dataset.tdSensorValue)]; if (item?.type === 'sensor') el.textContent = sensorText(item); }); }
  function defaultStep(id = 'listen') {
    const definition = catalog.actions.find(item => item.id === id) || catalog.actions[0];
    if (!definition) return {action:'listen'};
    const step = {action:definition.id};
    if (definition.choices) step.target = definition.choices[0]?.id || '';
    if (definition.switch) step.op = 'toggle';
    if (definition.text) step.text = '';
    if (definition.transition) { step.transition = 'fade'; step.durationMs = 350; }
    return step;
  }
  function createButton(type) {
    if (type === 'folder' && path.length >= 4) { message('Ordner können höchstens vier Ebenen tief angelegt werden.', true); return false; }
    const item = {id:uid(),type,title:type === 'folder' ? 'Neuer Ordner' : type === 'sensor' ? 'PC-Messwert' : 'Jarvis fragen',symbol:type === 'folder' ? '📁' : type === 'sensor' ? '🌡' : '🎙'};
    if (type === 'folder') item.buttons = Array(profile().columns * profile().rows).fill(null);
    else if (type === 'sensor') item.sensorId = state?.sensors?.[0]?.id || '';
    else item.steps = [defaultStep()];
    page()[selected] = item; changed(); renderGrid(); renderEditor(); scheduleSensors(); return true;
  }
  function swap(from, to) {
    const items = page();
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
    [items[from], items[to]] = [items[to], items[from]]; selected = to; changed(); renderGrid(); renderEditor(); message('Tasten getauscht. Zum Übernehmen speichern.');
  }
  function renderEditor() {
    const editor = $('editor');
    if (!editing) { editor.replaceChildren(); return; }
    if (selected < 0) { editor.innerHTML = '<h3>Taste bearbeiten</h3><p class="td-help">Wähle eine Taste im Deck. Du kannst Aktionen verbinden, Ordner anlegen oder einzelne PC-Werte anzeigen.</p>'; return; }
    const item = current();
    if (!item) {
      editor.innerHTML = `<h3>Taste ${selected + 1} belegen</h3><div class="td-create"><button id="td-create-action">Aktion / Kombination</button><button id="td-create-folder">Ordner</button><button id="td-create-sensor">PC-Messwert</button></div><p class="td-help">Eine Kombination führt bis zu acht Aktionen nacheinander aus.</p>`;
      ['action','folder','sensor'].forEach(type => on('create-' + type, () => createButton(type)));
      return;
    }
    editor.innerHTML = `<h3>Taste ${selected + 1}</h3><label>Beschriftung<input id="td-title" maxlength="80" value="${esc(item.title)}"></label><label>Art<select id="td-type">${[['action','Aktion / Kombination'],['folder','Ordner'],['sensor','PC-Messwert']].map(([id, name]) => option(id,name,item.type)).join('')}</select></label>
      <div class="td-symbol-row"><label>Symbol<select id="td-symbol">${[...new Set([item.symbol || '◆', ...symbols])].map(symbol => option(symbol,symbol,item.symbol || '◆')).join('')}</select></label><button id="td-icon">Eigenes Bild</button>${safeIcon(item.icon) ? '<button id="td-icon-remove" title="Eigenes Bild entfernen">Bild entfernen</button>' : ''}</div>
      <div id="td-type-editor"></div><hr><label>Tauschen mit<select id="td-move-target">${page().map((target, index) => index === selected ? '' : option(index, `${index + 1} · ${target?.title || 'Frei'}`, '')).join('')}</select></label><button id="td-move">Tasten tauschen</button><button id="td-delete" class="td-danger">Taste löschen</button>`;
    $('title').oninput = () => { item.title = $('title').value; changed(); renderGrid(); };
    $('symbol').onchange = () => { item.symbol = $('symbol').value; changed(); renderGrid(); };
    $('type').onchange = () => {
      const type = $('type').value;
      if (item.type === 'folder' && item.buttons?.some(Boolean)) { $('type').value = item.type; message('Ein belegter Ordner kann nicht umgewandelt werden. Verschiebe oder lösche zuerst seine Tasten.', true); return; }
      const title = item.title, symbol = item.symbol, icon = item.icon, id = item.id;
      if (!createButton(type)) { renderEditor(); return; } Object.assign(current(), {id,title,symbol}); if (icon) current().icon = icon; renderGrid(); renderEditor();
    };
    on('icon', async () => { const result = await call('icon'); const value = typeof result === 'string' ? result : result?.dataPNG || result?.icon; if (safeIcon(value)) { item.icon = value; changed(); renderGrid(); renderEditor(); } });
    on('icon-remove', () => { delete item.icon; changed(); renderGrid(); renderEditor(); });
    on('move', () => swap(selected, Number($('move-target').value)));
    on('delete', () => ask(`„${item.title || 'Taste ' + (selected + 1)}“${item.type === 'folder' ? ' mit allen enthaltenen Tasten' : ''} löschen?`, () => { page()[selected] = null; changed(); renderGrid(); renderEditor(); scheduleSensors(); }));
    if (item.type === 'folder') {
      $('type-editor').innerHTML = '<button id="td-folder-open" class="primary">Ordner bearbeiten</button><p class="td-help">Ordner haben das Raster dieses Profils. Über die Leiste über den Tasten gelangst du zurück.</p>';
      on('folder-open', () => { path.push(selected); selected = -1; renderDeck(); });
    } else if (item.type === 'sensor') {
      const sensors = state?.sensors || [], known = sensors.some(sensor => sensor.id === item.sensorId);
      $('type-editor').innerHTML = `<label>Messwert<select id="td-sensor">${!known ? option(item.sensorId || '', item.sensorId ? 'Gespeicherter Sensor · derzeit nicht verfügbar' : 'Messwert auswählen', item.sensorId) : ''}${sensors.map(sensor => option(sensor.id, sensor.name + (sensor.unit ? ' (' + sensor.unit + ')' : ''), item.sensorId)).join('')}</select></label><p class="td-help">Nicht verfügbare Messwerte zeigen „—“. Lüfterdrehzahlen und Prozentwerte erscheinen nur, wenn der Sensor sie liefert.</p><button id="td-sensors-refresh">Messwerte neu laden</button>`;
      $('sensor').onchange = () => { item.sensorId = $('sensor').value; changed(); renderGrid(); scheduleSensors(); };
      on('sensors-refresh', async () => { const next = await call('state', {sensorsOnly:true}); state.sensors = next.sensors || []; renderEditor(); updateSensorValues(); message('Verfügbare PC-Messwerte geladen.'); });
    } else renderSteps(item);
  }
  function renderSteps(item) {
    const steps = item.steps || (item.steps = [defaultStep()]);
    $('type-editor').innerHTML = `<h4>Aktionen nacheinander</h4><div class="td-steps">${steps.map((step, index) => {
      const definition = catalog.actions.find(action => action.id === step.action);
      return `<fieldset class="td-step"><legend>Aktion ${index + 1}</legend><label>Aktion<select data-td-step="${index}" data-td-field="action">${!definition ? option(step.action,'Nicht verfügbare Aktion',step.action) : ''}${catalog.actions.map(action => option(action.id,action.name,step.action)).join('')}</select></label>${definition?.choices ? `<label>Ziel<select data-td-step="${index}" data-td-field="target">${!definition.choices.some(choice => choice.id === step.target) ? option(step.target || '', definition.choices.length ? 'Ziel auswählen' : 'Noch keine Einträge vorhanden',step.target) : ''}${definition.choices.map(choice => option(choice.id,choice.name || choice.title || choice.id,step.target)).join('')}</select></label>` : ''}${definition?.switch ? `<label>Schalten<select data-td-step="${index}" data-td-field="op">${[['toggle','Umschalten'],['on','Einschalten'],['off','Ausschalten']].map(([id,name]) => option(id,name,step.op || 'toggle')).join('')}</select></label>` : ''}${definition?.text ? `<label>Gespeicherter Befehl<input data-td-step="${index}" data-td-field="text" maxlength="500" value="${esc(step.text)}" placeholder="Zum Beispiel: Wie warm ist die Grafikkarte?"></label>` : ''}${definition?.transition ? `<div class="td-two"><label>Übergang<select data-td-step="${index}" data-td-field="transition">${[['fade','Überblenden'],['cut','Schnitt']].map(([id,name]) => option(id,name,step.transition || 'fade')).join('')}</select></label><label>Dauer (ms)<input data-td-step="${index}" data-td-field="durationMs" type="number" min="100" max="2000" step="50" value="${esc(step.durationMs ?? 350)}"></label></div>` : ''}<div class="td-step-tools"><button data-td-up="${index}"${index === 0 ? ' disabled' : ''} aria-label="Aktion ${index + 1} nach oben">↑</button><button data-td-down="${index}"${index === steps.length - 1 ? ' disabled' : ''} aria-label="Aktion ${index + 1} nach unten">↓</button><button data-td-remove-step="${index}"${steps.length === 1 ? ' disabled' : ''}>Entfernen</button></div></fieldset>`;
    }).join('')}</div><button id="td-step-add"${steps.length >= 8 ? ' disabled' : ''}>+ Aktion hinzufügen</button><p class="td-help">Szenen und Übergänge steuern die vorhandenen Batto-Ausgaben. Chat- und Bot-Aktionen verwenden deine bestehenden Einstellungen.</p>`;
    $('type-editor').querySelectorAll('[data-td-field]').forEach(input => {
      input.addEventListener(input.tagName === 'INPUT' ? 'input' : 'change', () => {
        if (busy) return;
        const index = Number(input.dataset.tdStep), field = input.dataset.tdField;
        if (field === 'action') { steps[index] = defaultStep(input.value); changed(); renderSteps(item); renderGrid(); return; }
        steps[index][field] = field === 'durationMs' ? Number(input.value) : input.value; changed();
      });
    });
    for (const direction of ['up','down']) $('type-editor').querySelectorAll(`[data-td-${direction}]`).forEach(button => { button.onclick = () => { if (busy) return; const index = Number(button.dataset[direction === 'up' ? 'tdUp' : 'tdDown']), next = index + (direction === 'up' ? -1 : 1); if (next < 0 || next >= steps.length) return; [steps[index], steps[next]] = [steps[next], steps[index]]; changed(); renderSteps(item); }; });
    $('type-editor').querySelectorAll('[data-td-remove-step]').forEach(button => { button.onclick = () => { if (busy || steps.length <= 1) return; steps.splice(Number(button.dataset.tdRemoveStep),1); changed(); renderSteps(item); renderGrid(); }; });
    on('step-add', () => { if (steps.length < 8) { steps.push(defaultStep()); changed(); renderSteps(item); renderGrid(); } });
  }
  function renderMobile() {
    if (!state || !$('mobile')) return;
    const mobile = state.mobile || {}, urls = Array.isArray(mobile.urls) ? mobile.urls : [];
    const clients = Array.isArray(mobile.clients) ? mobile.clients.length : Number(mobile.clients || 0);
    $('mobile-summary').textContent = mobile.running ? `· Aktiv · ${clients} verbunden` : '· Aus';
    $('mobile').innerHTML = `<div class="td-toolbar"><span class="td-mobile-status${mobile.running ? ' td-online' : ''}">${mobile.running ? 'Verbindung eingeschaltet' : 'Verbindung ausgeschaltet'}</span><button id="td-mobile-toggle"${!mobile.running ? ' class="primary"' : ''}>${mobile.running ? 'Verbindung ausschalten' : 'Handy-Verbindung einschalten'}</button>${mobile.running ? '<button id="td-mobile-pin">Neue PIN / Geräte trennen</button>' : ''}</div>${mobile.running ? `<div class="td-pairing"><div><span class="td-help">PIN zum Verbinden</span><strong class="td-pin">${esc(mobile.pin || '—')}</strong><span class="td-help">${clients} Gerät${clients === 1 ? '' : 'e'} verbunden</span></div><div>${urls.length ? urls.map((url,index) => `<div class="td-address"><code>${esc(url)}</code><button data-td-copy-url="${index}" aria-label="Handy-Adresse ${index + 1} kopieren">Kopieren</button></div>`).join('') : '<p class="td-help">Keine Netzwerkadresse verfügbar. Prüfe deine WLAN- oder LAN-Verbindung.</p>'}<p class="td-help">PIN nur mit deinen Geräten teilen. Falls Windows nach dem Netzwerkzugriff fragt, das private Netzwerk erlauben.</p></div></div>` : ''}`;
    on('mobile-toggle', async () => { const next = await call(mobile.running ? 'mobile-stop' : 'mobile-start'); adopt(next); message(mobile.running ? 'Handy-Verbindung ausgeschaltet.' : 'Handy-Verbindung eingeschaltet. Öffne eine der Adressen auf deinem Gerät.'); });
    on('mobile-pin', async () => { const next = await call('mobile-pin'); adopt(next); message('Neue PIN erstellt. Verbundene Geräte müssen sich erneut anmelden.'); });
    $('mobile').querySelectorAll('[data-td-copy-url]').forEach(button => { button.onclick = run(async () => { await window.batto.copyText(urls[Number(button.dataset.tdCopyUrl)]); message('Handy-Adresse kopiert.'); }); });
  }
  function scheduleSensors() {
    clearTimeout(sensorTimer); sensorTimer = null;
    if (!initialized || !active() || !page().some(item => item?.type === 'sensor')) return;
    sensorTimer = setTimeout(async () => {
      sensorTimer = null;
      if (!active() || busy || pollBusy) { scheduleSensors(); return; }
      pollBusy = true;
      try { const next = await call('state', {sensorsOnly:true}); if (state) state.sensors = next.sensors || []; if (active()) updateSensorValues(); }
      catch { /* Keep unavailable values explicit; a visible action reports connection errors. */ if (state) state.sensors = []; if (active()) updateSensorValues(); }
      finally { pollBusy = false; scheduleSensors(); }
    }, 3000);
  }
  async function refreshCatalog() {
    if (catalogBusy) return;
    catalogBusy = true;
    try {
      const next = await call('catalog');
      if (Array.isArray(next?.actions)) {
        catalog = next;
        if (editing && !root.contains(document.activeElement)) renderEditor();
      }
    } catch (error) { message('Aktionen konnten nicht aktualisiert werden: ' + cleanError(error), true); }
    finally { catalogBusy = false; }
  }
  async function init() {
    if (initialized || loading) return;
    loading = true;
    root.innerHTML = '<p class="td-help" role="status">Touch Deck wird geladen …</p>';
    try {
      const [next, actions] = await Promise.all([call('state'), call('catalog')]);
      if (!next?.profiles?.length) throw Error('Touch-Deck-Profile konnten nicht geladen werden.');
      catalog = actions || {actions:[]};
      state = clone(next); draft = configOf(next); initialized = true; build(); render();
      if (next.error) message(next.error, true);
    } catch (error) { root.innerHTML = `<p class="td-message td-error" role="alert">${esc(cleanError(error))}</p><button id="td-retry">Erneut laden</button>`; $('retry').onclick = () => { void init(); }; }
    finally { loading = false; }
  }
  document.addEventListener('batto:view', () => { if (active()) { if (initialized) void refreshCatalog(); else void init(); scheduleSensors(); } else { clearTimeout(sensorTimer); sensorTimer = null; } });
  document.addEventListener('visibilitychange', scheduleSensors);
  window.batto.onPresentationState?.(() => queueMicrotask(scheduleSensors));
  window.batto.onTouchState?.(next => { if (initialized) adopt(next); });
  if (active()) void init();
})();
