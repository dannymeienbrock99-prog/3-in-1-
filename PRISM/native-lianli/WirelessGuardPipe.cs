using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Prism.LianLi;

// Only this transient IPC object permits the expected normal owner to talk to
// its elevated guard. No device, service or system permission is changed.
[SupportedOSPlatform("windows")]
internal static class WirelessGuardPipe
{
    internal static NamedPipeServerStream Create(string name, int ownerPid)
    {
        using var process = OpenProcess(0x1000, false, ownerPid); // QUERY_LIMITED_INFORMATION
        if (process.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Der Besitzer der Strimer-Sitzung ist nicht erreichbar.");
        if (!OpenProcessToken(process, 8, out var token)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Die Strimer-Sitzung konnte nicht zugeordnet werden.");
        using (token)
        using (var owner = new WindowsIdentity(token.DangerousGetHandle()))
        using (var server = WindowsIdentity.GetCurrent())
        {
            var ownerSid = owner.User ?? throw new UnauthorizedAccessException("Der Strimer-Besitzer hat keine gültige Windows-Identität.");
            var serverSid = server.User ?? throw new UnauthorizedAccessException("Der Strimer-Helfer hat keine gültige Windows-Identität.");
            var security = new PipeSecurity();
            security.SetAccessRuleProtection(true, false);
            security.SetOwner(serverSid);
            security.AddAccessRule(new PipeAccessRule(serverSid, PipeAccessRights.FullControl, AccessControlType.Allow));
            if (ownerSid != serverSid) security.AddAccessRule(new PipeAccessRule(ownerSid, PipeAccessRights.ReadWrite, AccessControlType.Allow));
            // A high-integrity server must permit writes by its medium-integrity
            // owner. CurrentUserOnly would override this ACL with token.Owner.
            security.SetSecurityDescriptorSddlForm("S:(ML;;NW;;;ME)", AccessControlSections.Audit);
            return NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 4096, 4096, security);
        }
    }

    internal static void AssertClient(NamedPipeServerStream pipe, int ownerPid, long ownerTicks)
    {
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out uint clientPid) || clientPid != (uint)ownerPid
            || !WirelessHandoff.OwnerMatches(ownerPid, ownerTicks))
            throw new UnauthorizedAccessException("Die Strimer-Verbindung gehört nicht zum bestätigten Batto-Prozess.");
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern SafeProcessHandle OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inherit, int processId);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool OpenProcessToken(SafeProcessHandle process, uint desiredAccess, out SafeAccessTokenHandle token);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint processId);
}
