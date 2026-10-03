"""Stable input identities and shared-mode capture, without model imports.

Device enumeration/probing never records audio. Opening is explicit and only
tries compatible APIs for the same selected endpoint, never another microphone.
"""
import contextlib
import math
import re
import unicodedata


class InputDeviceError(RuntimeError):
    pass


def _api(api):
    if api is None:
        import sounddevice
        return sounddevice
    return api


def _text(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(value or ''))).strip()


def identity(row):
    return {'name': row['name'], 'hostapi': row['hostapi']}


def _key(name):
    name = _text(name).casefold()
    # WDM Bluetooth names sometimes contain an unresolved Windows resource ID.
    match = re.search(r';\((.+)\)\)$', name)
    if match:
        name = name.split('(', 1)[0].strip() + ' (' + match.group(1) + ')'
    name = re.sub(r'\(\d+-\s*', '(', name)
    name = re.sub(r'\s+hands-free(?=\))', '', name)
    return name


def _rank(row):
    return {'Windows WASAPI': 0, 'MME': 1, 'Windows DirectSound': 2}.get(row['hostapi'], 3)


def _shared(row):
    return row['hostapi'] not in ('Windows WDM-KS', 'ASIO')


def _matches(reference, rows):
    """Match API aliases conservatively; identical physical model names are ambiguous."""
    exact = [r for r in rows if _text(r['name']).casefold() == _text(reference['name']).casefold()]
    key = _key(reference['name'])
    equivalent = [r for r in rows if _key(r['name']) == key]
    # Windows numbers repeated USB endpoints; only drop that instance number
    # when each API has at most one matching endpoint.
    counts = {}
    for row in equivalent:
        counts[row['hostapi']] = counts.get(row['hostapi'], 0) + 1
    safe = [r for r in equivalent if counts[r['hostapi']] == 1]
    if any(count > 1 for count in counts.values()):
        safe = []
    matches = {r['index']: r for r in exact + safe}
    # MME device names are truncated to 31 characters. Only accept a prefix
    # when it resolves to one endpoint per other API, never between siblings.
    if reference['hostapi'] == 'MME' and len(_text(reference['name'])) >= 30:
        prefix = _key(reference['name'])
        longer = [r for r in rows if r['hostapi'] != 'MME' and _key(r['name']).startswith(prefix)]
        for api in {r['hostapi'] for r in longer}:
            same_api = [r for r in longer if r['hostapi'] == api]
            if len(same_api) == 1:
                matches[same_api[0]['index']] = same_api[0]
    else:
        for row in rows:
            if row['hostapi'] != 'MME' or len(_text(row['name'])) < 30:
                continue
            prefix = _key(row['name'])
            full = [r for r in rows if r['hostapi'] == reference['hostapi'] and _key(r['name']).startswith(prefix)]
            if key.startswith(prefix) and len(full) == 1:
                matches[row['index']] = row
    return sorted(matches.values(), key=lambda r: (_rank(r), r['index']))


def inventory(api=None):
    api = _api(api)
    try:
        apis = api.query_hostapis()
        devices = api.query_devices()
    except Exception as exc:
        raise InputDeviceError('Windows konnte die Mikrofone nicht auflisten. Prüfe die Audiogeräte und verbinde das USB-Gerät erneut.') from exc
    rows = []
    for index, device in enumerate(devices):
        if int(device.get('max_input_channels', 0)) <= 0:
            continue
        host = apis[device['hostapi']]
        rate = float(device.get('default_samplerate', 0))
        rows.append({'index': index, 'name': _text(device['name']), 'hostapi': _text(host['name']),
            'channels': int(device['max_input_channels']),
            'defaultSamplerate': int(rate) if math.isfinite(rate) and rate > 0 else 48000,
            'default': host.get('default_input_device') == index})
    return rows


def _options(row, api):
    rates = list(dict.fromkeys([row['defaultSamplerate'], 48000, 44100, 16000]))
    channels = [1] + ([2] if row['channels'] >= 2 else [])
    extra = api.WasapiSettings(exclusive=False, auto_convert=True) if row['hostapi'] == 'Windows WASAPI' else None
    for count in channels:
        for rate in rates:
            args = {'device': row['index'], 'channels': count, 'dtype': 'int16', 'samplerate': rate}
            if extra is not None:
                args['extra_settings'] = extra
            try:
                api.check_input_settings(**args)
            except Exception:
                continue
            yield args


def device_list(api=None, probe=True):
    """Include every input; unsafe kernel-only and ambiguous entries stay visible."""
    api = _api(api)
    rows = inventory(api)
    probed = {}
    result = []
    for row in rows:
        duplicate = sum(identity(other) == identity(row) for other in rows) > 1
        compatible = [other for other in _matches(row, rows) if _shared(other)]
        available = bool(compatible) and not duplicate
        if available and probe:
            for other in compatible:
                if other['index'] not in probed:
                    probed[other['index']] = next(_options(other, api), None) is not None
            available = any(probed[other['index']] for other in compatible)
        reason = ''
        if duplicate:
            reason = 'Mehrere Eingänge haben denselben Namen. Benenne sie in den Windows-Soundeinstellungen eindeutig.'
        elif not compatible:
            reason = 'Nur ein exklusiver Kernel-Treiber ist vorhanden. Aktiviere das Mikrofon in Windows für den gemeinsamen Betrieb.'
        elif not available:
            reason = 'Windows meldet kein unterstütztes Aufnahmeformat. Prüfe Mikrofonzugriff und Geräteeinstellungen.'
        elif not _shared(row):
            reason = 'Wird über ' + compatible[0]['hostapi'] + ' im gemeinsamen Betrieb verwendet.'
        result.append({**row, 'available': available, 'recommended': row['hostapi'] == 'Windows WASAPI' and available, 'reason': reason})
    return sorted(result, key=lambda r: (not r['available'], _rank(r), r['name'].casefold(), r['index']))


def candidates(saved, api=None):
    api = _api(api)
    rows = inventory(api)
    if not rows:
        raise InputDeviceError('Windows meldet kein Mikrofon. Verbinde einen Eingang und aktiviere ihn in den Soundeinstellungen.')
    explicit = isinstance(saved, dict)
    if saved is None:
        defaults = sorted([r for r in rows if r['default']], key=_rank)
        if not defaults:
            raise InputDeviceError('Windows hat kein Standardmikrofon. Wähle einen Eingang in Jarvis oder in den Windows-Soundeinstellungen.')
        reference = defaults[0]
    elif isinstance(saved, int) and not isinstance(saved, bool):
        reference = next((r for r in rows if r['index'] == saved), None)
        if reference is None:
            raise InputDeviceError('Die alte Mikrofonnummer gehört nicht mehr zu einem Eingang. Wähle dein Mikrofon erneut; anschließend wird sein Name gespeichert.')
    elif explicit and isinstance(saved.get('name'), str) and isinstance(saved.get('hostapi'), str):
        exact = [r for r in rows if identity(r) == {'name': _text(saved['name']), 'hostapi': _text(saved['hostapi'])}]
        if len(exact) > 1:
            raise InputDeviceError('Mehrere Mikrofone haben denselben Namen und Treiber. Benenne sie in den Windows-Soundeinstellungen eindeutig.')
        reference = exact[0] if exact else {'index': -1, 'name': _text(saved['name']), 'hostapi': _text(saved['hostapi'])}
    else:
        raise InputDeviceError('Die gespeicherte Mikrofonwahl ist ungültig. Wähle den Eingang erneut.')
    matching = _matches(reference, rows)
    matching = [row for row in matching if _shared(row)]
    # Do not use ambiguous duplicates merely because their current list index differs.
    matching = [row for row in matching if sum(identity(other) == identity(row) for other in rows) == 1]
    if not matching:
        if reference['hostapi'] in ('Windows WDM-KS', 'ASIO'):
            raise InputDeviceError('Für dieses Mikrofon fehlt ein gemeinsamer Windows-Audiozugang. Aktiviere es in Windows oder wähle seinen WASAPI-/MME-Eintrag. Der exklusive Kernel-Treiber wird nicht geöffnet.')
        raise InputDeviceError('Das gewählte Mikrofon ist nicht eindeutig verbunden. Wähle den Eingang erneut. Es wird kein anderes Mikrofon automatisch verwendet.')
    if explicit and _shared(reference):
        matching.sort(key=lambda row: (row['index'] != reference['index'], _rank(row), row['index']))
    return matching


@contextlib.contextmanager
def open_input(saved, callback, api=None, cancelled=None):
    """Open shared input explicitly; release failed attempts before any fallback."""
    api = _api(api)
    selected = candidates(saved, api)
    last_error = None
    for row in selected:
        attempts = 0
        for args in _options(row, api):
            if cancelled is not None and cancelled.is_set():
                raise InterruptedError('Mikrofonstart abgebrochen.')
            stream = None
            try:
                stream = api.RawInputStream(**args, blocksize=0, latency='high', callback=callback)
                stream.start()
            except Exception as exc:
                last_error = exc
                if stream is not None:
                    try: stream.close()
                    except Exception: pass
                attempts += 1
                if attempts >= 4:
                    break
                continue
            try:
                yield stream, {**row, 'samplerate': args['samplerate'], 'captureChannels': args['channels']}
            finally:
                try: stream.stop()
                finally: stream.close()
            return
    raise InputDeviceError('Das Mikrofon „' + selected[0]['name'] + '“ konnte nicht geöffnet werden. Prüfe den Windows-Mikrofonzugriff für Desktop-Apps und ob ein anderes Programm das Gerät exklusiv belegt. Es wurde kein anderes Mikrofon gewählt.') from last_error
