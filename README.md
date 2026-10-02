# Batto 3-in-1 · 1.5.2

Windows-Programm mit der Gold-/Marmor-Oberfläche von Batto OBS Tool 2.4.7, Multi-Chat, lokalem Jarvis, PC-Messwerten und Lüfterbühne. Das Originalprojekt Multi-Chat bleibt unverändert.

## Virtuelle Kameras ohne Streamkey

Unter **Dual Stream** gewünschte Spiel-/Fenster-/Bildschirmquelle und Kamera auswählen. Das TikTok-Layout zeigt die Kamera über die gesamte obere Breite (48 % der Höhe); das Spiel liegt darunter. Alte Werkslayouts werden automatisch korrigiert. Eigene Layouts bleiben erhalten und lassen sich mit **Kamera oben, Spiel darunter** umstellen. Die Twitch-Leinwand bleibt unabhängig.

1. **Geräte erkennen**, Quellen zuordnen und aktivieren; Layout speichern.
2. **Kamera einschalten**: Die Vorschau startet nach der Geräteauswahl automatisch. Für gespeicherte Quellen **Vorschau starten** drücken.
3. **Kamera starten** oder **Beide Kameras starten**. In LIVE Studio **Batto TikTok**, für Querformat **Batto Twitch** als Kamera wählen. Falls Geräte fehlen: **Virtuelle Kameras einrichten**, dann die Kameraliste im Zielprogramm neu öffnen.
4. Mikrofon, PC-Ton und eigentlichen Sendestart direkt im Zielprogramm einstellen. Virtuelle Kameras transportieren nur Video. Medien-Ton wird ebenfalls nicht über das Kameragerät übertragen.

Der Installer richtet zwei DirectShow-Kameras für den aktuellen Windows-Benutzer ein. Bestehende funktionsfähige OBS-VirtualCam-Registrierungen werden erhalten und können deshalb „OBS-Camera“ / „OBS-Camera2“ heißen. Eine von einem anderen Sender belegte Kamera wird nicht übernommen. Die eingebaute OBS Virtual Camera bleibt unberührt.

Für die Bildkomposition werden weiterhin **lokal installierte OBS-32-Bibliotheken** verwendet (geprüft mit 32.2.2). Die OBS-Oberfläche muss nicht laufen; diese Bibliotheken sind nicht im Installer enthalten. Die reine Kameraausgabe benötigt keinen H.264-Encoder, Streamkey oder RTMP-Zugang. Encoder-Module werden dafür gar nicht geladen. Auflösung: 720p30, optional 1080p30. Quellen werden gemeinsam aufgenommen, Leinwände separat ausgegeben. Sparsame Vorschau mit einem Bild pro Sekunde, nur solange Dual Stream sichtbar ist. Sie lässt sich ganz abschalten. Der ungenutzte Video-Dienst endet nach 60 Sekunden.

## Weniger Speicher beim Spielen

**Dual Stream → Gaming-Modus** speichert das aktuelle Layout und schließt die Bedienoberfläche vollständig. Chat, Bot, Auto-Broadcast, Messdienst, Jarvis und gestartete Kameras laufen weiter. Mit Doppelklick auf das Batto-Symbol im Windows-Infobereich, erneutem App-Start oder der Stream-Deck-Aktion **Batto-Fenster anzeigen** kommt die Oberfläche zurück. Benachrichtigungstöne haben eine eigene kleine Wiedergabe, die nach fünf Sekunden Ruhe wieder entladen wird. Andere noch nicht gespeicherte Formulare vorher speichern. Beenden im Infobereich beendet auch die Dienste.

Web-Widgets starten standardmäßig nur auf Wunsch und werden beim Verlassen der Ansicht entladen. Die Vorschau pausiert in anderen Ansichten, bei minimiertem Fenster und im Gaming-Modus. Sprachmodelle werden nach Nutzung freigegeben. Optionale KI nutzt im Jarvis-Gaming-Sparmodus zwei CPU-Threads ohne GPU-Offload. Die tatsächliche Last hängt von Quellen, aktiven Diensten, KI-Modell und LIVE Studio ab.

## Jarvis, Szenen und Stream Deck

Jarvis spricht standardmäßig **keinen Namen** aus; die frühere voreingestellte Ansprache wird beim Laden entfernt. Begrüßung „Wie kann ich helfen?“ und optionale Ansprache stehen in **Jarvis → Jarvis-Einstellungen**. Taste **Jarvis zuhören** begrüßt dich, hört einen Befehl ab und beendet das einmalige Zuhören nach Antwort oder Stille.

Moderator-Chat, Geschenke, Follower und Like-Meilensteine bleiben einzeln einstellbar. Geschenke nennen Namen, Geschenk, Anzahl und übermittelte Coins nach Abschluss einer Serie; kein erfundener Euro-Wert. Likes zählen je Zuschauer, Standard 10.000. PC-Werte auf gezielte Nachfrage; Lüfterwarnungen standardmäßig beim Überschreiten von 80 %, mit Rücksetzabstand und Mindestpause.

Spiel, Pause, Start und Ende mit eigenen Bildern und Schnitt/Überblendung auf beiden Ausgaben. Die Tasten steuern Batto-Szenen, nicht die internen Szenen von LIVE Studio. **LIVE-Studio-Sitzung markieren** aktiviert nur die Live-Regeln für Bot/Auto-Broadcast. Eine gestartete virtuelle Kamera setzt diesen öffentlichen Live-Zustand nicht automatisch.

Ein Plugin für Elgato Stream Deck 6.5+ und Creator Hub 1.8.6: Lüfter, PC-Wert, Jarvis-Befehl, Zuhören, Kurvenentwurf, Szene/Übergang, Programmsteuerung und Kombinationen mit bis zu acht Aktionen. Programmsteuerung enthält Kamerastart/-stopp, Bildquellen, Einblendungen, Bot, Chat, Broadcast, Hotkeys und Gaming-Modus. Steuertasten und Plugin-Symbol verwenden ein Standbild aus dem gelieferten **02_Bin_gleich_zurueck.gif**; Lüfteranzeigen behalten das OIP-Bild. Unveränderte Tastenbilder werden nicht erneut erzeugt.

Die Windows-Kameraausgabe wurde mit zwei gleichzeitigen Testbildsendern und einem echten DirectShow-Empfänger geprüft: getrennte Formate, unabhängiges Stoppen und Neustart. Tests verwenden keine öffentlichen Streams. Physische Stream-Deck-Bedienung und ein Spiele-Livestream in LIVE Studio müssen mit den persönlichen Quellen eingerichtet werden.

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

Installer: `Batto-3-in-1-Setup-1.5.2.exe`. Plugin: `de.crazybatto.suite.streamDeckPlugin` (Stream Deck 6.5+). Detaillierte Anleitung: [ANLEITUNG.html](ANLEITUNG.html).

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
