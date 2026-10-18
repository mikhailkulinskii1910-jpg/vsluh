package ru.vsluh.glassblock

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent

/**
 * Плеер: пластинка крутится, пока её не остановят нажатием (состояние хранится, сама она не останавливается).
 * Команды — медиакнопки «играть»/«пауза». Если стоит Яндекс Музыка, они идут прямо ей; иначе — плееру,
 * который играл последним (как кнопка на наушниках).
 */
object Player {
    const val YANDEX_MUSIC = "ru.yandex.music"
    private const val PREFS = "player"
    private const val KEY_SPINNING = "spinning"

    fun spinning(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_SPINNING, false)

    /** Нажатие: играть ↔ пауза. [done] вызывается, когда все команды отправлены. Возвращает новое состояние. */
    fun toggle(context: Context, done: () -> Unit = {}): Boolean {
        val play = !spinning(context)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_SPINNING, play).apply()
        updateWidgets(context, play)
        send(context, play, done)
        return play
    }

    fun hasYandexMusic(context: Context) =
        context.packageManager.getLaunchIntentForPackage(YANDEX_MUSIC) != null

    private fun send(context: Context, play: Boolean, done: () -> Unit) {
        val code = if (play) KeyEvent.KEYCODE_MEDIA_PLAY else KeyEvent.KEYCODE_MEDIA_PAUSE
        if (!hasYandexMusic(context)) { dispatch(context, code); done(); return }
        // Яндекс Музыка принимает медиакнопку, даже если закрыта: продолжает с того места, где остановилась.
        for (action in intArrayOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP)) {
            context.sendBroadcast(Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(YANDEX_MUSIC)
                .putExtra(Intent.EXTRA_KEY_EVENT, key(action, code)))
        }
        if (!play) { dispatch(context, code); done(); return }      // пауза — и тому, что сейчас играет
        // Если через 2 с тишина — та же кнопка через систему (дойдёт до сеанса Яндекс Музыки, если он есть).
        Handler(Looper.getMainLooper()).postDelayed({
            if (spinning(context) && !audio(context).isMusicActive) dispatch(context, code)
            done()
        }, 2000)
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
