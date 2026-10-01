"""Exercise the real service with silent audio doubles; never opens a microphone."""
import ast, threading, queue, time, unittest
from pathlib import Path

class Speaker:
    def __init__(self): self.items=[]; self.finished=False
    def speak(self,text,settings,cancel,state):
        self.items.append(text);time.sleep(.03);self.finished=True
    def stop(self): pass
    def close(self): pass
class Microphone:
    def __init__(self,*args,**kwargs): self.speaker=kwargs['speaker'];self.requested=False;self.stopped=False;self.on_ready=kwargs['on_ready']
    def start(self): pass
    def request(self):
        if not self.speaker.finished:raise AssertionError('Listening before greeting completed')
        self.requested=True
        self.on_ready('Mikrofon bereit: Testgerät')
    def stop(self): self.stopped=True
class Worker:
    def __init__(self,*args): pass
    def stop(self): pass

class SuiteVoiceTests(unittest.TestCase):
    def service(self):
        source=Path(__file__).resolve().parents[1]/'app'/'suite_voice.py'
        tree=ast.parse(source.read_text(encoding='utf-8'))
        tree.body=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Service']
        events=[];scope=dict(threading=threading,queue=queue,time=time,Speaker=Speaker,Microphone=Microphone,Worker=Worker,emit=events.append)
        exec(compile(tree,str(source),'exec'),scope)
        service=scope['Service']();self.addCleanup(service.close);return service,events
    def wait(self,fn):
        for _ in range(100):
            if fn(): return
            time.sleep(.01)
        self.fail('Timed out')
    def test_button_finishes_greeting_before_microphone_request(self):
        s,e=self.service();s.dispatch({'command':'listen','greeting':'Sir Crazy, wie kann ich helfen?'})
        self.wait(lambda:s.microphone and s.microphone.requested)
        self.assertEqual(s.speaker.items,['Sir Crazy, wie kann ich helfen?']);self.assertTrue(s.listening)
        s.transcript('Pause');self.assertFalse(s.listening);self.assertEqual(e[-1],{'type':'transcript','text':'Pause'})
    def test_silence_ends_button_session_and_stop_cancels_greeting(self):
        s,e=self.service();s.dispatch({'command':'listen','greeting':'Hallo'});self.wait(lambda:s.microphone and s.microphone.requested)
        s.state('idle','Keine Sprache');self.assertFalse(s.listening);self.assertEqual(e[-1]['type'],'turn-end')
        s.dispatch({'command':'listen','greeting':'Hallo'});s.stop();time.sleep(.08);self.assertFalse(s.listening)
    def test_announcements_wait_while_listening_and_queue_is_bounded(self):
        s,e=self.service();s.listening=True
        for _ in range(50):s.dispatch({'command':'speak','text':'Geschenk'})
        time.sleep(.03);self.assertEqual(s.speaker.items,[]);self.assertLessEqual(s.jobs.qsize(),8)
        s.transcript('GPU Temperatur');self.wait(lambda:len(s.speaker.items)>0)

if __name__=='__main__':unittest.main()
