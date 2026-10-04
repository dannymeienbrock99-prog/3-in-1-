using System.IO;
using System.Text.Json;

namespace FanAtlas;

// Pure curve/configuration regressions: no sensor enumeration, listener or hardware writes.
internal static class CurveTests
{
    internal static int Run(string report)
    {
        var lines = new List<string>();
        int failures = 0;
        string previousDirectory = StateStore.DirectoryPath;
        string? previousDiscovery = Environment.GetEnvironmentVariable("BATTO_DISABLE_ICUE_DISCOVERY");
        Environment.SetEnvironmentVariable("BATTO_DISABLE_ICUE_DISCOVERY", "1");
        string output = Path.GetDirectoryName(Path.GetFullPath(report))!;
        Directory.CreateDirectory(output);
        string fixtures = Path.Combine(output, "curve-fixtures-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(fixtures);
        void Check(string name, Action action)
        {
            try { action(); lines.Add("PASS " + name); }
            catch (Exception e) { failures++; lines.Add("FAIL " + name + " " + e.Message); }
        }
        void Assert(bool value) { if (!value) throw new Exception("Assertion failed"); }
        void Invalid(Action action)
        {
            try { action(); }
            catch (InvalidDataException) { return; }
            throw new Exception("Invalid data was accepted");
        }
        FanCurve Example(string id = "imported") => new()
        {
            Id = id, Name = "Profilkurve", SensorLabel = "Kühlmittel",
            Points = new(new[] { new CurvePoint(25, 20), new CurvePoint(40, 70), new CurvePoint(55, 100) })
        };
        JsonElement Body(FanCurve curve) => JsonSerializer.SerializeToElement(curve, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        AppState State() => new()
        {
            Profile = new() { Name = "Testprofil", Curves = new() { Example() }, Fans = new() { new() { Key = "fan", Name = "Front", CurveId = "imported", CurveName = "Profilkurve" } } }
        };
        try
        {
            Check("Null points and null entries produce validation errors rather than crashes", () =>
            {
                var c = Example(); c.Points = null!; Assert(FanCurve.Validate(c) != null && c.Evaluate(30) == null);
                c.Points = new() { new(25, 20), null! }; Assert(FanCurve.Validate(c) != null && c.Evaluate(30) == null);
            });
            Check("Temperature references are required and limited to 200 characters", () =>
            {
                var c = Example(); c.SensorLabel = new string('x', 200); Assert(FanCurve.Validate(c) == null);
                c.SensorLabel += "x"; Assert(FanCurve.Validate(c) != null);
                c.SensorLabel = "  "; Assert(FanCurve.Validate(c) != null);
            });
            Check("Duplicate descending and nonfinite points cannot be evaluated or saved", () =>
            {
                foreach (double temperature in new[] { 25.0, 20.0, -1.0, 121.0, double.NaN, double.PositiveInfinity })
                {
                    var c = Example(); c.Points[1].Temperature = temperature;
                    Assert(FanCurve.Validate(c) != null && c.Evaluate(30) == null);
                }
                foreach (double duty in new[] { -1.0, 101.0, double.NaN, double.PositiveInfinity })
                {
                    var c = Example(); c.Points[1].Duty = duty; Assert(FanCurve.Validate(c) != null);
                }
            });
            Check("Configured curve rejects invalid data without changing state", () =>
            {
                var state = State(); var c = Example(); c.Points[1].Temperature = c.Points[0].Temperature;
                string before = JsonSerializer.Serialize(state);
                Invalid(() => SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "curve", Body(c)));
                Assert(JsonSerializer.Serialize(state) == before);
            });
            Check("Imported curve becomes a new local draft while profile assignments remain unchanged", () =>
            {
                StateStore.DirectoryPath = Path.Combine(fixtures, "saved"); var state = State();
                var c = Example(); c.Name = "Eigene Kopie"; c.Points[1].Duty = 75;
                var saved = SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "curve", Body(c))!;
                Assert(saved.Id != "imported" && saved.IsCustom && !saved.Predefined);
                Assert(state.Profile.Curves.Single().Points[1].Duty == 70 && state.Profile.Fans.Single().CurveId == "imported");
                Assert(state.CustomCurves.Single().Id == saved.Id);
                Assert(StateStore.Load().CustomCurves.Single().Points[1].Duty == 75);
            });
            Check("Saving an existing draft updates its ID without creating duplicates", () =>
            {
                StateStore.DirectoryPath = Path.Combine(fixtures, "update"); var state = State();
                var saved = SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "curve", Body(Example()))!;
                var changed = saved.Copy(); changed.Name = "Geändert"; changed.Points[1].Duty = 80;
                var updated = SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "curve", Body(changed))!;
                Assert(updated.Id == saved.Id && state.CustomCurves.Count == 1 && updated.Points[1].Duty == 80);
                Assert(StateStore.Load().CustomCurves.Single().Name == "Geändert");
            });
            Check("Saving a curve preserves unrelated live editor references", () =>
            {
                StateStore.DirectoryPath = Path.Combine(fixtures, "references"); var state = State();
                var stage = state.Stage; var profile = state.Profile; var paths = state.CsvPaths;
                SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "curve", Body(Example()));
                Assert(ReferenceEquals(stage, state.Stage) && ReferenceEquals(profile, state.Profile) && ReferenceEquals(paths, state.CsvPaths));
            });
            Check("Profile reimport preserves user labels across a hub change and leaves unrelated fans unbound", () =>
            {
                StateStore.DirectoryPath = Path.Combine(fixtures, "profile-reimport"); var state = State();
                state.Profile.Fans = new() { new() { Key = "serial<old>senstype<fan>sensorSN<010001>", Serial = "010001", Name = "Front links", Aliases = new() { "Front links" } } };
                string file = Path.Combine(fixtures, "reimport.cueprofile");
                File.WriteAllText(file, "<cereal><entry><key>serial&lt;new&gt;senstype&lt;fan&gt;sensorSN&lt;010001&gt;</key><value><assignmentConfigId>curve</assignmentConfigId></value></entry><entry><key>serial&lt;new&gt;senstype&lt;fan&gt;sensorSN&lt;010002&gt;</key><value><assignmentConfigId>curve</assignmentConfigId></value></entry></cereal>");
                SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "profile", JsonSerializer.SerializeToElement(new { path = file }));
                var row = new SensorRow(new("csv/front", "Front links", "iCUE LINK", "RPM", 900, "fixture", DateTime.UtcNow));
                Assert(state.Profile.Fans[0].Name == "Front links" && IcueDiscovery.SameFan(row, state.Profile.Fans[0]));
                Assert(!IcueDiscovery.SameFan(row, state.Profile.Fans[1]) && state.Profile.Fans[1].Aliases.Count == 0);
                Assert(StateStore.Load().Profile.Fans[0].Aliases.Single() == "Front links");
            });
            Check("Partial UserProps preserves missing fan aliases and updates only the matching device", () =>
            {
                var profile = new ProfileData { Fans = new()
                {
                    new() { Key = "serial<new>senstype<fan>sensorSN<010001>", Serial = "010001", Name = "LINK-Lüfter · …010001", Aliases = new() { "Front links" } },
                    new() { Key = "serial<new>senstype<fan>sensorSN<010002>", Serial = "010002", Name = "Alter Name", Aliases = new() { "Alter Name" } }
                } };
                var partial = System.Xml.Linq.XDocument.Parse("<cereal><entry><name>Front rechts</name><sensor><id>serial&lt;new&gt;senstype&lt;fan&gt;sensorSN&lt;010002&gt;</id></sensor></entry></cereal>");
                IcueDiscovery.ApplyAliases(profile, partial);
                var row = new SensorRow(new("csv/front", "Front links", "iCUE LINK", "RPM", 900, "fixture", DateTime.UtcNow));
                Assert(profile.Fans[0].Aliases.Single() == "Front links" && IcueDiscovery.SameFan(row, profile.Fans[0]));
                Assert(profile.Fans[1].Name == "Front rechts" && profile.Fans[1].Aliases.Single() == "Front rechts" && !IcueDiscovery.SameFan(row, profile.Fans[1]));
            });
            Check("Failed draft persistence leaves both imported profile and live draft untouched", () =>
            {
                var state = State(); state.CustomCurves.Add(Example("custom")); state.CustomCurves[0].IsCustom = true;
                string before = JsonSerializer.Serialize(state);
                string blocked = Path.Combine(fixtures, "not-a-directory"); File.WriteAllText(blocked, "fixture");
                StateStore.DirectoryPath = blocked;
                var c = state.CustomCurves[0].Copy(); c.Name = "Must not persist";
                try { SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "curve", Body(c)); throw new Exception("Save unexpectedly succeeded"); }
                catch (IOException) { }
                Assert(JsonSerializer.Serialize(state) == before);
                StateStore.DirectoryPath = Path.Combine(fixtures, "after-failure"); StateStore.Save(state);
                Assert(StateStore.Load().CustomCurves.Single().Name == "Profilkurve");
            });
            Check("Failed layout persistence leaves positions and background untouched", () =>
            {
                var state = State(); state.Stage.Tiles.Add(new() { Id = "tile", Name = "Front", X = 50 });
                string before = JsonSerializer.Serialize(state);
                StateStore.DirectoryPath = Path.Combine(fixtures, "not-a-directory");
                using var body = JsonDocument.Parse("{\"background\":\"\",\"tiles\":[]}");
                try { SuiteState.ConfigureAndSave(state, Array.Empty<SensorRow>(), "stage", body.RootElement); throw new Exception("Save unexpectedly succeeded"); }
                catch (IOException) { }
                Assert(JsonSerializer.Serialize(state) == before);
            });
            Check("Curve interpolation preserves exact points and clamps outside the configured range", () =>
            {
                var c = Example(); Assert(c.Evaluate(25) == 20 && c.Evaluate(32.5) == 45 && c.Evaluate(40) == 70);
                Assert(c.Evaluate(0) == 20 && c.Evaluate(120) == 100);
            });
        }
        finally { StateStore.DirectoryPath = previousDirectory; Environment.SetEnvironmentVariable("BATTO_DISABLE_ICUE_DISCOVERY", previousDiscovery); }
        lines.Add($"Result: {failures} failed checks.");
        File.WriteAllLines(report, lines);
        return failures == 0 ? 0 : 1;
    }
}
