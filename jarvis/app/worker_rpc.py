"""Bounded, cancellable JSON communication with an owned local process."""
import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from config import ROOT, DATA, python_exe

class Worker:
    def __init__(self, script, timeout=30, executable=None):
        self.script, self.timeout, self.executable = script, timeout, executable
        self.process = None
        self.responses = None
        self.lock = threading.RLock()

    def start(self):
        if self.process and self.process.poll() is None:
            return
        DATA.mkdir(parents=True, exist_ok=True)
        responses = queue.Queue()
        with (DATA / (Path(self.script).name + '.log')).open('ab') as log:
            process = subprocess.Popen([self.executable or python_exe(), '-u', str(ROOT / 'app' / self.script)],
                cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                encoding='utf-8', env=dict(os.environ, PYTHONUTF8='1'), creationflags=subprocess.CREATE_NO_WINDOW)
        self.process, self.responses = process, responses
        def reader():
            try:
                for line in process.stdout:
                    try:
                        responses.put(json.loads(line))
                    except ValueError:
                        continue
            finally:
                responses.put({'error': 'Lokaler Dienst wurde beendet.'})
                process.stdout.close()
        threading.Thread(target=reader, daemon=True, name=self.script).start()

    def call(self, job, cancel=None, timeout=None):
        with self.lock:
            if cancel and cancel.is_set():
                raise InterruptedError('Abgebrochen')
            self.start()
            process, responses = self.process, self.responses
            try:
                process.stdin.write(json.dumps(job, ensure_ascii=False) + '\n')
                process.stdin.flush()
                deadline = time.monotonic() + (timeout or self.timeout)
                while time.monotonic() < deadline:
                    if cancel and cancel.is_set():
                        self.stop()
                        raise InterruptedError('Abgebrochen')
                    try:
                        result = responses.get(timeout=.05)
                    except queue.Empty:
                        continue
                    if result.get('error'):
                        self.stop()
                        raise RuntimeError(result['error'])
                    return result
                self.stop()
                raise TimeoutError('Der lokale Dienst hat nicht rechtzeitig geantwortet: ' + self.script)
            except (TimeoutError, InterruptedError):
                raise
            except (BrokenPipeError, OSError):
                self.stop()
                raise RuntimeError('Verbindung zum lokalen Dienst wurde unterbrochen.')

    def stop(self):
        process, self.process = self.process, None
        if process:
            if process.poll() is None: process.kill()
            def reap():
                process.wait()
                try: process.stdin.close()
                except OSError: pass
            threading.Thread(target=reap, daemon=True).start()
