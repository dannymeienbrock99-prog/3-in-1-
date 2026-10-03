# Batto 3-in-1 · Schnellstart 1.8.9

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
