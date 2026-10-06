using System.ComponentModel;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Batto.DesktopFanControl;

internal static class FanPipe
{
    internal static bool ValidName(string value) => System.Text.RegularExpressions.Regex.IsMatch(value, @"\Abatto-fan-[a-f0-9]{32}\z");
    internal static bool ValidToken(string value) => value.Length == 64 && value.All(Uri.IsHexDigit);
    internal static bool TokenMatches(string expected, string? value) => value is not null && ValidToken(expected) && ValidToken(value)
        && CryptographicOperations.FixedTimeEquals(Convert.FromHexString(expected), Convert.FromHexString(value));
    internal static bool OwnerMatches(int pid, long ticks)
    {
        try { using var owner = Process.GetProcessById(pid); return !owner.HasExited && owner.StartTime.ToUniversalTime().Ticks == ticks; }
        catch { return false; }
    }
    internal static NamedPipeServerStream Create(string name, int ownerPid)
    {
        using var process = OpenProcess(0x1000, false, ownerPid);
        if (process.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Der Besitzer der Lüftersitzung ist nicht erreichbar.");
        if (!OpenProcessToken(process, 8, out var token)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Die Lüftersitzung konnte nicht zugeordnet werden.");
        using (token)
        using (var owner = new WindowsIdentity(token.DangerousGetHandle()))
        using (var server = WindowsIdentity.GetCurrent())
        {
            var ownerSid = owner.User ?? throw new UnauthorizedAccessException("Ungültige Windows-Identität des Batto-Prozesses.");
            var serverSid = server.User ?? throw new UnauthorizedAccessException("Ungültige Windows-Identität des Lüfterhelfers.");
            var security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false); security.SetOwner(serverSid);
            security.AddAccessRule(new PipeAccessRule(serverSid, PipeAccessRights.FullControl, AccessControlType.Allow));
            if (ownerSid != serverSid) security.AddAccessRule(new PipeAccessRule(ownerSid, PipeAccessRights.ReadWrite, AccessControlType.Allow));
            // Permit the confirmed medium-integrity owner to communicate with
            // this elevated helper, without changing any device permissions.
            security.SetSecurityDescriptorSddlForm("S:(ML;;NW;;;ME)", AccessControlSections.Audit);
            return NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 4096, 4096, security);
        }
    }
    internal static async Task Authenticate(NamedPipeServerStream pipe, int ownerPid, long ticks, string token, CancellationToken cancellation)
    {
        await pipe.WaitForConnectionAsync(cancellation);
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out uint clientPid) || clientPid != (uint)ownerPid || !OwnerMatches(ownerPid, ticks))
            throw new UnauthorizedAccessException("Die Lüfterverbindung gehört nicht zum bestätigten Batto-Prozess.");
        // Bound the pre-authentication frame without creating an unbounded
        // StreamReader buffer. No hardware is opened before authentication.
        var buffer = new List<byte>(); var next = new byte[1];
        while (true)
        {
            int count = await pipe.ReadAsync(next, cancellation);
            if (count == 0) throw new EndOfStreamException("Die Lüfteranmeldung wurde unterbrochen.");
            if (next[0] == 10) break;
            if (buffer.Count >= 1024) throw new InvalidDataException("Die Lüfteranmeldung ist zu groß.");
            buffer.Add(next[0]);
        }
        using var hello = JsonDocument.Parse(Encoding.UTF8.GetString(buffer.ToArray()));
        if (!hello.RootElement.TryGetProperty("command", out var command) || command.GetString() != "hello"
            || !hello.RootElement.TryGetProperty("token", out var supplied) || supplied.ValueKind != JsonValueKind.String
            || !TokenMatches(token, supplied.GetString()) || !OwnerMatches(ownerPid, ticks))
            throw new UnauthorizedAccessException("Die Lüftersitzung konnte nicht bestätigt werden.");
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, int processId);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool OpenProcessToken(SafeProcessHandle process, uint access, out SafeAccessTokenHandle token);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint processId);
}
