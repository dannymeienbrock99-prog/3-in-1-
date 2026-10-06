# Batto 3-in-1 - Projektauftrag vom 6. Oktober 2026

**Installierter Stand vom 7. Oktober 2026: Batto 1.15.2 / PRISM 1.8.6.** Der genehmigte lokale Update-/Neustart ist abgeschlossen. Die Strimer-Verbindung hatte einen konkreten Konflikt zwischen normaler und erhöhter Windows-Identität; die neue Verbindung korrigiert ausschließlich ihre eigene Benutzer-ACL und prüft den tatsächlichen Client-Prozess. Dem optionalen Lüftermodus fehlte die UAC-Übernahme; sie ist jetzt einschließlich Helfer und Startdatei installiert. Die echte Prüfung beider erhöhten Helfer wurde bislang durch die nicht bestätigte Windows-Abfrage nicht ausgeführt. Eine erfolgreiche Installation ohne Administratorrechte ist dafür kein Nachweis.

**Validierung 1.15.2:** 219 RGB-Prüfungen, 71 fokussierte Desktop-RGB-/Lüfterprüfungen und 35 synthetische native Lüfterprüfungen bestanden. 903 Dateien des Pakets und alle 217 Dateien des installierten Lüfterhelfers stimmen mit dem Build überein. Einstellungen, verschlüsselte Zugangsdaten, RGB-Daten, lokaler Browserspeicher und PC-Bilder wurden gesichert und auf Erhalt geprüft. Die echte installierte RGB-Oberfläche meldet fünf steuerbare Geräte, lädt ohne Framework-/Konsolenfehler und aktualisiert die Strimer-Zustimmung samt Übernahmeschalter korrekt. Bei ausgeschalteter Übernahme zeigt sie den tatsächlichen Wireless-Zugriffsfehler an. Ein bestätigter Funkupload, sichtbare Strimer-Farben und echte PWM-Anschlüsse sind damit noch nicht nachgewiesen. Vor und nach dem Update waren keine virtuellen Kameraausgaben aktiv; es musste keine Ausgabe wiederhergestellt werden. Der Bot war unmittelbar vor und nach diesem Update nicht verbunden; dieses Update verändert keine Bot-Konfiguration.

**Lüftermodus 1.15.0:** Standardmäßig aus, auch nach jedem Neustart. Mainboard-Hersteller und Modell werden ohne direkten Treiberzugriff aus Windows gelesen. Nur unterstützte, benannte CPU-/System-/Chassis-Anschlüsse geprüfter Nuvoton-Controller sind für eine bewusste manuelle Übernahme mit 30–100% vorgesehen. Pumpen/AIO, generische Anschlussnamen und NCT6683/6686/6687 einschließlich 6687DR bleiben ausgeschlossen. Der verwendete Backend bestätigt keine frischen Temperatur-Messzeitpunkte; echte Temperaturkurven sind deshalb gesperrt. Beim Ausschalten wird die Hardware-Regelung über die Bibliothek angefordert; ein physischer BIOS-ACK ist nicht verfügbar.

**Aktueller lesender PC-Befund:** ASUS ROG CROSSHAIR X870E GLACIAL, Desktop-PC, PawnIO registriert, Batto ohne Administratorrechte. Die installierte 1.15.2 meldet den optionalen Lüftermodus als verfügbar mit erforderlicher Windows-Freigabe; der Modus bleibt ausgeschaltet. Kein nativer Lüfterhelfer wurde gestartet, kein PWM-Wert geschrieben. Eine Erkennung des Mainboardnamens bestätigt noch keine steuerbaren Anschlüsse dieses Modells. Die vorhandene iCUE/RGB-Anbindung bleibt erhalten; CorsairLink wird nicht automatisch geladen. Das verlinkte AsusFanControl ist ein Notebook-Projekt und wird nicht für Desktop-PCs ausgeführt.

Der ausdrücklich genehmigte kurze Diensttest bestätigte den Zugriffskonflikt mit L-Connect: Nur bei pausiertem LConnectService und LConnectServiceWatcher wurden das gekoppelte 24-Pin-Kabel (132 LEDs) und GPU-Kabel mit 12 Lichtleitern (174 LEDs) erkannt. Beide Dienste wurden im Abschluss wieder gestartet. Der Test war lesend; sichtbare Farben wurden dabei nicht geändert. Das neue optionale Übergabemodul ist vorbereitet und wird nur mit ausdrücklicher Zustimmung sowie Windows-Freigabe gestartet. Vollständiger Herstellerersatz und physische Einzelstrangzuordnung bleiben offen.

**Historische Validierung 1.15.1:** 219 RGB-Prüfungen, 50 fokussierte Desktop-RGB-/Lüfterprüfungen und 31 Oberflächen-Vertragsprüfungen bestanden. Die gepackten Ressourcen wurden mit 898 Dateiabgleichen geprüft. Browserprüfungen mit ausdrücklich gekennzeichneten Testdaten bestätigten die Zustimmung vor der Übernahme, getrennte Kabelziele, bestätigte und ausstehende Funkantworten sowie das Layout bei 390 Pixel Breite. Diese Prüfungen ersetzen keinen Farbtest an den echten Kabeln. Dieser Stand wurde inzwischen durch die oben dokumentierte installierte 1.15.2 ersetzt.

## Verbindliche Regel: keine automatische Pause fremder Software

Batto darf keine fremden Programme suspendieren, beenden, Dienste anhalten oder deren Betrieb durch eine automatische Prozessübernahme unterbrechen. Das gilt insbesondere für SystemSettings.exe, Armoury Crate, iCUE und L-Connect 3. Der Sparmodus darf eigene Ansichten, Animationen und eigene Hilfsprozesse verwalten. Bei Zugriffskonflikten muss die App eine verständliche Meldung anzeigen. Ein manuelles Schließen eines Herstellerprogramms ist eine Entscheidung des Benutzers. Die ausdrücklich bestätigte Ausnahme für Strimer Wireless darf ausschließlich die zwei geprüften L-Connect-Dienste zeitweise übernehmen und ihren ursprünglichen Zustand wiederherstellen. Sie ist bei jedem Start aus, erfordert einen neuen Zustimmungshaken und eine Windows-Freigabe. Andere Programme und Dienste bleiben ausgeschlossen.

Ausführbare Fremdplugins und konfigurierte externe Streamer.bot-Aktionen sind zusätzlich zu prüfen: Sie können außerhalb der eingebauten Batto-Aktionen arbeiten. Der Quellcodebefund ist keine Garantie über beliebige Erweiterungen oder bereits installierte ältere Programmstände.

## 1. SystemSettings.exe / Armoury Crate - Untersuchung

**Befund:** Im untersuchten Quellcode wurde kein eingebauter Mechanismus zur Suspendierung fremder Prozesse gefunden. Die vorhandene SystemSettings.exe in `C:\Windows\ImmersiveControlPanel\` besitzt eine gültige Microsoft-Windows-Signatur. Batto sendet Präsentationspausen an eigene Fenster; der Gaming-Modus schließt eigene Fenster.

Microsoft beschreibt Windows-eigene Suspendierung von Apps nach Minimieren, Hintergrundwechsel und Sperren. Das ist eine plausible Erklärung, keine nachgewiesene Ursache dieses Vorfalls: [Microsoft: UWP app lifecycle](https://learn.microsoft.com/en-us/windows/uwp/launch-resume/app-lifecycle).

**Offen:** Bei erneutem Auftreten Zeitpunkt, tatsächlichen Prozesszustand, Reaktion beim Öffnen der Windows-Einstellungen sowie aktive Plugins und externe Aktionen beobachten. Der Live-Zustand des betroffenen Prozesses war bei der Prüfung nicht zugänglich. Keine Windows-Energieeinstellungen wurden verändert.

## 2. RGB-Steuerung lädt nicht

**Im Quellstand korrigiert:** Ein bewusster Klick auf „RGB erneut laden“ lädt die eingebettete Oberfläche auch bei gleicher Dienstadresse neu. HTTP-/Oberflächenfehler werden verständlich angezeigt.

**Offen:** Die konkrete ursprünglich gemeldete Störung wurde nicht am laufenden installierten Tool reproduziert. Lokale Lade-/Wiederholungsprüfungen bestätigen den korrigierten Ablauf, nicht jede reale Treiber- oder Geräteverbindung.

## 3. Alle Controller einschließlich „Commander Duo“ / iCUE ersetzen

**Aktueller lesender Gerätebefund:**

- `1B1C:0C1A`: CORSAIR Lighting Node CORE.
- `1B1C:0C3F`: iCUE LINK System Hub.
- Die USB-Abfrage bestätigt kein eigenständiges Commander-Gerät. Ein Commander DUO kann im LINK-Modus als Kindgerät des System Hubs laufen; fehlende eigene USB-Kennung beweist daher keine Abwesenheit. Die angeschlossene Hub-Topologie und das genaue Modell bleiben zu bestätigen. Quelle: [Corsair COMMANDER DUO](https://www.corsair.com/ww/en/explorer/diy-builder/accessories/corsair-commander-duo/).

**Grenze:** Corsair-Beleuchtung verwendet das offizielle iCUE-SDK und benötigt derzeit iCUE. Sensorprotokolle und Kühlung können weiterhin von iCUE abhängen. Lüfterkurven in Batto sind Entwürfe; sie werden nicht als aktive Corsair-Hardwarekurven geschrieben.

**Offener Entwicklungsauftrag:** Genaues Commander-Modell, Anschlussweg und Firmware bestätigen; eine eigenständige, belegte Geräteanbindung entwickeln und Beleuchtung, Sensoren, Kühlung/Pumpe, Startverhalten und fehlende Herstellerfunktionen am tatsächlichen Gerät prüfen. Erst nach vollständiger Abdeckung der benötigten Funktionen ist eine iCUE-Ablösung belegbar. iCUE wurde nicht deinstalliert.

## 4. Kabel & Lichtleiter / Strimer-Vorschau

**Im Quellstand ergänzt:** „Vorschaueffekt bestätigen“ bestätigt den lokalen Vorschauentwurf. Es wird dabei keine Hardware beschrieben und die übrige Geräte-/Zonenauswahl bleibt erhalten. „Auf dieses Kabel übertragen“ ist eine separate ausdrückliche Hardwareaktion für ein aktuell erkanntes, direkt unterstütztes ganzes Kabel.

Vorschauentwürfe und Wireless-Kabelwahl werden in einer validierten lokalen Datei gespeichert und bleiben bei wechselnden RGB-Dienstports erhalten. Physische Wireless-Ziele werden über ihre stabile Geräteidentität zugeordnet. Ein fehlendes gewähltes Kabel darf nicht automatisch durch ein anderes Ziel ersetzt werden.

**Grenze:** Getrennte virtuelle Stränge bestätigen keine physische Einzelstrangansteuerung. Gemeinsame Hardwareausgabe, Herstellermodi und virtuelle Vorschau haben unterschiedliche Voraussetzungen. Sichtbare Farben an echten Kabeln wurden in dieser Bearbeitung nicht geprüft.

## 5. L-Connect 3 ersetzen

Der angegebene Ordner `C:\Program Files\Lian-Li\L-Connect 3` wurde lesend geprüft. Batto enthält native Anbindungen für bestimmte Lian-Li-HID-Controller und unterstützte, bereits gekoppelte Wireless-Kabel. Kopplung, Firmware, weitere Lüfter-/Pumpenfunktionen und Displays sind dadurch nicht vollständig ersetzt.

Bei der ersten USB-Momentaufnahme wurde kein unterstützter Lian-Li-Wireless-Sender oder -Empfänger erkannt. Der Adapter `1A86:8091` meldete einen USB-Hub; er darf nicht als Strimer-Sender ausgegeben werden. Die später nachgereichten Herstellerexporte und der Screenshot ergänzen diesen Befund, siehe unten.

**Offener Entwicklungsauftrag:** Alle tatsächlich verwendeten Lian-Li-Geräte, Kennungen und benötigten Funktionen erfassen, Zugriff und Effekte modellweise prüfen und die fehlenden Funktionen implementieren. Der 94-Effekt-Katalog ist eine Referenz, keine Zusage von 94 Modi pro Gerät. L-Connect 3 wurde nicht deinstalliert oder verändert.

## 6. Einstellungen > Hilfe und PDF

**Im Quellstand umgesetzt:** Hilfe mit 26 Themen von A bis Z, Suchfeld, Buchstabennavigation, Bedienungsschritten und Voraussetzungen/Grenzen. Suchbegriff und geöffnete Themen bleiben bei erneutem Rendern der Einstellungen erhalten; Themen können den zugehörigen Programmbereich öffnen.

Die PDF enthält die belegbare Funktionsliste und die A-bis-Z-Bedienhilfe. Sie trennt vorhandene Funktionen, Integrationen, Vorschauen und offene Hardwareunterstützung. Das lokale Update wird als geschützter Installer bereitgestellt; es wird durch die Erstellung nicht automatisch installiert oder veröffentlicht.

## Abnahmekriterien der noch offenen Hardwarearbeit

1. Exaktes Gerät mit Kennung/Firmware anzeigen und seine Fähigkeiten zutreffend ausweisen.
2. Keine fremde Software automatisch anhalten; nur die ausdrücklich bestätigte Strimer-Ausnahme ist erlaubt. Zugriffskonflikte verständlich melden.
3. Auswahl und gespeicherte Entwürfe über Dienst-/App-Neustart bewahren; fehlende Geräte nicht durch andere Ziele ersetzen.
4. Nur ausdrücklich ausgewählte und bestätigte Geräte/Zonen beschreiben; Empfangsbestätigung und sichtbaren Hardwaretest unterscheiden.
5. Für jede Ablösung auch Kühlung, Pumpen, Sensoren, Displays, Kopplung, Firmware und Startverhalten nach tatsächlichem Bedarf abdecken.
6. Erst nach erfolgreicher modellbezogener Abnahme erklären, dass die bisherige Herstellersoftware entbehrlich ist.

## Nachgereichte Hardwarebelege vom 6. Oktober 2026

Die beiden L-Connect-ZIPs enthalten jeweils eine UTF-8-JSON-Sicherung namens `backup`, Exportversion `2.1.29.0`. Die Dateien wurden nur gelesen. Der Screenshot zeigt L-Connect 3 v2.1.29, Funkkanal 39 und zwei gekoppelte Kabel im L-Wireless-Sync-Bereich.

- Die Exporte speichern einen L-Wireless-Sender der Familie `0416:8040`, passend zur bereits implementierten Anbindung.
- **24_Pin:** 132 LEDs, Gruppe 2, eigene Funkidentität.
- **12_Pin:** 174 LEDs, Gruppe 3, eigene Funkidentität.
- Je Kabel sind sechs getrennte Einstellungsgruppen gespeichert. Der Beleuchtungsexport enthält **Rainbow** für 24_Pin und **Wave** für 12_Pin, Helligkeit 100 und Tempo 3. Das zusätzlich gespeicherte Gesamtfeld nennt RainbowWave; es darf nicht automatisch als aktive Ausgabe interpretiert werden.
- Die LCD-Sicherung enthält andere gespeicherte Effekt-/Tempo-Werte für dieselben Kabel, jedoch keine Bild- oder Videodateien. Die beiden Sicherungen beschreiben unterschiedliche Konfigurationsstände.
- Die Gerätesperre im Screenshot bezieht sich laut sichtbarem Hinweis auf das Trennen beziehungsweise Hinzufügen von Geräten. Kopplungsstatus und eine Windows-Prozesspause sind getrennte Sachverhalte.

**Bewertung:** Senderfamilie, Kabelidentitäten und Einstellungen sind nun deutlich besser belegt. Die frühere USB-Abfrage darf nicht als generelle Abwesenheit von Lian-Li-Geräten gelesen werden. Exportzuordnung und angezeigter L-Connect-Status bestätigen weiterhin keinen unabhängigen Zugriff aus Batto, keine physische Einzelstrangadressierung und keine aktuelle Lichtfarbe. Export-Modusnummern sind keine belegten HID-/Funkbefehle.

Das Corsair-ZIP enthält Einstellungen, Profile und Diagnose-/Gerätelogs; das Standardprofil ist reguläres iCUE-XML. Gerätelogs vom 6. Oktober um 20:03 und das exportierte Profil nennen die Kennungen `1B1C:0C1A` und `1B1C:0C3F` (Lighting Node CORE und iCUE LINK System Hub). Ein Commander ist dadurch nicht nachgewiesen. Ein generischer CommanderPro-Verweis im Profil ist eine Vorlagenreferenz, kein angeschlossenes Gerät.

Das Profil enthält **13 gespeicherte Lüfterzuordnungen**: zehn zur Kurve `Dragon Fury EXTREME`, drei zu `amd`. Das ist kein Nachweis von 13 physisch angeschlossenen Lüftern. Die Benutzer-Sensornamen liefern neun benannte Lüfterpositionen sowie ältere RX-Zuordnungen und helfen beim Importabgleich.

Alle **14 gelieferten CSV-Dateien** enthalten neun Lüfterdrehzahlen und `Temp #1` in Grad Celsius, aber keinen gemessenen PWM-Prozentkanal. Der unveränderte Messwertparser wurde mit der Datei `corsair_cue_20261006_20_20_19.csv` unter `de-DE` und `en-US` rein lesend geprüft: neun RPM-Sensoren und ein Temperatursensor erkannt. Die ungewöhnliche Zeitangabe `6/10/2026 20:20:19 PM` wird nicht als Messdatum geparst; Frische stammt aus Dateiänderungszeit und einer neuen vollständigen Zeile. Ein unveränderter Export wird korrekt nicht als laufende Live-Messquelle behandelt.

**Umgesetzt in 1.14.4:** Der begrenzte L-Connect-Beleuchtungsimport erstellt nach bewusster Kabel-/Quellenauswahl einen virtuellen Vorschauentwurf mit stabiler Funkidentität. Effekt, RGB-Palette und Helligkeit werden nur bei eindeutiger Vorschauzuordnung übernommen; Modusnummern, Tempo, Richtung und Quellgruppen bleiben Metadaten. **Weiterer Entwicklungsnutzen:** Corsair-Profile modellbezogen abgleichen; für Live-Messwerte eine weitergeschriebene Protokolldatei verwenden. Diese Exporte liefern noch keinen eigenständigen Corsair-/Lian-Li-Gerätetreiber. Eine vollständige Ablösung der Herstellerprogramme bleibt Gegenstand der oben genannten modellbezogenen Abnahme.
