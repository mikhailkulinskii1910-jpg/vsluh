package ru.vsluh.glassblock

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var disc: DiscView

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
                setColor(0x33A0B4D2)
                setStroke((1 * dp).toInt(), 0x88D2DCF0.toInt())
            }
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            setOnClickListener { onClick() }
            buttons.addView(this, LinearLayout.LayoutParams(-2, (52 * dp).toInt()).apply { topMargin = (10 * dp).toInt() })
        }
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
        disc.spinning = Player.spinning(this)     // могли переключить с виджета
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
