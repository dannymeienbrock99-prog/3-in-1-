# Batto 3-in-1

Ein Windows-Programm für **Batto OBS Tool 2.1, lokalen Jarvis und PC-Messwerte mit Lüfterbühne**. Oberfläche und Ansagen auf Deutsch, Ansprache „Sir Crazy“. Kamera- und Fingerverfolgung sind nicht enthalten.

## Funktionen

- OBS-Verbindung, Multi-Chat und vorhandene Creator-Werkzeuge aus OBS Tool 2.1.
- „Jarvis Pause“, „Jarvis Spiel“ oder ein vorhandener Szenenname: Zuordnung über die Oberfläche; Erfolg erst nach OBS-Bestätigung.
- Lokale deutsche Sprache mit Piper, Vosk-Wakeword und Whisper Small auf der CPU. Dauerhaftes Mikrofon optional. Keine Cloud-Sprachdienste.
- Moderator-Chat vorlesen: standardmäßig nur vom Anbieter bestätigte Moderatoren und Kanalinhaber; Plattformen, Benutzer-IDs, Länge und Abstand einstellbar. Chattexte werden nicht als Befehle ausgeführt.
- Jeder bereitgestellte PC-Messwert separat benennbar, ein-/ausblendbar und für Sprache sowie Grenzwert-/Änderungsmeldungen einstellbar. Hysterese und Mindestabstand pro Sensor.
- Windows: CPU-Auslastung und RAM. NVIDIA: verfügbare Temperatur, Fan-Prozentwerte, Auslastung, Leistungsaufnahme, VRAM und Takt. Weitere Werte über HWiNFO Shared Memory oder fortlaufende CSV-/Logdateien.
- OIP-Lüfterbild pro Kachel, Temperatur in der Mitte, frei verschiebbare Bühne, beide Crazy_Batto-Hintergründe oder Transparenz, Layoutimport/-export, lokale OBS-Browserquelle in 1920 × 1080.
- iCUE-Profilimport, gespeicherte Zuordnungen und Kurven; eigene Kurvenentwürfe mit Vorschau und Export.
- Echtes Stream-Deck-Paket: Lüfter, beliebiger Messwert, Jarvis-Befehl, Kurvenentwurf.
- Per-Benutzer-Installer mit Crazy_Batto-Bild und Deinstallation. Windows x64; keine Administratorrechte für den normalen Betrieb.

## Messwerte und Hardwaregrenzen

Es werden ausschließlich tatsächlich gelieferte Werte angezeigt. Fehlende oder veraltete Daten erscheinen als „—“. GPU-Lüfter-Prozentwerte sind keine RPM. Ein importiertes iCUE-Profil bestätigt keine aktuell angeschlossenen Geräte.

Für den **16-Pin-/12V-2x6-GPU-Anschluss** sind Stromstärke (A) und Spannung (V) getrennt. Einzelsensoren erscheinen nur bei vorhandener Messquelle. ASUS GPU Tweak Power Detector+ ist keine hier bestätigte direkte öffentliche Telemetrie-API; GPU-Kernspannung wird nicht als Pin-Spannung ausgegeben. HWiNFO-Freigabe oder passende laufende Protokolle werden gelesen, falls sie die Werte bereitstellen.

Die Suite schreibt **keine PWM-, Spannungs- oder Taktwerte** in Hardware. Kurven sind Entwürfe. Tatsächliche Kühlprofile bleiben in iCUE; auf dem Stream Deck kann die offizielle iCUE-Kühlungsaktion verwendet werden. Kein Treiber wird installiert, kein Herstellerdienst beendet, keine exklusive Controller-Verbindung geöffnet.

## Jarvis lernt lokal

Neue freigegebene Sensoren und vorhandene OBS-Szenen werden erkannt. Erfolgreiche Befehle werden als begrenztes lokales Gedächtnis gespeichert; dieses ist abschaltbar und löschbar. Allgemeine Fragen können optional an ein bereits installiertes lokales Ollama-Modell gehen (Port/Modell einstellbar, standardmäßig 11435 / qwen3:8b). Das Modell wird nach einer Antwort entladen. Es erhält keine Werkzeuge zur Hardwaresteuerung. Die Anwendung lädt nicht selbstständig Code herunter und programmiert sich nicht selbst um.

## Installation und Bedienung

Installer: `Batto-3-in-1-Setup-1.0.0.exe`. Plugin: `de.crazybatto.suite.streamDeckPlugin` (Stream Deck 6.5+). Detaillierte Anleitung: [ANLEITUNG.html](ANLEITUNG.html).

1. App starten, unter **PC-Messwerte** aktuelle Quellen prüfen. Weitere Sensoren per HWiNFO-Sensorfreigabe oder laufendem CSV-Protokoll verbinden.
2. Unter **Jarvis** Stimme/Mikrofon konfigurieren. Für Chat die Plattformen im Multi-Chat verbinden.
3. OBS lokal über WebSocket verbinden und Jarvis-Szenen zuordnen.
4. Lüfterbühne gestalten; OBS-Adresse als Browserquelle einfügen.
5. Stream-Deck-Paket installieren und pro Taste den gewünschten Sensor/Befehl auswählen.

Lokale Daten: `%LOCALAPPDATA%\CrazyBatto\BattoSuite`; OBS-/Chat-Konfiguration: `%APPDATA%\Batto 3-in-1`. Keine persönlichen Profile, Zugangsdaten, Protokolle oder Sprachaufnahmen werden mit diesem Repository ausgeliefert. Deinstallation erhält persönliche Einstellungen.

## Bauen

Windows x64, .NET SDK 8+, Node 24, Python **3.12 x64**, Inno Setup 7.1+. Auf einem sauberen Rechner:

```powershell
./Build.ps1 -PrepareVoice -InnoCompiler 'C:/Program Files (x86)/Inno Setup 7/ISCC.exe'
```

Beim ersten Build werden öffentliche Sprachmodelle und die gesperrten Abhängigkeiten heruntergeladen. Modelle und Laufzeiten gehören zum Installer, nicht ins Git-Repository. Mit bereits vorbereitetem `jarvis/python` und `jarvis/models` kann `-PrepareVoice` entfallen. Die ursprünglichen OBS-`prepare:integrated`-Generatoren nicht über die integrierte Suite laufen lassen: sie stammen aus dem Vorprojekt und können Oberflächenänderungen überschreiben.

`desktop`: Electron-Host mit bestehenden OBS-/Chat-Modulen. `jarvis/app`: lokale Sprachprozesse ohne Kamera. `components/fanatlas-src`: lesender .NET-Sensor- und Overlaydienst sowie natives Stream-Deck-Plugin. `streamdeck`: Manifest, Tastenbilder und Einstellungen. `installer`: Inno-Setup-Projekt.

Loopback-Verbindungen mit getrennten zufälligen Zugriffsschlüsseln: Suite 17656, Messwerte/Overlay 17658. Das Stream-Deck-Plugin liest nur lokale Verbindungsdateien. Der OBS-Leseschlüssel berechtigt nicht zu Steuereingriffen.

## Prüfung

Automatische Jarvis-Tests für rollenbasiertes Vorlesen, gezielte Messwertfragen, fehlende/veraltete Werte, Pin-Einheiten, OBS-Bestätigung, Grenzen und Meldeabstände. Bestehende OBS-/Chat-Tests bleiben erhalten. Der Sensor-Selbsttest prüft CSV-Teilzeilen, gleichzeitige Schreiber, beschädigte HWiNFO-Daten und Kurvenvalidierung. Oberflächentest verwendet getrennte Datenordner. Live-Tests mit fremden Streaming-Konten oder einem physischen Stream Deck sind davon getrennt und benötigen eingerichtete Verbindungen.

## Herkunft und Rechte

OBS-Quelle: `dannymeienbrock99-prog/Batto-OBS-Tool`, Branch `product/2.1.0-commercial-settings`, Commit `66c46a08ff4eb1d9cdeb651a4efeafd6aeed09eb`. FanAtlas und Jarvis wurden aus den eigenen Vorprojekten zusammengeführt. Das Windows-Utils-Beispielplugin und Herstellerinstaller werden nicht mitverteilt. Bereitgestellte Bilder bleiben ihren jeweiligen Rechteinhabern zugeordnet. [Drittanbieter und Modelle](THIRD-PARTY.md).
