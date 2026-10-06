# Batto in-process hardware component

`Batto.Hardware.dll` loads the existing Strimer WinUSB protocol, allowlisted Lian-Li HID protocols, Windows/Corsair/MSI lighting APIs and mainboard fan engine into Batto's own process. It has no app host, worker executable, named pipe, elevation launcher or automatic vendor-software pause. Importing the assembly does not scan hardware. The first explicit scan opens that provider only; cached status and pure protocol checks do not open hardware.

## Hosting contract

Use `publish/runtime/host/fxr/8.0.31/hostfxr.dll`, `hostfxr_initialize_for_runtime_config` with `publish/Batto.Hardware.runtimeconfig.json`, and `hostfxr_initialize_parameters.dotnet_root = publish/runtime`. Get `hdt_load_assembly_and_get_function_pointer` (enum value 5), then load:

- Assembly: absolute `publish/Batto.Hardware.dll`
- Type: `Batto.Hardware.NativeExports, Batto.Hardware`
- Methods: `Invoke` and `Free`
- Delegate type: `UNMANAGEDCALLERSONLY_METHOD` (`(const char_t*)-1`)

Both exports use cdecl. `Invoke(const uint8_t* request, int32_t requestLength, uint8_t** response, int32_t* responseLength)` returns 0 when a JSON response was produced; negative values indicate an invalid ABI call or allocation/response-limit failure. Every nonzero returned buffer must be released exactly once with `Free(void*)`. UTF-8 is strict and byte lengths exclude a terminator. Run Invoke via the native host's asynchronous FFI worker, with an independent serial queue per provider, so scans do not block Batto's UI thread or fan heartbeats. Keep hostfxr and CLR loaded for process lifetime.

Requests use `{requestId, provider, command, ...}`. `provider` defaults to `wireless`; explicit values are `wireless`, `fan`, `windows`, `lianli`, and `inventory`. Replies preserve `{requestId,ok,result|error}` for lighting and the existing flat fan Reply envelope. `capabilities` and the `wireless`, `fan`, `lianli`, and `inventory` providers' `self-test` commands perform no hardware operations. Requests are bounded to 8 MiB; responses are bounded to 2 MiB.

| Provider | Commands |
| --- | --- |
| `wireless` | `enumerate`, `animation` (deviceId/frameCount/intervalMs/rgb), `status` (cached), `take-control` (confirmLConnectPause:true), `release-control`, `control-status` (cached), `close`, `shutdown` |
| `fan` | `scan`, `enable`, `heartbeat`, `manual`, `curve`, `disable`, `shutdown`, `status` (cached) |
| `windows` | `enumerate`, `set` (deviceId/colors), `effect` (MSI deviceId/modeId/colors/brightness/speed/direction), `release`, `close`, `status` |
| `lianli` | `enumerate`, `effect` (deviceId/effectId/colors/brightness/speed/direction/controllerScope/confirmWholeController), `telemetry`, `close`, `status` (cached) |
| `inventory` | `platform` (board/system/chassis/prerequisites), `kingston` (validated read-only service/process/signer/listener proof), `status` (cached), `close` |

This component does not acquire permissions absent from its host. A blocked WinUSB interface remains a truthful device-access error. After a user's explicit confirmation, `take-control` can pause only the two identity-validated L-Connect services through the Windows SCM inside Batto; a scan never does so. Batto must already hold Windows' required service permissions. Own WinUSB handles are closed before pause or restoration. `release-control`, `close`, and `shutdown` restore only services Batto recorded as previously running and accepted a stop for; partial failures retain the lease for an OFF retry. A lease failure returns an `ok:false` native envelope and its actual state in `result`. `control-status` is cached and does not query services. Normal application shutdown must await release; this in-process design cannot promise restoration after a hard process termination.

Mainboard PWM needs the same existing hardware permissions as the linked fan backend. Separate Strimer strand mapping is not invented; the existing whole-cable upload and receiver acknowledgement remain unchanged. The Corsair SDK continues to require the vendor's running iCUE SDK; Windows Dynamic Lighting and optional MSI SDK availability also remain explicit in discovery. Linking an API into Batto does not prove physical compatibility or override another application's ownership.

## Build

Run `build.ps1`. It compiles linked source files, publishes a framework-dependent DLL, runs development-only ABI checks without hardware, and copies the already available .NET 8.0.31 runtime pack into a private framework layout. The published component contains no `.exe`; development test binaries are outside `publish`. The runtime licenses are included. No downloaded driver, helper installation or hardware change is part of the build.

Microsoft's hosting API supports framework-dependent components, so this layout deliberately supplies a private shared runtime rather than publishing the library as a standalone self-contained executable: [custom .NET hosting](https://learn.microsoft.com/en-us/dotnet/core/tutorials/netcore-hosting).
