package ru.maptag.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/** Оболочка Map Tag: веб-версия из assets/www в WebView + GPS, камера и «Поделиться». */
public class MainActivity extends Activity {
    private static final String START = "https://appassets.androidplatform.net/www/index.html";
    private static final int REQ_LOC = 1, REQ_CAM = 2;

    private WebView web;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private PermissionRequest camRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/www/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(0xFF10141F);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " MapTagApp/1.0");

        web.addJavascriptInterface(new Bridge(), "MapTagNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)) { cb.invoke(origin, true, false); return; }
                geoCallback = cb; geoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
            }

            @Override
            public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> {
                    if (hasPerm(Manifest.permission.CAMERA)) { req.grant(req.getResources()); return; }
                    camRequest = req;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM);
                });
            }
        });
        setContentView(web);

        String url = START;
        Uri data = getIntent() != null ? getIntent().getData() : null;
        if (data != null && data.getFragment() != null) url += "#" + data.getFragment();
        if (state != null) web.restoreState(state); else web.loadUrl(url);
    }

    private boolean hasPerm(String p) {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        if (code == REQ_LOC && geoCallback != null) { geoCallback.invoke(geoOrigin, ok, false); geoCallback = null; }
        if (code == REQ_CAM && camRequest != null) {
            if (ok) camRequest.grant(camRequest.getResources()); else camRequest.deny();
            camRequest = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("document.dispatchEvent(new Event('backbutton-press'))", null);
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    /** Методы, доступные из JavaScript как window.MapTagNative. */
    class Bridge {
        @JavascriptInterface
        public void exit() { runOnUiThread(MainActivity.this::finish); }

        @JavascriptInterface
        public void share(String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Map Tag"));
            });
        }

        @JavascriptInterface
        public void vibrate(long ms) {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(ms);
        }
    }
}
