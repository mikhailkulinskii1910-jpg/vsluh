package ru.vsluh.glassblock

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.browse.MediaBrowser
import android.media.session.MediaController
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import android.widget.Toast

/**
 * Плеер-пластинка. Пластинка крутится, пока играет музыка: состояние приходит от [MusicListener]
 * (пауза в самой Яндекс Музыке тоже останавливает пластинку). Без доступа к уведомлениям — до следующего нажатия.
 * Команды: через медиасеанс Яндекс Музыки, если он есть; иначе медиакнопкой прямо ей (даже если она закрыта)
 * или плееру, который играл последним.
 */
object Player {
    const val YANDEX_MUSIC = "ru.yandex.music"
    const val PREFS = "player"
    const val KEY_SPINNING = "spinning"

    fun spinning(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SPINNING, false)

    /** Запустить или остановить пластинку; виджет перерисовывается только при смене (иначе он дёргается). */
    fun setSpinning(context: Context, spinning: Boolean) {
        if (spinning == spinning(context)) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_SPINNING, spinning).apply()
        updateWidgets(context, spinning)
    }

    /**
     * Нажатие: играть ↔ пауза. [done] вызывается, когда всё отправлено и проверено (через 9 с —
     * виджету на это дано 10 с). Возвращает новое состояние.
     */
    fun toggle(context: Context, done: () -> Unit = {}): Boolean {
        val play = !spinning(context)
        // Пока плеер запускается, он бывает «не играет» — пластинка не должна из-за этого дёргаться.
        MusicListener.graceUntil = if (play) SystemClock.uptimeMillis() + START_GRACE_MS else 0L
        setSpinning(context, play)                          // сразу, чтобы нажатие было видно
        val main = Handler(Looper.getMainLooper())
        val session = yandexSession()
        when {
            session != null -> if (play) session.transportControls.play() else session.transportControls.pause()
            !play -> sendKey(context, KeyEvent.KEYCODE_MEDIA_PAUSE)
            else -> {
                // Яндекс Музыка закрыта: три попытки, пока не заиграет.
                sendKey(context, KeyEvent.KEYCODE_MEDIA_PLAY)                       // 1) медиакнопка ей
                main.postDelayed({ if (silent(context)) playViaBrowser(context) }, 1500)   // 2) её сервис плеера
                main.postDelayed({                                                   // 3) системная медиакнопка
                    if (silent(context)) dispatch(context, KeyEvent.KEYCODE_MEDIA_PLAY)
                }, 3500)
            }
        }
        main.postDelayed({
            if (play && spinning(context) && silent(context)) {
                setSpinning(context, false)
                Toast.makeText(context, R.string.no_music, Toast.LENGTH_LONG).show()
            } else {
                MusicListener.instance?.report()
            }
        }, START_GRACE_MS + 1000)
        // Процесс держим ещё немного, чтобы подсказка успела показаться.
        main.postDelayed(done, START_GRACE_MS + 3500)
        return play
    }

    private const val START_GRACE_MS = 5500L

    private fun yandexSession(): MediaController? =
        MusicListener.controller?.takeIf { it.packageName == YANDEX_MUSIC }

    /** Музыка так и не заиграла. */
    private fun silent(context: Context) = !audio(context).isMusicActive &&
        !MusicListener.playing(yandexSession()?.playbackState)

    /** Подключиться к сервису плеера Яндекс Музыки (как Android Auto) и нажать «играть». */
    private fun playViaBrowser(context: Context) {
        val service = context.packageManager.queryIntentServices(
            Intent("android.media.browse.MediaBrowserService").setPackage(YANDEX_MUSIC), 0
        ).firstOrNull()?.serviceInfo ?: return
        var browser: MediaBrowser? = null
        browser = MediaBrowser(context, ComponentName(service.packageName, service.name),
            object : MediaBrowser.ConnectionCallback() {
                override fun onConnected() {
                    val b = browser ?: return
                    try {
                        MediaController(context, b.sessionToken).transportControls.play()
                    } finally {
                        Handler(Looper.getMainLooper()).postDelayed({ b.disconnect() }, 3000)
                    }
                }
            }, null)
        try { browser.connect() } catch (_: Exception) {}
    }

    fun hasYandexMusic(context: Context) =
        context.packageManager.getLaunchIntentForPackage(YANDEX_MUSIC) != null

    private fun sendKey(context: Context, code: Int) {
        val play = code == KeyEvent.KEYCODE_MEDIA_PLAY
        if (hasYandexMusic(context)) {
            // Яндекс Музыка принимает медиакнопку, даже если закрыта: продолжает с того места, где остановилась.
            for (action in intArrayOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP)) {
                context.sendBroadcast(Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(YANDEX_MUSIC)
                    .putExtra(Intent.EXTRA_KEY_EVENT, key(action, code)))
            }
            if (!play) dispatch(context, code)              // пауза — и тому, что сейчас играет
        } else {
            dispatch(context, code)
        }
    }

    /** Перерисовать все виджеты: пластинка крутится или стоит. */
    fun updateWidgets(context: Context, spinning: Boolean = spinning(context)) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, DiscWidget::class.java))
        if (ids.isNotEmpty()) manager.updateAppWidget(ids, DiscWidget.views(context, spinning))
    }

    private fun dispatch(context: Context, code: Int) {
        val am = audio(context)
        am.dispatchMediaKeyEvent(key(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(key(KeyEvent.ACTION_UP, code))
    }

    private fun key(action: Int, code: Int): KeyEvent {
        val now = SystemClock.uptimeMillis()
        return KeyEvent(now, now, action, code, 0)
    }

    private fun audio(context: Context) = context.getSystemService(AudioManager::class.java)
}
