using System.Buffers.Binary;
using System.Text;

namespace Batto.Hardware;

// Independent encoding of observed LINK wire fields, not a port of an upstream driver.
// Protocol references: OpenRGB CorsairICueLinkProtocol.h (VID/PID, endpoint IDs,
// device type/variant/LED facts) and FanControl.CorsairLink ICueLink packet notes
// (HID prefix, status/type offsets, two-frame firmware 2.5+ topology).
internal static class CorsairDirectProtocol
{
    internal const int Vid = 0x1b1c, Pid = 0x0c3f, OutputLength = 513, MaximumChannels = 24;
    internal static readonly byte[] FirmwareCommand = [2, 0x13], SoftwareCommand = [1, 3, 0, 2], HardwareCommand = [1, 3, 0, 1];
    internal sealed record Model(string Name, bool Fan, bool Pump, int Leds);
    internal sealed record Channel(int Index, byte Type, byte Variant, string Serial, Model? Known);
    internal static Model? Known(byte type, byte variant) => variant == 0 ? type switch
    {
        1 => new("QX RGB", true, false, 34), 2 => new("LX RGB", true, false, 18),
        3 => new("RX MAX RGB", true, false, 8), 4 => new("RX MAX", true, false, 0),
        15 => new("RX RGB", true, false, 8), 19 => new("RX", true, false, 0),
        16 => new("VRM Fan CapSwap", true, false, 0),
        9 => new("XC7 ELITE", false, false, 24), 10 => new("XG3 HYBRID", false, false, 0),
        12 => new("XD5 ELITE", false, true, 22), 25 => new("XD6 ELITE", false, true, 22),
        _ => null
    } : null;
    internal static Model? FindModel(byte type, byte variant)
    {
        if (type is 7 or 17 && variant <= 5) return new(type == 7 ? "H-series AIO pump" : "TITAN AIO pump", false, true, 20);
        if (type == 12 && variant == 1) return new("XD5 ELITE", false, true, 22);
        if (type == 25 && variant == 1) return new("XD6 ELITE", false, true, 22);
        return Known(type, variant);
    }
    internal static byte[] Packet(ReadOnlySpan<byte> command, ReadOnlySpan<byte> data)
    {
        if (command.Length is < 2 or > 4 || 3 + command.Length + data.Length > OutputLength) throw new InvalidDataException("Ungültiges Corsair-LINK-Paket.");
        var packet = new byte[OutputLength]; packet[2] = 1; command.CopyTo(packet.AsSpan(3)); data.CopyTo(packet.AsSpan(3 + command.Length)); return packet;
    }
    internal static byte[] Payload(ushort type, ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length > 4096) throw new InvalidDataException("Corsair-LINK-Daten sind zu groß.");
        var payload = new byte[6 + bytes.Length]; BinaryPrimitives.WriteUInt16LittleEndian(payload, checked((ushort)(bytes.Length + 2)));
        BinaryPrimitives.WriteUInt16LittleEndian(payload.AsSpan(4), type); bytes.CopyTo(payload.AsSpan(6)); return payload;
    }
    // HidSharp includes the leading HID report ID; the native protocol begins at byte 1.
    internal static byte[] Reply(ReadOnlySpan<byte> raw, ReadOnlySpan<byte> command, ushort? dataType = null)
    {
        if (raw.Length < 8 || raw.Length > 513 || raw[0] != 0) throw new InvalidDataException("Unvollständige Corsair-LINK-Antwort.");
        var reply = raw[1..];
        // Real captured LINK replies are 00 00 OPCODE STATUS; the handle/subcommand is not echoed.
        if (reply[0] != 0 || reply[1] != 0 || reply[2] != command[0]) throw new InvalidDataException("Corsair-LINK-Antwort gehört zu einem anderen Befehl.");
        if (reply[3] != 0) throw new CorsairDirectException("CORSAIR_COMMAND_REJECTED", "Der Corsair-LINK-Hub hat den Befehl abgelehnt (" + reply[3] + ").");
        if (dataType != null && BinaryPrimitives.ReadUInt16LittleEndian(reply.Slice(4, 2)) != dataType)
            throw new InvalidDataException("Corsair-LINK-Antwort hat den falschen Datentyp.");
        return reply.ToArray();
    }
    internal static Version Firmware(ReadOnlySpan<byte> reply)
    {
        if (reply.Length < 8) throw new InvalidDataException("Corsair-Firmwareantwort fehlt.");
        var version = new Version(reply[4], reply[5], BinaryPrimitives.ReadUInt16LittleEndian(reply.Slice(6, 2)));
        if (version.Major != 2 || version.Minor < 5) throw new CorsairDirectException("CORSAIR_FIRMWARE_UNSUPPORTED", "Die direkte LINK-Anbindung unterstützt geprüfte Firmware 2.5 oder neuer innerhalb Version 2.");
        return version;
    }
    internal static Channel[] Topology(ReadOnlySpan<byte> first, ReadOnlySpan<byte> continuation)
    {
        if (first.Length < 7 || continuation.Length < 4) throw new InvalidDataException("Corsair-Geräteliste ist abgeschnitten.");
        int count = first[6]; if (count > MaximumChannels) throw new InvalidDataException("Zu viele Corsair-LINK-Kanäle.");
        var joined = new byte[first.Length - 7 + continuation.Length - 4]; first[7..].CopyTo(joined); continuation[4..].CopyTo(joined.AsSpan(first.Length - 7));
        int offset = 0; var found = new List<Channel>(); var serials = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 1; index <= count; index++)
        {
            if (offset + 8 > joined.Length) throw new InvalidDataException("Corsair-Kanalliste ist abgeschnitten.");
            int length = joined[offset + 7]; if (length > 64 || offset + 8 + length > joined.Length) throw new InvalidDataException("Ungültige Corsair-Gerätekennung.");
            if (length > 0)
            {
                var bytes = joined.AsSpan(offset + 8, length); int zero = bytes.IndexOf((byte)0); if (zero >= 0) bytes = bytes[..zero];
                if (bytes.IsEmpty || bytes.ToArray().Any(b => b is < 33 or > 126)) throw new InvalidDataException("Ungültige Corsair-Gerätekennung.");
                string serial = Encoding.ASCII.GetString(bytes); if (!serials.Add(serial)) throw new InvalidDataException("Doppelte Corsair-Gerätekennung.");
                byte type = joined[offset + 2], variant = joined[offset + 3]; found.Add(new(index, type, variant, serial, FindModel(type, variant)));
                // Captured 2.5+ continuation frames can lose one serial character at the split.
                // Recover only that observed form, and only when the next descriptor proves
                // the shorter boundary while the declared boundary is structurally invalid.
                int split = first.Length - 7, start = offset + 8;
                if (index < count && zero == length - 1 && start < split && start + length > split
                    && PlausibleHeader(joined, start + zero) && !PlausibleHeader(joined, start + length)) length = zero;
            }
            offset += 8 + length;
        }
        return found.ToArray();
    }
    static bool PlausibleHeader(ReadOnlySpan<byte> bytes, int offset)
    {
        if (offset < 0 || offset + 8 > bytes.Length) return false;
        var header = bytes.Slice(offset, 8);
        if (header.IndexOfAnyExcept((byte)0) < 0) return true;
        return header[0] == 0 && header[1] == 0 && header[4] == 0 && header[5] == 0 && header[6] == 5
            && header[7] is > 0 and <= 64 && offset + 8 + header[7] <= bytes.Length;
    }
    internal static Dictionary<int, int?> Values(ReadOnlySpan<byte> reply, bool temperature = false)
    {
        if (reply.Length < 7 || reply[6] > 25 || 7 + reply[6] * 3 > reply.Length) throw new InvalidDataException("Corsair-Messwerte sind abgeschnitten.");
        var output = new Dictionary<int, int?>();
        for (int index = 0; index < reply[6]; index++)
        {
            var row = reply.Slice(7 + 3 * index, 3); if (row[0] > 1) throw new InvalidDataException("Unbekannter Corsair-Messwertstatus.");
            int value = BinaryPrimitives.ReadInt16LittleEndian(row[1..]);
            output[index] = row[0] == 0 && value >= 0 && value <= (temperature ? 1200 : 30000) ? value : null;
        }
        return output;
    }
    internal static bool LedTopologyMatches(ReadOnlySpan<byte> reply, Channel[] channels)
    {
        // Unlike RPM's row count, the LED header is the inclusive last channel index;
        // the four-byte rows include channel zero. See OpenLinkHub getLedDevices().
        if (reply.Length < 7 || reply[6] > MaximumChannels || 7 + (reply[6] + 1) * 4 > reply.Length || channels.Any(c => c.Known == null)) return false;
        int lastChannel = reply[6];
        var indices = channels.Select(c => c.Index).ToHashSet();
        if (indices.Count != channels.Length || indices.Any(index => index < 1 || index > lastChannel)) return false;
        // Full-hub color data must account for every reported LED channel.
        // Extra LED rows cannot be omitted merely because discovery lacked a serial.
        for (int index = 1; index <= reply[6]; index++)
            if (!indices.Contains(index) && BinaryPrimitives.ReadUInt16LittleEndian(reply.Slice(9 + index * 4, 2)) != 0) return false;
        foreach (var channel in channels)
        {
            if (channel.Index > reply[6]) return false;
            var row = reply.Slice(7 + channel.Index * 4, 4);
            int connected = BinaryPrimitives.ReadUInt16LittleEndian(row), count = BinaryPrimitives.ReadUInt16LittleEndian(row[2..]);
            if (channel.Known!.Leds == 0) { if (count != 0) return false; }
            else if (connected != 2 || count != channel.Known.Leds) return false;
        }
        return true;
    }
    internal static byte[] Manual(Channel channel, int duty)
    {
        if (channel.Known?.Fan != true || channel.Known.Pump || duty is < 30 or > 100) throw new InvalidDataException("Nur bestätigte LINK-Lüfter können zwischen 30 und 100 Prozent gesteuert werden.");
        return Payload(7, [1, checked((byte)channel.Index), 0, (byte)duty, 0]);
    }
    internal static string Fingerprint(Channel[] channels) => string.Join("|", channels.OrderBy(c => c.Index).Select(c => $"{c.Index}:{c.Type}:{c.Variant}:{c.Serial}"));
}

internal sealed class CorsairDirectException : IOException
{
    internal string Code { get; }
    internal CorsairDirectException(string code, string message) : base(message) { Code = code; }
}
