package app.blockstrike.gioco;

import java.util.Locale;

/**
 * Dai percorsi degli indirizzi interni dell'app (https://appassets.androidplatform.net/...) ai file
 * del gioco dentro l'APK (assets/www/...) e al loro tipo. Niente Android qui: si controlla in Java
 * puro durante la build, contro i file veri (android/check/AssetPathsCheck.java).
 */
public final class AssetPaths {
  /** Indirizzo da cui l'app carica il gioco: https, così il browser lo tratta come un sito sicuro. */
  public static final String HOST = "appassets.androidplatform.net";
  public static final String START_URL = "https://" + HOST + "/index.html";

  private AssetPaths() {}

  /** File dentro assets/ per un percorso dell'indirizzo; null se il percorso non è accettabile. */
  public static String assetFor(String urlPath) {
    if (urlPath == null || urlPath.isEmpty() || urlPath.equals("/")) return "www/index.html";
    if (!urlPath.startsWith("/") || urlPath.contains("..") || urlPath.contains("\\")) return null;
    String path = urlPath.endsWith("/") ? urlPath + "index.html" : urlPath;
    return "www" + path;
  }

  /** Tipo del file dall'estensione; null se sconosciuto (la build si ferma se ne trova uno). */
  public static String mimeFor(String path) {
    String p = path.toLowerCase(Locale.ROOT);
    if (p.endsWith(".html")) return "text/html";
    if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
    if (p.endsWith(".css")) return "text/css";
    if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
    if (p.endsWith(".webmanifest")) return "application/manifest+json";
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".svg")) return "image/svg+xml";
    if (p.endsWith(".ico")) return "image/x-icon";
    if (p.endsWith(".wav")) return "audio/wav";
    if (p.endsWith(".woff2")) return "font/woff2";
    return null;
  }

  /** I testi hanno bisogno della codifica, le immagini no. */
  public static String encodingFor(String mime) {
    return mime != null && (mime.startsWith("text/") || mime.contains("json") || mime.contains("svg")) ? "utf-8" : null;
  }
}
