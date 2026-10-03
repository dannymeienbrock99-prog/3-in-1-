# Batto Touch Deck für Handy und Tablet

## Android

`Batto-Touch-Deck-1.7.0.apk` aus dem [Release](https://github.com/dannymeienbrock99-prog/3-in-1-/releases/tag/v1.7.0) installieren. Android kann dafür einmalig die Erlaubnis zum Installieren aus dem verwendeten Browser verlangen.

Am PC in **Touch Deck → Handy / Tablet** die Verbindung einschalten. PC und Handy/Tablet ins gleiche private WLAN bringen. In der Android-App die angezeigte Adresse, zum Beispiel `192.168.1.20:17660`, eintragen und danach die PIN eingeben. **PC wechseln** trennt die Verbindung. Die Taste **Trennen** auf dem Deck meldet das Gerät am PC ab.

Die App unterstützt Android 8.0 und neuer, Tablets sowie Hoch- und Querformat. Es läuft eine einzelne Android-System-WebView; keine zusätzliche Videoübertragung, kein Hintergrunddienst, keine Mikrofon- oder Kameraberechtigung. Android System WebView sollte aktuell sein. Die App merkt sich nur die PC-Adresse. Die Kopplung gilt für die aktuelle Sitzung und höchstens acht Stunden; nach dem Beenden gegebenenfalls erneut koppeln.

## iPhone / iPad

Die am PC angezeigte Adresse in **Safari** öffnen. **Teilen → Zum Home-Bildschirm** wählen; wenn angeboten, **Als Web-App öffnen** einschalten. Anschließend das Batto-Symbol starten und die PIN eingeben. Das ist eine Startbildschirm-Web-App, kein App-Store-/IPA-Paket. Apple beschreibt dieses Vorgehen im [iPhone-Handbuch](https://support.apple.com/de-de/guide/iphone/iphea86e5236/ios).

Beide Varianten benötigen den laufenden PC und dasselbe private Netzwerk. Das LAN nutzt HTTP und PIN-Kopplung; keine Internet-Freigabe oder Portweiterleitung einrichten. Kein Offline-Modus oder Service Worker. Die Tastengröße kann unter **Anzeige auf diesem Gerät** unabhängig vom PC angepasst werden. **Größe vom PC übernehmen** setzt diese Einstellung zurück.

## Entwickler

Das Projekt nutzt ausschließlich Android-Frameworkklassen. Kein Gradle-Download, keine Runtimebibliotheken, kein JavaScript-Interface. Explizite private IPv4-Adressen werden vor dem Verbindungsaufbau geprüft; WebView-Anfragen bleiben auf diesem Ursprung. Datei-/Content-Zugriff und Cookies sind aus. Die App zielt auf API 36 (Android 16), Mindest-API 26. Sie enthält keine nativen Bibliotheken.

Voraussetzungen: Windows, PowerShell, JDK 21 oder neuer, Android SDK `platforms;android-36` und `build-tools;36.x`.

```powershell
./scripts/build-touch-android.ps1 -SigningDirectory 'C:/Private/BattoTouchDeckSigning' -OutputDirectory './dist/Extras'
```

Der erste Build erstellt einen eigenen langlebigen APK-Signaturschlüssel im angegebenen Ordner **außerhalb des Repositories**. Schlüssel und DPAPI-geschützte Passwortdatei auf demselben Windows-Konto sicher aufbewahren; beide sind für kompatible spätere Updates nötig. Nicht in Git oder Release-Artefakte aufnehmen. Die Windows-DPAPI-Datei lässt sich nicht auf einem beliebigen anderen Rechner entschlüsseln. Für eine Migration den Schlüssel kontrolliert neu verschlüsseln. CI verwendet `-DebugBuild` und veröffentlicht nur ein ausdrücklich als `ci-test` benanntes Test-Artefakt, keinen Release-Ersatz.

Der Build prüft 27 gültige/ungültige Adressen und Ursprünge, erstellt DEX/Ressourcen mit den SDK-Werkzeugen, richtet das APK aus und überprüft die Signatur. Android-Dokumentation: [SDK 36](https://developer.android.com/about/versions/16/setup-sdk), [APK signieren](https://developer.android.com/tools/apksigner). Reale WLAN-Verbindung und Apple-Startbildschirm müssen mit den jeweiligen Geräten geprüft werden.
