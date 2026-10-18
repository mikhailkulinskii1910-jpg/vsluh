package ru.vsluh.glassblock

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Toast

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        val root = FrameLayout(this)
        root.addView(WaterView(this), FrameLayout.LayoutParams(-1, -1))

        val add = Button(this).apply {
            setText(R.string.add_widget)
            isAllCaps = false
            setTextColor(Color.WHITE)
            textSize = 16f
            background = GradientDrawable().apply {
                cornerRadius = 28 * dp
                setColor(0x3329A07A)
                setStroke((1 * dp).toInt(), 0x8899E0C0.toInt())
            }
            setPadding((24 * dp).toInt(), 0, (24 * dp).toInt(), 0)
            setOnClickListener { pinWidget() }
        }
        root.addView(add, FrameLayout.LayoutParams(-2, (56 * dp).toInt(), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
            .apply { bottomMargin = (40 * dp).toInt() })
        setContentView(root)
    }

    private fun pinWidget() {
        val manager = getSystemService(AppWidgetManager::class.java)
        if (manager != null && manager.isRequestPinAppWidgetSupported) {
            manager.requestPinAppWidget(ComponentName(this, GlassBlockWidget::class.java), null, null)
        } else {
            Toast.makeText(this, R.string.add_widget_manual, Toast.LENGTH_LONG).show()
        }
    }
}
