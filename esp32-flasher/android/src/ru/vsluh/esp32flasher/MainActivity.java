package ru.vsluh.esp32flasher;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;

/**
 * ESP32 Flasher для Android.
 *
 * Страница прошивальщика (esptool-js) работает в WebView и говорит с платой через мост
 * AndroidSerial: JS-обёртка в index.html изображает Web Serial API, а здесь данные идут
 * в USB-UART чип платы через драйверы usb-serial-for-android (CH340/CH343/CP210x/FTDI/CDC).
 */
public class MainActivity extends Activity {
    private static final String TAG = "ESP32Flasher";
    private static final String HOST = "app.esp32flasher";
    private static final String ACTION_PERMISSION = "ru.vsluh.esp32flasher.USB_PERMISSION";
    private static final int REQ_FILE = 1;

    private WebView web;
    private UsbManager usb;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final Object lock = new Object();
    private UsbDevice device;
    private UsbDeviceConnection connection;
    private UsbSerialPort port;
    private volatile boolean reading;
    private Thread reader;

    private ValueCallback<Uri[]> fileCallback;

    private static final HashMap<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("json", "application/json");
        MIME.put("css", "text/css");
        MIME.put("png", "image/png");
        MIME.put("svg", "image/svg+xml");
        MIME.put("bin", "application/octet-stream");
        MIME.put("ino", "text/plain");
    }

    // ---------- Жизненный цикл ----------

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        usb = (UsbManager) getSystemService(Context.USB_SERVICE);

        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 21) w.setStatusBarColor(isNight() ? 0xFF0E161D : 0xFFEDF1F3);
        if (Build.VERSION.SDK_INT >= 23 && !isNight()) {
            w.getDecorView().setSystemUiVisibility(0x2000 /* SYSTEM_UI_FLAG_LIGHT_STATUS_BAR */);
        }

        web = new WebView(this);
        web.setBackgroundColor(isNight() ? 0xFF0E161D : 0xFFEDF1F3);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);

        web.addJavascriptInterface(new Bridge(), "AndroidSerial");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return serveAsset(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) {
                    Log.w(TAG, "no browser", e);
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "Файл прошивки .bin"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "js: " + m.message());
                return true;
            }
        });

        IntentFilter f = new IntentFilter();
        f.addAction(ACTION_PERMISSION);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        registerReceiver(usbReceiver, f);

        web.loadUrl("https://" + HOST + "/index.html?theme=" + (isNight() ? "dark" : "light"));
    }

    @Override
    protected void onDestroy() {
        closePort();
        try { unregisterReceiver(usbReceiver); } catch (Exception ignored) { }
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        String t = isNight() ? "dark" : "light";
        web.evaluateJavascript("document.documentElement.dataset.theme='" + t + "'", null);
        web.setBackgroundColor(isNight() ? 0xFF0E161D : 0xFFEDF1F3);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_FILE || fileCallback == null) {
            super.onActivityResult(req, res, data);
            return;
        }
        Uri[] uris = null;
        if (res == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                uris = new Uri[clip.getItemCount()];
                for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[] { data.getData() };
            }
        }
        fileCallback.onReceiveValue(uris);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        String name = path.substring(1);
        if (name.contains("..")) return notFound();
        String ext = name.lastIndexOf('.') >= 0 ? name.substring(name.lastIndexOf('.') + 1) : "";
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open(name);
            boolean text = mime.startsWith("text/") || mime.equals("application/json");
            return new WebResourceResponse(mime, text ? "utf-8" : null, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    // ---------- Связь с JS ----------

    private void js(final String code) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(code, null);
            }
        });
    }

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    private String deviceInfo(UsbDevice d) {
        try {
            JSONObject o = new JSONObject();
            o.put("usbVendorId", d.getVendorId());
            o.put("usbProductId", d.getProductId());
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private UsbSerialDriver findDriver(UsbDevice only) {
        List<UsbSerialDriver> list = UsbSerialProber.getDefaultProber().findAllDrivers(usb);
        for (UsbSerialDriver d : list) {
            if (only == null || d.getDevice().getDeviceId() == only.getDeviceId()) return d;
        }
        return null;
    }

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            UsbDevice d = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (ACTION_PERMISSION.equals(action)) {
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (d != null && granted) {
                    device = d;
                    js("__androidSerial.onRequest(true," + q(deviceInfo(d)) + ")");
                } else {
                    js("__androidSerial.onRequest(false," + q("Нет разрешения на доступ к USB. Нажмите «Найти плату» и разрешите доступ.") + ")");
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                if (d != null && device != null && d.getDeviceId() == device.getDeviceId()) {
                    closePort();
                    device = null;
                    js("__androidSerial.onDisconnect()");
                }
            }
        }
    };

    private void closePort() {
        synchronized (lock) {
            reading = false;
            if (port != null) {
                try { port.close(); } catch (Exception ignored) { }
                port = null;
            }
            if (connection != null) {
                try { connection.close(); } catch (Exception ignored) { }
                connection = null;
            }
        }
        Thread r = reader;
        if (r != null && r != Thread.currentThread()) {
            try { r.join(500); } catch (InterruptedException ignored) { }
        }
        reader = null;
    }

    private void startReader(final UsbSerialPort p) {
        reading = true;
        reader = new Thread(new Runnable() {
            @Override
            public void run() {
                byte[] buf = new byte[8192];
                while (reading) {
                    try {
                        int n = p.read(buf, 50);
                        if (n > 0) {
                            js("__androidSerial.onData('" + Base64.encodeToString(buf, 0, n, Base64.NO_WRAP) + "')");
                        }
                    } catch (IOException e) {
                        if (reading) {
                            reading = false;
                            js("__androidSerial.onError(" + q("Связь с платой потеряна: " + e.getMessage()) + ")");
                        }
                        break;
                    }
                }
            }
        }, "usb-read");
        reader.start();
    }

    /** Методы, которые вызывает JS (выполняются в фоновом потоке WebView). */
    private class Bridge {
        @JavascriptInterface
        public String devices() {
            JSONArray arr = new JSONArray();
            try {
                for (UsbDevice d : usb.getDeviceList().values()) {
                    JSONObject o = new JSONObject();
                    o.put("usbVendorId", d.getVendorId());
                    o.put("usbProductId", d.getProductId());
                    o.put("name", d.getProductName() == null ? "" : d.getProductName());
                    arr.put(o);
                }
            } catch (Exception ignored) { }
            return arr.toString();
        }

        @JavascriptInterface
        public void request() {
            UsbSerialDriver drv = findDriver(null);
            if (drv == null) {
                String msg = usb.getDeviceList().isEmpty()
                        ? "Плата не найдена. Подключите её через OTG-переходник и проверьте, что кабель передаёт данные."
                        : "USB-устройство подключено, но это не USB-UART. Нужна плата ESP32 с чипом CH340, CH343, CP210x или FTDI.";
                js("__androidSerial.onRequest(false," + q(msg) + ")");
                return;
            }
            UsbDevice d = drv.getDevice();
            if (usb.hasPermission(d)) {
                device = d;
                js("__androidSerial.onRequest(true," + q(deviceInfo(d)) + ")");
                return;
            }
            Intent i = new Intent(ACTION_PERMISSION);
            i.setPackage(getPackageName());
            int flags = Build.VERSION.SDK_INT >= 31 ? 0x02000000 /* FLAG_MUTABLE */ : 0;
            PendingIntent pi = PendingIntent.getBroadcast(MainActivity.this, 0, i, flags);
            usb.requestPermission(d, pi);
        }

        @JavascriptInterface
        public String open(int baud) {
            closePort();
            synchronized (lock) {
                if (device == null) return "Плата не выбрана";
                UsbSerialDriver drv = findDriver(device);
                if (drv == null) return "Плата отключена";
                UsbDeviceConnection c = usb.openDevice(device);
                if (c == null) return "Нет доступа к USB-устройству";
                try {
                    UsbSerialPort p = drv.getPorts().get(0);
                    p.open(c);
                    p.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
                    connection = c;
                    port = p;
                    startReader(p);
                    return "";
                } catch (Exception e) {
                    try { c.close(); } catch (Exception ignored) { }
                    return "Не удалось открыть порт: " + e.getMessage();
                }
            }
        }

        @JavascriptInterface
        public String baud(int baud) {
            UsbSerialPort p = port;
            if (p == null) return "Порт закрыт";
            try {
                p.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
                return "";
            } catch (Exception e) {
                return "Не удалось сменить скорость: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public boolean write(String b64) {
            UsbSerialPort p = port;
            if (p == null) return false;
            try {
                p.write(Base64.decode(b64, Base64.NO_WRAP), 3000);
                return true;
            } catch (Exception e) {
                Log.w(TAG, "write", e);
                return false;
            }
        }

        @JavascriptInterface
        public void signals(int dtr, int rts) {
            UsbSerialPort p = port;
            if (p == null) return;
            try {
                if (dtr >= 0) p.setDTR(dtr == 1);
                if (rts >= 0) p.setRTS(rts == 1);
            } catch (Exception e) {
                Log.w(TAG, "signals", e);
            }
        }

        @JavascriptInterface
        public void close() {
            closePort();
        }
    }
}
