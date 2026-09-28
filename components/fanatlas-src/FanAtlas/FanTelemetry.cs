namespace FanAtlas;

public record FanPercent(double? Value, bool Fresh, DateTime UpdatedUtc, string Basis, string Unit = "%");
public static class FanTelemetry
{
    public static FanPercent Percent(FanTile tile, IEnumerable<SensorRow> sensors)
    {
        // A configured percentage source takes precedence, including when it is stale.
        // RPM is only converted after the user explicitly supplies this fan's 100% reference.
        bool measured = tile.PercentSensorKey.Length > 0;
        var row = sensors.FirstOrDefault(s => s.Key == (measured ? tile.PercentSensorKey : tile.RpmSensorKey));
        string basis = measured ? "measured" : tile.MaxRpm >= 100 ? "rpm-reference" : "missing-reference";
        bool valid = row?.Fresh == true && double.IsFinite(row.NumericValue) && row.NumericValue >= 0
            && (measured ? row.Unit == "%" && row.NumericValue <= 100 : row.Unit == "RPM" && tile.MaxRpm >= 100 && double.IsFinite(tile.MaxRpm));
        return new(valid ? (measured ? row!.NumericValue : Math.Clamp(row!.NumericValue / tile.MaxRpm * 100, 0, 100)) : null,
            valid, row?.UpdatedUtc ?? DateTime.MinValue, basis);
    }
}
