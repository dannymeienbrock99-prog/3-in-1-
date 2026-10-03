using System.IO;
namespace FanAtlas;
public static class FanDiscoveryTests
{
    public static int Run(string report)
    {
        var lines = new List<string>(); int failed = 0;
        void Check(string name, Action action) { try { action(); lines.Add("PASS " + name); } catch (Exception e) { failed++; lines.Add("FAIL " + name + " " + e.Message); } }
        void Assert(bool value) { if (!value) throw new Exception("Assertion failed"); }
        SensorRow Reading(string key, string name, string unit, string device="iCUE LINK") { var m = new Measurement(key, name, device, unit, 800, "test", DateTime.UtcNow); var s = new SensorRow(m); s.Update(m,15); return s; }
        FanEntry Fan(string serial,string hub="hub") => new() { Key=$"serial<{hub}>senstype<fan>sensorSN<{serial}>", Serial=serial, Name="QX " + serial, Hub=hub };
        Check("GPU placeholders removed; unrelated manual tile retained",()=>{var s=new AppState();s.Stage.Tiles.Add(new(){RpmSensorKey="nvml/0/fan/0"});s.Stage.Tiles.Add(new(){Name="Manuell"});FanDiscovery.Refresh(s,new[]{Reading("nvml/0/fan/0","GPU-Lüfter","%","GPU")});Assert(s.Stage.Tiles.Count==1&&s.Stage.Tiles[0].Name=="Manuell");});
        Check("Historical assignments deduplicate by fan serial and exclude pump",()=>{var s=new AppState();s.Profile.Fans=new(){Fan("010001"),Fan("010001","oldhub"),Fan("010002"),new(){Serial="070001",Name="AIO-Kanal"}};FanDiscovery.Refresh(s,Array.Empty<SensorRow>());Assert(s.Stage.Tiles.Count==2);Assert(s.Stage.Tiles.All(t=>t.TemperatureSensorKey==""&&t.RpmSensorKey==""));Assert(!FanDiscovery.Refresh(s,Array.Empty<SensorRow>()));});
        Check("Exact LINK match updates existing profile tile; CPU/GPU temperature never substituted",()=>{var s=new AppState();s.Profile.Fans.Add(Fan("010001"));FanDiscovery.Refresh(s,Array.Empty<SensorRow>());var id=s.Stage.Tiles[0].Id;FanDiscovery.Refresh(s,new[]{Reading("csv/test","QX 010001 Fan RPM","RPM"),Reading("nvml/0/temperature","GPU-Temperatur","°C","GPU")});Assert(s.Stage.Tiles.Count==1&&s.Stage.Tiles[0].Id==id&&s.Stage.Tiles[0].RpmSensorKey=="csv/test"&&s.Stage.Tiles[0].TemperatureSensorKey=="");});
        Check("Removed profile tile is not resurrected",()=>{var s=new AppState();s.Profile.Fans.Add(Fan("010001"));s.Stage.HiddenAutoSensors.Add("profile/010001");FanDiscovery.Refresh(s,Array.Empty<SensorRow>());Assert(s.Stage.Tiles.Count==0);});
        Check("Only LINK RPM channels auto-discover",()=>{var s=new AppState();FanDiscovery.Refresh(s,new[]{Reading("hw/0","GPU Fan","RPM","NVIDIA"),Reading("hw/1","Pump RPM","RPM"),Reading("hw/2","QX RGB #1 RPM","RPM")});Assert(s.Stage.Tiles.Count==1&&s.Stage.Tiles[0].RpmSensorKey=="hw/2");});
        Check("32 default positions stay on stage without overlaps",()=>{var tiles=Enumerable.Range(0,32).Select(FanDiscovery.NewTile).ToArray();Assert(tiles.All(t=>t.X>=0&&t.X+t.Size<=1920&&t.Y+t.Size+64<=1080));Assert(tiles.Select(t=>(t.X,t.Y)).Distinct().Count()==32);});
        Check("iCUE sensor IDs persist through daily log rotation",()=>{string header="Time;QX RGB #1 Fan [RPM];QX RGB #1 Temp [C]\n",row="10:00;900;31\n";var a=CsvReader.Parse(header,header+row,Path.GetFullPath("corsair_cue_day1.csv"),DateTime.UtcNow);var b=CsvReader.Parse(header,header+row,Path.GetFullPath("corsair_cue_day2.csv"),DateTime.UtcNow);Assert(a.Measurements.Count==2&&a.Measurements.Select(m=>m.Key).SequenceEqual(b.Measurements.Select(m=>m.Key)));});
        Check("iCUE 5 real log format: unit suffixes, quoted names, and latest row",()=>{
            string csv="Timestamp,\" unten:5-Mitte: Lüfter\",\" oben:1-Links: Lüfter\",\" Temp #1\"\r\n28/9/2026 12:28:31 PM,1671RPM,1677RPM,30.20°C\r\n28/9/2026 12:28:33 PM,1658RPM,1667RPM,30.30°C\r\n";
            var m=CsvReader.Parse(csv,csv,"corsair_cue_live.csv",DateTime.UtcNow).Measurements;
            Assert(m.Count==3 && m[0].Name=="unten:5-Mitte: Lüfter" && m[0].Value==1658 && m[0].Unit=="RPM" && m[2].Value==30.3 && m[2].Unit=="°C");
        });
        Check("Unit suffixes stay strict and incompatible units are rejected",()=>{
            foreach(string invalid in new[]{"Fan 1 RPM","N/A","NaN","Infinity","123garbage","12RPM trailing"}) Assert(!CsvReader.TryNumber(invalid,out _));
            string csv="Time;Fan [RPM];Temp [°C];Pin [V];Load [%]\n1;42°C;30RPM;12,1V;80%\n";
            var m=CsvReader.Parse(csv,csv,"strict.csv",DateTime.UtcNow).Measurements;
            Assert(m.Count==2 && m[0].Unit=="V" && m[0].Value==12.1 && m[1].Unit=="%" && m[1].Value==80);
        });
        Check("Custom iCUE labels retain value units without fan or temperature words",()=>{
            string csv="Timestamp,Front links,Front rechts,Wasser\n1,1650RPM,80%,30.20°C\n";
            var m=CsvReader.Parse(csv,csv,"corsair_cue_custom.csv",DateTime.UtcNow).Measurements;
            Assert(m.Count==3&&m[0].Unit=="RPM"&&m[0].Value==1650&&m[1].Unit=="%"&&m[1].Value==80&&m[2].Unit=="°C");
        });
        Check("Explicit numeric cell units override guessed units from a generic sensor name",()=>{
            string csv="Time;Front Lüfter;Temperature\n1;80%;104°F\n";
            var m=CsvReader.Parse(csv,csv,"cell-units.csv",DateTime.UtcNow).Measurements;
            Assert(m.Count==2&&m[0].Unit=="%"&&m[0].Value==80&&m[1].Unit=="°C"&&Math.Abs(m[1].Value-40)<0.001);
        });
        Check("Real iCUE unit-suffixed log: shared writer, first read stale, partial row ignored",()=>{
            string p=Path.Combine(Path.GetTempPath(),"corsair_cue_test_"+Guid.NewGuid().ToString("N")+".csv");
            try {
                using var file=new FileStream(p,FileMode.Create,FileAccess.Write,FileShare.ReadWrite|FileShare.Delete);
                void Add(string s){file.Write(System.Text.Encoding.UTF8.GetBytes(s));file.Flush();}
                var parser=new CsvReader(); Add("Timestamp,\" Front: Lüfter\",\" Temp #1\"\n1,1650RPM,30.20°C\n");
                var first=parser.Read(new[]{p});Assert(first.Count==2&&!first[0].Live);
                Add("2,1700RPM,31.20°C\n3,2000RPM,");var live=parser.Read(new[]{p});Assert(live[0].Live&&live[0].Value==1700&&live[1].Value==31.2);
            }finally{File.Delete(p);}
        });
        Check("Fan moved between hubs binds by serial aliases without duplicating its tile",()=>{
            var s=new AppState();var f=Fan("010001","old");s.Profile.Fans.Add(f);
            var doc=System.Xml.Linq.XDocument.Parse("<cereal><entry><name>Unterer Lüfter</name><sensor><id>serial&lt;new&gt;senstype&lt;fan&gt;sensorSN&lt;010001&gt;</id></sensor></entry></cereal>");
            IcueDiscovery.ApplyAliases(s.Profile,doc);FanDiscovery.Refresh(s,Array.Empty<SensorRow>());string id=s.Stage.Tiles.Single().Id;
            FanDiscovery.Refresh(s,new[]{Reading("icuecsv/live","Unterer Lüfter","RPM","corsair_cue_live")});
            Assert(s.Stage.Tiles.Count==1&&s.Stage.Tiles[0].Id==id&&s.Stage.Tiles[0].RpmSensorKey=="icuecsv/live"&&s.Stage.Tiles[0].Name=="Unterer Lüfter");
        });
        SensorRow Value(string key, string unit, double value, bool live=true) { var m=new Measurement(key,"QX 010001 Fan","iCUE LINK",unit,value,"test",DateTime.UtcNow,live); var s=new SensorRow(m);s.Update(m,15);return s; }
        Check("RPM never becomes percent without an explicit 100% reference",()=>{var t=new FanTile{RpmSensorKey="rpm"};Assert(!FanTelemetry.Percent(t,new[]{Value("rpm","RPM",1600)}).Fresh);t.MaxRpm=2000;Assert(FanTelemetry.Percent(t,new[]{Value("rpm","RPM",1600)}).Value==80);});
        Check("Measured percent takes precedence; stopped fan is a valid zero",()=>{var t=new FanTile{PercentSensorKey="percent",RpmSensorKey="rpm",MaxRpm=2000};var p=FanTelemetry.Percent(t,new[]{Value("percent","%",0),Value("rpm","RPM",1600)});Assert(p.Fresh&&p.Value==0&&p.Basis=="measured");});
        Check("Missing stale wrong-unit and invalid measurements stay unavailable",()=>{var t=new FanTile{PercentSensorKey="percent",RpmSensorKey="rpm",MaxRpm=2000};foreach(var s in new[]{Value("percent","%",90,false),Value("percent","RPM",90),Value("percent","%",101),Value("percent","%",double.NaN)})Assert(!FanTelemetry.Percent(t,new[]{s,Value("rpm","RPM",1600)}).Fresh);});
        Check("Percent source binds only to its matching LINK fan",()=>{var s=new AppState();s.Profile.Fans.Add(Fan("010001"));FanDiscovery.Refresh(s,new[]{Value("p","%",80),Reading("gpu","GPU fan duty","%","NVIDIA"),Reading("ram","Corsair RAM load","%","Corsair")});Assert(s.Stage.Tiles.Count==1&&s.Stage.Tiles[0].PercentSensorKey=="p");});
        Check("Layout percentage settings survive JSON roundtrip and normalize bounds",()=>{var t=new FanTile{RpmSensorKey="rpm",MaxRpm=2000,Announce=false};var copy=System.Text.Json.JsonSerializer.Deserialize<FanTile>(System.Text.Json.JsonSerializer.Serialize(t))!;Assert(copy.MaxRpm==2000&&!copy.Announce&&copy.CenterMode=="percent");copy.MaxRpm=double.NaN;copy.Clamp();Assert(copy.MaxRpm==0);});
        File.WriteAllLines(report,lines); return failed==0?0:1;
    }
}
