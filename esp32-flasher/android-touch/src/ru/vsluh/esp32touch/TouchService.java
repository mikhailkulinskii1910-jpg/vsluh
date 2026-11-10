package ru.vsluh.esp32touch;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Path;
import android.view.accessibility.AccessibilityEvent;

/**
 * Спецвозможность «ESP32 Flasher: нажатия»: выполняет жесты, которые присылает приложение
 * ESP32 Flasher в режиме «Управление телефоном». Принимает команды только от приложения,
 * у которого есть разрешение ru.vsluh.esp32flasher.permission.CONTROL (уровень signature:
 * его получает лишь приложение, подписанное тем же ключом).
 */
public class TouchService extends AccessibilityService {
    static final String ACTION = "ru.vsluh.esp32touch.GESTURE";
    static final String PERM = "ru.vsluh.esp32flasher.permission.CONTROL";

    private final BroadcastReceiver rx = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { perform(i); }
    };

    @Override
    protected void onServiceConnected() {
        registerReceiver(rx, new IntentFilter(ACTION), PERM, null);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) { }
    @Override public void onInterrupt() { }

    @Override
    public void onDestroy() {
        try { unregisterReceiver(rx); } catch (Exception ignored) { }
        super.onDestroy();
    }

    private void perform(Intent i) {
        String t = i.getStringExtra("t");
        if (t == null) return;
        float x0 = i.getFloatExtra("x0", 0), y0 = i.getFloatExtra("y0", 0);
        float x1 = i.getFloatExtra("x1", 0), y1 = i.getFloatExtra("y1", 0);
        switch (t) {
            case "tap": {
                Path p = new Path();
                p.moveTo(x0, y0);
                gesture(new GestureDescription.StrokeDescription(p, 0, 60));
                break;
            }
            case "drag": {
                Path p = new Path();
                p.moveTo(x0, y0);
                p.lineTo(x1, y1);
                gesture(new GestureDescription.StrokeDescription(p, 0, Math.max(60, i.getLongExtra("ms", 300))));
                break;
            }
            case "pinch": {  // x0, y0 — центр, x1 — размах
                boolean in = i.getBooleanExtra("in", true);
                float a = in ? x1 * 0.15f : x1, b = in ? x1 : x1 * 0.15f;
                Path p1 = new Path(), p2 = new Path();
                p1.moveTo(x0 - a, y0); p1.lineTo(x0 - b, y0);
                p2.moveTo(x0 + a, y0); p2.lineTo(x0 + b, y0);
                gesture(new GestureDescription.StrokeDescription(p1, 0, 350), new GestureDescription.StrokeDescription(p2, 0, 350));
                break;
            }
            case "key": {
                String k = i.getStringExtra("k");
                if ("back".equals(k)) performGlobalAction(GLOBAL_ACTION_BACK);
                else if ("home".equals(k)) performGlobalAction(GLOBAL_ACTION_HOME);
                else if ("recents".equals(k)) performGlobalAction(GLOBAL_ACTION_RECENTS);
                break;
            }
        }
    }

    private void gesture(GestureDescription.StrokeDescription... strokes) {
        GestureDescription.Builder b = new GestureDescription.Builder();
        for (GestureDescription.StrokeDescription s : strokes) b.addStroke(s);
        dispatchGesture(b.build(), null, null);
    }
}
