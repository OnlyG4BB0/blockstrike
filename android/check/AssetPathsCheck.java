import app.blockstrike.gioco.AssetPaths;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Controllo della build: ogni file del gioco che va nell'APK deve avere un tipo noto e i percorsi
 * degli indirizzi devono portare al file giusto. Un tipo sbagliato su un .js = schermo nero.
 * Uso: java AssetPathsCheck <cartella www>
 */
public final class AssetPathsCheck {
  public static void main(String[] args) throws IOException {
    Path root = Paths.get(args[0]);
    int problems = 0;
    List<Path> files;
    try (Stream<Path> walk = Files.walk(root)) {
      files = walk.filter(Files::isRegularFile).collect(Collectors.toList());
    }
    for (Path file : files) {
      String url = "/" + root.relativize(file).toString().replace('\\', '/');
      String asset = AssetPaths.assetFor(url);
      String mime = asset == null ? null : AssetPaths.mimeFor(asset);
      if (asset == null || !asset.equals("www" + url) || mime == null) {
        System.out.println("NO  " + url + " -> " + asset + " (" + mime + ")");
        problems++;
      }
    }
    problems += expect(AssetPaths.assetFor("/"), "www/index.html");
    problems += expect(AssetPaths.assetFor("/assets/../../secret"), null);
    problems += expect(AssetPaths.mimeFor("www/assets/main.js"), "text/javascript");
    problems += expect(AssetPaths.encodingFor("image/png"), null);
    System.out.println(files.size() + " file del gioco controllati, problemi: " + problems);
    if (problems > 0) System.exit(1);
  }

  private static int expect(String actual, String expected) {
    boolean ok = expected == null ? actual == null : expected.equals(actual);
    if (!ok) System.out.println("NO  atteso " + expected + ", ottenuto " + actual);
    return ok ? 0 : 1;
  }
}
