# Batto Desktop Mainboard-Lüfter

Eigener optionaler Windows-Helfer für erkannte ASUS/MSI-Desktop-PCs, mit LibreHardwareMonitorLib **0.9.6**. Standardmäßig aus. Erfordert bereits installiertes PawnIO und Administratorrechte; der Helfer installiert keinen Treiber und erhöht seine Rechte nicht selbst. Das Anzeigen der Mainboarddaten in Batto kann ohne diesen Helfer erfolgen.

Der Helfer öffnet ausschließlich die Mainboardgruppe. Corsair-USB-Controller, GPU, Netzteil, Notebooks und als Pumpe/AIO bezeichnete Anschlüsse werden nicht gesteuert. Nur zugeordnete CPU-, System- und Chassis-Fanheader von geprüften Nuvoton-NCT-Controllern erscheinen als steuerbare Kanäle. NCT6683/6686/6687 einschließlich 6687DR sind wegen eines bestätigten Restore-Bitfehlers in LHM 0.9.6 ausgeschlossen; andere SuperIO-Familien haben in diesem Helfer noch keine geprüfte Freigaberegel. Generische `Fan #1`/`PWM #1`-Namen sind ausgeschlossen, weil sie auch Pumpenanschlüsse bedeuten können. Das tatsächliche Gerät an einem Fanheader kann die Bibliothek nicht erkennen; vor jeder Übernahme wird `fanConfirmed: true` benötigt.

`scan` und `enable` eröffnen den Kanalservice; sie ändern keine Lüfterleistung. Die Mainboardbibliothek verwendet bei der Erkennung allerdings SuperIO-Konfigurationszugriffe und kann Monitorregister initialisieren. Erst `manual` übernimmt den bewusst gewählten Anschluss. Der erste eigene Wert ist 100%, dann der ausgewählte ganzzahlige Wert von 30 bis 100%. Eine Sitzung lädt niemals gespeicherte Software-PWM-Einstellungen. LHM bestätigt keinen Messzeitpunkt; die beobachteten Temperaturen haben deshalb `updatedUtc: null`. **Temperaturkurven werden mit diesem realen Backend vor jeder Übernahme abgelehnt.** Der native Kurvenmotor ist für einen künftigen Provider mit bestätigten Messzeitpunkten vorbereitet und läuft in den synthetischen Prüfungen unabhängig von der Oberfläche; fehlende/veraltete Werte oder mindestens 85°C führen dort zu 100%.

Bei `disable`, `shutdown`, geschlossenem Eingabekanal, fehlendem Elternprozess oder acht Sekunden ohne Heartbeat gibt der Helfer alle von Batto übernommenen Kanäle mit `IControl.SetDefault()` zurück. Ein Fehler dabei wird nicht als erfolgreiche Freigabe gemeldet. **Die öffentliche LHM-API liefert keinen physischen Firmware-ACK.** `released: true` bestätigt erfolgreich abgeschlossene Bibliotheksaufrufe, keine gemessene BIOS-Automatik. Im Zustand steht daher `releaseVerification: "api-only"`. Nach gewaltsamem Prozessende oder Treiberfehler ist kein garantierter Restore möglich.

## Lokales Protokoll

Start: `BattoFanControl.exe --parent-pid <Batto PID>`. JSON-Zeilen auf stdin/stdout, keine HTTP-Schnittstelle. Anfragen benötigen eine nichtnegative `requestId` und `command`:

- `scan`, `enable`, `heartbeat` (Batto sendet alle zwei Sekunden), `disable`, `shutdown`.
- `manual`: `id`, `duty` (30–100), `fanConfirmed: true`.
- `curve`: `id`, `sensorId`, `points: [{temperature, duty}, ...]`, `fanConfirmed: true`. 2–20 Punkte, steigende Temperaturen, nicht fallende Leistung.

Antworten: `{requestId, ok, state, message?}`. Erfolgreiche Änderungen enthalten `applied: true` und die Kanal-ID; erfolgreiche Freigabe `released: true`. Der Zustand enthält `enabled`, `channels`, `sensors`, `assignments`, `releasePending`, `releaseVerification`.

## Prüfung und Build

`--self-test` verwendet ausschließlich einen eingebauten synthetischen Backend und öffnet keine Hardware. `build.ps1` stellt Abhängigkeiten anhand der Lockdatei wieder her, führt diese Prüfungen aus und veröffentlicht `BattoFanControl.exe` einschließlich separater Bibliotheksdateien. Keine reale Lüfteränderung gehört zum Buildtest.

Die verwendete Bibliothek und Module sind unverändert. MPL-/LGPL-Lizenzen, Quellverweise und Paketbelege liegen in `licenses`. Die Bibliotheken werden als austauschbare separate Dateien ausgeliefert.
