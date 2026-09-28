using System.IO;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;
namespace FanAtlas;
public sealed class WindowsSensors
{
    [StructLayout(LayoutKind.Sequential)] private struct MemoryStatus { public uint Length, Load; public ulong Total, Available, PageTotal, PageAvailable, VirtualTotal, VirtualAvailable, Extended; }
    [DllImport("kernel32.dll")] private static extern bool GlobalMemoryStatusEx(ref MemoryStatus value);
    [DllImport("kernel32.dll")] private static extern bool GetSystemTimes(out ulong idle, out ulong kernel, out ulong user);
    private ulong lastIdle, lastTotal;
    public List<Measurement> Read()
    {
        var list = new List<Measurement>(); var now = DateTime.UtcNow;
        var ram = new MemoryStatus { Length = (uint)Marshal.SizeOf<MemoryStatus>() };
        if (GlobalMemoryStatusEx(ref ram)) {
            list.Add(new("windows/ram-used", "Arbeitsspeicher belegt", "RAM", "GB", (ram.Total - ram.Available) / 1073741824.0, "Windows", now));
            list.Add(new("windows/ram-total", "Arbeitsspeicher gesamt", "RAM", "GB", ram.Total / 1073741824.0, "Windows", now));
            list.Add(new("windows/ram-load", "RAM-Auslastung", "RAM", "%", ram.Load, "Windows", now));
        }
        if (GetSystemTimes(out var idle, out var kernel, out var user)) {
            ulong total = kernel + user;
            if (lastTotal > 0 && total > lastTotal && idle >= lastIdle) list.Add(new("windows/cpu-load", "CPU-Auslastung", "CPU", "%", Math.Clamp(100.0 * (1 - (double)(idle - lastIdle) / (total - lastTotal)), 0, 100), "Windows", now));
            lastIdle = idle; lastTotal = total;
        }
        return list;
    }
}
public sealed class HwinfoReader
{
    private readonly string mappingName;
    public HwinfoReader(string name = @"Global\HWiNFO_SENS_SM2") { mappingName = name; }
    public string Status { get; private set; } = "HWiNFO nicht verbunden";
    public List<Measurement> Read()
    {
        try {
            using var mapping = MemoryMappedFile.OpenExisting(mappingName, MemoryMappedFileRights.Read);
            using var view = mapping.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
            if (view.Capacity < 44 || view.ReadUInt32(0) != 0x53695748 || view.ReadUInt32(4) != 1) throw new InvalidDataException("HWiNFO-Datenformat nicht aktiv oder nicht unterstützt.");
            long stamp = view.ReadInt64(12);
            uint sensorStart = view.ReadUInt32(20), sensorSize = view.ReadUInt32(24), sensorCount = view.ReadUInt32(28);
            uint readingStart = view.ReadUInt32(32), readingSize = view.ReadUInt32(36), readingCount = view.ReadUInt32(40);
            if (sensorStart < 44 || readingStart < 44 || sensorSize < 264 || sensorSize > 4096 || readingSize < 316 || readingSize > 4096 || sensorCount > 2048 || readingCount > 20000) throw new InvalidDataException("HWiNFO-Strukturgrenzen überschritten.");
            long end = Math.Max(sensorStart + (long)sensorSize * sensorCount, readingStart + (long)readingSize * readingCount);
            if (end > view.Capacity || end > 16 * 1024 * 1024) throw new InvalidDataException("HWiNFO-Daten unvollständig.");
            var bytes = new byte[end]; view.ReadArray(0, bytes, 0, bytes.Length);
            if (stamp != view.ReadInt64(12)) { Status = "HWiNFO aktualisiert gerade"; return new(); }
            var time = DateTimeOffset.FromUnixTimeSeconds(stamp).UtcDateTime;
            if (time > DateTime.UtcNow.AddSeconds(10) || DateTime.UtcNow - time > TimeSpan.FromSeconds(15)) { Status = "HWiNFO liefert keine aktuellen Werte"; return new(); }
            string Text(int offset, int length) { int n = Array.IndexOf(bytes, (byte)0, offset, length); return Encoding.Latin1.GetString(bytes, offset, n < 0 ? length : n - offset).Trim(); }
            var sensors = new List<(string Key, string Name)>();
            for (int i = 0; i < sensorCount; i++) { int p = (int)(sensorStart + i * sensorSize); string name = Text(p + 136, 128); sensors.Add(($"{BitConverter.ToUInt32(bytes, p):x}/{BitConverter.ToUInt32(bytes, p + 4)}", name.Length > 0 ? name : Text(p + 8, 128))); }
            var result = new List<Measurement>();
            for (int i = 0; i < readingCount; i++) {
                int p = (int)(readingStart + i * readingSize); uint index = BitConverter.ToUInt32(bytes, p + 4); if (index >= sensors.Count) continue;
                double value = BitConverter.ToDouble(bytes, p + 284); if (!double.IsFinite(value)) continue;
                string name = Text(p + 140, 128); if (name.Length == 0) name = Text(p + 12, 128);
                string unit = Text(p + 268, 16); var device = sensors[(int)index];
                result.Add(new($"hwinfo/{device.Key}/{BitConverter.ToUInt32(bytes, p + 8):x}", name, device.Name, unit, value, "HWiNFO Shared Memory", time));
            }
            Status = $"HWiNFO: {result.Count} freigegebene Sensoren"; return result;
        } catch (FileNotFoundException) { Status = "HWiNFO: Sensorfreigabe nicht aktiv"; return new(); }
        catch (Exception e) { Status = "HWiNFO: " + e.Message; return new(); }
    }
}
