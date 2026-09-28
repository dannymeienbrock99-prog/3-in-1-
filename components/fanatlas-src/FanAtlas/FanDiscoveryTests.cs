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
        File.WriteAllLines(report,lines); return failed==0?0:1;
    }
}
