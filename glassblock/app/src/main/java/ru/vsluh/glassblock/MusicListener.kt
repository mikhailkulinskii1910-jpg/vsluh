package ru.vsluh.glassblock

import android.content.ComponentName
import android.content.Context
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.service.notification.NotificationListenerService

/**
 * Следит за плеером через доступ к уведомлениям (так Android разрешает видеть чужие медиасеансы):
 * Яндекс Музыка играет — пластинка крутится, пауза — останавливается. Через тот же сеанс виджет
 * управляет плеером. Систему держит этот сервис подключённым сама, отдельный фоновый процесс не нужен.
 */
class MusicListener : NotificationListenerService() {
    private val main = Handler(Looper.getMainLooper())
    private var sessions: MediaSessionManager? = null
    private val onSessions = MediaSessionManager.OnActiveSessionsChangedListener { attach(it.orEmpty()) }
    private val callback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = report()
        override fun onSessionDestroyed() = refresh()
    }
    // Остановка с задержкой: между треками плеер на миг бывает «не играет» — пластинка не должна дёргаться.
    private val stop = Runnable { Player.setSpinning(this, false) }

    override fun onListenerConnected() {
        instance = this
        val sm = getSystemService(MediaSessionManager::class.java)
        sessions = sm
        try {
            sm.addOnActiveSessionsChangedListener(onSessions, component(), main)
        } catch (e: SecurityException) {
            return
        }
        refresh()
    }

    override fun onListenerDisconnected() {
        try { sessions?.removeOnActiveSessionsChangedListener(onSessions) } catch (_: SecurityException) {}
        controller?.unregisterCallback(callback)
        controller = null
        instance = null
        main.removeCallbacks(stop)
    }

    /** Сверить пластинку с тем, что сейчас на самом деле делает плеер. */
    fun report() {
        main.removeCallbacks(stop)
        if (playing(controller?.playbackState)) { Player.setSpinning(this, true); return }
        // Сразу после нажатия «играть» плеер ещё запускается — не останавливаем (итог проверит Player.toggle).
        val wait = graceUntil - SystemClock.uptimeMillis()
        main.postDelayed(stop, 800 + maxOf(wait, 0L))
    }

    private fun refresh() = attach(
        try { sessions?.getActiveSessions(component()).orEmpty() } catch (_: SecurityException) { emptyList() }
    )

    /** Яндекс Музыка в приоритете; если её сеанса нет — тот плеер, что играет, или последний активный. */
    private fun attach(list: List<MediaController>) {
        val pick = list.firstOrNull { it.packageName == Player.YANDEX_MUSIC }
            ?: list.firstOrNull { playing(it.playbackState) } ?: list.firstOrNull()
        if (pick?.sessionToken != controller?.sessionToken) {
            controller?.unregisterCallback(callback)
            controller = pick
            pick?.registerCallback(callback, main)
        }
        report()
    }

    private fun component() = ComponentName(this, MusicListener::class.java)

    companion object {
        @Volatile var controller: MediaController? = null
            private set
        @Volatile var instance: MusicListener? = null
            private set
        /** До этого момента (uptimeMillis) «не играет» не останавливает пластинку: плеер запускается. */
        @Volatile var graceUntil = 0L

        fun playing(state: PlaybackState?) = when (state?.state) {
            PlaybackState.STATE_PLAYING, PlaybackState.STATE_BUFFERING, PlaybackState.STATE_CONNECTING,
            PlaybackState.STATE_SKIPPING_TO_NEXT, PlaybackState.STATE_SKIPPING_TO_PREVIOUS,
            PlaybackState.STATE_SKIPPING_TO_QUEUE_ITEM, PlaybackState.STATE_FAST_FORWARDING,
            PlaybackState.STATE_REWINDING -> true
            else -> false
        }

        /** Выдан ли доступ к уведомлениям (без него пластинка не узнает о паузе в самой Яндекс Музыке). */
        fun granted(context: Context): Boolean =
            Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
                ?.split(':')?.any { it.startsWith(context.packageName + "/") } == true
    }
}
