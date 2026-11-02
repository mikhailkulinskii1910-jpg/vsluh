package ru.random.wheel

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.SystemClock
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.CompoundButton
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlin.random.Random

class MainActivity : Activity() {

    /** [on] — вариант на колесе (снимается вручную или при выбывании). */
    private class Item(var name: String, var chance: Int = DEFAULT_CHANCE, var on: Boolean = true, var size: Int = SIZE_ONE) {
        fun copy() = Item(name, chance, on, size)
    }

    private class Hit(val name: String, val time: Long)

    private val items = mutableListOf<Item>()
    private val history = mutableListOf<Hit>()
    private var rigged = false

    // настройки
    private var theme = Themes.all[0]
    private var speed = 1 // 0 быстро, 1 обычно, 2 долго
    private var spinMode = SpinMode.WHEEL // что вращается
    private var eliminate = false
    private var confettiOn = true
    private var soundOn = true
    private var vibroOn = true
    private var shakeOn = false
    private var keepAwake = false

    private lateinit var wheel: WheelView
    private lateinit var confetti: ConfettiView
    private lateinit var result: TextView
    private lateinit var resultNote: TextView
    private lateinit var resultActions: View
    private lateinit var restoreBtn: Button
    private lateinit var panels: List<View>
    private lateinit var tabs: List<Button>
    private lateinit var itemsList: LinearLayout
    private lateinit var itemsEmpty: TextView
    private lateinit var oddsList: LinearLayout
    private lateinit var historyList: LinearLayout
    private lateinit var countView: TextView
    private lateinit var riggedSwitch: Switch
    private lateinit var oddsHint: TextView
    private val oddsLabels = mutableListOf<TextView>()

    private var current = 0
    private var lastResult: String? = null
    private var lastResultIdx = 0
    /** Выпавший вариант в режиме выбывания: уходит с колеса перед следующим вращением. */
    private var pendingOut: Item? = null
    private var tone: ToneGenerator? = null
    private var lastShake = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        load()

        wheel = findViewById(R.id.wheel)
        confetti = findViewById(R.id.confetti)
        result = findViewById(R.id.result)
        resultNote = findViewById(R.id.resultNote)
        resultActions = findViewById(R.id.resultActions)
        restoreBtn = findViewById(R.id.restore)
        itemsList = findViewById(R.id.itemsList)
        itemsEmpty = findViewById(R.id.itemsEmpty)
        oddsList = findViewById(R.id.oddsList)
        historyList = findViewById(R.id.historyList)
        countView = findViewById(R.id.count)
        riggedSwitch = findViewById(R.id.rigged)
        oddsHint = findViewById(R.id.oddsHint)
        panels = listOf(R.id.panelWheel, R.id.panelItems, R.id.panelHistory, R.id.panelSettings, R.id.panelOdds)
            .map { findViewById(it) }
        tabs = listOf(R.id.tabWheel, R.id.tabItems, R.id.tabHistory, R.id.tabSettings).map { findViewById(it) }
        tabs.forEachIndexed { i, b -> b.setOnClickListener { show(i) } }

        findViewById<Button>(R.id.spin).setOnClickListener { spin() }
        wheel.setOnClickListener { spin() }
        // долгое нажатие на сектор — изменить его размер
        wheel.setOnLongClickListener {
            val idx = wheel.indexAt(wheel.lastTouchX, wheel.lastTouchY)
            if (idx >= 0 && !wheel.spinning) { applyPendingOut(); active().getOrNull(idx)?.let { editSize(it) } }
            true
        }
        wheel.onTick = {
            if (vibroOn) wheel.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            if (soundOn) tick()
        }
        findViewById<Button>(R.id.share).setOnClickListener { share() }
        restoreBtn.setOnClickListener { restoreAll() }

        // Нажатие на заголовок — подкрутка вкл/выкл (незаметный сигнал),
        // долгое нажатие — вход в скрытую вкладку «Шансы» по паролю.
        val title = findViewById<TextView>(R.id.title)
        title.setOnClickListener { toggleRig(title) }
        title.setOnLongClickListener { askPassword(); true }

        setupItems()
        setupSettings()

        riggedSwitch.setOnCheckedChangeListener { _, on -> rigged = on; save(); refreshOdds() }
        findViewById<Button>(R.id.oddsReset).setOnClickListener {
            items.forEach { it.chance = DEFAULT_CHANCE }
            save(); buildOdds()
        }
        findViewById<Button>(R.id.oddsClose).setOnClickListener { show(0) }
        findViewById<Button>(R.id.historyClear).setOnClickListener {
            if (history.isEmpty()) return@setOnClickListener
            confirm("Очистить историю?", "Очистить") { history.clear(); saveHistory(); buildHistory() }
        }

        applyTheme()
        updateWheel()
        show(0)
    }

    override fun onResume() {
        super.onResume()
        if (shakeOn) startShake()
    }

    override fun onPause() {
        stopShake()
        super.onPause()
    }

    override fun onDestroy() {
        tone?.release(); tone = null
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (current != 0) show(0) else super.onBackPressed()
    }

    private fun show(idx: Int) {
        if (idx != 0) applyPendingOut()
        when (idx) {
            1 -> buildItems()
            2 -> buildHistory()
            ODDS -> buildOdds()
        }
        current = idx
        panels.forEachIndexed { i, v -> v.visibility = if (i == idx) View.VISIBLE else View.GONE }
        tabs.forEachIndexed { i, b -> styleButton(b, i == idx) }
        if (idx != 1) hideKeyboard()
    }

    // --- Вращение ------------------------------------------------------------

    private fun active() = items.filter { it.on }

    private fun spin() {
        if (wheel.spinning) return
        applyPendingOut()
        val active = active()
        if (active.size < 2) {
            toast(when {
                active.size == 1 && items.size > 1 -> "Остался один: «${active[0].name}». Верните выбывших."
                else -> "Добавьте хотя бы 2 варианта"
            })
            return
        }
        result.text = ""
        resultNote.text = ""
        resultActions.visibility = View.INVISIBLE
        val idx = Picker.pick(active.map { it.chance }, rigged, Random.nextDouble(), active.map { it.size })
        wheel.spinTo(idx, SPEEDS[speed]) { onResult(active[idx], idx) }
    }

    private fun onResult(item: Item, idx: Int) {
        val name = item.name.ifBlank { "—" }
        lastResult = name
        lastResultIdx = idx
        result.setTextColor(wheel.colorOf(idx))
        result.text = name
        history.add(0, Hit(name, System.currentTimeMillis()))
        while (history.size > MAX_HISTORY) history.removeAt(history.lastIndex)
        saveHistory()
        if (eliminate) {
            pendingOut = item
            val left = active().size - 1
            resultNote.text = if (left <= 1) "Выбывает. Остался последний: ${active().firstOrNull { it !== item }?.name ?: ""}"
            else "Выбывает. Осталось вариантов: $left"
        }
        updateRestore()
        resultActions.visibility = View.VISIBLE
        if (confettiOn) confetti.burst(theme.palette)
    }

    private fun applyPendingOut() {
        val p = pendingOut ?: return
        pendingOut = null
        p.on = false
        save(); updateWheel()
    }

    private fun restoreAll() {
        pendingOut = null
        items.forEach { it.on = true }
        save(); updateWheel(); updateRestore()
        resultNote.text = ""
        toast("Все варианты снова на колесе")
    }

    private fun updateRestore() {
        restoreBtn.visibility = if (pendingOut != null || items.any { !it.on }) View.VISIBLE else View.GONE
    }

    private fun share() {
        val r = lastResult ?: return
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "Колесо random выбрало: «$r»")
        startActivity(Intent.createChooser(send, "Поделиться"))
    }

    private fun tick() {
        try {
            if (tone == null) tone = ToneGenerator(AudioManager.STREAM_MUSIC, 35)
            tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 12)
        } catch (_: Exception) { soundOn = false }
    }

    private fun updateWheel() {
        val a = active()
        wheel.sizes = a.map { it.size }
        wheel.labels = a.map { it.name }
        if (::countView.isInitialized) countView.text = items.size.toString()
    }

    private fun itemsChanged() {
        pendingOut = null
        save(); updateWheel(); buildItems(); result.text = ""; resultNote.text = ""
        resultActions.visibility = View.INVISIBLE
    }

    // --- Варианты -----------------------------------------------------------

    private fun setupItems() {
        findViewById<Button>(R.id.minus).setOnClickListener {
            if (items.isNotEmpty()) { items.removeAt(items.lastIndex); itemsChanged() }
        }
        findViewById<Button>(R.id.plus).setOnClickListener {
            if (items.size < MAX_ITEMS) { items.add(Item("Вариант ${items.size + 1}")); itemsChanged() }
            else toast("Не больше $MAX_ITEMS вариантов")
        }
        findViewById<Button>(R.id.clearAll).setOnClickListener {
            if (items.isEmpty()) return@setOnClickListener
            confirm("Удалить все варианты (${items.size})?", "Удалить все") { items.clear(); itemsChanged() }
        }
        findViewById<Button>(R.id.bulk).setOnClickListener { bulkAdd() }
        findViewById<Button>(R.id.templates).setOnClickListener { templates() }
        findViewById<Button>(R.id.shuffle).setOnClickListener { items.shuffle(); itemsChanged() }
        findViewById<Button>(R.id.sort).setOnClickListener {
            items.sortWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }); itemsChanged()
        }
        findViewById<Button>(R.id.copyAll).setOnClickListener {
            if (items.isEmpty()) return@setOnClickListener
            val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("random", items.joinToString("\n") { it.name }))
            toast("Список скопирован (${items.size}) — его можно вставить в «Списком»")
        }
    }

    /** Окно размера сектора: живой предпросмотр колеса, ползунок ×1…×10, переход между вариантами. */
    private fun editSize(start: Item) {
        var item = start
        val preview = WheelView(this).apply {
            theme = this@MainActivity.theme
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(250))
        }
        val name = text("", 18f, null, bold = true).apply {
            gravity = Gravity.CENTER; isSingleLine = true
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val info = text("", 14f, "muted").apply { gravity = Gravity.CENTER }
        val bar = SeekBar(this).apply { max = SIZE_STEPS.lastIndex; setPadding(dp(16), dp(10), dp(16), dp(10)) }
        fun refresh() {
            val a = active()
            preview.sizes = a.map { it.size }
            preview.labels = a.map { it.name }
            preview.highlight = a.indexOf(item)
            name.text = item.name.ifBlank { "—" }
            val share = if (item.on) item.size * 100.0 / a.sumOf { it.size } else 0.0
            info.text = if (item.on) "Размер ${sizeLabel(item.size)} · ${fmt(share)}% колеса — такой же шанс выпасть"
                else "Размер ${sizeLabel(item.size)} · вариант сейчас снят с колеса"
            bar.progress = SIZE_STEPS.indexOfFirst { it >= item.size }.let { if (it < 0) SIZE_STEPS.lastIndex else it }
        }
        bar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                if (!fromUser) return
                item.size = SIZE_STEPS[p]; updateWheel(); refresh()
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) { save() }
        })
        fun step(d: Int) {
            val list = active().ifEmpty { items }
            val i = list.indexOf(item)
            item = list[((if (i < 0) 0 else i + d) % list.size + list.size) % list.size]
            refresh()
        }
        // точная подстройка: шаг ±0.1 в обе стороны
        fun nudge(d: Int) { item.size = (item.size + d).coerceIn(1, MAX_SIZE); updateWheel(); refresh(); save() }
        val fine = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            fun b(t: String, d: Int) = Button(this@MainActivity, null, 0, R.style.Btn).apply {
                text = t; textSize = 18f; setPadding(0, 0, 0, 0)
                layoutParams = LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginStart = dp(4); marginEnd = dp(4) }
                setOnClickListener { nudge(d) }
            }
            addView(b("− меньше", -1)); addView(b("больше +", 1))
        }
        val nav = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
            fun arrow(t: String, d: Int) = Button(this@MainActivity, null, 0, R.style.Btn).apply {
                text = t; setPadding(0, 0, 0, 0)
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(44))
                setOnClickListener { step(d) }
            }
            addView(arrow("◀", -1)); addView(name); addView(arrow("▶", 1))
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), 0)
            addView(preview); addView(nav); addView(bar); addView(fine); addView(info)
        }
        paint(box)
        refresh()
        dialog().setView(box)
            .setPositiveButton("Готово") { _, _ -> save(); if (current == 1) buildItems() }
            .setNeutralButton("Все ×1") { _, _ ->
                items.forEach { it.size = SIZE_ONE }; save(); updateWheel(); if (current == 1) buildItems()
            }
            .setOnCancelListener { save(); if (current == 1) buildItems() }
            .show()
    }

    private fun buildItems() {
        countView.text = items.size.toString()
        itemsEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        itemsList.removeAllViews()
        // цвет точки — как у сектора на колесе
        val colorIdx = HashMap<Item, Int>()
        active().forEachIndexed { i, it -> colorIdx[it] = i }
        items.forEachIndexed { i, item ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(4), 0, dp(4))
            }
            val check = CheckBox(this).apply {
                isChecked = item.on
                layoutParams = LinearLayout.LayoutParams(dp(40), dp(48))
                setOnCheckedChangeListener { _, on ->
                    item.on = on
                    if (pendingOut === item) pendingOut = null
                    save(); updateWheel(); buildItems()
                }
            }
            val dot = View(this).apply {
                tag = "keep"
                background = round(colorIdx[item]?.let { wheel.colorOf(it) } ?: theme.muted, dp(3).toFloat())
                layoutParams = LinearLayout.LayoutParams(dp(6), dp(36)).apply { marginEnd = dp(8) }
            }
            val edit = EditText(this).apply {
                setText(item.name)
                hint = "Вариант ${i + 1}"
                textSize = 17f
                isSingleLine = true
                alpha = if (item.on) 1f else 0.45f
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                imeOptions = EditorInfo.IME_ACTION_DONE
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
            fun small(label: String, w: Int, click: () -> Unit) = Button(this, null, 0, R.style.Btn).apply {
                text = label
                textSize = 15f
                layoutParams = LinearLayout.LayoutParams(dp(w), dp(44)).apply { marginStart = dp(5) }
                setPadding(0, 0, 0, 0)
                setOnClickListener { click() }
            }
            val size = small(sizeLabel(item.size), 52) { editSize(item) }.apply { textSize = 13f }
            val copy = small("⧉", 42) {
                if (items.size >= MAX_ITEMS) toast("Не больше $MAX_ITEMS вариантов")
                else { items.add(items.indexOf(item) + 1, item.copy()); itemsChanged(); toast("Скопировано: «${item.name}»") }
            }
            val del = small("✕", 42) { items.remove(item); itemsChanged() }
            row.addView(check); row.addView(dot); row.addView(edit); row.addView(size); row.addView(copy); row.addView(del)
            paint(row)
            itemsList.addView(row)
        }
    }

    /** Добавление списком: каждая строка — отдельный вариант. */
    private fun bulkAdd() {
        val edit = EditText(this).apply {
            hint = "Каждый вариант с новой строки"
            minLines = 6
            gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        paint(edit)
        val box = LinearLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(edit) }
        fun lines() = edit.text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        dialog().setTitle("Добавить списком").setView(box)
            .setPositiveButton("Добавить") { _, _ ->
                lines().take(MAX_ITEMS - items.size).forEach { items.add(Item(it)) }
                itemsChanged()
            }
            .setNeutralButton("Заменить всё") { _, _ ->
                val l = lines()
                if (l.isNotEmpty()) { items.clear(); l.take(MAX_ITEMS).forEach { items.add(Item(it)) }; itemsChanged() }
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    /** Готовые шаблоны и сохранённые пользователем списки. */
    private fun templates() {
        val saved = loadSaved()
        val names = TEMPLATES.keys.toList() + saved.keys.map { "★ $it" }
        dialog().setTitle("Шаблоны")
            .setItems(names.toTypedArray()) { _, which ->
                if (which < TEMPLATES.size) {
                    val list = TEMPLATES.values.toList()[which]
                    items.clear(); list.forEach { items.add(Item(it)) }; itemsChanged()
                } else {
                    val key = saved.keys.toList()[which - TEMPLATES.size]
                    dialog().setTitle(key)
                        .setPositiveButton("Загрузить") { _, _ ->
                            items.clear(); items.addAll(parseItems(saved.getValue(key))); itemsChanged()
                        }
                        .setNeutralButton("Удалить") { _, _ ->
                            val all = JSONObject(prefs().getString("saved", null) ?: "{}")
                            all.remove(key)
                            prefs().edit().putString("saved", all.toString()).apply()
                        }
                        .setNegativeButton("Отмена", null)
                        .show()
                }
            }
            .setPositiveButton("Сохранить текущий") { _, _ -> saveCurrentAs() }
            .setNegativeButton("Закрыть", null)
            .show()
    }

    /**
     * Быстрое включение/выключение подкрутки нажатием на заголовок. Посторонним сигнал не виден:
     * включение — одна короткая вибрация и точка у «m» на миг, выключение — две вибрации.
     */
    private fun toggleRig(title: TextView) {
        rigged = !rigged
        save()
        if (current == ODDS) { riggedSwitch.isChecked = rigged; refreshOdds() }
        title.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING)
        if (!rigged) title.postDelayed({
            title.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS, HapticFeedbackConstants.FLAG_IGNORE_GLOBAL_SETTING)
        }, 180)
        title.text = if (rigged) "random." else "random"
        title.postDelayed({ title.text = getString(R.string.app_name) }, 700)
    }

    /** Вход в скрытую вкладку «Шансы» — только по паролю. */
    private fun askPassword() {
        if (current == ODDS) return
        PinDialog(this, theme, PASSWORD, pinLock) { show(ODDS) }.show()
    }

    /** Ошибки ввода пароля и блокировка (общие для всех открытий окна, до перезапуска приложения). */
    private val pinLock = PinDialog.Lock()

    private fun saveCurrentAs() {
        if (items.isEmpty()) { toast("Список пуст"); return }
        val edit = EditText(this).apply {
            hint = "Название списка"; isSingleLine = true
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        paint(edit)
        val box = LinearLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(edit) }
        dialog().setTitle("Сохранить список").setView(box)
            .setPositiveButton("Сохранить") { _, _ ->
                val name = edit.text.toString().trim().ifEmpty { "Список ${loadSaved().size + 1}" }
                val all = JSONObject(prefs().getString("saved", null) ?: "{}")
                all.put(name, itemsJson())
                prefs().edit().putString("saved", all.toString()).apply()
                toast("Сохранено: $name")
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    // --- История -------------------------------------------------------------

    /**
     * Шансы выпадения по размерам секторов — то, что видно на колесе. Скрытая подкрутка здесь
     * намеренно не показывается, чтобы вкладку можно было спокойно открыть при других.
     */
    private fun visibleChances(): List<Pair<Item, Double>> {
        val a = active()
        val p = Picker.probabilities(a.map { it.chance }, false, a.map { it.size })
        return a.mapIndexed { i, it -> it to p[i] }
    }

    /** Строка «название … значение» и полоска под ней. */
    private fun barRow(name: String, nameColor: Int?, value: String, share: Float, color: Int) {
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, dp(4))
        }
        head.addView(text(name, 15f, if (nameColor != null) "keep" else null).apply {
            isSingleLine = true
            nameColor?.let { setTextColor(it) }
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        head.addView(text(value, 15f, "muted"))
        historyList.addView(head)
        historyList.addView(LinearLayout(this).apply {
            tag = "keep"
            background = round(theme.panel, dp(4).toFloat())
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(8))
            weightSum = 1f
            addView(View(context).apply {
                tag = "keep"
                background = round(color, dp(4).toFloat())
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, share.coerceIn(0.005f, 1f))
            })
        })
    }

    /** «вращения» / «вращений» после числа: «за 21 вращение», «за 34 вращения», «за 15 вращений». */
    private fun spins(n: Int) = when {
        n % 100 in 11..14 -> "вращений"
        n % 10 == 1 -> "вращение"
        n % 10 in 2..4 -> "вращения"
        else -> "вращений"
    }

    private fun buildHistory() {
        historyList.removeAllViews()

        // шансы выпадения сейчас
        val chances = visibleChances()
        historyList.addView(text("Шансы выпадения", 18f, null, bold = true))
        if (chances.isEmpty()) {
            historyList.addView(text("На колесе нет вариантов.", 14f, "muted").apply { setPadding(0, dp(6), 0, 0) })
        } else {
            historyList.addView(text("По размеру секторов на колесе: чем больше сектор, тем выше шанс.", 13f, "muted")
                .apply { setPadding(0, dp(4), 0, 0) })
            val top = chances.maxOf { it.second }
            chances.sortedByDescending { it.second }.forEach { (item, p) ->
                val color = wheel.colorOf(active().indexOf(item))
                barRow(item.name.ifBlank { "—" }, color, "${sizeLabel(item.size)} · ${fmt(p * 100)}%",
                    (p / top).toFloat(), color)
            }
            // вероятность, что каждый выпадет хотя бы раз за N вращений — для самого редкого варианта
            val rare = chances.minByOrNull { it.second }!!
            if (chances.size > 1 && rare.second > 0) {
                val n = kotlin.math.ceil(kotlin.math.ln(0.1) / kotlin.math.ln(1 - rare.second)).toInt()
                historyList.addView(text("Реже всех — «${rare.first.name}»: в среднем 1 раз из ${fmt(1 / rare.second)}; " +
                    "с вероятностью 90% выпадет хотя бы раз за $n ${spins(n)}.", 13f, "muted").apply { setPadding(0, dp(10), 0, 0) })
            }
        }

        historyList.addView(text("Статистика", 18f, null, bold = true).apply { setPadding(0, dp(24), 0, 0) })
        if (history.isEmpty()) {
            historyList.addView(text("Пока пусто. Покрутите колесо — здесь появятся результаты: сколько раз выпал " +
                "каждый вариант и сколько ожидалось по шансам.", 14f, "muted").apply { setPadding(0, dp(6), 0, 0) })
            paint(historyList)
            return
        }
        historyList.addView(text("Всего вращений: ${history.size} · выпало / ожидалось по шансам", 13f, "muted")
            .apply { setPadding(0, dp(4), 0, 0) })
        val expected = chances.groupBy { it.first.name.ifBlank { "—" } }.mapValues { e -> e.value.sumOf { it.second } }
        val counts = history.groupingBy { it.name }.eachCount().entries.sortedByDescending { it.value }
        val max = counts.first().value
        counts.forEach { (name, n) ->
            val exp = expected[name]?.let { " · ожидалось ${fmt(it * 100)}%" } ?: ""
            barRow(name, null, "$n · ${fmt(n * 100.0 / history.size)}%$exp", n.toFloat() / max, theme.accent)
        }
        historyList.addView(text("Последние", 18f, null, bold = true).apply { setPadding(0, dp(22), 0, dp(4)) })
        val fmtTime = SimpleDateFormat("d MMM, HH:mm", Locale("ru"))
        history.take(50).forEach { h ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(6), 0, dp(6))
            }
            row.addView(text(fmtTime.format(Date(h.time)), 14f, "muted").apply {
                layoutParams = LinearLayout.LayoutParams(dp(120), LinearLayout.LayoutParams.WRAP_CONTENT)
            })
            row.addView(text(h.name, 15f, null))
            historyList.addView(row)
        }
        paint(historyList)
    }

    // --- Настройки -----------------------------------------------------------

    private fun setupSettings() {
        fun opt(id: Int, value: Boolean, set: (Boolean) -> Unit) {
            findViewById<Switch>(id).apply {
                isChecked = value
                setOnCheckedChangeListener { _, on -> set(on); saveSettings() }
            }
        }
        opt(R.id.optEliminate, eliminate) { eliminate = it; if (!it) pendingOut = null }
        opt(R.id.optConfetti, confettiOn) { confettiOn = it }
        opt(R.id.optSound, soundOn) { soundOn = it }
        opt(R.id.optVibro, vibroOn) { vibroOn = it }
        opt(R.id.optShake, shakeOn) { shakeOn = it; if (it) startShake() else stopShake() }
        opt(R.id.optAwake, keepAwake) { keepAwake = it; applyAwake() }
        applyAwake()

        val modeRow = findViewById<LinearLayout>(R.id.modeRow)
        SpinMode.entries.chunked(3).forEach { line ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            line.forEachIndexed { k, m ->
                row.addView(Button(this, null, 0, R.style.Btn).apply {
                    text = m.title; tag = m
                    textSize = 14f; setPadding(dp(2), 0, dp(2), 0)
                    layoutParams = LinearLayout.LayoutParams(0, dp(48), 1f).apply {
                        if (k > 0) marginStart = dp(6); topMargin = dp(8)
                    }
                    setOnClickListener {
                        if (wheel.spinning) return@setOnClickListener
                        spinMode = m; wheel.mode = m; saveSettings(); styleSpeed()
                    }
                })
            }
            modeRow.addView(row)
        }
        wheel.mode = spinMode

        val speedRow = findViewById<LinearLayout>(R.id.speedRow)
        for (i in 0 until speedRow.childCount) speedRow.getChildAt(i).setOnClickListener {
            speed = i; saveSettings(); styleSpeed()
        }
    }

    private fun styleSpeed() {
        val row = findViewById<LinearLayout>(R.id.speedRow)
        for (i in 0 until row.childCount) styleButton(row.getChildAt(i) as Button, i == speed)
        val modes = findViewById<LinearLayout>(R.id.modeRow)
        for (i in 0 until modes.childCount) (modes.getChildAt(i) as ViewGroup).let { row ->
            for (k in 0 until row.childCount) (row.getChildAt(k) as Button).let { styleButton(it, it.tag == spinMode) }
        }
    }

    private fun buildThemes() {
        val grid = findViewById<LinearLayout>(R.id.themesGrid)
        grid.removeAllViews()
        Themes.all.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            pair.forEachIndexed { k, t ->
                val chip = LinearLayout(this).apply {
                    tag = "keep"
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(12), dp(10), dp(12), dp(10))
                    background = GradientDrawable().apply {
                        setColor(t.bg); cornerRadius = dp(14).toFloat()
                        setStroke(dp(if (t === theme) 3 else 1), if (t === theme) t.accent else t.panel)
                    }
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        if (k == 1) marginStart = dp(8)
                        topMargin = dp(8)
                    }
                    setOnClickListener { theme = t; saveSettings(); applyTheme() }
                }
                val dots = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                t.palette.take(6).forEach { c ->
                    dots.addView(View(this).apply {
                        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(c) }
                        layoutParams = LinearLayout.LayoutParams(dp(14), dp(14)).apply { marginEnd = dp(4) }
                    })
                }
                chip.addView(dots)
                chip.addView(TextView(this).apply {
                    tag = "keep"
                    text = if (t === theme) "✓ ${t.title}" else t.title
                    setTextColor(t.text); textSize = 15f
                    setPadding(0, dp(6), 0, 0)
                })
                row.addView(chip)
            }
            // нечётная последняя тема — половина ширины, как остальные
            if (pair.size == 1) row.addView(View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = dp(8) }
            })
            grid.addView(row)
        }
    }

    private fun applyAwake() {
        if (keepAwake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // --- Встряхивание --------------------------------------------------------

    private val shakeListener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val (x, y, z) = Triple(e.values[0], e.values[1], e.values[2])
            val g = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
            val now = SystemClock.uptimeMillis()
            if (g > 2.6f && now - lastShake > 1500) {
                lastShake = now
                if (current == 0) spin()
            }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }

    private fun startShake() {
        val sm = getSystemService(SENSOR_SERVICE) as? SensorManager ?: return
        val acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        sm.registerListener(shakeListener, acc, SensorManager.SENSOR_DELAY_UI)
    }

    private fun stopShake() {
        (getSystemService(SENSOR_SERVICE) as? SensorManager)?.unregisterListener(shakeListener)
    }

    // --- Скрытая вкладка «Шансы» ---------------------------------------------

    private fun buildOdds() {
        riggedSwitch.isChecked = rigged
        oddsList.removeAllViews()
        oddsLabels.clear()
        if (items.isEmpty()) oddsList.addView(text("Нет вариантов.", 15f, "muted"))
        val colorIdx = HashMap<Item, Int>()
        active().forEachIndexed { i, it -> colorIdx[it] = i }
        items.forEachIndexed { i, item ->
            val head = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(12), 0, 0)
            }
            val name = TextView(this).apply {
                tag = "keep"
                text = item.name.ifBlank { "Вариант ${i + 1}" }
                setTextColor(colorIdx[item]?.let { wheel.colorOf(it) } ?: theme.muted)
                textSize = 16f
                isSingleLine = true
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val value = TextView(this).apply { textSize = 15f }
            head.addView(name); head.addView(value)
            oddsLabels.add(value)

            val bar = SeekBar(this).apply {
                max = 100
                progress = item.chance
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                        if (!fromUser) return
                        item.chance = p
                        // ползунок тронули — подкрутка включается сама
                        if (!rigged) { rigged = true; riggedSwitch.isChecked = true; save() }
                        refreshOdds()
                    }
                    override fun onStartTrackingTouch(sb: SeekBar) {}
                    override fun onStopTrackingTouch(sb: SeekBar) { save() }
                })
            }
            oddsList.addView(head)
            oddsList.addView(bar)
        }
        paint(oddsList)
        refreshOdds()
    }

    /** Подписи: заданное значение 0–100% и реальный шанс выпадения (только среди вариантов на колесе). */
    private fun refreshOdds() {
        val active = active()
        val p = Picker.probabilities(active.map { it.chance }, rigged, active.map { it.size })
        items.forEachIndexed { i, item ->
            val k = active.indexOf(item)
            oddsLabels.getOrNull(i)?.text =
                if (k < 0) "${item.chance}%  ·  не на колесе" else "${item.chance}%  →  выпадет ${fmt(p[k] * 100)}%"
        }
        val sure = active.count { it.chance >= 100 }
        oddsHint.text = when {
            !rigged -> "Подкрутка выключена: шанс = размер сектора на колесе. Сдвиньте любой ползунок — она включится."
            active.isNotEmpty() && active.all { it.chance == 0 } -> "У всех 0% — выбирать не из чего, шанс = размер сектора."
            sure > 1 -> "100% у нескольких вариантов — выпадает только один из них (по размеру сектора). 0% — никогда."
            sure == 1 -> "100% — этот вариант выпадает всегда. 0% — никогда."
            else -> "100% — выпадает всегда, 0% — никогда. Остальные: шанс пропорционален значению × размер сектора. " +
                "Вид колеса подкрутка не меняет."
        }
    }

    // --- Оформление ----------------------------------------------------------

    private fun applyTheme() {
        val t = theme
        window.statusBarColor = t.bg
        window.navigationBarColor = t.bg
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = if (t.light)
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0
        val root = findViewById<View>(R.id.root)
        root.setBackgroundColor(t.bg)
        wheel.theme = t
        paint(root)
        result.setTextColor(wheel.colorOf(lastResultIdx))
        buildThemes()
        styleSpeed()
        tabs.forEachIndexed { i, b -> styleButton(b, i == current) }
        if (current == 1) buildItems()
        if (current == 2) buildHistory()
        if (current == ODDS) buildOdds()
    }

    /** Красит view и всех потомков по текущей теме. */
    private fun paint(v: View) {
        val t = theme
        if (v.tag == "keep") { if (v is ViewGroup) for (i in 0 until v.childCount) paint(v.getChildAt(i)); return }
        val accentList = ColorStateList.valueOf(t.accent)
        when (v) {
            is Switch -> {
                v.setTextColor(t.text)
                v.thumbTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                    intArrayOf(t.accent, if (t.light) 0xFFF0F0F0.toInt() else t.muted))
                v.trackTintList = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                    intArrayOf(t.accent, t.muted))
            }
            is CompoundButton -> { v.buttonTintList = accentList; v.setTextColor(t.text) }
            is EditText -> {
                v.setTextColor(t.text); v.setHintTextColor(t.muted)
                v.background = round(t.panel, dp(12).toFloat())
                v.backgroundTintList = null
            }
            is Button -> styleButton(v, v.tag == "accent")
            is SeekBar -> {
                v.progressTintList = accentList; v.thumbTintList = accentList
                v.progressBackgroundTintList = ColorStateList.valueOf(t.muted)
            }
            is TextView -> v.setTextColor(if (v.tag == "muted") t.muted else t.text)
            is ViewGroup -> for (i in 0 until v.childCount) paint(v.getChildAt(i))
        }
    }

    private fun styleButton(b: Button, accent: Boolean) {
        val t = theme
        b.background = ripple(if (accent) t.accent else t.panel, dp(if (b.id == R.id.spin) 16 else 14).toFloat())
        b.setTextColor(if (accent) t.onAccent else t.text)
        if (!b.isEnabled) b.alpha = 0.4f
    }

    private fun round(color: Int, r: Float) = GradientDrawable().apply { setColor(color); cornerRadius = r }

    private fun ripple(color: Int, r: Float): Drawable =
        RippleDrawable(ColorStateList.valueOf(if (theme.light) 0x22000000 else 0x33FFFFFF), round(color, r), null)

    /** «×0.5», «×1», «×2.5». */
    private fun sizeLabel(tenths: Int) = "×" + fmt(tenths / 10.0)

    private fun text(s: String, size: Float, tag: String?, bold: Boolean = false) = TextView(this).apply {
        text = s; textSize = size; this.tag = tag
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun dialog() = AlertDialog.Builder(this,
        if (theme.light) android.R.style.Theme_Material_Light_Dialog_Alert else android.R.style.Theme_Material_Dialog_Alert)

    private fun confirm(msg: String, yes: String, action: () -> Unit) {
        dialog().setMessage(msg).setPositiveButton(yes) { _, _ -> action() }.setNegativeButton("Отмена", null).show()
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    private fun fmt(v: Double): String {
        val r = (v * 10).roundToInt() / 10.0
        return if (r % 1.0 == 0.0) r.toInt().toString() else r.toString()
    }

    // --- Хранение ------------------------------------------------------------

    private fun prefs() = getSharedPreferences("wheel", Context.MODE_PRIVATE)

    private fun itemsJson() = JSONArray().apply {
        items.forEach { put(JSONObject().put("name", it.name).put("chance", it.chance).put("on", it.on).put("size10", it.size)) }
    }

    private fun parseItems(arr: JSONArray) = (0 until arr.length()).map {
        val o = arr.getJSONObject(it)
        Item(o.optString("name"), o.optInt("chance", DEFAULT_CHANCE).coerceIn(0, 100), o.optBoolean("on", true),
            // size10 — десятые доли (×0.1…×10); старое поле size хранило целые ×1…×10
            (if (o.has("size10")) o.optInt("size10", SIZE_ONE) else o.optInt("size", 1) * SIZE_ONE).coerceIn(1, MAX_SIZE))
    }

    private fun loadSaved(): Map<String, JSONArray> = try {
        val o = JSONObject(prefs().getString("saved", null) ?: "{}")
        o.keys().asSequence().associateWith { o.getJSONArray(it) }
    } catch (_: Exception) { emptyMap() }

    private fun save() {
        prefs().edit().putString("items", itemsJson().toString()).putBoolean("rigged", rigged).apply()
    }

    private fun saveHistory() {
        val arr = JSONArray()
        history.forEach { arr.put(JSONObject().put("n", it.name).put("t", it.time)) }
        prefs().edit().putString("history", arr.toString()).apply()
    }

    private fun saveSettings() {
        prefs().edit()
            .putString("theme", theme.id).putInt("speed", speed).putString("mode", spinMode.id)
            .putBoolean("eliminate", eliminate).putBoolean("confetti", confettiOn)
            .putBoolean("sound", soundOn).putBoolean("vibro", vibroOn)
            .putBoolean("shake", shakeOn).putBoolean("awake", keepAwake)
            .apply()
    }

    private fun load() {
        val p = prefs()
        rigged = p.getBoolean("rigged", false)
        theme = Themes.byId(p.getString("theme", null))
        speed = p.getInt("speed", 1).coerceIn(0, SPEEDS.lastIndex)
        // раньше был только переключатель «стрелка»
        spinMode = SpinMode.byId(p.getString("mode", null) ?: if (p.getBoolean("arrow", false)) "arrow" else null)
        eliminate = p.getBoolean("eliminate", false)
        confettiOn = p.getBoolean("confetti", true)
        soundOn = p.getBoolean("sound", true)
        vibroOn = p.getBoolean("vibro", true)
        shakeOn = p.getBoolean("shake", false)
        keepAwake = p.getBoolean("awake", false)
        items.clear()
        val raw = p.getString("items", null)
        try { items.addAll(parseItems(JSONArray(raw ?: "[]"))) } catch (_: Exception) { items.clear() }
        // при первом запуске — пример; пустой список, оставленный пользователем, не трогаем
        if (raw == null) TEMPLATES.getValue("Да / Нет / Может быть").forEach { items.add(Item(it)) }
        history.clear()
        try {
            val arr = JSONArray(p.getString("history", null) ?: "[]")
            for (i in 0 until arr.length()) arr.getJSONObject(i).let { history.add(Hit(it.optString("n"), it.optLong("t"))) }
        } catch (_: Exception) { history.clear() }
    }

    private fun hideKeyboard() {
        currentFocus?.let {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(it.windowToken, 0)
            it.clearFocus()
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()

    companion object {
        const val MAX_ITEMS = 100
        /** Размер сектора хранится в десятых: 10 = ×1, 1 = ×0.1, 100 = ×10. */
        const val SIZE_ONE = 10
        const val MAX_SIZE = 100
        /** Шаги ползунка размера: мельче ×1 — по 0.1, крупнее — по 0.5/1. */
        val SIZE_STEPS = intArrayOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100)
        const val MAX_HISTORY = 300
        const val DEFAULT_CHANCE = 50
        const val ODDS = 4
        const val PASSWORD = "1910"
        /** Базовая длительность вращения, мс: быстро / обычно / долго. */
        val SPEEDS = longArrayOf(2200, 4200, 7500)

        val TEMPLATES = linkedMapOf(
            "Да / Нет / Может быть" to listOf("Да", "Нет", "Может быть", "Ещё раз", "Точно да", "Точно нет"),
            "Да / Нет" to listOf("Да", "Нет"),
            "Монетка" to listOf("Орёл", "Решка"),
            "Кубик 1–6" to (1..6).map { it.toString() },
            "Числа 1–10" to (1..10).map { it.toString() },
            "Что поесть" to listOf("Пицца", "Суши", "Бургер", "Шаурма", "Паста", "Салат", "Суп", "Пельмени"),
            "Чем заняться" to listOf("Фильм", "Прогулка", "Игра", "Книга", "Спорт", "Готовка", "Музыка", "Сон"),
            "Правда или действие" to listOf("Правда", "Действие"),
            "Кто платит" to listOf("Я", "Ты", "Пополам", "Тот, кто левее", "Самый младший", "Самый старший"),
        )
    }
}
