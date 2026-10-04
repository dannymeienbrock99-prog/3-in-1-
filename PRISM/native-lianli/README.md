# Lian Li Windows lighting helper

This is PRISM's own Windows HID helper. Its protocol tables and lighting packet
layouts are adapted from [sgtaziz/lian-li-linux](https://github.com/sgtaziz/lian-li-linux)
at commit `d335fdd459b0a308814497d36cf1d8c7dc1a782d`. The original MIT notice is
included in `../licenses/lian-li-linux-MIT.txt`.

Supported HID identities are ENE `0CF2:A100` through `0CF2:A106`, with exact
model-specific firmware identity verification, and TL `0416:7372`, with a
validated handshake. The existing Windows HID driver is required. This helper
does not replace USB drivers, open unknown devices, install services or touch
Elgato / Stream Deck devices.

Enumeration queries firmware / RPM / TL handshake data. It does not send fan
quantity, grouping, PWM, merge, motherboard sync or lighting setup commands.
ENE endpoints represent actual controller ports; their connected fan count is
unknown because this protocol does not report it. Dual-ring controllers expose
separate inner and outer endpoints. TL endpoints contain only actual detected
fan IDs and RPM values; holes in the returned fan positions are preserved.

Lighting is available through explicit native-effect requests only. ENE keeps
the configured fan quantities intact. TL uses per-fan `0xA3` packets and checks
the live fan layout before applying them. TL group effects need additional
group configuration, so they are retained in the reference catalog with an
unavailable explanation. The reference catalog contains all 94 upstream mode
names, while each endpoint advertises only effects with a verified model and
ring mapping. No individual LED count or per-LED control is claimed.

`enumerate`, `effect` and `telemetry` are line-delimited JSON requests on stdin.
Responses on stdout contain the same `requestId`. `telemetry` does not replace
the current device session. A changed TL layout invalidates cached endpoints.
Successful effect writes report `transmitted: true`: the Windows HID transfer
succeeded; the protocol provides no measured lighting-state acknowledgement.

Build with .NET 8 for `win-x64`, publishing to `bin`. The executable embeds the
catalog from `../server/lianli-effects.json`; no third-party binary is required.
`PRISM-LianLi.exe --fixtures` generates protocol fixtures without enumerating or
opening any hardware. `../tests/lianli-lighting.test.mjs` checks those bytes plus
selection isolation, model/ring filters, invalid requests, zero RPM, timeouts
and changed layouts.
