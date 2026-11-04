package ru.maptag.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.media.AudioManager;
import android.provider.Settings;
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
    // Загрузчик отрезает префикс пути: /assets/www/index.html → файл assets/www/index.html
    static final String BASE = "https://appassets.androidplatform.net/assets/www/";
    private static final String START = BASE + "index.html";

    static WebViewAssetLoader loader(android.content.Context c) {
        return new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(c)).build();
    }
    private static final int REQ_LOC = 1, REQ_CAM = 2, REQ_PERM = 3;
    private boolean gameRunning = false;
    private volatile float pressureHpa = 0;
    private final android.hardware.SensorEventListener baro = new android.hardware.SensorEventListener() {
        @Override public void onSensorChanged(android.hardware.SensorEvent e) { pressureHpa = e.values[0]; }
        @Override public void onAccuracyChanged(android.hardware.Sensor s, int a) { }
    };

    private WebView web;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private PermissionRequest camRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        final WebViewAssetLoader loader = loader(this);

        web = new WebView(this);
        web.setBackgroundColor(0xFF10141F);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " MapTagApp/1.0");

        // после обновления APK сбрасываем кэш WebView, иначе он отдаёт старые файлы приложения
        try {
            long upd = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            android.content.SharedPreferences pr = getSharedPreferences("mt", MODE_PRIVATE);
            if (pr.getLong("upd", 0) != upd) { web.clearCache(true); pr.edit().putLong("upd", upd).apply(); }
        } catch (Exception ignored) { }
        web.addJavascriptInterface(new Bridge(), "MapTagNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                WebResourceResponse r = loader.shouldInterceptRequest(req.getUrl());
                if (r != null) {   // файлы приложения не кэшировать
                    java.util.Map<String, String> h = new java.util.HashMap<>();
                    if (r.getResponseHeaders() != null) h.putAll(r.getResponseHeaders());
                    h.put("Cache-Control", "no-cache, no-store");
                    r.setResponseHeaders(h);
                }
                return r;
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
                    // камера (QR) и/или микрофон (рация): спрашиваем то, что страница запросила
                    java.util.List<String> need = new java.util.ArrayList<>();
                    for (String r : req.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !hasPerm(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !hasPerm(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                    }
                    if (need.isEmpty()) { req.grant(req.getResources()); return; }
                    camRequest = req;
                    requestPermissions(need.toArray(new String[0]), REQ_CAM);
                });
            }
        });
        setContentView(web);
        try {
            android.hardware.SensorManager sm = (android.hardware.SensorManager) getSystemService(SENSOR_SERVICE);
            android.hardware.Sensor ps = sm == null ? null : sm.getDefaultSensor(android.hardware.Sensor.TYPE_PRESSURE);
            if (ps != null) sm.registerListener(baro, ps, android.hardware.SensorManager.SENSOR_DELAY_NORMAL);
        } catch (Exception ignored) { }
        GameService.listener = (Location l) -> runOnUiThread(() -> web.evaluateJavascript(
                "window.__nativeLoc&&__nativeLoc(" + l.getLatitude() + "," + l.getLongitude() + "," + l.getAccuracy() + "," + (l.hasSpeed() ? l.getSpeed() : -1) + ")", null));

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
        web.evaluateJavascript("window.__permChanged&&__permChanged()", null);
        if (code == REQ_CAM && camRequest != null) {
            boolean all = res.length > 0; for (int g : res) all &= g == PackageManager.PERMISSION_GRANTED;
            if (all) camRequest.grant(camRequest.getResources()); else camRequest.deny();
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
    protected void onPause() { super.onPause(); if (!gameRunning) web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); web.evaluateJavascript("window.__permChanged&&__permChanged()", null); }

    @Override
    protected void onDestroy() { GameService.stop(this); GameService.listener = null; super.onDestroy(); }

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

        /** Состояние разрешений для онбординга: JSON. */
        @JavascriptInterface
        public String permState() {
            LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            boolean on = lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
            boolean fine = hasPerm(Manifest.permission.ACCESS_FINE_LOCATION);
            boolean coarse = hasPerm(Manifest.permission.ACCESS_COARSE_LOCATION);
            boolean bg = Build.VERSION.SDK_INT < 29 ? fine : hasPerm(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
            boolean notif = Build.VERSION.SDK_INT < 33 || hasPerm("android.permission.POST_NOTIFICATIONS");
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            float vol = am == null ? 1f : am.getStreamVolume(AudioManager.STREAM_MUSIC) / (float) Math.max(1, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
            return "{\"on\":" + on + ",\"fine\":" + fine + ",\"coarse\":" + coarse + ",\"bg\":" + bg + ",\"notif\":" + notif + ",\"vol\":" + vol + "}";
        }

        /** kind: fine | bg | notif | gps | app | volume */
        @JavascriptInterface
        public void requestPerm(String kind) {
            runOnUiThread(() -> {
                try {
                    switch (kind) {
                        case "fine": requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM); break;
                        case "bg":
                            if (!hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM);
                            else if (Build.VERSION.SDK_INT >= 29) requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_PERM);
                            break;
                        case "notif": if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_PERM); break;
                        case "gps": startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)); break;
                        case "app": startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); break;
                        case "volume": {
                            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                            am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.max(am.getStreamVolume(AudioManager.STREAM_MUSIC), (int) Math.ceil(max * 0.7)), AudioManager.FLAG_SHOW_UI);
                            web.evaluateJavascript("window.__permChanged&&__permChanged()", null);
                            break;
                        }
                    }
                } catch (Exception ignored) { }
            });
        }

        /** Начало/конец раунда: служба с GPS в фоне. */
        @JavascriptInterface
        public void gameStart(String title) { runOnUiThread(() -> { gameRunning = true; if (hasPerm(Manifest.permission.ACCESS_FINE_LOCATION) || hasPerm(Manifest.permission.ACCESS_COARSE_LOCATION)) GameService.start(MainActivity.this, title); }); }

        @JavascriptInterface
        public void gameStop() { runOnUiThread(() -> { gameRunning = false; GameService.stop(MainActivity.this); }); }

        /** Давление, гПа (барометр) — для подсчёта этажей; 0, если датчика нет. */
        @JavascriptInterface
        public float pressure() { return pressureHpa; }

        /** Заряд батареи, %. */
        @JavascriptInterface
        public int battery() {
            android.os.BatteryManager bm = (android.os.BatteryManager) getSystemService(BATTERY_SERVICE);
            return bm == null ? -1 : bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
        }

        @JavascriptInterface
        public void vibrate(long ms) {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.vibrate(ms);
        }
    }
}
