"""Persistent recognizer process; cancellation cannot wedge the microphone."""
import sys
import json
import re
import os
import gc
import numpy as np
from config import MODELS, ROOT
import network_guard
network_guard.install()

# A small fixed vocabulary helps short control names without forcing a command
# or introducing a grammar that would turn unrelated speech into an action.
COMMAND_VOCABULARY='Jarvis, Batto, Chatfarben, Chatfilter, Chat-Filter, Multi-Chat, Multichat, Touch Deck, Touchdeck, Dual Stream, Pause, Start, Ende, Spiel, Kamera, Mikrofon, Moderation, Auto-Broadcast, Twitch, TikTok, TikFinity, Lautstärke, Lüfter, Arbeitsspeicher, CPU, GPU, Commands, öffne, wechsle, wechsel, mach, schalte, zeige'

def parse_transcript(text):
    pattern=r'^(?:(?:hey|hi|hallo|okay|ok)[,\s]*|h[.]\s*j[.]\s*)?(?:jarvis|javis|jarwis|yavis|havis|dschavis|hiyavis|hayabis|ja,?\s*bis|ja,?\s*wiss)\b[, .:!?–—-]*'
    match=re.match(pattern,text.strip(),re.I)
    clean=text.strip()[match.end():].strip() if match else text.strip()
    return {'text':clean,'raw_text':text,'wake_detected':bool(match)}

def run():
    # Only bundled DLL directories; no dependency on a system CUDA installation.
    dll_handles=[]
    for folder in (ROOT/'tools/ollama/lib/ollama/cuda_v12',ROOT/'tools/speech-cuda'):
        if folder.is_dir() and os.name=='nt':
            os.environ['PATH']=str(folder)+os.pathsep+os.environ.get('PATH','')
            dll_handles.append(os.add_dll_directory(str(folder)))
    from faster_whisper import WhisperModel
    import ctranslate2
    model=None;model_mode=None;backend='Whisper Small · CPU';fallback=''
    def cpu_model():
        return WhisperModel(str(MODELS/'whisper-small'),device='cpu',compute_type='int8',cpu_threads=2,local_files_only=True)
    def select_model(gaming_mode):
        nonlocal model,model_mode,backend,fallback
        if model is not None and model_mode==gaming_mode:return
        # Load only for an actual request, and free the previous model before
        # switching. Gaming mode must never initialize CUDA or the Turbo model.
        model=None;gc.collect();model_mode=gaming_mode
        backend='Whisper Small · CPU';fallback=''
        try:
            if not gaming_mode and (MODELS/'whisper-turbo/model.bin').is_file() and ctranslate2.get_cuda_device_count():
                model=WhisperModel(str(MODELS/'whisper-turbo'),device='cuda',compute_type='int8_float16',local_files_only=True)
                list(model.transcribe(np.zeros(16000,np.float32),language='de',beam_size=1,vad_filter=False)[0])
                backend='Whisper Turbo · NVIDIA GPU'
        except Exception as exc:
            fallback=str(exc);model=None;gc.collect()
        if model is None:model=cpu_model()
    for line in sys.stdin:
        try:
            job = json.loads(line)
            select_model(job.get('gaming_mode') is True)
            if job.get('warmup'):
                print(json.dumps({'ready': True,'backend':backend,'fallback':fallback}), flush=True)
                continue
            import base64
            samples = np.frombuffer(base64.b64decode(job['audio']), dtype='<i2').astype(np.float32)/32768
            def transcribe():
                segments,_=model.transcribe(samples,language='de',beam_size=3,vad_filter=True,
                    condition_on_previous_text=False,initial_prompt=COMMAND_VOCABULARY+'.',hotwords=COMMAND_VOCABULARY)
                return ' '.join(s.text.strip() for s in segments).strip()
            try:text=transcribe()
            except RuntimeError as exc:
                if 'GPU' not in backend:raise
                fallback=str(exc);model=None;gc.collect();model=cpu_model();backend='Whisper Small · CPU'
                text=transcribe()
            print(json.dumps(parse_transcript(text)|{'backend':backend}, ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps({'error': str(exc)}), flush=True)

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    run()
