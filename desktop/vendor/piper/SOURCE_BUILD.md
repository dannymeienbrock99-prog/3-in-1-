# Source and build information for the unchanged Windows Piper helper

The source is delivered with the binary, in `sources`, rather than relying on a future written source offer. The GPL-covered eSpeak NG source archive includes its source, language data, build scripts and COPYING file. The Piper and piper-phonemize source archives contain their build scripts and MIT notices. Keep these accompanying sources and license texts with redistributed runtime copies.

## Immutable source archives

- `piper-2023.11.14-2.zip`: https://github.com/rhasspy/piper/tree/2023.11.14-2
- `piper-phonemize-fccd4f3.zip`: https://github.com/rhasspy/piper-phonemize/tree/fccd4f335aa68ac0b72600822f34d84363daa2bf
- `espeak-ng-0f65aa3.zip`: https://github.com/rhasspy/espeak-ng/tree/0f65aa301e0d6bae5e172cc74197d32a6182200f

`sources/provenance.json` gives the direct original archive URLs. `manifest.json` gives SHA-256 hashes for the delivered archives and runtime files. The two dependency revisions are the latest commits preceding the official Piper release published at 2023-11-14 19:05:55 UTC. The official release workflow builds directly from the release tag; its CMake files fetch the then-current piper-phonemize and eSpeak NG master branches. Both historical dependency revisions are provided to avoid relying on future master changes.

## Upstream Windows build

The included Piper source contains `.github/workflows/main.yml`, job `build_windows`. It used the GitHub `windows-latest` x64 environment, CMake and the Microsoft C++ toolchain. The recorded commands are:

```
cmake -Bbuild -DCMAKE_INSTALL_PREFIX=_install/piper
cmake --build build --config Release
cmake --install build
```

Piper CMake builds fmt 10.0.0 and spdlog 1.12.0, and links against piper-phonemize, eSpeak NG and ONNX Runtime. The included piper-phonemize CMake files use ONNX Runtime 1.14.1. They build eSpeak NG as a shared library with asynchronous output, MBROLA, libsonic, libpcaudio, KLATT and speechplayer disabled, and extra Chinese/Russian data enabled. The original complete CMake files are in the archives; no substitute build instructions or patched native binaries have been introduced.

Additional permissively licensed source dependencies used by the upstream build:

- https://github.com/microsoft/onnxruntime/tree/v1.14.1
- https://github.com/fmtlib/fmt/tree/10.0.0
- https://github.com/gabime/spdlog/tree/v1.12.0
- nlohmann/json is included as a header in the Piper source archive.

The accompanying source documents the upstream build. This integration has tested the original official Windows binaries, not claimed a byte-identical locally reproduced compilation. Runtime and voice hashes are verified when preparing the Batto package.

## Separation from generated speech

Only the standalone helper, its dependencies, model, notices and source archives are redistributed. Synthesis receives UTF-8 text on stdin, has no network service, writes a temporary PCM WAV under Batto's TTS cache and exits. Neither chat text nor generated audio is part of this source or runtime distribution.
