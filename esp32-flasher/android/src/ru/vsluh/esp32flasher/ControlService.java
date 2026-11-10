package ru.vsluh.esp32flasher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;

/**
 * «Управление телефоном»: весь экран телефона уходит на экран платы (снимки JPEG по Wi-Fi),
 * а касания, свайпы и кнопки с платы выполняет отдельное дополнение «ESP32 Flasher: нажатия»
 * (спецвозможность в своём приложении: основному приложению она не нужна).
 * Работает, пока висит уведомление; остановить — из уведомления, приложения или кнопкой «Закрыть» на плате.
 */
public class ControlService extends Service {
    static final String ACTION_STOP = "ru.vsluh.esp32flasher.STOP_CONTROL";
    static final String CHANNEL = "control";
    static volatile ControlService sInst;
    static volatile String sState = "";
    static final String TOUCH_PKG = "ru.vsluh.esp32touch";
    static final String TOUCH_ACTION = "ru.vsluh.esp32touch.GESTURE";
    static final String CONTROL_PERM = "ru.vsluh.esp32flasher.permission.CONTROL";

    static boolean touchInstalled(Context c) {
        try { c.getPackageManager().getPackageInfo(TOUCH_PKG, 0); return true; } catch (Exception e) { return false; }
    }
    static boolean touchEnabled(Context c) {
        String s = android.provider.Settings.Secure.getString(c.getContentResolver(), android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return s != null && s.contains(TOUCH_PKG + "/");
    }

    private MediaProjection proj;
    private VirtualDisplay vd;
    private ImageReader reader;
    private HandlerThread thread;
    private volatile boolean running = false;
    private String host = "192.168.4.1";
    private int fw, fh;                 // размер снимка
    private int frames = 0;
    private FrameSender sender;
    private volatile int boxW = 0, boxH = 0;   // какой кадр просит плата (ровно под её экран)
    private volatile boolean boxChanged = false;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (running) return START_NOT_STICKY;
        host = intent.getStringExtra("host");
        if (host == null || host.isEmpty()) host = "192.168.4.1";
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(1, n);
        try {
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            proj = mpm.getMediaProjection(intent.getIntExtra("code", 0), (Intent) intent.getParcelableExtra("data"));
        } catch (Exception e) { proj = null; }
        if (proj == null) { sState = "Android не дал показать экран."; stopSelf(); return START_NOT_STICKY; }
        sInst = this;
        running = true;
        thread = new HandlerThread("control-capture");
        thread.start();
        Handler h = new Handler(thread.getLooper());
        proj.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() { stopSelf(); }
        }, h);
        DisplayMetrics dm = realMetrics();
        int sw = Math.min(dm.widthPixels, dm.heightPixels), sh = Math.max(dm.widthPixels, dm.heightPixels);
        fw = 400;
        fh = Math.round(fw * (float) sh / sw) & ~1;
        reader = ImageReader.newInstance(fw, fh, PixelFormat.RGBA_8888, 2);
        vd = proj.createVirtualDisplay("esp32-board", fw, fh, Math.max(120, dm.densityDpi * fw / sw),
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, h);
        sState = "Экран телефона показывается на плате.";
        sender = new FrameSender(host, "ctl");
        new Thread(new Runnable() { public void run() { captureLoop(); } }, "control-send").start();
        new Thread(new Runnable() { public void run() { pollLoop(); } }, "control-events").start();
        return START_NOT_STICKY;
    }

    private DisplayMetrics realMetrics() {
        DisplayMetrics dm = new DisplayMetrics();
        ((WindowManager) getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm);
        return dm;
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        Intent stop = new Intent(this, ControlService.class).setAction(ACTION_STOP);
        int pf = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pStop = PendingIntent.getService(this, 1, stop, pf);
        PendingIntent pOpen = PendingIntent.getActivity(this, 2, new Intent(this, MainActivity.class), pf);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Управление с платы", NotificationManager.IMPORTANCE_LOW));
            b = new Notification.Builder(this, CHANNEL);
        } else b = new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_menu_view)
         .setContentTitle("Экран телефона на плате")
         .setContentText("Плата показывает экран и может нажимать. Нажмите «Остановить», чтобы выключить.")
         .setContentIntent(pOpen)
         .setOngoing(true)
         .addAction(new Notification.Action.Builder(null, "Остановить", pStop).build());
        return b.build();
    }

    // ---------- Снимки экрана → плата ----------
    private void captureLoop() {
        long lastSent = 0;
        int fails = 0;
        while (running) {
            Bitmap bmp = null;
            Image img = null;
            try {
                img = reader.acquireLatestImage();
                if (img != null) {
                    Image.Plane pl = img.getPlanes()[0];
                    ByteBuffer buf = pl.getBuffer();
                    int ps = pl.getPixelStride(), rs = pl.getRowStride();
                    Bitmap raw = Bitmap.createBitmap(rs / ps, fh, Bitmap.Config.ARGB_8888);
                    raw.copyPixelsFromBuffer(buf);
                    img.close(); img = null;
                    bmp = raw.getWidth() == fw ? raw : Bitmap.createBitmap(raw, 0, 0, fw, fh);
                    if (bmp != raw) raw.recycle();
                }
            } catch (Exception e) {
                if (img != null) try { img.close(); } catch (Exception ignored) { }
            }
            long now = SystemClock.uptimeMillis();
            if (bmp != null) {
                if (boxChanged) { boxChanged = false; sender.needFull = true; }
                if (now - lastSent > 5000) sender.needFull = true;  // раз в 5 с — целиком, для надёжности
                if (boxW > 0 && boxH > 0) {  // кадр точно под экран платы: меньше передавать и декодировать, а картинка чётче
                    float s = Math.min(1f, Math.min((float) boxW / fw, (float) boxH / fh));
                    int tw = Math.max(1, Math.round(fw * s)), th = Math.max(1, Math.round(fh * s));
                    if (tw != fw || th != fh) { Bitmap sm = Bitmap.createScaledBitmap(bmp, tw, th, true); bmp.recycle(); bmp = sm; }
                }
                try {
                    if (sender.send(bmp, 82)) {  // только изменившиеся строки; плата отвечает, когда готова к следующему
                        lastSent = SystemClock.uptimeMillis();
                        frames++;
                        sState = "Экран телефона на плате: кадр " + frames + " (" + (sender.lastBytes / 1024) + " КБ" + (sender.lastWasBand ? ", только изменения" : "") + ").";
                    }
                    fails = 0;
                } catch (Exception e) {
                    fails++;
                    sState = MainActivity.sCm != null && MainActivity.vpnOn(MainActivity.sCm)
                            ? MainActivity.VPN_HINT : "Плата не отвечает (" + e.getMessage() + ").";
                }
                bmp.recycle();
            }
            sleep(fails > 0 ? Math.min(3000, 500L * fails) : 40);
        }
    }

    private static long signature(Bitmap b) {  // грубая «подпись» картинки: изменилось ли что-то
        long h = 1125899906842597L;
        int w = b.getWidth(), ht = b.getHeight();
        for (int y = 4; y < ht; y += Math.max(1, ht / 64))
            for (int x = 2; x < w; x += Math.max(1, w / 32)) h = 31 * h + (b.getPixel(x, y) & 0xF0F0F0);
        return h;
    }

    private void post(byte[] jpg) throws Exception {
        String boundary = "----esp32ctl" + System.currentTimeMillis();
        HttpURLConnection c = MainActivity.openBoard(MainActivity.sBoardNet, new URL("http://" + host + "/__show?mode=ctl"));
        c.setConnectTimeout(4000);
        c.setReadTimeout(10000);
        c.setDoOutput(true);
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        byte[] head = ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"f\"; filename=\"screen.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").getBytes("UTF-8");
        byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes("UTF-8");
        c.setFixedLengthStreamingMode(head.length + jpg.length + tail.length);
        OutputStream out = c.getOutputStream();
        out.write(head);
        out.write(jpg);
        out.write(tail);
        out.close();
        int code = c.getResponseCode();
        InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
        if (in != null) in.close();
        c.disconnect();
        if (code != 200) throw new Exception("HTTP " + code);
    }

    // ---------- Касания с платы ----------
    private void pollLoop() {
        int fails = 0;
        while (running) {
            try {
                HttpURLConnection c = MainActivity.openBoard(MainActivity.sBoardNet, new URL("http://" + host + "/__events?mode=ctl"));
                c.setConnectTimeout(3000);
                c.setReadTimeout(4000);
                c.setUseCaches(false);
                int code = c.getResponseCode();
                InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] b = new byte[2048];
                int k;
                while (in != null && (k = in.read(b)) > 0) bo.write(b, 0, k);
                if (in != null) in.close();
                c.disconnect();
                if (code == 404) { sState = "На плате старая прошивка: обновите «Школьный набор» до 1.5."; sleep(3000); continue; }
                fails = 0;
                JSONObject resp = new JSONObject(bo.toString("UTF-8"));
                if (sender != null) sender.onEvents(resp);
                JSONArray box = resp.optJSONArray("box");
                if (box != null && box.length() == 2 && (box.optInt(0) != boxW || box.optInt(1) != boxH)) {
                    boxW = box.optInt(0); boxH = box.optInt(1); boxChanged = true;
                }
                JSONArray ev = resp.optJSONArray("ev");
                if (ev != null) for (int i = 0; i < ev.length(); i++) handle(ev.optJSONObject(i));
            } catch (Exception e) {
                fails++;
            }
            sleep(fails > 0 ? Math.min(3000, 400L * fails) : 200);
        }
    }

    // Доли снимка → точка экрана (с учётом полос, если телефон повёрнут)
    private float[] toScreen(double fx, double fy) {
        DisplayMetrics dm = realMetrics();
        float s = Math.min((float) fw / dm.widthPixels, (float) fh / dm.heightPixels);
        float ox = (fw - dm.widthPixels * s) / 2, oy = (fh - dm.heightPixels * s) / 2;
        float x = (float) ((fx * fw - ox) / s), y = (float) ((fy * fh - oy) / s);
        return new float[] { Math.max(0, Math.min(dm.widthPixels - 1, x)), Math.max(0, Math.min(dm.heightPixels - 1, y)) };
    }

    private void handle(JSONObject o) {
        if (o == null) return;
        String t = o.optString("t");
        if ("close".equals(t)) { stopSelf(); return; }
        if (!touchEnabled(this)) {
            sState = touchInstalled(this)
                ? "Нажатия с платы не работают: включите «ESP32 Flasher: нажатия» в спецвозможностях."
                : "Экран показывается, а для нажатий с платы установите дополнение ESP32-Touch.apk.";
            return;
        }
        Intent g = new Intent(TOUCH_ACTION).setPackage(TOUCH_PKG);
        if ("tap".equals(t)) {
            float[] p = toScreen(o.optDouble("x"), o.optDouble("y"));
            g.putExtra("t", "tap").putExtra("x0", p[0]).putExtra("y0", p[1]);
        } else if ("drag".equals(t)) {
            float[] p0 = toScreen(o.optDouble("x0"), o.optDouble("y0")), p1 = toScreen(o.optDouble("x1"), o.optDouble("y1"));
            g.putExtra("t", "drag").putExtra("x0", p0[0]).putExtra("y0", p0[1]).putExtra("x1", p1[0]).putExtra("y1", p1[1]).putExtra("ms", 300L);
        } else if ("key".equals(t)) {
            String k = o.optString("k");
            DisplayMetrics dm = realMetrics();
            if ("zin".equals(k) || "zout".equals(k))
                g.putExtra("t", "pinch").putExtra("x0", dm.widthPixels / 2f).putExtra("y0", dm.heightPixels / 2f).putExtra("x1", dm.widthPixels / 3f).putExtra("in", "zin".equals(k));
            else g.putExtra("t", "key").putExtra("k", k);
        } else if ("scroll".equals(t)) {
            DisplayMetrics dm = realMetrics();
            int d = o.optInt("d", 1);
            g.putExtra("t", "drag").putExtra("x0", dm.widthPixels / 2f).putExtra("y0", dm.heightPixels * (d > 0 ? 0.7f : 0.3f))
             .putExtra("x1", dm.widthPixels / 2f).putExtra("y1", dm.heightPixels * (d > 0 ? 0.3f : 0.7f)).putExtra("ms", 300L);
        } else return;
        sendBroadcast(g);  // дополнение принимает команды только от приложения с той же подписью
    }

    private static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) { } }

    @Override
    public void onDestroy() {
        running = false;
        if (sInst == this) sInst = null;
        sState = "Управление остановлено.";
        try { if (vd != null) vd.release(); } catch (Exception ignored) { }
        try { if (proj != null) proj.stop(); } catch (Exception ignored) { }
        try { if (reader != null) reader.close(); } catch (Exception ignored) { }
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }
}
