"""Persistent local recognition and bounded, streamed speech output."""
import audioop
import base64
import json
import logging
import queue
import re
import threading
import time
from collections import deque
from pathlib import Path
import numpy as np
import sounddevice as sd
import soundfile as sf
from config import ROOT, MODELS, DATA, reference_path
from worker_rpc import Worker
from legacy_voice import sapi_voices
from audio_devices import device_list, candidates, open_input

def input_devices():
    return [(row['index'], {key:value for key,value in row.items() if key!='index'})
            for row in device_list(sd, probe=False)]

def preferred_devices():
    """Show all inputs, preferring shared WASAPI without hiding USB/virtual devices."""
    return [(row['index'], {key:value for key,value in row.items() if key!='index'})
            for row in device_list(sd)]

def resolve_device(saved):
    return candidates(saved, sd)[0]['index']

class StreamingVAD:
    def __init__(self):
        from faster_whisper.vad import get_vad_model
        self.session = get_vad_model().session
        self.h = np.zeros((1, 1, 128), np.float32); self.c = self.h.copy()
        self.context = np.zeros((1, 64), np.float32)
        self.pending = np.zeros(0, np.float32)

    def speech(self, samples):
        self.pending = np.concatenate((self.pending, samples)); peak = 0.
        while len(self.pending) >= 512:
            chunk, self.pending = self.pending[:512], self.pending[512:]
            data = np.concatenate((self.context, chunk.reshape(1, -1)), axis=1)
            out, self.h, self.c = self.session.run(None, {'input': data, 'h': self.h, 'c': self.c})
            self.context = chunk[-64:].reshape(1, -1)
            peak = max(peak, float(out.ravel()[0]))
        return peak > .5

class Microphone(threading.Thread):
    def __init__(self, settings, busy, on_text, on_state, on_error, on_interrupt=None, recognizer=None, speaker=None, on_backend=None, on_ready=None, on_device=None):
        super().__init__(daemon=True, name='Jarvis Audioaufnahme')
        self.settings, self.busy = settings, busy
        self.on_text, self.on_state, self.on_error = on_text, on_state, on_error
        self.on_ready = on_ready or (lambda text: self.on_state('idle', text))
        self.on_device = on_device or (lambda device: None)
        self.on_interrupt = on_interrupt or (lambda: None)
        self.quit = threading.Event(); self.record = threading.Event(); self.cancel_record = threading.Event()
        self.amplitude = 0.; self.dropped = 0
        self.recognizer = recognizer or Worker('stt_worker.py', timeout=30)
        self.decoding = threading.Event(); self.decode_cancel = threading.Event()
        self.connected=threading.Event(); self.speaker=speaker;self.on_backend=on_backend or (lambda value:None)

    def request(self):
        # Keep an outstanding cancellation until the audio thread has cleared
        # the previous capture, then begin the explicitly requested new turn.
        self.record.set()

    def cancel_turn(self):
        self.record.clear(); self.cancel_record.set(); self.decode_cancel.set()

    def stop(self):
        self.quit.set(); self.decode_cancel.set()

    def decode(self, raw, require_wake=False):
        self.decoding.set(); self.decode_cancel.clear()
        def task():
            try:
                result = self.recognizer.call({'audio': base64.b64encode(raw).decode()}, self.decode_cancel)
                if result.get('backend'):self.on_backend(result['backend'])
                text = result.get('text', '').strip()
                prefix = re.match(r'^(?:hey\s+)?(?:jarvis|javis|dschavis)\b[,.:!\s]*', text, flags=re.I)
                if prefix:text=text[prefix.end():].strip()
                if not self.quit.is_set() and not self.decode_cancel.is_set():
                    if require_wake and not result.get('wake_detected'):
                        self.on_state('idle','Aktivierung nicht bestätigt · sage „Jarvis“ oder drücke Sprechen')
                    elif text:
                        # Suite command routing distinguishes "Jarvis leiser"
                        # (his voice) from "leiser" (Windows sound). Preserve
                        # that address while leaving the legacy Desktop unchanged.
                        addressed = self.settings.get('preserve_wake_word') and (result.get('wake_detected') or prefix)
                        self.busy.set(); self.on_text(('Jarvis ' if addressed else '')+text)
                    elif require_wake and result.get('wake_detected'):
                        self.record.set();self.on_state('listening','Ich höre zu …')
                    else:
                        self.on_state('idle', 'Kein Auftrag erkannt · bitte erneut sprechen')
            except InterruptedError: pass
            except Exception as exc:
                if not self.quit.is_set(): self.on_error('Spracherkennung: ' + str(exc))
            finally: self.decoding.clear()
        threading.Thread(target=task, daemon=True, name='Jarvis Spracherkennung').start()

    def run(self):
        try:
            audio_q = queue.Queue(maxsize=8)
            def callback(indata, frames, timing, status):
                if status: self.dropped += 1
                try: audio_q.put_nowait(bytes(indata))
                except queue.Full:
                    try: audio_q.get_nowait()
                    except queue.Empty: pass
                    self.dropped += 1; audio_q.put_nowait(bytes(indata))
            # Validate/open the device before loading recognition models. A bad
            # driver selection should fail quickly and consume no model memory.
            with open_input(self.settings.get('microphone'),callback,sd,self.quit) as (_, info):
                rate=info['samplerate'];channels=info['captureChannels']
                self.connected.set()
                self.on_device(info)
                ambient=self.settings.get('ambient',not self.settings.get('preserve_wake_word'))
                wake_active=bool(self.settings.get('wake_word') and ambient)
                wake_rec=stop_rec=None
                if wake_active or ambient:
                    import vosk
                    vosk.SetLogLevel(-1)
                    if wake_active:
                        wake_model=vosk.Model(str(MODELS/'vosk-wake-en'))
                        wake_rec=vosk.KaldiRecognizer(wake_model,16000,json.dumps(['jarvis','hey jarvis','[unk]']))
                    german=next(MODELS.glob('vosk-model-small-de*'),None)
                    if german:stop_rec=vosk.KaldiRecognizer(vosk.Model(str(german)),16000,json.dumps(['stopp','stop','abbrechen','[unk]']))
                vad=StreamingVAD()
                if self.quit.is_set():return
                self.on_ready('Mikrofon bereit: ' + info['name'])
                frames, pre = [], deque(maxlen=40)
                capture = heard = was_busy = False
                silence = elapsed = cooldown = 0.; resample_state = None; last_frame=time.monotonic()
                while not self.quit.is_set():
                    try: raw = audio_q.get(timeout=.15)
                    except queue.Empty:
                        if time.monotonic()-last_frame>4:raise RuntimeError('Das Mikrofon liefert keine Audiodaten. Verbindung prüfen und Mikrofon erneut einschalten.')
                        continue
                    last_frame=time.monotonic()
                    if channels==2:raw=audioop.tomono(raw,2,.5,.5)
                    raw, resample_state = audioop.ratecv(raw, 2, 1, rate, 16000, resample_state)
                    if not raw: continue
                    samples = np.frombuffer(raw, '<i2').astype(np.float32)/32768; dt = len(samples)/16000
                    self.amplitude = min(1., float(np.sqrt(np.mean(samples*samples)))*12)
                    speech = vad.speech(samples); busy = self.busy.is_set()
                    if busy != was_busy:
                        if wake_rec:wake_rec.Reset()
                        if stop_rec: stop_rec.Reset()
                        frames.clear(); pre.clear(); capture = False
                        cooldown = time.monotonic() + (.25 if not busy else 0); was_busy = busy
                    if self.cancel_record.is_set():
                        self.cancel_record.clear(); capture = False; frames.clear(); self.decode_cancel.set()
                    if busy:
                        if stop_rec:
                            final = stop_rec.AcceptWaveform(raw)
                            data = json.loads(stop_rec.Result() if final else stop_rec.PartialResult())
                            words = data.get('text', data.get('partial', '')).split()
                            commands=set(words)&{'stopp','stop','abbrechen'}
                            # Avoid self-interruption when Jarvis itself says the stop word.
                            # This is a narrow echo guard, not general acoustic echo cancellation.
                            if self.speaker and not self.settings.get('headphones') and time.monotonic()<self.speaker.echo_until:
                                own=set(re.findall(r'\w+',self.speaker.spoken_text.casefold()))
                                commands-=own
                            if commands:
                                stop_rec.Reset(); self.on_interrupt()
                        continue
                    if self.decoding.is_set() or time.monotonic() < cooldown: continue
                    if not capture:
                        pre.append(raw); wake = False
                        if wake_rec:
                            final = wake_rec.AcceptWaveform(raw)
                            data = json.loads(wake_rec.Result() if final else wake_rec.PartialResult())
                            wake = any(w in data.get('text', data.get('partial', '')).split() for w in ('jarvis', 'javis'))
                        if self.record.is_set() or wake or (self.settings.get('continuous') and speech):
                            self.record.clear()
                            if wake_rec:wake_rec.Reset()
                            capture = True; frames = list(pre); heard = False; silence = elapsed = 0.
                            wake_capture=wake
                            if wake:
                                def acknowledge():
                                    try:
                                        import winsound
                                        winsound.Beep(920,70)
                                    except RuntimeError:pass
                                threading.Thread(target=acknowledge,daemon=True).start()
                            self.on_state('listening', 'Ich höre zu …')
                        continue
                    frames.append(raw); elapsed += dt
                    if speech: heard = True; silence = 0.
                    else: silence += dt
                    if elapsed >= 25 or (heard and elapsed >= (1.4 if wake_capture else .3) and silence >= float(self.settings.get('end_silence', .65))) or (not heard and elapsed >= 7):
                        capture = False
                        if heard:
                            self.on_state('thinking', 'Sprache wird erkannt …'); self.decode(b''.join(frames),require_wake=wake_capture)
                        else: self.on_state('idle', 'Keine Sprache erkannt · erneut sprechen')
                        frames.clear(); pre.clear()
        except Exception as exc:
            logging.exception('Microphone failed')
            if not self.quit.is_set(): self.on_error('Mikrofon: ' + str(exc))
        finally: self.amplitude = 0.; self.connected.clear()

def speech_text(text):
    text = text.split('\n\nAbgerufene Quellen:')[0]
    text = re.sub(r'```.*?```', ' Der Code steht im Chat. ', text, flags=re.S)
    text = re.sub(r'https?://\S+', ' Link im Chat ', text)
    text = re.sub(r'(?im)\b[A-Z]:[\\/][^\n]+', ' Die Datei findest du unter Ergebnisse. ', text)
    return re.sub(r'[*#`_]|\[\d+\]', '', text).strip()

class Speaker:
    def __init__(self):
        self.piper = Worker('piper_worker.py', 25)
        self.clone = Worker('tts_worker.py', 40, str(ROOT / 'voice-runtime/Scripts/python.exe'))
        self.lock = threading.Lock(); self.amplitude = 0.
        self.spoken_text=''; self.echo_until=0.; self.text_by_path={}; self.output_settings={}

    def warmup(self): return self.piper.call({'warmup': True}, timeout=30)

    def stop(self):
        sd.stop(); self.amplitude = 0.

    def close(self):
        self.stop(); self.piper.stop(); self.clone.stop()

    def synthesize(self, text, settings, cancel):
        if settings.get('tts') == 'chatterbox':
            try: return self.clone.call({'text': text, 'reference': str(reference_path(settings.get('reference')))}, cancel)
            except InterruptedError: raise
            except Exception:
                logging.exception('Chatterbox failed; using local Piper fallback'); self.clone.stop()
        result=self.piper.call({'text': text, 'style': settings.get('voice_style', 'controlled'),
                               'rate': settings.get('speech_rate', 160)}, cancel)
        self.text_by_path[result['path']]=text
        return result

    def play(self, path, cancel, on_state):
        path = Path(path)
        try:
            samples, rate = sf.read(path, dtype='float32')
            if cancel.is_set(): return
            self.spoken_text=self.text_by_path.pop(str(path),'')
            self.echo_until=time.monotonic()+len(samples)/rate+.4
            on_state('speaking', 'Jarvis spricht · Stopp zum Unterbrechen')
            # Apply the current gain per audio block, including changes during speech.
            frames = samples.reshape(-1, 1) if samples.ndim == 1 else samples
            cursor = 0; finished = threading.Event()
            def output(outdata, count, timing, status):
                nonlocal cursor
                outdata.fill(0)
                if cancel.is_set(): raise sd.CallbackStop
                piece = frames[cursor:cursor+count]
                gain = 0. if self.output_settings.get('speech_muted') else max(0., min(1., float(self.output_settings.get('speech_volume', 100))/100.))
                outdata[:len(piece)] = piece * gain
                cursor += len(piece)
                self.amplitude = min(1., float(np.sqrt(np.mean(piece**2)))*7*gain) if len(piece) else 0.
                if len(piece) < count: raise sd.CallbackStop
            with sd.OutputStream(samplerate=rate, channels=frames.shape[1], dtype='float32', callback=output, finished_callback=finished.set):
                while not finished.wait(.025) and not cancel.is_set(): pass
        finally:
            path.unlink(missing_ok=True); self.amplitude = 0.; self.echo_until=time.monotonic()+.4
            self.text_by_path.pop(str(path),None)

    def speak(self, text, settings, cancel, on_state):
        if settings.get('tts') == 'silent' or cancel.is_set(): return
        clean = speech_text(text)
        self.output_settings = settings
        if not clean: return
        if settings.get('tts') == 'sapi':
            from legacy_voice import Speaker as Legacy
            Legacy._sapi(self, clean, settings, cancel, on_state); return
        with self.lock:
            for sentence in re.split(r'(?<=[.!?])\s+|\n+', clean):
                words = sentence.split()
                for start in range(0, len(words), 40):
                    if cancel.is_set(): return
                    result = self.synthesize(' '.join(words[start:start+40]), settings, cancel)
                    self.play(result['path'], cancel, on_state)

class SpeechStream:
    """Bounded sentence queue fed before the LLM has finished its answer."""
    def __init__(self, speaker, settings, cancel, on_state):
        # Keep the same live dictionary as the service: queued audio must follow gain changes too.
        self.speaker, self.settings, self.cancel, self.on_state = speaker, settings, cancel, on_state
        self.speaker.output_settings = settings
        self.buffer = ''; self.queue = queue.Queue(maxsize=24); self.error = ''; self.closed = False
        self.thread = threading.Thread(target=self.run, daemon=True, name='Jarvis Sprachausgabe'); self.thread.start()

    def feed(self, token):
        if self.closed or self.cancel.is_set(): return
        self.buffer += token
        while True:
            match = re.search(r'(?<=[.!?])\s+|\n', self.buffer)
            if match: cut = match.end()
            elif len(self.buffer)>240: cut = self.buffer.rfind(' ', 0, 220)
            else: break
            if cut <= 0: break
            piece, self.buffer = self.buffer[:cut].strip(), self.buffer[cut:]
            if piece: self.put(piece)

    def put(self, piece):
        while not self.cancel.is_set() and not self.error:
            try: self.queue.put(piece, timeout=.05); return
            except queue.Full: continue

    def finish(self):
        if self.closed: return
        if self.buffer.strip(): self.put(self.buffer.strip())
        self.closed = True; self.put(None)

    def run(self):
        ready=queue.Queue(maxsize=2)
        producer_done=threading.Event()
        def produce():
            try:
                while not self.cancel.is_set():
                    try: text=self.queue.get(timeout=.05)
                    except queue.Empty: continue
                    if text is None: break
                    clean=speech_text(text)
                    if not clean or self.settings.get('tts')=='silent': continue
                    if self.settings.get('tts')=='sapi':
                        value=('text',clean)
                    else:
                        value=('path',self.speaker.synthesize(clean,self.settings,self.cancel)['path'])
                    delivered=False
                    while not self.cancel.is_set():
                        try: ready.put(value,timeout=.05); delivered=True; break
                        except queue.Full: continue
                    if not delivered and value[0]=='path': Path(value[1]).unlink(missing_ok=True)
            except InterruptedError: pass
            except Exception as exc:
                logging.exception('Speech generation failed'); self.error=str(exc)
            finally: producer_done.set()
        producer=threading.Thread(target=produce,daemon=True,name='Jarvis Sprachvorbereitung'); producer.start()
        try:
            while not self.cancel.is_set():
                try: kind,value=ready.get(timeout=.05)
                except queue.Empty:
                    if producer_done.is_set(): break
                    continue
                if kind=='path': self.speaker.play(value,self.cancel,self.on_state)
                else: self.speaker.speak(value,self.settings,self.cancel,self.on_state)
        except Exception as exc:
            logging.exception('Speech playback failed'); self.error=str(exc); self.cancel.set()
        finally:
            producer.join(1.)
            while not ready.empty():
                try:
                    kind,value=ready.get_nowait()
                    if kind=='path': Path(value).unlink(missing_ok=True)
                except queue.Empty: break

    def wait(self,timeout=240):
        deadline = time.monotonic()+timeout
        while self.thread.is_alive() and not self.cancel.is_set() and time.monotonic()<deadline:
            self.thread.join(.05)
        if self.thread.is_alive():
            self.cancel.set(); self.speaker.stop()
            self.thread.join(1.2)
            if time.monotonic() >= deadline: self.error = 'Sprachausgabe nach Zeitlimit beendet.'
