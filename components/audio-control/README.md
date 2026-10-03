# Windows-Lautstärkeregler

Kleiner .NET-8-Helfer für die Windows-Core-Audio-Schnittstellen. Er liest oder setzt ausschließlich Wiedergabelautstärken und Stummschaltungen. Er nimmt keinen Ton auf und startet keine Tonwiedergabe.

Der Hauptprozess startet ihn bei Bedarf mit verdecktem Konsolenfenster. JSON-Anfragen gehen zeilenweise über stdin, Antworten über stdout. Nach 15 Sekunden ohne Anfragen beendet der Node-Dienst den Helfer. Es gibt weder einen eigenen Hintergrunddienst noch eine Pollschleife. Sichtbare Bedienflächen fragen selbst sparsam nach; gleichzeitige Lesezugriffe teilen sich eine Sekunde lang den Cache.

Ziele: `master` folgt dem Windows-Standardausgabegerät, `device:<Windows-ID>` bezeichnet ein bestimmtes Wiedergabegerät, `app:<SHA256>` fasst die Audiositzungen derselben ausführbaren Datei über alle Wiedergabegeräte zusammen. Der Hash basiert auf dem vollständigen kleingeschriebenen Programmpfad und bleibt bei einem normalen App-Neustart erhalten. Nach einer Änderung des Installationspfades muss das Ziel neu ausgewählt werden. Programme erscheinen, sobald Windows eine Audiositzung für sie bereitstellt; ein fehlendes Programm wird niemals durch die Gesamtlautstärke ersetzt. Bei verschiedenen Session-Pegeln zeigt der App-Regler den Mittelwert; Setzen wirkt auf alle zugeordneten Sessions.

Die besondere Ziel-ID `jarvis` wird nur im Node-Dienst über die von der Suite übergebenen Einstellungsfunktionen behandelt. Das benötigt keinen Windows-Helfer.

Build: `dotnet publish components/audio-control/BattoAudioControl.csproj -c Release -r win-x64 --self-contained true -p:RuntimeFrameworkVersion=8.0.31 -o FanAtlas`.

`BattoAudioControl.exe --self-test` prüft Lautstärke und Stummschaltung ausschließlich an einer neuen eigenen, nicht abspielenden Audiositzung. Ihre Ausgangswerte werden anschließend wiederhergestellt. Die normale JSON-Schnittstelle bietet diesen Test nicht als Fernsteuerbefehl an.

Schnittstellen: [Microsoft IMMDeviceEnumerator](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nn-mmdeviceapi-immdeviceenumerator), [IAudioEndpointVolume](https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nn-endpointvolume-iaudioendpointvolume), [IAudioSessionControl2](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessioncontrol2).
