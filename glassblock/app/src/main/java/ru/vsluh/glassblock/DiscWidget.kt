package ru.vsluh.glassblock

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews

/** Виджет-плеер: нажатие снимает музыку с паузы (или ставит на паузу); пластинка крутится до следующего нажатия. */
class DiscWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        manager.updateAppWidget(ids, views(context, Player.spinning(context)))
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_TOGGLE) return super.onReceive(context, intent)
        val pending = goAsync()
        Player.toggle(context) { pending.finish() }
    }

    companion object {
        private const val ACTION_TOGGLE = "ru.vsluh.glassblock.TOGGLE"

        fun views(context: Context, spinning: Boolean): RemoteViews {
            val toggle = PendingIntent.getBroadcast(
                context, 0, Intent(context, DiscWidget::class.java).setAction(ACTION_TOGGLE),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            return RemoteViews(context.packageName, R.layout.widget_disc).apply {
                setViewVisibility(R.id.disc_spin, if (spinning) View.VISIBLE else View.GONE)
                setViewVisibility(R.id.disc_still, if (spinning) View.GONE else View.VISIBLE)
                setOnClickPendingIntent(R.id.widget_root, toggle)
            }
        }
    }
}
