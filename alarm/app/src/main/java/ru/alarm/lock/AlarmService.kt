package ru.alarm.lock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.IBinder

/**
 * Работает в фоне, пока сигнализация включена. При включении экрана
 * запускает сигнал и показывает красное окно с паролем поверх экрана блокировки.
 */
class AlarmService : Service() {

    private val sound by lazy { AlarmSound(this) }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_ON) onScreenOn()
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannels()
        // Обязательный постоянный значок «работает в фоне».
        startForeground(NOTIF_SERVICE, serviceNotification())
        val filter = IntentFilter(Intent.ACTION_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenReceiver, filter)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_UNLOCK) {
            // Пароль введён: сигнал выключается, сигнализацию нужно включить заново в приложении.
            setAlarmEnabled(this, false)
            sound.stop()
            getSystemService(NotificationManager::class.java).cancel(NOTIF_ALARM)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!isAlarmEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun onScreenOn() {
        if (!isAlarmEnabled(this)) return
        sound.start()
        showLockWindow()
    }

    private fun showLockWindow() {
        val lockIntent = Intent(this, LockActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pending = PendingIntent.getActivity(
            this, 0, lockIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // Полноэкранное уведомление разрешает показать окно поверх экрана блокировки.
        val notification = Notification.Builder(this, CHANNEL_ALARM)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("СИГНАЛИЗАЦИЯ")
            .setContentText("Введите пароль, чтобы отключить")
            .setCategory(Notification.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(pending)
            .setFullScreenIntent(pending, true)
            .build()
        getSystemService(NotificationManager::class.java).notify(NOTIF_ALARM, notification)
        // На версиях, где разрешён прямой запуск, окно появляется сразу.
        runCatching { startActivity(lockIntent) }
    }

    private fun serviceNotification(): Notification =
        Notification.Builder(this, CHANNEL_SERVICE)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Сигнализация включена")
            .setContentText("Ожидание включения экрана")
            .setOngoing(true)
            .build()

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, "Работа сигнализации", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALARM, "Тревога", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null) // звук проигрывается самим приложением
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        )
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(screenReceiver) }
        sound.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_UNLOCK = "ru.alarm.lock.UNLOCK"
        private const val NOTIF_SERVICE = 1
        private const val NOTIF_ALARM = 2
        private const val CHANNEL_SERVICE = "service"
        private const val CHANNEL_ALARM = "alarm"
    }
}
