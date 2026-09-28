# Twitch Hologramm-Chat

Dieses Modul bildet **nur den visuellen Hologramm-Effekt für Twitch-Namen und Chatnachrichten** ab.

Es ist ein eigener Batto-OBS-Tool-Effekt und benötigt:

- keinen Discord-Server,
- keinen Discord-Server-Boost,
- kein Discord-Nitro,
- keinen kostenpflichtigen Overlay-Dienst,
- keine Änderung am echten Twitch-Chat.

Die Farben werden ausschließlich in der lokalen Batto-OBS-Tool-Anzeige und in der transparenten OBS-Browserquelle verändert.

## Priorität der Stile

1. eigener Stil für einen konkreten Twitch-Namen oder eine Twitch-Benutzer-ID
2. Streamer
3. Moderator
4. VIP
5. Abonnent
6. normaler Zuschauer

Ein individueller Benutzerstil überschreibt damit immer den Rollenstil.

## Einstellbar

- Effekt für Namen ein oder aus
- Effekt für Chatnachricht ein oder aus
- zwei bis sechs Verlaufsfarben
- Farbwinkel
- Animationsgeschwindigkeit
- Leuchtstärke
- Helligkeit
- Sättigung
- Sprechblase ein oder transparent
- reduzierte Animation
- getrennte Stile je Twitch-Rolle
- eigener Stil je Twitch-Name

## Dateien

```text
modules/twitch-holo-chat/
├── src/
│   └── holo-style-engine.cjs
├── web/
│   ├── overlay.html
│   ├── overlay.css
│   ├── overlay.js
│   ├── editor.html
│   ├── editor.css
│   └── editor.js
└── test/
    └── holo-style-engine.test.cjs
```

## Vorschau

`web/editor.html` öffnet den Farb-Editor mit integrierter Live-Vorschau.

Die reine OBS-Ausgabe ist:

```text
web/overlay.html
```

Für eine lokale Vorschau kann die Overlay-Seite mit `?demo=1` geöffnet werden.

## JavaScript-Schnittstelle

Die Overlay-Seite stellt `window.BattoHoloChat` bereit:

```js
BattoHoloChat.configure({
  applyToName: true,
  applyToMessage: true,
  roleStyles: {
    moderator: {
      colors: ["#00f5a0", "#00d9f5", "#6dffb8"],
      speedSeconds: 4,
      glow: 18
    }
  },
  userStyles: {
    crazy_batto: {
      colors: ["#ff3b3b", "#ffd166", "#fff08a"],
      speedSeconds: 3.2,
      glow: 24
    }
  }
});

BattoHoloChat.addMessage({
  id: "message-1",
  username: "crazy_batto",
  displayName: "Crazy_Batto",
  color: "#55d6ff",
  text: "Kostenloser Hologramm-Chat ohne Server-Boost.",
  roles: { broadcaster: true }
});
```

Chattext wird über `textContent` dargestellt und nicht als HTML eingefügt.

## Einbau in Batto OBS Tool

Nach Übernahme des Windows-App-Kerns wird dieses Modul an den vorhandenen Twitch-Chat-Empfang und den lokalen Overlay-Server angeschlossen. Dafür wird weder eine zweite Anwendung noch ein zweiter Installer benötigt.

Die Twitch-Verbindung liefert nur Nachricht, Name, Twitch-Farbe und Rolle. Der Hologramm-Editor entscheidet lokal, wie Name und Nachricht im Overlay aussehen.

## Tests

```bash
cd modules/twitch-holo-chat
npm test
npm run check
```
