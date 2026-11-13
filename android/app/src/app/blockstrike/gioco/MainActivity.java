package app.blockstrike.gioco;

import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;

/**
 * BLOCKSTRIKE per Android: il gioco compilato sta dentro l'APK (assets/www) e lo mostra una WebView
 * a schermo intero e in orizzontale. I file si servono da un indirizzo https interno (vedi
 * AssetPaths): i moduli JavaScript non si caricano da file:// e controller e schermo intero
 * vogliono un'origine sicura. Online ci si collega al server scritto nel menu del gioco.
 */
public class MainActivity extends Activity {
  private WebView web;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    web = new WebView(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    // La pagina è https, il server di casa può essere ws:// (rete locale): lo si permette.
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    web.setWebViewClient(new AssetClient(getAssets()));
    web.setWebChromeClient(new WebChromeClient());

    // Niente sotto il foro della fotocamera: la pagina si sposta dei margini sicuri.
    web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
      @Override
      public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 28) {
          DisplayCutout cutout = insets.getDisplayCutout();
          if (cutout != null) {
            view.setPadding(cutout.getSafeInsetLeft(), cutout.getSafeInsetTop(), cutout.getSafeInsetRight(), cutout.getSafeInsetBottom());
          }
        }
        return insets;
      }
    });

    setContentView(web);
    if (state != null) web.restoreState(state);
    else web.loadUrl(AssetPaths.START_URL);
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    web.saveState(state);
  }

  @Override
  protected void onResume() {
    super.onResume();
    web.onResume();
    hideSystemBars();
  }

  @Override
  protected void onPause() {
    web.onPause();
    super.onPause();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemBars();
  }

  /**
   * I tasti del controller vanno al gioco (Gamepad API) e basta: senza questo Android trasforma B in
   * «Indietro», che metterebbe in pausa a ogni accovacciata.
   */
  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (KeyEvent.isGamepadButton(event.getKeyCode())) {
      super.dispatchKeyEvent(event);
      return true;
    }
    return super.dispatchKeyEvent(event);
  }

  /** Indietro: in partita mette in pausa (il gioco risponde true), nel menu manda l'app in secondo piano. */
  @Override
  @SuppressWarnings("deprecation")
  public void onBackPressed() {
    web.evaluateJavascript("window.blockstrikeBack ? window.blockstrikeBack() : false", new ValueCallback<String>() {
      @Override
      public void onReceiveValue(String value) {
        if (!"true".equals(value)) moveTaskToBack(true);
      }
    });
  }

  @SuppressWarnings("deprecation")
  private void hideSystemBars() {
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController controller = getWindow().getInsetsController();
      if (controller != null) {
        controller.hide(WindowInsets.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
              | View.SYSTEM_UI_FLAG_FULLSCREEN
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
  }

  /** Serve i file del gioco dall'APK; il resto (server di gioco) va in rete come sempre. */
  private final class AssetClient extends WebViewClient {
    private final AssetManager assets;

    AssetClient(AssetManager assets) {
      this.assets = assets;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      Uri url = request.getUrl();
      if (!AssetPaths.HOST.equals(url.getHost())) return null;
      String asset = AssetPaths.assetFor(url.getPath());
      String mime = asset == null ? null : AssetPaths.mimeFor(asset);
      if (asset == null || mime == null) return notFound();
      try {
        InputStream stream = assets.open(asset);
        WebResourceResponse response = new WebResourceResponse(mime, AssetPaths.encodingFor(mime), stream);
        HashMap<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        response.setResponseHeaders(headers);
        return response;
      } catch (IOException missing) {
        return notFound();
      }
    }

    /** I link verso altri siti si aprono nel browser, non dentro il gioco. */
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri url = request.getUrl();
      if (AssetPaths.HOST.equals(url.getHost())) return false;
      try {
        startActivity(new Intent(Intent.ACTION_VIEW, url));
      } catch (RuntimeException ignored) {
        // Nessuna app per aprirlo: si resta nel gioco.
      }
      return true;
    }

    private WebResourceResponse notFound() {
      return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(),
          new ByteArrayInputStream(new byte[0]));
    }
  }
}
