"""Pin the video-only DirectShow reader and ship corresponding source/license files."""
import hashlib, io, os, shutil, tarfile, urllib.request, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'VirtualCam'
CACHE=Path(os.environ.get('BATTO_VCAM_CACHE',ROOT/'work'/'virtualcam-cache'))
CACHE.mkdir(parents=True,exist_ok=True)
def obtain(name,url,sha):
 p=CACHE/name
 if not p.exists():
  with urllib.request.urlopen(url,timeout=120) as r:p.write_bytes(r.read())
 if hashlib.sha256(p.read_bytes()).hexdigest()!=sha:raise RuntimeError('Checksum mismatch: '+name)
 return p
binary=obtain('virtualcam.zip','https://github.com/miaulightouch/obs-virtual-cam/releases/download/2.1.2/obs-virtualcam-2.1.2-windows-x64.zip','d690d50045fce0739a07169a9d1a48bf8a2ba91a4a5b57d9c1ec7e6fc7292699')
source=obtain('sources.zip','https://codeload.github.com/miaulightouch/obs-virtual-cam/zip/dc8b82ed233d863c1c411ed015903d42e8a55b3f','f5461bfe2fa627068c6e90a0854bf8a938924d3310ca4d6e8010532046baf8c6')
ffmpeg=obtain('ffmpeg-6.1.1.tar.xz','https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz','8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968')
build=obtain('obs-deps-sources.zip','https://codeload.github.com/obsproject/obs-deps/zip/refs/tags/2024-03-19','30429f10a4902d6eae03b73b910c6b32ba8ff1648b7281828b42bf7c76152b40')
(OUT/'x64').mkdir(parents=True,exist_ok=True)
(OUT/'sources').mkdir(exist_ok=True)
with zipfile.ZipFile(binary) as z:
 for dll in ['obs-virtualsource.dll','avutil-58.dll','swscale-7.dll']:(OUT/'x64'/dll).write_bytes(z.read('bin/64bit/'+dll))
with zipfile.ZipFile(source) as z:
 name=next(n for n in z.namelist() if n.count('/')==1 and n.endswith('/LICENSE'))
 (OUT/'VirtualCam-LICENSE.txt').write_bytes(z.read(name))
with tarfile.open(ffmpeg) as t:
 for license in ['COPYING.GPLv3','COPYING.LGPLv3']:
  (OUT/(license+'.txt')).write_bytes(t.extractfile('ffmpeg-6.1.1/'+license).read())
for p in [source,ffmpeg,build]:shutil.copyfile(p,OUT/'sources'/p.name)
(OUT/'README.txt').write_text('OBS VirtualCam 2.1.2 DirectShow reader, unmodified. Source commit dc8b82ed233d863c1c411ed015903d42e8a55b3f.\nhttps://github.com/miaulightouch/obs-virtual-cam\nFFmpeg n6.1.1 avutil/swscale DLLs from obs-deps 2024-03-19. GPL-3.0-or-later build.\nCorresponding sources, build scripts and licenses accompany these files in sources/.\nThe complete application is not subject to one combined license; consult THIRD-PARTY.md.\n',encoding='utf-8')
print('VirtualCam reader, licenses and sources ready.')
