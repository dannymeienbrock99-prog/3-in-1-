package de.crazybatto.touchdeck;

import java.net.URI;

/** No DNS resolution: only explicit private LAN IPv4 addresses may host the deck. */
public final class DeckAddress {
    private DeckAddress() {}

    public static String normalize(String input) {
        try {
            String text = input == null ? "" : input.trim();
            if (text.indexOf("://") < 0) text = "http://" + text;
            URI uri = new URI(text);
            if (!"http".equals(uri.getScheme()) || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
            if (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath())) return null;
            String host = uri.getHost();
            if (host == null || !host.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")) return null;
            String[] parts = host.split("\\.");
            int[] ip = new int[4];
            for (int i = 0; i < 4; i++) {
                if (parts[i].length() > 1 && parts[i].startsWith("0")) return null;
                ip[i] = Integer.parseInt(parts[i]);
                if (ip[i] > 255) return null;
            }
            boolean local = ip[0] == 10 || (ip[0] == 192 && ip[1] == 168) || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31);
            if (!local) return null;
            int port = uri.getPort() == -1 ? 17660 : uri.getPort();
            if (port < 1 || port > 65535) return null;
            return "http://" + host + ":" + port + "/";
        } catch (Exception invalid) { return null; }
    }

    public static boolean sameOrigin(String base, String resource) {
        try {
            URI a = new URI(base), b = new URI(resource);
            return a.getScheme().equals(b.getScheme()) && a.getHost().equals(b.getHost()) && a.getPort() == b.getPort() && b.getRawUserInfo() == null;
        } catch (Exception invalid) { return false; }
    }
}
