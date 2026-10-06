# Herkunft und Drittanbieter

Die bestehenden Lizenzdateien in `desktop/build`, in den Python-`.dist-info`-Ordnern und in den mitgelieferten Laufzeiten bleiben erhalten. Bilder aus dem Benutzerauftrag sind keine allgemein freigegebene Bildbibliothek. Marken gehören ihren jeweiligen Inhabern.


- OBS-Anwendungsquellcode: https://github.com/dannymeienbrock99-prog/Batto-OBS-Tool (siehe README für Ausgangscommit).
- Electron: https://github.com/electron/electron/tree/v38.8.6 ; MIT, weitere Chromium-Hinweise in LICENSES.chromium.html.
- .NET: https://github.com/dotnet/runtime ; Laufzeithinweise werden mitgeliefert.
- Python: https://www.python.org/downloads/source/ ; Python-Lizenz liegt im Sprachpaket.
- Piper TTS: https://github.com/OHF-Voice/piper1-gpl ; Version 1.4.2, GPL-3.0. Das separate Sprachprogramm wird mit Lizenzhinweisen und öffentlichem Quellcodebezug verteilt. Paketabhängigkeiten inklusive eSpeak-Lizenzhinweisen bleiben im Sprachpaket erhalten.
- Piper-Stimme Thorsten Medium: https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE/thorsten/medium ; MODEL_CARD liegt beim Modell, Thorsten-Datensatz CC0. Keine Nachbildung eines Filmschauspielers.
- faster-whisper: https://github.com/SYSTRAN/faster-whisper ; MIT. Modell https://huggingface.co/Systran/faster-whisper-small , Ursprung OpenAI Whisper (MIT), https://github.com/openai/whisper.
- Vosk: https://github.com/alphacep/vosk-api ; Apache-2.0. Kleine deutsche/englische Modelle: https://alphacephei.com/vosk/models , Lizenzen/README beim jeweiligen Modell beachten.
- Weitere Python-Pakete: genaue Versionen in `jarvis/requirements-lock.txt`, Metadaten und Lizenzen im mitgelieferten `jarvis/python/Lib/site-packages`.
- Elgato SDK-Dokumentation und CLI werden zur Paketprüfung verwendet; das Beispiel Windows Utils wird nicht mitverteilt.
- HWiNFO-SM2-Struktur wird ausschließlich gelesen; kein HWiNFO-Programm oder Treiber ist enthalten. Herstellerbedingungen der Freigabe gelten unabhängig von dieser Anwendung.

## PRISM RGB in Batto 1.10.0

Die eingebaute PRISM-Oberfläche basiert auf dem eigenen [RGB-Tool-Quellstand 1.5.1](https://github.com/dannymeienbrock99-prog/RGB-Tool/tree/v1.5.1). Ihr Quellcode liegt unter `PRISM` im selben Release-Commit. Die Frontend-Lizenzkopien werden unter `resources/PRISM/licenses` mitgeliefert: React, React DOM und Scheduler (MIT), Lucide (ISC einschließlich enthaltener Feather-Hinweise) sowie Vite (MIT, Build-Werkzeug). Die genauen Paketversionen und Integritäten stehen in `PRISM/package-lock.json`.

Der separate Windows-Lichtdienst verwendet .NET 8.0.31, Microsoft Windows SDK.NET.Ref 10.0.26100.57, CsWinRT und WebView2 1.0.4258.31. Die mitgelieferten Laufzeit- und SDK-Lizenzhinweise liegen unter `resources/PRISM/native/licenses`; die festgelegten Downloads und SHA-256-Prüfsummen stehen in `scripts/prepare-rgb.ps1`. Die Suite verwendet ihre vorhandene Electron-/Node-Laufzeit für den RGB-Server.

Windows LampArray und die optionale offizielle [Corsair SDK](https://github.com/CorsairOfficial/cue-sdk) bestimmen die Lichtkompatibilität. Corsair-SDK-DLL und iCUE werden nicht mit diesem Installer verteilt; die Hersteller-SDK kann über PRISM gesondert eingerichtet werden. Die normale Lüfter-RPM-Anzeige verwendet bereits vorhandene HWiNFO-/CSV-Messquellen und enthält keinen zusätzlichen Hardwaretreiber. PC- und Lüfterbilder sind beispielhafte Darstellungen; vom Benutzer bereitgestellte Bilder und Marken behalten ihre jeweiligen Rechte.

## Touch Deck 1.8.0

- `qrcode` 1.5.4: QR-Codes werden lokal erzeugt; MIT, Copyright Ryan Day. [Quellcode](https://github.com/soldair/node-qrcode). Lizenzkopie `licenses/touch-deck/qrcode-MIT.txt`; Abhängigkeiten und ihre Lizenzen bleiben in den ausgelieferten npm-Paketen enthalten.
- `yauzl` 3.4.0: ZIP-Leser, MIT, Copyright Josh Wolfe. [Quellcode](https://github.com/thejoshwolfe/yauzl), genaue Paketversion und Integrität in `desktop/package-lock.json`. Lizenzkopie `licenses/touch-deck/yauzl-MIT.txt`.
- `pend` 1.2.0: Abhängigkeit des ZIP-Lesers, MIT, Copyright Andrew Kelley. [Quellcode](https://github.com/andrewrk/node-pend). Lizenzkopie `licenses/touch-deck/pend-MIT.txt`.
- `@resvg/resvg-js` und `@resvg/resvg-js-win32-x64-msvc` 2.6.2: SVG-Bildkonvertierung, Mozilla Public License 2.0. Unveränderte Bibliothek und natives Windows-Binärpaket aus npm; [zugehörige Quellen des Tags v2.6.2](https://github.com/thx/resvg-js/tree/v2.6.2) sind öffentlich erhältlich. Die ursprünglichen Rechte und MPL-2.0-Bedingungen gelten für diese Komponente; Lizenzkopie `licenses/touch-deck/resvg-js-MPL-2.0.txt`. Die im Upstream-Quellstand beschriebenen Rust-Abhängigkeiten behalten ihre jeweiligen Lizenzbedingungen.

Diese zusätzlichen Lizenzkopien liegen im Windows-Installer unter `resources/Extras/Touch-Deck-Licenses`. Die Android-App verwendet ausschließlich Android-Frameworkklassen und die auf dem Gerät vorhandene System-WebView; keine Chromium-Laufzeit wird in das APK eingebettet. [Android-App-Quellen](mobile/android) stehen in diesem Repository.

Vom Benutzer importierte `.streamDeckPlugin`- und `.streamDeckIconPack`-Pakete werden unter ihren eigenen Bedingungen genutzt. Das bereitgestellte LS25-Icon-Paket und fremde Beispielplugins werden weder ins Repository noch in den Installer übernommen. Importierte Pakete und Plugin-Zugangsdaten bleiben im lokalen Suite-Datenordner.

Herstellerprogramme iCUE, GPU Tweak, HWiNFO, OBS, Stream Deck und ein optionaler Ollama-Server werden nicht durch diesen Installer installiert oder verändert.

## Nativer Dual-Stream-Dienst
`components/dual-stream` / `BattoDualStream` ist ein separates Programm unter GPL-2.0-or-later; die Lizenz liegt bei dessen Quellcode. Vollständiger zugehöriger eigener Quellcode wird im selben Release-Commit veröffentlicht. Es verwendet die C-Schnittstelle der vom Benutzer lokal installierten OBS-32-Laufzeit: https://github.com/obsproject/obs-studio/tree/32.2.2 (GPL-2.0-or-later und enthaltene Drittanbieterhinweise). OBS-DLLs, Capture-Hooks und Plugins werden nicht mit diesem Installer verteilt. Vier bekannte Encoder-/Mux-Prüfhelfer werden beim Start aus der gewählten lokalen OBS-Installation in den Ordner des eigenen Dienstes kopiert, weil libobs sie dort erwartet. Die bestehende OBS-Installation und deren Konfiguration werden nur gelesen. Grafiken und übrige Suite-Module behalten ihre jeweiligen Rechte und Lizenzbedingungen.

## Virtuelle Kameras (1.5.0)
Unveränderte DirectShow-Leser-DLL aus OBS VirtualCam 2.1.2 (Miau Lightouch / CatxFish): https://github.com/miaulightouch/obs-virtual-cam/tree/2.1.2 . Zugehörige Quellen, Lizenz und Build-Dateien liegen im Installer unter resources/VirtualCam/sources. AVUtil und SWScale stammen aus FFmpeg n6.1.1, obs-deps 2024-03-19, GPL-3.0-or-later Build; vollständiges FFmpeg-Quellarchiv und obs-deps-Buildarchiv werden mitgeliefert. Downloads und SHA-256 stehen in scripts/prepare-virtualcam.py. Nur eigene benutzerspezifische Kameraregistrierungen werden bei Deinstallation entfernt.

## OBS Tool 2.4.7
Der eigene lokale Multi-Chat-Quellstand entspricht dem bereitgestellten 2.4.7-Installer. Die Originalquellen werden separat erhalten. Piper-Runtime, Modell, Lizenzen und Quellarchive dieses Programms werden unverändert mitgeliefert; Herkunft und Hashes stehen in desktop/vendor/piper/README.md und manifest.json.

## PRISM 1.7.0 · Hersteller-Anbindungen
Lian-Li-Protokoll und Effektzuordnungen: sgtaziz/lian-li-linux, Commit d335fdd459b0a308814497d36cf1d8c7dc1a782d, MIT; vollständige Lizenz unter PRISM/licenses/lian-li-linux-MIT.txt. Eigener Windows-HID-Helfer, keine Linux-Treiberinstallation.

MSI Mystic Light SDK 1.0.0.08: https://www.msi.com/Landing/mystic-light-rgb-gaming-pc/download . Die proprietäre SDK-DLL wird nicht verteilt. Bei ausdrücklicher Einrichtung lädt PRISM sie direkt vom Hersteller und prüft die fest hinterlegten SHA-256-Werte. Erfordert lokal installiertes Mystic Light.

Kingston-FURY-CTRL-Protokollreferenz: https://github.com/Beej126/KingstonFuryRgbCLI . Eigene unabhängige Dienstanbindung und Rijndael-256-Protokollcodec; das referenzierte CLI, FuryCTRL.dll und NTIOLib_X64.sys werden nicht eingebunden oder verteilt. Erfordert einen bereits installierten offiziellen Herstellerdienst. Die Anbindung ist experimentell und wurde mit verschlüsselten Protokoll-Testdaten geprüft.

Corsair iCUE SDK bleibt eine optionale, separat eingerichtete Hersteller-Anbindung. Das SDK liefert LED-Farbsteuerung, keinen vollständigen iCUE-Effektkatalog und keine Lüfterdrehzahlen/PWM-Regelung. Die 31 PRISM-Softwareeffekte einschließlich eigener Muster werden von unserer Software berechnet.

## Strimer Wireless · WinUSB und tinyuz

Die Funkpaket-Anordnung basiert ebenfalls auf [sgtaziz/lian-li-linux](https://github.com/sgtaziz/lian-li-linux/tree/d335fdd459b0a308814497d36cf1d8c7dc1a782d), Commit `d335fdd459b0a308814497d36cf1d8c7dc1a782d` (MIT). Die Lizenzkopie bleibt unter `PRISM/licenses/lian-li-linux-MIT.txt`. Die eigene Windows-Anbindung nutzt nur vorhandene WinUSB-Schnittstellen: L-Wireless V1 `0416:8040/8041`, V2 `1A86:E304/E305`; sie verteilt keinen Linux-/USB-Treiber und verändert keine Kopplung oder Kühlkurven.

Die begrenzte eigene C#-Kompression verwendet das tinyuz-Format nach [sisong/tinyuz](https://github.com/sisong/tinyuz/tree/1d74ffa4d453796df352df470733f45dfa099bb1), Commit `1d74ffa4d453796df352df470733f45dfa099bb1`, MIT, Copyright 2012–2022 housisong. Die vollständige Lizenzkopie wird unter `PRISM/licenses/tinyuz-MIT.txt` und im Installer unter `resources/PRISM/licenses` mitgeliefert. Es wird keine fremde tinyuz-Binärdatei eingebunden.

Gekoppelte Kabel mit bekannten Layouts erhalten die 31 Softwareeffekte einschließlich eigener Muster als lokal abgespielte Schleife. Der separate kabelgebundene Lian-Li-Katalog bleibt bei 94 Herstellermodi. Die lokale Metadatenabfrage bestätigte 132-/174-LED-Kabel, jedoch keine sichtbaren Hardwarefarben. Weitere Firmwareversionen sind nicht an echter Hardware geprüft. Pause und Aus benötigen eine Funkbestätigung; Programm schließen beendet die Schleife nicht. L-Connect wird separat für die vorhandene Kopplung benötigt und nicht mitverteilt.

## Optionale Desktop-Lüftersteuerung 1.15.0

Der separate Helfer enthält unveränderte LibreHardwareMonitorLib 0.9.6 (MPL-2.0) und ihre festgelegten Abhängigkeiten. Vollständige Lizenztexte, Paketreferenzen und Quellbezüge liegen unter resources/DesktopFanControl/licenses; die getrennten Bibliotheken bleiben austauschbar. Der PawnIO-Systemtreiber wird nicht mitgeliefert oder automatisch installiert. Originaler Helferquellcode: components/desktop-fan-control in diesem Repository.

Fan Control und FanControl.CorsairLink werden nur über ihre offiziellen Projektseiten verlinkt; ihre Programme und Plugins werden nicht gebündelt. AsusFanControl ist ein Notebook-Projekt und wird nicht ausgeführt oder verteilt.
