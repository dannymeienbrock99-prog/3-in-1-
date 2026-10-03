"""Exercise capture conversion/lifecycle with synthetic PCM and no audio device."""
import ast
import audioop
import contextlib
import json
import queue
import re
import threading
import time
import unittest
from collections import deque
from pathlib import Path
import numpy as np


class CaptureTests(unittest.TestCase):
    def microphone(self, open_input, vad, selected, ready, errors):
        source=Path(__file__).resolve().parents[1]/'app'/'voice.py'
        tree=ast.parse(source.read_text(encoding='utf-8'))
        tree.body=[node for node in tree.body if isinstance(node,ast.ClassDef) and node.name=='Microphone']
        class Logger:
            @staticmethod
            def exception(*args):pass
        scope=dict(threading=threading,queue=queue,time=time,re=re,json=json,np=np,audioop=audioop,
            deque=deque,open_input=open_input,sd=object(),StreamingVAD=vad,logging=Logger)
        exec(compile(tree,str(source),'exec'),scope)
        return scope['Microphone']({'preserve_wake_word':True,'ambient':False,'wake_word':True},
            threading.Event(),lambda text:None,lambda *args:None,errors.append,
            recognizer=object(),on_device=selected.append,on_ready=ready.append)

    def test_stereo_is_mixed_to_mono_and_resampled_before_vad_without_loading_wake_models(self):
        selected,ready,errors,heard=[],[],[],[];holder={};closed=[]
        @contextlib.contextmanager
        def opened(saved,callback,api,cancelled):
            # 10 ms of deterministic stereo data, not a recording.
            pcm=np.tile(np.array([1000,3000],dtype='<i2'),480).tobytes()
            callback(pcm,480,None,False)
            try:yield object(),{'index':7,'name':'Synthetic stereo','hostapi':'Windows WASAPI','samplerate':48000,'captureChannels':2}
            finally:closed.append(True)
        class Vad:
            def speech(self,samples):
                heard.append(samples.copy());holder['microphone'].stop();return False
        microphone=self.microphone(opened,Vad,selected,ready,errors);holder['microphone']=microphone
        microphone.request();microphone.run()
        self.assertEqual(errors,[]);self.assertEqual(len(heard),1);self.assertEqual(len(heard[0]),160)
        self.assertTrue(np.allclose(heard[0],2000/32768));self.assertEqual(len(selected),1)
        self.assertIn('Synthetic stereo',ready[0]);self.assertEqual(closed,[True])
        self.assertFalse(microphone.connected.is_set())

    def test_failed_open_never_loads_recognition_models_or_announces_ready(self):
        selected,ready,errors,models=[],[],[],[]
        @contextlib.contextmanager
        def failed(*args):
            raise RuntimeError('Testgerät ist nicht verbunden.')
            yield
        def vad():models.append(True);raise AssertionError('Model must not load')
        microphone=self.microphone(failed,vad,selected,ready,errors);microphone.run()
        self.assertEqual(models,[]);self.assertEqual(selected,[]);self.assertEqual(ready,[])
        self.assertIn('nicht verbunden',errors[0]);self.assertFalse(microphone.connected.is_set())

    def test_explicit_button_captures_first_short_word_after_greeting_without_wake_cooldown(self):
        selected,ready,errors,decoded=[],[],[],[];holder={};callbacks={}
        @contextlib.contextmanager
        def opened(saved,callback,api,cancelled):
            callbacks['feed']=lambda:callback(b'\0\0'*1600,1600,None,False)
            callbacks['feed']()
            yield object(),{'index':0,'name':'Synthetic','hostapi':'Test','samplerate':16000,'captureChannels':1}
        class Vad:
            count=0
            def speech(self,samples):
                self.count+=1
                if self.count==2:
                    holder['microphone'].busy.clear();holder['microphone'].request()
                if self.count<20:callbacks['feed']()
                else:holder['microphone'].stop()
                return self.count in (2,3,4)
        microphone=self.microphone(opened,Vad,selected,ready,errors);holder['microphone']=microphone
        microphone.cancel_turn();microphone.busy.set()
        def decode(raw,require_wake=False):
            self.assertFalse(microphone.decode_cancel.is_set(),'The explicitly requested new capture clears only its previous cancellation')
            decoded.append(raw);microphone.stop()
        microphone.decode=decode;microphone.run()
        self.assertEqual(errors,[]);self.assertEqual(len(decoded),1)
        self.assertGreaterEqual(len(decoded[0]),3200*3)


if __name__=='__main__':unittest.main()
