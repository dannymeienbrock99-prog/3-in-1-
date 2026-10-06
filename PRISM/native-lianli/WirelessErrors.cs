using System.ComponentModel;

namespace Prism.LianLi;

// Preserve the failed operation. Access denied alone cannot distinguish a
// denied device open from a denied WinUSB initialization. Neither error proves
// which other process, if any, owns the device.
internal sealed class WirelessUsbException(string stage, int win32Error)
    : IOException(WirelessErrors.Message(stage, win32Error), new Win32Exception(win32Error))
{
    internal string Stage { get; } = stage;
    internal int Win32Error { get; } = win32Error;
    internal string Code => WirelessErrors.Code(Stage, Win32Error);
}

internal static class WirelessErrors
{
    internal static string Code(string stage, int error) => error switch {
        32 or 170 => "WIRELESS_IN_USE",
        5 when stage == "initialize" => "WIRELESS_INITIALIZE_DENIED",
        5 => "WIRELESS_ACCESS_DENIED",
        2 or 6 or 1167 => "WIRELESS_DISCONNECTED",
        121 or 1460 => "WIRELESS_TIMEOUT",
        _ => "WIRELESS_USB_ERROR"
    };
    internal static string Message(string stage, int error) => Code(stage, error) switch {
        "WIRELESS_IN_USE" => $"Wireless-USB-Schnittstelle wird bereits verwendet (Windows {error}, {stage}). L-Connect kann sie belegen; kein Programm wird automatisch beendet.",
        "WIRELESS_INITIALIZE_DENIED" => "WinUSB verweigert den Schnittstellenzugriff (Windows 5, initialize). Ein anderer Prozess oder Geräteberechtigungen können die Ursache sein. Kein Programm oder Dienst wird automatisch beendet.",
        "WIRELESS_ACCESS_DENIED" => $"Windows verweigert den Wireless-Gerätezugriff (Windows 5, {stage}). Geräteberechtigungen oder ein anderer Besitzer können die Ursache sein; Batto ändert keine Rechte oder Treiber.",
        "WIRELESS_DISCONNECTED" => $"Wireless-USB-Gerät ist nicht mehr verfügbar (Windows {error}, {stage}). Bitte erneut suchen.",
        "WIRELESS_TIMEOUT" => $"Wireless-USB-Gerät antwortet nicht rechtzeitig (Windows {error}, {stage}). Bitte erneut suchen.",
        _ => $"Wireless-USB-Fehler {error} bei {stage}: {new Win32Exception(error).Message}"
    };
    internal static object Diagnostic(Exception error, string role, string stage = "query") => new {
        role,
        code = error is WirelessUsbException usb ? usb.Code : error is TimeoutException or OperationCanceledException ? "WIRELESS_TIMEOUT" : "WIRELESS_QUERY_FAILED",
        stage = error is WirelessUsbException tagged ? tagged.Stage : stage,
        win32Error = error is WirelessUsbException native ? (int?)native.Win32Error : null,
        message = error.Message
    };
}
