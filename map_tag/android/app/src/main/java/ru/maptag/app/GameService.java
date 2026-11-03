package ru.maptag.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Пока идёт раунд: служба на переднем плане с уведомлением, частичная блокировка сна
 * и GPS напрямую из LocationManager — игра работает с телефоном в кармане и выключенным экраном.
 * Каждая позиция передаётся в WebView через {@link #listener}.
 */
public class GameService extends Service implements LocationListener {
    public interface Listener { void onLocation(Location l); }
    public static volatile Listener listener;

    private static final String CHANNEL = "game";
    private static final int ID = 1910;
    private PowerManager.WakeLock lock;
    private LocationManager lm;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent i, int flags, int startId) {
        String title = i != null && i.getStringExtra("title") != null ? i.getStringExtra("title") : "Map Tag";
        Notification n = notification(title);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(ID, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        if (lock == null) {
            lock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "maptag:game");
            lock.setReferenceCounted(false);
            lock.acquire(3 * 60 * 60 * 1000L);
        }
        if (lm == null) {
            lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            try {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000, 0, this, Looper.getMainLooper());
            } catch (SecurityException | IllegalArgumentException ignored) { }
        }
        return START_NOT_STICKY;
    }

    @Override public void onLocationChanged(Location l) { Listener x = listener; if (x != null) x.onLocation(l); }
    @Override public void onStatusChanged(String p, int s, Bundle b) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }

    @Override
    public void onDestroy() {
        if (lm != null) try { lm.removeUpdates(this); } catch (Exception ignored) { }
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }

    private Notification notification(String title) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Игра", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText("Игра идёт — GPS работает в фоне")
                .setOngoing(true).setContentIntent(open).build();
    }

    public static void start(Context c, String title) {
        Intent i = new Intent(c, GameService.class).putExtra("title", title);
        try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i); } catch (Exception ignored) { }
    }

    public static void stop(Context c) { try { c.stopService(new Intent(c, GameService.class)); } catch (Exception ignored) { } }
}
