"""Run real speech callbacks with audio/COM doubles; never open hardware or models."""
import ast
import logging
import math
import queue
import re
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

APP = Path(__file__).resolve().parents[1] / 'app'


class Samples:
    """The small array subset used by the playback callback, without a NumPy dependency."""
    def __init__(self, values):
        self.values = values
        self.ndim = 2 if values and isinstance(values[0], list) else 1
        self.shape = (len(values), len(values[0])) if self.ndim == 2 else (len(values),)

    def __len__(self): return len(self.values)
    def reshape(self, rows, channels): return Samples([[value] for value in self.values])
    def __getitem__(self, item): return Samples(self.values[item])
    def __setitem__(self, item, value): self.values[item] = value.values
    def __mul__(self, gain):
        return Samples([[value * gain for value in row] for row in self.values] if self.ndim == 2 else [value * gain for value in self.values])
    def __pow__(self, power):
        return Samples([[value ** power for value in row] for row in self.values] if self.ndim == 2 else [value ** power for value in self.values])
    def fill(self, value):
        self.values = [[value for _ in row] for row in self.values]


def mean(samples):
    values = [value for row in samples.values for value in row] if samples.ndim == 2 else samples.values
    return sum(values) / len(values)


class FakeAudio:
    class CallbackStop(Exception): pass

    def __init__(self):
        self.blocks = []
        self.before_block = lambda index: None
        self.opened = 0
        self.closed = 0

    def stop(self): pass

    def OutputStream(self, **options):
        audio = self

        class Stream:
            def __enter__(self):
                audio.opened += 1
                for index in range(50):
                    audio.before_block(index)
                    output = Samples([[123.] * options['channels'] for _ in range(4)])
                    stopped = False
                    try: options['callback'](output, 4, None, None)
                    except audio.CallbackStop: stopped = True
                    audio.blocks.append(output.values)
                    if stopped:
                        options['finished_callback']()
                        return self
                raise AssertionError('Audio callback did not finish')

            def __exit__(self, *ignored): audio.closed += 1

        return Stream()


def load_classes(filename, names, scope):
    source = APP / filename
    tree = ast.parse(source.read_text(encoding='utf-8'))
    tree.body = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name in names]
    exec(compile(tree, str(source), 'exec'), scope)
    return scope


class SpeechGainTests(unittest.TestCase):
    def setup_voice(self, values=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        wav = Path(temporary.name) / 'speech.wav'
        wav.write_bytes(b'Audio fixture, not played')
        audio = FakeAudio()

        class Worker:
            def __init__(self, *ignored): pass
            def call(self, *ignored, **kwargs): return {'path': str(wav)}
            def stop(self): pass

        scope = dict(Path=Path, ROOT=Path(temporary.name), Worker=Worker, threading=threading,
                     queue=queue, time=time, re=re, logging=logging, sd=audio,
                     sf=types.SimpleNamespace(read=lambda *args, **kwargs: (Samples(values or [1.] * 16), 16000)),
                     np=types.SimpleNamespace(sqrt=math.sqrt, mean=mean))
        load_classes('voice.py', {'Speaker', 'SpeechStream', 'speech_text'}, scope)
        return scope, scope['Speaker'](), audio, wav

    def test_running_mono_speech_follows_volume_mute_and_unmute(self):
        scope, speaker, audio, wav = self.setup_voice()
        settings = {'speech_volume': 100, 'speech_muted': False}
        speaker.output_settings = settings

        def next_block(index):
            if index == 1: settings['speech_volume'] = 25
            if index == 2: settings['speech_muted'] = True
            if index == 3: settings.update(speech_muted=False, speech_volume=75)

        audio.before_block = next_block
        speaker.play(wav, threading.Event(), lambda *ignored: None)
        self.assertEqual([block[0][0] for block in audio.blocks], [1., .25, 0., .75, 0.])
        self.assertFalse(wav.exists())
        self.assertEqual(audio.closed, 1)
        self.assertEqual(speaker.amplitude, 0)

    def test_stereo_gain_and_partial_final_block_are_correct(self):
        scope, speaker, audio, wav = self.setup_voice([[.8, -.4]] * 6)
        speaker.output_settings = {'speech_volume': 50}
        speaker.play(wav, threading.Event(), lambda *ignored: None)
        self.assertEqual(audio.blocks[0], [[.4, -.2]] * 4)
        self.assertEqual(audio.blocks[1], [[.4, -.2]] * 2 + [[0, 0]] * 2)

    def test_cancellation_cleans_file_and_stops_next_audio_block(self):
        scope, speaker, audio, wav = self.setup_voice()
        cancel = threading.Event()
        audio.before_block = lambda index: cancel.set() if index == 1 else None
        speaker.play(wav, cancel, lambda *ignored: None)
        self.assertEqual(len(audio.blocks), 2)
        self.assertEqual(audio.blocks[1], [[0]] * 4)
        self.assertFalse(wav.exists())
        self.assertEqual(audio.closed, 1)

    def test_speech_stream_keeps_live_settings_for_direct_play_path(self):
        scope, speaker, audio, wav = self.setup_voice()
        settings = {'tts': 'piper', 'speech_volume': 20}
        audio.before_block = lambda index: settings.update(speech_volume=60) if index == 1 else None
        stream = scope['SpeechStream'](speaker, settings, threading.Event(), lambda *ignored: None)
        stream.feed('Eine kurze Antwort.')
        stream.finish()
        stream.wait(2)
        self.assertFalse(stream.thread.is_alive())
        self.assertEqual(stream.error, '')
        self.assertIs(speaker.output_settings, settings)
        self.assertEqual(audio.blocks[0][0], [.2])
        self.assertEqual(audio.blocks[1][0], [.6])

    def test_sapi_applies_gain_before_first_audio_and_during_speech(self):
        settings = {'speech_volume': 30, 'speech_muted': False}
        observed = []
        initialized = []

        class ComSpeaker:
            Volume = 100
            def GetVoices(self):
                return [types.SimpleNamespace(Id='german', GetAttribute=lambda key: '407')]
            def Speak(self, text, flags): observed.append(('speak', self.Volume))
            def WaitUntilDone(self, timeout):
                observed.append(('wait', self.Volume))
                count = len([item for item in observed if item[0] == 'wait'])
                if count == 1: settings['speech_muted'] = True
                elif count == 2: settings.update(speech_muted=False, speech_volume=80)
                return count >= 3

        com = ComSpeaker()
        client = types.ModuleType('win32com.client'); client.Dispatch = lambda name: com
        package = types.ModuleType('win32com'); package.client = client
        pythoncom = types.ModuleType('pythoncom')
        pythoncom.CoInitialize = lambda: initialized.append(True)
        pythoncom.CoUninitialize = lambda: initialized.append(False)
        scope = load_classes('legacy_voice.py', {'Speaker'}, dict(threading=threading))
        with patch.dict(sys.modules, {'pythoncom': pythoncom, 'win32com': package, 'win32com.client': client}):
            speaker = scope['Speaker']()
            speaker._sapi('Antwort', settings, threading.Event(), lambda *ignored: None)
        self.assertEqual(observed, [('speak', 30), ('wait', 30), ('wait', 0), ('wait', 80)])
        self.assertEqual(initialized, [True, False])
        self.assertEqual(speaker.amplitude, 0)


if __name__ == '__main__': unittest.main()
