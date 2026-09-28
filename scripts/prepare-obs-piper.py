"""Recreate the exact, hash-checked standalone Piper bundle used by OBS Tool 2.4.7."""
from pathlib import Path
import hashlib, json, urllib.request, zipfile

root=Path(__file__).resolve().parents[1]
bundle=root/'desktop/vendor/piper'
cache=root/'work/piper-downloads'
cache.mkdir(parents=True,exist_ok=True)
manifest=json.loads((bundle/'manifest.json').read_text(encoding='utf-8'))
def valid(file, item):
 return file.is_file() and file.stat().st_size==item['bytes'] and hashlib.sha256(file.read_bytes()).hexdigest()==item['sha256']
def download(url, file):
 file.parent.mkdir(parents=True,exist_ok=True)
 with urllib.request.urlopen(url,timeout=120) as src, file.open('wb') as out:
  while data:=src.read(1024*1024):out.write(data)
sources={item['name']:item['url'] for item in json.loads((bundle/'sources/provenance.json').read_text(encoding='utf-8'))}
archive=None
for item in manifest['files']:
 file=(bundle/item['path']).resolve()
 if not file.is_relative_to(bundle.resolve()):raise ValueError('Invalid manifest path')
 if valid(file,item):continue
 if item['path'].startswith('runtime/'):
  if archive is None:
   archive=cache/'piper.zip'
   download('https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',archive)
   if hashlib.sha256(archive.read_bytes()).hexdigest()!='f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea':raise ValueError('Piper archive hash mismatch')
  with zipfile.ZipFile(archive) as z:
   file.parent.mkdir(parents=True,exist_ok=True)
   file.write_bytes(z.read('piper/'+item['path'].removeprefix('runtime/')))
 elif item['path'].startswith('sources/') and file.name in sources:download(sources[file.name],file)
 elif item['path']=='voices/de_DE-thorsten-medium.onnx':download('https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',file)
 else:raise FileNotFoundError('Required license or metadata missing: '+item['path'])
 if not valid(file,item):raise ValueError('Piper file hash mismatch: '+item['path'])
print('Original OBS Piper bundle verified:',len(manifest['files']),'files')
