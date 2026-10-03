# Batto 3-in-1 · 1.9.0

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


Windows-Programm mit der Gold-/Marmor-Oberfläche von Batto OBS Tool 2.4.7, Multi-Chat, lokalem Jarvis, PC-Messwerten und Lüfterbühne. Das Originalprojekt Multi-Chat bleibt unverändert.

## Schnee und TikFinity-Browserlinks

Die neuen Kurzlinks von **widgets.tikfinity.com** und die bisherigen **tikfinity.zerody.one/widget/**-Adressen werden unterstützt. Deine persönlichen Browserlinks bleiben in den lokalen Einstellungen.

Unter **Einstellungen → TikFinity im Chatfenster** den Schnee-Link speichern und **Schnee bei sichtbarem Chat direkt laden** aktivieren. Damit läuft nur die Schneequelle, auch wenn die übrigen Web-Widgets im Sparmodus bleiben. Der Schalter **Schnee** im Multi-Chat bzw. die zugehörige Deck-Aktion startet und stoppt sie ebenfalls. Beim Wechsel in andere Bereiche oder Minimieren wird sie entladen. Bei entkoppeltem Chat gibt das Hauptfenster seine Schneequelle frei.

**Action-Screens für Follower, Likes/Geschenke und Abos:** Unter **TikFinity-Widgets** jeweils einen eigenen Eintrag mit dem passenden Browserlink speichern, **Manuell / Aktionskette** und **Dauerhaft anzeigen** auswählen. Diese Bildschirme erhalten ihre Einblendungen direkt von TikFinity und können ohne Ereignis absichtlich leer sein. Im Chat **Weitere Widgets starten** bzw. **Widgets starten** drücken, damit sie schon vor dem nächsten Ereignis bereit sind. Derselbe Link sollte nur einmal eingebunden werden. Größe und Position bleiben pro Widget einstellbar; **Widgets stoppen** entlädt die Browserquellen.

Die Browserbilder liefern keine verlässlichen Namen, Geschenkwerte oder Ereignisse für Jarvis. Dafür muss **TikFinity Desktop → lokale Bridge** verbunden sein. So benötigt Jarvis keine weiteren Browserfenster zum Mitlesen. Ein geladener Action-Screen bestätigt noch kein empfangenes Live-Ereignis.

## Programmhintergrund wählen

Unter **Einstellungen → Allgemein → Programmhintergrund** stehen **Gaming-Zimmer**, **TikTok-Banner**, **Studio ohne Schrift** und **Original – Marmor** zur Wahl. Gaming-Zimmer ist voreingestellt. Die Auswahl wirkt sofort als Vorschau; **Alles speichern & synchronisieren** oder **Anwenden** speichert sie für den nächsten Start. Die Abdunklung lässt sich daneben einstellen. Die Startseite behält ihr bisheriges Bild. Es sind ruhige Standbilder ohne zusätzliche Animation oder laufenden Bildprozess.

## Batto Touch Deck

Unter **Touch Deck** sind große Tasten direkt in Batto eingebaut. **Tasten bearbeiten** öffnet Profile, Ordner und Tastenbelegungen. Du kannst Bilder wählen, Tasten verschieben und bis zu acht vorhandene Batto-Aktionen kombinieren: Jarvis, Szenen/Übergänge, Kameras, Bot, Auto-Broadcast, Medien und gespeicherte Hotkeys. Messwert-Tasten zeigen aktuelle PC-Werte oder zugeordnete Lüfter-Prozentwerte; fehlende Werte bleiben leer. Änderungen vor dem Bedienen speichern.

**Rechtsklick**, **langes Drücken** auf einem Touchscreen oder **Umschalt+F10** öffnet die Tastenoptionen: **Bearbeiten, Kopieren, Einfügen und Löschen**. Kopien funktionieren zwischen dem Hauptfenster, dem entkoppelten Deck, Ordnern und Profilen. Eigene Bilder und enthaltene Tasten bleiben erhalten; Plugin-Zugangsdaten werden nicht kopiert. Ein zu kleiner Zielordner wird abgelehnt, wenn sonst belegte Tasten verloren gingen. Löschen und Ersetzen benötigen eine Bestätigung. Im Hauptfenster anschließend speichern; im entkoppelten Fenster werden bestätigte Änderungen sofort gespeichert. Mit den Pfeiltasten lassen sich die Optionen auswählen; Escape schließt das Menü.

**Lautstärkeregler:** Unter **Tasten bearbeiten** eine freie Taste wählen und **Lautstärkeregler** erstellen. Die **Tonquelle** kann die Windows-Gesamtlautstärke, **Jarvis** oder ein laufendes Programm sein. Neue Installationen enthalten zusätzlich ein Profil **Sound** mit Windows- und Jarvis-Regler; vorhandene eigene Belegungen werden nicht verändert. Programme erscheinen, sobald sie Ton ausgeben. Mit eigener Beschriftung und eigenem Bild speichern. Im Bedienmodus den Schieberegler ziehen, mit **+ / −** in Fünferschritten ändern oder stummschalten; die Regler funktionieren auch über Touch. Nicht verfügbare Tonquellen zeigen **—**. Lautstärketasten vergrößern das Raster bei Bedarf für erreichbare Bedienelemente. Sichtbare Regler werden alle 2,5 Sekunden aktualisiert; Änderungen beim Ziehen werden zusammengefasst, ausgeblendete Oberflächen pausieren.

**Entkoppeln** öffnet ein separates Touch-Fenster, etwa für einen zweiten Bildschirm. **Immer oben** hält es sichtbar; **Andocken** bringt dich zurück zum Hauptfenster. Position und Größe bleiben gespeichert. **Tastengröße → Selbst einstellen** erlaubt 80–220 Pixel pro Profil, **Automatisch** passt die Tasten ans Raster an. Gleichzeitige Änderungen in zwei Fenstern überschreiben sich nicht still; bei einem Konflikt den aktuellen Stand neu laden.

**Plugins & Icons → Paket laden** importiert `.streamDeckPlugin` und `.streamDeckIconPack`, beispielsweise das Batto-Plugin oder LS25-Buttons. Danach eine Taste als **Plugin-Aktion** belegen, Plugin und Aktion auswählen und gegebenenfalls **Plugin-Einstellungen** öffnen. Für ein Bild **Eigenes Bild** oder **Icon-Bibliothek** wählen. Ein eigenes Tastenbild hat Vorrang vor dem Bild des Plugins. Icon-Pakete liefern Bilder, keine Steueraktionen. Standardaktionen für Windows-EXE-, Node- und HTML-Plugins werden unterstützt; zusätzliche Dienste, Kontenanmeldungen, gerätespezifische SDK-Funktionen oder Herstellerprüfungen können die Kompatibilität begrenzen. Die verwendeten Drittanbieter-Plugins führen ihren eigenen Code auf dem PC aus; nur Pakete aus vertrauenswürdigen Quellen laden. Fremde Plugins und Icon-Pakete werden nicht mit dem Installer verteilt.

**Exportieren** sichert Belegungen und ausgewählte Tastenbilder. **Projekt importieren** lädt eine Batto-Deck-Sicherung; Plugins, deren private Einstellungen und Zugangsdaten sind nicht Teil dieses Exports. Chat-/Bot-Einstellungen bleiben getrennt. Bei einem Import bleibt die vorherige Belegung als `touch-deck.before-import.json` im Suite-Datenordner erhalten.

Für Handy oder Tablet **Handy & Tablet verbinden → Handy-Verbindung einschalten**, dann den **QR-Code** mit der Kamera-App scannen. Die PIN ist im QR-Code enthalten; alternativ die angezeigte Adresse öffnen und die sechsstellige PIN eingeben. Bei mehreren Netzwerkadressen die Adresse des gemeinsamen WLANs auswählen; der QR-Code wechselt passend mit. QR-Codes werden lokal erzeugt, ohne externen Dienst. Die PIN steht im URL-Fragment statt im HTTP-Pfad; zur Anmeldung wird sie an den lokalen PC gesendet. Beide Geräte müssen im gleichen privaten Netzwerk sein. Falls Windows nachfragt, den Netzwerkzugriff nur für das private Netz zulassen. Die Freigabe beginnt erst auf Wunsch und startet nach Programmneustart nicht automatisch. **Neue PIN / Geräte trennen** erneuert den QR-Code und trennt alle bisherigen Geräte; Ausschalten entfernt den QR-Code. Im Gaming-Modus funktionieren die Tasten weiter, während die PC-Oberfläche geschlossen ist.

**Android-Handy und -Tablet:** [Batto-Touch-Deck-1.8.0.apk](https://github.com/dannymeienbrock99-prog/3-in-1-/releases/download/v1.8.0/Batto-Touch-Deck-1.8.0.apk) installieren, die am PC angezeigte Adresse eingeben und anschließend mit der PIN verbinden. Android 8.0 oder neuer und eine aktuelle Android System WebView sind erforderlich. Die App verwendet eine einzelne System-WebView und benötigt weder Mikrofon/Kamera noch einen Hintergrunddienst.

**iPhone und iPad:** Die PC-Adresse in Safari öffnen, **Teilen → Zum Home-Bildschirm** wählen und, wenn angeboten, **Als Web-App öffnen** einschalten. Das Batto-Symbol startet die Web-App. Es handelt sich um eine Startbildschirm-Web-App, kein IPA-/App-Store-Paket. Beide Varianten unterstützen Hoch-/Querformat und brauchen den laufenden PC im selben privaten WLAN. Nach dem vollständigen Schließen gegebenenfalls neu koppeln. Es gibt keinen Offline-Modus. Unter **Anzeige auf diesem Gerät** lässt sich die Tastengröße unabhängig vom PC einstellen. [Mobile Anleitung und Android-Quellcode](mobile/android/README.md).

Das bereitgestellte Drachenmotiv aus **app.jpeg** ist das neue App-Symbol für PC und Handy. Beim Öffnen der mobilen App erscheint es als Startmotiv. Die vorhandene Gold-/Marmor-Oberfläche bleibt erhalten.

Eine zweite vollständige Desktop-App wird nicht geladen; das separate Touch-Fenster entsteht erst durch **Entkoppeln**. Kein zusätzlicher Chat-/OBS-Gästebereich. Plugin-Prozesse laufen für verwendete Profile beziehungsweise geöffnete Plugin-Einstellungen und beenden sich, wenn keine Bedienfläche sie mehr benötigt. Handy-Aktivität verfällt nach 15 Sekunden ohne Abfragen. Messwerte werden alle drei Sekunden gelesen, im Hintergrund pausiert; unveränderte Pluginbilder werden nicht erneut übertragen. Plugins können je nach Funktion dennoch eigenen RAM und CPU beanspruchen.

## Virtuelle Kameras ohne Streamkey

Unter **Dual Stream** gewünschte Spiel-/Fenster-/Bildschirmquelle und Kamera auswählen. Das TikTok-Layout zeigt die Kamera über die gesamte obere Breite (48 % der Höhe); das Spiel liegt darunter. Alte Werkslayouts werden automatisch korrigiert. Eigene Layouts bleiben erhalten und lassen sich mit **Kamera oben, Spiel darunter** umstellen. Die Twitch-Leinwand bleibt unabhängig.

**Entkoppeln** öffnet Dual Stream als eigenes Fenster wie das Touch Deck. Mit **Immer oben** bleibt das Bedienfeld sichtbar, mit **Andocken** kehrt es ins Hauptfenster zurück. Beide Ansichten verwenden dieselben gespeicherten Einstellungen und denselben Kameradienst. Das zusätzliche Fenster startet keine zweite Kameraaufnahme. Änderungen vor dem Wechsel speichern; Konflikte zwischen geöffneten Ansichten werden angezeigt.

1. **Geräte erkennen**, Quellen zuordnen und aktivieren; Layout speichern.
2. **Kamera einschalten**: Die Vorschau startet nach der Geräteauswahl automatisch. Für gespeicherte Quellen **Vorschau starten** drücken.
3. **Kamera starten** oder **Beide Kameras starten**. In LIVE Studio **Batto TikTok**, für Querformat **Batto Twitch** als Kamera wählen. Falls Geräte fehlen: **Virtuelle Kameras einrichten**, die Windows-Abfrage bestätigen und LIVE Studio vollständig neu starten.
4. Mikrofon, PC-Ton und eigentlichen Sendestart direkt im Zielprogramm einstellen. Virtuelle Kameras transportieren nur Video. Medien-Ton wird ebenfalls nicht über das Kameragerät übertragen.

Der Installer richtet zwei DirectShow-Kameras für den aktuellen Windows-Benutzer ein. Bestehende funktionsfähige OBS-VirtualCam-Registrierungen werden erhalten und können deshalb „OBS-Camera“ / „OBS-Camera2“ heißen. Eine von einem anderen Sender belegte Kamera wird nicht übernommen. Die eingebaute OBS Virtual Camera bleibt unberührt.

Für die Bildkomposition werden weiterhin **lokal installierte OBS-32-Bibliotheken** verwendet (geprüft mit 32.2.2). Die OBS-Oberfläche muss nicht laufen; diese Bibliotheken sind nicht im Installer enthalten. Die reine Kameraausgabe benötigt keinen H.264-Encoder, Streamkey oder RTMP-Zugang. Encoder-Module werden dafür gar nicht geladen. Auflösung: 720p30, optional 1080p30. Quellen werden gemeinsam aufgenommen, Leinwände separat ausgegeben. Sparsame Vorschau mit einem Bild pro Sekunde, nur solange Dual Stream sichtbar ist. Sie lässt sich ganz abschalten. Der ungenutzte Video-Dienst endet nach 60 Sekunden.

## Weniger Speicher beim Spielen

**Dual Stream → Gaming-Modus** speichert das aktuelle Layout und schließt die Hauptoberfläche. Chat, Bot, Auto-Broadcast, Messdienst, Jarvis und gestartete Kameras laufen weiter. Zusätzlich geöffnete Touch-Deck- und Dual-Stream-Fenster bleiben bestehen; zum maximalen Sparen ebenfalls schließen; die Handy-Steuerung bleibt verfügbar. Mit Doppelklick auf das Batto-Symbol im Windows-Infobereich, erneutem App-Start oder der Stream-Deck-Aktion **Batto-Fenster anzeigen** kommt die Oberfläche zurück. Benachrichtigungstöne haben eine eigene kleine Wiedergabe, die nach fünf Sekunden Ruhe wieder entladen wird. Andere noch nicht gespeicherte Formulare vorher speichern. Beenden im Infobereich beendet auch die Dienste.

Web-Widgets starten standardmäßig nur auf Wunsch und werden beim Verlassen der Ansicht entladen. Die Vorschau pausiert in anderen Ansichten, bei minimiertem Fenster und im Gaming-Modus. Sprachmodelle werden nach Nutzung freigegeben. Optionale KI nutzt im Jarvis-Gaming-Sparmodus zwei CPU-Threads ohne GPU-Offload. Die tatsächliche Last hängt von Quellen, aktiven Diensten, KI-Modell und LIVE Studio ab.

## Jarvis, Szenen und Stream Deck

**Befehlsübersicht in 1.8.4:** Unter Jarvis sind alle verfügbaren Befehle nach Bereichen durchsuchbar, einschließlich der gespeicherten Aktionen deiner Einrichtung. Die Trefferzahl und Seitenauswahl halten die Liste übersichtlich. Eine Karte übernimmt den Satz in die Eingabe; **Ausführen** startet ihn. Direkt am Formular erscheint das Ergebnis. „Wechsel zu Pause“ und Befehle mit dem Verb am Satzende wählen nun die richtige Szene; importierte OBS-Szenennamen überschreiben die eigenen Batto-Szenen nicht. Kurze Menübefehle erhalten einen erweiterten lokalen Erkennungswortschatz. Es wird kein größeres Sprachmodell geladen.

Die Batto-Steuerung ist direkt eingebaut und benötigt kein KI-Modell: „Mach bitte Pause“, „Öffne das Touch Deck“, „Kamera aus“, „Auto-Broadcast an“, „Chat vorlesen aus“ oder „Mach Jarvis leiser“. Auch vorhandene Medien, Hotkeys, Broadcasts und Aktionsketten lassen sich mit eindeutigem Namen aufrufen. **Alle Jarvis-Befehle** zeigt Beispiele aus der aktuellen Einrichtung. Anklicken füllt die Eingabe; **Ausführen** startet den Befehl. Unbekannte und mehrdeutige Anweisungen führen keine erratene Aktion aus.

**Weitere Befehle:** „Lies alle Chatnachrichten vor“, „Lies nur Moderatoren vor“, „Lies aus dem Chatfenster vor“, „Geschenk-Ansage auf Geschenkname und Coins“, „Lüfterwarnung ab 75 Prozent“ und „Öffne deine Einstellungen“. Die Chat-Befehle schalten das Vorlesen ein und ändern die jeweilige Auswahl. Geschenk- und Lüfterschwellen-Befehle ändern die Einstellung; eine ausgeschaltete Ansage bleibt ausgeschaltet.

**Moderation per Sprache:** „Blockiere NAME auf Twitch“, „Entblocke NAME auf Twitch“ oder „Sperre NAME auf Twitch für 10 Minuten“. Dafür müssen der genaue Benutzer aus dem verbundenen Chat und eine passende Moderationsanmeldung verfügbar sein. Jarvis nennt die geplante Aktion und führt sie erst nach **„Bestätigen“ innerhalb von 45 Sekunden** aus. **„Abbrechen“** oder ein anderer Befehl verwirft die Rückfrage. Ein neuer Versuch braucht wieder eine Bestätigung. TikTok-Sperren werden über die aktuelle TikFinity-Verbindung nicht unterstützt; Jarvis meldet das ausdrücklich.

**Lokaler Chat-Filter:** „Filterwort BEGRIFF hinzufügen“, „Filterwort BEGRIFF entfernen“ und „Chat Filter an / aus“ ändern die lokale Filterliste bzw. deren Aktivierung. Das blendet passende Nachrichten in Batto aus und sperrt keinen Nutzer auf der Plattform.

**Sprechen:** **Jetzt zuhören** oder die Jarvis-Taste im Stream Deck drücken, auf die Sprechbereitschaft warten und einen Befehl sagen. **ERKANNT** zeigt den aufgenommenen Wortlaut, die folgende Antwort das Ergebnis. Das Mikrofon ist standardmäßig nur nach Tastendruck aktiv; für Befehle jederzeit optional unter **Jarvis-Einstellungen → Stimme & Mikrofon** das dauerhafte Mikrofon und **Auf „Jarvis“ warten** einschalten. Getippte Befehle funktionieren auch mit ausgeschaltetem Mikrofon. Sprach- und Texteingabe verwenden denselben Befehlsweg.

**Mikrofon auswählen:** Unter **Stimme & Mikrofon → Mikrofone neu laden** die Eingänge neu einlesen, möglichst den empfohlenen Eintrag wählen und **Gewähltes Mikrofon testen** drücken. Die Auswahl wird gespeichert und Jarvis hört einmal zu; nach der Bereitschaftsanzeige beispielsweise „Hilfe“ sagen. Mit **Sprache speichern** auch die übrigen Sprachoptionen übernehmen. Die Auswahl merkt sich Gerätename und Treiber statt einer wechselnden Windows-Nummer. Beim Öffnen versucht Jarvis passende gemeinsame Aufnahmewege desselben Geräts, sodass andere Programme es weiterverwenden können. Fehlt das gewählte Gerät, wechselt Jarvis nicht unbemerkt zu einem anderen. Nicht nutzbare Eingänge bleiben mit Begründung sichtbar. Bei gleichen Namen die Geräte in Windows eindeutig benennen; bei Zugriffsfehlern die Windows-Mikrofonfreigabe für Desktop-Apps prüfen.

Jarvis spricht standardmäßig **keinen Namen** aus; die frühere voreingestellte Ansprache wird beim Laden entfernt. Begrüßung „Wie kann ich helfen?“ und optionale Ansprache stehen in **Jarvis → Jarvis-Einstellungen**. Taste **Jarvis zuhören** begrüßt dich, hört einen Befehl ab und beendet das einmalige Zuhören nach Antwort oder Stille.

**Chat vorlesen:** Unter **Nachrichten aus dem Chat vorlesen** die Quelle **Nachrichten aus dem Multi-Chat-Fenster** oder **Alle im Tool empfangenen Chatnachrichten** wählen. Die erste Wahl berücksichtigt nur für die Multi-Chat-Anzeige vorgesehene Nachrichten; die zweite erlaubt auch vom Tool empfangene, dort ausgeblendete Nachrichten. Das betrifft beispielsweise die Anzeige automatischer Broadcasts und setzt kein dauerhaft sichtbares Fenster voraus. In beiden Fällen bleiben Filtertreffer stumm. Zusätzlich separat festlegen, wer vorgelesen werden darf: standardmäßig bestätigte **Moderatoren & Kanalinhaber**, alternativ freigegebene Benutzer-IDs oder alle Personen. Plattformen, Länge und Abstand sind einstellbar. Der Ansagetext verwendet `{username}` und `{message}`, etwa `{username} sagt: {message}`. **Chat-Regeln speichern** übernimmt die Auswahl; nur neue Nachrichten werden vorgelesen. Die Plattform muss verbunden sein. Ein geöffnetes Chatfenster allein stellt keine Verbindung her.

**Ereignisansagen:** Follower, Likes, Geschenke und Abos lassen sich einzeln einschalten. Für jede Art gibt es einen eigenen Text; Geschenke können als Geschenkname, Coin-Wert oder beides angesagt werden. Die Eingabefelder nennen ihre Platzhalter, z. B. `{username}`, `{likecount}`, `{giftname}`, `{giftcount}`, `{coins}` oder `{submonth}`. Die Testtasten sprechen eine ausdrücklich gekennzeichnete **Vorschau mit erfundenen Beispieldaten** und senden kein Stream-Ereignis. **Ansagen speichern** übernimmt die Texte. **Standardtexte einsetzen** füllt die Felder; anschließend speichern.

Likes zählen je Person in den tatsächlich empfangenen Ereignissen; die neue Voreinstellung ist **1.000 Likes**, der Abstand bleibt frei einstellbar und vorhandene eigene Werte bleiben erhalten. Geschenkserien werden nach Abschluss einmalig berücksichtigt. Fehlende Coins oder Abo-Monate werden nicht erfunden; in diesem Fall verwendet Jarvis einen passenden Dank ohne diese Zahl. Die lokale TikFinity-Bridge liefert die TikTok-Ereignisse. PC-Werte kommen auf gezielte Nachfrage; Lüfterwarnungen standardmäßig beim Überschreiten von 80 %, mit Rücksetzabstand und Mindestpause.

Spiel, Pause, Start und Ende mit eigenen Bildern und Schnitt/Überblendung auf beiden Ausgaben. Die Tasten steuern Batto-Szenen, nicht die internen Szenen von LIVE Studio. **LIVE-Studio-Sitzung markieren** aktiviert nur die Live-Regeln für Bot/Auto-Broadcast. Eine gestartete virtuelle Kamera setzt diesen öffentlichen Live-Zustand nicht automatisch.

Ein Plugin für Elgato Stream Deck 6.5+ und Batto Touch Deck: Lüfter, PC-Wert, Jarvis-Befehl, Zuhören, Kurvenentwurf, Szene/Übergang, Programmsteuerung und Kombinationen mit bis zu acht Aktionen. Programmsteuerung enthält Kamerastart/-stopp, Bildquellen, Einblendungen, Bot, Chat, Broadcast, Hotkeys und Gaming-Modus. Steuertasten und Plugin-Symbol verwenden ein Standbild aus dem gelieferten **02_Bin_gleich_zurueck.gif**; Lüfteranzeigen behalten das OIP-Bild. Unveränderte Tastenbilder werden nicht erneut erzeugt.

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

Installer: `Batto-3-in-1-Setup-1.9.0.exe`. Plugin: `de.crazybatto.suite.streamDeckPlugin` (Stream Deck 6.5+). Android-App: `Batto-Touch-Deck-1.8.0.apk`. Detaillierte Anleitung: [ANLEITUNG.html](ANLEITUNG.html).

Der freigegebene Windows-Installer benötigt den separat erhaltenen **Installationsschlüssel**. Der Schlüssel steht weder in dieser Anleitung noch im Repository. Build- und Release-Automatisierung verwenden dafür private Konfiguration; der Quellcode enthält keine gültige geheime Eingabe. Für ein Update persönliche Einstellungen behalten und den privaten Schlüssel bereithalten.

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

Android wird separat mit `scripts/build-touch-android.ps1` gebaut; SDK-/Signaturhinweise stehen in [mobile/android/README.md](mobile/android/README.md). Release-APK und dauerhafter privater Signaturschlüssel werden lokal verwaltet. Die Android-CI erzeugt nur ein als `ci-test` benanntes Testpaket; dieses ersetzt keine veröffentlichte Release-APK. Signaturschlüssel und private Plugin-Einstellungen gehören niemals ins Repository.

Loopback-Verbindungen mit getrennten zufälligen Zugriffsschlüsseln: Suite 17656, Messwerte/Overlay 17658, Multi-Chat-Overlay 17787, Navigation 17788. Das Stream-Deck-Plugin liest nur lokale Verbindungsdateien. Der OBS-Leseschlüssel berechtigt nicht zu Steuereingriffen.

## Prüfung

Automatische Jarvis-Tests für rollenbasiertes Vorlesen, gezielte Messwertfragen, fehlende/veraltete Werte, Pin-Einheiten, OBS-Bestätigung, Grenzen und Meldeabstände. Die Tests des übernommenen OBS-2.4.7-Quellstands prüfen unter anderem Chat, Match-Anzeige, Broadcast und Piper. Der Sensor-Selbsttest prüft CSV-Teilzeilen, gleichzeitige Schreiber, beschädigte HWiNFO-Daten und Kurvenvalidierung. Oberflächentest verwendet getrennte Datenordner. Live-Tests mit fremden Streaming-Konten oder einem physischen Stream Deck sind davon getrennt und benötigen eingerichtete Verbindungen.

Die Touch-Oberfläche wurde in isolierten Electron-Fenstern auf QR-Wechsel, PINrotation, Ausschalten, Maus-/Tastatur-/Touch-Menü, Kopieren über Fenstergrenzen, verschachtelte Ordner, Schutz kleiner Raster, Lautstärkeregler und Pausen im Hintergrund geprüft. Screenshots bei 1600 × 1000, 1180 × 800 und im separaten Touch-Fenster ergänzen die Funktionsprüfung. Synthetische Lautstärkewerte prüfen die Bedienung, keine reale Soundausgabe. Tests auf einem physischen Android-/iOS-Gerät sowie mit den persönlichen Soundgeräten sind davon getrennt; eine iOS-Web-App ersetzt keine native iOS-Signierung.

## Herkunft und Rechte

OBS-Quelle: der eigene lokale Multi-Chat-Quellstand zu `Batto-OBS-Tool-2.1-Setup-2.4.7.exe`, auf Basis des Multi-Chat-Commits `ced4ff2`. Renderer, Styles und Hauptprozess wurden mit dem entpackten 2.4.7-Installer verglichen. Das Originalrepository `Multi-Chat` und die ursprüngliche lokale Arbeitskopie werden nicht verändert. Die unveränderten Styles und Hauptbilder sind in `desktop/reference-2.4.7.json` geprüft. FanAtlas und Jarvis wurden aus den eigenen Vorprojekten zusammengeführt. Das Windows-Utils-Beispielplugin und Herstellerinstaller werden nicht mitverteilt. Bereitgestellte Bilder bleiben ihren jeweiligen Rechteinhabern zugeordnet. [Drittanbieter und Modelle](THIRD-PARTY.md).
