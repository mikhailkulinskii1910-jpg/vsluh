package ru.vsluh.esp32flasher;

import android.graphics.Bitmap;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Отправка кадров на плату. Если плата понимает полосы (прошивка 1.7+), шлёт только
 * изменившиеся строки — при наборе текста, мигающем курсоре или часах это в разы меньше.
 * Плата отвечает, когда готова к следующему кадру, поэтому кадры идут ровно с её скоростью.
 */
class FrameSender {
    private final String host, mode;
    private int[] last;           // пиксели последнего отправленного кадра
    private int lastW, lastH;
    volatile boolean bands = false;     // плата понимает полосы
    volatile boolean needFull = true;   // следующий кадр — целиком
    int lastBytes = 0;
    boolean lastWasBand = false;

    FrameSender(String host, String mode) { this.host = host; this.mode = mode; }

    /** Отправить кадр; false — ничего не изменилось и отправлять нечего. */
    synchronized boolean send(Bitmap bmp, int quality) throws Exception {
        int w = bmp.getWidth(), h = bmp.getHeight();
        int[] cur = new int[w * h];
        bmp.getPixels(cur, 0, w, 0, 0, w, h);
        boolean full = needFull || !bands || last == null || lastW != w || lastH != h;
        int y0 = 0, y1 = h;
        if (!full) {
            y0 = -1; y1 = -1;
            for (int y = 0; y < h; y++) {
                int o = y * w;
                for (int x = 0; x < w; x++) {
                    if (((cur[o + x] ^ last[o + x]) & 0xF8FCF8) != 0) {  // разница заметная в RGB565
                        if (y0 < 0) y0 = y;
                        y1 = y + 1;
                        break;
                    }
                }
            }
            if (y0 < 0) return false;
            y0 = y0 / 16 * 16;                      // по границам блоков JPEG
            y1 = Math.min(h, (y1 + 15) / 16 * 16);
            if (y1 - y0 > h * 7 / 10) full = true;  // изменилось почти всё — дешевле целиком
        }
        Bitmap part = full ? bmp : Bitmap.createBitmap(bmp, 0, y0, w, y1 - y0);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        part.compress(Bitmap.CompressFormat.JPEG, quality, bo);
        if (part != bmp) part.recycle();
        post(bo.toByteArray(), full ? -1 : y0);
        last = cur; lastW = w; lastH = h;
        needFull = false;
        lastBytes = bo.size();
        lastWasBand = !full;
        return true;
    }

    private void post(byte[] jpg, int y) throws Exception {
        String boundary = "----esp32" + System.nanoTime();
        String q = "/__show?mode=" + mode + (y >= 0 ? "&y=" + y : "");
        HttpURLConnection c = MainActivity.openBoard(MainActivity.sBoardNet, new URL("http://" + host + q));
        c.setConnectTimeout(4000);
        c.setReadTimeout(10000);
        c.setDoOutput(true);
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        byte[] head = ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"f\"; filename=\"screen.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").getBytes("UTF-8");
        byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes("UTF-8");
        c.setFixedLengthStreamingMode(head.length + jpg.length + tail.length);
        try {
            OutputStream out = c.getOutputStream();
            out.write(head);
            out.write(jpg);
            out.write(tail);
            out.close();
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            if (in != null) in.close();
            if (code != 200) throw new Exception("HTTP " + code);
        } catch (Exception e) {
            needFull = true;  // кадр мог не дойти — следующий целиком
            throw e;
        } finally {
            c.disconnect();
        }
    }

    /** Ответ платы на опрос /__events: понимает ли полосы, просит ли кадр целиком. */
    void onEvents(org.json.JSONObject resp) {
        if (resp.optInt("bands", 0) == 1) bands = true;
        if (resp.optBoolean("full", false)) needFull = true;
    }
}
