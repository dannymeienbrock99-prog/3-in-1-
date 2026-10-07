(() => {
  'use strict';
  const host = document.querySelector('[data-corsair-direct-root]'), api = window.batto;
  if (!host || !api?.corsairDirectStatus) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const phases = {off:'Aus',starting:'Übernahme läuft …',ready:'Direkt verbunden',releasing:'Wird zurückgegeben …',blocked:'Nicht verfügbar',error:'Bitte prüfen'};
  const drafts = new Map();
  let state = null, pending = false, signature = '', localError = '', lastMessage = '', selectedHub = '', administrator = null;
  host.classList.add('corsair-direct-control');
  host.innerHTML = `<div class="corsair-direct-heading"><div><span class="corsair-direct-kicker">CORSAIR · RGB &amp; KÜHLUNG</span><h3>iCUE LINK direkt steuern</h3><p>Erkannte LINK-Controller übernehmen und ihre Lüfter einstellen.</p></div><label class="pc-fan-toggle"><input data-corsair-direct="enabled" type="checkbox" role="switch" aria-label="Direkte Corsair-Steuerung einschalten" disabled><span class="pc-fan-switch" aria-hidden="true"></span><span data-corsair-direct="toggle-label">Aus</span></label></div>
    <div class="corsair-direct-toolbar"><label class="corsair-direct-controller">Controller<select data-corsair-direct="hub" aria-label="Corsair-Controller auswählen"><option value="">Erkennung noch nicht gestartet</option></select></label><button data-corsair-direct="enumerate" type="button">Controller erkennen</button><span data-corsair-direct="phase" class="pc-fan-pill">Aus</span><button data-corsair-direct="release" type="button" hidden>An iCUE zurückgeben</button></div>
    <label class="corsair-direct-consent"><input data-corsair-direct="consent" type="checkbox"> Ich erlaube Batto, die iCUE-Gerätesteuerung während der direkten Übernahme zu pausieren. Beim Ausschalten wird sie zurückgegeben.</label>
    <p data-corsair-direct="status" class="corsair-direct-status" role="status" aria-live="polite">Beim Start bleibt die direkte Corsair-Steuerung ausgeschaltet.</p>
    <button data-corsair-direct="admin-restart" type="button" hidden>Batto als Administrator neu starten</button>
    <p data-corsair-direct="error" class="corsair-direct-error" role="alert" hidden></p>
    <div data-corsair-direct="channels" class="corsair-direct-channels"></div>
    <div data-corsair-direct="metrics" class="corsair-direct-metrics" hidden></div>
    <p class="corsair-direct-footnote">RGB-Effekte stellst du unter „RGB-Steuerung“ ein. Eine Übernahme ändert noch keine Lüfterleistung; erst „Leistung anwenden“ überträgt deinen Wert. Pumpen bleiben von der Lüfterregelung ausgeschlossen. Fehlende Messwerte werden als — angezeigt.</p>
    <p data-corsair-direct="release-note" class="corsair-direct-footnote" hidden>Die Freigabe wurde angefordert. Die tatsächliche Hardware-Regelung und Drehzahl bleiben zu prüfen.</p>`;
  const find = name => host.querySelector(`[data-corsair-direct="${name}"]`);
  const channelsHost = find('channels'), toggle = find('enabled'), consent = find('consent'), hubSelect = find('hub');
  const owned = () => !!state && (state.returnRequired === true || state.sdkSuppressed === true || state.enabled === true || state.active === true || state.ownsControl === true || state.retryRequired === true || state.released === false || state.remaining?.length > 0);
  const ready = () => state?.enabled === true && state.active === true && state.phase === 'ready';
  const channels = () => (Array.isArray(state?.channels) ? state.channels : []).filter(c => typeof c?.id === 'string');
  const isFan = channel => channel.kind === 'fan' && !/pump|pumpe|netzteil|power supply/i.test(`${channel.name || ''} ${channel.device || ''}`);
  const bounds = channel => ({min:Math.max(30, Number.isFinite(channel.minDuty) ? channel.minDuty : 30), max:Math.min(100, Number.isFinite(channel.maxDuty) ? channel.maxDuty : 100)});
  const causeText = cause => String(cause?.message || cause || 'Die direkte Corsair-Steuerung konnte nicht aktualisiert werden.').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  const unwrap = value => value?.corsairDirect || value?.state || value;
  function showError() {find('error').textContent = localError || state?.error || '';find('error').hidden = !find('error').textContent;}
  function renderChannels() {
    const list = channels();
    const nextSignature = JSON.stringify(list.map(c => [c.id,c.name,c.kind,c.device,c.hubId,c.minDuty,c.maxDuty]));
    if (signature !== nextSignature) {
      if (signature) drafts.clear();
      signature = nextSignature;
      channelsHost.innerHTML = list.map(channel => {
        const id = escape(channel.id), fan = isFan(channel), {min,max} = bounds(channel);
        if (!drafts.has(channel.id)) drafts.set(channel.id,{duty:Math.min(max,Math.max(min,Number.isFinite(channel.duty) ? Math.round(channel.duty) : 50)),confirmed:false});
        const draft = drafts.get(channel.id);
        return `<article class="corsair-direct-channel" data-corsair-channel="${id}"><div class="corsair-direct-channel-heading"><div><h4>${escape(channel.name || (fan ? 'LINK-Lüfter' : 'Gerät'))}</h4><small>${escape(channel.device || 'iCUE LINK System Hub')} · ${fan ? 'Lüfter' : /pump|pumpe/i.test(channel.name || '') || channel.kind === 'pump' ? 'Pumpe · Nur Anzeige' : 'Nur Anzeige'}</small></div><div class="corsair-direct-reading"><strong data-corsair-rpm>— RPM</strong><small data-corsair-duty>Leistung —</small></div></div>${fan ? `<label class="corsair-direct-fan-confirm"><input data-corsair-input="confirmed" type="checkbox" ${draft.confirmed ? 'checked' : ''}> Dieser erkannte Anschluss gehört zu einem Lüfter, keiner Pumpe.</label><div class="corsair-direct-manual"><label class="corsair-direct-duty">Feste Leistung<span class="corsair-direct-duty-fields"><input data-corsair-input="range" type="range" min="${min}" max="${max}" step="1" value="${draft.duty}" aria-label="${escape(channel.name || 'Lüfter')}: Leistung einstellen"><span><input data-corsair-input="duty" type="number" min="${min}" max="${max}" step="1" value="${draft.duty}" aria-label="${escape(channel.name || 'Lüfter')}: Leistung in Prozent"> %</span></span></label><button data-corsair-action="manual" type="button">Leistung anwenden</button></div>` : '<p class="corsair-direct-footnote">Dieses Gerät wird hier nicht geregelt.</p>'}</article>`;
      }).join('');
    }
    for (const card of channelsHost.querySelectorAll('[data-corsair-channel]')) {
      const channel = list.find(c => c.id === card.dataset.corsairChannel);
      if (!channel) continue;
      card.querySelector('[data-corsair-rpm]').textContent = ready() && Number.isFinite(channel.rpm) && channel.rpm >= 0 ? `${Math.round(channel.rpm).toLocaleString('de-DE')} RPM` : '— RPM';
      card.querySelector('[data-corsair-duty]').textContent = ready() && Number.isFinite(channel.duty) ? `Leistung ${Math.round(channel.duty)} %` : 'Leistung —';
      const draft = drafts.get(channel.id), {min,max} = bounds(channel), canEdit = ready() && isFan(channel) && !pending && min <= max;
      card.querySelectorAll('input,button').forEach(control => {control.disabled = !canEdit;});
      const apply = card.querySelector('[data-corsair-action="manual"]');
      if (apply) apply.disabled = !canEdit || draft.confirmed !== true;
    }
  }
  function render() {
    const hasOwnership = owned(), transitional = ['starting','releasing'].includes(state?.phase), available = state?.availability?.native === true;
    const hubs = Array.isArray(state?.hubs) ? state.hubs.filter(h => typeof h?.id === 'string') : [];
    if (selectedHub && !hubs.some(h => h.id === selectedHub)) selectedHub = '';
    if (!selectedHub && hubs.length === 1) selectedHub = hubs[0].id;
    host.setAttribute('aria-busy', pending || transitional ? 'true' : 'false');
    toggle.checked = hasOwnership;
    toggle.disabled = pending || transitional || (!hasOwnership && (!available || !selectedHub || administrator !== true || consent.checked !== true));
    toggle.setAttribute('aria-label', hasOwnership ? 'Direkte Corsair-Steuerung ausschalten' : 'Direkte Corsair-Steuerung einschalten');
    find('toggle-label').textContent = ready() ? 'Ein' : hasOwnership ? 'Offen' : 'Aus';
    find('phase').textContent = phases[state?.phase] || 'Aus';find('phase').dataset.phase = state?.phase || 'off';
    consent.disabled = pending || transitional || hasOwnership;
    find('enumerate').disabled = pending || transitional || hasOwnership;
    find('release').hidden = !hasOwnership;find('release').disabled = pending || transitional;
    find('release').textContent = state?.retryRequired || state?.phase === 'error' ? 'Ausschalten erneut versuchen' : 'An iCUE zurückgeben';
    find('admin-restart').hidden = administrator !== false || !api.suite;find('admin-restart').disabled = pending || transitional || hasOwnership;
    const options = `<option value="">${hubs.length ? 'Controller auswählen' : 'Kein Controller bestätigt'}</option>` + hubs.map(h => `<option value="${escape(h.id)}">${escape(h.name || 'iCUE LINK System Hub')}${hubs.length > 1 ? ' · '+escape(h.serial || h.id.slice(-8)) : ''}${h.firmware ? ' · Firmware '+escape(h.firmware) : ''}</option>`).join('');
    if (hubSelect.innerHTML !== options) hubSelect.innerHTML = options;
    hubSelect.value = selectedHub;hubSelect.disabled = pending || transitional || hasOwnership || hubs.length === 0;
    let message = state?.availability?.reason || 'Beim Start bleibt die direkte Corsair-Steuerung ausgeschaltet.';
    if (transitional) message = state.phase === 'starting' ? 'Batto prüft die ausdrücklich bestätigte Übernahme.' : 'Batto gibt die Corsair-Geräte zurück.';
    else if (ready()) {const fans = channels().filter(isFan).length;message = fans ? `${fans} ${fans === 1 ? 'erkannter Lüfter' : 'erkannte Lüfter'} · Änderungen erst mit „Leistung anwenden“ übertragen.` : 'Controller übernommen. Es wurde noch kein unterstützter Lüfter gemeldet.';}
    else if (hasOwnership) message = 'Die Rückgabe ist noch offen. Bitte erneut ausschalten.';
    else if (state?.phase === 'error') message = 'Die direkte Corsair-Steuerung ist nicht bestätigt. Prüfe den Gerätehinweis.';
    else if (available && administrator === false) message = 'Für die direkte Übernahme benötigt Batto Administratorrechte. Starte Batto dafür über die Schaltfläche neu.';
    else if (available && administrator === null) message = 'Die Zugriffsprüfung wird geladen. Die direkte Corsair-Steuerung bleibt ausgeschaltet.';
    else if (state?.released && state.releaseVerification !== 'none') message = 'Batto hat seine direkte Corsair-Steuerung beendet.';
    else if (available && hubs.length) message = 'Controller erkannt. Bestätige die iCUE-Pause und schalte die direkte Steuerung bewusst ein.';
    else if (available) message = 'Klicke auf „Controller erkennen“. Dabei werden keine Lüfterwerte geändert.';
    const probe = !hasOwnership && (Array.isArray(state?.probes) ? state.probes : []).find(value => value.id === selectedHub && value.readable === false);
    if (probe?.reason) message += ` ${probe.reason}`;
    find('status').textContent = lastMessage || message;
    find('release-note').hidden = hasOwnership || !['api-only','unconfirmed'].includes(state?.releaseVerification);
    const metrics = (Array.isArray(state?.sensors) ? state.sensors : []).filter(s => Number.isFinite(s?.celsius) && typeof s.name === 'string');
    find('metrics').innerHTML = metrics.map(s => {const age = Date.now() - Date.parse(s.updatedUtc), fresh = ready() && Number.isFinite(age) && age >= -2000 && age <= 10000;return `<span>${escape(s.name)}: ${fresh ? s.celsius.toLocaleString('de-DE',{maximumFractionDigits:1})+' °C' : '—'}</span>`;}).join('');
    find('metrics').hidden = metrics.length === 0;
    showError();renderChannels();
  }
  function update(value) {
    const next = unwrap(value);
    if (!next || typeof next !== 'object' || typeof next.phase !== 'string') return false;
    const previouslyOwned = owned();state = next;
    if (previouslyOwned && !owned()) {drafts.clear();signature = '';consent.checked = false;}
    lastMessage = '';render();return true;
  }
  async function request(action) {
    if (pending) return;
    pending = true;localError = '';lastMessage = '';render();
    try {const reply = await action();if (!update(reply)) update(await api.corsairDirectStatus());}
    catch (cause) {try {update(await api.corsairDirectStatus());} catch {}localError = causeText(cause);}
    finally {pending = false;render();}
  }
  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    if (enabled && (consent.checked !== true || !selectedHub || state?.availability?.native !== true || administrator !== true)) {localError = administrator === false ? 'Starte Batto zuerst als Administrator und bestätige danach die iCUE-Pause.' : 'Bestätige zuerst die iCUE-Pause für einen ausgewählten Controller mit bestätigtem Zugriff.';render();return;}
    request(() => api.corsairDirectControl({enabled,...(enabled ? {confirmICuePause:true,...(selectedHub ? {hubId:selectedHub} : {})} : {})}));
  });
  consent.addEventListener('change', () => {localError = '';render();});
  hubSelect.addEventListener('change', () => {selectedHub = hubSelect.value;render();});
  find('enumerate').addEventListener('click', () => request(() => api.corsairDirectEnumerate()));
  find('release').addEventListener('click', () => request(() => api.corsairDirectControl({enabled:false})));
  find('admin-restart').addEventListener('click', () => request(() => api.suite('hardware-admin-restart')));
  channelsHost.addEventListener('input', event => {
    const input = event.target, card = input.closest('[data-corsair-channel]');
    if (!card || !['range','duty'].includes(input.dataset.corsairInput)) return;
    const draft = drafts.get(card.dataset.corsairChannel);if (!draft) return;
    draft.duty = input.value === '' ? null : input.valueAsNumber;
    if (Number.isFinite(draft.duty)) card.querySelector(`[data-corsair-input="${input.dataset.corsairInput === 'range' ? 'duty' : 'range'}"]`).value = draft.duty;
  });
  channelsHost.addEventListener('change', event => {
    const input = event.target, card = input.closest('[data-corsair-channel]');
    if (card && input.dataset.corsairInput === 'confirmed') {const draft = drafts.get(card.dataset.corsairChannel);if (draft) draft.confirmed = input.checked === true;renderChannels();}
  });
  channelsHost.addEventListener('click', event => {
    const button = event.target.closest('[data-corsair-action="manual"]'), card = button?.closest('[data-corsair-channel]');
    if (!card || pending) return;
    const channel = channels().find(c => c.id === card.dataset.corsairChannel), draft = drafts.get(card.dataset.corsairChannel);
    const invalid = message => {localError = message;render();};
    if (!channel || !isFan(channel) || !ready()) return invalid('Übernimm zuerst den verfügbaren Corsair-Controller.');
    if (draft?.confirmed !== true) return invalid('Bestätige zuerst einen Lüfter, keine Pumpe.');
    const {min,max} = bounds(channel);
    if (!Number.isInteger(draft.duty) || draft.duty < min || draft.duty > max) return invalid(`Bitte eine ganze Lüfterleistung zwischen ${min} und ${max} % eingeben.`);
    request(() => api.corsairDirectManual({id:channel.id,duty:draft.duty,fanConfirmed:true}));
  });
  api.onCorsairDirectUpdate?.(update);
  function updateAdministrator(value) {if (typeof value?.prerequisites?.administrator === 'boolean') {administrator = value.prerequisites.administrator;render();}}
  api.onSuiteState?.(value => {updateAdministrator(value?.fanControl);if (value?.corsairDirect) update(value.corsairDirect);});
  document.addEventListener('batto:view', event => {if (event.detail === 'fans') render();});
  render();request(() => api.corsairDirectStatus());
  if (api.suite) api.suite('fan-control-state').then(updateAdministrator).catch(() => {});
})();
