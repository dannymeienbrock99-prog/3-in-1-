# Batto 3-in-1

Ein Windows-Programm für **Batto OBS Tool 2.4.7, lokalen Jarvis und PC-Messwerte mit Lüfterbühne**. Oberfläche und Ansagen auf Deutsch, Ansprache „Sir Crazy“. Kamera- und Fingerverfolgung sind nicht enthalten.

## Funktionen

- OBS-Verbindung, Multi-Chat und vorhandene Creator-Werkzeuge aus OBS Tool 2.1.
- „Jarvis Pause“, „Jarvis Spiel“ oder ein vorhandener Szenenname: Zuordnung über die Oberfläche; Erfolg erst nach OBS-Bestätigung.
- Lokale deutsche Sprache mit Piper, Vosk-Wakeword und Whisper Small auf der CPU. Dauerhaftes Mikrofon optional. Keine Cloud-Sprachdienste.
- Moderator-Chat vorlesen: standardmäßig nur vom Anbieter bestätigte Moderatoren und Kanalinhaber; Plattformen, Benutzer-IDs, Länge und Abstand einstellbar. Chattexte werden nicht als Befehle ausgeführt.
- Jeder bereitgestellte PC-Messwert separat benennbar, ein-/ausblendbar und für Sprache sowie Grenzwert-/Änderungsmeldungen einstellbar. Hysterese und Mindestabstand pro Sensor.
- Windows: CPU-Auslastung und RAM. NVIDIA: verfügbare Temperatur, Auslastung, Leistungsaufnahme, VRAM und Takt. Weitere Werte über HWiNFO Shared Memory oder fortlaufende CSV-/Logdateien.
- OIP-Lüfterbild pro Kachel, Prozent in der Mitte (Temperatur / U/min wählbar), frei verschiebbare Bühne, beide Crazy_Batto-Hintergründe oder Transparenz, Layoutimport/-export, lokale OBS-Browserquelle in 1920 × 1080.
- Automatisches Lesen des lokalen iCUE-Standardprofils und optionaler Profilimport; gespeicherte LINK-Lüfter werden nach Geräte-ID zusammengeführt, GPU-Lüfter ausgeschlossen; eigene Kurvenentwürfe mit Vorschau und Export.
- Echtes Stream-Deck-Paket: Lüfter, beliebiger Messwert, Jarvis-Befehl, Kurvenentwurf.
- Per-Benutzer-Installer mit Crazy_Batto-Bild und Deinstallation. Windows x64; keine Administratorrechte für den normalen Betrieb.

## iCUE LINK einrichten

Die Lüfterbühne liest das gespeicherte lokale Standardprofil und vorhandene iCUE-Sensornamen automatisch. Profilzuordnungen werden ausdrücklich nicht als bestätigte Live-Verbindung bezeichnet. Es werden keine GPU-Lüfter erzeugt. Der mittige Messwert sitzt auf der Lüfternabe des OIP-Bildes, Auswahlrahmen ändern die Geometrie nicht. „Gleichmäßig ausrichten“ ordnet bis zu 32 Kacheln im Raster an.

Für echte Drehzahlen und Temperaturen in iCUE **Einstellungen → Sensorprotokollierung** öffnen, die gewünschten LINK-Sensoren auswählen, 2 Sekunden Intervall einstellen und die Protokollierung starten. Aktive `corsair_cue_*.csv` in Dokumente und Temp werden automatisch erkannt; andere Dateien über **PC-Messwerte → Sensor-CSV** wählen. Jede Temperatur und Drehzahl lässt sich dem richtigen Lüfter zuordnen. Fehlende Zuordnungen bleiben leer. Die CSV wird mit Freigabe für den gleichzeitigen iCUE-Schreibzugriff gelesen.

## Prozentwerte und hohe Lüfterdrehzahlen

Pro Lüfter einen echten Prozent-Sensor zuordnen oder die bekannte Drehzahl bei 100 % eintragen. Bei letzterem werden U/min ÷ Referenz × 100 als **Anteil der Maximaldrehzahl** angezeigt; das ist kein gemessener PWM-Steuerwert. Keine Referenz wird geraten. Ohne aktuelle Messwerte bleiben Prozent und Drehzahl leer. Derselbe Bezug gilt in der App, im OBS-Overlay, auf dem Stream Deck und für Jarvis.

Unter Jarvis ist die Lüftermeldung ab **80 %** voreingestellt und auf z. B. 75 oder 95 % änderbar. Eine Meldung beim Erreichen der Schwelle; erneut erst nach einem Rückgang (standardmäßig 5 Prozentpunkte) und neuem Anstieg. Die Mindestpause von 90 Sekunden verhindert weitere Meldungen bei schnellen Schwankungen, ist kein Wiederholungsintervall. Messunterbrechungen, Neustarts und Änderungen anderer Einstellungen lösen keine Wiederholung aus. Jeder Lüfter ist separat von Ansagen ausnehmbar. „Jarvis Lüfterdrehzahl“ liest U/min vor; „Wie schnell sind die Lüfter in Prozent?“ liest Prozentwerte vor.

## Übernahme aus Batto OBS Tool

Beim ersten regulären Start von 1.2.0 wird `%APPDATA%/batto-obs-tool/Batto-OBS-Tool` in die eigene Suite-Konfiguration übernommen: Einstellungen inklusive Bot/Auto-Broadcast, Medien, Profile, Daten und verschlüsselte Zugangsdaten. Das Original wird nur gelesen. Eine vorhandene Suite-Konfiguration wird vorher in `obs-before-import-*` im Suite-Datenordner gesichert. Die Seite Jarvis zeigt den Importstatus und erlaubt eine erneute Übernahme beim nächsten Start. Die Suite behält die separaten lokalen Ports 17787/17788; ihre Overlay- und Stream-Deck-Adressen sind deshalb neu zu übernehmen. Browser-Sitzungen werden nicht kopiert; eingebettete Anbieter können eine erneute Anmeldung verlangen. Persönliche Dateien gelangen nicht ins Repository oder den Installer.

## Messwerte und Hardwaregrenzen

Es werden ausschließlich tatsächlich gelieferte Werte angezeigt. Fehlende oder veraltete Daten erscheinen als „—“. Ein importiertes iCUE-Profil bestätigt keine aktuell angeschlossenen Geräte.

Für den **16-Pin-/12V-2x6-GPU-Anschluss** sind Stromstärke (A) und Spannung (V) getrennt. Einzelsensoren erscheinen nur bei vorhandener Messquelle. ASUS GPU Tweak Power Detector+ ist keine hier bestätigte direkte öffentliche Telemetrie-API; GPU-Kernspannung wird nicht als Pin-Spannung ausgegeben. HWiNFO-Freigabe oder passende laufende Protokolle werden gelesen, falls sie die Werte bereitstellen.

Die Suite schreibt **keine PWM-, Spannungs- oder Taktwerte** in Hardware. Kurven sind Entwürfe. Tatsächliche Kühlprofile bleiben in iCUE; auf dem Stream Deck kann die offizielle iCUE-Kühlungsaktion verwendet werden. Kein Treiber wird installiert, kein Herstellerdienst beendet, keine exklusive Controller-Verbindung geöffnet.

## Jarvis lernt lokal

Neue freigegebene Sensoren und vorhandene OBS-Szenen werden erkannt. Erfolgreiche Befehle werden als begrenztes lokales Gedächtnis gespeichert; dieses ist abschaltbar und löschbar. Allgemeine Fragen können optional an ein bereits installiertes lokales Ollama-Modell gehen (Port/Modell einstellbar, standardmäßig 11435 / qwen3:8b). Das Modell wird nach einer Antwort entladen. Es erhält keine Werkzeuge zur Hardwaresteuerung. Die Anwendung lädt nicht selbstständig Code herunter und programmiert sich nicht selbst um.

## Installation und Bedienung

Installer: `Batto-3-in-1-Setup-1.2.0.exe`. Plugin: `de.crazybatto.suite.streamDeckPlugin` (Stream Deck 6.5+). Detaillierte Anleitung: [ANLEITUNG.html](ANLEITUNG.html).

1. Links in der Seitenleiste bis **BATTO 3-IN-1** scrollen. App starten, unter **PC-Messwerte** aktuelle Quellen prüfen. Weitere Sensoren per HWiNFO-Sensorfreigabe oder laufendem CSV-Protokoll verbinden.
2. Unter **Jarvis** Stimme/Mikrofon konfigurieren. Für Chat die Plattformen im Multi-Chat verbinden.
3. OBS lokal über WebSocket verbinden und Jarvis-Szenen zuordnen.
4. Lüfterbühne gestalten; OBS-Adresse als Browserquelle einfügen.
5. Stream-Deck-Paket installieren und pro Taste den gewünschten Sensor/Befehl auswählen.

Lokale Daten: `%LOCALAPPDATA%\CrazyBatto\BattoSuite`; OBS-/Chat-Konfiguration: `%APPDATA%\Batto3in1-v247`. Keine persönlichen Profile, Zugangsdaten, Protokolle oder Sprachaufnahmen werden mit diesem Repository ausgeliefert. Deinstallation erhält persönliche Einstellungen.

## Bauen

Windows x64, .NET SDK 8+, Node 24, Python **3.12 x64**, Inno Setup 7.1+. Auf einem sauberen Rechner:

```powershell
./Build.ps1 -PrepareVoice -InnoCompiler 'C:/Program Files (x86)/Inno Setup 7/ISCC.exe'
```

Beim ersten Build werden öffentliche Sprachmodelle und die gesperrten Abhängigkeiten heruntergeladen. Modelle und Laufzeiten gehören zum Installer, nicht ins Git-Repository. Mit bereits vorbereitetem `jarvis/python` und `jarvis/models` kann `-PrepareVoice` entfallen. Der separate originale Piper-Helfer aus OBS Tool 2.4.7 wird ebenfalls anhand fester SHA-256-Prüfsummen vorbereitet.

`desktop`: Electron-Host mit bestehenden OBS-/Chat-Modulen. `jarvis/app`: lokale Sprachprozesse ohne Kamera. `components/fanatlas-src`: lesender .NET-Sensor- und Overlaydienst sowie natives Stream-Deck-Plugin. `streamdeck`: Manifest, Tastenbilder und Einstellungen. `installer`: Inno-Setup-Projekt.

Loopback-Verbindungen mit getrennten zufälligen Zugriffsschlüsseln: Suite 17656, Messwerte/Overlay 17658, Multi-Chat-Overlay 17787, Navigation 17788. Das Stream-Deck-Plugin liest nur lokale Verbindungsdateien. Der OBS-Leseschlüssel berechtigt nicht zu Steuereingriffen.

## Prüfung

Automatische Jarvis-Tests für rollenbasiertes Vorlesen, gezielte Messwertfragen, fehlende/veraltete Werte, Pin-Einheiten, OBS-Bestätigung, Grenzen und Meldeabstände. Die Tests des übernommenen OBS-2.4.7-Quellstands prüfen unter anderem Chat, Match-Anzeige, Broadcast und Piper. Der Sensor-Selbsttest prüft CSV-Teilzeilen, gleichzeitige Schreiber, beschädigte HWiNFO-Daten und Kurvenvalidierung. Oberflächentest verwendet getrennte Datenordner. Live-Tests mit fremden Streaming-Konten oder einem physischen Stream Deck sind davon getrennt und benötigen eingerichtete Verbindungen.

## Herkunft und Rechte

OBS-Quelle: der eigene lokale Multi-Chat-Quellstand zu `Batto-OBS-Tool-2.1-Setup-2.4.7.exe`, auf Basis des Multi-Chat-Commits `ced4ff2`. Renderer, Styles und Hauptprozess wurden mit dem entpackten 2.4.7-Installer verglichen. Das Originalrepository `Multi-Chat` und die ursprüngliche lokale Arbeitskopie werden nicht verändert. Die unveränderten Styles und Hauptbilder sind in `desktop/reference-2.4.7.json` geprüft. FanAtlas und Jarvis wurden aus den eigenen Vorprojekten zusammengeführt. Das Windows-Utils-Beispielplugin und Herstellerinstaller werden nicht mitverteilt. Bereitgestellte Bilder bleiben ihren jeweiligen Rechteinhabern zugeordnet. [Drittanbieter und Modelle](THIRD-PARTY.md).
