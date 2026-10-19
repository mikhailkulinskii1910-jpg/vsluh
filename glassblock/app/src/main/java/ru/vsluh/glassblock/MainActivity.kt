package ru.vsluh.glassblock

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.MotionEvent
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var disc: DiscView
    private lateinit var access: Button
    private lateinit var accessHint: TextView
    private val prefs by lazy { getSharedPreferences(Player.PREFS, MODE_PRIVATE) }
    // Пластинку переключили с виджета или Яндекс Музыка встала на паузу — крутим/останавливаем и здесь.
    private val onState = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == Player.KEY_SPINNING) disc.spinning = Player.spinning(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        val root = FrameLayout(this)
        disc = DiscView(this)
        disc.setOnTouchListener { v, e ->
            if (e.action == MotionEvent.ACTION_UP && disc.hit(e.x, e.y)) { v.performClick(); toggle() }
            true
        }
        root.addView(disc, FrameLayout.LayoutParams(-1, -1))

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        fun button(text: Int, onClick: () -> Unit) = Button(this).apply {
            setText(text)
            isAllCaps = false
            setTextColor(Color.WHITE)
            textSize = 16f
            background = GradientDrawable().apply {
                cornerRadius = 28 * dp
                setColor(0x44C81E24)
                setStroke((1 * dp).toInt(), 0xAAF07A50.toInt())
            }
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            setOnClickListener { onClick() }
            buttons.addView(this, LinearLayout.LayoutParams(-2, (52 * dp).toInt()).apply { topMargin = (10 * dp).toInt() })
        }
        accessHint = TextView(this).apply {
            setText(R.string.access_hint)
            setTextColor(0xCCD2DCF0.toInt())
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            buttons.addView(this)
        }
        access = button(R.string.allow_access) { openAccessSettings() }
        if (Player.hasYandexMusic(this)) button(R.string.open_yandex) {
            packageManager.getLaunchIntentForPackage(Player.YANDEX_MUSIC)?.let { startActivity(it) }
        }
        button(R.string.add_widget) { pinWidget() }
        root.addView(buttons, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
            .apply { bottomMargin = (36 * dp).toInt() })
        setContentView(root)
    }

    override fun onStart() {
        super.onStart()
        prefs.registerOnSharedPreferenceChangeListener(onState)
        disc.spinning = Player.spinning(this)     // могли переключить с виджета
    }

    override fun onResume() {
        super.onResume()
        // Могли выдать доступ в настройках; в версии «лайт» доступа к уведомлениям нет совсем.
        val ask = BuildConfig.LISTENER && !MusicListener.granted(this)
        access.visibility = if (ask) View.VISIBLE else View.GONE
        accessHint.visibility = access.visibility
    }

    override fun onStop() {
        prefs.unregisterOnSharedPreferenceChangeListener(onState)
        super.onStop()
    }

    private fun openAccessSettings() {
        val intent = if (Build.VERSION.SDK_INT >= 30) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
                Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                ComponentName(this, MusicListener::class.java).flattenToString()
            )
        } else {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
    }

    private fun toggle() {
        disc.spinning = Player.toggle(this)
    }

    private fun pinWidget() {
        val manager = getSystemService(AppWidgetManager::class.java)
        if (manager != null && manager.isRequestPinAppWidgetSupported) {
            manager.requestPinAppWidget(ComponentName(this, DiscWidget::class.java), null, null)
        } else {
            Toast.makeText(this, R.string.add_widget_manual, Toast.LENGTH_LONG).show()
        }
    }
}
