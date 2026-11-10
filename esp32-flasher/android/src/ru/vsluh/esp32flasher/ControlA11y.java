package ru.vsluh.esp32flasher;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;

/**
 * Спецвозможность «ESP32 Flasher: нажатия с платы»: повторяет на телефоне касания,
 * свайпы и кнопки, сделанные на экране платы в режиме «Управление телефоном».
 * Ничего не читает с экрана и ничего не делает, пока управление не запущено.
 */
public class ControlA11y extends AccessibilityService {
    static volatile ControlA11y sInst;

    @Override protected void onServiceConnected() { sInst = this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent e) { }
    @Override public void onInterrupt() { }
    @Override public void onDestroy() { if (sInst == this) sInst = null; super.onDestroy(); }

    boolean tap(float x, float y) {
        if (Build.VERSION.SDK_INT < 24) return false;
        Path p = new Path();
        p.moveTo(x, y);
        return dispatchGesture(new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(p, 0, 60)).build(), null, null);
    }

    boolean drag(float x0, float y0, float x1, float y1, long ms) {
        if (Build.VERSION.SDK_INT < 24) return false;
        Path p = new Path();
        p.moveTo(x0, y0);
        p.lineTo(x1, y1);
        return dispatchGesture(new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(p, 0, Math.max(60, ms))).build(), null, null);
    }

    /** Щипок двумя пальцами в центре экрана: in — приблизить, иначе отдалить. */
    boolean pinch(float cx, float cy, float span, boolean in) {
        if (Build.VERSION.SDK_INT < 24) return false;
        float a = in ? span * 0.15f : span, b = in ? span : span * 0.15f;
        Path p1 = new Path(), p2 = new Path();
        p1.moveTo(cx - a, cy); p1.lineTo(cx - b, cy);
        p2.moveTo(cx + a, cy); p2.lineTo(cx + b, cy);
        return dispatchGesture(new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(p1, 0, 350))
                .addStroke(new GestureDescription.StrokeDescription(p2, 0, 350)).build(), null, null);
    }

    boolean key(String k) {
        if ("back".equals(k)) return performGlobalAction(GLOBAL_ACTION_BACK);
        if ("home".equals(k)) return performGlobalAction(GLOBAL_ACTION_HOME);
        if ("recents".equals(k)) return performGlobalAction(GLOBAL_ACTION_RECENTS);
        return false;
    }
}
