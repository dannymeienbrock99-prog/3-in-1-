# PRISM native Windows host

`bin/PRISM-Lighting.exe` is a self-contained .NET 8.0.31 x64 executable. No separate .NET installation is required. `bin/WebView2Loader.dll` must remain next to it. The Microsoft Edge WebView2 Runtime must be installed; current Windows installations commonly include it.

The host accepts UTF-8 JSON lines on standard input and returns one JSON line per command. Run with `--stdio`. Requests contain `requestId` and `command`; responses contain the same `requestId`, `ok`, and either `result` or `error:{code,message}`.

- `enumerate`: reads compatible Windows LampArray devices and optional Corsair SDK devices. It sends no colors.
- `set`, `deviceId`, `colors`: sets one complete frame of packed `R | G << 8 | B << 16` values. Windows device IDs are below 10000; Corsair IDs start at 10000.
- `release`: disables this host's Windows output if it has written colors and disconnects the Corsair SDK session.
- `show`, `url`: opens the PRISM WebView2 window. Only `http://127.0.0.1:4783/` is accepted.

`--url=http://127.0.0.1:4783/` opens the same window on startup. `--user-data=<absolute path>` overrides the default WebView2 profile directory for isolated tests. The normal directory is `%LOCALAPPDATA%\PRISM\WebView2`. The host emits `{event:"windowClosed"}` when the window closes. Closing standard input releases both providers and exits.

Windows LampArray lighting is supported while this native PRISM window has foreground ownership. Unsupported hardware is not probed through USB, HID, SMBus or kernel drivers. Stream Deck/Elgato devices, including VID 0FD9, are excluded before LampArray access. No MSIX package, certificate, device driver or Windows policy is installed. The official `ILampArray2.IsAvailable` read-only COM property is used if Windows implements it; older Windows versions are constrained to foreground control.

The optional iCUE provider uses the manufacturer's Corsair SDK4 and requires iCUE. It requests all device categories, including keyboards, mice and supported third-party devices. Stream Deck and Elgato identities are excluded before LED/property calls. It uses shared LED access and never exclusive lighting, key interception or application priority changes. The Corsair SDK DLL is deliberately not redistributed in this installer. It can be obtained separately from Corsair after reviewing its license; the PRISM setup screen downloads the original manufacturer package. The host validates the pinned DLL hash before loading it. `PRISM_CUE_SDK_PATH` overrides the SDK path for isolated read-only development tests.

Enumeration also returns `discovery` entries for named devices that iCUE/Windows reports but cannot supply with usable LED data. They retain a reason and are never made controllable. A failed provider does not discard the other provider's device list. Top-level and provider-specific `warnings`/`excludedCount` expose discovery problems and protected-device exclusions.

Controller `channels` contain the manufacturer's configured device counts, series and LED counts (official SDK properties10–13). These describe **iCUE configuration**, which can include empty/virtual slots. They do not establish the number or complete model of physical fans/RAM modules. Only LED groups11/12/13 that completely partition returned IDs and agree with reported channel counts produce channel zones. IDs and corresponding colors are ordered identically by channel. Uncertain layouts retain a whole-controller zone; individual fan offsets are not guessed. Official SDK model names remain distinct from Windows PC inventory names.

Build source is provided in this directory. The project uses .NET SDK8 and references official Microsoft Windows SDK.NET.Ref10.0.26100.57 and Microsoft.Web.WebView2 1.0.4258.31 packages. Override `WindowsSdkReferencePath` and `WebViewSdkPath` at build time when those packages are located elsewhere. Runtime licenses are in `licenses/`.

Sources: [Microsoft Dynamic Lighting](https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/lighting-dynamic-lamparray), [Microsoft LampArray](https://learn.microsoft.com/en-us/uwp/api/windows.devices.lights.lamparray), [Microsoft WinRT ABI bindings](https://github.com/microsoft/windows-rs/blob/master/crates/libs/windows/src/Windows/Devices/Lights/mod.rs), [Microsoft WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/), [Corsair SDK](https://github.com/CorsairOfficial/cue-sdk).
