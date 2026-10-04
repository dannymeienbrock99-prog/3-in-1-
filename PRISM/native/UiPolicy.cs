using System.Globalization;
using System.Diagnostics.CodeAnalysis;

namespace Prism.WindowsLighting;

internal static class UiPolicy
{
    internal static int ParsePort(string[] args)
    {
        var values = args.Where(arg => arg.StartsWith("--ui-port=", StringComparison.Ordinal)).ToArray();
        if (values.Length == 0) return 4783;
        if (values.Length != 1 || !int.TryParse(values[0][10..], NumberStyles.None, CultureInfo.InvariantCulture, out int port) || port is < 1024 or > 65535)
            throw new LightingException("INVALID_UI_PORT", "Ungültiger Port der lokalen RGB-Oberfläche.");
        return port;
    }

    internal static bool TryLocalUrl(string value, int expectedPort, [NotNullWhen(true)] out Uri? uri)
    {
        uri = null;
        return expectedPort is >= 1024 and <= 65535 && value == $"http://127.0.0.1:{expectedPort}/"
            && Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == expectedPort
            && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0 && uri.UserInfo.Length == 0;
    }

    internal static bool SafeExternalLink(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Port != 443 || uri.UserInfo.Length != 0) return false;
        if (uri.Host is "learn.microsoft.com" or "www.microsoft.com" or "support.microsoft.com" or "developer.microsoft.com" or "go.microsoft.com" or "aka.ms"
            or "www.corsair.com" or "corsair.com" or "corsairofficial.github.io" or "www.msi.com" or "download.msi.com" or "www.kingston.com" or "lian-li.com") return true;
        return uri.Host == "github.com" && new[] { "/CorsairOfficial/cue-sdk", "/Beej126/KingstonFuryRgbCLI", "/sgtaziz/lian-li-linux" }.Any(repo =>
            uri.AbsolutePath.Equals(repo, StringComparison.OrdinalIgnoreCase) || uri.AbsolutePath.StartsWith(repo + "/", StringComparison.OrdinalIgnoreCase));
    }
}
