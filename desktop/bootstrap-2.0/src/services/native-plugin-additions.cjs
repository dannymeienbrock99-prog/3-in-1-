"use strict";

function action(id, name, description = "") {
  return {
    id,
    name,
    tooltip: description,
    icon: "",
    states: [],
    controllers: ["Keypad", "Encoder"],
    propertyInspectorPath: "",
    raw: { id, name }
  };
}

function plugin(id, name, category, description, actions) {
  return {
    id,
    name,
    version: "2.0.0",
    author: "Crazy_Batto / Team Alpha",
    description,
    category,
    icon: "",
    root: "",
    sourceRoot: "",
    manifestFile: "",
    executablePath: "",
    executableExists: true,
    native: true,
    enabled: true,
    status: "Native Batto-Kompatibilität verfügbar",
    actions
  };
}

const EXTRA_BUILT_IN_PLUGINS = Object.freeze([
  plugin("batto.youtube-music", "YouTube Music Desktop Connector", "Audio", "Medientasten funktionieren nativ. App-spezifische Aktionen prüfen die installierte YouTube-Music-Desktop-Laufzeit und melden fehlende Unterstützung.", [
    action("media.playpause", "Play/Pause"), action("media.next", "Nächster Titel"), action("media.previous", "Vorheriger Titel"),
    action("youtube.music.like", "Like"), action("youtube.music.dislike", "Dislike"), action("media.mute", "Stummschalten"),
    action("media.volume.up", "Lautstärke erhöhen"), action("media.volume.down", "Lautstärke verringern"),
    action("youtube.music.info", "Titelinformationen"), action("youtube.music.shuffle", "Shuffle"),
    action("youtube.music.repeat", "Repeat"), action("youtube.music.playlist", "Playlist starten"), action("youtube.music.open", "YouTube Music öffnen")
  ]),
  plugin("batto.youtube-ticker", "YouTube Ticker", "Streaming", "Kanal, letztes Video und Livestatus über die offizielle YouTube-Daten-API abrufen.", [
    action("youtube.refresh", "Daten aktualisieren"), action("youtube.latest", "Letztes Video öffnen"),
    action("youtube.channel", "Kanal öffnen"), action("youtube.ticker.status", "Live-/Videostatus anzeigen")
  ]),
  plugin("batto.icue", "iCUE", "Hardware", "Corsair iCUE erkennen und öffnen; Originalaktionen bleiben zusätzlich sichtbar, wenn das installierte Plugin gefunden wird.", [
    action("icue.launch", "iCUE öffnen"), action("icue.profile", "iCUE-Profil starten")
  ]),
  plugin("batto.bambulab", "BambuLab Printer Monitor", "Hardware", "Bambu Studio erkennen und öffnen. Netzwerkdrucker-Zugangsdaten werden nicht vorgetäuscht.", [
    action("bambulab.launch", "Bambu Studio öffnen"), action("bambulab.monitor", "Druckermonitor öffnen")
  ]),
  plugin("batto.spotify", "Spotify", "Audio", "Spotify öffnen und über Windows-Medientasten steuern.", [
    action("spotify.launch", "Spotify öffnen"), action("media.playpause", "Play/Pause"), action("media.next", "Nächster Titel"),
    action("media.previous", "Vorheriger Titel"), action("media.volume.up", "Lautstärke erhöhen"), action("media.volume.down", "Lautstärke verringern")
  ]),
  plugin("batto.volume-controller", "Volume Controller", "Audio", "Windows-Systemlautstärke und Lautstärkemixer steuern.", [
    action("media.volume.up", "Lautstärke erhöhen"), action("media.volume.down", "Lautstärke verringern"),
    action("media.mute", "Stummschalten"), action("volume.mixer", "Lautstärkemixer öffnen")
  ]),
  plugin("batto.discord-volume-mixer", "Discord Volume Mixer", "Kommunikation", "Discord und den Windows-Lautstärkemixer öffnen. Nicht verfügbare per-App-Audiowerte werden klar gemeldet.", [
    action("discord.launch", "Discord öffnen"), action("discord.volume.mixer", "Discord-Lautstärkemixer öffnen")
  ]),
  plugin("batto.tikfinity", "TikFinity", "Streaming", "Lokale TikFinity-Ereignisse an Multi-Chat und Stream-Overlay weiterleiten.", [
    action("tikfinity.webhook", "TikFinity-Ereignis senden")
  ]),
  plugin("batto.tiktok-live-studio", "TikTok LIVE Studio", "Streaming", "Installiertes TikTok LIVE Studio erkennen und starten.", [
    action("tiktok.live-studio.launch", "TikTok LIVE Studio öffnen"), action("tiktok.event", "Lokales TikTok-Ereignis senden")
  ]),
  plugin("batto.polls", "Polls, Word Clouds & Spinner Wheels", "Overlay", "Lokale Umfragen, Wortwolken und Glücksrad-Ereignisse für das Stream-Overlay.", [
    action("overlay.poll", "Umfrage anzeigen"), action("overlay.wordcloud", "Wortwolke aktualisieren"), action("overlay.wheel", "Glücksrad drehen")
  ])
]);

module.exports = { EXTRA_BUILT_IN_PLUGINS };
