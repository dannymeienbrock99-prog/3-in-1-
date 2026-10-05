# Lian Li Windows lighting helper

This is PRISM's own Windows HID and WinUSB helper. Its protocol tables and lighting packet
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

Wired HID lighting is available through explicit native-effect requests only. ENE keeps
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

## Kabelgebundener Strimer Plus V2 · HID

`StrimerProtocol.cs` ergänzt den MIT-Encoder aus derselben oben genannten Quelle und demselben Commit. Die Lizenz liegt weiterhin unter `../licenses/lian-li-linux-MIT.txt`. Nur VID/PID `0CF2:A200`, HID-Interface 1, Usage `FF72/A1`, Feature/Input/Output-Berichtgrößen `7/65/255`, Firmwarepayload `E0 52 FF 40` sowie eine verifizierte zweite Kanalgruppe mit vier oder sechs Anschlüssen werden akzeptiert. Der Original-USB-Deskriptor ist über `../STRIMER-CAPABILITIES.md` verlinkt. Keine Treiber werden ersetzt.

25 native Modi werden für den gesamten Controller angeboten. Jede Ausgabe benötigt `controllerScope: "all"` und `confirmWholeController: true`, weil die Übernahme eine globale Kanalmaske verwendet. Vor Lichtpaketen wird die angeschlossene Kanalzahl erneut geprüft. Einzelne virtuelle Stränge können getrennt bearbeitet werden; eine getrennte native Ausgabe wird nicht behauptet. Es gibt keine Lüfter-, Pumpen-, PWM-, Mainboard-Sync- oder Leistungsbefehle. `--strimer-fixtures` erzeugt ausschließlich Paket-/Gate-Testdaten und öffnet keine Geräte. Eine sichtbare Ausgabe auf echter Strimer-Plus-V2-Hardware wurde in Batto nicht geprüft.

## Strimer Wireless · WinUSB

Der eigene Wireless-Modus (`--wireless`) verwendet den vorhandenen Windows-WinUSB-Treiber. Er erkennt V1-Sender `0416:8040` und Empfänger `0416:8041` sowie V2-Sender `1A86:E304` und Empfänger `1A86:E305`. Registry und SetupAPI liefern installierte Schnittstellen; USB-Deskriptor, Gerätetyp und Endpunkte OUT `01` / IN `81` werden vor Protokollzugriffen geprüft. Es werden keine Treiber installiert, Geräte zurückgesetzt oder fremde USB-Geräte geöffnet.

Die Geräteliste wird zweimal gelesen. Nur stabile, bereits gekoppelte Strimer-Kabel mit bekanntem Layout, eindeutigem Sender und ausgeschalteter Mainboard-Licht-Synchronisierung erhalten ein RGB-Ziel. Die reale lokale Metadatenabfrage lieferte GPU-Strimer mit **174 LEDs**, 24-Pin-Strimer mit **132 LEDs** und den Sender mit Produktkennung SLV3TX_V1.6. Das ist keine Prüfung sichtbarer Lichtfarben. Nicht verifizierte Kennungen und LED-Layouts bleiben gesperrt; die Kompatibilität weiterer Firmwareversionen wurde nicht an echter Hardware geprüft.

`enumerate` liest Funkmetadaten, `animation` überträgt eine vollständig geprüfte RGB-Schleife an genau ein Kabel. Vor jeder Übertragung werden Kopplung und Sync-Status erneut gelesen. Die **31 Softwareeffekte einschließlich eigener Muster** werden im Kabel abgespielt; die getrennte HID-Anbindung behält ihren **94-Modi-Katalog**. Pause/Aus benötigen eine Funkbestätigung. Das Schließen des Programms beendet eine bereits übertragene Schleife nicht. Es werden keine PWM-, Kopplungs-, Lüftergruppen-, Mainboard-Sync- oder Firmware-Befehle gesendet.

Die Kompression ist eine eigene begrenzte C#-Implementierung des tinyuz-Formats, mit Bezug auf [sisong/tinyuz](https://github.com/sisong/tinyuz/tree/1d74ffa4d453796df352df470733f45dfa099bb1), Commit `1d74ffa4d453796df352df470733f45dfa099bb1`. Die MIT-Lizenz liegt unter `../licenses/tinyuz-MIT.txt`. `--wireless-fixtures` erzeugt reine Protokoll-/Kompressions-Testdaten ohne Gerätezugriff. `--wireless-scan` führt ausschließlich die Geräte- und Metadatenabfrage aus, ohne Beleuchtung zu ändern.
