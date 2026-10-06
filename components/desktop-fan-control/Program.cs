using System.Diagnostics;
using System.Text;
using System.Text.Json;
namespace Batto.DesktopFanControl;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTests.Run();
        if (args.Length != 2 || args[0] != "--parent-pid" || !int.TryParse(args[1], out int parentPid) || parentPid <= 0)
        { Console.Error.WriteLine("Dieser Helfer wird nur von Batto mit einem überwachten Elternprozess gestartet."); return 2; }
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        using var parent = Process.GetProcessById(parentPid);
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
                        parent.Refresh(); engine.Tick(!parent.HasExited);
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
                string? line = await Task.Run(Console.ReadLine).WaitAsync(stop.Token);
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
                    await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, JsonProtocol.Options));
                    await Console.Out.FlushAsync();
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
