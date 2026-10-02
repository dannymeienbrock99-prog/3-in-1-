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

Herstellerprogramme iCUE, GPU Tweak, HWiNFO, OBS, Stream Deck und ein optionaler Ollama-Server werden nicht durch diesen Installer installiert oder verändert.

## Nativer Dual-Stream-Dienst
`components/dual-stream` / `BattoDualStream` ist ein separates Programm unter GPL-2.0-or-later; die Lizenz liegt bei dessen Quellcode. Vollständiger zugehöriger eigener Quellcode wird im selben Release-Commit veröffentlicht. Es verwendet die C-Schnittstelle der vom Benutzer lokal installierten OBS-32-Laufzeit: https://github.com/obsproject/obs-studio/tree/32.2.2 (GPL-2.0-or-later und enthaltene Drittanbieterhinweise). OBS-DLLs, Capture-Hooks und Plugins werden nicht mit diesem Installer verteilt. Vier bekannte Encoder-/Mux-Prüfhelfer werden beim Start aus der gewählten lokalen OBS-Installation in den Ordner des eigenen Dienstes kopiert, weil libobs sie dort erwartet. Die bestehende OBS-Installation und deren Konfiguration werden nur gelesen. Grafiken und übrige Suite-Module behalten ihre jeweiligen Rechte und Lizenzbedingungen.

## Virtuelle Kameras (1.5.0)
Unveränderte DirectShow-Leser-DLL aus OBS VirtualCam 2.1.2 (Miau Lightouch / CatxFish): https://github.com/miaulightouch/obs-virtual-cam/tree/2.1.2 . Zugehörige Quellen, Lizenz und Build-Dateien liegen im Installer unter resources/VirtualCam/sources. AVUtil und SWScale stammen aus FFmpeg n6.1.1, obs-deps 2024-03-19, GPL-3.0-or-later Build; vollständiges FFmpeg-Quellarchiv und obs-deps-Buildarchiv werden mitgeliefert. Downloads und SHA-256 stehen in scripts/prepare-virtualcam.py. Nur eigene benutzerspezifische Kameraregistrierungen werden bei Deinstallation entfernt.

## OBS Tool 2.4.7
Der eigene lokale Multi-Chat-Quellstand entspricht dem bereitgestellten 2.4.7-Installer. Die Originalquellen werden separat erhalten. Piper-Runtime, Modell, Lizenzen und Quellarchive dieses Programms werden unverändert mitgeliefert; Herkunft und Hashes stehen in desktop/vendor/piper/README.md und manifest.json.
