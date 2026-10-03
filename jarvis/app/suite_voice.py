"""Local JSON-line audio service; never executes text as a command."""
import sys,os,json,threading,queue,time
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',PYTHONUTF8='1')
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
protocol=sys.stdout;sys.stdout=sys.stderr
import network_guard
network_guard.install()
from voice import Speaker,Microphone,preferred_devices
from worker_rpc import Worker
write_lock=threading.Lock()
def emit(data):
    with write_lock:protocol.write(json.dumps(data,ensure_ascii=False)+'\n');protocol.flush()
class Service:
    def __init__(self):
        self.settings={'tts':'piper','voice_style':'synthetic','speech_rate':160,'wake_word':True,'preserve_wake_word':True,'continuous':False,'headphones':False,'end_silence':.65,'microphone':None}
        self.speaker=Speaker();self.speaker.output_settings=self.settings;self.recognizer=Worker('stt_worker.py',35);self.microphone=None;self.busy=threading.Event();self.cancel=threading.Event();self.quit=threading.Event();self.jobs=queue.Queue(maxsize=8);self.speaking=False;self.listening=False;self.generation=0
        threading.Thread(target=self.output,daemon=True).start()
    def state(self,state,text):
        emit({'type':'state','state':state,'text':text})
        if self.listening and state=='idle':
            self.listening=False;emit({'type':'turn-end'})
    def transcript(self,text):
        self.listening=False;emit({'type':'transcript','text':text})
    def output(self):
        while not self.quit.is_set():
            try:text,stamp,listen_after,generation=self.jobs.get(timeout=.5)
            except queue.Empty:continue
            while self.listening and generation==self.generation and not self.quit.is_set():time.sleep(.1)
            if time.monotonic()-stamp>30 or generation!=self.generation:continue
            self.cancel.clear();self.busy.set();self.speaking=True
            try:
                if text:self.speaker.speak(text,self.settings,self.cancel,self.state)
            except Exception as e:emit({'type':'error','text':str(e)})
            finally:
                self.speaking=False;self.busy.clear()
                if listen_after and generation==self.generation and not self.cancel.is_set():
                    self.listening=True
                    if not self.microphone:self.enable(True)
                    self.microphone.request();self.state('listening','Ich höre zu …')
                else:self.state('ready','Bereit')
    def stop(self):
        self.generation+=1;self.listening=False;self.cancel.set();self.speaker.stop()
        if self.microphone:self.microphone.cancel_turn()
        while not self.jobs.empty():
            try:self.jobs.get_nowait()
            except queue.Empty:break
    def enable(self,value):
        if self.microphone:self.microphone.stop();self.microphone=None
        if not value:self.listening=False
        if value:
            self.microphone=Microphone(self.settings,self.busy,self.transcript,self.state,lambda t:emit({'type':'error','text':t}),on_interrupt=self.stop,recognizer=self.recognizer,speaker=self.speaker,on_backend=lambda v:emit({'type':'backend','text':v}),on_ready=lambda t:emit({'type':'microphone-ready','text':t}))
            self.microphone.start()
        emit({'type':'microphone','enabled':bool(value)})
    def dispatch(self,job):
        command=job.get('command')
        if command=='speak':
            text=str(job.get('text',''))[:1600]
            if text.strip():
                try:self.jobs.put_nowait((text,time.monotonic(),False,self.generation))
                except queue.Full:emit({'type':'notice','text':'Sprachwarteschlange voll; ältere Meldungen werden nicht nachgeholt.'})
        elif command=='settings':
            v=job.get('value',{});self.settings.update(wake_word=v.get('wakeWord',True),continuous=v.get('microphoneEnabled') is True and v.get('wakeWord',True) is False,headphones=v.get('headphones',False),speech_rate=max(120,min(210,int(v.get('speechRate',160)))),microphone=v.get('microphone'),speech_volume=max(0,min(100,float(v.get('speechVolume',100)))),speech_muted=v.get('speechMuted') is True)
        elif command=='microphone':self.enable(job.get('enabled') is True)
        elif command=='listen':
            self.stop()
            self.jobs.put_nowait((str(job.get('greeting',''))[:180],time.monotonic(),True,self.generation))
        elif command=='stop':self.stop()
        elif command=='complete':
            if not self.speaking and self.jobs.empty():self.busy.clear()
        elif command=='devices':emit({'type':'devices','items':[{'index':i,**d} for i,d in preferred_devices()]})
        elif command=='shutdown':self.quit.set()
    def close(self):
        self.quit.set();self.stop()
        if self.microphone:self.microphone.stop()
        self.recognizer.stop();self.speaker.close()
service=Service();emit({'type':'ready','text':'Lokaler Sprachdienst bereit. Kamera und Fingerverfolgung sind entfernt.'})
try:
    for line in sys.stdin:
        try:
            if len(line)>20000:raise ValueError('Nachricht zu lang')
            service.dispatch(json.loads(line))
            if service.quit.is_set():break
        except Exception as e:emit({'type':'error','text':str(e)})
finally:service.close()
