using System.Diagnostics;

namespace Prism.LianLi;

// Optional own-process lifetime bound. It changes no foreign process or device
// state: process exit simply releases this helper's own USB handles.
internal sealed class WirelessWorkerLease : IDisposable
{
    readonly int ownerPid; readonly long ownerTicks;
    readonly Timer timer;
    long heartbeat = Stopwatch.GetTimestamp(), operation = Stopwatch.GetTimestamp();
    int active;
    internal WirelessWorkerLease(int pid, long ticks)
    {
        if (!WirelessHandoff.OwnerMatches(pid, ticks) || pid == Environment.ProcessId) throw new ArgumentException("Wireless-Besitzer ist nicht mehr verfügbar.");
        ownerPid = pid; ownerTicks = ticks;
        timer = new Timer(_ => {
            double elapsed = Stopwatch.GetElapsedTime(Interlocked.Read(ref heartbeat)).TotalSeconds;
            double operationAge = Stopwatch.GetElapsedTime(Interlocked.Read(ref operation)).TotalSeconds;
            if (Expired(elapsed, Volatile.Read(ref active) == 1, WirelessHandoff.OwnerMatches(ownerPid, ownerTicks), operationAge)) Environment.Exit(0);
        }, null, 500, 500);
    }
    internal void Heartbeat() => Interlocked.Exchange(ref heartbeat, Stopwatch.GetTimestamp());
    internal void Begin() { Interlocked.Exchange(ref operation, Stopwatch.GetTimestamp()); Volatile.Write(ref active, 1); }
    internal void End() => Volatile.Write(ref active, 0);
    internal static bool Expired(double heartbeatSeconds, bool handlingRequest, bool ownerPresent, double operationSeconds = 0)
        => !ownerPresent || heartbeatSeconds > 10 || handlingRequest && operationSeconds > 35;
    internal static WirelessWorkerLease? FromArguments(string[] args)
    {
        int index = Array.IndexOf(args, "--wireless-lease");
        if (index < 0) return null;
        if (!args.Contains("--wireless") || index + 2 >= args.Length || args.Count(value => value == "--wireless-lease") != 1
            || !int.TryParse(args[index + 1], out int pid) || pid <= 0 || !long.TryParse(args[index + 2], out long ticks) || ticks <= 0)
            throw new ArgumentException("Ungültiger Wireless-Besitzer.");
        return new(pid, ticks);
    }
    public void Dispose() => timer.Dispose();
}
