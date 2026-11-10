package ru.alarm.lock

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Красное окно с паролем поверх экрана блокировки. */
class LockActivity : Activity() {

    private lateinit var input: EditText
    private lateinit var error: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )

        val title = TextView(this).apply {
            text = "⚠ СИГНАЛИЗАЦИЯ"
            textSize = 34f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        val subtitle = TextView(this).apply {
            text = "Введите пароль, чтобы отключить"
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        input = EditText(this).apply {
            hint = "Пароль"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            imeOptions = EditorInfo.IME_ACTION_DONE
            textSize = 24f
            gravity = Gravity.CENTER
            setTextColor(Color.BLACK)
            setHintTextColor(Color.GRAY)
            setBackgroundColor(Color.WHITE)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_DONE) check()
                true
            }
        }
        error = TextView(this).apply {
            textSize = 16f
            setTextColor(Color.YELLOW)
            gravity = Gravity.CENTER
        }
        val button = Button(this).apply {
            text = "ОТКЛЮЧИТЬ"
            textSize = 20f
            setOnClickListener { check() }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.RED)
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(title)
            addView(subtitle, lp(top = 12))
            addView(input, lp(top = 32))
            addView(error, lp(top = 12))
            addView(button, lp(top = 16))
        }
        setContentView(root)
    }

    private fun check() {
        if (input.text.toString().trim() == ALARM_PASSWORD) {
            startService(Intent(this, AlarmService::class.java).setAction(AlarmService.ACTION_UNLOCK))
            finish()
        } else {
            error.text = "Неверный пароль"
            input.text.clear()
        }
    }

    // Кнопка «Назад» не закрывает окно: сигнализацию можно отключить только паролем.
    @Suppress("DEPRECATION")
    override fun onBackPressed() {}

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun lp(top: Int) = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply { topMargin = dp(top) }
}
