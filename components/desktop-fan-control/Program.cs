using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
namespace Batto.DesktopFanControl;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTests.Run();
        bool elevatedPipe = args.Length == 8 && args[0] == "--pipe" && args[2] == "--token" && args[4] == "--parent-pid" && args[6] == "--parent-start";
        int parentPid = 0; long parentTicks = 0;
        bool valid = elevatedPipe ? FanPipe.ValidName(args[1]) && FanPipe.ValidToken(args[3]) && int.TryParse(args[5], out parentPid)
            && long.TryParse(args[7], out parentTicks) && parentTicks > 0 && FanPipe.OwnerMatches(parentPid, parentTicks)
            : args.Length == 2 && args[0] == "--parent-pid" && int.TryParse(args[1], out parentPid);
        if (!valid || parentPid <= 0 || parentPid == Environment.ProcessId)
        { Console.Error.WriteLine("Dieser Helfer wird nur von Batto mit einem überwachten Elternprozess gestartet."); return 2; }
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        using var parent = Process.GetProcessById(parentPid);
        if (!elevatedPipe) parentTicks = parent.StartTime.ToUniversalTime().Ticks;
        using NamedPipeServerStream? pipe = elevatedPipe ? FanPipe.Create(args[1], parentPid) : null;
        if (pipe is not null)
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            try { await FanPipe.Authenticate(pipe, parentPid, parentTicks, args[3], deadline.Token); }
            catch { return 2; }
        }
        using StreamReader? reader = pipe is null ? null : new(pipe, new UTF8Encoding(false, true), false, 4096, true);
        using StreamWriter? writer = pipe is null ? null : new(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        TextReader input = reader ?? Console.In;
        TextWriter output = writer ?? Console.Out;
        if (pipe is not null) { await output.WriteLineAsync("{\"event\":\"ready\"}"); await output.FlushAsync(); }
        DateTimeOffset startedUtc = DateTimeOffset.UtcNow;
        var monotonic = Stopwatch.StartNew();
        var engine = new FanEngine(new LibreBackend(), () => startedUtc + monotonic.Elapsed);
        using var stop = new CancellationTokenSource();
        var gate = new SemaphoreSlim(1, 1);
        int exitCode = 0;
        Task tick = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
            try
            {
                while (await timer.WaitForNextTickAsync(stop.Token))
                {
                    await gate.WaitAsync(stop.Token);
                    try
                    {
                        engine.Tick(FanPipe.OwnerMatches(parentPid, parentTicks));
                        if (!FanPipe.OwnerMatches(parentPid, parentTicks)) { stop.Cancel(); break; }
                        if (engine.ShouldExit) { stop.Cancel(); break; }
                    }
                    catch (Exception error) { Console.Error.WriteLine(error.Message); exitCode = 2; stop.Cancel(); break; }
                    finally { gate.Release(); }
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        });
        try
        {
            while (!stop.IsCancellationRequested)
            {
                // Console's synchronous input wrapper may not honor read
                // cancellation. The native watchdog must still be able to exit.
                string? line = await Task.Run(input.ReadLine).WaitAsync(stop.Token);
                if (line is null) break;
                await gate.WaitAsync(stop.Token);
                try
                {
                    Reply response;
                    try
                    {
                        if (line.Length > 65536) throw new InvalidDataException("Lüfteranfrage ist zu groß.");
                        using JsonDocument document = JsonDocument.Parse(line, new JsonDocumentOptions { MaxDepth = 12 });
                        response = engine.Process(document.RootElement);
                    }
                    catch (Exception error) { response = new(-1, false, engine.Snapshot(), error.Message); }
                    await output.WriteLineAsync(JsonSerializer.Serialize(response, JsonProtocol.Options));
                    await output.FlushAsync();
                    if (engine.ShouldExit) break;
                }
                finally { gate.Release(); }
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        finally
        {
            stop.Cancel(); await tick;
            try { engine.Release(); }
            catch (Exception error) { Console.Error.WriteLine("Freigabe beim Beenden fehlgeschlagen: " + error.Message); exitCode = 2; }
            gate.Dispose();
        }
        return exitCode;
    }
}
