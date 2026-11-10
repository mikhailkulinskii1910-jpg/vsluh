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
import android.text.InputType;
import android.view.Gravity;
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
                if (follow.isChecked()) scheduleFollow(900);
            }
        });
        if (Build.VERSION.SDK_INT >= 23) {
            web.setOnScrollChangeListener(new View.OnScrollChangeListener() {
                public void onScrollChange(View v, int x, int y, int ox, int oy) { if (follow.isChecked()) scheduleFollow(600); }
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
        status.setText("Плата: " + host + ". Найдите страницу и нажмите «Показать на плате». «Следить» — обновлять плату при прокрутке.");
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
        c.translate(-web.getScrollX(), -web.getScrollY());
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
                    msg = "На плате: кадр " + frames + " (" + (jpg.length / 1024) + " КБ). Двойное касание на плате — увеличение.";
                } catch (Exception e) {
                    msg = "Плата не ответила (" + e.getMessage() + "). Проверьте, что на плате включён Wi-Fi (Настройки → «Wi-Fi: экран телефона»), а телефон подключён к ней.";
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
        URL u = new URL("http://" + host + "/__show");
        Network n = MainActivity.sBoardNet;
        HttpURLConnection c = (HttpURLConnection) (n != null ? n.openConnection(u) : u.openConnection());
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

    // Пока открыт браузер, процесс не привязан к сети платы — сайты грузятся через интернет
    @Override
    protected void onResume() {
        super.onResume();
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        try { if (Build.VERSION.SDK_INT >= 23) cm.bindProcessToNetwork(null); } catch (Exception ignored) { }
    }

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(followSend);
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        try { if (Build.VERSION.SDK_INT >= 23 && MainActivity.sBoardNet != null) cm.bindProcessToNetwork(MainActivity.sBoardNet); } catch (Exception ignored) { }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
