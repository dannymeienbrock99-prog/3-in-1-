(() => {
  'use strict';
  const api = window.batto, active = new Map();
  function testToneUrl() {
    const rate = 22050, count = Math.floor(rate * 0.4);
    const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) {
      const envelope = Math.min(1, i / 400, (count - i) / 800);
      view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 660 * i / rate) * envelope * 0.18 * 32767, true);
    }
    return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  }
  api.onAudioPlay(async payload => {
    if (!payload?.id || active.has(payload.id)) return;
    const audio = new Audio();
    let finished = false, timer, blobUrl, warning = '', deviceId = payload.deviceId || 'default';
    const finish = (ok, error, report = true) => {
      if (finished) return;
      finished = true; clearTimeout(timer); active.delete(payload.id);
      audio.onended = audio.onerror = null;
      audio.pause(); audio.removeAttribute('src'); audio.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (report) api.audioResult({ id: payload.id, ok, error, warning, deviceId });
      if (warning && typeof toast === 'function') toast(warning, true);
    };
    active.set(payload.id, () => finish(false, 'Ton abgebrochen.', false));
    try {
      audio.volume = Math.max(0, Math.min(1, Number(payload.volume ?? 1)));
      if (deviceId !== 'default') {
        if (typeof audio.setSinkId !== 'function') throw new Error('Dieses Ausgabegerät kann in dieser Programmversion nicht angesprochen werden.');
        try { await audio.setSinkId(deviceId); }
        catch (error) {
          if (error.name !== 'NotFoundError') throw new Error('Ausgabegerät konnte nicht geöffnet werden: ' + error.message);
          await audio.setSinkId('');
          warning = 'Das ausgewählte Audiogerät ist nicht verbunden. Der Ton läuft über den Systemstandard.';
          deviceId = 'default';
        }
      }
      if (finished) return;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false, 'Die Tondatei konnte nicht abgespielt werden. Bitte eine unterstützte Audio- oder Videodatei wählen.');
      audio.src = payload.testTone ? (blobUrl = testToneUrl()) : payload.url;
      await audio.play();
      if (!finished && Number(payload.durationSeconds) > 0) timer = setTimeout(() => finish(true), Number(payload.durationSeconds) * 1000);
    } catch (error) { finish(false, error.message || String(error)); }
  });
  api.onAudioCancel(payload => active.get(payload?.id)?.());
  window.addEventListener('beforeunload', () => { for (const stop of [...active.values()]) stop(); });
  api.audioReady();
})();
