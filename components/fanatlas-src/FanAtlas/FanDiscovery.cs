namespace FanAtlas;

public static class FanDiscovery
{
    public static bool Refresh(AppState state, IEnumerable<SensorRow> sensors)
    {
        bool changed = false;
        var stage = state.Stage;
        // Migrate the old automatic GPU placeholders; keep genuine GPU PC telemetry elsewhere.
        changed |= stage.Tiles.RemoveAll(t => t.Kind != "normal" && t.RpmSensorKey.StartsWith("nvml/") && t.RpmSensorKey.Contains("/fan/")) > 0;
        var speeds = sensors.Where(s => s.Fresh && IcueDiscovery.IsLinkSpeed(s)).ToArray();
        var known = IcueDiscovery.LinkFans(state.Profile);
        var percentages = sensors.Where(s => s.Fresh && IcueDiscovery.IsLinkPercent(s, state.Profile)).ToArray();
        foreach (var f in known)
        {
            if (stage.HiddenAutoSensors.Contains("profile/" + f.Serial)) continue;
            var tile = stage.Tiles.FirstOrDefault(t => t.ProfileKey == f.Key || f.Serial.Length > 0 && ProfileReader.Part(t.ProfileKey, "sensorSN") == f.Serial);
            var matching = speeds.Where(s => IcueDiscovery.SameFan(s, f) && known.Count(k => IcueDiscovery.SameFan(s, k)) == 1).ToArray();
            var reading = matching.Length == 1 ? matching[0] : null;
            tile ??= reading == null ? null : stage.Tiles.FirstOrDefault(t => t.RpmSensorKey == reading.Key);
            if (tile == null && stage.Tiles.Count < 32)
            {
                tile = NewLinkTile(stage); tile.Name = f.Name; tile.ProfileKey = f.Key;
                stage.Tiles.Add(tile); changed = true;
            }
            if (tile != null && tile.ProfileKey.Length == 0) { tile.ProfileKey = f.Key; changed = true; }
            if (tile != null && tile.RpmSensorKey.Length == 0 && reading != null) {
                tile.RpmSensorKey = reading.Key;
                if (tile.Name == f.Name || tile.Name.StartsWith("LINK-Lüfter · …")) tile.Name = reading.Name;
                changed = true;
            }
            var percent = percentages.Where(s => IcueDiscovery.SameFan(s, f) && known.Count(k => IcueDiscovery.SameFan(s, k)) == 1).ToArray();
            if (tile != null && tile.PercentSensorKey.Length == 0 && percent.Length == 1) { tile.PercentSensorKey = percent[0].Key; changed = true; }
        }
        foreach (var sensor in speeds)
        {
            if (stage.Tiles.Any(t => t.RpmSensorKey == sensor.Key) || stage.HiddenAutoSensors.Contains(sensor.Key) || stage.Tiles.Count >= 32) continue;
            var tile = NewLinkTile(stage); tile.Name = sensor.Name; tile.RpmSensorKey = sensor.Key;
            stage.Tiles.Add(tile); changed = true;
        }
        if (stage.ShowNormalFans)
        {
            foreach (var sensor in sensors.Where(s => s.Fresh && double.IsFinite(s.NumericValue) && s.NumericValue >= 0 && IsNormalSpeed(s)))
            {
                if (stage.Tiles.Any(t => t.RpmSensorKey == sensor.Key) || stage.HiddenAutoSensors.Contains(sensor.Key) || stage.Tiles.Count >= 32) continue;
                int index = stage.Tiles.Count(t => t.Kind == "normal");
                if (index >= 20) break;
                var tile = NewSideTile(index, true); tile.Name = sensor.Device + " · " + sensor.Name; tile.RpmSensorKey = sensor.Key;
                tile.Clamp(); stage.Tiles.Add(tile); changed = true;
            }
        }
        // Temperatures are assigned by the user, never by choosing the first GPU sensor.
        return changed;
    }
    public static FanTile NewTile(int index) => new() { X = 40 + index % 8 * 230, Y = 35 + index / 8 * 250, Size = 180 };
    private static FanTile NewLinkTile(StageSettings stage) => stage.ShowNormalFans && stage.Tiles.Count(t => t.Kind != "normal") < 20
        ? NewSideTile(stage.Tiles.Count(t => t.Kind != "normal"), false) : NewTile(stage.Tiles.Count);
    public static FanTile NewSideTile(int index, bool normal) => new() { Kind = normal ? "normal" : "link", CenterMode = normal ? "rpm" : "percent", X = (normal ? 1000 : 40) + index % 5 * 175, Y = 35 + index / 5 * 250, Size = 150 };
    public static bool IsNormalSpeed(SensorRow sensor) => sensor.Unit == "RPM" && !IcueDiscovery.IsLinkSpeed(sensor)
        && !System.Text.RegularExpressions.Regex.IsMatch(sensor.Name, @"pump|pumpe", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    public static bool IsNormalPercent(SensorRow sensor) => sensor.Unit == "%"
        && System.Text.RegularExpressions.Regex.IsMatch(sensor.Name, @"fan|lüfter|luefter", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
        && !System.Text.RegularExpressions.Regex.IsMatch(sensor.Name, @"pump|pumpe|load|auslastung", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
}
