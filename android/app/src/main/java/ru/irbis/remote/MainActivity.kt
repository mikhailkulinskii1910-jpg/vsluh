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

    /** Тема оформления: «Терминал» (по умолчанию) или «Призма». Меняется в [tx] → «Тема». */
    private val prismTheme get() = getPreferences(MODE_PRIVATE).getString(PREF_THEME, "terminal") == "prism"

    override fun onCreate(savedInstanceState: Bundle?) {
        if (prismTheme) setTheme(R.style.Theme_Prism)
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
        Term.init(this, prismTheme)
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
            setShadowLayer(dp(10).toFloat(), 0f, 0f, if (Term.prism) Color.parseColor("#8B6CFF") else Color.WHITE)
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

        // вкладки: IRBIS (пульт) и MocTec (подбор кода выключения)
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        tabIrbis = tabButton("IRBIS") { showTab(false) }
        tabMoc = tabButton("MocTec") { showTab(true) }
        tabs.addView(tabIrbis, LinearLayout.LayoutParams(0, dp(40), 1f).apply { rightMargin = dp(8) })
        tabs.addView(tabMoc, LinearLayout.LayoutParams(0, dp(40), 1f))
        root.addView(tabs, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })

        val grid = GridLayout(this).apply { columnCount = 2; useDefaultMargins = false }
        val gap = dp(5)
        // Все 12 кнопок на один экран, как в IrCode Finder.
        val rowH = ((resources.configuration.screenHeightDp - 300) / 6 - 10).coerceIn(60, 110)
        KEYS.forEachIndexed { i, (label, code) ->
            val k = KeyView(this, label, i, code, inverted = label == "POWER")
            k.setOnTouchListener { v, e -> onKeyTouch(v as KeyView, e, label, code) }
            keyViews += k
            val lp = GridLayout.LayoutParams(GridLayout.spec(i / 2), GridLayout.spec(i % 2, 1f)).apply {
                width = 0; height = dp(rowH)
                setMargins(gap, gap, gap, gap)
            }
            grid.addView(k, lp)
        }
        root.addView(grid, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        irbisGrid = grid
        mocPanel = buildMocPanel()
        root.addView(mocPanel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        showTab(getPreferences(MODE_PRIVATE).getBoolean("tab_moc", false))

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

    /* ---------- Вкладка MocTec: подбор кода выключения ---------- */

    private lateinit var subtitle: TextView
    private lateinit var tabIrbis: TextView
    private lateinit var tabMoc: TextView
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

    /**
     * Код MocTec из файла «Мостех» для пульта Delly Changer расшифрован не до конца:
     * адрес NEC 04 FB известен, а команда — нет. Подбор шлёт все 256 команд по очереди.
     */
    private fun mocCodeOf(cmd: Int): Long =
        (0x04FBL shl 16) or ((cmd and 0xFF).toLong() shl 8) or ((cmd.inv() and 0xFF).toLong())

    private fun tabButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label
        typeface = Term.mono
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        gravity = Gravity.CENTER
        setOnClickListener { glitch(it); onClick() }
    }

    private fun styleTab(t: TextView, on: Boolean) {
        t.setTextColor(if (on) Term.onBoxText() else Term.FG)
        t.background = Term.boxBg(this, on)
    }

    private fun showTab(moc: Boolean) {
        if (!moc) mocRun = false
        styleTab(tabIrbis, !moc); styleTab(tabMoc, moc)
        irbisGrid.visibility = if (moc) View.GONE else View.VISIBLE
        mocPanel.visibility = if (moc) View.VISIBLE else View.GONE
        subtitle.text = if (moc) "MocTec :: подбор :: NEC 04 FB" else "#500202 :: IRBIS :: NEC 38kHz"
        getPreferences(MODE_PRIVATE).edit().putBoolean("tab_moc", moc).apply()
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
        p.addView(text("Код выключения MocTec расшифрован не до конца: адрес NEC 04 FB известен, команда — нет. " +
            "Подбор по очереди отправит все 256 команд (около 1,5 минуты).\n\n" +
            "1. Встаньте в 1–3 м и направьте телефон на нижнюю рамку доски.\n" +
            "2. Нажмите «старт». Как только доска погаснет — «пауза».\n" +
            "3. Кнопкой «◀» отправляйте последние коды по одному, пока доска снова не отреагирует.\n" +
            "4. Нажмите «сработало» и пришлите код разработчику.", 14f, Term.DIM).apply { typeface = Term.ru })
        mocCode = text("", if (Term.prism) 34f else 52f, Term.FG).apply {
            gravity = Gravity.CENTER; setShadowLayer(dp(8).toFloat(), 0f, 0f, Color.WHITE); setPadding(0, dp(14), 0, 0)
        }
        p.addView(mocCode, LinearLayout.LayoutParams(-1, -2))
        mocInfo = text("", 18f, Term.DIM).apply { gravity = Gravity.CENTER }
        p.addView(mocInfo, LinearLayout.LayoutParams(-1, -2))
        mocRecent = text("", 16f, Term.DIM).apply { gravity = Gravity.CENTER; setPadding(0, dp(2), 0, dp(10)) }
        p.addView(mocRecent, LinearLayout.LayoutParams(-1, -2))

        fun row(vararg views: View) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            views.forEachIndexed { i, v -> addView(v, LinearLayout.LayoutParams(0, dp(58), 1f).apply { if (i > 0) leftMargin = dp(8) }) }
        }
        mocPlay = mocButton("[▶ старт]") { if (mocRun) mocPause() else mocStart() }
        p.addView(row(mocButton("[◀]") { mocStep(-1) }, mocPlay, mocButton("[▶|]") { mocStep(+1) }))
        p.addView(row(mocButton("[⟳ ещё раз]") { mocStep(0) }, mocButton("[✓ сработало]") { mocMark() }),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        p.addView(row(mocButton("[с начала]") { mocPause(); mocIdx = 0; mocSent.clear(); mocRender() }),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        mocFound = text("", 18f, Term.FG).apply { typeface = Term.ru; gravity = Gravity.CENTER; setPadding(0, dp(12), 0, 0) }
        p.addView(mocFound, LinearLayout.LayoutParams(-1, -2))
        val prefs = getPreferences(MODE_PRIVATE)
        mocIdx = prefs.getInt("moc_idx", 0)
        prefs.getString("moc_found", null)?.let { mocFound.text = "> найден: $it" }
        mocRender()
        return p
    }

    private fun mocRender() {
        val c = mocCodeOf(mocIdx)
        mocCode.text = "%04X %04X".format(c ushr 16, c and 0xFFFF)
        mocInfo.text = "команда 0x%02X  ·  %d / 256".format(mocIdx, mocIdx + 1)
        mocRecent.text = if (mocSent.isEmpty()) "ещё ничего не отправлено"
            else "последние: " + mocSent.joinToString("  ") { "%02X".format(it) }
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
        if (mocIdx > 255) mocIdx = 0
        mocRun = true
        mocPlay.text = btnLabel("[|| пауза]")
        say("> подбор MocTec: старт с 0x%02X".format(mocIdx))
        io.execute {
            try {
                while (mocRun && mocIdx <= 255) {
                    val i = mocIdx
                    mocSend(i, tx)
                    Thread.sleep(350)                 // время доске отреагировать
                    if (!mocRun) break
                    if (i < 255) mocIdx = i + 1 else { mocRun = false }
                }
            } catch (e: Exception) {
                ui.post { say(e.message ?: "Ошибка передачи", err = true) }
            }
            ui.post {
                mocRun = false
                mocPlay.text = btnLabel("[▶ старт]")
                if (mocIdx >= 255) say("> подбор закончен: все 256 команд отправлены")
                mocRender()
            }
        }
    }

    private fun mocPause() {
        mocRun = false
        mocPlay.text = btnLabel("[▶ старт]")
        say("> пауза на команде 0x%02X".format(mocIdx))
    }

    /** Отправить соседний (−1 / +1) или текущий (0) код один раз. */
    private fun mocStep(delta: Int) {
        if (mocRun) mocPause()
        val tx = current() ?: return say(noTxMessage(), err = true)
        mocIdx = (mocIdx + delta).coerceIn(0, 255)
        mocRender()
        val i = mocIdx
        io.execute { try { mocSend(i, tx) } catch (e: Exception) { ui.post { say(e.message ?: "Ошибка передачи", err = true) } } }
        say("> tx MocTec 0x%08X [sent]".format(mocCodeOf(i)))
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
        val ids = arrayOf("terminal", "prism")
        val names = arrayOf("Терминал — чёрно-белый, пиксельный", "Призма — переливающееся стекло")
        val cur = if (prismTheme) 1 else 0
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
        private const val ACTION_PERMISSION = "ru.irbis.remote.USB_PERMISSION"
    }
}
