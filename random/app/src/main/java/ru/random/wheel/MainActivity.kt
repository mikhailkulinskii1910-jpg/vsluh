package ru.random.wheel

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt
import kotlin.random.Random

class MainActivity : Activity() {

    private class Item(var name: String, var chance: Int = DEFAULT_CHANCE)

    private val items = mutableListOf<Item>()
    private var rigged = false

    private lateinit var wheel: WheelView
    private lateinit var result: TextView
    private lateinit var panels: List<View>
    private lateinit var itemsList: LinearLayout
    private lateinit var oddsList: LinearLayout
    private lateinit var countView: TextView
    private lateinit var riggedSwitch: Switch
    private lateinit var oddsHint: TextView
    private val oddsLabels = mutableListOf<TextView>()

    private var titleTaps = 0
    private var firstTapAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        load()

        wheel = findViewById(R.id.wheel)
        result = findViewById(R.id.result)
        itemsList = findViewById(R.id.itemsList)
        oddsList = findViewById(R.id.oddsList)
        countView = findViewById(R.id.count)
        riggedSwitch = findViewById(R.id.rigged)
        oddsHint = findViewById(R.id.oddsHint)
        panels = listOf(findViewById(R.id.panelWheel), findViewById(R.id.panelItems), findViewById(R.id.panelOdds))

        findViewById<Button>(R.id.spin).setOnClickListener { spin() }
        wheel.setOnClickListener { spin() }
        findViewById<Button>(R.id.tabWheel).setOnClickListener { show(0) }
        findViewById<Button>(R.id.tabItems).setOnClickListener { show(1) }

        // Скрытый вход в «Шансы»: 5 быстрых нажатий или долгое нажатие на заголовок.
        val title = findViewById<TextView>(R.id.title)
        title.setOnClickListener {
            val now = SystemClock.uptimeMillis()
            if (now - firstTapAt > 2000) { firstTapAt = now; titleTaps = 0 }
            if (++titleTaps >= 5) { titleTaps = 0; show(2) }
        }
        title.setOnLongClickListener { show(2); true }

        findViewById<Button>(R.id.minus).setOnClickListener {
            if (items.size > MIN_ITEMS) { items.removeAt(items.lastIndex); itemsChanged() }
        }
        findViewById<Button>(R.id.plus).setOnClickListener {
            if (items.size < MAX_ITEMS) { items.add(Item("Вариант ${items.size + 1}")); itemsChanged() }
        }
        findViewById<Button>(R.id.shuffle).setOnClickListener { items.shuffle(); itemsChanged() }

        riggedSwitch.setOnCheckedChangeListener { _, on -> rigged = on; save(); refreshOdds() }
        findViewById<Button>(R.id.oddsReset).setOnClickListener {
            items.forEach { it.chance = DEFAULT_CHANCE }
            save(); buildOdds()
        }
        findViewById<Button>(R.id.oddsClose).setOnClickListener { show(0) }

        updateWheel()
        buildItems()
        show(0)
    }

    override fun onBackPressed() {
        if (!panels[0].isShown) show(0) else super.onBackPressed()
    }

    private fun show(idx: Int) {
        if (idx == 2) buildOdds()
        if (idx == 1) buildItems()
        panels.forEachIndexed { i, v -> v.visibility = if (i == idx) View.VISIBLE else View.GONE }
        if (idx != 1) hideKeyboard()
    }

    private fun spin() {
        if (wheel.spinning || items.isEmpty()) return
        result.text = ""
        val idx = Picker.pick(items.map { it.chance }, rigged, Random.nextDouble())
        wheel.spinTo(idx) {
            result.setTextColor(wheel.colorOf(idx))
            result.text = items.getOrNull(idx)?.name?.ifBlank { "—" } ?: ""
        }
    }

    private fun updateWheel() { wheel.labels = items.map { it.name } }

    private fun itemsChanged() {
        save(); updateWheel(); buildItems(); result.text = ""
    }

    // --- Варианты -----------------------------------------------------------

    private fun buildItems() {
        countView.text = items.size.toString()
        itemsList.removeAllViews()
        items.forEachIndexed { i, item ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(4), 0, dp(4))
            }
            val dot = View(this).apply {
                setBackgroundColor(wheel.colorOf(i))
                layoutParams = LinearLayout.LayoutParams(dp(8), dp(40)).apply { marginEnd = dp(10) }
            }
            val edit = EditText(this).apply {
                setText(item.name)
                setTextColor(getColor(R.color.text))
                setHintTextColor(getColor(R.color.muted))
                hint = "Вариант ${i + 1}"
                textSize = 17f
                isSingleLine = true
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                imeOptions = EditorInfo.IME_ACTION_DONE
                setBackgroundResource(R.drawable.field)
                setPadding(dp(12), dp(10), dp(12), dp(10))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun afterTextChanged(s: Editable?) {
                        item.name = s.toString(); updateWheel(); save()
                    }
                })
            }
            val del = Button(this, null, 0, R.style.Btn).apply {
                text = "✕"
                gravity = Gravity.CENTER
                isEnabled = items.size > MIN_ITEMS
                alpha = if (isEnabled) 1f else 0.35f
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginStart = dp(8) }
                setPadding(0, 0, 0, 0)
                setOnClickListener {
                    if (items.size > MIN_ITEMS) { items.remove(item); itemsChanged() }
                }
            }
            row.addView(dot); row.addView(edit); row.addView(del)
            itemsList.addView(row)
        }
    }

    // --- Скрытая вкладка «Шансы» ---------------------------------------------

    private fun buildOdds() {
        riggedSwitch.isChecked = rigged
        oddsList.removeAllViews()
        oddsLabels.clear()
        items.forEachIndexed { i, item ->
            val head = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(12), 0, 0)
            }
            val name = TextView(this).apply {
                text = item.name.ifBlank { "Вариант ${i + 1}" }
                setTextColor(wheel.colorOf(i))
                textSize = 16f
                isSingleLine = true
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val value = TextView(this).apply {
                setTextColor(getColor(R.color.text))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            }
            head.addView(name); head.addView(value)
            oddsLabels.add(value)

            val bar = SeekBar(this).apply {
                max = 100
                progress = item.chance
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                        if (!fromUser) return
                        item.chance = p
                        refreshOdds()
                    }
                    override fun onStartTrackingTouch(sb: SeekBar) {}
                    override fun onStopTrackingTouch(sb: SeekBar) { save() }
                })
            }
            oddsList.addView(head)
            oddsList.addView(bar)
        }
        refreshOdds()
    }

    /** Подписи: заданное значение 0–100% и реальный шанс выпадения после нормировки. */
    private fun refreshOdds() {
        val p = Picker.probabilities(items.map { it.chance }, rigged)
        items.forEachIndexed { i, item ->
            oddsLabels.getOrNull(i)?.text = "${item.chance}%  →  выпадет ${fmt(p[i] * 100)}%"
        }
        val sum = items.sumOf { it.chance }
        oddsHint.text = when {
            !rigged -> "Подкрутка выключена: у всех вариантов равные шансы."
            sum == 0 -> "У всех 0% — шансы считаются равными."
            else -> "Реальный шанс = значение ÷ сумма всех значений. 0% — не выпадет никогда, " +
                "100% при остальных 0% — выпадет всегда. Сектора на колесе остаются одинаковыми."
        }
    }

    private fun fmt(v: Double): String {
        val r = (v * 10).roundToInt() / 10.0
        return if (r % 1.0 == 0.0) r.toInt().toString() else r.toString()
    }

    // --- Хранение ------------------------------------------------------------

    private fun prefs() = getSharedPreferences("wheel", Context.MODE_PRIVATE)

    private fun save() {
        val arr = JSONArray()
        items.forEach { arr.put(JSONObject().put("name", it.name).put("chance", it.chance)) }
        prefs().edit().putString("items", arr.toString()).putBoolean("rigged", rigged).apply()
    }

    private fun load() {
        items.clear()
        val p = prefs()
        rigged = p.getBoolean("rigged", false)
        try {
            val arr = JSONArray(p.getString("items", null) ?: "[]")
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                items.add(Item(o.optString("name"), o.optInt("chance", DEFAULT_CHANCE).coerceIn(0, 100)))
            }
        } catch (_: Exception) { items.clear() }
        if (items.size < MIN_ITEMS) {
            items.clear()
            listOf("Да", "Нет", "Может быть", "Ещё раз", "Точно да", "Точно нет").forEach { items.add(Item(it)) }
        }
    }

    private fun hideKeyboard() {
        currentFocus?.let {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(it.windowToken, 0)
            it.clearFocus()
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()

    companion object {
        const val MIN_ITEMS = 2
        const val MAX_ITEMS = 40
        const val DEFAULT_CHANCE = 50
    }
}
