package ru.vsluh.glassblock

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.AudioPlaybackConfiguration
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var disc: DiscView
    private val main = Handler(Looper.getMainLooper())

    // Музыку могли включить или остановить в другом плеере — пластинка и виджеты подстраиваются.
    private val playback = object : AudioManager.AudioPlaybackCallback() {
        override fun onPlaybackConfigChanged(configs: MutableList<AudioPlaybackConfiguration>) = sync()
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

        val add = Button(this).apply {
            setText(R.string.add_widget)
            isAllCaps = false
            setTextColor(Color.WHITE)
            textSize = 16f
            background = GradientDrawable().apply {
                cornerRadius = 28 * dp
                setColor(0x33A0B4D2)
                setStroke((1 * dp).toInt(), 0x88D2DCF0.toInt())
            }
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            setOnClickListener { pinWidget() }
        }
        root.addView(add, FrameLayout.LayoutParams(-2, (56 * dp).toInt(), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
            .apply { bottomMargin = (40 * dp).toInt() })
        setContentView(root)
    }

    override fun onStart() {
        super.onStart()
        getSystemService(AudioManager::class.java).registerAudioPlaybackCallback(playback, main)
        sync()
    }

    override fun onStop() {
        getSystemService(AudioManager::class.java).unregisterAudioPlaybackCallback(playback)
        super.onStop()
    }

    private fun toggle() {
        disc.spinning = Player.toggle(this)
        Player.updateWidgets(this, disc.spinning)
        main.postDelayed({
            if (Player.isPlaying(this) != disc.spinning) {
                if (disc.spinning) Toast.makeText(this, R.string.no_player, Toast.LENGTH_LONG).show()
                sync()
            }
        }, 1500)
    }

    private fun sync() {
        val playing = Player.isPlaying(this)
        if (playing != disc.spinning) {
            disc.spinning = playing
            Player.updateWidgets(this, playing)
        }
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
