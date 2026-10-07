using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using Batto.Hardware;

internal static class CorsairDirectFixtures
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    internal static object Run()
    {
        var checks = new List<string>();
        void Check(bool condition, string name) { if (!condition) throw new Exception("Corsair direct fixture failed: " + name); checks.Add(name); }
        void Reject(Action action, string name) { try { action(); } catch (IOException) { checks.Add(name); return; } catch (InvalidDataException) { checks.Add(name); return; } catch (ArgumentException) { checks.Add(name); return; } throw new Exception("Corsair direct fixture accepted: " + name); }
        JsonElement Element(object value) => JsonSerializer.SerializeToElement(value, Json);
        object Call(CorsairDirectModule module, object request) => module.Dispatch(Element(request));
        var fake = new Wire(); int discoveries = 0, opens = 0, takes = 0, restores = 0; bool vendorActive = false, failVendor = false;
        var clock = DateTimeOffset.Parse("2026-10-07T20:00:00Z");
        object Take(bool confirmed) { takes++; vendorActive = true; fake.Events.Add("vendor-take"); return new { ok = confirmed, active = vendorActive }; }
        object Restore() { restores++; fake.Events.Add("vendor-release"); if (failVendor) return new { ok = false, active = true, remaining = new[] { "CorsairService" } }; vendorActive = false; return new { ok = true, active = false }; }
        object Status() => new { ok = true, active = vendorActive };
        CorsairDirectModule Create() => new(Take, Restore, Status, () => { discoveries++; return [fake.Identity]; }, _ => { opens++; fake.Disposed = false; return fake; },
            _ => fake.Events.Add("delay"), () => clock);
        using var module = Create();
        var idle = Element(Call(module, new { command = "status" }));
        Check(!idle.GetProperty("enabled").GetBoolean() && idle.GetProperty("released").GetBoolean() && discoveries == 0 && opens == 0 && takes == 0 && fake.Commands.Count == 0, "default status opens no device and changes no service");
        Call(module, new { command = "close" }); Check(restores == 0 && fake.Commands.Count == 0, "idle close is harmless");
        Reject(() => Call(module, new { command = "take-control", confirmICuePause = false }), "explicit takeover consent required before discovery");
        Check(discoveries == 0 && opens == 0 && takes == 0, "missing consent has no side effects");
        var scan = Element(Call(module, new { command = "enumerate" }));
        Check(scan.GetProperty("readOnly").GetBoolean() && takes == 0 && fake.ModeWrites == 0 && fake.SpeedWrites == 0 && fake.ColorWrites == 0, "enumerate reads exact hub without mode or duty writes");
        var ready = Element(Call(module, new { command = "take-control", confirmICuePause = true }));
        Check(ready.GetProperty("enabled").GetBoolean() && ready.GetProperty("active").GetBoolean() && !ready.GetProperty("requiresICue").GetBoolean(), "confirmed take uses in-process independent transport");
        Check(fake.ModeWrites == 1 && fake.SpeedWrites == 0 && fake.ColorWrites == 0, "takeover has no automatic 50-percent fan or pump writes");
        var channels = ready.GetProperty("channels"); Check(channels.GetArrayLength() == 1 && channels[0].GetProperty("name").GetString()!.Contains("QX"), "pump excluded and detected QX fan named");
        Check(channels[0].GetProperty("rpm").GetInt32() == 1320 && channels[0].GetProperty("duty").ValueKind == JsonValueKind.Null, "fresh RPM retained and unknown duty not invented");
        string id = channels[0].GetProperty("id").GetString()!;
        Reject(() => Call(module, new { command = "manual", id, duty = 0, fanConfirmed = true }), "zero fan duty rejected");
        Reject(() => Call(module, new { command = "manual", id, duty = 50, fanConfirmed = false }), "manual needs fan confirmation");
        Reject(() => Call(module, new { command = "manual", id = fake.Identity.Id + "/fan/1/PUMP", duty = 50, fanConfirmed = true }), "pump cannot receive fan PWM");
        Check(fake.SpeedWrites == 0, "invalid manual requests emit no speed packet");
        // A rejected user request does not clear a retained ownership obligation.
        Call(module, new { command = "release-control" });
        Call(module, new { command = "take-control", confirmICuePause = true });
        var manual = Element(Call(module, new { command = "manual", id, duty = 65, fanConfirmed = true }));
        Check(manual.GetProperty("applied").GetBoolean() && manual.GetProperty("id").GetString() == id && manual.GetProperty("duty").GetInt32() == 65 && !manual.GetProperty("physicalVerification").GetBoolean(), "manual reports exact device ACK without physical claim");
        Check(fake.LastDuty is [1, 2, 0, 65, 0] && fake.SpeedWrites == 1, "manual packet targets only selected fan channel");
        var colors = Enumerable.Repeat("#F27AFF", 54).ToArray();
        var rgb = Element(Call(module, new { command = "set", deviceId = fake.Identity.Id, colors }));
        Check(rgb.GetProperty("applied").GetBoolean() && rgb.GetProperty("deviceId").GetString() == fake.Identity.Id && rgb.GetProperty("ledCount").GetInt32() == 54 && fake.ColorWrites == 1, "RGB uses freshly confirmed complete LED topology");
        Check(fake.LastColor.Length == 162 && fake.LastColor[0] == 0xf2 && fake.LastColor[1] == 0x7a && fake.LastColor[2] == 0xff, "RGB packed channel order is RGB");
        int eventStart = fake.Events.Count;
        var released = Element(Call(module, new { command = "release-control" }));
        var events = fake.Events.Skip(eventStart).ToArray();
        Check(released.GetProperty("released").GetBoolean() && released.GetProperty("releaseVerification").GetString() == "device-ack" && !released.GetProperty("physicalVerification").GetBoolean(), "release does not claim physical BIOS restoration");
        Check(Array.IndexOf(events, "hardware") < Array.IndexOf(events, "firmware") && Array.IndexOf(events, "firmware") < Array.IndexOf(events, "identity")
            && Array.IndexOf(events, "identity") < Array.IndexOf(events, "dispose") && Array.IndexOf(events, "dispose") < Array.IndexOf(events, "vendor-release"), "hardware ACK then delay fresh identity then HID close then vendor restore");
        Check(fake.SpeedWrites == 1, "release sends no default-duty substitute");
        Call(module, new { command = "take-control", confirmICuePause = true });
        fake.FailHardware = true;
        var failed = Element(Call(module, new { command = "release-control" }));
        Check(!failed.GetProperty("released").GetBoolean() && failed.GetProperty("retryRequired").GetBoolean() && !fake.Disposed && vendorActive, "lost hardware-mode ACK retains handle and service lease for OFF retry");
        fake.FailHardware = false;
        fake.BadIdentity = true;
        var changed = Element(Call(module, new { command = "release-control" }));
        Check(!changed.GetProperty("released").GetBoolean() && !fake.Disposed && vendorActive, "fresh identity mismatch never confirms release");
        fake.BadIdentity = false; Call(module, new { command = "release-control" }); Check(fake.Disposed && !vendorActive, "same retained lease successfully retries release");
        Call(module, new { command = "take-control", confirmICuePause = true }); failVendor = true;
        var serviceFailure = Element(Call(module, new { command = "release-control" }));
        Check(!serviceFailure.GetProperty("released").GetBoolean() && fake.Disposed && vendorActive, "vendor restore failure remains active after HID closes");
        failVendor = false; Call(module, new { command = "release-control" }); Check(!vendorActive, "service-only OFF retry restores pending lease");
        fake.Unknown = true; Call(module, new { command = "take-control", confirmICuePause = true });
        var unknown = Element(Call(module, new { command = "status" }));
        Check(!unknown.GetProperty("rgbAvailable").GetBoolean() && unknown.GetProperty("devices").GetArrayLength() == 0, "unknown topology disables full-hub RGB");
        int previous = fake.ColorWrites; Reject(() => Call(module, new { command = "set", deviceId = fake.Identity.Id, colors }), "unknown topology RGB rejected");
        Check(fake.ColorWrites == previous, "unknown topology emits no color packet");
        Call(module, new { command = "release-control" }); fake.Unknown = false;
        fake.UnlistedLedRow = true;
        var incomplete = Element(Call(module, new { command = "take-control", confirmICuePause = true }));
        Check(incomplete.GetProperty("channels").GetArrayLength() == 1 && !incomplete.GetProperty("rgbAvailable").GetBoolean(), "unlisted LED row disables RGB while retaining verified fan detection");
        previous = fake.ColorWrites;
        Reject(() => Call(module, new { command = "set", deviceId = fake.Identity.Id, colors }), "incomplete LED topology cannot receive a full-hub frame");
        Check(fake.ColorWrites == previous, "incomplete LED topology emits no color packet");
        Call(module, new { command = "release-control" }); fake.UnlistedLedRow = false;
        fake.Fans = 9;
        var nine = Element(Call(module, new { command = "take-control", confirmICuePause = true }));
        var nineChannels = nine.GetProperty("channels");
        Check(nineChannels.GetArrayLength() == 9 && nineChannels.EnumerateArray().Select(c => c.GetProperty("id").GetString()).Distinct().Count() == 9, "nine discovered fans retain separate stable channel identities");
        Check(nineChannels[8].GetProperty("rpm").GetInt32() == 1328 && nineChannels[8].GetProperty("channel").GetInt32() == 10, "nine-fan RPM remains tied to the exact reported channel");
        var zones = nine.GetProperty("devices")[0].GetProperty("zones"); int nextLed = 0;
        foreach (var zone in zones.EnumerateArray()) { Check(zone.GetProperty("startIndex").GetInt32() == nextLed, "known topology has contiguous LED zones"); nextLed += zone.GetProperty("ledCount").GetInt32(); }
        Check(nextLed == nine.GetProperty("devices")[0].GetProperty("ledCount").GetInt32() && nextLed == 326, "nine-fan RGB count uses confirmed LEDs including known pump");
        Call(module, new { command = "manual", id = nineChannels[8].GetProperty("id").GetString(), duty = 80, fanConfirmed = true });
        Check(fake.LastDuty is [1, 10, 0, 80, 0], "ninth-fan manual command targets channel ten and leaves pump untouched");
        Call(module, new { command = "release-control" }); fake.Fans = 1;
        // Protocol validation operates solely on fixture bytes.
        var packet = CorsairDirectProtocol.Packet([6, 1], CorsairDirectProtocol.Manual(new(2, 1, 0, "QX", CorsairDirectProtocol.FindModel(1, 0)), 65));
        Check(packet.Length == 513 && packet[2] == 1 && packet[3] == 6 && packet[4] == 1, "output report exact framing");
        var raw = Wire.Raw([2, 0x13], 0); raw[5] = 2; raw[6] = 5;
        Check(CorsairDirectProtocol.Firmware(CorsairDirectProtocol.Reply(raw, [2, 0x13])).Minor == 5, "firmware read is explicitly typed and validated");
        var capturedFirmware = new byte[513]; Convert.FromHexString("000002000209E801").CopyTo(capturedFirmware, 1);
        Check(CorsairDirectProtocol.Firmware(CorsairDirectProtocol.Reply(capturedFirmware, [2, 0x13])).ToString() == "2.9.488", "captured upstream firmware wire header decoded correctly");
        var capturedRpm = new byte[513]; Convert.FromHexString("0000080025000201000000E201").CopyTo(capturedRpm, 1);
        Check(CorsairDirectProtocol.Values(CorsairDirectProtocol.Reply(capturedRpm, [8, 1], 0x25))[1] == 482, "captured upstream RPM wire header decoded correctly");
        var wrong = (byte[])raw.Clone(); wrong[3] = 8;
        Reject(() => CorsairDirectProtocol.Reply(wrong, [2, 0x13]), "wrong command echo rejected");
        wrong = (byte[])raw.Clone(); wrong[4] = 3; Reject(() => CorsairDirectProtocol.Reply(wrong, [2, 0x13]), "negative device status rejected");
        Reject(() => CorsairDirectProtocol.Reply(new byte[513], [2, 0x13]), "zero-filled stale ACK rejected");
        Reject(() => CorsairDirectProtocol.Reply(raw.AsSpan(0, 4), [2, 0x13]), "truncated ACK rejected");
        Reject(() => CorsairDirectProtocol.Reply(raw, [2, 0x13], 0x25), "wrong response type rejected");
        wrong = (byte[])raw.Clone(); wrong[5] = 1; Reject(() => CorsairDirectProtocol.Firmware(CorsairDirectProtocol.Reply(wrong, [2, 0x13])), "unsupported firmware fails closed");
        var split = Wire.TopologyFrames(24, Enumerable.Range(1, 24).Select(i => (i, (byte)1, (byte)0, "QX-SERIAL-" + i.ToString("D10"))).ToArray());
        Check(CorsairDirectProtocol.Topology(split.First, split.Next).Length == 24, "24 channels parsed across firmware 2.5 continuation");
        var splitBug = Wire.TopologyFrames(24, Enumerable.Range(1, 24).Select(i => (i, (byte)1, (byte)0, i.ToString("D26"))).ToArray());
        var missingByte = splitBug.Next.AsSpan(0, 4).ToArray().Concat(splitBug.Next.AsSpan(5).ToArray()).ToArray();
        var recovered = CorsairDirectProtocol.Topology(splitBug.First, missingByte);
        Check(recovered.Length == 24 && recovered.Single(c=>c.Index==15).Serial.Length == 25 && recovered.Single(c=>c.Index==24).Serial == 24.ToString("D26"), "captured missing-character continuation shape retains exact later channels");
        Reject(() => CorsairDirectProtocol.Topology([0, 8, 1, 0, 0x21, 0, 24], [0, 8, 1, 0]), "truncated topology fails closed");
        Reject(() => CorsairDirectProtocol.Values([0, 8, 1, 0, 0x25, 0, 24]), "truncated sensor payload fails closed");
        Check(CorsairDirectProtocol.FindModel(7, 0)!.Pump && !CorsairDirectProtocol.FindModel(7, 0)!.Fan && CorsairDirectProtocol.FindModel(1, 99) == null, "pump and unknown variant classified without guessing");
        var ledLast = new byte[19]; ledLast[6] = 2; BinaryPrimitives.WriteUInt16LittleEndian(ledLast.AsSpan(15), 2); BinaryPrimitives.WriteUInt16LittleEndian(ledLast.AsSpan(17), 34);
        Check(CorsairDirectProtocol.LedTopologyMatches(ledLast, [new(2, 1, 0, "LAST-QX", CorsairDirectProtocol.FindModel(1, 0))]), "LED last-channel index is inclusive as in primary protocol reader");
        Check(!CorsairDirectProtocol.LedTopologyMatches(ledLast.AsSpan(0, 18), [new(2, 1, 0, "LAST-QX", CorsairDirectProtocol.FindModel(1, 0))]), "truncated final LED row never enables RGB");
        var ledChannels = new[] { new CorsairDirectProtocol.Channel(2, 1, 0, "LAST-QX", CorsairDirectProtocol.FindModel(1, 0)) };
        var unlistedLed = (byte[])ledLast.Clone();
        BinaryPrimitives.WriteUInt16LittleEndian(unlistedLed.AsSpan(11), 2); BinaryPrimitives.WriteUInt16LittleEndian(unlistedLed.AsSpan(13), 34);
        Check(!CorsairDirectProtocol.LedTopologyMatches(unlistedLed, ledChannels), "unlisted connected LED channel prevents incomplete full-hub RGB");
        BinaryPrimitives.WriteUInt16LittleEndian(unlistedLed.AsSpan(11), 0);
        Check(!CorsairDirectProtocol.LedTopologyMatches(unlistedLed, ledChannels), "unlisted nonzero LED count fails closed even without connected status");
        BinaryPrimitives.WriteUInt16LittleEndian(unlistedLed.AsSpan(13), 0);
        Check(CorsairDirectProtocol.LedTopologyMatches(unlistedLed, ledChannels), "empty unlisted channel does not shift the known LED layout");
        Check(!CorsairDirectProtocol.LedTopologyMatches(ledLast, [ledChannels[0], ledChannels[0]]), "duplicate topology channel cannot confirm full-hub RGB");
        Check(!CorsairDirectProtocol.LedTopologyMatches(ledLast, [ledChannels[0] with { Index = 0 }]), "controller channel zero cannot become an LED device");
        Reject(() => CorsairDirectProtocol.Manual(new(1, 7, 0, "PUMP", CorsairDirectProtocol.FindModel(7, 0)), 50), "pump speed packet rejected independently of active session");
        return new { ok = true, passed = checks.Count, checks = checks.ToArray(), realHardwarePackets = 0, realServiceControls = 0, childProcesses = 0 };
    }
    sealed class Wire : ICorsairDirectTransport
    {
        public CorsairDirectIdentity Identity { get; } = new("corsair-link-fixture", "synthetic-only", "HUB-FIXTURE", "iCUE LINK System Hub", 0x1b1c, 0x0c3f);
        internal readonly List<string> Events = [];
        internal readonly List<byte[]> Commands = [];
        internal bool Disposed, FailHardware, BadIdentity, Unknown, UnlistedLedRow;
        internal int ModeWrites, SpeedWrites, ColorWrites, Fans = 1;
        internal byte[] LastDuty = [], LastColor = [];
        byte endpoint; int topologyReads;
        public IDisposable BeginTransaction() => new Empty();
        sealed class Empty : IDisposable { public void Dispose() { } }
        public bool SameIdentity() { Events.Add("identity"); return !BadIdentity; }
        public void Dispose() { Disposed = true; Events.Add("dispose"); }
        public byte[] Exchange(byte[] command, byte[] data, ushort? type = null)
        {
            Commands.Add(CorsairDirectProtocol.Packet(command, data));
            var raw = Raw(command, 0);
            if (command.SequenceEqual(CorsairDirectProtocol.FirmwareCommand)) { Events.Add("firmware"); raw[5] = 2; raw[6] = 5; raw[7] = 44; }
            else if (command.SequenceEqual(CorsairDirectProtocol.SoftwareCommand)) { ModeWrites++; Events.Add("software"); }
            else if (command.SequenceEqual(CorsairDirectProtocol.HardwareCommand)) { ModeWrites++; Events.Add("hardware"); if (FailHardware) throw new IOException("Fixture hardware ACK missing"); }
            else if (command[0] == 13) { endpoint = data[0]; topologyReads = 0; }
            else if (command[0] == 8)
            {
                if (endpoint == 0x36)
                {
                    var items = new List<(int, byte, byte, string)> { (1, 7, 0, "PUMP") };
                    for (int index = 0; index < Fans; index++) items.Add((index + 2, 1, 0, index == 0 ? "QX" : "QX-" + index));
                    if (Unknown) items.Add((Fans + 2, 250, 0, "UNKNOWN"));
                    var frames = TopologyFrames(items.Count, items.ToArray());
                    return topologyReads++ == 0 ? frames.First : frames.Next;
                }
                if (endpoint is 0x17 or 0x21)
                {
                    BinaryPrimitives.WriteUInt16LittleEndian(raw.AsSpan(5), endpoint == 0x17 ? (ushort)0x25 : (ushort)0x10); raw[7] = (byte)(Fans + 2);
                    raw[8] = 1; raw[11] = 0;
                    BinaryPrimitives.WriteInt16LittleEndian(raw.AsSpan(12), (short)(endpoint == 0x17 ? 2400 : 350));
                    for (int index = 0; index < Fans; index++) BinaryPrimitives.WriteInt16LittleEndian(raw.AsSpan(15 + index * 3), (short)(endpoint == 0x17 ? 1320 + index : 310));
                }
                if (endpoint == 0x20)
                {
                    raw[7] = (byte)(Fans + 1 + (UnlistedLedRow ? 1 : 0)); BinaryPrimitives.WriteUInt16LittleEndian(raw.AsSpan(12), 2); BinaryPrimitives.WriteUInt16LittleEndian(raw.AsSpan(14), 20);
                    for (int index = 0; index < Fans; index++) { BinaryPrimitives.WriteUInt16LittleEndian(raw.AsSpan(16 + index * 4), 2); BinaryPrimitives.WriteUInt16LittleEndian(raw.AsSpan(18 + index * 4), 34); }
                    if (UnlistedLedRow) { BinaryPrimitives.WriteUInt16LittleEndian(raw.AsSpan(8 + (Fans + 2) * 4), 2); BinaryPrimitives.WriteUInt16LittleEndian(raw.AsSpan(10 + (Fans + 2) * 4), 34); }
                }
            }
            else if (command[0] == 6 && endpoint == 0x18) { SpeedWrites++; LastDuty = data.AsSpan(6).ToArray(); }
            else if (command[0] == 6 && endpoint == 0x22) { ColorWrites++; LastColor = data.AsSpan(6).ToArray(); }
            return CorsairDirectProtocol.Reply(raw, command, type);
        }
        internal static byte[] Raw(byte[] command, byte status)
        {
            var raw = new byte[513]; raw[3] = command[0]; raw[4] = status; return raw;
        }
        internal static (byte[] First, byte[] Next) TopologyFrames(int count, (int Channel, byte Type, byte Variant, string Serial)[] channels)
        {
            var bytes = new List<byte>();
            for (int i = 1; i <= count; i++)
            {
                var item = channels.FirstOrDefault(c => c.Channel == i); byte[] serial = item.Serial == null ? [] : Encoding.ASCII.GetBytes(item.Serial);
                var row = new byte[8]; row[2] = item.Type; row[3] = item.Variant; if (serial.Length > 0) row[6] = 5; row[7] = (byte)serial.Length; bytes.AddRange(row); bytes.AddRange(serial);
            }
            var first = new byte[512]; first[2] = 8; first[4] = 0x21; first[6] = (byte)count;
            var next = new byte[512]; next[2] = 8;
            int length = Math.Min(bytes.Count, first.Length - 7); bytes.Take(length).ToArray().CopyTo(first, 7); bytes.Skip(length).ToArray().CopyTo(next, 4);
            return (first, next);
        }
    }
}
