package ru.alarm.lock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** После перезагрузки телефона возвращает работу сигнализации, если она была включена. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && isAlarmEnabled(context)) {
            runCatching {
                context.startForegroundService(Intent(context, AlarmService::class.java))
            }
        }
    }
}
