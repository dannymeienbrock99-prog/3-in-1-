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
    def __init__(self, script, timeout=30, executable=None, idle_seconds=60):
        self.script, self.timeout, self.executable = script, timeout, executable
        self.process = None
        self.responses = None
        self.lock = threading.RLock()
        self.idle_seconds = max(0, idle_seconds)
        self.idle_timer = None

    def arm_idle(self):
        if self.idle_timer:
            self.idle_timer.cancel()
        if not self.idle_seconds or not self.process:
            return
        process = self.process
        def release():
            # Never interrupt an inference. A completed request installs its own timer.
            if not self.lock.acquire(blocking=False):
                return
            try:
                if self.process is process:
                    self.stop()
            finally:
                self.lock.release()
        self.idle_timer = threading.Timer(self.idle_seconds, release)
        self.idle_timer.daemon = True
        self.idle_timer.start()

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
            if self.idle_timer:
                self.idle_timer.cancel()
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
            finally:
                self.arm_idle()

    def stop(self):
        if self.idle_timer:
            self.idle_timer.cancel()
            self.idle_timer = None
        process, self.process = self.process, None
        if process:
            if process.poll() is None: process.kill()
            def reap():
                process.wait()
                try: process.stdin.close()
                except OSError: pass
            threading.Thread(target=reap, daemon=True).start()
