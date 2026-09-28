# Local Thorsten voice for Batto

This directory is copied unchanged to `resources/piper` by the Windows installer. It is separate from Electron's app.asar. It contains no user text, generated audio, credentials, or downloaded sample recording.

The selected voice is `de_DE-thorsten-medium`, one speaker, German, 22,050 Hz. The ONNX model generates speech from arbitrary text locally. The user's speaker_0.mp3 link identifies this voice; the MP3 is not used as a speech engine or bundled.

## Runtime and model provenance

- Windows executable and DLLs: unmodified official `rhasspy/piper` release `2023.11.14-2`, archive `piper_windows_amd64.zip`, downloaded from https://github.com/rhasspy/piper/releases/tag/2023.11.14-2 . Archive SHA-256: `f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea`.
- Voice model and config: https://huggingface.co/rhasspy/piper-voices/tree/1162a9173d0ce503555aed757976b7a9912eae4c/de/de_DE/thorsten/medium . The exact `MODEL_CARD` is included in `voices`.
- Model SHA-256: `7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819`.
- Config SHA-256: `974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85`.
- The unused Arabic `libtashkeel_model.ort` and pkgconfig files from the official package are omitted. The executable, DLLs and espeak-ng data are unchanged.
- `manifest.json` records every bundled file and its SHA-256 for packaging verification.

The rhasspy repository is archived. Current upstream development is https://github.com/OHF-Voice/piper1-gpl under GPL-3.0. This package deliberately pins the official standalone Windows executable; it does not claim to contain the current OHF Python implementation. No Python installation, server, GPU, cloud account, or system-wide runtime installation is required.

## Licenses and sources

The Piper source and piper-phonemize source have MIT notices, but that does **not** make the complete runtime MIT-only: eSpeak NG is GPL-3.0 and is linked by the shipped helper. Preserve the included notices, GPL text, and source archives when redistributing this directory. The external helper is launched as a separate process using text on standard input and WAV files on disk; Batto does not link its libraries.

`licenses` includes the upstream notices for Piper, piper-phonemize, eSpeak NG, ONNX Runtime (including ThirdPartyNotices), fmt, spdlog and the vendored JSON library. `sources` includes the Piper release source and historical piper-phonemize/eSpeak NG source snapshots used by the release's upstream dependency setup, including their build files and source licenses. The official binary release used master-based dependency URLs; these snapshots are identified by immutable revisions and are not presented as a reproduced build. No executable or library was modified here.

Source revisions:

- Piper: tag `2023.11.14-2`.
- piper-phonemize: `fccd4f335aa68ac0b72600822f34d84363daa2bf` (latest upstream commit before the binary release; its build uses ONNX Runtime 1.14.1).
- rhasspy/eSpeak NG: `0f65aa301e0d6bae5e172cc74197d32a6182200f` (latest upstream commit before the binary release).

The Piper voices repository declares MIT in its model metadata. The Thorsten model card specifically identifies its training dataset as CC0 and states that it was fine-tuned from the Lessac medium voice. Preserve both the repository metadata and the exact model card rather than describing every component as CC0.

## Runtime behavior

The wrapper accepts at most 1,000 characters per request, sends UTF-8 text without a shell, bounds native synthesis to 30 seconds and validates PCM WAV output before returning it. Playback volume and audio output device are handled by Batto's existing audio player. Speaking rate is supported; independent pitch adjustment is not supported by this voice. Missing runtime/model files produce an explicit error instead of silently substituting another voice.

No generated WAV files belong in this directory. User output goes to Batto's existing TTS cache and is removed through the normal TTS cleanup path.
