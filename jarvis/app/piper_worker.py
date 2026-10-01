"""Fast CPU speech, without network, GPU allocation or reference cloning."""
import json
import sys
import wave
import uuid
import time
import os
from pathlib import Path
import numpy as np
from config import MODELS, DATA
import network_guard
network_guard.install()

def run():
    from piper import PiperVoice, SynthesisConfig
    from piper.config import PiperConfig
    import onnxruntime
    from piper.phonemize_espeak import ESPEAK_DATA_DIR
    # eSpeak's Windows C runtime cannot reliably open absolute UTF-8 paths.
    # This dedicated worker can use a relative ASCII data path from its package.
    os.chdir(ESPEAK_DATA_DIR.parent)
    model = MODELS / 'piper/de_DE-thorsten-medium.onnx'
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.add_session_config_entry('session.intra_op.allow_spinning', '0')
    options.add_session_config_entry('session.inter_op.allow_spinning', '0')
    with Path(str(model) + '.json').open(encoding='utf-8') as config:
        voice = PiperVoice(config=PiperConfig.from_dict(json.load(config)),
            session=onnxruntime.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider']),
            espeak_data_dir=Path(ESPEAK_DATA_DIR.name))
    folder = DATA / 'speech-cache'
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob('piper-*.wav'):
        if time.time() - old.stat().st_mtime > 3600:
            old.unlink(missing_ok=True)
    for line in sys.stdin:
        try:
            job = json.loads(line)
            if job.get('warmup'):
                list(voice.synthesize('Bereit.'))
                print(json.dumps({'ready': True}), flush=True)
                continue
            text = str(job.get('text', '')).strip()
            if not text:
                raise ValueError('Leerer Sprachtext')
            style = job.get('style', 'controlled')
            scale = {'natural': 1., 'controlled': 1.06, 'synthetic': 1.04}.get(style, 1.06)
            scale *= 160 / min(210, max(120, int(job.get('rate', 160))))
            cfg = SynthesisConfig(length_scale=scale, noise_scale=.45, noise_w_scale=.55)
            chunks = list(voice.synthesize(text[:1600], syn_config=cfg))
            rate = chunks[0].sample_rate
            samples = np.concatenate([c.audio_float_array for c in chunks])
            # Gentle saturation and a very small dry ring component; no echo.
            samples = np.tanh(samples * 1.18) / 1.18
            if style == 'synthetic':
                phase = np.arange(len(samples), dtype=np.float32) * (2*np.pi*58/rate)
                samples *= .96 + .04*np.cos(phase)
            samples = np.clip(samples, -.97, .97)
            path = folder / ('piper-' + uuid.uuid4().hex + '.wav')
            with wave.open(str(path), 'wb') as output:
                output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                output.writeframes((samples * 32767).astype('<i2').tobytes())
            print(json.dumps({'path': str(path), 'rate': rate, 'duration': len(samples)/rate}), flush=True)
        except Exception as exc:
            print(json.dumps({'error': str(exc)}), flush=True)

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    run()
