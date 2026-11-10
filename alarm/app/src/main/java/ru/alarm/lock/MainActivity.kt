package ru.alarm.lock

import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    /** Обязательное разрешение: как проверить и как запросить. */
    private class Need(
        val title: String,
        val granted: () -> Boolean,
        val request: () -> Unit,
    )

    private lateinit var status: TextView
    private lateinit var toggle: Button
    private lateinit var permissions: LinearLayout
    private lateinit var crashBox: LinearLayout
    private lateinit var crashText: TextView

    /** Разрешения, которые уже запрашивали в этом запуске (чтобы не открывать одно и то же снова и снова). */
    private val asked = mutableSetOf<String>()
    /** Идёт ли по очереди запрос разрешений. */
    private var flowActive = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        status = TextView(this).apply { textSize = 22f; gravity = Gravity.CENTER }
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
        }
        val permHeader = TextView(this).apply {
            text = "Разрешения (нужны все, отмеченные ✗)"
            textSize = 17f
            setTextColor(Color.BLACK)
            setPadding(0, dp(28), 0, dp(4))
        }
        permissions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        crashText = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.rgb(140, 0, 0))
            setTextIsSelectable(true)
        }
        crashBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(0, dp(28), 0, 0)
            addView(TextView(this@MainActivity).apply {
                text = "Последний сбой приложения (его можно скопировать и отправить):"
                textSize = 15f
                setTextColor(Color.RED)
            })
            addView(crashText)
            addView(Button(this@MainActivity).apply {
                text = "Очистить"
                setOnClickListener { crashFile(this@MainActivity).delete(); refresh() }
            })
        }

        val wrap = LinearLayout.LayoutParams.WRAP_CONTENT
        val match = LinearLayout.LayoutParams.MATCH_PARENT
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(status)
            addView(toggle, LinearLayout.LayoutParams(match, dp(120)).apply { topMargin = dp(24) })
            addView(hint, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(16) })
            addView(permHeader)
            addView(permissions, LinearLayout.LayoutParams(match, wrap))
            addView(crashBox, LinearLayout.LayoutParams(match, wrap))
        }
        setContentView(ScrollView(this).apply { addView(content) })
    }

    override fun onResume() {
        super.onResume()
        refresh()
        // Вернулись из системного окна разрешения — переходим к следующему.
        if (flowActive) continueFlow()
    }

    /** Обязательные разрешения в порядке запроса. */
    private fun needs(): List<Need> {
        val pm = getSystemService(PowerManager::class.java)
        val nm = getSystemService(NotificationManager::class.java)
        val pkg = "package:$packageName"
        return buildList {
            add(Need(
                title = "Уведомления",
                granted = { nm.areNotificationsEnabled() },
                request = {
                    if (Build.VERSION.SDK_INT >= 33) {
                        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
                    } else {
                        openSettings(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                    }
                },
            ))
            add(Need(
                title = "Поверх других приложений",
                granted = { Settings.canDrawOverlays(this@MainActivity) },
                request = { openSettings(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse(pkg))) },
            ))
            if (Build.VERSION.SDK_INT >= 34) {
                add(Need(
                    title = "Полноэкранные уведомления",
                    granted = { nm.canUseFullScreenIntent() },
                    request = {
                        openSettings(Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT", Uri.parse(pkg)))
                    },
                ))
            }
            add(Need(
                title = "Без ограничений батареи",
                granted = { pm.isIgnoringBatteryOptimizations(packageName) },
                request = { openSettings(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse(pkg))) },
            ))
        }
    }

    /** Запрашивает следующее невыданное разрешение, которое ещё не запрашивали. */
    private fun continueFlow() {
        val next = needs().firstOrNull { !it.granted() && it.title !in asked }
        if (next == null) {
            flowActive = false
            return
        }
        asked += next.title
        next.request()
    }

    private fun onToggle() {
        if (isAlarmEnabled(this)) {
            setAlarmEnabled(this, false)
            stopService(Intent(this, AlarmService::class.java))
        } else if (needs().any { !it.granted() }) {
            // Без разрешений сигнализация работать не будет — запрашиваем их заново.
            Toast.makeText(this, "Сначала выдайте все разрешения", Toast.LENGTH_LONG).show()
            asked.clear()
            flowActive = true
            continueFlow()
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

        val pkg = "package:$packageName"
        permissions.removeAllViews()
        for (need in needs()) {
            addRow(need.title, need.granted()) { need.request() }
        }
        addRow("Xiaomi: «Показ всплывающих окон» и «Автозапуск»", null) {
            openSettings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse(pkg)))
        }

        val crash = crashFile(this)
        if (crash.exists()) {
            crashText.text = crash.readText().takeLast(4000)
            crashBox.visibility = View.VISIBLE
        } else {
            crashBox.visibility = View.GONE
        }
    }

    /** ok = true/false — разрешение есть или нет; null — проверить нельзя, только открыть настройки. */
    private fun addRow(name: String, ok: Boolean?, action: () -> Unit) {
        val label = TextView(this).apply {
            textSize = 15f
            text = when (ok) {
                true -> "✓ $name"
                false -> "✗ $name — НЕ РАЗРЕШЕНО"
                null -> "• $name"
            }
            setTextColor(
                when (ok) {
                    true -> Color.rgb(0, 120, 0)
                    false -> Color.RED
                    null -> Color.DKGRAY
                }
            )
        }
        val button = Button(this).apply {
            text = "Открыть настройки"
            setOnClickListener { action() }
        }
        val wrap = LinearLayout.LayoutParams.WRAP_CONTENT
        val match = LinearLayout.LayoutParams.MATCH_PARENT
        permissions.addView(label, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(10) })
        permissions.addView(button, LinearLayout.LayoutParams(match, wrap))
    }

    private fun openSettings(intent: Intent) {
        runCatching { startActivity(intent) }.onFailure {
            runCatching {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
