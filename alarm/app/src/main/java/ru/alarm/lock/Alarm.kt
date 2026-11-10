package ru.alarm.lock

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.view.KeyEvent
import kotlin.math.PI
import kotlin.math.sin

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

/**
 * Резкая сирена: частота плавно идёт вверх и вниз (600–1800 Гц, период 1 с),
 * сигнал «срезан» по краям, поэтому звучит жёстко. Генерируется на лету, файлов не нужно.
 */
class AlarmSound(private val context: Context) {
    private var track: AudioTrack? = null
    private var thread: Thread? = null
    private var focusRequest: AudioFocusRequest? = null
    @Volatile private var playing = false

    fun start() {
        if (playing) return
        runCatching {
            val audio = context.getSystemService(AudioManager::class.java)
            audio.setStreamVolume(
                AudioManager.STREAM_ALARM,
                audio.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                0
            )
            pauseOtherAudio(audio)

            val rate = 44100
            val minBuf = AudioTrack.getMinBufferSize(
                rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            val t = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(rate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .build()
                )
                .setBufferSizeInBytes(minBuf * 2)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            track = t
            playing = true
            t.play()

            thread = Thread {
                val chunk = ShortArray(1024)
                var sample = 0L
                var phase = 0.0
                while (playing) {
                    for (i in chunk.indices) {
                        // Положение внутри периода сирены: 0..1 вверх, затем вниз.
                        val pos = (sample % rate) / rate.toDouble()
                        val tri = if (pos < 0.5) pos * 2 else (1 - pos) * 2
                        val freq = 600 + 1200 * tri
                        phase += 2 * PI * freq / rate
                        if (phase > 2 * PI) phase -= 2 * PI
                        // Усиление с ограничением: почти квадратная волна, максимальная громкость.
                        val v = (sin(phase) * 2.5).coerceIn(-1.0, 1.0)
                        chunk[i] = (v * Short.MAX_VALUE).toInt().toShort()
                        sample++
                    }
                    if (playing) t.write(chunk, 0, chunk.size)
                }
            }.apply { isDaemon = true; start() }
        }
    }

    /** Ставит на паузу музыку, видео и другие плееры на время сигнализации. */
    private fun pauseOtherAudio(audio: AudioManager) {
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        // Аудиофокус: плееры, которые его теряют, ставятся на паузу.
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attrs)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener { }
            .build()
        runCatching { audio.requestAudioFocus(focusRequest!!) }
        // Дополнительно: команда «Пауза» для активного плеера.
        runCatching {
            audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
            audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
        }
    }

    fun stop() {
        playing = false
        focusRequest?.let { request ->
            runCatching { context.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(request) }
        }
        focusRequest = null
        runCatching { track?.stop() }
        runCatching { thread?.join(1000) }
        runCatching { track?.release() }
        track = null
        thread = null
    }
}
