# Batto 3-in-1 · Schnellstart 1.14.0

## Streamer.bot auf diesem PC einrichten

1. Links **Streamer.bot** öffnen und **Automatisch einrichten** drücken. Wird nichts gefunden, **Streamer.bot.exe auswählen** und die Datei deiner vorhandenen Installation wählen.
2. **Streamer.bot starten** öffnet den Bot. Eine bereits laufende Instanz wird weiterverwendet. Falls der Status keinen eingerichteten Server erkennt, den WebSocket-Server in Streamer.bot einschalten. Eine vorhandene lokale Serveradresse wird übernommen.
3. Unter **Streamer.bot verbinden** bei Bedarf das Server-Passwort eingeben und **Speichern & verbinden** drücken. **Beim Programmstart verbinden** speichert die automatische Verbindung; der lokale Bot wird dadurch nicht automatisch gestartet.
4. **Aktionen laden**, eine aktivierte Aktion auswählen und mit **Nur Vorschau** zuerst Aktions-ID und Nachrichtentext kontrollieren. **Jetzt wirklich ausführen** sendet die Aktion. Eine angenommene Aktion bestätigt noch keine Nachrichtenzustellung im TikTok-Chat.

Bei einem Start- oder Einrichtungsfehler steht der Hinweis direkt im lokalen Bereich. Danach kannst du erneut versuchen oder die richtige Datei auswählen. Ein abgebrochener Dateidialog behält die bisherige Auswahl. Zugangsdaten aus Streamer.bot-Dateien werden nicht in die Oberfläche übernommen.

## Touch-Tasten anordnen und Profile hinzufügen

Unter **Touch Deck → Tasten bearbeiten** belegte Tasten ziehen, mit **Alt + Pfeiltaste** verschieben oder im Editor **Neue Position → Taste verschieben** wählen. Bei einem belegten Ziel rücken andere Tasten weiter; **Tasten tauschen** tauscht nur die beiden Positionen. **Taste löschen & Lücke schließen** entfernt die Taste nach Bestätigung und ordnet die übrigen Tasten neu. Im Bedienmodus endet das Raster an der letzten belegten Taste; im Editor bleibt zusätzlich ein freier Platz. **Alle freien Plätze zeigen** öffnet das gesamte Raster. Vor dem Bedienen Änderungen speichern.

**Stream-Deck-Profil hinzufügen** lädt unterstützte `.streamDeckProfile`-Dateien oder Profil-ZIPs als zusätzliche Profile. Belegte Seiten, Ordner, Bilder und Plugin-Zuordnungen werden übernommen. Die bisherige Belegung wird gesichert; Hinweise nennen fehlende Plugins oder Funktionen. Pluginpakete zuerst unter **Plugins & Icons → Paket laden** hinzufügen und Verbindungen beziehungsweise Konten im jeweiligen Plugin einrichten.

**Plugins & Icons → Mit Elgato öffnen** übergibt ein Plugin, Icon-Paket oder Profil an deine installierte Elgato-Software; die Installation dort abschließen. Geschützte Profile und manche Hersteller- oder Gerätefunktionen benötigen diese originale Laufzeit. Eine importierte Taste allein bestätigt nicht, dass ein fremdes Plugin im Batto Touch Deck vollständig funktioniert.

## OBS-Importe entfernen und Stream prüfen

Unter **Dual Stream → OBS-Szenensammlung** löscht **Szene entfernen** eine einzelne importierte Szene. **Importierte Medien und Übergänge verwalten** bietet **Quelle entfernen** und **Übergang entfernen**. Eine Medienquelle wird aus allen importierten Szenen entfernt, die diese Quelle benutzen; andere gemeinsame Quellen bleiben erhalten. **Alle OBS-Importe entfernen** entfernt Szenen und Videoübergänge aus Batto. Vorher virtuelle Kameras stoppen. Die ursprünglichen Dateien und die Sammlung in OBS bleiben auf dem PC. Ein entfernter aktiver Szeneneintrag wechselt zu **Spiel**, ein entfernter aktiver Videoübergang zu **Überblendung**; die Aufnahme startet dadurch nicht.

Für den Stream die gewünschte **Bildschirmaufnahme**, **Fensteraufnahme** oder **Spielaufnahme** sowie deine Kamera auswählen. **Vorschau → Kamera & Spiel prüfen** zeigt die Quellen; TikTok und Twitch behalten ihre eigenen Anordnungen. Für beide Formate eignet sich **Überblendung**. Danach virtuelle Kamera starten und in LIVE Studio beziehungsweise deiner Sendesoftware **Batto TikTok** oder **Batto Twitch** auswählen. Mikrofon und PC-Ton dort einstellen. Der öffentliche Stream wird in der Sendesoftware gestartet. **LIVE-Studio-Sitzung markieren** aktiviert nur Batto-Regeln für eine laufende Sitzung.

Bei **Bildschirmaufnahme → Aufnahmeverfahren** stehen **Automatisch**, **Windows-Aufnahme** und **DirectX-Aufnahme** zur Wahl. Bleibt der Bildschirm schwarz, **Windows-Aufnahme** wählen und die Vorschau erneut starten. Die Auswahl wird gespeichert; Kameras und beide Layouts behalten ihre Einstellungen. Eine neue Bildschirmaufnahme kann einige Sekunden benötigen.

## Eigene Nachrichten und Moderatoren vorlesen

Unter **Jarvis → Nachrichten aus dem Chat vorlesen** als Quelle **Nachrichten aus dem Multi-Chat-Fenster** und als Personenauswahl **Moderatoren & Kanalinhaber** wählen. **Chat-Regeln speichern** übernimmt die Einstellung. Jarvis berücksichtigt die bestätigten Rollen und Benutzer-IDs aus dem verbundenen Twitch-, TikTok- oder YouTube-Chat, einschließlich eigener Kanalnachrichten. Der Anzeigename allein reicht nicht. Das Fenster muss nicht ständig sichtbar sein. Mehrere kurze Nachrichten werden mit dem gewählten Abstand in einer begrenzten Warteschlange vorgelesen; Filtertreffer und doppelte Nachrichten bleiben stumm. Der Chattext führt keine Jarvis-Befehle aus.

Die RGB-Oberfläche bleibt **PRISM 1.7.0**. Vorhandene Lichtprofile und die bisherigen RGB-Anleitungen gelten weiter.

## Strimer Wireless einstellen

1. Strimer-Kabel in L-Connect mit dem vorhandenen L-Wireless-Sender koppeln. Mainboard-Licht-Synchronisierung dort ausschalten.
2. In Batto **RGB-Steuerung → Geräte suchen** öffnen. Unterstützt werden V1-Sender/Empfänger `0416:8040/8041` und V2 `1A86:E304/E305` mit bereits vorhandenem WinUSB-Treiber. Bei USB-Zugriffsfehlern L-Connect schließen und erneut suchen. Unbekannte Gerätekennungen und LED-Anordnungen bleiben gesperrt.
3. Das angezeigte Kabel wählen und einen der **31 Softwareeffekte** anwenden. **Eigener Effekt** bietet bis zu acht Farben, Farbverlauf oder Farbblöcke, Bewegung, Wiederholung, Umlaufzeit, Richtung und Puls. Profile speichern auch diese eigenen Einstellungen.

Der Effekt wird als Schleife an das Kabel übertragen. Eine erfolgreiche Übertragung wird von einer Bestätigung des Funkempfängers unterschieden. **Pause** und **Aus** werden erst nach dieser Bestätigung als erledigt angezeigt. Beim Schließen des Programms läuft die Kabelschleife weiter; vorher **Aus** anwenden, wenn das Licht ausgehen soll. Jarvis erhält eigene Effekte beim Wiedereinschalten und bei Helligkeitsänderungen.

Die lokale Geräteabfrage bestätigte ein GPU-Strimer mit **174 LEDs** und ein 24-Pin-Strimer mit **132 LEDs**. Es wurde keine sichtbare Lichtfarbe an Hardware geprüft. Weitere Firmwareversionen sind noch nicht an echter Hardware geprüft. Der Installer verändert keine USB-Treiber, Kopplung, PWM oder Lüfterkurven. Der **94-Effekt-Katalog für kabelgebundene Lian-Li-Controller** bleibt erhalten.

## RGB-Neuerungen
Öffne **RGB-Steuerung**. Alle 30 bisherigen Effekte bleiben vorhanden; insgesamt gibt es jetzt 31 PRISM-Effekte einschließlich **Eigener Effekt**. Unter **Effekte deiner Geräte** stehen außerdem die vom erkannten Gerät unterstützten Herstellereffekte. Du kannst einzelne RAM-Riegel/Anschlüsse oder mit der ausdrücklich beschrifteten Schaltfläche alle passenden Ziele einstellen.

Für MSI unter **RGB verbinden → MSI-Anbindung einrichten** dem einmaligen Download zustimmen und MSI Center mit Mystic Light öffnen. Für Kingston muss der offizielle FURY-CTRL-Dienst laufen; diese Anbindung ist experimentell. Kabelgebundene Lian-Li-HID-Controller bieten passende Herstellermodi; gekoppelte Strimer-Wireless-Kabel bieten Softwareeffekte über WinUSB. Nicht verfügbare Einträge im 94-Effekt-Katalog erklären die jeweilige Einschränkung. Aktuelle Drehzahlen stehen bei unterstützten Lüftercontrollern.

Die MSI-Vorschau nutzt das bereitgestellte Mainboard-Bild und zeigt die tatsächlich erkannten RAM-Riegel samt Namen und Kapazität. PC-Erkennung allein bestätigt keine RGB-Steuerung.

## RGB direkt in Batto einstellen

In der Seitenleiste **RGB-Steuerung** öffnen. Die eingebaute PRISM-Ansicht bietet Farben, Helligkeit, 31 PRISM-Effekte und speicherbare Lichtprofile. Die 14 bisherigen Effekte und Profile bleiben erhalten. Für echte Beleuchtung zuerst die unterstützten Geräte verbinden. Windows LampArray, Corsair iCUE, MSI Mystic Light, der offizielle Kingston-FURY-CTRL-Dienst und unterstützte Lian-Li-HID-Controller stellen die jeweilige Lichtverbindung bereit. Die Ansicht nennt fehlende Voraussetzungen und bietet passende Herstellereffekte unter **Effekte deiner Geräte**. Ein erkannter Komponentenname bestätigt noch keine steuerbare RGB-Verbindung. Stream Deck und Elgato-Geräte werden von der RGB-Geräteansprache ausgeschlossen.

Die PC-Übersicht zeigt die erkannten Namen. Für MSI erscheint die MSI-Vorschau, für ASUS der White Build mit weißen Lüftern, RAM, Grafikkarte und Kühlung. Bei anderen Herstellern erscheint die allgemeine Vorschau. Die Bilder dienen als Beispielaufbau.

Jarvis-Befehle: **„Öffne RGB-Steuerung“**, **„RGB blau“**, **„RGB Effekt Regenbogen“**, **„RGB Effekt Komet“**, **„RGB Helligkeit auf 50 Prozent“**, **„RGB aus“**, **„RGB an“** und **„RGB Status“**. Bei einer Farbe wechselt das Licht auf statisch. Eine fehlende Geräteverbindung wird gemeldet. Die RGB-Oberfläche wird beim Öffnen geladen.

## Normale Lüfter rechts anzeigen

Unter **Deine iCUE-LINK-Lüfter** die Option **Normale Lüfter anzeigen** einschalten. Aktuelle normale Lüfter-Drehzahlen werden zusätzlich rechts angezeigt. Dafür eine bestehende Messquelle unter **PC-Messwerte** verwenden, beispielsweise HWiNFO-Sensorfreigabe oder ein laufendes CSV-Protokoll.

Für eine eigene Kachel **Normalen Lüfter hinzufügen** drücken, Name und **Drehzahlsensor (U/min)** wählen und **Lüfter speichern**. Kacheln lassen sich frei verschieben. **Gleichmäßig ausrichten** ordnet LINK links und normale Lüfter rechts an. Ausblenden erhält die gespeicherten Kacheln.

Fehlende oder veraltete Werte zeigen **—**; ein gemessener Stillstand zeigt **0 RPM**. Jarvis liest mit **„Normale Lüfter RPM“** nur normale Lüfter, mit **„Lüfterdrehzahl“** alle verfügbaren und mit **„iCUE LINK Lüfterdrehzahl“** nur LINK-Lüfter vor. Die RPM-Anzeige verändert keine Hardware-Kühlkurven; diese weiterhin im Herstellerprogramm einstellen.

## Lüfterkurven repariert · 1.9.3

Der Kurveneditor zeigt alle Punkte ohne abgeschnittene innere Liste. Spaltenüberschriften passen zu Temperatur und Lüfterleistung; die Bedienelemente eignen sich auch für Touch. Leere Werte, doppelte Temperaturen und ungültige Prozentwerte werden angezeigt. Die Kurve wird nach Temperatur geordnet.

Ungespeicherte Änderungen bleiben beim Aktualisieren erhalten. Kopieren und Exportieren verwenden die sichtbare Kurve. Fehlgeschlagenes Speichern verändert keine bisherigen Einstellungen. In den Profilzuordnungen lässt sich die zugehörige Kurve direkt ansehen; beim erneuten Profilimport bleiben bekannte Lüfternamen erhalten.

**Wertetabelle kopieren → iCUE öffnen** hilft beim Übertragen: In iCUE beim Gerät unter Kühlung eine eigene Kurve erstellen, Temperaturbezug und Punkte eintragen und den gewünschten Lüftern zuordnen. Der JSON-Export ist ein Batto-Entwurf, keine importierbare iCUE-Profildatei. Die öffentliche Corsair-Schnittstelle bietet keinen dokumentierten Schreibzugriff auf Kühlkurven; echte Kühlprofilwechsel bleiben in iCUE beziehungsweise der offiziellen Corsair-Stream-Deck-Aktion.

## OBS-Sammlungen direkt auswählen · 1.9.2

Unter **Dual Stream → Direkt aus OBS** eine auf diesem PC gespeicherte Sammlung auswählen, **Szenen prüfen** und anschließend **Sammlung übernehmen** drücken. Die Auswahl lädt nur die Vorschau; erst das Übernehmen ersetzt die importierten Szenen und erstellt eine Sicherung der bisherigen Dual-Stream-Einstellungen. Kameras und Ausgaben starten dabei nicht automatisch.

Der Dateidialog öffnet den OBS-Szenenordner. Unpassende JSON-Dateien, Batto-Projekte und zu große Sammlungen erhalten getrennte Hinweise. Batto-Projekte werden weiterhin über **Projekt importieren** geöffnet. Der technische Fehlertext „Error invoking remote method“ wird ausgeblendet. Der neue Auswahlweg fragt OBS-Dateien nur beim Öffnen ab und benötigt keinen laufenden OBS-Prozess.

## Reparaturen und Stabilität · 1.9.1

Jarvis behält beim Start die neuesten Einstellungen, verwirft abgebrochene Befehle und kann einen ausgefallenen Sprachdienst erneut starten. Im Gaming-Sparmodus verwendet die Spracherkennung das kleinere CPU-Modell mit zwei Threads; das erste Laden kann länger dauern. Abgebrochene Anfragen verhindern nicht mehr die automatische Speicherfreigabe.

Dual Stream lässt sich nach einem fehlgeschlagenen Start erneut vorbereiten. Ein erneuter Klick auf die aktive Szene lädt keinen unnötigen Stinger. Größere exportierte OBS-Projekte lassen sich wieder öffnen. Individuell benannte iCUE-Messwerte mit Einheiten werden erkannt; Prozentwerte werden nicht als U/min ausgegeben.

Das Handy-Deck aktualisiert entfernte Ordner und geänderte Profile zuverlässig. Wurde eine Taste zwischenzeitlich verschoben oder geändert, wird die Ansicht zuerst aktualisiert, ohne eine andere Aktion auszuführen. Nach dem Update bereits geöffnete Handy-Seiten einmal neu laden.

Vorhandene Suite-Einstellungen bleiben beim Programmstart erhalten. Automatische Übernahme aus dem alten OBS-Tool erfolgt nur bei einem noch nicht eingerichteten Profil. Chat-Verbindungen melden im Ruhezustand keinen Fehler; Trennen beendet laufende Verbindungsversuche und verhindert verspätete Statuswechsel.

## OBS-Stinger und Szenenwechsel · 1.9.0

Der **OBS-Import übernimmt jetzt Stinger-Videoübergänge** einschließlich Datei und Umschaltpunkt. Unter **Dual Stream → OBS-Szenensammlung importieren** die OBS-Exportdatei auswählen. Mit **Nur Übergänge übernehmen** bleiben bereits eingerichtete Szenen, Kameras und Anordnungen erhalten. Die Videodateien müssen auf dem PC weiterhin erreichbar sein. Fremde OBS-Übergangsplugins werden nicht geladen; nicht unterstützte Übergänge erscheinen als Hinweis.

Unter **Übergang** den importierten Stinger auswählen und **Übergang speichern** drücken. Der nächste Szenenwechsel verwendet diese Auswahl für TikTok und Twitch. Stinger-Länge und Umschaltpunkt stammen aus dem Video beziehungsweise den OBS-Einstellungen; **Dauer (ms)** gilt für die Überblendung. Ton wird weiterhin in LIVE Studio eingestellt, da die virtuelle Kamera das Bild überträgt.

Jarvis versteht zum Beispiel **„Übergang auf Stinger“**, **„TikTok Pause mit Stinger“** und **„Twitch Start mit Stinger“**. Der Szenenname muss zu einer vorhandenen Szene passen. Normale Szenenbefehle verwenden den aktuell gewählten Übergang. Touch Deck und Stream Deck bieten dieselben Übergänge zur Auswahl. Bei einer fehlenden Datei oder einem noch laufenden Übergang erscheint eine verständliche Meldung.

Für geringen Speicherverbrauch werden Stinger erst beim ersten Wechsel geladen. Das vollständige Video wird nicht vorab in den Arbeitsspeicher geladen; nach dem Wechsel werden seine Videoressourcen wieder freigegeben. **Video-Dienst ausschalten** gibt die Videoressourcen frei.

## Drei Kameras · 1.8.9

Unter **Dual Stream** stehen jetzt **Kamera 1, Kamera 2 und Kamera 3** bereit. Für jeden gewünschten Platz ein anderes Gerät auswählen und den Schalter einschalten. Zusätzliche Kameras sind zunächst aus. **Vorschau → Kamera & Spiel prüfen → Bildquelle** wählen, um jede Kamera getrennt zu verschieben, zu skalieren oder auf einer Leinwand auszublenden. TikTok und Twitch speichern getrennte Positionen. Die Vorlage **Kamera oben, Spiel darunter** erhält die Positionen von Kamera 2 und 3.

Jedes aktivierte Kameragerät wird einmal aufgenommen und für beide Ausgaben verwendet. Nicht aktivierte Plätze starten keine Aufnahme. Mehrere aktive Kameras benötigen entsprechend zusätzliche Ressourcen. In importierten OBS-Szenen bleiben die Ebenen erhalten: Ein gespeichertes Kameragerät, das zu einer eingeschalteten Kamera 2 oder 3 passt, nutzt diesen Platz; sonst bleibt Kamera 1 die Ersatzquelle. Zusätzliche Kameras werden nicht ungefragt über eine importierte Szene gelegt.

Jarvis versteht **„Kamera zwei an“**, **„Dritte Kamera ausschalten“** und **„Kamera 1 umschalten“**. Geräte dafür zuvor auswählen, einschalten und vorbereiten. **„Kamera an/aus“** steuert weiterhin Kamera 1. Touch Deck und Stream Deck bieten alle drei Kameras unter **Bildquelle an/aus** an. Diese Befehle blenden das vorbereitete Bild ein oder aus; der obere Geräteschalter beziehungsweise **Video-Dienst ausschalten** beendet die Aufnahme.

## TikTok- und Twitch-Szenen · 1.8.8

Die OBS-Szenensammlung zeigt TikTok im Hochformat und Twitch im Querformat in getrennten Gruppen. Start, Spiel, Pause, Chat, Ende, Offline und PC stehen zuerst; weitere Szenen folgen nach Namen. Zusammengehörige Szenen haben dieselbe Sortierung. Jede Taste zeigt ihren Partner und einen passenden Jarvis-Befehl.

Sage zum Beispiel „TikTok Pause“, „Twitch Start“ oder „Schalte auf TikTok Chat“. Jarvis wählt die importierte Szene aus dem aktuellen Bestand und nennt beide Ausgaben. Das bisherige gekoppelte Umschalten bleibt erhalten. Ohne Partner wird dieselbe Szene auf beide Formate eingepasst; Jarvis weist darauf hin. Originalnamen, Ebenen, eigene Deck-Tasten und gespeicherte Einstellungen bleiben erhalten.


## Vollständige Szenenliste aus OBS · 1.8.7

Der Import speichert jetzt die gesamte Szenensammlung. Die importierten Szenen stehen in Dual Stream, Jarvis und den Deck-Aktionen zur Auswahl. Mehrere Video- und Bildebenen werden in der ursprünglichen Reihenfolge dargestellt. Es werden keine OBS-Zugangsdaten, Skripte oder Browseradressen übernommen.

## Virtuelle Kameras in LIVE Studio · 1.8.6

**Dual Stream → Virtuelle Kameras einrichten** richtet die beiden Geräte auch für Programme mit Administratorrechten ein. Die Windows-Abfrage einmal bestätigen, anschließend LIVE Studio vollständig schließen und neu öffnen. Danach bei **Kamera hinzufügen → Kamera** die Ausgabe **Batto TikTok** auswählen; **Batto Twitch** liefert Querformat. Die Kameraausgabe vorher in Batto starten.

Nur die Kameraeinrichtung benötigt Administratorrechte. Batto und seine Vorschau laufen weiterhin normal. Die kleine Kamerakomponente liegt geschützt unter den gemeinsamen Windows-Programmdateien; es wird kein zusätzlicher Hintergrunddienst gestartet. Wird die Windows-Abfrage abgebrochen, zeigt Batto die fehlende Einrichtung an. Bei stiller Installation diesen Schritt anschließend im Programm ausführen.

## Dual Stream in 1.8.5

Unter **Vorschau → Kamera & Spiel prüfen** lassen sich die gemeinsamen Quellen auch während Start, Pause oder Ende ansehen, ohne die Ausgabe umzuschalten. **Spiel-Szene auswählen** übernimmt die Kamera ins Programmbild. Die Vorschau bleibt auf ein Bild pro Sekunde begrenzt. Verschobene Installationen reparieren eigene ungültige Kameraeinträge beim Start des Videodienstes; LIVE Studio anschließend neu öffnen.

**OBS-Szenensammlung importieren** übernimmt alle Szenen mit ihren Namen und geordneten Ebenen. Nach Auswahl der JSON-Datei kannst du zusätzlich Spiel, Start, Pause und Ende als Kurzbefehle zuordnen. In **Szene** stehen anschließend auch Chat, Offline und weitere importierte Szenen zur Wahl. Verknüpfte Hoch- und Querformatszenen werden gemeinsam umgeschaltet. Bilder, lokale Videos, Texte sowie Position, Größe, Drehung und Zuschnitt bleiben erhalten. Kameraebenen nutzen ein passendes eingeschaltetes Gerät aus Kamera 1, 2 oder 3, sonst Kamera 1; unterschiedliche Fenster- und Spielquellen bleiben getrennt. Leere Quellen bleiben inaktiv. Browserquellen, OBS-Plugins und Filter werden mit Hinweisen ausgelassen. Die bisherigen Einstellungen werden vor dem Import gesichert; die Ausgaben bleiben danach aus.

**Hintergrund löschen** entfernt den Hintergrund aus der ausgewählten Standardszene und Leinwand; die Originaldatei bleibt erhalten. Bei einer OBS-Zuordnung löst dies das entsprechende Standardkürzel von der importierten Szene. Die komplette importierte Szene bleibt weiterhin in der Szenenliste verfügbar. Einzelne Ebenen einer importierten Szene bearbeitest du zunächst in OBS und importierst die Sammlung erneut. Identische Hintergrundvideos werden gemeinsam dekodiert; inaktive Videos werden geschlossen.


Den Windows-Installer öffnen und den separat erhaltenen Installationsschlüssel eingeben. Der private Schlüssel wird nicht im Repository veröffentlicht. Die bisherigen Suite-Einstellungen bleiben bei einem Update erhalten.

## Jarvis steuert das Programm

**Alle verfügbaren Befehle finden:** In Jarvis unter **Alle Jarvis-Befehle** einen Begriff suchen oder einen Bereich auswählen. Die Liste enthält auch deine gespeicherten Aktionen. Mit der Seitenauswahl weitere Treffer ansehen. Eine Karte übernimmt den Satz in die Eingabe; **Ausführen** startet ihn. Platzhalter vorher durch die gewünschte Person oder den Wert ersetzen. Das Ergebnis steht unmittelbar am Formular und im Verlauf. Zum Beispiel: „Wechsel zu Pause“, „Öffne Chatfarben“, „Öffne Commands“ oder „Ich möchte die Einstellungen öffnen“. Bei Sprache auf **Ich höre zu …** warten. Für Moderation bleiben die Plattformrechte und die angezeigte Bestätigung erforderlich.

Unter **Jarvis** auf **Jetzt zuhören** drücken oder die Jarvis-Taste im Stream Deck verwenden. Auf die Anzeige zum Sprechen warten und einen Befehl sagen. Für den sparsamen Betrieb ist das Mikrofon zwischen Tastendrücken aus. Wer jederzeit mit „Jarvis“ starten möchte, aktiviert unter **Jarvis-Einstellungen → Stimme & Mikrofon** das dauerhafte Mikrofon und **Auf „Jarvis“ warten**.

Alternativ den Befehl eintippen und **Ausführen** drücken. **Alle Jarvis-Befehle** zeigt Beispiele aus den verfügbaren Funktionen. Ein Klick übernimmt nur den Text in die Eingabe; **Ausführen** löst die Aktion aus. Bei Sprache steht der erkannte Wortlaut als **ERKANNT** im Verlauf, danach erscheint die Antwort oder ein konkreter Fehler.

| Beispiel | Wirkung |
| --- | --- |
| „Mach bitte Pause.“ | Batto-Pause-Szene mit gespeichertem Übergang |
| „Öffne das Touch Deck.“ | Touch Deck anzeigen |
| „Kamera aus.“ | Kamerabild im eigenen Sender ausblenden |
| „Auto-Broadcast an.“ | Automatische Bot-Nachrichten einschalten |
| „Chat vorlesen aus.“ | Jarvis-Chatansagen ausschalten |
| „Mach Jarvis leiser.“ | Jarvis-Lautstärke verringern |
| „Windows Lautstärke auf 35 Prozent.“ | Gesamtlautstärke ändern |
| „GPU Temperatur.“ | Nur den angefragten Messwert nennen |

Auch gespeicherte Medien, Hotkeys, Broadcasts und Aktionsketten lassen sich mit ihrem eindeutigen Namen aufrufen, etwa „Starte Aktionskette Pause“. Die Befehlsübersicht enthält passende Beispiele aus der aktuellen Einrichtung. Kamera- und Live-Studio-Befehle steuern die Batto-Ausgaben; sie starten keinen öffentlichen Stream. Die Befehle benötigen kein KI-Modell. Unbekannte oder mehrdeutige Anweisungen führen keine erratene Aktion aus. Vorgelesener Chat löst keine Befehle aus.

**Weitere Befehle:** „Lies alle Chatnachrichten vor“, „Lies nur Moderatoren vor“, „Lies aus dem Chatfenster vor“, „Geschenk-Ansage auf Geschenkname und Coins“, „Lüfterwarnung ab 75 Prozent“ und „Öffne deine Einstellungen“. Die Chat-Befehle schalten das Vorlesen ein und ändern die jeweilige Auswahl. Geschenk- und Lüfterschwellen-Befehle ändern die Einstellung; eine ausgeschaltete Ansage bleibt ausgeschaltet.

**Moderation per Sprache:** „Blockiere NAME auf Twitch“, „Entblocke NAME auf Twitch“ oder „Sperre NAME auf Twitch für 10 Minuten“. Dafür müssen der genaue Benutzer aus dem verbundenen Chat und eine passende Moderationsanmeldung verfügbar sein. Jarvis nennt die geplante Aktion und führt sie erst nach **„Bestätigen“ innerhalb von 45 Sekunden** aus. **„Abbrechen“** oder ein anderer Befehl verwirft die Rückfrage. Ein neuer Versuch braucht wieder eine Bestätigung. TikTok-Sperren werden über die aktuelle TikFinity-Verbindung nicht unterstützt; Jarvis meldet das ausdrücklich.

**Lokaler Chat-Filter:** „Filterwort BEGRIFF hinzufügen“, „Filterwort BEGRIFF entfernen“ und „Chat Filter an / aus“ ändern die lokale Filterliste bzw. deren Aktivierung. Das blendet passende Nachrichten in Batto aus und sperrt keinen Nutzer auf der Plattform.

### Mikrofon, Chat und Dankesansagen einstellen

Unter **Jarvis-Einstellungen → Stimme & Mikrofon** auf **Mikrofone neu laden** drücken, möglichst einen empfohlenen Eingang wählen und **Gewähltes Mikrofon testen** starten. Das speichert die Auswahl und hört einmal zu. Auf die Bereitschaftsanzeige warten und beispielsweise „Hilfe“ sagen. Die übrigen Optionen mit **Sprache speichern** übernehmen. Gespeichert werden Gerätename und Treiber, sodass wechselnde Windows-Nummern die Auswahl nicht verschieben. Jarvis versucht gemeinsame Aufnahmewege desselben Geräts; andere Programme dürfen es weiterverwenden. Nicht nutzbare Eingänge bleiben mit Begründung sichtbar. Bei fehlendem Gerät wird kein fremdes Mikrofon gewählt. Doppelte Namen in Windows eindeutig benennen und gegebenenfalls den Mikrofonzugriff für Desktop-Apps freigeben.

Unter **Nachrichten aus dem Chat vorlesen** sind **Welche Nachrichten?** und **Wer darf vorgelesen werden?** getrennt: **Nachrichten aus dem Multi-Chat-Fenster** liest für die Multi-Chat-Anzeige vorgesehene Nachrichten; **Alle im Tool empfangenen Chatnachrichten** umfasst auch dort ausgeblendete Nachrichten, beispielsweise ausgeblendete automatische Broadcasts. Das Fenster muss dafür nicht dauerhaft sichtbar sein. Filtertreffer bleiben bei beiden stumm. Standardmäßig dürfen nur bestätigte Moderatoren und Kanalinhaber vorgelesen werden; freigegebene Benutzer-IDs oder alle Personen sind wählbar. Plattformen, Abstand und Textlänge anpassen. Die Textvorlage nutzt `{username}` und `{message}`. Mit **Chat-Regeln speichern** übernehmen. Es werden neue Nachrichten aus verbundenen Plattformen vorgelesen; ein geöffnetes Fenster allein genügt nicht.

Follower, Likes, Geschenke und Abos haben eigene einstellbare Ansagetexte. Die verfügbaren Platzhalter stehen unter den Feldern, etwa `{username}`, `{likecount}`, `{giftname}`, `{giftcount}`, `{coins}` und `{submonth}`. Bei Geschenken unter **Was soll Jarvis nennen?** Geschenk, Coin-Wert oder beides auswählen. Die Testtasten verwenden gekennzeichnete **erfundene Beispieldaten**, ohne ein Stream-Ereignis zu senden. **Ansagen speichern** übernimmt die Texte; auch nach **Standardtexte einsetzen** noch speichern.

Die neue Voreinstellung für Likes liegt bei **1.000 je Person**, frei änderbar; bestehende eigene Werte bleiben erhalten. Gezählt werden die tatsächlich empfangenen Likes dieser Person. Geschenkserien werden nach Abschluss einmalig angesagt. Fehlende Coins oder Abo-Monate ersetzt Jarvis durch einen Dank ohne erfundene Zahl. Für TikTok muss die lokale TikFinity-Bridge verbunden sein.

## Schnee und TikFinity-Browserlinks

Die neuen Kurzlinks von **widgets.tikfinity.com** und die bisherigen **tikfinity.zerody.one/widget/**-Adressen werden unterstützt. Deine persönlichen Browserlinks bleiben in den lokalen Einstellungen.

Unter **Einstellungen → TikFinity im Chatfenster** den Schnee-Link speichern und **Schnee bei sichtbarem Chat direkt laden** aktivieren. Damit läuft nur die Schneequelle, auch wenn die übrigen Web-Widgets im Sparmodus bleiben. Der Schalter **Schnee** im Multi-Chat bzw. die zugehörige Deck-Aktion startet und stoppt sie ebenfalls. Beim Wechsel in andere Bereiche oder Minimieren wird sie entladen. Bei entkoppeltem Chat gibt das Hauptfenster seine Schneequelle frei.

**Action-Screens für Follower, Likes/Geschenke und Abos:** Unter **TikFinity-Widgets** jeweils einen eigenen Eintrag mit dem passenden Browserlink speichern, **Manuell / Aktionskette** und **Dauerhaft anzeigen** auswählen. Diese Bildschirme erhalten ihre Einblendungen direkt von TikFinity und können ohne Ereignis absichtlich leer sein. Im Chat **Weitere Widgets starten** bzw. **Widgets starten** drücken, damit sie schon vor dem nächsten Ereignis bereit sind. Derselbe Link sollte nur einmal eingebunden werden. Größe und Position bleiben pro Widget einstellbar; **Widgets stoppen** entlädt die Browserquellen.

Die Browserbilder liefern keine verlässlichen Namen, Geschenkwerte oder Ereignisse für Jarvis. Dafür muss **TikFinity Desktop → lokale Bridge** verbunden sein. So benötigt Jarvis keine weiteren Browserfenster zum Mitlesen. Ein geladener Action-Screen bestätigt noch kein empfangenes Live-Ereignis.

## Programmhintergrund wählen

Unter **Einstellungen → Allgemein → Programmhintergrund** stehen **Gaming-Zimmer**, **TikTok-Banner**, **Studio ohne Schrift** und **Original – Marmor** zur Wahl. Gaming-Zimmer ist voreingestellt. Die Auswahl wirkt sofort als Vorschau; **Alles speichern & synchronisieren** oder **Anwenden** speichert sie für den nächsten Start. Die Abdunklung lässt sich daneben einstellen. Die Startseite behält ihr bisheriges Bild. Es sind ruhige Standbilder ohne zusätzliche Animation oder laufenden Bildprozess.

## Handy oder Tablet verbinden

1. PC und Handy/Tablet ins gleiche private WLAN bringen.
2. Am PC **Touch Deck → Handy & Tablet verbinden → Handy-Verbindung einschalten** öffnen.
3. Den angezeigten **QR-Code** mit der Kamera-App des Geräts scannen. Er enthält die PIN. Bei mehreren Adressen die des gemeinsamen WLANs auswählen.
4. Alternativ die PC-Adresse im Browser oder in der Android-App eingeben und mit der sechsstelligen PIN koppeln.
5. **Neue PIN / Geräte trennen** erneuert den QR-Code und trennt bisher gekoppelte Geräte. Ausschalten beendet die Verbindung.

**Android:** `Batto-Touch-Deck-1.8.0.apk` installieren. Android 8.0 oder neuer und eine aktuelle Android System WebView werden benötigt.

**iPhone / iPad:** Die PC-Adresse in Safari öffnen, **Teilen → Zum Home-Bildschirm** und, falls angeboten, **Als Web-App öffnen** wählen. Dies ist eine Startbildschirm-Web-App, kein signiertes IPA-/App-Store-Paket. Der PC muss laufen; es gibt keinen Offline-Modus.

Das Drachenmotiv aus `app.jpeg` erscheint als App-Symbol am PC und auf dem Handy sowie beim Öffnen der mobilen App.

## Tasten bearbeiten

**Rechtsklick** oder **langes Drücken** auf einer Taste öffnet **Bearbeiten, Kopieren, Einfügen und Löschen**. Alternativ die Taste per Tastatur fokussieren und **Umschalt+F10** drücken. Mit Pfeiltasten auswählen, Enter bestätigen, Escape schließen.

Kopien funktionieren zwischen Hauptfenster, entkoppeltem Fenster, Profilen und Ordnern. Eigene Icons bleiben erhalten. Plugin-Zugangsdaten werden nicht kopiert. Ein zu kleines Zielraster wird abgelehnt, bevor belegte Ordnertasten verloren gehen. Löschen und Ersetzen benötigen eine Bestätigung. Im Hauptfenster Änderungen anschließend **speichern**; im entkoppelten Fenster werden sie sofort gespeichert.

**Lautstärkeregler:** Unter **Tasten bearbeiten** eine freie Taste wählen, **Lautstärkeregler** anlegen und die **Tonquelle** zuordnen. Neben Windows-Gesamtlautstärke und **Jarvis** erscheinen Programme, sobald sie Ton ausgeben. Neue Installationen enthalten bereits ein Profil **Sound** mit Windows- und Jarvis-Regler; eigene vorhandene Belegungen werden nicht verändert. Nach dem Speichern den Regler ziehen, mit **+ / −** in Fünferschritten ändern oder stummschalten. Eigene Beschriftung und Bilder sind möglich. Nicht verfügbare Quellen zeigen **—**. Regler brauchen etwas größere Tasten; Aktualisierungen pausieren im Hintergrund.

## Fenster getrennt verwenden

**Touch Deck** und **Dual Stream** lassen sich jeweils mit **Entkoppeln** als separates Fenster öffnen. **Immer oben** hält ein Fenster sichtbar. **Andocken** bringt es zurück ins Hauptfenster. Die Ansichten verwenden dieselben gespeicherten Daten; ein zusätzliches Dual-Stream-Fenster startet keine zweite Kameraaufnahme. Änderungen vor dem Wechsel speichern.

Zum Spielen unnötige Bedienfenster schließen. Handy-Steuerung und bereits gestartete Dienste bleiben verfügbar. **Beenden** im Windows-Infobereich beendet auch die Dienste.

## Prüfstand und ausführliche Hilfe

QR-Anzeige, PINrotation, Kopieren, Ordnergrenzen, bestätigtes Löschen und Lautstärkebedienung wurden in isolierten Electron-Fenstern mit Testdaten geprüft. Echte Mobilgeräte, persönliche Soundgeräte und physische Stream-Deck-Tasten benötigen zusätzlich einen Test mit der eigenen Einrichtung. Die iOS-Version bleibt eine Web-App.

[Ausführliche Anleitung](ANLEITUNG.html) · [Projektübersicht](README.md) · [Android-Hinweise](mobile/android/README.md)
