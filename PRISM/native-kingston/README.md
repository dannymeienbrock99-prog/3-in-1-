# PRISM Kingston FURY CTRL compatibility

PRISM talks only to an already running, authentically signed Kingston FURY CTRL
service on `127.0.0.1:55599`. The adapter never installs or starts a vendor driver,
service, CLI or updater and never stops another application's process. Existing
vendor effects can persist after PRISM closes, as in FURY CTRL itself.

The local service protocol is an experimental compatibility interface inferred
from the user-supplied project, not a public Kingston SDK. A successful response
means the service accepted the request; it is not a physical LED measurement.
Unknown service identity, protocol versions and memory types are rejected.

The independently written codec uses Windows .NET Framework's Rijndael with a
256-bit block, CBC/PKCS7 and the public protocol constant. It has no network,
hardware or vendor-library dependency. Its stdin/stdout interface only encrypts
and decrypts bounded text messages. PRISM never ships any binary from the CLI
repository. No decompiled implementation was copied into these files.

Build on Windows with `powershell -NoProfile -ExecutionPolicy Bypass -File native-kingston/build.ps1`.
The execution-policy option applies only to this build process, not to the system.
Include `native-kingston/bin/PRISM-KingstonCodec.exe` in the installer. The codec
needs the Windows .NET Framework runtime (4.8 or later recommended); FURY CTRL
itself is installed separately from the manufacturer's download page.

Discovery is read-only and preserves actual `slot_N` values. Native effects are
the only exposed control. Physical LED counts and layouts are not reported by
this protocol; `directMode` remains false and per-LED software effects reject.
DDR4 and missing/unknown RAM are discovery warnings, not fabricated devices.

Sources, inspected at commit `dd876269c7835ee45fdc7106f921353633ef09d9`:

- [Kingston FURY CTRL](https://www.kingston.com/en/gaming/fury-ctrl)
- [CLI background and author notice](https://github.com/Beej126/KingstonFuryRgbCLI/blob/main/README.md)
- [Message encryption parameters](https://github.com/Beej126/KingstonFuryRgbCLI/blob/main/KingstonFuryRgbCLI/StringEncryptDecrypt.cs)
- [Service message schema](https://github.com/Beej126/KingstonFuryRgbCLI/blob/main/KingstonFuryRgbCLI/FuryController_Service.cs)
- [DDR5 mode identifiers](https://github.com/Beej126/KingstonFuryRgbCLI/blob/main/KingstonFuryRgbCLI/DDR5LEDmode.cs)
- [DDR5 color payload](https://github.com/Beej126/KingstonFuryRgbCLI/blob/main/KingstonFuryRgbCLI/DRAMDDR5CtrlObj.cs)

The original CLI labels its own repository GPL-3.0 and describes a modified
decompilation. That license does not establish redistribution rights for the
Kingston DLLs/drivers. This implementation contains only independently written
interface binding and a standards-based codec, with source attribution above.
