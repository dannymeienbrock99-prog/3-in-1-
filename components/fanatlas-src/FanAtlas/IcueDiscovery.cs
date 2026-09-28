using System.IO;
using System.Xml;
using System.Xml.Linq;
using System.Text.RegularExpressions;

namespace FanAtlas;

// Only reads iCUE's own files. Never opens USB/SMBus or takes device ownership.
public static class IcueDiscovery
{
    public static string Status { get; private set; } = "iCUE LINK: Warte auf Sensorprotokoll.";
    public static void Initialize(AppState state)
    {
        if (Environment.GetEnvironmentVariable("BATTO_DISABLE_ICUE_DISCOVERY") == "1") return;
        string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Corsair", "CUE5");
        try
        {
            if (state.Profile.Fans.Count == 0)
            {
                var config = ReadXml(Path.Combine(folder, "config.cuecfg"));
                string id = config.Descendants("value").FirstOrDefault(x => (string?)x.Attribute("name") == "defaultProfile")?.Value ?? "";
                if (Guid.TryParse(id, out var guid))
                {
                    string file = Path.Combine(folder, "profiles", "{" + guid + "}.cueprofiledata");
                    state.Profile = ProfileReader.Read(file);
                }
            }
            var props = ReadXml(Path.Combine(folder, "sensors", "UserProps"));
            ApplyAliases(state.Profile, props);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or XmlException or InvalidDataException) { /* Profile import remains available. */ }
        int count = LinkFans(state.Profile).Count;
        Status = count > 0 ? $"iCUE LINK: {count} Lüfter im gespeicherten Profil. Live-Werte benötigen ein laufendes iCUE-Sensorprotokoll." : "iCUE LINK: Noch kein Profil gefunden. iCUE-Profil oder Sensorprotokoll verbinden.";
        DiscoverLogs(state);
    }
    public static void ApplyAliases(ProfileData profile, XDocument props)
    {
        var names = props.Descendants("sensor").Select(s => new { Id = s.Descendants("id").FirstOrDefault(i => i.Value.Contains("senstype<fan>", StringComparison.OrdinalIgnoreCase))?.Value, Name = s.Parent?.Element("name")?.Value }).Where(x => !string.IsNullOrWhiteSpace(x.Id) && !string.IsNullOrWhiteSpace(x.Name)).ToArray();
        foreach (var fan in profile.Fans)
        {
            var exact = names.LastOrDefault(n => n.Id == fan.Key);
            if (exact != null) fan.Name = exact.Name!;
            // Moving a LINK fan to another hub changes its key, but not its fan serial.
            fan.Aliases = names.Where(n => n.Id == fan.Key || fan.Serial.Length > 0 && ProfileReader.Part(n.Id!, "sensorSN") == fan.Serial).Select(n => n.Name!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }
    }
    private static XDocument ReadXml(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 20_000_000 });
        return XDocument.Load(reader);
    }
    public static List<FanEntry> LinkFans(ProfileData profile) => profile.Fans
        // LINK fan serials in the imported iCUE schema begin with 01; 07 is an AIO/pump channel.
        .Where(f => f.Serial.StartsWith("01") || Regex.IsMatch(f.Name, @"\b(QX|RX|LX)\b", RegexOptions.IgnoreCase))
        .GroupBy(f => f.Serial.Length > 0 ? f.Serial : f.Key).Select(g => g.Last()).ToList();
    public static bool IsLinkSpeed(SensorRow sensor) => sensor.Unit == "RPM" && !sensor.Key.StartsWith("nvml/")
        && Regex.IsMatch(sensor.Name + " " + sensor.Device, @"iCUE\s*LINK|\b(QX|RX|LX)\b|Corsair", RegexOptions.IgnoreCase)
        && !Regex.IsMatch(sensor.Name, @"pump|pumpe", RegexOptions.IgnoreCase);
    public static bool SameFan(SensorRow sensor, FanEntry fan)
    {
        if (fan.Serial.Length > 0 && sensor.Name.Contains(fan.Serial, StringComparison.OrdinalIgnoreCase)) return true;
        return (fan.Aliases ?? new()).Append(fan.Name).Any(alias => {
            var name = alias.Trim();
            return name.Length > 4 && !name.Contains('…') && Regex.IsMatch(sensor.Name, @"(?<![\w])" + Regex.Escape(name) + @"(?![\w])", RegexOptions.IgnoreCase);
        });
    }
    public static bool IsLinkPercent(SensorRow sensor, ProfileData profile) => sensor.Unit == "%" && !sensor.Key.StartsWith("nvml/")
        && !Regex.IsMatch(sensor.Name, @"pump|pumpe|GPU|RAM|memory", RegexOptions.IgnoreCase)
        && (LinkFans(profile).Any(f => SameFan(sensor, f))
            || Regex.IsMatch(sensor.Name + " " + sensor.Device, @"iCUE\s*LINK|\b(QX|RX|LX)\b", RegexOptions.IgnoreCase)
            && Regex.IsMatch(sensor.Name, @"fan|lüfter|lufter|speed|duty|drehzahl", RegexOptions.IgnoreCase));
    public static void DiscoverLogs(AppState state)
    {
        if (Environment.GetEnvironmentVariable("BATTO_DISABLE_ICUE_DISCOVERY") == "1") return;
        var roots = new[] { Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Path.GetTempPath() }.Concat(state.CsvPaths.Select(Path.GetDirectoryName).OfType<string>()).Distinct(StringComparer.OrdinalIgnoreCase);
        foreach (string dir in roots.ToArray())
        {
            try
            {
                var newest = new DirectoryInfo(dir).EnumerateFiles("corsair_cue_*.csv", SearchOption.TopDirectoryOnly).OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault();
                if (newest == null || DateTime.UtcNow - newest.LastWriteTimeUtc > TimeSpan.FromMinutes(2)) continue;
                state.CsvPaths.RemoveAll(p => Path.GetDirectoryName(p)?.Equals(dir, StringComparison.OrdinalIgnoreCase) == true && Path.GetFileName(p).StartsWith("corsair_cue_", StringComparison.OrdinalIgnoreCase));
                if (state.CsvPaths.Count < 20 && !state.CsvPaths.Contains(newest.FullName, StringComparer.OrdinalIgnoreCase)) state.CsvPaths.Add(newest.FullName);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { }
        }
    }
}
