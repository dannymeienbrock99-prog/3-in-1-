# Encoder- und Hardware-Monitoring-Overlay

Dieses Modul ersetzt die alte, schlecht verteilte Encoder-Anzeige durch ein frei konfigurierbares Overlay im Stil moderner 3DMark- und MSI-Afterburner-Anzeigen.

## Behobene Punkte

- kein dunkelblauer Vollbildfilter
- `html`, `body`, Viewport und Stage sind vollständig transparent
- nur einzelne aktivierte Messwertkarten besitzen einen optionalen Hintergrund
- keine Bezeichnung „Kandidat“
- bei laufendem Stream oder laufender Aufnahme steht eindeutig **Aktiver Encoder**
- Messwerte bleiben innerhalb der gewählten Overlay-Auflösung
- kompakte Standardverteilung ohne riesigen Encoder- oder Bitrateblock
- Frametime-Liniendiagramm und 1-%-Low-FPS
- dedizierte GPU wird vor einer integrierten CPU-Grafik ausgewählt

## Messwerte

Das Modul enthält auswählbare Werte für:

- GPU-Modell, aktive GPU, GPU-/Encoder-/Decoder-Auslastung
- GPU-Temperatur, Hotspot, Takte, VRAM, Leistung, Power-Limit, Spannung und Lüfter
- CPU-Modell, Gesamt- und Kernauslastung, Temperatur, Takte und Leistung
- RAM in GB und Prozent
- Encoder, Codec, Rate Control, Preset, Profil, Keyframes und B-Frames
- Soll-/Ist-Bitrate, Auflösung, Skalierungsfilter und FPS
- Frametime, Durchschnitts-FPS, 1-%-Low-FPS und Frametime-Diagramm
- Rendering-, Encoding- und Netzwerk-Drops
- OBS-CPU, Stream-/Aufnahmelaufzeit und Aufnahmegröße
- Upload, Durchschnittsupload, Latenz, Status und Neuverbindungen

## Frei einstellbar je Messwert

- ein-/ausblenden
- Position, Breite und Höhe
- Schriftart, Schriftgröße und Schriftfarbe
- Hintergrundfarbe und Deckkraft
- Rahmenfarbe, Rahmenstärke und Eckenradius
- Akzentfarbe
- Einheit und Nachkommastellen
- Warn- und kritische Schwelle
- Aktualisierungsrate
- optionaler Gruppenname
- bei Diagrammen Zeitraum und Maximalwert

## Layout-Editor

Der Editor unterstützt:

- Drag-and-drop
- Größenänderung über den Griff unten rechts
- Rasterfang
- Ausrichtungslinien
- getrennte Layouts je OBS-Profil
- Auflösungen 720p, 1080p, 1440p, 4K und benutzerdefiniert
- Import und Export
- Vorlagen **Kompakt**, **Horizontal**, **Vertikal**, **3DMark** und **MSI Afterburner**
- echten Button zum Kopieren der OBS-Adresse
- Testtelemetrie mit Ryzen 7 9800X3D und NVIDIA GeForce RTX 5080

## Starten

```bash
cd modules/encoder-monitoring-overlay
npm install
npm start
```

Danach werden zwei lokale Adressen ausgegeben:

```text
Editor:  http://127.0.0.1:17822/editor
OBS-URL: http://127.0.0.1:17822/overlay
```

Ist Port 17822 belegt, wird automatisch der nächste freie lokale Port verwendet.

## Integration in Batto OBS Tool

```js
const { MonitoringOverlayServer } = require("./modules/encoder-monitoring-overlay/src/server.cjs");

const server = new MonitoringOverlayServer({
  port: 17822,
  configFile: app.getPath("userData") + "/encoder-overlay.json"
});

await server.start();

encoderMonitor.on("telemetry", (telemetry) => {
  server.updateTelemetry(telemetry);
});
```

Der Server bindet ausschließlich an `127.0.0.1`. Die OBS-Adresse enthält weder Twitch- noch OBS-Zugangsdaten.

## Telemetrieformat

Der Normalisierer akzeptiert sowohl das neue Format als auch mehrere ältere Feldnamen. Beispiel:

```js
server.updateTelemetry({
  profileName: "Streaming",
  gpus: [
    { name: "AMD Radeon(TM) Graphics", memoryTotalMb: 512 },
    {
      name: "NVIDIA GeForce RTX 5080",
      memoryTotalMb: 16304,
      utilizationPercent: 67,
      encoderUtilizationPercent: 34,
      temperatureC: 61
    }
  ],
  encoder: {
    name: "NVIDIA NVENC AV1",
    codec: "AV1",
    rateControl: "CBR",
    bitrateKbps: 12000,
    gpuName: "NVIDIA GeForce RTX 5080"
  },
  output: {
    streamActive: true,
    actualBitrateKbps: 11984,
    totalFrames: 360000,
    renderLagFrames: 12,
    encodingLagFrames: 3,
    networkDroppedFrames: 4
  },
  video: {
    outputWidth: 2560,
    outputHeight: 1440,
    outputFps: 60
  }
});
```

## Tests

```bash
npm run check
npm test
```

Die Tests prüfen unter anderem:

- RTX 5080 wird statt `AMD Radeon(TM) Graphics` ausgewählt
- „Kandidat“ taucht nicht auf
- alle Messwerte und Vorlagen sind vorhanden
- keine Karte wird bei 1280 × 720 abgeschnitten
- Profile speichern getrennte Layouts
- Overlay-Wurzel bleibt transparent
- lokaler Server und automatischer Portwechsel funktionieren
