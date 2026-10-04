# PRISM RGB Studio 1.5.1

Lokale RGB-Steuerzentrale für Windows 10/11 x64 (Intel/AMD), ohne OpenRGB. PRISM liest jeweils den PC aus, auf dem es installiert ist; Komponentenmodelle werden nicht fest vorgegeben. Die Programm- und .NET-Laufzeit ist mitgeliefert. PRISM öffnet seine Oberfläche in einem eigenen Windows-Fenster mit Microsoft Edge WebView2.

## Installieren und starten

1. **PRISM-Setup.exe** doppelklicken und dem deutschen Assistenten folgen. Eine alte PRISM-Version vorher vollständig beenden.
2. **PRISM RGB Studio** im Startmenü oder über die Desktop-Verknüpfung öffnen.
3. Auf der Startseite **Geräte** erscheinen CPU, Mainboard, Arbeitsspeicher, Grafikkarten, Laufwerke und aktive Bildschirmnamen. Darunter stehen die von Windows gemeldeten vorhandenen Geräte mit ihren Namen, Herstellerangaben und Kategorien. Namenssuche und Kategoriefilter helfen beim Finden von USB-Controllern, Tastaturen, Mäusen, Audio- und Netzwerkgeräten. **PC erneut erkennen** aktualisiert die Informationen. Diese Erkennung benötigt weder OpenRGB noch iCUE und funktioniert unabhängig vom Hersteller. Ein Modellname wird nur angezeigt, wenn Windows oder eine erreichbare Hersteller-Schnittstelle ihn meldet.

Die Installation erfolgt für dein Benutzerkonto ohne Administratorrechte. PRISM arbeitet lokal unter http://127.0.0.1:4783. Zum Beenden das PRISM-Steuerfenster schließen oder im PRISM-Serverfenster Strg+C drücken. Nur ein zusätzlich geöffnetes Browserfenster zu schließen beendet den lokalen Dienst nicht.

Die portable ZIP-Version funktioniert weiterhin: das gesamte ZIP entpacken und **PRISM-starten.cmd** doppelklicken.

Wenn Microsoft Edge WebView2 auf dem PC fehlt, öffnet PRISM die PC-Erkennung im Browser. WebView2 ist für das native PRISM-Steuerfenster erforderlich: [Microsoft WebView2](https://developer.microsoft.com/microsoft-edge/webview2/). Corsair-Geräte können auch im Browser über iCUE gesteuert werden; Windows-LampArray-Geräte benötigen das native Fenster im Vordergrund.

## Hersteller und Geräte auf jedem PC

Die Windows-Erkennung liest die vorhandenen Namen, Hersteller, Geräteklassen, USB-Busbeschreibungen und Bildschirmdaten des aktuellen PCs. Ein anderer PC liefert seine eigenen CPU-, Mainboard-, RAM-, GPU-, Laufwerks- und Zubehörnamen. Es gibt keine Liste zugelassener Komponentenmodelle. Von Windows gemeldete Namen unbekannter OEM-Hersteller bleiben erhalten. Fehlt eine verwertbare Herstellerangabe, erscheint der Eintrag ohne gesicherte Herstellerzuordnung.

Die zusätzliche **Herstellerübersicht** ordnet die gemeldeten Einträge bekannten Marken oder ihrem tatsächlichen OEM-Namen zu und zeigt den Stand der Anbindung. Sie nennt ausdrücklich die aktuell steuerbaren RGB-Ziele eines Herstellers. Weitere Windows-Einträge derselben Marke erhalten dadurch keine RGB-Steuerberechtigung. Herstellererkennung, Geräteanzeige und tatsächliche Lichtsteuerung sind getrennte Ergebnisse.

Die Übersicht liest außerdem den lokalen Razer-Chroma-Status, sofern die Schnittstelle erreichbar ist. Diese Abfrage verwendet ausschließlich einen lokalen GET-Aufruf. PRISM öffnet darüber keine Chroma-Sitzung und sendet keine LED-Farben. Die Razer-Statusanzeige ist keine eigenständige Razer-RGB-Anbindung.

## RGB ohne OpenRGB

**RGB-Anbindung öffnen** bietet unverändert zwei direkte Schnittstellen für die tatsächliche LED-Steuerung:

- **Corsair über iCUE:** iCUE muss laufen und SDK-Steuerung zulassen. Die optionale Corsair-Anbindung wird nach Zustimmung zu den Corsair-Lizenzbedingungen einmal direkt vom offiziellen Corsair-Download geladen. Danach **RGB-Geräte suchen** wählen. Der Installer verteilt diese Hersteller-DLL nicht weiter. Unterstützte PC-Komponenten und Zubehör wie RGB-RAM, Controller, Tastaturen, Mäuse und Headsets erscheinen mit ihren von iCUE gemeldeten Modellnamen und LEDs. Verfügbare Controller-Kanalangaben zeigen die in iCUE konfigurierten Lüfter- oder LED-Serien. Diese Angaben sind keine automatische Bestimmung eines Lüftermodells, wenn der Controller nur eine konfigurierte Serie meldet. Es wird nur gemeinsamer LED-Zugriff verwendet, ohne Tastenabfragen oder exklusiven Zugriff.
- **Windows Dynamische Beleuchtung:** kompatible HID-LampArray-Geräte werden über die Windows-Schnittstelle erkannt. PRISM muss dafür im Vordergrund sein. Bei Verlust der Steuerberechtigung beendet PRISM die Effektübertragung und zeigt den Fehler an. Es werden keine Treiber installiert und keine beliebigen USB-Geräte untersucht.

**Stream Deck und Elgato-Geräte sind in der Windows-Geräteliste sichtbar, aber von der RGB-Steuerung ausgeschlossen.** PRISM startet und verbindet OpenRGB nicht. Es beendet auch keine fremden Node-Prozesse, etwa Stream-Deck-Erweiterungen.

Eine erkannte PC-Komponente hat nicht automatisch steuerbare RGB-LEDs. Mainboard-, RAM- und Controller-Unterstützung hängt von der vorhandenen Schnittstelle und dem Modell ab. Geräte anderer Hersteller können über iCUE erscheinen, sofern iCUE sie bereitstellt, etwa ASUS-Mainboard- oder GPU-Beleuchtung. Für Lian Li gibt es keine eigenständige Anbindung. Auch weitere Hersteller sind nur dann steuerbar, wenn Windows LampArray oder iCUE die betreffende Beleuchtung tatsächlich bereitstellt; ihre Namensanzeige allein reicht dafür nicht. Passive Lüfter und LED-Streifen ohne eigene Gerätekennung werden über ihren Controller oder Mainboard-Anschluss zusammengefasst. Windows kann ihre individuellen Modellnamen nicht auslesen. Controller-Kanäle werden nur bei eindeutig zuordenbaren, vollständig validierten LED-Daten als getrennte Zonen angeboten. Die Windows-Liste enthält auch logische Gerätefunktionen und Systemeinträge; ihre Anzahl ist keine Anzahl physischer Geräte.

## Mainboard-Bild in der PC-Vorschau

Bei einem aus Windows erkannten MSI-/Micro-Star-Mainboard erscheint die MSI-Ansicht, bei ASUS/ASUSTeK die ASUS-Ansicht. Verwendet werden ausschließlich die Mainboarddaten, keine Marken von Grafikkarten oder USB-Geräten. Unter dem Bild steht der tatsächlich gemeldete Mainboardname. Die Bilder verwenden die bereitgestellten MSI- und ASUS-Mainboarddesigns als Symbolbild; sie sind keine Modellbestätigung. Andere, fehlende oder widersprüchliche Mainboarddaten behalten die allgemeine Vorschau. „PC erneut erkennen“ aktualisiert auch die Bildauswahl. Ein fehlendes Herstellerbild fällt auf die allgemeine Darstellung zurück.

Neu in 1.5.1: Die ASUS-Ansicht zeigt einen White Build mit weißem Gehäuse, weißen Lüftern, RAM, Grafikkarte, Kühlung und Kabeln. Die MSI-Ansicht bleibt unverändert. Herstellerwahl und Anzeige des echten Mainboardnamens funktionieren weiterhin wie bisher.

Lüfter, RAM, Grafikkarte und die bisherige RGB-Überlagerung behalten ihre Position. Diese Änderung erweitert keine Hardware-Schnittstelle oder RGB-Kompatibilität.

Prüfstand 1.5: 68 automatisierte Tests bestanden. Die Bildauswahl wurde in 11 simulierten Zuständen auf Desktop (1365×1000) und Mobil (390×844) geprüft: MSI, ASUS, Aktualisierung, fehlende Daten, unbekannte Hersteller, ausschließlich MSI/ASUS-Grafikkarten, absichtlich fehlendes Herstellerbild, erneutes Laden nach Herstellerwechsel und lange Modellnamen. Die 19 Vorschauprüfungen sind bestanden; reale Hardwarefarben wurden dabei nicht verändert.

## Licht einstellen

Prüfstand 1.5.1: Der ASUS White Build wurde auf Desktop und Mobilgerät in 21 Vorschauprüfungen getestet. Herstellerwechsel, Modellname, fehlende Bilder, bestehende RGB-Positionen und 0 % Helligkeit funktionieren. Das MSI-Bild bleibt unverändert. Die Prüfung verwendet simulierte PC-Daten und verändert keine Hardwarefarben.

14 Effekte: Statisch, Regenbogen, Atmen, Welle, Farbverlauf, Funkeln, Farbwechsel, Komet, Lauflicht, Scanner, Wasserwelle, Feuer, Nordlicht und Farbstreifen. Bis zu acht Farben und Helligkeit einstellen; bei bewegten Effekten zusätzlich Geschwindigkeit, bei passenden Effekten Richtung und Größe beziehungsweise Dichte. Die Feineinstellungen heißen passend zum Effekt etwa Schweiflänge, Strahlbreite oder Wellendichte. Statisch verwendet die erste gewählte Farbe; Regenbogen verwendet das Spektrum. Farbwechsel und Farbstreifen wirken mit mindestens zwei Farben. Feuer verwendet deine gewählte Palette; die Szene Kaminfeuer liefert warme Farben. Acht Szenen sind enthalten, darunter Kaminfeuer, Polarlicht, Neon-Komet und Neon-Lauflicht. Einzelne Geräte oder LED-Zonen wählen. **Auf Geräte anwenden** überträgt Einstellungen erst nach deinem Klick. Beim Programmstart erfolgt automatisch eine reine RGB-Gerätesuche, ohne Farben zu verändern oder eine Hersteller-Anbindung herunterzuladen. Eine bereits bestehende Sitzung und laufende Effekte bleiben beim erneuten Öffnen erhalten. PC-Erkennung und RGB-Gerätesuche ändern keine LED-Farben. Neue Geräte lassen sich mit einer erneuten Suche einlesen.

Effektwahl startet die animierte Vorschau, ohne Hardwarefarben zu ändern. Vorschau und LED-Ausgabe verwenden dieselbe Farb- und Helligkeitsberechnung; die gezeigte PC-Anordnung bleibt schematisch. Alle 14 Effekte können in Profilen gespeichert und exportiert werden. Profile der vorherigen Version bleiben lesbar.

Die gekennzeichnete virtuelle Vorschau enthält ausschließlich Beispielkomponenten. Die Geräteansicht zeigt die echte Windows-PC-Erkennung, eine durchsuchbare Windows-Geräteliste und direkt unterstützte RGB-Geräte. Ein gefundener Name bedeutet nicht automatisch RGB-Steuerbarkeit. Von einer Anbindung gemeldete Gerätefehler werden mit Modellname und Grund angezeigt, statt das Gerät still wegzulassen.

Profile lassen sich speichern, laden, löschen und als JSON exportieren/importieren. Sie liegen im lokalen Speicher des verwendeten Browsers beziehungsweise des neuen PRISM-Steuerfensters. Profile der alten Browser-Version vor dem Wechsel exportieren und im neuen Fenster importieren. Es werden keine Hardwaredaten hochgeladen und kein Konto benötigt.

## Deinstallation und Prüfung

Windows-Einstellungen → Apps → Installierte Apps → **PRISM RGB Studio**, oder **PRISM deinstallieren** im Startmenü. PRISM vorher beenden. Selbst hinzugefügte Dateien, iCUE, Browserprofile und die separat heruntergeladene Corsair-SDK-Datei bleiben erhalten.

Prüfstand für Version 1.4: 59 automatisierte Tests sind bestanden, einschließlich der bisherigen sechs Effekte mit unveränderten LED-Ausgaben, aller acht neuen Bewegungsmuster, Farben, Richtung, Tempo, Größe, Helligkeitsgrenzen und Übereinstimmung zwischen Vorschau und LED-Frames. Die Oberfläche wurde bei 1365×1000 und 390×844 mit simulierten RGB-Geräten geprüft: alle 14 Effekte auswählen und anwenden, Regler, acht Szenen, Vorschauanimation und Pause, alte und neue Profile speichern/laden/exportieren/importieren. Es gab keine Browserfehler und keinen horizontalen Überlauf. RGB-Ausgabe wurde ausschließlich mit simulierten Geräten geprüft; dabei wurden keine realen LED-Farben verändert. Die bestehende Geräteerkennung und der Stream-Deck-Schutz bleiben erhalten.

Die Setup-Datei ist nicht digital signiert. Lizenztexte mitgelieferter Komponenten liegen in `licenses`, `runtime` und `native/licenses`.

## Quellcode

`src`: React-Oberfläche; `server`: lokaler Dienst, Inventar und direkte Schnittstellen; `native`: Windows-Steuerfenster und Hersteller-Schnittstelle; `tests`: simulierte Geräte und Regressionstests. `npm install`, `npm run dev`, `npm start`, `npm run build`, `npm test`. Der native Teil wird mit .NET gebaut; weitere Hinweise stehen in `native/README.md`.
