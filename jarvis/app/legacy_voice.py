"""Offline audio input and explicitly selected offline speech output."""
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
import numpy as np
import sounddevice as sd
import soundfile as sf
from config import ROOT, MODELS, DATA

class Microphone(threading.Thread):
    def __init__(self, settings, busy, on_text, on_state, on_error):
        super().__init__(daemon=True, name='Lokales Mikrofon')
        self.settings = settings
        self.busy = busy
        self.on_text, self.on_state, self.on_error = on_text, on_state, on_error
        self.quit = threading.Event()
        self.record = threading.Event()
        self.cancel_record = threading.Event()
        self.amplitude = 0.0
        self._whisper = None

    def request(self):
        self.cancel_record.clear()
        self.record.set()

    def stop(self):
        self.quit.set()
        self.cancel_record.set()

    def transcribe(self, samples):
        if self._whisper is None:
            from faster_whisper import WhisperModel
            self._whisper = WhisperModel(str(MODELS / 'whisper-small'), device='cpu',
                compute_type='int8', cpu_threads=6, local_files_only=True)
        segments, _ = self._whisper.transcribe(samples, language='de', beam_size=3,
                    vad_filter=True, condition_on_previous_text=False)
        text = ' '.join(s.text.strip() for s in segments).strip()
        return re.sub(r'^(?:hey\s+)?(?:jarvis|javis|jarwis)[, .!?]*', '', text,
                      flags=re.I).strip()

    def run(self):
        try:
            import vosk
            vosk.SetLogLevel(-1)
            wake_model = vosk.Model(str(MODELS / 'vosk-wake-en'))
            rec = vosk.KaldiRecognizer(wake_model, 16000,
                                      json.dumps(['jarvis', 'javis', '[unk]']))
            audio_q = queue.Queue(maxsize=60)
            def callback(indata, frames, timing, status):
                try:
                    audio_q.put_nowait(bytes(indata))
                except queue.Full:
                    pass
            with sd.RawInputStream(samplerate=16000, blocksize=1600, dtype='int16',
                    channels=1, device=self.settings.get('microphone'), callback=callback):
                self.on_state('idle', 'Mikrofon bereit')
                frames = []
                pre = []
                capture = False
                heard = False
                silence = 0
                started = 0
                while not self.quit.is_set():
                    try:
                        raw = audio_q.get(timeout=.3)
                    except queue.Empty:
                        continue
                    samples = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
                    rms = float(np.sqrt(np.mean(samples * samples)))
                    self.amplitude = min(1.0, rms * 12)
                    if self.busy.is_set():
                        frames.clear(); pre.clear(); capture = False
                        self.record.clear(); rec.Reset()
                        continue
                    if self.cancel_record.is_set():
                        capture = False; frames.clear(); self.record.clear()
                        self.cancel_record.clear(); rec.Reset()
                        self.on_state('idle', 'Aufnahme abgebrochen')
                        continue
                    if not capture:
                        pre.append(raw)
                        pre = pre[-5:]
                        wake = False
                        if self.settings.get('wake_word'):
                            final = rec.AcceptWaveform(raw)
                            result = json.loads(rec.Result() if final else rec.PartialResult())
                            wake = any(w in result.get('text', result.get('partial', '')).split()
                                       for w in ('jarvis', 'javis'))
                        if self.record.is_set() or wake:
                            self.record.clear(); rec.Reset()
                            capture = True; frames = list(pre); heard = False; silence = 0
                            started = time.monotonic()
                            self.on_state('listening', 'Ich höre zu …')
                        continue
                    frames.append(raw)
                    if rms > .008:
                        heard = True; silence = 0
                    else:
                        silence += .1
                    elapsed = time.monotonic() - started
                    if elapsed >= 25 or (heard and silence >= 1.1 and elapsed > .8) or (not heard and elapsed >= 7):
                        capture = False
                        if not heard:
                            frames.clear()
                            self.on_state('idle', 'Keine Sprache erkannt')
                            continue
                        self.on_state('thinking', 'Sprache wird lokal erkannt …')
                        audio = np.frombuffer(b''.join(frames), np.int16).astype(np.float32) / 32768
                        frames.clear()
                        text = self.transcribe(audio)
                        if not self.cancel_record.is_set() and not self.quit.is_set():
                            if text:
                                # Reserve the turn before the GUI receives it, preventing echo/races.
                                self.busy.set()
                                self.on_text(text)
                            else:
                                self.on_state('idle', 'Keine verständliche Sprache erkannt')
                        self.cancel_record.clear()
                        while not audio_q.empty():
                            try: audio_q.get_nowait()
                            except queue.Empty: break
                        rec.Reset()
        except Exception as exc:
            self.on_error('Mikrofon/Spracherkennung: ' + str(exc))
        finally:
            self.amplitude = 0.0


def sapi_voices():
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    try:
        speaker = win32com.client.Dispatch('SAPI.SpVoice')
        return [(v.Id, v.GetDescription(), v.GetAttribute('Language')) for v in speaker.GetVoices()]
    finally:
        pythoncom.CoUninitialize()


class Speaker:
    def __init__(self):
        self.process = None
        self.lock = threading.Lock()
        self.amplitude = 0.0

    def stop(self):
        sd.stop()
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
        self.process = None
        self.amplitude = 0.0

    def _worker(self):
        if self.process is None or self.process.poll() is not None:
            exe = ROOT / 'voice-runtime' / 'Scripts' / 'python.exe'
            if not exe.exists():
                raise RuntimeError('Die lokale Stimm-Laufzeit fehlt.')
            log = (DATA / 'voice.log').open('ab')
            try:
                self.process = subprocess.Popen([str(exe), '-u', str(ROOT / 'app' / 'tts_worker.py')],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                    encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW, cwd=ROOT)
            finally:
                log.close()
        return self.process

    def speak(self, text, settings, cancel, on_state):
        mode = settings.get('tts', 'silent')
        if mode == 'silent' or cancel.is_set():
            return
        if mode == 'sapi':
            self._sapi(text, settings, cancel, on_state)
            return
        reference = ROOT / settings.get('reference', '')
        if not settings.get('reference') or not reference.is_file():
            raise RuntimeError('Stimmvorlage fehlt. Unter Einstellungen eine WAV-Aufnahme auswählen.')
        with self.lock:
            worker = self._worker()
            clean = re.sub(r'```.*?```', ' Code steht im Chat. ', text, flags=re.S)
            clean = re.sub(r'[*#`_]', '', clean)
            # Short sentences reduce latency and avoid the model's generation length limit.
            sentences = re.split(r'(?<=[.!?])\s+', clean)
            chunks = []
            for sentence in sentences:
                words = sentence.split()
                while words:
                    chunks.append(' '.join(words[:35]))
                    words = words[35:]
            for sentence in chunks:
                if cancel.is_set(): break
                on_state('thinking', 'Stimme wird lokal erzeugt …')
                job = {'text': sentence, 'reference': str(reference)}
                worker.stdin.write(json.dumps(job, ensure_ascii=False) + '\n')
                worker.stdin.flush()
                line = worker.stdout.readline()
                if not line:
                    if cancel.is_set(): break
                    raise RuntimeError('Stimmprozess wurde beendet. Details in data/voice.log.')
                result = json.loads(line)
                if result.get('error'):
                    raise RuntimeError(result['error'])
                path = Path(result['path'])
                try:
                    samples, rate = sf.read(path, dtype='float32')
                    if cancel.is_set(): break
                    on_state('speaking', 'Jarvis spricht · lokale Stimmnachbildung')
                    sd.play(samples, rate)
                    duration = len(samples) / rate
                    began = time.monotonic()
                    while time.monotonic() - began < duration and not cancel.is_set():
                        i = int((time.monotonic() - began) * rate)
                        piece = samples[i:i+int(rate*.05)]
                        self.amplitude = min(1., float(np.sqrt(np.mean(piece**2))) * 7) if len(piece) else 0.
                        time.sleep(.04)
                    sd.stop()
                finally:
                    path.unlink(missing_ok=True)
                    self.amplitude = 0.

    def _sapi(self, text, settings, cancel, on_state):
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            speaker = win32com.client.Dispatch('SAPI.SpVoice')
            choices = list(speaker.GetVoices())
            selected = next((v for v in choices if v.Id == settings.get('voice')), None)
            if selected is None:
                selected = next((v for v in choices if '407' in v.GetAttribute('Language').lower()), None)
            if selected is None:
                raise RuntimeError('Keine deutsche Windows-Stimme installiert.')
            speaker.Voice = selected
            speaker.Rate = 0
            def current_volume():
                return 0 if settings.get('speech_muted') else round(max(0., min(100., float(settings.get('speech_volume', 100)))))
            speaker.Volume = current_volume()
            on_state('speaking', 'Windows-Teststimme · nicht die Filmstimme')
            speaker.Speak(text, 1)
            while not speaker.WaitUntilDone(80):
                speaker.Volume = current_volume()
                self.amplitude = .35 * speaker.Volume / 100.
                if cancel.is_set():
                    speaker.Speak('', 3)
                    break
        finally:
            self.amplitude = 0.
            pythoncom.CoUninitialize()
