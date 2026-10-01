# Batto 3-in-1

Ein Windows-Programm für **Batto OBS Tool 2.4.7, lokalen Jarvis und PC-Messwerte mit Lüfterbühne**. Oberfläche und Ansagen auf Deutsch, Ansprache „Sir Crazy“. Kamera- und Fingerverfolgung sind nicht enthalten.

## Funktionen

**1.4.0 – Jarvis und vollständige Tastensteuerung:** Die Taste „Jarvis zuhören“ spricht deine einstellbare Begrüßung, öffnet danach das Mikrofon für einen Befehl und beendet das einmalige Zuhören nach Antwort oder Stille. Dauerhaftes Mikrofon bleibt optional. Unter **Jarvis → Jarvis-Einstellungen** stehen Stimme, Moderator-Chat, PC-/Lüftermeldungen, KI und Ereignis-Ansagen getrennt bereit. Geschenke: Name, Geschenk, Anzahl, übermittelter Coin-Wert; Serien erst nach Abschluss. Keine erfundene Euro-Umrechnung. Follower einzeln schaltbar. Likes werden je Zuschauer ab einem frei wählbaren Meilenstein (Standard 10.000) seit Programmstart/Zählerrücksetzung angesagt; ein Stream-Gesamtzähler wird keinem Benutzer zugerechnet. Meldungen haben Abstand, Duplikatschutz, höchstens acht wartende Einträge und 30 Sekunden Verfallszeit.

**Ein Plugin für Elgato und Creator Hub 1.8.6:** Acht Tastenarten: Lüfter, Messwert, Kurvenentwurf, Textbefehl, Zuhören, Szene/Übergang, Programmsteuerung und Kombination. Programmsteuerung bietet Streams, Ton, Spiel/Kamera/Mikrofon, Chat-/Ereigniseinblendung, Jarvis-Schalter, Bot-/Chat-Schalter, Auto-Broadcasts, gespeicherte Hotkeys, Aktionsketten, Medien, Chat-Verbindungen und alle Seiten. Kombinationen enthalten bis zu acht Aktionen; bei Fehler endet die Folge mit Rückmeldung. Das gleiche `.streamDeckPlugin` in Elgato installieren oder in Creator Hub importieren. Beide dürfen parallel laufen. Fremde Referenzprogramme/Plugins und deren Lizenzdaten werden nicht weiterverteilt.

**Eigener Sender:** Spiel, Pause, Start und Ende, eigene Hintergrundbilder, Schnitt oder Überblendung (100–2.000 ms), synchron auf beide Ausgaben schaltbar. Jarvis und Szenen-Tasten wählen den eigenen Sender, auch ohne OBS-WebSocket. Ein Szenenwechsel allein startet keine Aufnahme oder Übertragung. Native Chat-/Ereigniszeilen aktualisieren sich höchstens zweimal pro Sekunde; Bilder, Video und Ton aus gespeicherten Medien können im vorbereiteten Sender abgespielt werden (ein Medium gleichzeitig, maximal 120 Sekunden). Beliebige OBS-Plugin-Effekte, Browser-Widgets oder Szenensammlungen werden nicht automatisch importiert. Frühere OBS-Aktionen ohne unterstütztes Gegenstück melden dies ausdrücklich.

**Mit TikTok LIVE Studio:** Chat- und Ereignis-Adressen in Dual Stream kopieren und als Browserquellen in LIVE Studio einsetzen. Der eigene Video-Dienst darf aus bleiben. „LIVE-Studio-Sitzung markieren“ schaltet nur den Live-Zustand für Bot-Regeln/Auto-Broadcast, nicht LIVE Studio selbst. Die Markierung wird beim Programmstart zurückgesetzt. Native Batto-Szenentasten steuern den Batto-Sender; für Szenen innerhalb LIVE Studio dessen eigenes Plugin oder vorhandene Hotkey-Profile verwenden.

**Sparmodus:** Web-Widgets bleiben standardmäßig aus. Chat-Neuzeichnungen werden gebündelt, Sensorkacheln wiederverwendet und unveränderte Tastenbilder nicht erneut erzeugt. Jarvis schließt den ungenutzten Sprachdienst nach 60 Sekunden. Die optionale lokale KI nutzt im Gaming-Modus zwei CPU-Threads ohne GPU-Offload, begrenzten Kontext/Antwortumfang und wird danach entladen. Das gewählte Modell benötigt während einer Antwort weiterhin RAM; kein fester Verbrauchsdeckel. Hardware-Video-Encoding und LIVE Studio beanspruchen zusätzlich Ressourcen.


**1.3.0 – Dual Stream:** Neuer Bereich in der unveränderten Gold-/Marmor-Oberfläche. Eine TikTok-Leinwand (9:16), eine Twitch-Leinwand (16:9), gemeinsame Spiel-/Fenster-/Bildschirm- und Kameraquellen mit getrennten Layouts. Die mitgebrachte Projekt-Konfiguration ist integriert und importierbar. Sparprofil 720p30 oder optional 1080p30, H.264-Hardware-Encoding, getrennte Starts/Stopps und Ton-Stummschaltung. Stream-Keys werden mit Electron safeStorage/Windows verschlüsselt und nie im Projektexport ausgegeben. Keine Übernahme von Stream-Keys aus einem Chat-Login.

Der native Dienst lädt **lokal vorhandene OBS-32-Bibliotheken** (geprüft mit OBS 32.2.2); OBS Studio muss dabei nicht laufen. Die Bibliotheken gehören in dieser Version nicht zum Installer. Ein anderer vorhandener OBS-Ordner lässt sich auswählen. Der Dienst startet erst bei einer Geräteprüfung oder ausdrücklicher Vorbereitung/Start und endet nach einer Geräteprüfung sofort, sonst nach 60 Sekunden ohne laufende Ausgabe oder Vorschau-Abfrage. Er lädt ausschließlich Aufnahme-, Audio-, Encoder- und Ausgabemodule, keinen OBS-Browser oder die OBS-Oberfläche. Das Vorschaubild wird nur per Klick gelesen; es ist ausdrücklich keine laufende Vorschau. Streambilder bleiben im nativen Grafikpfad und laufen unabhängig davon mit 30 FPS.

**Einrichtung:** Dual Stream → Geräte erkennen → gewünschte Quellen auswählen und aktivieren → TikTok-/Twitch-Layout bearbeiten → speichern → Quellen vorbereiten → Vorschaubild aktualisieren. RTMP-/RTMPS-Server und Stream-Key direkt im Programm speichern, dann das jeweilige Ziel oder beide starten. Mikrofon und PC-Ton sind zunächst ausgeschaltet. Layout und Quellen können während einer laufenden Ausgabe nicht verändert werden. Jede Plattform kann unabhängig gestoppt oder stummgeschaltet werden. Seit 1.4.0 schalten Jarvis und Szenenaktionen die eigenen Szenen; ein automatischer Import beliebiger OBS-Szenensammlungen ist nicht enthalten.

**Geprüft:** Zwei gleichzeitige lokale NVENC-Ausgaben auf RTX 5080, getrennte Formate, 30 FPS, AAC 48 kHz Stereo, unabhängiges Stoppen, Neustart und Ton-Masken; native Aufnahme eines eigens erzeugten Testfensters; UI und verschlüsselte Schlüsselverwaltung mit getrennten Testdaten. Kein öffentlicher Twitch-/TikTok-Livestream und keine Leistungsersparnis gegenüber OBS im Spielebetrieb behauptet. TikTok-Sendeberechtigung und stabiler Upload sind weiterhin einzurichten/zu prüfen. Vorschlagsprofil: 6,46 Mbit/s plus Reserve, Full HD: 10,76 Mbit/s plus Reserve.

**1.2.3 – Sparmodus als Standard:** Web-Widgets werden erst mit **Widgets starten** im Multi-Chat geladen. Beim Verlassen des Chats oder Minimieren werden sie entladen, bei Rückkehr nach vorheriger Aktivierung erneut geladen. Eine externe Widget-Seite kann dabei ihre eigene Sitzung/Animationshistorie zurücksetzen. Unter **Einstellungen → Leistung sparen** lässt sich der automatische Start einschalten (höherer Verbrauch). Alle bisherigen Widget-Adressen bleiben gespeichert; Bot, Auto-Broadcast, lokale Chatnachrichten, OBS-Overlays und Jarvis-Warnungen laufen unabhängig davon weiter. Die Audio-Geräteliste wird erst beim Öffnen der Geräteauswahl oder „Geräte erkennen“ geladen. Der Messdienst läuft vollständig ohne zusätzliches Fenster oder Grafikbühne. Originalbilder und Grundgestaltung bleiben erhalten.

**1.2.2 – weniger Hintergrundarbeit:** Nur der sichtbare Zusatzbereich wird gezeichnet. Lüfterbilder bleiben bei Live-Aktualisierungen bestehen; der Messdienst baut keine unsichtbare Lüfterbühne oder Verlaufsgrafik mehr auf. Messwerte, OBS-Overlay, Stream Deck und Grenzwertmeldungen laufen weiter im 2-Sekunden-Takt. Die lokale Spracherkennung und Sprachausgabe nutzen je zwei Rechen-Threads; große Sprachmodelle werden nach 60 Sekunden ohne Auftrag beendet und beim nächsten Auftrag erneut geladen. Das spart Speicher, kann die erste Antwort nach längerer Ruhe etwas verzögern. Das optionale Aktivierungswort bleibt bei eingeschaltetem Mikrofon aktiv. Styles und Bilder des Originals bleiben erhalten.

- OBS-Verbindung, Multi-Chat und vorhandene Creator-Werkzeuge aus OBS Tool 2.1.
- „Jarvis Pause“, „Jarvis Spiel“ oder ein vorhandener Szenenname: Zuordnung über die Oberfläche; Erfolg erst nach bestätigter Szenenauswahl.
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

**1.2.1:** Unterstützt das tatsächliche iCUE-5-Protokollformat mit Einheiten in den Messwerten, z. B. `1650RPM` und `30.20°C`. LINK-Lüfter bleiben auch nach einem Wechsel des Hubs über ihre Seriennummer und gespeicherten Sensornamen zugeordnet. Protokollierung muss laufen; nach einem iCUE-Neustart bei fehlenden Werten erneut starten. Das Auswählen von Sensoren allein startet noch keine Messdatei.

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

Neue freigegebene Sensoren und eigene Szenen werden erkannt. Erfolgreiche Befehle werden als begrenztes lokales Gedächtnis gespeichert; dieses ist abschaltbar und löschbar. Allgemeine Fragen können optional an ein bereits installiertes lokales Ollama-Modell gehen (Port/Modell einstellbar, standardmäßig 11435 / qwen3:8b). Das Modell wird nach einer Antwort entladen. Es erhält keine Werkzeuge zur Hardwaresteuerung. Die Anwendung lädt nicht selbstständig Code herunter und programmiert sich nicht selbst um.

## Installation und Bedienung

Installer: `Batto-3-in-1-Setup-1.4.0.exe`. Plugin: `de.crazybatto.suite.streamDeckPlugin` (Stream Deck 6.5+). Detaillierte Anleitung: [ANLEITUNG.html](ANLEITUNG.html).

1. Links in der Seitenleiste bis **BATTO 3-IN-1** scrollen. App starten, unter **PC-Messwerte** aktuelle Quellen prüfen. Weitere Sensoren per HWiNFO-Sensorfreigabe oder laufendem CSV-Protokoll verbinden.
2. Unter **Jarvis** Stimme/Mikrofon konfigurieren. Für Chat die Plattformen im Multi-Chat verbinden.
3. Im eigenen Sender Quellen vorbereiten und Jarvis-Szenen zuordnen.
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
