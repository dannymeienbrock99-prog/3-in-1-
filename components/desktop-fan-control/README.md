# Batto Desktop Mainboard-Lüfter

Eigener optionaler Windows-Helfer für erkannte ASUS/MSI-Desktop-PCs, mit LibreHardwareMonitorLib **0.9.6**. Standardmäßig aus. Erfordert bereits installiertes PawnIO. Beim bewussten Einschalten fordert Batto die Windows-UAC-Bestätigung für seinen eigenen kleinen Lüfterhelfer an, wenn Batto selbst ohne Administratorrechte läuft. Batto und iCUE behalten ihre normalen Rechte; der Helfer installiert keinen Treiber. Das Anzeigen der Mainboarddaten in Batto kann ohne diesen Helfer erfolgen. Die Windows-Bestätigung prüft lediglich, ob tatsächlich unterstützte Mainboardanschlüsse verfügbar sind; eine Mainboardmarke allein bestätigt keinen steuerbaren Kanal.

Der Helfer öffnet ausschließlich die Mainboardgruppe. Corsair-USB-Controller, GPU, Netzteil, Notebooks und als Pumpe/AIO bezeichnete Anschlüsse werden nicht gesteuert. Nur zugeordnete CPU-, System- und Chassis-Fanheader von geprüften Nuvoton-NCT-Controllern erscheinen als steuerbare Kanäle. NCT6683/6686/6687 einschließlich 6687DR sind wegen eines bestätigten Restore-Bitfehlers in LHM 0.9.6 ausgeschlossen; andere SuperIO-Familien haben in diesem Helfer noch keine geprüfte Freigaberegel. Generische `Fan #1`/`PWM #1`-Namen sind ausgeschlossen, weil sie auch Pumpenanschlüsse bedeuten können. Das tatsächliche Gerät an einem Fanheader kann die Bibliothek nicht erkennen; vor jeder Übernahme wird `fanConfirmed: true` benötigt.

`scan` und `enable` eröffnen den Kanalservice; sie ändern keine Lüfterleistung. Die Mainboardbibliothek verwendet bei der Erkennung allerdings SuperIO-Konfigurationszugriffe und kann Monitorregister initialisieren. Erst `manual` übernimmt den bewusst gewählten Anschluss. Der erste eigene Wert ist 100%, dann der ausgewählte ganzzahlige Wert von 30 bis 100%. Eine Sitzung lädt niemals gespeicherte Software-PWM-Einstellungen. LHM bestätigt keinen Messzeitpunkt; die beobachteten Temperaturen haben deshalb `updatedUtc: null`. **Temperaturkurven werden mit diesem realen Backend vor jeder Übernahme abgelehnt.** Der native Kurvenmotor ist für einen künftigen Provider mit bestätigten Messzeitpunkten vorbereitet und läuft in den synthetischen Prüfungen unabhängig von der Oberfläche; fehlende/veraltete Werte oder mindestens 85°C führen dort zu 100%.

Bei `disable`, `shutdown`, geschlossenem Eingabekanal, fehlendem Elternprozess oder acht Sekunden ohne Heartbeat gibt der Helfer alle von Batto übernommenen Kanäle mit `IControl.SetDefault()` zurück. Ein Fehler dabei wird nicht als erfolgreiche Freigabe gemeldet. **Die öffentliche LHM-API liefert keinen physischen Firmware-ACK.** `released: true` bestätigt erfolgreich abgeschlossene Bibliotheksaufrufe, keine gemessene BIOS-Automatik. Im Zustand steht daher `releaseVerification: "api-only"`. Nach gewaltsamem Prozessende oder Treiberfehler ist kein garantierter Restore möglich.

## Lokales Protokoll

Bei einem bereits erhöhten Batto-Prozess: `BattoFanControl.exe --parent-pid <Batto PID>`. JSON-Zeilen auf stdin/stdout, keine HTTP-Schnittstelle. Bei einem normalen Batto-Prozess startet `fan-control-launch.ps1` den fest zugeordneten Helfer mit `RunAs` und `--pipe batto-fan-<32 Zufallshexzeichen> --token <64 Zufallshexzeichen> --parent-pid <PID> --parent-start <UTC-Ticks>`. Die einmalige lokale Pipe besitzt eine geschützte ACL für die Benutzeridentität des bestätigten Batto-Prozesses und des Helfers sowie ein Medium-Integrity-Label. Client-PID, Prozessstartzeit und ein konstanter Tokenvergleich werden vor jedem Hardwareöffnen geprüft. Ohne bestätigte Anmeldung endet der Helfer nach 30 Sekunden. Die Sitzung bleibt nur bei laufendem identischem Batto-Prozess bestehen. Ein fehlgeschlagener UAC-Start bleibt sichtbar und führt weder zu PWM-Schreibzugriffen noch zu Änderungen anderer Programme.

Anfragen benötigen eine nichtnegative `requestId` und `command`:

- `scan`, `enable`, `heartbeat` (Batto sendet alle zwei Sekunden), `disable`, `shutdown`.
- `manual`: `id`, `duty` (30–100), `fanConfirmed: true`.
- `curve`: `id`, `sensorId`, `points: [{temperature, duty}, ...]`, `fanConfirmed: true`. 2–20 Punkte, steigende Temperaturen, nicht fallende Leistung.

Antworten: `{requestId, ok, state, message?}`. Erfolgreiche Änderungen enthalten `applied: true` und die Kanal-ID; erfolgreiche Freigabe `released: true`. Der Zustand enthält `enabled`, `channels`, `sensors`, `assignments`, `releasePending`, `releaseVerification`.

## Prüfung und Build

`--self-test` verwendet ausschließlich einen eingebauten synthetischen Backend und öffnet keine Hardware. `build.ps1` stellt Abhängigkeiten anhand der Lockdatei wieder her, führt diese Prüfungen aus und veröffentlicht `BattoFanControl.exe` einschließlich separater Bibliotheksdateien. Keine reale Lüfteränderung gehört zum Buildtest.

Die verwendete Bibliothek und Module sind unverändert. MPL-/LGPL-Lizenzen, Quellverweise und Paketbelege liegen in `licenses`. Die Bibliotheken werden als austauschbare separate Dateien ausgeliefert.
