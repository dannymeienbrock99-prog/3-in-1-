"""Cancellation uses the actual microphone class with no audio/model imports."""
import ast
import base64
import re
import threading
import time
import unittest
from pathlib import Path


class Recognizer:
    def __init__(self, result=None):
        self.entered = threading.Event()
        self.release = threading.Event()
        self.result = result or {'text': 'Jarvis Pause', 'wake_detected': True}

    def call(self, job, cancel):
        self.entered.set()
        if not self.release.wait(2):
            raise AssertionError('Test recognizer was not released')
        return self.result


class CommandCancelTests(unittest.TestCase):
    def microphone(self, settings=None, result=None):
        source = Path(__file__).resolve().parents[1] / 'app' / 'voice.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        tree.body = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Microphone']
        scope = dict(threading=threading, base64=base64, re=re)
        exec(compile(tree, str(source), 'exec'), scope)
        recognized, errors = [], []
        worker = Recognizer(result)
        microphone = scope['Microphone'](settings or {}, threading.Event(), recognized.append,
            lambda *args: None, errors.append, recognizer=worker)
        self.addCleanup(microphone.stop)
        return microphone, worker, recognized, errors

    def decoded(self, settings, result, require_wake=False):
        microphone, worker, recognized, errors = self.microphone(settings, result)
        worker.release.set();microphone.decode(b'\x00\x00' * 100, require_wake=require_wake)
        for _ in range(100):
            if not microphone.decoding.is_set():break
            time.sleep(.01)
        self.assertFalse(microphone.decoding.is_set());self.assertEqual(errors, [])
        return microphone, recognized

    def test_stop_during_transcription_prevents_late_command(self):
        microphone, worker, recognized, errors = self.microphone()
        microphone.decode(b'\x00\x00' * 100)
        self.assertTrue(worker.entered.wait(1))
        microphone.cancel_turn()
        worker.release.set()
        for _ in range(100):
            if not microphone.decoding.is_set(): break
            time.sleep(.01)
        self.assertFalse(microphone.decoding.is_set())
        self.assertEqual(recognized, [])
        self.assertEqual(errors, [])
        self.assertFalse(microphone.quit.is_set(), 'The ambient microphone remains available')

    def test_a_new_button_press_keeps_pending_capture_cancellation(self):
        microphone, _, _, _ = self.microphone()
        microphone.request()
        microphone.cancel_turn()
        self.assertFalse(microphone.record.is_set())
        microphone.request()
        self.assertTrue(microphone.record.is_set())
        self.assertTrue(microphone.cancel_record.is_set(), 'Old audio must be discarded by the audio thread')

    def test_cancel_after_thinking_before_decode_does_not_revive_old_audio(self):
        microphone,worker,recognized,errors=self.microphone()
        microphone.on_state=lambda *args:microphone.cancel_turn()
        microphone.on_state('thinking','Sprache wird erkannt')
        worker.release.set();microphone.decode(b'\0\0'*1600)
        time.sleep(.03)
        self.assertFalse(worker.entered.is_set());self.assertFalse(microphone.decoding.is_set())
        self.assertTrue(microphone.decode_cancel.is_set());self.assertEqual(recognized,[]);self.assertEqual(errors,[])

    def test_suite_keeps_recognized_address_for_own_voice_and_scene_commands(self):
        for text, expected in [('leiser', 'Jarvis leiser'), ('Pause', 'Jarvis Pause')]:
            with self.subTest(text=text):
                _, recognized=self.decoded({'preserve_wake_word':True}, {'text':text,'wake_detected':True})
                self.assertEqual(recognized,[expected])

    def test_legacy_desktop_and_unaddressed_button_commands_keep_existing_text(self):
        for settings,result,expected in [
            ({}, {'text':'Jarvis leiser','wake_detected':True}, 'leiser'),
            ({'preserve_wake_word':True}, {'text':'leiser','wake_detected':False}, 'leiser'),
            ({'preserve_wake_word':True}, {'text':'Jarvison','wake_detected':False}, 'Jarvison')]:
            with self.subTest(text=result['text']):
                _, recognized=self.decoded(settings,result)
                self.assertEqual(recognized,[expected])

    def test_suite_preserves_an_actual_prefix_even_if_worker_did_not_flag_it(self):
        _, recognized=self.decoded({'preserve_wake_word':True},{'text':'Jarvis leiser','wake_detected':False})
        self.assertEqual(recognized,['Jarvis leiser'])

    def test_bare_recognized_wake_word_starts_a_followup_turn_without_empty_command(self):
        microphone,recognized=self.decoded({'preserve_wake_word':True},{'text':'','wake_detected':True},require_wake=True)
        self.assertEqual(recognized,[]);self.assertTrue(microphone.record.is_set())


if __name__ == '__main__':
    unittest.main()
