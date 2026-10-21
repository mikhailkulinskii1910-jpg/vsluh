package ru.irbis.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Пока идёт сценарий, макрос или авто-сканер, приложение держит «службу на переднем плане»
 * с уведомлением и не даёт процессору уснуть (частичная блокировка сна): команды и паузы
 * идут вовремя, даже если экран выключен кнопкой питания. Кнопка «Стоп» в уведомлении — прервать.
 */
class RunService : Service() {
    private var lock: PowerManager.WakeLock? = null

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, flags: Int, startId: Int): Int {
        if (i?.action == ACTION_STOP) { onStop?.invoke(); return START_NOT_STICKY }
        val title = i?.getStringExtra(EXTRA_TITLE) ?: "krisa37™"
        val n = notification(title)
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) else startForeground(ID, n)
        } catch (e: Exception) { stopSelf(); return START_NOT_STICKY }     // система не дала — работаем как раньше, пока экран включён
        if (lock == null) lock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "krisa37:run").apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        lock?.let { if (it.isHeld) it.release() }; lock = null
        super.onDestroy()
    }

    private fun notification(title: String): Notification {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Выполнение сценариев", NotificationManager.IMPORTANCE_LOW))
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
        val stop = PendingIntent.getService(this, 1, Intent(this, RunService::class.java).setAction(ACTION_STOP), flags)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
        return b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title)
            .setContentText("работает и при выключенном экране")
            .setOngoing(true).setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "■ Стоп", stop).build())
            .build()
    }

    companion object {
        private const val CHANNEL = "run"
        private const val ID = 37
        private const val ACTION_STOP = "ru.irbis.remote.STOP"
        private const val EXTRA_TITLE = "title"
        /** Что сделать по кнопке «Стоп» в уведомлении (задаёт MainActivity). */
        @Volatile var onStop: (() -> Unit)? = null

        fun start(c: Context, title: String) {
            val i = Intent(c, RunService::class.java).putExtra(EXTRA_TITLE, title)
            runCatching { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i) }
        }

        fun stop(c: Context) { runCatching { c.stopService(Intent(c, RunService::class.java)) } }
    }
}
