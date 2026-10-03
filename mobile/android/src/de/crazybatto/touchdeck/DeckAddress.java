package de.crazybatto.touchdeck;

import java.net.URI;
import java.net.URLDecoder;

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

    /** Explicit app-open link from the paired PC page, never an arbitrary WebView URL. */
    public static String fromAppLink(String input) {
        try {
            if(input == null || input.length() > 512) return null;
            URI uri = new URI(input);
            if(!"batto-touch".equals(uri.getScheme()) || !"connect".equals(uri.getHost()) || uri.getPort() != -1 || uri.getRawUserInfo() != null || uri.getRawFragment() != null) return null;
            if(uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath())) return null;
            String query=uri.getRawQuery(), address=null, pin=null;
            if(query == null) return null;
            for(String field:query.split("&",-1)) {
                int equals=field.indexOf('='); if(equals < 1) return null;
                String key=field.substring(0,equals), value=URLDecoder.decode(field.substring(equals+1),"UTF-8");
                if("url".equals(key) && address==null) address=normalize(value);
                else if("pin".equals(key) && pin==null && value.matches("[0-9]{6}")) pin=value;
                else return null;
                if("url".equals(key) && address==null) return null;
            }
            return address==null?null:address+(pin==null?"":"#pin="+pin);
        } catch(Exception invalid) { return null; }
    }
}
