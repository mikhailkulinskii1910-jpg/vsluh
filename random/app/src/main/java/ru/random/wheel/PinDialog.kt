package ru.random.wheel

import android.animation.ObjectAnimator
import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.roundToInt

/**
 * Окно ввода пароля в цветах темы: 4 точки и своя цифровая клавиатура (системная не нужна).
 * Код проверяется сразу после последней цифры; при ошибке окно трясётся, после 5 ошибок — пауза 30 с.
 */
class PinDialog(
    context: Context,
    private val theme: AppTheme,
    private val pin: String,
    private val lock: Lock,
    private val onOk: () -> Unit,
) : Dialog(context) {

    class Lock { var wrong = 0; var until = 0L }

    private val entered = StringBuilder()
    private lateinit var card: LinearLayout
    private lateinit var dots: List<View>
    private lateinit var hint: TextView
    private val keys = mutableListOf<Button>()
    private val ticker = object : Runnable {
        override fun run() { if (updateLock()) hint.postDelayed(this, 250) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(26), dp(24), dp(18))
            background = GradientDrawable().apply {
                setColor(theme.bg); cornerRadius = dp(28).toFloat(); setStroke(dp(1), theme.panel)
            }
        }
        // замок
        card.addView(TextView(context).apply {
            text = "🔒"; textSize = 30f; gravity = Gravity.CENTER
        })
        card.addView(TextView(context).apply {
            text = "Введите код"; textSize = 20f; setTextColor(theme.text)
            setTypeface(typeface, Typeface.BOLD); gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        })
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, dp(6))
        }
        dots = List(pin.length) {
            View(context).also { d ->
                d.layoutParams = LinearLayout.LayoutParams(dp(16), dp(16)).apply { marginStart = dp(9); marginEnd = dp(9) }
                row.addView(d)
            }
        }
        card.addView(row)
        hint = TextView(context).apply {
            textSize = 13f; gravity = Gravity.CENTER; setTextColor(theme.muted)
            minHeight = dp(22)
        }
        card.addView(hint)

        val labels = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫")
        labels.chunked(3).forEach { line ->
            val r = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            line.forEach { k ->
                if (k.isEmpty()) { r.addView(View(context).apply { layoutParams = keyParams() }); return@forEach }
                r.addView(Button(context, null, 0, R.style.Btn).apply {
                    text = k
                    textSize = if (k == "⌫") 22f else 26f
                    setTextColor(theme.text)
                    setPadding(0, 0, 0, 0)
                    layoutParams = keyParams()
                    background = RippleDrawable(
                        ColorStateList.valueOf(theme.accent and 0x55FFFFFF),
                        GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (k == "⌫") Color.TRANSPARENT else theme.panel) },
                        null,
                    )
                    setOnClickListener { if (k == "⌫") back() else digit(k[0]) }
                    if (k == "⌫") setOnLongClickListener { entered.clear(); render(); true }
                    keys.add(this)
                })
            }
            card.addView(r)
        }
        card.addView(Button(context, null, 0, R.style.Btn).apply {
            text = "Отмена"; textSize = 15f; setTextColor(theme.muted); background = null
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)).apply { topMargin = dp(6) }
            setOnClickListener { dismiss() }
        })
        setContentView(card)
        window?.setLayout(dp(320), ViewGroup.LayoutParams.WRAP_CONTENT)
        // физическая клавиатура тоже работает
        setOnKeyListener { _, code, e ->
            if (e.action != KeyEvent.ACTION_DOWN) return@setOnKeyListener false
            when (code) {
                in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> { digit('0' + (code - KeyEvent.KEYCODE_0)); true }
                KeyEvent.KEYCODE_DEL -> { back(); true }
                else -> false
            }
        }
        setOnDismissListener { hint.removeCallbacks(ticker) }
        render()
        if (updateLock()) hint.post(ticker)
    }

    private fun keyParams() = LinearLayout.LayoutParams(dp(70), dp(70)).apply { setMargins(dp(8), dp(6), dp(8), dp(6)) }

    private fun digit(c: Char) {
        if (locked() || entered.length >= pin.length) return
        entered.append(c)
        card.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        render()
        if (entered.length == pin.length) card.postDelayed({ check() }, 120)
    }

    private fun back() {
        if (entered.isNotEmpty()) { entered.setLength(entered.length - 1); render() }
    }

    private fun check() {
        val l = lock
        if (entered.toString() == pin) {
            l.wrong = 0
            render(ok = true)
            card.postDelayed({ dismiss(); onOk() }, 160)
            return
        }
        l.wrong++
        entered.clear()
        card.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING)
        ObjectAnimator.ofFloat(card, "translationX", 0f, -dp(18f), dp(18f), -dp(12f), dp(12f), -dp(5f), dp(5f), 0f)
            .setDuration(420).start()
        render(error = true)
        if (l.wrong >= MAX_WRONG) {
            l.wrong = 0
            l.until = SystemClock.elapsedRealtime() + LOCK_MS
            hint.post(ticker)
        } else {
            hint.text = "Неверный код · осталось попыток: ${MAX_WRONG - l.wrong}"
            hint.setTextColor(ERROR)
        }
    }

    private fun locked() = SystemClock.elapsedRealtime() < lock.until

    /** Показывает обратный отсчёт блокировки; false — блокировки нет. */
    private fun updateLock(): Boolean {
        val left = lock.until - SystemClock.elapsedRealtime()
        val on = left > 0
        keys.forEach { it.isEnabled = !on; it.alpha = if (on) 0.35f else 1f }
        if (on) {
            hint.text = "Слишком много попыток · подождите ${(left / 1000.0).let { kotlin.math.ceil(it).toInt() }} с"
            hint.setTextColor(ERROR)
        } else if (hint.text.startsWith("Слишком")) {
            hint.text = ""; hint.setTextColor(theme.muted)
        }
        return on
    }

    private fun render(ok: Boolean = false, error: Boolean = false) {
        dots.forEachIndexed { i, d ->
            val filled = i < entered.length || ok
            d.background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                val c = when { ok -> OK; error -> ERROR; else -> theme.accent }
                if (filled) setColor(c) else { setColor(Color.TRANSPARENT); setStroke(dp(2), if (error) ERROR else theme.muted) }
            }
        }
        if (!error && !locked() && entered.isNotEmpty()) { hint.text = ""; hint.setTextColor(theme.muted) }
    }

    private fun dp(v: Int) = (v * context.resources.displayMetrics.density).roundToInt()
    private fun dp(v: Float) = v * context.resources.displayMetrics.density

    companion object {
        const val MAX_WRONG = 5
        const val LOCK_MS = 30_000L
        val ERROR = 0xFFE84A5F.toInt()
        val OK = 0xFF2EC4B6.toInt()
    }
}
