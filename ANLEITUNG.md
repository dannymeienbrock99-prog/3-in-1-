# Batto 3-in-1 · Schnellstart 1.8.1

Den Windows-Installer öffnen und den separat erhaltenen Installationsschlüssel eingeben. Der private Schlüssel wird nicht im Repository veröffentlicht. Die bisherigen Suite-Einstellungen bleiben bei einem Update erhalten.

## Jarvis steuert das Programm

Unter **Jarvis** auf **Jetzt zuhören** drücken oder die Jarvis-Taste im Stream Deck verwenden. Auf die Anzeige zum Sprechen warten und einen Befehl sagen. Für den sparsamen Betrieb ist das Mikrofon zwischen Tastendrücken aus. Wer jederzeit mit „Jarvis“ starten möchte, aktiviert unter **Jarvis-Einstellungen → Stimme & Mikrofon** das dauerhafte Mikrofon und **Auf „Jarvis“ warten**.

Alternativ den Befehl eintippen und **Ausführen** drücken. **Das kannst du sagen** zeigt Beispiele aus den verfügbaren Funktionen. Ein Klick übernimmt nur den Text in die Eingabe; **Ausführen** löst die Aktion aus. Bei Sprache steht der erkannte Wortlaut als **ERKANNT** im Verlauf, danach erscheint die Antwort oder ein konkreter Fehler.

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

**Moderation per Sprache:** „Blockiere NAME auf Twitch“, „Entblocke NAME auf Twitch“ oder „Sperre NAME auf Twitch für 10 Minuten“. Dafür müssen der genaue Benutzer aus dem verbundenen Chat und eine passende Moderationsanmeldung verfügbar sein. Jarvis nennt die geplante Aktion und führt sie erst nach **„Bestätigen“ innerhalb von 45 Sekunden** aus. **„Abbrechen“** oder ein anderer Befehl verwirft die Rückfrage. Ein neuer Versuch braucht wieder eine Bestätigung. TikTok-Sperren werden über die aktuelle TikFinity-Verbindung nicht unterstützt; Jarvis meldet das ausdrücklich.

**Lokaler Chat-Filter:** „Filterwort BEGRIFF hinzufügen“, „Filterwort BEGRIFF entfernen“ und „Chat Filter an / aus“ ändern die lokale Filterliste bzw. deren Aktivierung. Das blendet passende Nachrichten in Batto aus und sperrt keinen Nutzer auf der Plattform.

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
