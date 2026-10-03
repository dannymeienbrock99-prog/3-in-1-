"""Wake-prefix parity through the actual decoder, without audio/model loading."""
import ast
import base64
import re
import threading
import time
import unittest
from pathlib import Path

APP=Path(__file__).resolve().parents[1]/'app'
tree=ast.parse((APP/'stt_worker.py').read_text(encoding='utf-8'))
tree.body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='parse_transcript']
scope={'re':re};exec(compile(tree,str(APP/'stt_worker.py'),'exec'),scope)
parse_transcript=scope['parse_transcript']

class TranscriptTests(unittest.TestCase):
    def test_okay_and_ok_match_other_supported_greetings_without_losing_command(self):
        for prefix in ['Okay Jarvis,','OK, Jarvis:','Hey Jarvis,','Hallo Javis!','Hi Jarwis,']:
            with self.subTest(prefix=prefix):
                raw=prefix+' Öffne das Touch Deck.'
                result=parse_transcript(raw)
                self.assertEqual(result,{'text':'Öffne das Touch Deck.','raw_text':raw,'wake_detected':True})

    def test_greeting_alone_and_jarvis_mentioned_later_are_not_a_wake_prefix(self):
        for raw in ['Okay, öffne das Touch Deck.','Ich habe Jarvis gesehen.','Jarvison öffne Chat.','Okay, bitte Jarvis öffnen.']:
            with self.subTest(raw=raw):
                result=parse_transcript(raw)
                self.assertFalse(result['wake_detected']);self.assertEqual(result['text'],raw)

    def test_aligned_wake_prefix_passes_actual_microphone_guard_and_preserves_own_voice_target(self):
        tree=ast.parse((APP/'voice.py').read_text(encoding='utf-8'))
        tree.body=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Microphone']
        scope={'threading':threading,'base64':base64,'re':re};exec(compile(tree,str(APP/'voice.py'),'exec'),scope)
        for phrase,expected in [('Okay Jarvis, Pause.','Jarvis Pause.'),('OK Jarvis, leiser.','Jarvis leiser.')]:
            with self.subTest(phrase=phrase):
                class Recognizer:
                    def call(self,job,cancel):return parse_transcript(phrase)
                recognized,states,errors=[],[],[]
                microphone=scope['Microphone']({'preserve_wake_word':True},threading.Event(),recognized.append,lambda *args:states.append(args),errors.append,recognizer=Recognizer())
                microphone.decode(b'\0\0'*100,require_wake=True)
                for _ in range(100):
                    if not microphone.decoding.is_set():break
                    time.sleep(.01)
                microphone.stop()
                self.assertEqual(recognized,[expected]);self.assertEqual(errors,[])
                self.assertFalse(any('nicht bestätigt' in s[1] for s in states))

if __name__=='__main__':unittest.main()
