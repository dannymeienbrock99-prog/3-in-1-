using System.IO;
using System.Text.Json;

namespace FanAtlas;

// Shared by the standalone editor and the windowless suite service.
internal static class SuiteState
{
    // A rejected write must not leave an unsaved curve/layout in the live state.
    // Polling may save discovery updates later, so rolling back only the response is insufficient.
    internal static FanCurve? ConfigureAndSave(AppState state, IEnumerable<SensorRow> sensors, string command, JsonElement body)
    {
        var candidate = JsonSerializer.Deserialize<AppState>(JsonSerializer.Serialize(state, StateStore.Json), StateStore.Json)
            ?? throw new InvalidDataException("Einstellungen konnten nicht vorbereitet werden.");
        var curve = Configure(candidate, sensors, command, body);
        StateStore.Save(candidate);
        // Keep unrelated objects alive: the standalone editor holds tile and curve references.
        switch (command)
        {
            case "profile": state.Profile = candidate.Profile; break;
            case "curve": state.CustomCurves = candidate.CustomCurves; break;
            case "csv": state.CsvPaths = candidate.CsvPaths; break;
            case "stage": state.Stage = candidate.Stage; break;
        }
        return curve;
    }

    internal static BridgeSnapshot Snapshot(AppState state, IEnumerable<SensorRow> readings, string selectedId)
    {
        var rows = readings.ToList();
        var sensors = rows.Select(s => new BridgeSensor(SensorIdentity.PublicId(s.Key), s.Name, s.Key.StartsWith("csv/") ? "Sensorprotokoll" : s.Device, s.Unit, s.Fresh ? s.NumericValue : null, s.Fresh, s.UpdatedUtc, IcueDiscovery.IsLinkSpeed(s) || IcueDiscovery.IsLinkPercent(s, state.Profile))).ToList();
        var tiles = state.Stage.Tiles.Select(t => new BridgeTile(t.Id, t.Name, t.X, t.Y, t.Size, t.Visible, SensorIdentity.PublicId(t.RpmSensorKey), SensorIdentity.PublicId(t.TemperatureSensorKey), t.ProfileKey.Length > 0, SensorIdentity.PublicId(t.PercentSensorKey), t.MaxRpm, t.CenterMode, t.Announce, FanTelemetry.Percent(t, rows))).ToList();
        var curves = state.CustomCurves.Concat(state.Profile.Curves).Select(c => new BridgeCurve(c.Id, c.Name, c.IsCustom)).ToList();
        return new("0.2", DateTime.UtcNow, sensors, curves, new(state.Stage.Background, tiles), selectedId, "Auswahl = Entwurf. Hardwarewechsel über iCUE.");
    }

    internal static FanCurve? Configure(AppState state, IEnumerable<SensorRow> sensors, string command, JsonElement body)
    {
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        switch (command)
        {
            case "stage":
                var scene = body.Deserialize<BridgeScene>(json) ?? throw new InvalidDataException("Layout fehlt.");
                if (scene.Tiles == null || scene.Tiles.Count > 32 || scene.Background is not ("" or "stream-startet.jpg" or "bin-gleich-zurueck.jpg")) throw new InvalidDataException("Ungültiges Layout.");
                var old = state.Stage.Tiles.ToDictionary(t => t.Id);
                string Resolve(string id, string fallback) => sensors.FirstOrDefault(s => SensorIdentity.PublicId(s.Key) == id)?.Key ?? (SensorIdentity.PublicId(fallback) == id ? fallback : "");
                state.Stage.Tiles = scene.Tiles.Select(t => { if (t == null) throw new InvalidDataException("Lüfter fehlt."); var prior = old.GetValueOrDefault(t.Id); return new FanTile { Id = t.Id, Name = t.Name, X = t.X, Y = t.Y, Size = t.Size, Visible = t.Visible, RpmSensorKey = Resolve(t.RpmSensorId, prior?.RpmSensorKey ?? ""), TemperatureSensorKey = Resolve(t.TemperatureSensorId, prior?.TemperatureSensorKey ?? ""), PercentSensorKey = Resolve(t.PercentSensorId, prior?.PercentSensorKey ?? ""), MaxRpm = t.MaxRpm, CenterMode = t.CenterMode, Announce = t.Announce, ProfileKey = prior?.ProfileKey ?? "" }; }).ToList();
                foreach (var removed in old.Values.Where(t => !state.Stage.Tiles.Any(n => n.Id == t.Id))) { if (removed.RpmSensorKey.Length > 0) state.Stage.HiddenAutoSensors.Add(removed.RpmSensorKey); if (removed.PercentSensorKey.Length > 0) state.Stage.HiddenAutoSensors.Add(removed.PercentSensorKey); if (removed.ProfileKey.Length > 0) state.Stage.HiddenAutoSensors.Add("profile/" + ProfileReader.Part(removed.ProfileKey, "sensorSN")); }
                state.Stage.Background = scene.Background; state.Stage.Normalize(); break;
            case "profile":
                string path = body.GetProperty("path").GetString() ?? "";
                if (!path.EndsWith(".cueprofile", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Bitte ein iCUE-Profil wählen.");
                var profile = ProfileReader.Read(path);
                IcueDiscovery.RefreshAliases(profile, state.Profile);
                state.Profile = profile; break;
            case "csv":
                var paths = body.GetProperty("paths").Deserialize<List<string>>() ?? new();
                if (paths.Count > 20 || paths.Any(p => string.IsNullOrEmpty(p) || !Path.IsPathFullyQualified(p) || !new[] { ".csv", ".log" }.Contains(Path.GetExtension(p).ToLowerInvariant()))) throw new InvalidDataException("Bitte höchstens 20 CSV-/Logdateien wählen.");
                state.CsvPaths = paths.Distinct(StringComparer.OrdinalIgnoreCase).ToList(); break;
            case "curve":
                var curve = body.Deserialize<FanCurve>(json) ?? throw new InvalidDataException("Kurve fehlt.");
                if (curve.Points == null || curve.Points.Any(p => p == null)) throw new InvalidDataException("Kurvenpunkte fehlen.");
                string? error = FanCurve.Validate(curve); if (error != null) throw new InvalidDataException(error);
                var existing = state.CustomCurves.FindIndex(c => c.Id == curve.Id); curve.IsCustom = true; curve.Predefined = false; curve.Origin = "Batto 3-in-1 Entwurf";
                if (existing >= 0) state.CustomCurves[existing] = curve; else { curve.Id = Guid.NewGuid().ToString(); state.CustomCurves.Add(curve); }
                return curve;
            default: throw new InvalidDataException("Unbekannte Einstellung.");
        }
        return null;
    }
}
