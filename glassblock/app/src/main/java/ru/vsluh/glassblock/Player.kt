package ru.vsluh.glassblock

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent

/**
 * Управление музыкой телефона медиакнопками — как кнопка на наушниках: команда уходит плееру,
 * который играл последним (Spotify, Яндекс Музыка, VK, YouTube Music…).
 */
object Player {
    fun isPlaying(context: Context): Boolean = audio(context).isMusicActive

    /** Снимает с паузы или ставит на паузу. Возвращает, должна ли теперь крутиться пластинка. */
    fun toggle(context: Context): Boolean {
        val playing = isPlaying(context)
        val code = if (playing) KeyEvent.KEYCODE_MEDIA_PAUSE else KeyEvent.KEYCODE_MEDIA_PLAY
        val am = audio(context)
        val now = SystemClock.uptimeMillis()
        am.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0))
        am.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0))
        return !playing
    }

    /** Перерисовать все виджеты: пластинка крутится или стоит. */
    fun updateWidgets(context: Context, spinning: Boolean) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = manager.getAppWidgetIds(ComponentName(context, DiscWidget::class.java))
        if (ids.isNotEmpty()) manager.updateAppWidget(ids, DiscWidget.views(context, spinning))
    }

    private fun audio(context: Context) = context.getSystemService(AudioManager::class.java)
}
