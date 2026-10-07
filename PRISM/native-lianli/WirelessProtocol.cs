using System.Buffers.Binary;

namespace Prism.LianLi;

// RF framing/layout adapted from sgtaziz/lian-li-linux d335fdd459b0a308814497d36cf1d8c7dc1a782d (MIT).
// Queries do not bind devices or send PWM, clock, motherboard-sync, reset or firmware commands.
internal sealed record WirelessMaster(string Mac, int Channel, int Firmware, uint Time);
internal sealed record WirelessReceiver(string Mac, string MasterMac, int Channel, int RxType, int DeviceType,
    int FanCount, int LedCount, string ModelName, bool MotherboardSync, byte[] EffectIndex, int CommandSequence,
    int ListIndex, int[] FanRpms);
internal sealed record WirelessDiscovery(int ReportedCount, int RequiredPages, WirelessReceiver[] Devices);
internal sealed record WirelessUpload(byte[] Compressed, byte[] EffectIndex, int FrameCount, int LedCount,
    int IntervalMs, byte[][] Packets);
internal sealed class WirelessAnimationTooLargeException : ArgumentException
{
    internal WirelessAnimationTooLargeException() : base("WIRELESS_ANIMATION_TOO_LARGE: reduce animation frame count to fit controller memory") { }
}

internal static class WirelessProtocol
{
    internal const int MaximumCompressedBytes = 12288;
    internal const int MaximumFrames = 256;
    internal const int MaximumRawBytes = 196608;
    internal static bool IsTx(int vid, int pid) => (vid, pid) is (0x0416, 0x8040) or (0x1a86, 0xe304);
    internal static bool IsRx(int vid, int pid) => (vid, pid) is (0x0416, 0x8041) or (0x1a86, 0xe305);
    internal static int LedCount(int deviceType) => deviceType switch { 1 => 116, 2 => 132, 3 => 174, 4 => 88, _ => 0 };
    internal static string ModelName(int type) => type switch {
        1 => "Lian Li Strimer Wireless GPU · 8 Lichtleiter",
        2 => "Lian Li Strimer Wireless 24-Pin",
        3 => "Lian Li Strimer Wireless GPU · 12 Lichtleiter",
        4 => "Lian Li Strimer Wireless CPU 2×8-Pin",
        >= 5 and <= 9 => $"Lian Li Strimer Wireless · Typ {type}",
        0 => "Lian Li Wireless-Lüftergruppe", 10 or 11 => "Lian Li HydroShift Wireless",
        65 => "Lian Li Lancool 217 Wireless", 66 => "Lian Li Lancool V150 Wireless",
        88 => "Lian Li Wireless LED 8.8", _ => $"Lian Li Wireless · Typ {type}" };
    internal static byte[] MasterQuery(int channel)
    {
        if (channel is < 1 or > 39) throw new ArgumentException("Invalid wireless channel");
        var query = new byte[64]; query[0] = 0x11; query[1] = (byte)channel; return query;
    }
    internal static byte[] DiscoveryQuery(int pages)
    {
        if (pages is < 1 or > 26) throw new ArgumentException("Invalid discovery page count");
        var query = new byte[64]; query[0] = 0x10; query[1] = (byte)pages; return query;
    }
    internal static WirelessMaster ParseMaster(byte[] response, int channel)
    {
        if (channel is < 1 or > 39 || response.Length < 13 || response.Length > 64 || response[0] != 0x11
            || response.AsSpan(1, 6).IndexOfAnyExcept((byte)0) < 0
            || BinaryPrimitives.ReadUInt32BigEndian(response.AsSpan(7, 4)) <= 1)
            throw new ArgumentException("Invalid wireless master response");
        return new(Convert.ToHexString(response.AsSpan(1, 6)), channel,
            BinaryPrimitives.ReadUInt16BigEndian(response.AsSpan(11, 2)),
            BinaryPrimitives.ReadUInt32BigEndian(response.AsSpan(7, 4)));
    }
    internal static WirelessDiscovery ParseDiscovery(byte[] response, int pages)
    {
        if (pages is < 1 or > 26 || response.Length < 4 || response.Length > pages * 512 || response[0] != 0x10)
            throw new ArgumentException("Invalid wireless discovery response");
        var count = Math.Min(response[1], pages * 10);
        if (response.Length < 4 + count * 42) throw new ArgumentException("Truncated wireless discovery response");
        var records = new List<WirelessReceiver>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < count; index++)
        {
            var data = response.AsSpan(4 + index * 42, 42);
            if (data[41] != 0x1c || data[18] == 0xff || data[12] is < 1 or > 39
                || data[..6].IndexOfAnyExcept((byte)0) < 0) continue;
            var mac = Convert.ToHexString(data[..6]);
            if (!seen.Add(mac)) throw new ArgumentException("Duplicate wireless receiver identity");
            var rawFanCount = data[19];
            var fanCount = Math.Min(rawFanCount >= 10 ? rawFanCount - 10 : rawFanCount, 4);
            var rpms = new int[4];
            for (int fan = 0; fan < 4; fan++) rpms[fan] = ((data[28 + fan * 2] & 15) << 8) | data[29 + fan * 2];
            records.Add(new(mac, Convert.ToHexString(data.Slice(6, 6)), data[12], data[13], data[18],
                fanCount, LedCount(data[18]), ModelName(data[18]), (data[28] & 0x40) != 0,
                data.Slice(20, 4).ToArray(), data[40], index, rpms));
        }
        return new(response[1], Math.Max(1, (response[1] + 9) / 10), records.ToArray());
    }
    internal static WirelessUpload BuildUpload(WirelessReceiver receiver, WirelessMaster master, byte[][] frames, int intervalMs)
    {
        if (receiver.DeviceType is < 1 or > 4 || receiver.LedCount != LedCount(receiver.DeviceType)
            || receiver.MasterMac != master.Mac || receiver.MotherboardSync || receiver.Channel is < 1 or > 39
            || receiver.RxType is < 1 or > 254 || master.Channel is < 1 or > 39)
            throw new ArgumentException("Strimer must have a known LED layout, belong to this dongle and have motherboard lighting sync disabled");
        if (intervalMs is < 1 or > 40959 || frames.Length < 1
            || frames.Any(frame => frame == null || frame.Length != receiver.LedCount * 3))
            throw new ArgumentException("Invalid or oversized wireless RGB animation");
        if (frames.Length > MaximumFrames || (long)frames.Length * receiver.LedCount * 3 > MaximumRawBytes)
            throw new WirelessAnimationTooLargeException();
        var mac = DecodeMac(receiver.Mac); var masterMac = DecodeMac(master.Mac);
        var raw = new byte[frames.Length * receiver.LedCount * 3];
        for (int frame = 0; frame < frames.Length; frame++) frames[frame].CopyTo(raw, frame * receiver.LedCount * 3);
        var compressed = TinyUzEncoder.Compress(raw);
        if (compressed.Length > MaximumCompressedBytes) throw new WirelessAnimationTooLargeException();
        var ticksHundredths = intervalMs * 160;
        var intervalTicks = (ushort)(ticksHundredths / 100);
        var fraction = (byte)(ticksHundredths % 100);
        uint hash = 0x811c9dc5;
        var timing = new byte[] { (byte)(intervalTicks >> 8), (byte)intervalTicks, fraction,
            (byte)(frames.Length >> 8), (byte)frames.Length, (byte)receiver.LedCount, 0, 0, 0, 0, 0 };
        foreach (var value in compressed.Concat(timing)) hash = unchecked((hash ^ value) * 0x01000193);
        var effect = new byte[4]; BinaryPrimitives.WriteUInt32BigEndian(effect, Math.Max(1u, hash));
        var count = (compressed.Length + 219) / 220 + 1;
        var packets = new List<byte[]>();
        for (int index = 0; index < count; index++)
        {
            var rf = new byte[240]; rf[0] = 0x12; rf[1] = 0x20;
            mac.CopyTo(rf, 2); masterMac.CopyTo(rf, 8); effect.CopyTo(rf, 14);
            rf[18] = (byte)index; rf[19] = (byte)count;
            if (index == 0)
            {
                BinaryPrimitives.WriteUInt32BigEndian(rf.AsSpan(20, 4), (uint)compressed.Length);
                BinaryPrimitives.WriteUInt16BigEndian(rf.AsSpan(25, 2), (ushort)frames.Length);
                rf[27] = (byte)receiver.LedCount;
                BinaryPrimitives.WriteUInt16BigEndian(rf.AsSpan(32, 2), intervalTicks); rf[34] = fraction;
            }
            else compressed.AsSpan((index - 1) * 220, Math.Min(220, compressed.Length - (index - 1) * 220)).CopyTo(rf.AsSpan(20));
            // The tested upstream uploader repeats the header four times;
            // an RF receiver may miss its first header while changing effects.
            for (int repeat = 0; repeat < (index == 0 ? 4 : 1); repeat++)
                for (int chunk = 0; chunk < 4; chunk++)
                {
                    var usb = new byte[64]; usb[0] = 0x10; usb[1] = (byte)chunk;
                    usb[2] = (byte)receiver.Channel; usb[3] = (byte)receiver.RxType;
                    rf.AsSpan(chunk * 60, 60).CopyTo(usb.AsSpan(4)); packets.Add(usb);
                }
        }
        return new(compressed, effect, frames.Length, receiver.LedCount, intervalMs, packets.ToArray());
    }
    internal static bool Acknowledged(WirelessReceiver current, WirelessReceiver target, WirelessMaster master, byte[] effectIndex)
        => current.Mac == target.Mac && current.MasterMac == master.Mac && current.DeviceType == target.DeviceType
            && current.LedCount == target.LedCount && current.Channel == target.Channel && current.RxType == target.RxType && !current.MotherboardSync
            && effectIndex.Length == 4 && current.EffectIndex.SequenceEqual(effectIndex);
    static byte[] DecodeMac(string value)
    {
        if (value.Length != 12 || !value.All(Uri.IsHexDigit)) throw new ArgumentException("Invalid wireless MAC identity");
        var bytes = Convert.FromHexString(value);
        if (bytes.All(b => b == 0) || bytes.All(b => b == 255)) throw new ArgumentException("Invalid wireless MAC identity");
        return bytes;
    }
    internal static object Fixtures()
    {
        var master = new WirelessMaster("090807060504", 8, 106, 1000);
        WirelessReceiver Receiver(int type) => new("010203040506", master.Mac, 8, 2, type, 0,
            LedCount(type), ModelName(type), false, [0, 0, 0, 0], 3, 0, [0, 0, 0, 0]);
        var input = new byte[4 + 42]; input[0] = 0x10; input[1] = 1;
        var record = input.AsSpan(4, 42); DecodeMac(Receiver(2).Mac).CopyTo(record);
        DecodeMac(master.Mac).CopyTo(record[6..]); record[12] = 8; record[13] = 2; record[18] = 2; record[41] = 0x1c;
        var invalid = new List<string>();
        void Rejected(string label, Action action) { try { action(); } catch (ArgumentException) { invalid.Add(label); } }
        var red = Enumerable.Range(0, 132).SelectMany(_ => new byte[] { 255, 0, 0 }).ToArray();
        Rejected("unbound", () => BuildUpload(Receiver(2) with { MasterMac = "111111111111" }, master, [red], 50));
        Rejected("motherboardSync", () => BuildUpload(Receiver(2) with { MotherboardSync = true }, master, [red], 50));
        Rejected("unknownModel", () => BuildUpload(Receiver(5), master, [red], 50));
        Rejected("wrongLedCount", () => BuildUpload(Receiver(2), master, [red[..^1]], 50));
        Rejected("broadcast", () => BuildUpload(Receiver(2) with { RxType = 255 }, master, [red], 50));
        Rejected("interval", () => BuildUpload(Receiver(2), master, [red], 0));
        Rejected("truncated", () => ParseDiscovery(input[..^1], 1));
        Rejected("tooManyFrames", () => BuildUpload(Receiver(2), master, Enumerable.Repeat(red, 257).ToArray(), 50));
        var noise = new byte[15840]; new Random(1981).NextBytes(noise);
        Rejected("controllerMemory", () => BuildUpload(Receiver(2), master, noise.Chunk(396).ToArray(), 50));
        var distant = new byte[8192]; new Random(9919).NextBytes(distant); Array.Copy(distant, 0, distant, 4000, 512);
        var upload = BuildUpload(Receiver(2), master, [red], 50);
        var masterResponse = new byte[13]; masterResponse[0] = 0x11; DecodeMac(master.Mac).CopyTo(masterResponse, 1);
        BinaryPrimitives.WriteUInt32BigEndian(masterResponse.AsSpan(7, 4), 1000);
        BinaryPrimitives.WriteUInt16BigEndian(masterResponse.AsSpan(11, 2), 106);
        return new {
            master = ParseMaster(masterResponse, 8),
            queries = new { master = Convert.ToHexString(MasterQuery(8)), discovery = Convert.ToHexString(DiscoveryQuery(1)) },
            acknowledgements = new {
                confirmed = Acknowledged(Receiver(2) with { EffectIndex = upload.EffectIndex }, Receiver(2), master, upload.EffectIndex),
                wrongIdentity = Acknowledged(Receiver(2) with { Mac = "111111111111", EffectIndex = upload.EffectIndex }, Receiver(2), master, upload.EffectIndex),
                motherboardSync = Acknowledged(Receiver(2) with { MotherboardSync = true, EffectIndex = upload.EffectIndex }, Receiver(2), master, upload.EffectIndex),
                wrongMaster = Acknowledged(Receiver(2) with { MasterMac = "111111111111", EffectIndex = upload.EffectIndex }, Receiver(2), master, upload.EffectIndex),
                wrongChannel = Acknowledged(Receiver(2) with { Channel = 9, EffectIndex = upload.EffectIndex }, Receiver(2), master, upload.EffectIndex),
                wrongRadioAddress = Acknowledged(Receiver(2) with { RxType = 3, EffectIndex = upload.EffectIndex }, Receiver(2), master, upload.EffectIndex),
                oldEffect = Acknowledged(Receiver(2), Receiver(2), master, upload.EffectIndex) },
            diagnostics = new[] { WirelessErrors.Diagnostic(new WirelessUsbException("open", 5), "receiver"),
                WirelessErrors.Diagnostic(new WirelessUsbException("initialize", 5), "transmitter"),
                WirelessErrors.Diagnostic(new WirelessUsbException("open", 32), "transmitter") },
            interfaceIdentities = new { ordinary = WinUsbDevice.AllowedHardwareKey("VID_0416&PID_8040"),
                composite = WinUsbDevice.AllowedHardwareKey("vid_1a86&pid_e305&mi_00"),
                otherProduct = WinUsbDevice.AllowedHardwareKey("VID_0416&PID_7372"),
                elgato = WinUsbDevice.AllowedHardwareKey("VID_0FD9&PID_006C"),
                suffix = WinUsbDevice.AllowedHardwareKey("VID_0416&PID_8040&unexpected") },
            models = Enumerable.Range(1, 9).Select(type => new { type, ledCount = LedCount(type), name = ModelName(type) }),
            parsed = ParseDiscovery(input, 1), invalid,
            upload = new { upload.FrameCount, upload.LedCount, upload.IntervalMs,
                compressed = Convert.ToHexString(upload.Compressed), effectIndex = Convert.ToHexString(upload.EffectIndex),
                packets = upload.Packets.Select(Convert.ToHexString) },
            vectors = new[] { red, Enumerable.Range(0, 65536).Select(i => (byte)((i * 37 + i / 251) & 255)).ToArray(),
                Enumerable.Range(0, 12000).Select(i => (byte)(i % 521 / 3)).ToArray(), distant, noise }
                .Select(bytes => new { original = Convert.ToHexString(bytes), compressed = Convert.ToHexString(TinyUzEncoder.Compress(bytes)) }) };
    }
}
