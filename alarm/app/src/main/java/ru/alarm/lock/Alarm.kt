package ru.alarm.lock

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager

/** Пароль, которым отключается сигнализация. */
const val ALARM_PASSWORD = "88006553535"

private const val PREFS = "alarm"
private const val KEY_ENABLED = "enabled"

/** Включена ли сигнализация (переключается кнопкой в приложении). */
fun isAlarmEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

fun setAlarmEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
}

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

/** Громкий зацикленный сигнал на максимальной громкости будильника. */
class AlarmSound(private val context: Context) {
    private var player: MediaPlayer? = null

    fun start() {
        if (player?.isPlaying == true) return
        runCatching {
            val audio = context.getSystemService(AudioManager::class.java)
            audio.setStreamVolume(
                AudioManager.STREAM_ALARM,
                audio.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                0
            )
            val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(context, uri)
                isLooping = true
                setVolume(1f, 1f)
                prepare()
                start()
            }
        }
    }

    fun stop() {
        runCatching {
            player?.stop()
            player?.release()
        }
        player = null
    }
}
