package ru.irbis.remote

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : Activity() {

    private enum class Mode { BUILTIN, AUTO, USB, AUDIO2, AUDIO1 }

    private val ui = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var usb: UsbManager
    private lateinit var builtin: BuiltinIr
    @Volatile private var usbIr: UsbIr? = null
    private var usbIrDevice: String? = null
    private lateinit var audio: AudioManager
    private var mode = Mode.BUILTIN

    private lateinit var modeLine: TextView
    private lateinit var status: TypeLine
    private val pressSeq = AtomicInteger(0)
    /** Номер нажатия, кнопка которого сейчас зажата; 0 — ничего не зажато. */
    @Volatile private var held = 0

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val d = i.usbDevice() ?: return
            when (i.action) {
                ACTION_PERMISSION ->
                    if (i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) connect(d)
                    else say("Нет доступа к USB-передатчику", err = true)
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> { findUsb(null); ui.postDelayed({ renderMode() }, 1000) }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    if (d.deviceName == usbIrDevice) {
                        usbIr?.let { ir -> io.execute { ir.close() } }
                        usbIr = null
                        usbIrDevice = null
                        say("USB-передатчик отключён")
                    }
                    ui.postDelayed({ renderMode() }, 500)
                }
            }
        }
    }

    /** Тема оформления: «terminal» (по умолчанию), «prism» или «thermal». Меняется в [tx] → «Тема». */
    private val themeId get() = getPreferences(MODE_PRIVATE).getString(PREF_THEME, "terminal") ?: "terminal"

    override fun onCreate(savedInstanceState: Bundle?) {
        when (themeId) {
            "prism" -> setTheme(R.style.Theme_Prism)
            "thermal" -> setTheme(R.style.Theme_Thermal)
        }
        super.onCreate(savedInstanceState)
        usb = getSystemService(USB_SERVICE) as UsbManager
        builtin = BuiltinIr(this)
        audio = getSystemService(AUDIO_SERVICE) as AudioManager
        // По умолчанию — встроенный ИК-порт. Ключ новый, чтобы после обновления старый выбор «Авто» не мешал.
        mode = runCatching { Mode.valueOf(getPreferences(MODE_PRIVATE).getString(PREF_MODE, null)!!) }.getOrDefault(Mode.BUILTIN)
        setContentView(buildUi(withSplash = savedInstanceState == null))

        val f = IntentFilter().apply { addAction(ACTION_PERMISSION); addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED); addAction(UsbManager.ACTION_USB_DEVICE_DETACHED) }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(usbReceiver, f, RECEIVER_NOT_EXPORTED) else registerReceiver(usbReceiver, f)

        findUsb(intent)
        renderMode()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        findUsb(intent)
    }

    override fun onDestroy() {
        unregisterReceiver(usbReceiver)
        usbIr?.let { ir -> io.execute { ir.close() } }
        io.shutdown()
        super.onDestroy()
    }

    /* ---------- USB ---------- */

    override fun onResume() {
        super.onResume()
        renderMode()   // ИК-порт или адаптер могли появиться, пока приложение было свёрнуто
    }

    private fun findUsb(intent: Intent?) {
        if (usbIr != null) return
        val d = intent?.takeIf { it.action == UsbManager.ACTION_USB_DEVICE_ATTACHED }?.usbDevice()?.takeIf { UsbIr.supports(it) }
            ?: usb.deviceList.values.firstOrNull { UsbIr.supports(it) }
            ?: return
        useUsb(d)
    }

    /** Открыть USB-устройство как ИК-передатчик (при необходимости спросить доступ). */
    private fun useUsb(d: UsbDevice) {
        if (usb.hasPermission(d)) connect(d)
        else {
            val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            val pi = PendingIntent.getBroadcast(this, 0, Intent(ACTION_PERMISSION).setPackage(packageName), flags)
            usb.requestPermission(d, pi)
        }
    }

    private fun connect(d: UsbDevice) = io.execute {
        val ir = runCatching { UsbIr.open(usb, d) }.getOrNull()
        ui.post {
            usbIr?.takeIf { it !== ir }?.let { old -> io.execute { old.close() } }
            usbIr = ir
            usbIrDevice = if (ir != null) d.deviceName else null
            if (ir != null) say("USB-передатчик готов", ok = true) else say("Не удалось открыть USB-передатчик", err = true)
            renderMode()
        }
    }

    /* ---------- Передача ---------- */

    private val audio2 by lazy { AudioIr(this, twoLeds = true) }
    private val audio1 by lazy { AudioIr(this, twoLeds = false) }

    private fun current(): IrTransmitter? = when (mode) {
        Mode.USB -> usbIr
        Mode.BUILTIN -> builtin.takeIf { it.available }
        Mode.AUDIO2 -> audio2
        Mode.AUDIO1 -> audio1
        // Звуковой USB-C адаптер система видит как наушники — берём его, если ничего другого нет.
        Mode.AUTO -> usbIr ?: builtin.takeIf { it.available } ?: audio2.takeIf { AudioIr.adapterOutput(audio) != null }
    }

    private fun press(label: String, code: Long) {
        val tx = current() ?: return say(noTxMessage(), err = true)
        val frame = Nec.withGap(Nec.frame(code))
        val repeat = Nec.withGap(Nec.REPEAT)
        val id = pressSeq.incrementAndGet()
        held = id
        say("> tx %-11s 0x%08X [sent]".format(label, code))
        io.execute {
            try {
                var next = System.currentTimeMillis()
                tx.transmit(frame)
                if (label !in REPEATABLE) return@execute
                // Удержание: после паузы 400 мс — повторы каждые 108 мс, пока палец на кнопке.
                next += 400
                while (held == id) {
                    val wait = next - System.currentTimeMillis()
                    if (wait > 0) Thread.sleep(wait)
                    if (held != id) break
                    tx.transmit(repeat)
                    next = maxOf(next + Nec.FRAME_PERIOD_MS, System.currentTimeMillis())
                }
            } catch (e: Exception) {
                ui.post { say(e.message ?: "Ошибка передачи", err = true) }
            }
        }
    }

    private fun noTxMessage() = when (mode) {
        Mode.USB -> "USB-C передатчик не найден — ⚙ → Проверка"
        Mode.BUILTIN -> "Встроенный ИК-порт не найден"
        else -> "Передатчик не найден — нажмите ⚙ → Проверка"
    }

    /* ---------- Интерфейс ---------- */

    private val keyViews = ArrayList<KeyView>()
    private lateinit var bg: TerminalBackground

    private fun buildUi(withSplash: Boolean): View {
        Term.init(this, themeId, getPreferences(MODE_PRIVATE).getInt(PREF_COLOR, Term.DEFAULT_COLOR))
        val frame = FrameLayout(this)
        bg = TerminalBackground(this)
        frame.addView(bg, FrameLayout.LayoutParams(-1, -1))

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(20))
        }

        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.TOP }
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val title = TypeLine(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 54f)
            typeface = Term.mono
            setTextColor(Term.FG)
            setShadowLayer(dp(10).toFloat(), 0f, 0f, if (Term.prism) Color.parseColor("#8B6CFF") else if (Term.thermal) Heat.GLOW else Term.FG)
            includeFontPadding = false
        }
        if (Term.prism) {
            // заголовок залит радугой, перелив медленно «плывёт»
            title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
            val shift = android.graphics.Matrix()
            val flow = object : Runnable {
                override fun run() {
                    val w = title.width.toFloat().coerceAtLeast(1f)
                    val sh = android.graphics.LinearGradient(0f, 0f, w, 0f, Term.IRIS, null, android.graphics.Shader.TileMode.MIRROR)
                    shift.setTranslate((System.currentTimeMillis() % 6000L) / 6000f * w * 2, 0f); sh.setLocalMatrix(shift)
                    title.paint.shader = sh; title.invalidate()
                    title.postDelayed(this, 50)
                }
            }
            title.post(flow)
        }
        if (Term.thermal) {
            // заголовок «раскалён»: по нему медленно плывёт палитра ironbow
            val shift = android.graphics.Matrix()
            val hot = intArrayOf(Heat.color(0.5f), Heat.color(0.68f), Heat.color(0.85f), Heat.color(1f), Heat.color(0.85f), Heat.color(0.68f), Heat.color(0.5f))
            val flow = object : Runnable {
                override fun run() {
                    val w = title.width.toFloat().coerceAtLeast(1f)
                    val sh = android.graphics.LinearGradient(0f, 0f, w, 0f, hot, null, android.graphics.Shader.TileMode.MIRROR)
                    shift.setTranslate((System.currentTimeMillis() % 5000L) / 5000f * w * 2, 0f); sh.setLocalMatrix(shift)
                    title.paint.shader = sh; title.invalidate()
                    title.postDelayed(this, 50)
                }
            }
            title.post(flow)
        }
        titles.addView(title)
        subtitle = text("#500202 :: IRBIS :: NEC 38kHz", if (Term.prism) 13f else 18f, Term.DIM)
        if (Term.prism) subtitle.typeface = Term.ru
        titles.addView(subtitle)
        modeLine = text("", 15f, Term.FG).apply {
            typeface = Term.ru; setPadding(0, dp(6), 0, 0)
            isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END
        }
        titles.addView(modeLine)
        header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        val gear = TextView(this).apply {
            text = "[tx]"
            typeface = Term.mono
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTextColor(Term.FG)
            gravity = Gravity.CENTER
            background = Term.boxBg(this@MainActivity)
            contentDescription = "Передатчик"
            setOnClickListener { glitch(it); chooseMode() }
        }
        val help = TextView(this).apply {
            text = "[?]"
            typeface = Term.mono
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTextColor(Term.FG)
            gravity = Gravity.CENTER
            background = Term.boxBg(this@MainActivity)
            contentDescription = "Как пользоваться"
            setOnClickListener { glitch(it); showHelp() }
        }
        header.addView(help, LinearLayout.LayoutParams(dp(52), dp(44)).apply { topMargin = dp(10); rightMargin = dp(8) })
        header.addView(gear, LinearLayout.LayoutParams(dp(64), dp(44)).apply { topMargin = dp(10) })
        root.addView(header)

        // вкладки: IRBIS и MocTec (пульты), «Рулетка» (подбор кода), в «Терминале» ещё «Цвет».
        // Без выравнивания по базовой линии: у русских подписей другой шрифт, и вкладка уезжала вниз.
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; isBaselineAligned = false }
        tabIrbis = tabButton("IRBIS") { showTab(TAB_IRBIS) }
        tabMoc = tabButton("MocTec") { showTab(TAB_MOC) }
        // русские подписи — другим шрифтом (в VT323 нет кириллицы) и чуть мельче, чтобы четыре вкладки поместились
        tabRoulette = tabButton("Рулетка") { showTab(TAB_ROULETTE) }.apply { if (!Term.prism) { typeface = Term.ru; setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f) } }
        val colorTab = !Term.prism && !Term.thermal
        val tabList = mutableListOf(tabIrbis, tabMoc, tabRoulette)
        if (colorTab) tabList += tabButton("Цвет") { showTab(TAB_COLOR) }.apply { typeface = Term.ru; setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f) }.also { tabColor = it }
        tabList.forEachIndexed { i, t ->
            tabs.addView(t, LinearLayout.LayoutParams(0, dp(40), 1f).apply { if (i > 0) leftMargin = dp(6) })
        }
        root.addView(tabs, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })

        irbisGrid = keyGrid(KEYS)
        root.addView(irbisGrid, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        mocGrid = keyGrid(MOC_KEYS)
        root.addView(mocGrid, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        mocPanel = buildMocPanel()
        root.addView(mocPanel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        if (colorTab) {
            colorPanel = buildColorPanel()
            root.addView(colorPanel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        }
        val prefs = getPreferences(MODE_PRIVATE)
        var start = prefs.getString(PREF_TAB, null) ?: TAB_IRBIS
        if (start == TAB_COLOR && !colorTab) start = TAB_IRBIS
        showTab(start)

        status = TypeLine(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Term.DIM)
            setPadding(dp(6), dp(12), 0, 0)
        }
        root.addView(status)

        frame.addView(ScrollView(this).apply { isFillViewport = true; addView(root) }, FrameLayout.LayoutParams(-1, -1))

        val showUi: () -> Unit = {
            title.type("krisa")
            keyViews.forEachIndexed { i, k -> k.reveal(60L * i) }
            (status as TypeLine).type("> ready. ${KEYS.size} keys loaded")
            ui.postDelayed({ checkIrPort() }, 900)
        }
        if (withSplash) {
            val boot = listOf(
                "krisa ir-remote v$versionName",
                "loading nec table ........ [ok]",
                "consumer_ir .............. [" + (if (builtin.available) "ok" else "--") + "]",
                "usb ir ................... [" + (if (usb.deviceList.values.any { UsbIr.supports(it) }) "ok" else "--") + "]",
                "decoding rat.png ......... [ok]",
            )
            lateinit var splash: SplashView
            splash = SplashView(this, boot) { frame.removeView(splash); showUi() }
            frame.addView(splash, FrameLayout.LayoutParams(-1, -1))
        } else ui.post(showUi)
        return frame
    }

    private val versionName get() = packageManager.getPackageInfo(packageName, 0).versionName

    /** Сетка кнопок пульта (12 штук на один экран, как в IrCode Finder). */
    private fun keyGrid(keys: List<Pair<String, Long>>): GridLayout {
        val grid = GridLayout(this).apply { columnCount = 2; useDefaultMargins = false }
        val gap = dp(5)
        val rowH = ((resources.configuration.screenHeightDp - 300) / 6 - 10).coerceIn(60, 110)
        keys.forEachIndexed { i, (label, code) ->
            val k = KeyView(this, label, i, code, inverted = label == "POWER")
            k.setOnTouchListener { v, e -> onKeyTouch(v as KeyView, e, label, code) }
            keyViews += k
            grid.addView(k, GridLayout.LayoutParams(GridLayout.spec(i / 2), GridLayout.spec(i % 2, 1f)).apply {
                width = 0; height = dp(rowH)
                setMargins(gap, gap, gap, gap)
            })
        }
        return grid
    }

    /* ---------- Вкладка «Рулетка»: подбор кода по очереди ---------- */

    private lateinit var subtitle: TextView
    private lateinit var tabIrbis: TextView
    private lateinit var tabMoc: TextView
    private lateinit var tabRoulette: TextView
    private lateinit var mocGrid: View
    private lateinit var irbisGrid: View
    private lateinit var mocPanel: View
    private lateinit var mocCode: TextView
    private lateinit var mocInfo: TextView
    private lateinit var mocRecent: TextView
    private lateinit var mocFound: TextView
    private lateinit var mocPlay: TextView
    @Volatile private var mocRun = false
    @Volatile private var mocIdx = 0
    private val mocSent = ArrayDeque<Int>()

    /** Сколько кодов в «Рулетке»: все 256 команд на каждом адресе из [ROULETTE_ADDR]. */
    private val rouletteSize = ROULETTE_ADDR.size * 256

    /** Код номер idx «Рулетки»: адрес idx / 256, команда idx % 256, затем инверсия команды (NEC). */
    private fun mocCodeOf(idx: Int): Long {
        val addr = ROULETTE_ADDR[(idx / 256).coerceIn(0, ROULETTE_ADDR.size - 1)].toLong()
        val cmd = idx and 0xFF
        return (addr shl 16) or (cmd.toLong() shl 8) or ((cmd.inv() and 0xFF).toLong())
    }

    private fun tabButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label
        typeface = Term.mono
        isSingleLine = true
        includeFontPadding = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (Term.prism) 14f else 20f)
        gravity = Gravity.CENTER
        setOnClickListener { glitch(it); onClick() }
    }

    private fun styleTab(t: TextView, on: Boolean) {
        t.setTextColor(if (on) Term.onBoxText() else Term.FG)
        t.background = Term.boxBg(this, on)
    }

    private fun showTab(tab: String) {
        if (tab != TAB_ROULETTE) mocRun = false
        styleTab(tabIrbis, tab == TAB_IRBIS); styleTab(tabMoc, tab == TAB_MOC); styleTab(tabRoulette, tab == TAB_ROULETTE)
        tabColor?.let { styleTab(it, tab == TAB_COLOR) }
        irbisGrid.visibility = if (tab == TAB_IRBIS) View.VISIBLE else View.GONE
        mocGrid.visibility = if (tab == TAB_MOC) View.VISIBLE else View.GONE
        mocPanel.visibility = if (tab == TAB_ROULETTE) View.VISIBLE else View.GONE
        colorPanel?.visibility = if (tab == TAB_COLOR) View.VISIBLE else View.GONE
        subtitle.text = when (tab) {
            TAB_MOC -> "MocTec :: MOSTEH :: NEC 04FB"
            TAB_ROULETTE -> "рулетка :: подбор :: NEC"
            TAB_COLOR -> "terminal :: phosphor color"
            else -> "#500202 :: IRBIS :: NEC 38kHz"
        }
        getPreferences(MODE_PRIVATE).edit().putString(PREF_TAB, tab).apply()
    }

    private var tabColor: TextView? = null
    private var colorPanel: View? = null

    /**
     * Вкладка «Цвет» (только в первой теме): цвет «люминофора» — надписи, рамки, лог на фоне, крысы.
     * Восемь готовых цветов и ползунок «свой оттенок». Выбор сразу применяется и запоминается.
     */
    private fun buildColorPanel(): View {
        val p = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        p.addView(text("> phosphor color", 30f, Term.FG))
        p.addView(text("Цвет первой темы: надписи, рамки кнопок, лог на фоне и крысы. Выбор применяется сразу.", 13f, Term.DIM)
            .apply { typeface = Term.ru; setPadding(0, dp(4), 0, dp(10)) })
        val cur = getPreferences(MODE_PRIVATE).getInt(PREF_COLOR, Term.DEFAULT_COLOR)
        val grid = GridLayout(this).apply { columnCount = 2; useDefaultMargins = false }
        Term.PHOSPHOR.forEachIndexed { i, (name, c) ->
            val on = c == cur
            val sw = TextView(this).apply {
                text = (if (on) "[x] " else "[ ] ") + name
                typeface = Term.ru
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), 0, dp(8), 0)
                setTextColor(if (on) Color.BLACK else c)
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(if (on) c else Color.BLACK); setStroke(dp(1), c)
                }
                setOnClickListener { glitch(it); applyColor(c) }
            }
            grid.addView(sw, GridLayout.LayoutParams(GridLayout.spec(i / 2), GridLayout.spec(i % 2, 1f)).apply {
                width = 0; height = dp(50); setMargins(if (i % 2 == 1) dp(5) else 0, dp(5), if (i % 2 == 0) dp(5) else 0, dp(5))
            })
        }
        p.addView(grid, LinearLayout.LayoutParams(-1, -2))

        // свой оттенок: ползунок по кругу цветов, образец меняется сразу, применяется при отпускании
        val hsv = FloatArray(3).also { Color.colorToHSV(cur, it) }
        val sample = View(this).apply { setBackgroundColor(cur) }
        val label = text("> свой оттенок", 24f, Term.FG).apply { typeface = Term.ru; setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f); setPadding(0, dp(14), 0, dp(4)) }
        p.addView(label)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val seek = android.widget.SeekBar(this).apply {
            max = 359; progress = hsv[0].toInt()
            progressTintList = android.content.res.ColorStateList.valueOf(Term.FG)
            thumbTintList = android.content.res.ColorStateList.valueOf(Term.FG)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(Term.LINE)
            fun hue(h: Int) = Color.HSVToColor(floatArrayOf(h.toFloat(), 0.72f, 1f))
            setOnSeekBarChangeListener(object : android.widget.SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: android.widget.SeekBar, v: Int, fromUser: Boolean) { sample.setBackgroundColor(hue(v)) }
                override fun onStartTrackingTouch(sb: android.widget.SeekBar) {}
                override fun onStopTrackingTouch(sb: android.widget.SeekBar) { applyColor(hue(sb.progress)) }
            })
        }
        row.addView(seek, LinearLayout.LayoutParams(0, dp(44), 1f))
        row.addView(sample, LinearLayout.LayoutParams(dp(44), dp(28)).apply { leftMargin = dp(10) })
        p.addView(row)
        return p
    }

    /** Запомнить цвет и пересоздать экран (без заставки — она только при запуске). */
    private fun applyColor(c: Int) {
        getPreferences(MODE_PRIVATE).edit().putInt(PREF_COLOR, c).putString(PREF_TAB, TAB_COLOR).commit()
        recreate()
    }

    /** В «Призме» кнопки без квадратных скобок терминала. */
    private fun btnLabel(s: String) = if (Term.prism) s.removePrefix("[").removeSuffix("]") else s

    private fun mocButton(label: String, onClick: (View) -> Unit) = TextView(this).apply {
        text = label
        typeface = Term.mono
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (Term.prism) 15f else 24f)
        if (Term.prism) { typeface = Term.ru; text = label.removePrefix("[").removeSuffix("]") }
        setTextColor(Term.FG)
        gravity = Gravity.CENTER
        isSingleLine = true
        background = Term.boxBg(this@MainActivity)
        setOnClickListener { glitch(it); it.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); onClick(it) }
    }

    private fun buildMocPanel(): View {
        val p = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        p.addView(text("⚠ Результат непредсказуем. Рулетка по очереди шлёт ${rouletteSize} разных ИК-команд " +
            "(${ROULETTE_ADDR.size} адресов NEC × 256 команд). Доска может сменить источник или громкость, открыть меню, " +
            "заблокировать экран или кнопки, выключиться — или не отреагировать вовсе. Сначала попробуйте вкладку MocTec: " +
            "там точный код выключения. Если доска заблокировала экран или кнопки, дойдите здесь кнопками ◀ / ▶| " +
            "до кода 04FB 3AC5 (№ 59) и отправьте его ещё раз — это переключатель блокировки.\n\n" +
            "1. Встаньте в 1–3 м и направьте телефон на нижнюю рамку доски.\n" +
            "2. «старт» — коды идут быстро, около 5 в секунду. Как только доска отреагирует — «пауза».\n" +
            "3. Кнопкой «◀» отправляйте последние коды по одному, пока доска снова не отреагирует.\n" +
            "4. «сработало» запомнит код.", 14f, Term.DIM).apply {
            typeface = Term.ru
            // в «Призме» текст лежит на стеклянной плашке — иначе теряется на фоне призмы
            if (Term.prism || Term.thermal) { background = Term.boxBg(this@MainActivity); setTextColor(Term.FG); setPadding(dp(14), dp(12), dp(14), dp(12)) }
        })
        // код и счётчик — тоже на стекле в «Призме»
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            if (Term.prism || Term.thermal) { background = Term.boxBg(this@MainActivity); setPadding(0, 0, 0, dp(4)) }
        }
        p.addView(box, LinearLayout.LayoutParams(-1, -2).apply { if (Term.prism || Term.thermal) topMargin = dp(10) })
        mocCode = text("", if (Term.prism) 34f else 52f, Term.FG).apply {
            gravity = Gravity.CENTER; setShadowLayer(dp(8).toFloat(), 0f, 0f, if (Term.thermal) Heat.GLOW else Term.FG); setPadding(0, dp(14), 0, 0)
        }
        box.addView(mocCode, LinearLayout.LayoutParams(-1, -2))
        mocInfo = text("", 18f, Term.DIM).apply { gravity = Gravity.CENTER }
        box.addView(mocInfo, LinearLayout.LayoutParams(-1, -2))
        mocRecent = text("", 16f, Term.DIM).apply { gravity = Gravity.CENTER; setPadding(0, dp(2), 0, dp(10)) }
        box.addView(mocRecent, LinearLayout.LayoutParams(-1, -2))

        fun row(vararg views: View) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            views.forEachIndexed { i, v -> addView(v, LinearLayout.LayoutParams(0, dp(58), 1f).apply { if (i > 0) leftMargin = dp(8) }) }
        }
        mocPlay = mocButton("[▶ старт]") { if (mocRun) mocPause() else mocStart() }
        p.addView(row(mocButton("[◀]") { mocStep(-1) }, mocPlay, mocButton("[▶|]") { mocStep(+1) }),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })   // отступ от блока с кодом
        p.addView(row(mocButton("[⟳ ещё раз]") { mocStep(0) }, mocButton("[✓ сработало]") { mocMark() }),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        p.addView(row(mocButton("[с начала]") { mocPause(); mocIdx = 0; mocSent.clear(); mocRender() }),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        mocFound = text("", 18f, Term.FG).apply { typeface = Term.ru; gravity = Gravity.CENTER; setPadding(0, dp(12), 0, 0) }
        p.addView(mocFound, LinearLayout.LayoutParams(-1, -2))
        val prefs = getPreferences(MODE_PRIVATE)
        mocIdx = prefs.getInt("moc_idx", 0).coerceIn(0, rouletteSize - 1)
        prefs.getString("moc_found", null)?.let { mocFound.text = "> найден: $it" }
        mocRender()
        return p
    }

    private fun mocRender() {
        val c = mocCodeOf(mocIdx)
        mocCode.text = "%04X %04X".format(c ushr 16, c and 0xFFFF)
        mocInfo.text = "адрес %04X · команда 0x%02X · %d / %d".format(ROULETTE_ADDR[mocIdx / 256], mocIdx and 0xFF, mocIdx + 1, rouletteSize)
        mocRecent.text = if (mocSent.isEmpty()) "ещё ничего не отправлено"
            else "последние: " + mocSent.joinToString("  ") { "%04X·%02X".format(ROULETTE_ADDR[it / 256], it and 0xFF) }
        getPreferences(MODE_PRIVATE).edit().putInt("moc_idx", mocIdx).apply()
    }

    private fun mocSend(idx: Int, tx: IrTransmitter) {
        tx.transmit(Nec.withGap(Nec.frame(mocCodeOf(idx))))
        ui.post {
            mocSent.addLast(idx); while (mocSent.size > 4) mocSent.removeFirst()
            mocRender()
        }
    }

    private fun mocStart() {
        val tx = current() ?: return say(noTxMessage(), err = true)
        if (mocIdx >= rouletteSize) mocIdx = 0
        mocRun = true
        mocPlay.text = btnLabel("[|| пауза]")
        say("> рулетка: старт с 0x%08X".format(mocCodeOf(mocIdx)))
        io.execute {
            try {
                val last = rouletteSize - 1
                while (mocRun && mocIdx <= last) {
                    val i = mocIdx
                    mocSend(i, tx)
                    Thread.sleep(110)                 // кадр NEC ~70 мс + пауза: около 5 кодов в секунду
                    if (!mocRun) break
                    if (i < last) mocIdx = i + 1 else { mocRun = false }
                }
            } catch (e: Exception) {
                ui.post { say(e.message ?: "Ошибка передачи", err = true) }
            }
            ui.post {
                mocRun = false
                mocPlay.text = btnLabel("[▶ старт]")
                if (mocIdx >= rouletteSize - 1) say("> рулетка закончена: все $rouletteSize команд отправлены")
                mocRender()
            }
        }
    }

    private fun mocPause() {
        mocRun = false
        mocPlay.text = btnLabel("[▶ старт]")
        say("> пауза на коде 0x%08X".format(mocCodeOf(mocIdx)))
    }

    /** Отправить соседний (−1 / +1) или текущий (0) код один раз. */
    private fun mocStep(delta: Int) {
        if (mocRun) mocPause()
        val tx = current() ?: return say(noTxMessage(), err = true)
        mocIdx = (mocIdx + delta).coerceIn(0, rouletteSize - 1)
        mocRender()
        val i = mocIdx
        io.execute { try { mocSend(i, tx) } catch (e: Exception) { ui.post { say(e.message ?: "Ошибка передачи", err = true) } } }
        say("> tx рулетка 0x%08X [sent]".format(mocCodeOf(i)))
    }

    private fun mocMark() {
        if (mocRun) mocPause()
        val code = "0x%08X".format(mocCodeOf(mocIdx))
        getPreferences(MODE_PRIVATE).edit().putString("moc_found", code).apply()
        mocFound.text = "> найден: $code"
        say("код $code сохранён — пришлите его разработчику", ok = true)
    }

    private fun glitch(v: View) {
        v.animate().cancel()
        v.translationX = dp(4).toFloat()
        v.animate().translationX(-dp(3).toFloat()).setDuration(40).withEndAction {
            v.animate().translationX(0f).setDuration(60).start()
        }.start()
    }

    private fun onKeyTouch(v: KeyView, e: MotionEvent, label: String, code: Long): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                v.setDown(true)
                // крысы убегают от пальца
                val at = IntArray(2).also { bg.getLocationOnScreen(it) }
                bg.scare(e.rawX - at[0], e.rawY - at[1])
                v.animate().scaleX(0.97f).scaleY(0.97f).setDuration(60).start()
                v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                press(label, code)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                v.setDown(false)
                v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
                held = 0
                if (e.actionMasked == MotionEvent.ACTION_UP) v.performClick()
            }
        }
        return true
    }

    /**
     * Проверка при запуске: есть ли в телефоне встроенный ИК-порт.
     * Нет порта и нет другого передатчика — объясняем, что делать, и ведём в гид или в «Проверку».
     */
    private fun checkIrPort() {
        if (builtin.available) { say("ir port: найден", ok = true); return }
        val other = usbIr ?: AudioIr.adapterOutput(audio)?.let { audio2 }
        if (other != null) {
            say("ИК-порта нет, есть ${other.title}")
            return
        }
        say("ИК-порт не найден", err = true)
        AlertDialog.Builder(this)
            .setTitle("> ИК-порт не найден")
            .setMessage("В этом телефоне нет встроенного ИК-порта, поэтому krisa не может управлять доской сама.\n\n" +
                "Подключите USB-C ИК-передатчик (на Xiaomi включите OTG) или звуковой ИК-адаптер в разъём наушников, " +
                "затем выберите его кнопкой [tx].")
            .setPositiveButton("OK", null)
            .setNeutralButton("Как подключить") { _, _ -> showHelp("need") }
            .setNegativeButton("Проверка") { _, _ -> diagnostics() }
            .show()
    }

    /** «Как пользоваться»: тот же гид, что в веб-версии, из assets/guide. */
    private fun showHelp(section: String? = null) {
        val d = android.app.Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val web = android.webkit.WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            // Ссылки на сайты и файлы (apk/ipa) открываем в браузере телефона, разделы гида — здесь же.
            webViewClient = object : android.webkit.WebViewClient() {
                override fun shouldOverrideUrlLoading(v: android.webkit.WebView, r: android.webkit.WebResourceRequest): Boolean {
                    val u = r.url
                    if (u.scheme == "http" || u.scheme == "https") { openExternal(u); return true }
                    return false
                }
            }
            setDownloadListener { url, _, _, _, _ -> openExternal(android.net.Uri.parse(url)) }
            loadUrl("file:///android_asset/guide/index.html" + (section?.let { "#$it" } ?: ""))
        }
        d.setContentView(web)
        d.setOnKeyListener { _, code, ev ->
            if (code == android.view.KeyEvent.KEYCODE_BACK && ev.action == android.view.KeyEvent.ACTION_UP && web.canGoBack()) { web.goBack(); true } else false
        }
        d.show()
    }

    private fun openExternal(u: android.net.Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW, u)) }
        catch (e: android.content.ActivityNotFoundException) { say("Нет браузера, чтобы открыть ссылку", err = true) }
    }

    private fun chooseTheme() {
        val ids = arrayOf("terminal", "prism", "thermal")
        val names = arrayOf("Терминал — чёрно-белый, пиксельный", "Призма — переливающееся стекло", "Тепловизор — кадр тепловизора, ironbow")
        val cur = ids.indexOf(themeId).coerceAtLeast(0)
        AlertDialog.Builder(this)
            .setTitle("Тема оформления")
            .setSingleChoiceItems(names, cur) { d, which ->
                d.dismiss()
                if (which != cur) {
                    getPreferences(MODE_PRIVATE).edit().putString(PREF_THEME, ids[which]).commit()
                    recreate()   // пересоздать экран в новой теме
                }
            }
            .show()
    }

    private fun chooseMode() {
        val modes = Mode.values()
        val labels = modes.map {
            when (it) {
                Mode.AUTO -> "Авто (USB-C, если подключён)"
                Mode.BUILTIN -> "Встроенный ИК-порт" + if (builtin.available) "" else " — нет"
                Mode.USB -> "USB-C передатчик" + if (usbIr != null) " — подключён" else " — не найден"
                Mode.AUDIO2 -> "Звуковой адаптер, 2 светодиода"
                Mode.AUDIO1 -> "Звуковой адаптер, 1 светодиод"
            }
        }.toTypedArray()
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Чем передавать сигнал")
            .setSingleChoiceItems(labels, mode.ordinal) { d, which ->
                mode = modes[which]
                getPreferences(MODE_PRIVATE).edit().putString(PREF_MODE, mode.name).apply()
                renderMode()
                if (mode == Mode.AUTO || mode == Mode.USB) findUsb(null)
                d.dismiss()
            }
            .setNeutralButton("Проверка") { _, _ -> diagnostics() }
            .setNegativeButton("Тема") { _, _ -> chooseTheme() }
            .show()
    }

    /** Что телефон видит: встроенный ИК-порт, USB-устройства, звуковые выходы. */
    private fun diagnostics() {
        val sb = StringBuilder()
        val ir = getSystemService(CONSUMER_IR_SERVICE) as android.hardware.ConsumerIrManager?
        sb.append("Встроенный ИК-порт: ")
        when {
            ir == null -> sb.append("нет (сервис недоступен)")
            !ir.hasIrEmitter() -> sb.append("нет")
            else -> {
                sb.append("есть")
                runCatching { ir.carrierFrequencies }.getOrNull()?.takeIf { it.isNotEmpty() }?.let { r ->
                    sb.append(", частоты ").append(r.joinToString { "${it.minFrequency / 1000}–${it.maxFrequency / 1000} кГц" })
                }
            }
        }
        sb.append("\n\nUSB-устройства:")
        val devices = usb.deviceList.values.toList()
        if (devices.isEmpty()) sb.append("\n  ничего не подключено.\n  На Xiaomi/Redmi/POCO включите OTG: Настройки → Доп. настройки → OTG (само выключается через 10 мин).")
        devices.forEach { d ->
            sb.append("\n• ").append(d.productName ?: d.deviceName)
            sb.append("\n  %04X:%04X".format(d.vendorId, d.productId))
            sb.append(when {
                UsbIr.supports(d) -> if (d.deviceName == usbIrDevice) " — ИК-передатчик, подключён" else " — ИК-передатчик"
                (0 until d.interfaceCount).any { d.getInterface(it).interfaceClass == android.hardware.usb.UsbConstants.USB_CLASS_AUDIO } ->
                    " — звуковое устройство (режим «Звуковой адаптер»)"
                UsbIr.canTry(d) -> " — неизвестное, можно попробовать"
                else -> ""
            })
        }
        sb.append("\n\nЗвуковой выход для адаптера: ")
        sb.append(AudioIr.adapterOutput(audio)?.let { (it.productName?.toString()?.ifBlank { null } ?: "наушники/USB") } ?: "нет")

        val tryable = devices.filter { !UsbIr.supports(it) && UsbIr.canTry(it) }
        val b = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Проверка передатчиков")
            .setMessage(sb.toString())
            .setPositiveButton("OK", null)
        if (tryable.isNotEmpty()) b.setNeutralButton("Попробовать USB") { _, _ ->
            val d = tryable.first()
            mode = Mode.USB
            getPreferences(MODE_PRIVATE).edit().putString(PREF_MODE, mode.name).apply()
            useUsb(d)
        }
        b.show()
    }

    private fun renderMode() {
        val tx = current()
        modeLine.text = when {
            tx != null -> tx.title + if (mode == Mode.AUTO) " · авто" else ""
            else -> noTxMessage()
        }
        modeLine.text = "> " + modeLine.text
        modeLine.setTextColor(if (tx != null) Term.FG else Term.DIM)
        if (tx == null) glitch(modeLine)
    }

    private fun say(msg: String, ok: Boolean = false, err: Boolean = false) {
        status.type(if (err) "!! $msg" else if (ok) "> $msg [ok]" else msg)
        status.setTextColor(if (err || ok) Term.FG else Term.DIM)
        if (err) glitch(status)
    }

    private fun text(s: String, sp: Float, color: Int) = TextView(this).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        typeface = Term.mono
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    @Suppress("DEPRECATION")
    private fun Intent.usbDevice(): UsbDevice? =
        if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        else getParcelableExtra(UsbManager.EXTRA_DEVICE)

    companion object {
        private const val PREF_MODE = "tx_mode"
        private const val PREF_THEME = "theme"
        private const val PREF_COLOR = "term_color"
        private const val PREF_TAB = "tab"
        private const val TAB_IRBIS = "irbis"
        private const val TAB_MOC = "moc"
        private const val TAB_ROULETTE = "roulette"
        private const val TAB_COLOR = "color"
        private const val ACTION_PERMISSION = "ru.irbis.remote.USB_PERMISSION"
    }
}
