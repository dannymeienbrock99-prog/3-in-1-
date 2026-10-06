(() => {
  'use strict';
  const host = document.querySelector('[data-fan-control-root]');
  if (!host || !window.batto?.suite) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const phaseNames = {off:'Aus',starting:'Wird aktiviert …',ready:'Bereit',blocked:'Nicht verfügbar',releasing:'Wird zurückgegeben …',error:'Bitte prüfen'};
  const drafts = new Map();
  let state = null, pending = false, channelSignature = '', lastMessage = '';
  host.classList.add('pc-fan-control');
  host.innerHTML = `<div class="pc-fan-heading"><div><span class="pc-fan-kicker">KÜHLUNG · DESKTOP-PC</span><h3>PC-Lüftersteuerung</h3><p>Dein Mainboard erkennen und unterstützte Lüfter einstellen.</p></div><label class="pc-fan-toggle"><input data-pc-fan="enabled" type="checkbox" role="switch" aria-label="PC-Lüftersteuerung einschalten" disabled><span class="pc-fan-switch" aria-hidden="true"></span><span data-pc-fan="toggle-label">Aus</span></label></div>
    <div class="pc-fan-overview"><div class="pc-fan-board"><span class="pc-fan-board-icon" aria-hidden="true">▣</span><div><span data-pc-fan="brand" class="pc-fan-brand">Mainboard</span><strong data-pc-fan="model">Erkennung wird geladen …</strong><small data-pc-fan="platform">Nur für Desktop-PCs</small></div></div><div class="pc-fan-connection"><span data-pc-fan="phase" class="pc-fan-pill">Aus</span><button type="button" data-pc-fan="refresh">Erkennung aktualisieren</button></div></div>
    <p data-pc-fan="status" class="pc-fan-status" role="status" aria-live="polite">Die Steuerung ist beim Programmstart ausgeschaltet.</p>
    <p data-pc-fan="error" class="pc-fan-error" role="alert" hidden></p>
    <p data-pc-fan="curve-availability" class="pc-fan-footnote" hidden>Dieser Treiber bietet hier manuelle Steuerung. Temperaturkurven benötigen bestätigte aktuelle Messwerte.</p>
    <div data-pc-fan="channels" class="pc-fan-channels"></div>
    <p class="pc-fan-footnote">Der Schalter aktiviert nur Battos Lüftersteuerung. Beim Ausschalten beendet Batto seine Regelung und fordert die Hardware-Regelung an. Die Lüfter werden dadurch nicht angehalten.</p>
    <p data-pc-fan="release-note" class="pc-fan-footnote" hidden>Rückgabe über den Treiber angefordert; die tatsächliche Drehzahl im BIOS oder Herstellerprogramm prüfen.</p>
    <details class="pc-fan-external"><summary>Fan Control und Corsair ergänzen</summary><div><p>Fan Control und das CorsairLink-Plugin sind zusätzliche Programme. Ihre Lüfterregler bedienst du in Fan Control. Ein erkanntes ASUS- oder MSI-Mainboard allein garantiert keinen Zugriff auf seine Lüfteranschlüsse.</p><p>CorsairLink benötigt exklusiven Zugriff auf unterstützte Corsair-Controller. Bei laufendem iCUE wird das Plugin hier nicht automatisch geladen. Eine Übernahme kann auch die RGB-Steuerung verändern.</p><div class="pc-fan-links"><button type="button" data-fan-link="fancontrol">Fan Control ansehen ↗</button><button type="button" data-fan-link="corsair">CorsairLink-Plugin ansehen ↗</button><button type="button" data-fan-link="asus">ASUS-Projekt ansehen ↗</button></div><small>AsusFanControl unterstützt ausgewählte ASUS-Notebooks. Es wird für deine PC-Lüfter nicht ausgeführt.</small></div></details>`;
  const find = name => host.querySelector(`[data-pc-fan="${name}"]`);
  const enabledInput = find('enabled'), channelsHost = find('channels');
  const fanChannels = () => (Array.isArray(state?.channels) ? state.channels : []).filter(c => c?.kind === 'fan' && typeof c.id === 'string');
  const bounds = channel => ({min:Math.max(30, Number.isFinite(channel.minDuty) ? channel.minDuty : 30),max:Math.min(100, Number.isFinite(channel.maxDuty) ? channel.maxDuty : 100)});
  const sensorFresh = sensor => Number.isFinite(sensor?.celsius) && Number.isFinite(Date.parse(sensor.updatedUtc)) && Date.now() - Date.parse(sensor.updatedUtc) <= 10000 && Date.now() - Date.parse(sensor.updatedUtc) >= -2000;
  const freshSensors = () => (Array.isArray(state?.sensors) ? state.sensors : []).filter(s => typeof s?.id === 'string' && sensorFresh(s));
  const ready = () => state?.enabled === true && state.phase === 'ready' && state.platform?.kind === 'desktop' && state.availability?.native === true;
  const getChannel = id => fanChannels().find(c => c.id === id);
  const errorText = error => String(error?.message || error || 'Die Lüftersteuerung konnte nicht aktualisiert werden.').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  function error(message) {find('error').textContent = message;find('error').hidden = !message;}
  function unwrap(value) {return value?.fanControl || (value?.state?.phase ? value.state : value);}
  function newDraft(channel) {
    const {min,max} = bounds(channel), value = Number.isFinite(channel.duty) ? channel.duty : 50;
    return {duty:Math.min(max,Math.max(min,Math.round(value))),sensorId:'',fanConfirmed:false,points:[{temp:30,duty:min},{temp:50,duty:Math.min(max,Math.max(min,50))},{temp:70,duty:Math.min(max,Math.max(min,80))},{temp:85,duty:max}]};
  }
  function renderChannels() {
    const channels = fanChannels();
    const signature = JSON.stringify(channels.map(c => [c.id,c.name,c.provider,c.device,c.minDuty,c.maxDuty]));
    if (signature !== channelSignature) {
      channelSignature = signature;
      channelsHost.innerHTML = channels.map(channel => {
        if (!drafts.has(channel.id)) drafts.set(channel.id,newDraft(channel));
        const draft = drafts.get(channel.id), {min,max} = bounds(channel), id = escape(channel.id);
        return `<article class="pc-fan-channel" data-fan-channel="${id}"><div class="pc-fan-channel-heading"><div><h4>${escape(channel.name || 'Lüfter')}</h4><small>${escape([channel.device,channel.provider].filter(Boolean).join(' · '))}</small></div><div class="pc-fan-reading"><strong data-fan-rpm>—</strong><small data-fan-duty>Leistung —</small></div></div><label class="pc-fan-confirm"><input data-fan-input="confirmed" type="checkbox" ${draft.fanConfirmed?'checked':''}> An diesem Anschluss hängt ein Lüfter, keine Pumpe.</label><div class="pc-fan-manual"><label>Feste Leistung<span class="pc-fan-duty-fields"><input data-fan-input="range" type="range" min="${min}" max="${max}" step="1" value="${draft.duty}" aria-label="${escape(channel.name || 'Lüfter')}: Leistung einstellen"><span><input data-fan-input="duty" type="number" min="${min}" max="${max}" step="1" value="${draft.duty}" aria-label="${escape(channel.name || 'Lüfter')}: Leistung in Prozent"> %</span></span></label><button type="button" data-fan-action="manual">Leistung anwenden</button></div><details class="pc-fan-curve"><summary>Nach Temperatur steuern</summary><label>Temperaturquelle<select data-fan-input="sensor" aria-label="${escape(channel.name || 'Lüfter')}: Temperaturquelle"><option value="">Aktuelle Quelle auswählen</option></select></label><div class="pc-fan-point-labels" aria-hidden="true"><span>Temperatur °C</span><span>Lüfterleistung %</span></div><div class="pc-fan-points">${draft.points.map((point,index) => `<div class="pc-fan-point"><input data-fan-point="${index}" data-fan-field="temp" type="number" min="0" max="120" step="1" value="${point.temp}" aria-label="Punkt ${index+1}: Temperatur in Grad Celsius"><input data-fan-point="${index}" data-fan-field="duty" type="number" min="${min}" max="${max}" step="1" value="${point.duty}" aria-label="Punkt ${index+1}: Lüfterleistung in Prozent"></div>`).join('')}</div><button type="button" data-fan-action="curve">Temperaturkurve anwenden</button><p class="pc-fan-curve-note">Bei fehlender Temperatur greift die Absicherung des Lüfterdienstes. Nur aktuelle, vom Dienst gemeldete Temperaturen sind auswählbar.</p></details></article>`;
      }).join('');
    }
    const sensors = freshSensors();
    for (const card of channelsHost.querySelectorAll('[data-fan-channel]')) {
      const channel = getChannel(card.dataset.fanChannel), draft = drafts.get(channel.id), {min,max} = bounds(channel);
      card.querySelector('[data-fan-rpm]').textContent = Number.isFinite(channel.rpm) && channel.rpm >= 0 ? `${Math.round(channel.rpm).toLocaleString('de-DE')} RPM` : '— RPM';
      card.querySelector('[data-fan-duty]').textContent = Number.isFinite(channel.duty) ? `Leistung ${Math.round(channel.duty)} %` : 'Leistung —';
      const select = card.querySelector('[data-fan-input="sensor"]');
      const options = '<option value="">Aktuelle Quelle auswählen</option>' + sensors.map(s => `<option value="${escape(s.id)}">${escape(s.name || 'Temperatur')} · ${s.celsius.toLocaleString('de-DE',{maximumFractionDigits:1})} °C</option>`).join('') + (draft.sensorId && !sensors.some(s => s.id === draft.sensorId) ? `<option value="${escape(draft.sensorId)}">Gespeicherte Quelle ist nicht aktuell</option>` : '');
      if (select.innerHTML !== options) {select.innerHTML = options;select.value = draft.sensorId;}
      const canEdit = ready() && !pending && min <= max;
      card.querySelectorAll('input,select,button').forEach(control => {control.disabled = !canEdit;});
      card.querySelector('[data-fan-action="manual"]').disabled = !canEdit || draft.fanConfirmed !== true;
      card.querySelector('[data-fan-action="curve"]').disabled = !canEdit || state?.curveAvailability?.available === false || draft.fanConfirmed !== true || !sensors.some(s => s.id === draft.sensorId);
    }
  }
  function render() {
    const platform = state?.platform || {}, brand = platform.brand === 'asus' ? 'ASUS' : platform.brand === 'msi' ? 'MSI' : 'Mainboard';
    find('brand').textContent = brand;
    find('model').textContent = platform.model || platform.manufacturer || (state ? 'Modell nicht ermittelt' : 'Erkennung wird geladen …');
    find('platform').textContent = platform.kind === 'desktop' ? 'Desktop-PC · automatisch erkannt' : platform.kind === 'portable' ? 'Notebook · PC-Lüftersteuerung nicht verfügbar' : 'Desktop-PC noch nicht bestätigt';
    const enabled = state?.enabled === true, transitional = ['starting','releasing'].includes(state?.phase);
    enabledInput.checked = enabled;
    enabledInput.disabled = pending || transitional || (!enabled && (platform.kind !== 'desktop' || state?.availability?.native !== true));
    enabledInput.setAttribute('aria-label', enabled ? 'PC-Lüftersteuerung ausschalten' : 'PC-Lüftersteuerung einschalten');
    find('toggle-label').textContent = enabled ? 'Ein' : 'Aus';
    find('phase').textContent = phaseNames[state?.phase] || 'Aus';
    find('phase').dataset.phase = state?.phase || 'off';
    find('refresh').disabled = pending || transitional;
    find('release-note').hidden = enabled || state?.releaseVerification !== 'api-only';
    const channels = fanChannels();
    find('curve-availability').hidden = !ready() || channels.length === 0 || (state?.curveAvailability?.available !== false && freshSensors().length > 0);
    let message = state ? state.availability?.reason || '' : 'Die Steuerung ist beim Programmstart ausgeschaltet.';
    if (platform.kind === 'portable') message = 'Dieser Bereich steuert ausschließlich Desktop-PCs. Notebook-Lüfter werden hier nicht angesprochen.';
    else if (platform.kind === 'unknown') message = 'Die PC-Bauart konnte noch nicht sicher erkannt werden. Die Steuerung bleibt ausgeschaltet.';
    else if (ready()) message = channels.length ? `${channels.length} ${channels.length === 1 ? 'steuerbarer Lüfteranschluss' : 'steuerbare Lüfteranschlüsse'} · Änderungen erst mit „Anwenden“ übernehmen.` : 'Keine unterstützten Lüfteranschlüsse gemeldet. Es wird kein Lüfter übernommen.';
    else if (enabled) message = 'Die Übernahme wird geprüft. Beachte den Verbindungsstatus.';
    else if (platform.kind === 'desktop' && state?.releaseVerification === 'api-only') message = 'Batto steuert keine Lüfter. Hardware-Regelung angefordert.';
    else if (platform.kind === 'desktop' && state?.availability?.native && state.availability.requiresElevation) message = 'Aktiviere den Schalter und bestätige die Windows-Abfrage. Batto startet nur seinen Lüfterhelfer mit Administratorrechten und prüft deine Mainboardanschlüsse. iCUE bleibt aktiv. Lüfterleistung erst mit „Anwenden“ ändern.';
    else if (platform.kind === 'desktop' && state?.availability?.native) message = 'Hardware-Regelung bleibt aktiv. Aktiviere Batto, um die unterstützten Lüfteranschlüsse einzustellen.';
    else if (platform.kind === 'desktop' && !message) message = 'Mainboard erkannt. Für diese Anschlüsse ist noch keine unterstützte Steuerung verfügbar.';
    find('status').textContent = lastMessage || message;
    error(state?.error || '');
    renderChannels();
  }
  function update(value) {const next = unwrap(value);if (!next || typeof next !== 'object' || typeof next.phase !== 'string') return;state = next;render();}
  async function request(command, value, message = '') {
    if (pending) return;
    pending = true;lastMessage = '';error('');render();
    try {
      const result = await window.batto.suite(command,value);
      update(result);
      if (!unwrap(result)?.phase) update(await window.batto.suite('fan-control-state'));
      const failedRelease = state?.enabled === true && command === 'fan-control-enable' && value?.enabled === false;
      const releaseRequested = state?.releaseVerification === 'api-only' && command === 'fan-control-enable' && value?.enabled === false;
      lastMessage = state?.error || failedRelease ? '' : releaseRequested ? 'Batto steuert keine Lüfter. Hardware-Regelung angefordert.' : message;
    } catch (cause) {lastMessage = '';error(errorText(cause));throw cause;}
    finally {pending = false;render();}
  }
  function run(work) {Promise.resolve().then(work).catch(cause => error(errorText(cause)));}
  enabledInput.addEventListener('change', () => {
    const enabled = enabledInput.checked;
    if (enabled && (state?.platform?.kind !== 'desktop' || state?.availability?.native !== true)) {render();error('Für dieses System ist keine unterstützte PC-Lüftersteuerung verfügbar.');return;}
    run(() => request('fan-control-enable',{enabled}));
  });
  find('refresh').addEventListener('click', () => run(() => request('fan-control-refresh')));
  channelsHost.addEventListener('input', event => {
    const input = event.target, card = input.closest('[data-fan-channel]');
    if (!card) return;
    const draft = drafts.get(card.dataset.fanChannel);
    if (input.dataset.fanInput === 'range' || input.dataset.fanInput === 'duty') {
      draft.duty = input.value === '' ? null : input.valueAsNumber;
      const partner = card.querySelector(`[data-fan-input="${input.dataset.fanInput === 'range' ? 'duty' : 'range'}"]`);
      if (Number.isFinite(draft.duty)) partner.value = draft.duty;
    } else if (input.dataset.fanField) draft.points[Number(input.dataset.fanPoint)][input.dataset.fanField] = input.value === '' ? null : input.valueAsNumber;
  });
  channelsHost.addEventListener('change', event => {
    const input = event.target, card = input.closest('[data-fan-channel]');
    if (card && input.dataset.fanInput === 'sensor') {drafts.get(card.dataset.fanChannel).sensorId = input.value;renderChannels();}
    else if (card && input.dataset.fanInput === 'confirmed') {drafts.get(card.dataset.fanChannel).fanConfirmed = input.checked === true;renderChannels();}
  });
  channelsHost.addEventListener('click', event => {
    const button = event.target.closest('[data-fan-action]'), card = button?.closest('[data-fan-channel]');
    if (!card || pending) return;
    run(async () => {
      const id = card.dataset.fanChannel, channel = getChannel(id), draft = drafts.get(id);
      if (!channel || !ready()) throw Error('Aktiviere zuerst die verfügbare PC-Lüftersteuerung.');
      if (draft.fanConfirmed !== true) throw Error('Bestätige zuerst, dass an diesem Anschluss ein Lüfter und keine Pumpe angeschlossen ist.');
      const {min,max} = bounds(channel), validDuty = duty => Number.isFinite(duty) && duty >= min && duty <= max;
      if (button.dataset.fanAction === 'manual') {
        if (!Number.isInteger(draft.duty) || !validDuty(draft.duty)) throw Error(`Bitte eine ganze Prozentzahl zwischen ${min} und ${max} % eingeben.`);
        await request('fan-control-manual',{id,duty:draft.duty,fanConfirmed:true});
      } else {
        if (state?.curveAvailability?.available === false) throw Error('Temperaturkurven benötigen bestätigte aktuelle Messwerte. Für diesen Treiber steht hier manuelle Steuerung bereit.');
        if (!freshSensors().some(s => s.id === draft.sensorId)) throw Error('Bitte eine aktuelle Temperaturquelle auswählen.');
        if (draft.points.some(p => !Number.isFinite(p.temp) || p.temp < 0 || p.temp > 120 || !validDuty(p.duty))) throw Error(`Jeden Kurvenpunkt ausfüllen: 0–120 °C und ${min}–${max} % Leistung.`);
        if (draft.points.some((p,index) => index > 0 && (p.temp <= draft.points[index-1].temp || p.duty < draft.points[index-1].duty))) throw Error('Temperaturen müssen ansteigen. Die Lüfterleistung darf dabei nicht abfallen.');
        await request('fan-control-curve',{id,sensorId:draft.sensorId,points:draft.points.map(p => ({temperature:p.temp,duty:p.duty})),fanConfirmed:true});
      }
    });
  });
  host.querySelectorAll('[data-fan-link]').forEach(button => button.addEventListener('click', () => run(() => window.batto.suite('fan-control-link',{kind:button.dataset.fanLink}))));
  window.batto.onSuiteState?.(next => {if (next?.fanControl) update(next.fanControl);});
  document.addEventListener('batto:view', event => {if (event.detail === 'fans') {lastMessage = '';render();}});
  render();
  run(async () => update(await window.batto.suite('fan-control-state')));
})();
