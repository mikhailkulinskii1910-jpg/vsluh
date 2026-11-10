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
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.wifi.WifiNetworkSpecifier;
import android.provider.OpenableColumns;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;
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
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver;
import com.hoho.android.usbserial.driver.Ch34xSerialDriver;
import com.hoho.android.usbserial.driver.Cp21xxSerialDriver;
import com.hoho.android.usbserial.driver.FtdiSerialDriver;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
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
    private static final int REQ_UPLOAD = 2;
    private static final int REQ_SAVE = 3;
    private static final int REQ_CAPTURE = 4;
    private String controlHost = "192.168.4.1";
    private static final String BOARD_SSID = "ESP32-HTML";
    private static final String BOARD_PASS = "12345678";

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

    // Сеть платы: все запросы приложения идут через неё, даже если в ней нет интернета
    private ConnectivityManager cm;
    private volatile Network boardNet;
    private ConnectivityManager.NetworkCallback wifiCallback;
    private String uploadUrl;

    // Файл из конвертера: страница передаёт его кусками, дальше он уходит на плату или в память телефона
    private File staged;
    private OutputStream stagedOut;

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
        cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        sCm = cm;

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
        s.setMediaPlaybackRequiresUserGesture(false);

        web.addJavascriptInterface(new Bridge(), "AndroidSerial");
        web.addJavascriptInterface(new NetBridge(), "AndroidNet");
        web.addJavascriptInterface(new AppBridge(), "AndroidApp");
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
                boolean video = false;
                String[] acc = params.getAcceptTypes();
                if (acc != null) for (String a : acc) if (a != null && a.startsWith("video")) video = true;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(video ? "video/*" : "*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(i, video ? "Видео для конвертации" : "Файл прошивки .bin"), REQ_FILE);
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
        f.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        registerReceiver(usbReceiver, f);
        takeAttached(getIntent());

        web.loadUrl("https://" + HOST + "/index.html?theme=" + (isNight() ? "dark" : "light"));
    }

    @Override
    protected void onDestroy() {
        closePort();
        releaseBoardNet();
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
        if (req == REQ_CAPTURE) {  // разрешение на показ экрана → служба управления телефоном
            if (res == RESULT_OK && data != null) {
                Intent svc = new Intent(this, ControlService.class);
                svc.putExtra("code", res);
                svc.putExtra("data", data);
                svc.putExtra("host", controlHost);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
            }
            ui.postDelayed(new Runnable() { public void run() { js("window.__onControl && __onControl()"); } }, 800);
            return;
        }
        if (req == REQ_SAVE) {
            final Uri dst = res == RESULT_OK && data != null ? data.getData() : null;
            if (dst == null) { js("__androidNet.onSaved(false,'')"); return; }
            new Thread(new Runnable() { public void run() { copyStaged(dst); } }, "save").start();
            return;
        }
        if (req == REQ_UPLOAD) {
            final ArrayList<Uri> list = new ArrayList<Uri>();
            if (res == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) list.add(clip.getItemAt(i).getUri());
                else if (data.getData() != null) list.add(data.getData());
            }
            if (list.isEmpty()) { js("__androidNet.onUpload(0,0,'',0,0,'cancel','')"); return; }
            final String url = uploadUrl;
            new Thread(new Runnable() { public void run() { uploadAll(url, list); } }, "upload").start();
            return;
        }
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

    /** Драйвер для устройства: сначала по таблице библиотеки, затем по производителю (новые модели чипов). */
    private UsbSerialDriver driverFor(UsbDevice d) {
        UsbSerialDriver drv = UsbSerialProber.getDefaultProber().probeDevice(d);
        if (drv != null) return drv;
        int vid = d.getVendorId();
        try {
            if (CdcAcmSerialDriver.probe(d)) return new CdcAcmSerialDriver(d);  // CH343, CH9102, встроенный USB ESP32-S3
            if (vid == 0x1A86) return new Ch34xSerialDriver(d);                  // другие CH34x
            if (vid == 0x10C4) return new Cp21xxSerialDriver(d);
            if (vid == 0x0403) return new FtdiSerialDriver(d);
            if (vid == 0x303A) return new CdcAcmSerialDriver(d);
        } catch (Exception ignored) { }
        return null;
    }

    private UsbSerialDriver findDriver(UsbDevice only) {
        for (UsbDevice d : usb.getDeviceList().values()) {
            if (only != null && d.getDeviceId() != only.getDeviceId()) continue;
            UsbSerialDriver drv = driverFor(d);
            if (drv != null) return drv;
        }
        return null;
    }

    private static String chipName(int vid, int pid) {
        if (vid == 0x1A86) {
            if (pid == 0x7523 || pid == 0x7522) return "CH340";
            if (pid == 0x5523) return "CH341";
            if (pid == 0x55D3) return "CH343";
            if (pid == 0x55D4) return "CH9102";
            return "WCH";
        }
        if (vid == 0x10C4) return "CP210x";
        if (vid == 0x0403) return "FTDI";
        if (vid == 0x303A) return "ESP32 USB";
        if (vid == 0x067B) return "PL2303";
        return "";
    }

    private String describe(UsbDevice d) {
        String n = chipName(d.getVendorId(), d.getProductId());
        if (n.isEmpty() && d.getProductName() != null) n = d.getProductName();
        return (n.isEmpty() ? "устройство" : n) + String.format(" (%04x:%04x)", d.getVendorId(), d.getProductId());
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
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                if (d != null) js("__androidSerial.onAttach(" + q(describe(d)) + "," + (driverFor(d) != null) + ")");
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                if (d != null && device != null && d.getDeviceId() == device.getDeviceId()) {
                    closePort();
                    device = null;
                    js("__androidSerial.onDisconnect()");
                }
            }
        }
    };

    /** Приложение открыто подключением платы: Android уже дал доступ к ней. */
    private void takeAttached(Intent intent) {
        if (intent == null || !UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(intent.getAction())) return;
        final UsbDevice d = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
        if (d == null) return;
        if (usb.hasPermission(d) && driverFor(d) != null) device = d;
        ui.postDelayed(new Runnable() {
            public void run() { js("__androidSerial.onAttach(" + q(describe(d)) + "," + (driverFor(d) != null) + ")"); }
        }, 1500);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        takeAttached(intent);
    }

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

    // ---------- Сеть платы ----------

    /** Сеть платы — для окна «Экран на плату». */
    static volatile Network sBoardNet;

    private void bindTo(Network n) {
        boardNet = n;
        sBoardNet = n;
        if (Build.VERSION.SDK_INT >= 23) cm.bindProcessToNetwork(n);
        else ConnectivityManager.setProcessDefaultNetwork(n);
    }

    private void releaseBoardNet() {
        if (wifiCallback != null) {
            try { cm.unregisterNetworkCallback(wifiCallback); } catch (Exception ignored) { }
            wifiCallback = null;
        }
        boardNet = null;
        sBoardNet = null;
        try {
            if (Build.VERSION.SDK_INT >= 23) cm.bindProcessToNetwork(null);
            else ConnectivityManager.setProcessDefaultNetwork(null);
        } catch (Exception ignored) { }
    }

    /** Любая текущая сеть Wi-Fi (например, домашняя, если плата подключена к ней). */
    private Network findWifi() {
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities c = cm.getNetworkCapabilities(n);
            if (c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return n;
        }
        return null;
    }

    static final String VPN_HINT = "На телефоне включён VPN, и он не пускает приложение в сеть платы. "
            + "Выключите VPN или добавьте «ESP32 Flasher» в исключения VPN (раздельное туннелирование / «приложения без VPN»), затем нажмите «Проверить».";

    static boolean vpnOn(ConnectivityManager cm) {
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities c = cm.getNetworkCapabilities(n);
                if (c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    /**
     * Соединение с платой через её сеть. Если VPN запрещает привязку к сети платы (EPERM),
     * пробуем обычное соединение: многие VPN пропускают локальные адреса 192.168.x.x мимо себя.
     */
    static ConnectivityManager sCm;

    /** Адрес точки доступа платы (192.168.4.x); остальные — плата в домашней сети. */
    static boolean isApHost(String h) { return h != null && h.startsWith("192.168.4."); }

    static HttpURLConnection openBoard(Network n, URL u) throws IOException {
        // плата в домашней сети: обычный путь системы (VPN с обходом локальной сети его пропускает)
        if (!isApHost(u.getHost())) n = null;
        if (n != null) {
            boolean canBind = true;
            try { Socket s = new Socket(); n.bindSocket(s); s.close(); } catch (IOException e) { canBind = false; }
            if (canBind) return (HttpURLConnection) n.openConnection(u);
        }
        return (HttpURLConnection) u.openConnection();
    }

    /** Текст ошибки связи с платой; при включённом VPN — с префиксом "VPN:" и подсказкой. */
    static String boardError(ConnectivityManager cm, Exception e) {
        String m = String.valueOf(e.getMessage());
        return vpnOn(cm) ? "VPN: " + VPN_HINT + " (" + m + ")" : m;
    }

    private HttpURLConnection open(String url) throws IOException {
        URL u = new URL(url);
        HttpURLConnection c = openBoard(boardNet, u);
        c.setConnectTimeout(5000);
        c.setReadTimeout(20000);
        c.setUseCaches(false);
        return c;
    }

    private void scanSubnet() {
        String prefix = null;
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities c = cm.getNetworkCapabilities(n);
                if (c == null || !c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
                android.net.LinkProperties lp = cm.getLinkProperties(n);
                if (lp == null) continue;
                for (android.net.LinkAddress la : lp.getLinkAddresses()) {
                    java.net.InetAddress a = la.getAddress();
                    if (a instanceof java.net.Inet4Address) {
                        String ip = a.getHostAddress();
                        if (isApHost(ip)) continue;  // сеть самой платы не сканируем
                        prefix = ip.substring(0, ip.lastIndexOf('.') + 1);
                    }
                }
            }
        } catch (Exception ignored) { }
        if (prefix == null) { js("__androidNet.onScan('[]'," + q("Телефон не подключён к домашнему Wi-Fi.") + ")"); return; }
        final String pre = prefix;
        final JSONArray found = new JSONArray();
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(48);
        for (int i = 1; i < 255; i++) {
            final String ip = pre + i;
            pool.execute(new Runnable() {
                public void run() {
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL("http://" + ip + "/__api/info").openConnection();
                        c.setConnectTimeout(900);
                        c.setReadTimeout(1500);
                        if (c.getResponseCode() == 200) {
                            JSONObject o = new JSONObject(readAll(c.getInputStream()));
                            if (o.optBoolean("ok")) {
                                JSONObject r = new JSONObject();
                                r.put("ip", ip);
                                r.put("app", o.optString("app"));
                                synchronized (found) { found.put(r); }
                            }
                        }
                    } catch (Exception ignored) {
                    } finally { if (c != null) c.disconnect(); }
                }
            });
        }
        pool.shutdown();
        try { pool.awaitTermination(20, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        String err = found.length() == 0 && vpnOn(cm) ? VPN_HINT : "";
        js("__androidNet.onScan(" + q(found.toString()) + "," + q(err) + ")");
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) > 0) bo.write(b, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    private String[] nameAndSize(Uri u) {
        if ("file".equals(u.getScheme())) {
            File f = new File(u.getPath());
            return new String[] { f.getName(), String.valueOf(f.length()) };
        }
        String name = "file.bin";
        long size = -1;
        Cursor c = null;
        try {
            c = getContentResolver().query(u, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME), si = c.getColumnIndex(OpenableColumns.SIZE);
                if (ni >= 0 && c.getString(ni) != null) name = c.getString(ni);
                if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return new String[] { name, String.valueOf(size) };
    }

    /** Отправка файлов на карту: multipart/form-data, по одному файлу на запрос. */
    private void uploadAll(String url, ArrayList<Uri> list) {
        int count = list.size();
        for (int i = 0; i < count; i++) {
            Uri u = list.get(i);
            String[] ns = nameAndSize(u);
            String name = ns[0];
            long total = Long.parseLong(ns[1]);
            String boundary = "----esp32flasher" + System.nanoTime();
            HttpURLConnection c = null;
            try {
                c = open(url);
                c.setDoOutput(true);
                c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                byte[] head = ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"f\"; filename=\"" +
                        name.replace("\"", "_") + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes("UTF-8");
                byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes("UTF-8");
                if (total >= 0) c.setFixedLengthStreamingMode(head.length + total + tail.length);
                else c.setChunkedStreamingMode(8192);
                OutputStream out = c.getOutputStream();
                out.write(head);
                InputStream in = getContentResolver().openInputStream(u);
                byte[] buf = new byte[8192];
                long sent = 0, lastReport = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    sent += n;
                    if (sent - lastReport > 32768) {
                        lastReport = sent;
                        js("__androidNet.onUpload(" + i + "," + count + "," + q(name) + "," + sent + "," + total + ",'progress','')");
                    }
                }
                in.close();
                out.write(tail);
                out.close();
                int code = c.getResponseCode();
                readAll(code < 400 ? c.getInputStream() : c.getErrorStream());
                if (code >= 400) throw new IOException("ответ платы " + code);
                js("__androidNet.onUpload(" + i + "," + count + "," + q(name) + "," + sent + "," + total + ",'file','')");
            } catch (Exception e) {
                js("__androidNet.onUpload(" + i + "," + count + "," + q(name) + ",0,0,'error'," + q(String.valueOf(e.getMessage())) + ")");
                return;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        js("__androidNet.onUpload(" + count + "," + count + ",'',0,0,'done','')");
    }

    private void copyStaged(Uri dst) {
        try {
            InputStream in = new FileInputStream(staged);
            OutputStream out = getContentResolver().openOutputStream(dst);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            out.close();
            js("__androidNet.onSaved(true,'')");
        } catch (Exception e) {
            js("__androidNet.onSaved(false," + q(String.valueOf(e.getMessage())) + ")");
        }
    }

    /** Методы раздела «Файлы на карте» и конвертера. */
    private class NetBridge {
        @JavascriptInterface
        public String state() {
            return boardNet != null ? "bound" : (findWifi() != null ? "wifi" : "none");
        }

        /** Подключиться к точке доступа платы: на Android 10+ — системным диалогом. */
        @JavascriptInterface
        public void connectBoard() {
            ui.post(new Runnable() {
                public void run() {
                    releaseBoardNet();
                    if (Build.VERSION.SDK_INT >= 29) {
                        WifiNetworkSpecifier spec = new WifiNetworkSpecifier.Builder()
                                .setSsid(BOARD_SSID).setWpa2Passphrase(BOARD_PASS).build();
                        NetworkRequest req = new NetworkRequest.Builder()
                                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                                .setNetworkSpecifier(spec).build();
                        wifiCallback = new ConnectivityManager.NetworkCallback() {
                            @Override public void onAvailable(Network n) { bindTo(n); js("__androidNet.onWifi(true,'')"); }
                            @Override public void onUnavailable() { js("__androidNet.onWifi(false," + q("Не удалось подключиться к сети " + BOARD_SSID + ". Включите на плате режим Wi-Fi (значок справа вверху).") + ")"); }
                            @Override public void onLost(Network n) { if (n.equals(boardNet)) { boardNet = null; js("__androidNet.onWifi(false," + q("Связь с платой по Wi-Fi пропала.") + ")"); } }
                        };
                        try {
                            cm.requestNetwork(req, wifiCallback);
                        } catch (Exception e) {
                            js("__androidNet.onWifi(false," + q("Android не разрешил подключение: " + e.getMessage()) + ")");
                        }
                    } else {
                        Network n = findWifi();
                        if (n != null) { bindTo(n); js("__androidNet.onWifi(true,'')"); }
                        else js("__androidNet.onWifi(false," + q("Подключитесь в настройках Wi-Fi к сети " + BOARD_SSID + " (пароль " + BOARD_PASS + ") и нажмите «Проверить».") + ")");
                    }
                }
            });
        }

        /** Использовать уже подключённый Wi-Fi (плата в домашней сети или сеть выбрана вручную). */
        @JavascriptInterface
        public boolean useCurrentWifi() {
            if (boardNet != null) return true;
            Network n = findWifi();
            if (n == null) return false;
            bindTo(n);
            return true;
        }

        @JavascriptInterface
        public void disconnect() {
            ui.post(new Runnable() { public void run() { releaseBoardNet(); } });
        }

        /** HTTP-запрос к плате; ответ придёт в __androidNet.onResponse(id, код, текст). */
        @JavascriptInterface
        public void request(final int id, final String method, final String url) {
            new Thread(new Runnable() {
                public void run() {
                    HttpURLConnection c = null;
                    try {
                        c = open(url);
                        c.setRequestMethod(method);
                        if ("POST".equals(method)) { c.setDoOutput(true); c.setFixedLengthStreamingMode(0); c.getOutputStream().close(); }
                        int code = c.getResponseCode();
                        String body = readAll(code < 400 ? c.getInputStream() : c.getErrorStream());
                        js("__androidNet.onResponse(" + id + "," + code + "," + q(body) + ")");
                    } catch (Exception e) {
                        js("__androidNet.onResponse(" + id + ",0," + q(boardError(cm, e)) + ")");
                    } finally {
                        if (c != null) c.disconnect();
                    }
                }
            }, "http").start();
        }

        @JavascriptInterface
        public void pickAndUpload(String url) {
            uploadUrl = url;
            ui.post(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    try {
                        startActivityForResult(Intent.createChooser(i, "Файлы для SD-карты"), REQ_UPLOAD);
                    } catch (Exception e) {
                        js("__androidNet.onUpload(0,0,'',0,0,'error'," + q("Нет приложения для выбора файлов") + ")");
                    }
                }
            });
        }

        /** Начать приём файла из конвертера. Пустая строка — успех, иначе текст ошибки. */
        @JavascriptInterface
        public String stageBegin(String name) {
            try {
                if (stagedOut != null) { try { stagedOut.close(); } catch (IOException ignored) { } }
                File dir = new File(getCacheDir(), "convert");
                File[] old = dir.listFiles();
                if (old != null) for (File o : old) o.delete();
                dir.mkdirs();
                staged = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                stagedOut = new FileOutputStream(staged);
                return "";
            } catch (Exception e) {
                staged = null;
                stagedOut = null;
                return String.valueOf(e.getMessage());
            }
        }

        @JavascriptInterface
        public String stageChunk(String b64) {
            try {
                stagedOut.write(Base64.decode(b64, Base64.DEFAULT));
                return "";
            } catch (Exception e) {
                return String.valueOf(e.getMessage());
            }
        }

        @JavascriptInterface
        public String stageEnd() {
            try {
                stagedOut.close();
                stagedOut = null;
                return "";
            } catch (Exception e) {
                return String.valueOf(e.getMessage());
            }
        }

        /** Отправить принятый файл на карту платы; ход — в __androidNet.onUpload. */
        @JavascriptInterface
        public void uploadStaged(final String url) {
            if (staged == null || !staged.exists()) { js("__androidNet.onUpload(0,1,'',0,0,'error'," + q("Файл не подготовлен") + ")"); return; }
            final ArrayList<Uri> list = new ArrayList<Uri>();
            list.add(Uri.fromFile(staged));
            new Thread(new Runnable() { public void run() { uploadAll(url, list); } }, "upload").start();
        }

        /** Сохранить принятый файл в память телефона через системный диалог. */
        @JavascriptInterface
        public void saveStaged() {
            ui.post(new Runnable() {
                public void run() {
                    if (staged == null || !staged.exists()) { js("__androidNet.onSaved(false," + q("Файл не подготовлен") + ")"); return; }
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("video/x-msvideo");
                    i.putExtra(Intent.EXTRA_TITLE, staged.getName());
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Exception e) {
                        js("__androidNet.onSaved(false," + q("Нет приложения для сохранения файлов") + ")");
                    }
                }
            });
        }

        /** Найти плату в домашней сети: опрос всех адресов x.y.z.1–254 подсети Wi-Fi телефона. */
        @JavascriptInterface
        public void scan() {
            releaseBoardNet();  // сеть платы больше не нужна: ищем через обычный Wi-Fi
            new Thread(new Runnable() { public void run() { scanSubnet(); } }, "scan").start();
        }

        /** Окно «Экран на плату»: браузер, из которого страницы показываются на плате. */
        @JavascriptInterface
        public void cast(final String host) {
            ui.post(new Runnable() {
                public void run() {
                    if (boardNet == null) { Network n = findWifi(); if (n != null) sBoardNet = n; }
                    Intent i = new Intent(MainActivity.this, CastActivity.class);
                    i.putExtra("host", host);
                    startActivity(i);
                }
            });
        }

        /** Открыть страницу с платы во встроенном браузере (JavaScript работает). */
        @JavascriptInterface
        public void preview(final String url) {
            ui.post(new Runnable() {
                public void run() {
                    Intent i = new Intent(MainActivity.this, PreviewActivity.class);
                    i.setData(Uri.parse(url));
                    startActivity(i);
                }
            });
        }
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
                    o.put("name", describe(d));
                    o.put("driver", driverFor(d) != null);
                    o.put("permission", usb.hasPermission(d));
                    arr.put(o);
                }
            } catch (Exception ignored) { }
            return arr.toString();
        }

        @JavascriptInterface
        public void request() {
            UsbSerialDriver drv = findDriver(null);
            if (drv == null) {
                String msg;
                if (usb.getDeviceList().isEmpty()) {
                    msg = "Телефон не видит плату по USB. Проверьте: 1) кабель передаёт данные (многие кабели только заряжают — попробуйте другой); "
                        + "2) включено «OTG-соединение» в настройках телефона (у Xiaomi, Redmi, POCO, Realme, OPPO, Vivo, Honor оно выключается само через 10 минут); "
                        + "3) переходник OTG вставлен в телефон, а плата — в переходник. Когда плата подключится, приложение предложит открыть её само.";
                } else {
                    StringBuilder sb = new StringBuilder("USB-устройство подключено, но драйвер к нему не подошёл: ");
                    for (UsbDevice d : usb.getDeviceList().values()) sb.append(describe(d)).append("; ");
                    sb.append("Нужна плата ESP32 с чипом CH340, CH343, CH9102, CP210x или FTDI. Напишите эти цифры разработчику.");
                    msg = sb.toString();
                }
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

    /** Сведения о приложении, экран и внешние ссылки. */
    class AppBridge {
        @JavascriptInterface
        public int versionCode() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception e) { return 0; }
        }

        @JavascriptInterface
        public String versionName() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }

        /** Не гасить экран, пока идёт прошивка. */
        @JavascriptInterface
        public void keepScreenOn(final boolean on) {
            ui.post(new Runnable() {
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /** Состояние управления телефоном. */
        @JavascriptInterface
        public String controlState() {
            try {
                JSONObject o = new JSONObject();
                o.put("running", ControlService.sInst != null);
                o.put("a11y", ControlA11y.sInst != null);
                o.put("gestures", Build.VERSION.SDK_INT >= 24);
                o.put("state", ControlService.sState);
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        /** Начать управление: Android спросит разрешение на показ экрана. */
        @JavascriptInterface
        public void startControl(final String host) {
            ui.post(new Runnable() {
                public void run() {
                    controlHost = host;
                    try {
                        android.media.projection.MediaProjectionManager mpm = (android.media.projection.MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE);
                    } catch (Exception e) { js("window.__onControl && __onControl(" + q("Android не дал показать экран: " + e.getMessage()) + ")"); }
                }
            });
        }

        @JavascriptInterface
        public void stopControl() {
            ui.post(new Runnable() {
                public void run() {
                    Intent i = new Intent(MainActivity.this, ControlService.class);
                    i.setAction(ControlService.ACTION_STOP);
                    try { startService(i); } catch (Exception ignored) { }
                }
            });
        }

        /** Спецвозможности: включить «ESP32 Flasher: нажатия с платы». */
        @JavascriptInterface
        public void openA11ySettings() {
            ui.post(new Runnable() {
                public void run() { try { startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); } catch (Exception ignored) { } }
            });
        }

        /** Сведения о приложении (там «Разрешить ограниченные настройки» на Android 13+). */
        @JavascriptInterface
        public void openAppSettings() {
            ui.post(new Runnable() {
                public void run() {
                    try { startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
                }
            });
        }

        /** Настройки VPN — чтобы выключить его или добавить приложение в исключения. */
        @JavascriptInterface
        public void openVpnSettings() {
            ui.post(new Runnable() {
                public void run() {
                    try { startActivity(new Intent(android.provider.Settings.ACTION_VPN_SETTINGS)); }
                    catch (Exception e) { try { startActivity(new Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS)); } catch (Exception ignored) { } }
                }
            });
        }

        /** Открыть ссылку в браузере (например, новую версию приложения). */
        @JavascriptInterface
        public void openUrl(final String url) {
            if (url == null || !url.startsWith("https://")) return;
            ui.post(new Runnable() {
                public void run() {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
                }
            });
        }
    }
}
