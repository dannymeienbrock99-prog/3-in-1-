using System.Management;
using System.Security.Principal;
using System.Text.RegularExpressions;
using LibreHardwareMonitor.PawnIo;
namespace Batto.DesktopFanControl;

internal static class HardwarePolicy
{
    // Keep these pure metadata rules aligned with platformFromMetadata in Batto.
    internal static bool IsDesktop(ushort pcType, IEnumerable<ushort> chassisTypes)
    {
        ushort[] chassis = chassisTypes.ToArray();
        bool portable = pcType == 2 || chassis.Any(c => c is 8 or 9 or 10 or 11 or 12 or 14 or 30 or 31 or 32);
        return !portable && (pcType is 1 or 3 || chassis.Any(c => c is 3 or 4 or 5 or 6 or 7 or 15 or 16));
    }
    internal static bool SupportedManufacturer(string manufacturer) => Regex.IsMatch(manufacturer,
        @"(?:^|\b)(?:asus|asustek|msi|micro[- ]?star)(?:\b|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.ECMAScript);

    internal static HardwareFacts Read()
    {
        if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("Lüftersteuerung ist nur unter Windows verfügbar.");
        string manufacturer = "", product = "";
        ushort pcType = 0;
        var chassisTypes = new List<ushort>();
        using (var search = new ManagementObjectSearcher("SELECT Manufacturer, Product FROM Win32_BaseBoard"))
        using (var rows = search.Get())
        {
            foreach (ManagementBaseObject row in rows) { manufacturer = Convert.ToString(row["Manufacturer"])?.Trim() ?? ""; product = Convert.ToString(row["Product"])?.Trim() ?? ""; break; }
        }
        using (var search = new ManagementObjectSearcher("SELECT PCSystemType FROM Win32_ComputerSystem"))
        using (var rows = search.Get())
        {
            foreach (ManagementBaseObject row in rows) { pcType = Convert.ToUInt16(row["PCSystemType"] ?? 0); break; }
        }
        using (var search = new ManagementObjectSearcher("SELECT ChassisTypes FROM Win32_SystemEnclosure"))
        using (var rows = search.Get())
        {
            foreach (ManagementBaseObject row in rows)
            {
                if (row["ChassisTypes"] is not ushort[] chassis) continue;
                chassisTypes.AddRange(chassis);
            }
        }
        bool admin;
        using (var identity = WindowsIdentity.GetCurrent()) admin = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        return new(IsDesktop(pcType, chassisTypes), manufacturer, product, admin, PawnIo.IsInstalled);
    }
    internal static void Validate(HardwareFacts facts)
    {
        if (!facts.IsDesktop) throw new InvalidOperationException("Kein sicher erkannter Desktop-PC. Notebook-Lüfter werden nicht gesteuert.");
        if (!SupportedManufacturer(facts.Manufacturer))
            throw new InvalidOperationException("Die direkte Mainboardsteuerung unterstützt hier nur ASUS und MSI.");
        if (!facts.Administrator) throw new InvalidOperationException("Direkte Mainboardsteuerung benötigt Administratorrechte. Batto erhöht seine Rechte nicht automatisch.");
        if (!facts.PawnInstalled) throw new InvalidOperationException("Der benötigte PawnIO-Treiber ist nicht vorhanden. Batto installiert keinen Treiber automatisch.");
    }
}
