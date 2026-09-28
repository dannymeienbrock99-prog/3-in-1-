"""Batto 3-in-1 voice paths. Camera and hand tracking are not included."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
DATA=Path(os.environ.get('BATTO_VOICE_DATA',str(ROOT/'data')))
MODELS=Path(os.environ.get('BATTO_VOICE_MODELS',str(ROOT/'models')))
def python_exe(windowless=False):
    candidate=ROOT/'python'/('pythonw.exe' if windowless else 'python.exe')
    return str(candidate if candidate.exists() else Path(sys.executable).with_name('pythonw.exe' if windowless else 'python.exe'))
def reference_path(value):return Path(value or '')
