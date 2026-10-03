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
    def __init__(self,*args,**kwargs): self.speaker=kwargs['speaker'];self.requested=False;self.stopped=False;self.cancelled=False;self.on_ready=kwargs['on_ready']
    def start(self): pass
    def request(self):
        if not self.speaker.finished:raise AssertionError('Listening before greeting completed')
        self.requested=True
        self.on_ready('Mikrofon bereit: Testgerät')
    def stop(self): self.stopped=True
    def cancel_turn(self): self.cancelled=True;self.requested=False
class Worker:
    def __init__(self,*args): pass
    def stop(self): pass

class SuiteVoiceTests(unittest.TestCase):
    def service(self,microphone_class=Microphone):
        source=Path(__file__).resolve().parents[1]/'app'/'suite_voice.py'
        tree=ast.parse(source.read_text(encoding='utf-8'))
        tree.body=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Service']
        events=[];scope=dict(threading=threading,queue=queue,time=time,Speaker=Speaker,Microphone=microphone_class,Worker=Worker,emit=events.append)
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
    def test_live_volume_settings_keep_shared_dictionary_and_listening_session(self):
        s,e=self.service();settings=s.settings;s.listening=True
        s.dispatch({'command':'settings','value':{'speechVolume':35,'speechMuted':True}})
        self.assertIs(s.settings,settings);self.assertIs(s.speaker.output_settings,settings)
        self.assertEqual(settings['speech_volume'],35);self.assertTrue(settings['speech_muted']);self.assertTrue(s.listening)
        s.dispatch({'command':'settings','value':{'speechVolume':140,'speechMuted':False}})
        self.assertEqual(settings['speech_volume'],100);self.assertFalse(settings['speech_muted']);self.assertTrue(s.listening)
    def test_stop_cancels_pending_command_without_closing_enabled_microphone(self):
        s,e=self.service();s.enable(True);microphone=s.microphone
        s.dispatch({'command':'stop'})
        self.assertTrue(microphone.cancelled);self.assertFalse(microphone.stopped)
        self.assertIs(s.microphone,microphone);self.assertFalse(s.listening)
    def test_continuous_commands_need_explicit_microphone_without_wake_word(self):
        s,e=self.service()
        s.dispatch({'command':'settings','value':{'microphoneEnabled':False,'wakeWord':False}})
        self.assertFalse(s.settings['continuous']);self.assertIsNone(s.microphone)
        s.dispatch({'command':'settings','value':{'microphoneEnabled':True,'wakeWord':False}})
        self.assertTrue(s.settings['continuous']);self.assertIsNone(s.microphone)
        s.dispatch({'command':'settings','value':{'microphoneEnabled':True,'wakeWord':True}})
        self.assertFalse(s.settings['continuous'])
    def test_failed_microphone_start_does_not_break_next_push_to_talk_attempt(self):
        class OnceFailing(Microphone):
            starts=0
            def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.error=args[4]
            def start(self):
                OnceFailing.starts+=1
                if OnceFailing.starts==1:self.error('Mikrofon konnte nicht geöffnet werden.')
        s,e=self.service(OnceFailing);s.dispatch({'command':'listen','greeting':'Hallo'})
        self.wait(lambda:any(row['type']=='error' for row in e));self.assertIsNone(s.microphone)
        s.dispatch({'command':'listen','greeting':'Hallo'})
        self.wait(lambda:s.microphone and s.microphone.requested)
        self.assertEqual(OnceFailing.starts,2);self.assertTrue(s.listening)
    def test_successful_device_event_contains_stable_identity_and_selected_format(self):
        class Selected(Microphone):
            def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.selected=kwargs['on_device']
            def start(self):self.selected({'name':'USB Mic','hostapi':'Windows WASAPI','index':37,'samplerate':48000,'captureChannels':2})
        s,e=self.service(Selected);saved={'name':'USB Mic','hostapi':'Windows WASAPI'}
        s.dispatch({'command':'settings','value':{'microphone':saved}});self.assertEqual(s.settings['microphone'],saved)
        self.assertIsNone(s.microphone);s.enable(True)
        selected=next(row for row in e if row['type']=='microphone-selected')
        self.assertEqual(selected['microphone'],saved);self.assertEqual(selected['channels'],2);self.assertEqual(selected['samplerate'],48000)

if __name__=='__main__':unittest.main()
