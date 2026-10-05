using System.Text.Json;
namespace Prism.LianLi;

// Adapted under MIT from sgtaziz/lian-li-linux, commit
// d335fdd459b0a308814497d36cf1d8c7dc1a782d, crates/lianli-devices/src/strimer_plus.rs.
// The existing bundled MIT notice applies. No OpenRGB code is incorporated.
internal static class StrimerProtocol
{
    static readonly JsonDocument Catalog = JsonDocument.Parse(typeof(StrimerProtocol).Assembly.GetManifestResourceStream("LianLiEffects")!);
    internal static bool IsController(int vid, int pid) => vid == 0x0cf2 && pid == 0xa200;
    internal static bool ValidDescriptor(string path, HidCaps caps) => System.Text.RegularExpressions.Regex.IsMatch(path, @"&mi_01(?:&|#)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
        && caps.UsagePage == 0xff72 && caps.Usage == 0xa1
        && caps.FeatureReportByteLength == 7 && caps.InputReportByteLength == 65 && caps.OutputReportByteLength == 255;
    internal static bool ValidFirmware(byte[] data) => data.Length == 5 && data[0] == 0xe0 && data[1] == 0x52 && data[2] == 0xff && data[3] == 0x40 && (data[4] & 15) is >= 3 and <= 9;
    internal static bool ValidSecondChannelCount(int count) => count is 4 or 6;
    internal static Mode[] Modes()
    {
        var names = Catalog.RootElement.GetProperty("modes").EnumerateArray().ToDictionary(x => x.GetProperty("id").GetString()!, x => x.GetProperty("name").GetString()!);
        return Catalog.RootElement.GetProperty("strimerMapping").EnumerateObject().Select(x => new Mode(x.Name, names[x.Name])).ToArray();
    }
    internal static Packet[] Effect(int channel2Count, EffectOptions options, string? scope, bool confirmed)
    {
        if (scope != "all" || !confirmed) throw new ArgumentException("Strimer benötigt die ausdrücklich bestätigte Auswahl aller Kanäle dieses Controllers.");
        if (!ValidSecondChannelCount(channel2Count)) throw new ArgumentException("Unbekannte Strimer-Kanalzahl; keine Ausgabe erlaubt.");
        if (!Catalog.RootElement.GetProperty("strimerMapping").TryGetProperty(options.EffectId, out var value)) throw new ArgumentException("Unbekannter Strimer-Effekt.");
        if (options.Brightness is < 0 or > 100 || options.Speed is < 1 or > 100 || options.Direction is not "forward" and not "reverse") throw new ArgumentException("Ungültige Strimer-Einstellungen.");
        int maxColors = options.EffectId is "Static" or "Breathing" ? 1 : options.EffectId is "Mixing" or "Runway" ? 2 : 6;
        if (options.Colors.Length < 1 || options.Colors.Length > maxColors || options.Colors.Any(x => !System.Text.RegularExpressions.Regex.IsMatch(x, "^#[0-9a-fA-F]{6}$"))) throw new ArgumentException("Ungültige Strimer-Farbpalette.");
        byte mode = value.GetByte();
        var colors = options.Colors.Select(x => new byte[] {Convert.ToByte(x.Substring(1,2),16),Convert.ToByte(x.Substring(3,2),16),Convert.ToByte(x.Substring(5,2),16)}).ToArray();
        if (options.EffectId is "Rainbow" or "RainbowMorph" or "BulletStack" or "Twinkle") colors = [[255,0,0],[255,105,0],[255,215,0],[0,255,0],[0,0,255],[170,0,255]];
        if (options.EffectId is "Static" or "Breathing") colors = Enumerable.Range(0,27).Select(_ => colors[0]).ToArray();
        if (options.EffectId == "Off" || options.Brightness == 0) {mode=0;colors=[[0,0,0]];}
        byte speed = new byte[] {2,1,0,255,254}[Math.Clamp((int)Math.Round((options.Speed-1)*4.0/99),0,4)];
        byte brightness = options.Brightness == 0 ? (byte)255 : new byte[] {4,3,2,1,0}[Math.Clamp((int)Math.Round((options.Brightness-1)*4.0/99),0,4)];
        byte direction = options.Direction == "reverse" ? (byte)1 : (byte)0;
        bool complete = mode is >= 33 and <= 43;
        int[] ports = complete ? [0,6] : Enumerable.Range(0,6+channel2Count).ToArray();
        var packets = new List<Packet>();ushort bitmap=0;
        foreach (int port in ports)
        {
            packets.Add(new Packet(true,[0xe0,(byte)(0x10|port),mode,speed,direction,brightness]));
            var report = new List<byte> {0xe0,(byte)(0x30|port)};
            foreach(var color in colors)report.AddRange([color[0],color[2],color[1]]);
            packets.Add(new Packet(false,report.ToArray()));bitmap|=(ushort)(1<<port);
        }
        // Global enable bitmap intentionally covers the entire confirmed controller.
        // No motherboard sync, fan, pump, PWM, firmware or performance command exists here.
        packets.Add(new Packet(true,[0xe0,0x2c,(byte)(bitmap>>8),(byte)(bitmap&255)]));
        return packets.ToArray();
    }
    internal static object Fixtures()
    {
        object Case(string effect, int count, string[] colors, string direction="forward") => new {effect,count,packets=Effect(count,new(effect,colors,100,50,direction),"all",true).Select(p=>new {p.Feature,bytes=Convert.ToHexString(p.Bytes)})};
        var caps = new HidCaps {UsagePage=0xff72,Usage=0xa1,FeatureReportByteLength=7,InputReportByteLength=65,OutputReportByteLength=255};
        var rejects = new List<string>();
        void Reject(string name,Action run){try{run();}catch(ArgumentException){rejects.Add(name);}}
        var settings=new EffectOptions("Static",["#010203"],100,50,"forward");
        Reject("scope",()=>Effect(4,settings,"separate",true));Reject("confirmation",()=>Effect(4,settings,"all",false));Reject("count",()=>Effect(5,settings,"all",true));Reject("effect",()=>Effect(4,settings with {EffectId="Direct"},"all",true));Reject("colors",()=>Effect(4,settings with {Colors=["#bad"]},"all",true));Reject("brightness",()=>Effect(4,settings with {Brightness=101},"all",true));
        return new {cases=new[]{Case("Static",4,["#010203"]),Case("Wave",6,["#010203","#040506"],"reverse"),Case("ColorTransfer",4,["#010203"])},rejected=rejects,
            descriptorAccepted=ValidDescriptor(@"hid#vid_0cf2&pid_a200&mi_01&col01#test",caps),wrongInterfaceRejected=!ValidDescriptor(@"hid#vid_0cf2&pid_a200&mi_00&col01#test",caps),wrongUsageRejected=!ValidDescriptor(@"hid#vid_0cf2&pid_a200&mi_01&col01#test",caps with {Usage=0xa2}),wrongReportRejected=!ValidDescriptor(@"hid#vid_0cf2&pid_a200&mi_01&col01#test",caps with {OutputReportByteLength=64}),wrongFeatureRejected=!ValidDescriptor(@"hid#vid_0cf2&pid_a200&mi_01&col01#test",caps with {FeatureReportByteLength=65}),wrongInputRejected=!ValidDescriptor(@"hid#vid_0cf2&pid_a200&mi_01&col01#test",caps with {InputReportByteLength=66}),
            firmwareValid=ValidFirmware([0xe0,0x52,0xff,0x40,0x18]),firmwareMismatchRejected=!ValidFirmware([0xe0,0x52,0xff,0x41,0x18]),count4Accepted=ValidSecondChannelCount(4),count6Accepted=ValidSecondChannelCount(6),unknownCountRejected=!ValidSecondChannelCount(0)};
    }
}
