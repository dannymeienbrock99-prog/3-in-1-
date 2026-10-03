"""Model-selection protocol with lightweight doubles; no model, GPU, audio or network."""
import ast
import io
import json
import gc
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np


class GamingModeTests(unittest.TestCase):
    def run_worker(self, jobs):
        source = Path(__file__).resolve().parents[1] / 'app' / 'stt_worker.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
        models = []
        class Model:
            def __init__(self, model, **kwargs): models.append(kwargs)
            def transcribe(self, *args, **kwargs): return iter([]), None
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'whisper-turbo').mkdir()
            (root / 'whisper-turbo' / 'model.bin').write_bytes(b'fixture')
            output = io.StringIO()
            import re
            scope = dict(sys=sys, json=json, re=re, os=os, gc=gc, np=np, ROOT=root,
                         MODELS=root, COMMAND_VOCABULARY='Jarvis')
            exec(compile(tree, str(source), 'exec'), scope)
            modules = {'faster_whisper': types.SimpleNamespace(WhisperModel=Model),
                       'ctranslate2': types.SimpleNamespace(get_cuda_device_count=lambda: 1)}
            with patch.dict(sys.modules, modules), patch.object(sys, 'stdin', io.StringIO(''.join(json.dumps(job)+'\n' for job in jobs))), patch.object(sys, 'stdout', output):
                scope['run']()
            return models, [json.loads(line) for line in output.getvalue().splitlines()]

    def test_gaming_mode_does_not_initialize_gpu_even_if_turbo_is_available(self):
        models, responses = self.run_worker([{'warmup': True, 'gaming_mode': True}])
        self.assertEqual([model['device'] for model in models], ['cpu'])
        self.assertEqual(models[0]['cpu_threads'], 2)
        self.assertEqual(responses[0]['backend'], 'Whisper Small · CPU')

    def test_explicit_acceleration_and_legacy_callers_can_use_gpu(self):
        for job in [{'warmup': True, 'gaming_mode': False}, {'warmup': True}]:
            with self.subTest(job=job):
                models, responses = self.run_worker([job])
                self.assertEqual([model['device'] for model in models], ['cuda'])
                self.assertEqual(responses[0]['backend'], 'Whisper Turbo · NVIDIA GPU')

    def test_mode_change_replaces_model_but_repeated_requests_reuse_it(self):
        models, responses = self.run_worker([{'warmup': True, 'gaming_mode': mode} for mode in [False, True, True]])
        self.assertEqual([model['device'] for model in models], ['cuda', 'cpu'])
        self.assertEqual(len(responses), 3)


if __name__ == '__main__': unittest.main()
