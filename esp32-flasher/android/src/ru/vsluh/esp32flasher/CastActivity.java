package ru.vsluh.esp32flasher;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * «Экран на плату»: обычный браузер, из которого видимую часть страницы можно отправить
 * на экран платы (прошивка «Школьный набор», Wi-Fi включён в её настройках).
 * Сам браузер ходит в интернет как обычно; на плату по её Wi-Fi уходят только снимки.
 * Обратно плата присылает касания (GET /__events): браузер нажимает в той же точке страницы
 * и отправляет новый снимок, так что страницей можно управлять прямо с экрана платы.
 */
public class CastActivity extends Activity {
    private WebView web;
    private EditText url;
    private TextView status;
    private CheckBox follow;
    private String host;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean sending = false, pending = false;
    private int frames = 0;
    private final Runnable followSend = new Runnable() { public void run() { send(); } };
    // какую часть страницы показывает последний снимок (для пересчёта касаний с платы)
    private int capW = 0, capH = 0, capSX = 0, capSY = 0;
    private volatile int pollGen = 0;    // номер опроса: при уходе с экрана старый поток сам завершится
    private volatile boolean remoteOk = false;
    private long lastRemote = 0;
    private int remoteTaps = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        host = getIntent().getStringExtra("host");
        if (host == null || host.isEmpty()) host = "192.168.4.1";
        int dark = Color.rgb(20, 22, 28), ink = Color.rgb(236, 236, 241);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(dark);

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(8), dp(6), dp(8), dp(6));
        url = new EditText(this);
        url.setSingleLine(true);
        url.setHint("Адрес сайта или поиск");
        url.setTextColor(ink);
        url.setHintTextColor(Color.rgb(140, 140, 160));
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setImeOptions(EditorInfo.IME_ACTION_GO);
        url.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            public boolean onEditorAction(TextView v, int id, KeyEvent e) { go(); return true; }
        });
        top.addView(url, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        Button open = new Button(this);
        open.setText("Открыть");
        open.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { go(); } });
        top.addView(open);
        root.addView(top);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView v, String u) {
                url.setText(u);
                getPreferences(MODE_PRIVATE).edit().putString("last", u).apply();
                if (follow.isChecked() || remoteRecent()) scheduleFollow(900);
            }
        });
        if (Build.VERSION.SDK_INT >= 23) {
            web.setOnScrollChangeListener(new View.OnScrollChangeListener() {
                public void onScrollChange(View v, int x, int y, int ox, int oy) { if (follow.isChecked() || remoteRecent()) scheduleFollow(600); }
            });
        }
        root.addView(web, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(10), dp(6), dp(10), dp(8));
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        Button back = new Button(this);
        back.setText("‹");
        back.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { if (web.canGoBack()) web.goBack(); } });
        row.addView(back);
        Button show = new Button(this);
        show.setText("Показать на плате");
        show.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { send(); } });
        row.addView(show, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        follow = new CheckBox(this);
        follow.setText("Следить");
        follow.setTextColor(ink);
        row.addView(follow);
        bottom.addView(row);
        status = new TextView(this);
        status.setTextColor(Color.rgb(160, 160, 180));
        status.setTextSize(13);
        status.setText("Плата: " + host + ". Найдите страницу и нажмите «Показать на плате». «Следить» — обновлять плату при прокрутке. Нажатия на экране платы тоже работают.");
        bottom.addView(status);
        root.addView(bottom);
        setContentView(root);

        String last = getPreferences(MODE_PRIVATE).getString("last", "");
        if (!last.isEmpty()) { url.setText(last); web.loadUrl(last); }
        else url.requestFocus();
    }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density + 0.5f); }

    private void go() {
        String t = url.getText().toString().trim();
        if (t.isEmpty()) return;
        String u;
        if (t.startsWith("http://") || t.startsWith("https://")) u = t;
        else if (!t.contains(" ") && t.contains(".")) u = "https://" + t;
        else {
            try { u = "https://www.google.com/search?q=" + URLEncoder.encode(t, "UTF-8"); } catch (Exception e) { u = "https://www.google.com/"; }
        }
        web.loadUrl(u);
        InputMethodManager im = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (im != null) im.hideSoftInputFromWindow(url.getWindowToken(), 0);
        web.requestFocus();
    }

    private void scheduleFollow(int ms) {
        ui.removeCallbacks(followSend);
        ui.postDelayed(followSend, ms);
    }

    // Снимок видимой части страницы: 480 px в ширину, JPEG
    private byte[] capture() {
        int w = web.getWidth(), h = web.getHeight();
        if (w <= 0 || h <= 0) return null;
        Bitmap full = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565);
        Canvas c = new Canvas(full);
        capW = w; capH = h; capSX = web.getScrollX(); capSY = web.getScrollY();
        c.translate(-capSX, -capSY);
        web.draw(c);
        int tw = 480, th = Math.max(1, Math.min(1440, h * tw / w));
        Bitmap small = Bitmap.createScaledBitmap(full, tw, th, true);
        full.recycle();
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.JPEG, 82, bo);
        small.recycle();
        return bo.toByteArray();
    }

    private void send() {
        if (sending) { pending = true; return; }
        final byte[] jpg;
        try { jpg = capture(); } catch (Throwable t) { status.setText("Не удалось снять страницу: " + t.getMessage()); return; }
        if (jpg == null) return;
        sending = true;
        status.setText("Отправляю на плату…");
        new Thread(new Runnable() {
            public void run() {
                String msg;
                try {
                    post(jpg);
                    frames++;
                    msg = "На плате: кадр " + frames + " (" + (jpg.length / 1024) + " КБ). " + (remoteOk
                        ? "Нажимайте прямо на экране платы; свайп за край снимка листает страницу, двойное касание — увеличение."
                        : "Двойное касание на плате — увеличение.");
                } catch (Exception e) {
                    ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                    msg = MainActivity.vpnOn(cm)
                        ? MainActivity.VPN_HINT + " (" + e.getMessage() + ")"
                        : "Плата не ответила (" + e.getMessage() + "). Проверьте, что на плате включён Wi-Fi (Настройки → «Wi-Fi: экран телефона»), а телефон подключён к ней.";
                }
                final String m = msg;
                ui.post(new Runnable() {
                    public void run() {
                        status.setText(m);
                        sending = false;
                        if (pending) { pending = false; scheduleFollow(200); }
                    }
                });
            }
        }, "cast").start();
    }

    private void post(byte[] jpg) throws Exception {
        String boundary = "----esp32cast" + System.currentTimeMillis();
        HttpURLConnection c = MainActivity.openBoard(MainActivity.sBoardNet, new URL("http://" + host + "/__show"));
        c.setConnectTimeout(5000);
        c.setReadTimeout(15000);
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
    private boolean remoteRecent() { return SystemClock.uptimeMillis() - lastRemote < 15000; }

    private HttpURLConnection boardConn(String path) throws Exception {
        HttpURLConnection c = MainActivity.openBoard(MainActivity.sBoardNet, new URL("http://" + host + path));
        c.setConnectTimeout(3000);
        c.setReadTimeout(4000);
        c.setUseCaches(false);
        return c;
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] b = new byte[2048];
        int k;
        while ((k = in.read(b)) > 0) bo.write(b, 0, k);
        in.close();
        return bo.toString("UTF-8");
    }

    // Опрос платы: раз в 0,3 с забираем накопившиеся касания
    private void startPolling() {
        final int gen = ++pollGen;
        new Thread(new Runnable() {
            public void run() {
                int fails = 0;
                while (gen == pollGen) {
                    long wait = 300;
                    try {
                        HttpURLConnection c = boardConn("/__events");
                        int code = c.getResponseCode();
                        if (code == 404) { c.disconnect(); break; }  // старая прошивка: касаний не присылает
                        String body = readAll(code < 400 ? c.getInputStream() : c.getErrorStream());
                        c.disconnect();
                        fails = 0;
                        remoteOk = true;
                        final JSONArray ev = new JSONObject(body).optJSONArray("ev");
                        if (ev != null && ev.length() > 0) ui.post(new Runnable() { public void run() { handleEvents(ev); } });
                    } catch (Exception e) {
                        fails++;
                        wait = Math.min(4000, 600L * fails);  // платы не видно — спрашиваем реже
                    }
                    try { Thread.sleep(wait); } catch (InterruptedException ie) { break; }
                }
            }
        }, "board-events").start();
    }

    private void handleEvents(JSONArray ev) {
        for (int i = 0; i < ev.length(); i++) {
            JSONObject o = ev.optJSONObject(i);
            if (o == null) continue;
            String t = o.optString("t");
            lastRemote = SystemClock.uptimeMillis();
            if ("tap".equals(t)) remoteTap((float) o.optDouble("x", -1), (float) o.optDouble("y", -1));
            else if ("scroll".equals(t)) remoteScroll(o.optInt("d", 1));
        }
    }

    // Касание в долях снимка → точка в окне браузера; если страница с тех пор прокрутилась, учитываем сдвиг
    private void remoteTap(float fx, float fy) {
        if (capW <= 0 || fx < 0 || fy < 0 || fx > 1 || fy > 1) return;
        final float x = fx * capW + capSX - web.getScrollX();
        final float y = fy * capH + capSY - web.getScrollY();
        if (x < 0 || y < 0 || x >= web.getWidth() || y >= web.getHeight()) return;
        final long t0 = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(t0, t0, MotionEvent.ACTION_DOWN, x, y, 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        web.dispatchTouchEvent(down);
        down.recycle();
        ui.postDelayed(new Runnable() {
            public void run() {
                MotionEvent up = MotionEvent.obtain(t0, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0);
                up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                web.dispatchTouchEvent(up);
                up.recycle();
            }
        }, 70);
        remoteTaps++;
        status.setText("Нажатие с платы (" + remoteTaps + ") — обновляю снимок…");
        scheduleFollow(800);  // страница успеет отреагировать; при переходе снимок придёт ещё раз после загрузки
    }

    // Листание: на 85 % высоты окна вниз или вверх
    private void remoteScroll(int dir) {
        web.evaluateJavascript("window.scrollBy(0," + (dir > 0 ? "" : "-") + "Math.round(window.innerHeight*0.85))", null);
        status.setText(dir > 0 ? "С платы: листаю вниз…" : "С платы: листаю вверх…");
        scheduleFollow(500);
    }

    // Пока открыт браузер, процесс не привязан к сети платы — сайты грузятся через интернет
    @Override
    protected void onResume() {
        super.onResume();
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        try { if (Build.VERSION.SDK_INT >= 23) cm.bindProcessToNetwork(null); } catch (Exception ignored) { }
        startPolling();
    }

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(followSend);
        pollGen++;
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        try { if (Build.VERSION.SDK_INT >= 23 && MainActivity.sBoardNet != null) cm.bindProcessToNetwork(MainActivity.sBoardNet); } catch (Exception ignored) { }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
