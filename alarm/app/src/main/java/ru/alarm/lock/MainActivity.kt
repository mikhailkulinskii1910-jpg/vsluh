package ru.alarm.lock

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {

    private lateinit var status: TextView
    private lateinit var toggle: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply {
            textSize = 22f
            gravity = Gravity.CENTER
        }
        toggle = Button(this).apply {
            textSize = 24f
            setTextColor(Color.WHITE)
            setOnClickListener { onToggle() }
        }
        val hint = TextView(this).apply {
            text = "Когда сигнализация включена, при включении экрана телефона появится " +
                "красное окно с паролем и зазвучит громкий сигнал. После ввода пароля " +
                "сигнализация выключается; чтобы включить её снова, нажмите кнопку здесь."
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(24), dp(8), 0)
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(status)
            addView(toggle, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(120)
            ).apply { topMargin = dp(32) })
            addView(hint)
        }
        setContentView(root)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun onToggle() {
        if (isAlarmEnabled(this)) {
            setAlarmEnabled(this, false)
            stopService(Intent(this, AlarmService::class.java))
        } else {
            setAlarmEnabled(this, true)
            startForegroundService(Intent(this, AlarmService::class.java))
        }
        refresh()
    }

    private fun refresh() {
        val on = isAlarmEnabled(this)
        status.text = if (on) "Сигнализация ВКЛЮЧЕНА" else "Сигнализация выключена"
        status.setTextColor(if (on) Color.RED else Color.DKGRAY)
        toggle.text = if (on) "ВЫКЛЮЧИТЬ" else "ВКЛЮЧИТЬ"
        toggle.setBackgroundColor(if (on) Color.DKGRAY else Color.rgb(200, 0, 0))
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
