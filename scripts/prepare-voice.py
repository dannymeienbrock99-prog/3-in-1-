"""Prepare a portable, local-only voice package from the current Python 3.12 runtime."""
from pathlib import Path
import sys,shutil,subprocess,urllib.request,zipfile
root=Path(__file__).resolve().parents[1];target=root/'jarvis/python';base=Path(sys.base_prefix)
if sys.version_info[:2] != (3,12):raise SystemExit('Python 3.12 x64 is required (audioop compatibility).')
target.mkdir(parents=True,exist_ok=True)
for name in ['python.exe','pythonw.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt']:shutil.copy2(base/name,target/name)
for name in ['DLLs','Lib']:
 shutil.copytree(base/name,target/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('site-packages','__pycache__','test','tests','idlelib','tkinter','turtledemo','ensurepip'))
subprocess.run([sys.executable,'-m','pip','install','--target',str(target/'Lib/site-packages'),'-r',str(root/'jarvis/requirements-lock.txt')],check=True)
sys.path.insert(0,str(target/'Lib/site-packages'))
from huggingface_hub import snapshot_download,hf_hub_download
models=root/'jarvis/models';models.mkdir(exist_ok=True)
snapshot_download('Systran/faster-whisper-small',local_dir=models/'whisper-small',allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt','README.md','LICENSE*'])
piper=models/'piper';piper.mkdir(exist_ok=True)
for name in ['de_DE-thorsten-medium.onnx','de_DE-thorsten-medium.onnx.json','MODEL_CARD']:
 file=hf_hub_download('rhasspy/piper-voices','de/de_DE/thorsten/medium/'+name);shutil.copy2(file,piper/name)
downloads=root/'work/voice-downloads';downloads.mkdir(parents=True,exist_ok=True)
for model,target_name in [('vosk-model-small-en-us-0.15','vosk-wake-en'),('vosk-model-small-de-0.15','vosk-model-small-de-0.15')]:
 archive=downloads/(model+'.zip');urllib.request.urlretrieve('https://alphacephei.com/vosk/models/'+model+'.zip',archive)
 with zipfile.ZipFile(archive) as z:
  for member in z.infolist():
   relative=Path(member.filename)
   if relative.is_absolute() or '..' in relative.parts:raise ValueError('Invalid model archive path')
  z.extractall(downloads)
 shutil.copytree(downloads/model,models/target_name,dirs_exist_ok=True)
print('Portable voice runtime prepared without camera, hand tracking, Torch or Qt.')
