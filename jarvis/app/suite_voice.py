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
        self.settings={'tts':'piper','voice_style':'synthetic','speech_rate':160,'wake_word':True,'preserve_wake_word':True,'ambient':False,'continuous':False,'headphones':False,'end_silence':.65,'microphone':None,'gaming_mode':True}
        self.speaker=Speaker();self.speaker.output_settings=self.settings;self.recognizer=Worker('stt_worker.py',35);self.microphone=None;self.microphone_ready=threading.Event();self.busy=threading.Event();self.cancel=threading.Event();self.quit=threading.Event();self.jobs=queue.Queue(maxsize=8);self.speaking=False;self.listening=False;self.generation=0
        threading.Thread(target=self.output,daemon=True).start()
    def state(self,state,text):
        # Wake-word capture must also reserve the turn. Otherwise a queued chat
        # announcement can start speaking and discard the user's command audio.
        if state in ('listening','thinking'):self.listening=True
        emit({'type':'state','state':state,'text':text})
        if self.listening and state=='idle':
            self.listening=False;emit({'type':'turn-end'})
    def ready_microphone(self,generation):
        if not self.microphone:self.enable(True)
        microphone,ready=self.microphone,self.microphone_ready
        deadline=time.monotonic()+15
        while microphone is not None and self.microphone is microphone and generation==self.generation and not self.cancel.is_set() and not self.quit.is_set():
            if ready.wait(.05):return microphone if self.microphone is microphone and generation==self.generation and not self.cancel.is_set() and not self.quit.is_set() else None
            if time.monotonic()>=deadline:
                self.enable(False);emit({'type':'error','text':'Das Mikrofon wird nicht bereit. Bitte das gewählte Gerät prüfen und erneut versuchen.'});break
        return None
    def transcript(self,text):
        self.listening=False;emit({'type':'transcript','text':text})
    def output(self):
        while not self.quit.is_set():
            try:text,stamp,listen_after,generation=self.jobs.get(timeout=.5)
            except queue.Empty:continue
            while self.listening and generation==self.generation and not self.quit.is_set():time.sleep(.1)
            if time.monotonic()-stamp>30 or generation!=self.generation:continue
            self.cancel.clear();self.busy.set();self.speaking=True;turn_microphone=None
            try:
                if listen_after:
                    self.state('preparing','Mikrofon wird vorbereitet …')
                    turn_microphone=self.ready_microphone(generation)
                    if turn_microphone is None:continue
                if text:self.speaker.speak(text,self.settings,self.cancel,self.state)
            except Exception as e:emit({'type':'error','text':str(e)})
            finally:
                self.speaking=False;self.busy.clear()
                if listen_after and turn_microphone is not None and self.microphone is turn_microphone and generation==self.generation and not self.cancel.is_set():
                    self.listening=True
                    turn_microphone.request()
                    # The capture loop emits "listening" once it accepts audio.
                elif generation==self.generation:self.state('ready','Bereit')
    def stop(self):
        self.generation+=1;self.listening=False;self.cancel.set();self.speaker.stop()
        if self.microphone:self.microphone.cancel_turn()
        while not self.jobs.empty():
            try:self.jobs.get_nowait()
            except queue.Empty:break
    def enable(self,value):
        previous=self.microphone;self.microphone=None;self.microphone_ready=threading.Event()
        if previous:
            previous.stop()
            if getattr(previous,'is_alive',lambda:False)() and previous is not threading.current_thread():previous.join(timeout=1)
        if not value:self.listening=False
        if value:
            def failed(text):
                if self.microphone is microphone:
                    # Decode errors happen on a second thread while capture is
                    # still alive. Close it before dropping its owning handle.
                    microphone.stop()
                    self.microphone=None;self.listening=False;self.busy.clear()
                    emit({'type':'error','text':text});emit({'type':'microphone','enabled':False})
            def ready(text):
                if self.microphone is microphone:
                    self.microphone_ready.set();emit({'type':'microphone-ready','text':text})
            def state(value,text):
                if self.microphone is microphone:self.state(value,text)
            def transcript(text):
                if self.microphone is microphone:self.transcript(text)
            def selected(info):
                if self.microphone is microphone:
                    emit({'type':'microphone-selected','microphone':{'name':info['name'],'hostapi':info['hostapi']},'index':info['index'],'samplerate':info['samplerate'],'channels':info['captureChannels'],'text':'Mikrofon: '+info['name']+' · '+info['hostapi']})
            microphone=Microphone(self.settings,self.busy,transcript,state,failed,on_interrupt=self.stop,recognizer=self.recognizer,speaker=self.speaker,on_backend=lambda v:emit({'type':'backend','text':v}),on_ready=ready,on_device=selected)
            self.microphone=microphone;microphone.start()
        emit({'type':'microphone','enabled':self.microphone is not None})
    def dispatch(self,job):
        command=job.get('command')
        if command=='speak':
            text=str(job.get('text',''))[:1600]
            if text.strip():
                try:self.jobs.put_nowait((text,time.monotonic(),False,self.generation))
                except queue.Full:emit({'type':'notice','text':'Sprachwarteschlange voll; ältere Meldungen werden nicht nachgeholt.'})
        elif command=='settings':
            v=job.get('value',{});self.settings.update(wake_word=v.get('wakeWord',True),ambient=v.get('microphoneEnabled') is True,continuous=v.get('microphoneEnabled') is True and v.get('wakeWord',True) is False,headphones=v.get('headphones',False),speech_rate=max(120,min(210,int(v.get('speechRate',160)))),microphone=v.get('microphone'),speech_volume=max(0,min(100,float(v.get('speechVolume',100)))),speech_muted=v.get('speechMuted') is True,gaming_mode=v.get('gamingMode',True) is not False)
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
