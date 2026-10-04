using System.Text.Json;

namespace Prism.LianLi;

// Protocol and model-specific mode bytes are adapted from sgtaziz/lian-li-linux,
// commit d335fdd459b0a308814497d36cf1d8c7dc1a782d (MIT, bundled notice).
internal sealed record Mode(string Id, string Name);
internal sealed record EffectOptions(string EffectId, string[] Colors, int Brightness, int Speed, string Direction);
internal sealed record Packet(bool Feature, byte[] Bytes);
internal sealed record Endpoint(int Id, int ControllerId, int Pid, int Port, string Ring, int[] FanIds);

internal static class Protocol
{
    static readonly JsonDocument Catalog = JsonDocument.Parse(typeof(Protocol).Assembly.GetManifestResourceStream("LianLiEffects")
        ?? throw new InvalidOperationException("Lian Li effect catalog missing"));
    internal static bool IsEne(int vid, int pid) => vid == 0x0cf2 && pid >= 0xa100 && pid <= 0xa106;
    internal static bool IsTl(int vid, int pid) => vid == 0x0416 && pid == 0x7372;
    internal static bool Dual(int pid) => pid is 0xa101 or 0xa102 or 0xa104;
    internal static bool V2(int pid) => pid is 0xa103 or 0xa104 or 0xa105;
    internal static int MaximumFans(int pid) => V2(pid) ? 6 : 4;
    internal static string ModelName(int pid) => pid switch { 0xa100 => "SL Fan", 0xa101 => "AL Fan", 0xa102 => "SL Infinity", 0xa103 => "SL V2 Fan", 0xa104 => "AL V2 Fan", 0xa105 => "SL V2A Fan", 0xa106 => "SL Redragon", 0x7372 => "TL", _ => throw new ArgumentException("Unknown controller") };
    static string[] List(string key) => Catalog.RootElement.GetProperty(key).EnumerateArray().Select(x => x.GetString()!).ToArray();
    static JsonElement Mapping(Endpoint e) => Catalog.RootElement.GetProperty("mappings").GetProperty(e.Pid == 0x7372 ? "tl" : e.Pid == 0xa102 ? "slInf" : Dual(e.Pid) ? e.Ring == "outer" ? e.Pid == 0xa104 ? "alV2Outer" : "alOuter" : "alInner" : "single");
    internal static Mode[] Modes(Endpoint e)
    {
        IEnumerable<string> candidates = e.Pid == 0x7372 ? List("tlFanModes") : e.Pid == 0xa102 ? List("slInfinityModes") : Dual(e.Pid)
            ? List("dualModes").Concat(e.Pid == 0xa104 ? List("alV2Extra") : [])
            : List("singleModes").Concat(V2(e.Pid) ? List("v2Extra") : []);
        if (e.Ring != "outer") candidates = candidates.Where(id => id is not "StaticColorful" and not "BreathingColorful");
        var names = Catalog.RootElement.GetProperty("modes").EnumerateArray().ToDictionary(x => x.GetProperty("id").GetString()!, x => x.GetProperty("name").GetString()!);
        return candidates.Distinct().Where(id => Mapping(e).TryGetProperty(id, out _)).Select(id => new Mode(id, names[id])).ToArray();
    }
    internal static bool ValidFirmware(int pid, byte[] data)
    {
        if (data.Length != 5 || data[0] != 0xe0 || data[1] != 0x50) return false;
        var major = Dual(pid) ? 0x80 : 0x64;
        var minors = pid switch { 0xa100 => new[] { 0xc2 }, 0xa101 => [0xc3], 0xa102 => [0xc4], 0xa103 or 0xa105 => [0xc5, 0xc7], 0xa104 => [0xc6], 0xa106 => [0xc8], _ => [] };
        return data[2] == major && minors.Contains(data[3]);
    }
    internal static byte[] TlPacket(byte command, byte[] payload)
    {
        if (payload.Length > 58) throw new ArgumentException("TL payload too long");
        var packet = new byte[64]; packet[0] = 1; packet[1] = command; packet[5] = (byte)payload.Length;
        payload.CopyTo(packet, 6); return packet;
    }
    internal static (int Port, int Fan, int Rpm)[] ParseTlHandshake(byte[] response)
    {
        if (response.Length < 6 || response[0] != 1 || response[1] != 0xa1 || response[2] != 0 || response[3] != 0 || response[4] != 0
            || response[5] > 58 || response[5] % 3 != 0 || response.Length < 6 + response[5]) throw new ArgumentException("Invalid TL handshake");
        var fans = new List<(int Port, int Fan, int Rpm)>();
        for (int i = 6; i < 6 + response[5]; i += 3)
        {
            if ((response[i] & 0x80) == 0) continue;
            if ((response[i] & 0x40) != 0) throw new ArgumentException("TL fan is upgrading");
            var port = (response[i] >> 4) & 3; var fan = response[i] & 15;
            // Fan index is the documented low nibble; preserve actual returned
            // positions instead of assuming a fixed four-fan chain.
            if (fans.Any(x => x.Port == port && x.Fan == fan)) throw new ArgumentException("Invalid TL fan position");
            fans.Add((port, fan, (response[i + 1] << 8) | response[i + 2]));
        }
        return fans.ToArray();
    }
    internal static Packet[] Effect(Endpoint e, EffectOptions options)
    {
        if (e.Port < 0 || e.Port > 3 || e.Pid != 0x7372 && !(e.Pid >= 0xa100 && e.Pid <= 0xa106)) throw new ArgumentException("Unknown Lian Li port");
        if (!Modes(e).Any(mode => mode.Id == options.EffectId)) throw new ArgumentException("Unsupported effect on this controller port/ring");
        if (options.Brightness < 0 || options.Brightness > 100 || options.Speed < 1 || options.Speed > 100 || options.Direction is not "forward" and not "reverse") throw new ArgumentException("Invalid effect settings");
        int palette = e.Pid == 0xa104 ? 6 : 4;
        if (options.Colors.Length < 1 || options.Colors.Length > palette || options.Colors.Any(x => !System.Text.RegularExpressions.Regex.IsMatch(x, "^#[0-9a-fA-F]{6}$"))) throw new ArgumentException("Invalid color palette");
        var colors = options.Colors.Select(x => new[] { Convert.ToByte(x.Substring(1, 2), 16), Convert.ToByte(x.Substring(3, 2), 16), Convert.ToByte(x.Substring(5, 2), 16) }).ToArray();
        var mode = Mapping(e).GetProperty(options.EffectId).GetByte();
        int brightness = options.Brightness == 0 ? 0 : Math.Clamp((int)Math.Round((options.Brightness - 1) * 4.0 / 99), 0, 4);
        int speed = Math.Clamp((int)Math.Round((options.Speed - 1) * 4.0 / 99), 0, 4);
        byte direction = (byte)(options.Direction == "reverse" ? 1 : 0);
        if (e.Pid == 0x7372)
        {
            if (e.FanIds.Length == 0 || e.FanIds.Length > 16 || e.FanIds.Distinct().Count() != e.FanIds.Length || e.FanIds.Any(id => id < 0 || id > 15)) throw new ArgumentException("Unknown TL fan layout");
            return e.FanIds.Select(fan => {
                var p = new byte[20]; p[0] = (byte)(e.Port << 4); p[1] = (byte)((e.Port << 4) | fan); p[2] = mode;
                p[3] = (byte)brightness; p[4] = (byte)speed;
                for (int i = 0; i < colors.Length; i++) colors[i].CopyTo(p, 5 + i * 3);
                p[17] = direction; p[18] = (byte)(options.EffectId == "Off" || options.Brightness == 0 ? 1 : 0); p[19] = (byte)colors.Length;
                return new Packet(false, TlPacket(0xa3, p));
            }).ToArray();
        }
        if (Dual(e.Pid) && e.Ring is not "inner" and not "outer" || !Dual(e.Pid) && e.Ring != "all") throw new ArgumentException("Invalid ENE ring");
        int port = Dual(e.Pid) ? e.Port * 2 + (e.Ring == "outer" ? 1 : 0) : e.Port;
        int maximum = MaximumFans(e.Pid), ledCount = Dual(e.Pid) ? e.Ring == "outer" ? 12 : 8 : 16;
        bool perFan = options.EffectId is "Static" or "Breathing";
        bool corner = options.EffectId is "StaticColorful" or "BreathingColorful";
        var expanded = new List<byte[]>();
        for (int fan = 0; fan < maximum; fan++)
        {
            if (perFan) for (int led = 0; led < ledCount; led++) expanded.Add(colors.Length == 1 ? colors[0] : fan < colors.Length ? colors[fan] : [0, 0, 0]);
            else if (corner) for (int led = 0; led < 12; led++) expanded.Add(led / 3 < colors.Length ? colors[led / 3] : [0, 0, 0]);
            else for (int slot = 0; slot < palette; slot++) expanded.Add(e.Pid == 0xa104 && options.EffectId == "Meteor" ? colors[slot % colors.Length] : slot < colors.Length ? colors[slot] : [0, 0, 0]);
        }
        var report = new List<byte> { 0xe0, (byte)(0x30 | port) };
        foreach (var c in expanded) report.AddRange([c[0], c[2], c[1]]); // ENE wire order: R, B, G.
        byte speedByte = new byte[] { 2, 1, 0, 255, 254 }[speed];
        byte brightnessByte = options.Brightness == 0 ? (byte)8 : new byte[] { 4, 3, 2, 1, 0 }[brightness];
        byte commit = e.Pid is 0xa103 or 0xa105 ? (byte)4 : (byte)1;
        // No fan-count, merge, PWM, motherboard sync or global initialization packets.
        return [new Packet(false, report.ToArray()), new Packet(true, [0xe0, (byte)(0x10 | port), mode, speedByte, direction, brightnessByte]), new Packet(true, [0xe0, 0x60, 0, commit])];
    }
}
