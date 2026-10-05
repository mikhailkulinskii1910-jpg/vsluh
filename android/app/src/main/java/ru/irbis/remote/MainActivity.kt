package ru.irbis.remote

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
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
import android.widget.Button
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class MainActivity : Activity() {

    private enum class Mode { AUTO, BUILTIN, USB, AUDIO2, AUDIO1 }

    private val ui = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var usb: UsbManager
    private lateinit var builtin: BuiltinIr
    @Volatile private var usbIr: UsbIr? = null
    private var usbIrDevice: String? = null
    private lateinit var audio: AudioManager
    private var mode = Mode.AUTO

    private lateinit var modeLine: TextView
    private lateinit var status: TextView
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        usb = getSystemService(USB_SERVICE) as UsbManager
        builtin = BuiltinIr(this)
        audio = getSystemService(AUDIO_SERVICE) as AudioManager
        mode = runCatching { Mode.valueOf(getPreferences(MODE_PRIVATE).getString("mode", "AUTO")!!) }.getOrDefault(Mode.AUTO)
        setContentView(buildUi())

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
        say("$label → 0x%08X".format(code))
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

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(20))
        }

        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titles.addView(text("krisa", 30f, TITLE, bold = true))
        titles.addView(text("#500202", 22f, TITLE, bold = true).apply { setPadding(0, dp(4), 0, 0) })
        modeLine = text("", 14f, MUTED).apply { setPadding(0, dp(6), 0, 0) }
        titles.addView(modeLine)
        header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        val gear = Button(this).apply {
            text = "⚙"
            textSize = 22f
            setTextColor(INK)
            background = keyBg(BTN, dp(14).toFloat())
            setPadding(0, 0, 0, 0)
            minWidth = 0; minHeight = 0
            contentDescription = "Передатчик"
            setOnClickListener { chooseMode() }
        }
        header.addView(gear, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header)

        val grid = GridLayout(this).apply { columnCount = 2; useDefaultMargins = false }
        val gap = dp(6)
        // Все 12 кнопок на один экран, как в IrCode Finder.
        val rowH = ((resources.configuration.screenHeightDp - 250) / 6 - 12).coerceIn(64, 110)
        KEYS.forEachIndexed { i, (label, code) ->
            val b = Button(this).apply {
                text = label
                isAllCaps = false
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (label == "POWER") Color.parseColor("#E4C9C9") else INK)
                background = keyBg(if (label == "POWER") POWER else BTN, dp(22).toFloat())
                stateListAnimator = null
                setOnTouchListener { v, e -> onKeyTouch(v, e, label, code) }
            }
            val lp = GridLayout.LayoutParams(GridLayout.spec(i / 2), GridLayout.spec(i % 2, 1f)).apply {
                width = 0; height = dp(rowH)
                setMargins(gap, gap, gap, gap)
            }
            grid.addView(b, lp)
        }
        root.addView(grid, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) })

        status = text("", 14f, MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) }
        root.addView(status)

        return ScrollView(this).apply { isFillViewport = true; addView(root) }
    }

    private fun onKeyTouch(v: View, e: MotionEvent, label: String, code: Long): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                v.isPressed = true
                v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                press(label, code)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                v.isPressed = false
                held = 0
                if (e.actionMasked == MotionEvent.ACTION_UP) v.performClick()
            }
        }
        return true
    }

    private fun chooseMode() {
        val modes = Mode.values()
        val labels = modes.map {
            when (it) {
                Mode.AUTO -> "Авто"
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
                getPreferences(MODE_PRIVATE).edit().putString("mode", mode.name).apply()
                renderMode()
                if (mode == Mode.AUTO || mode == Mode.USB) findUsb(null)
                d.dismiss()
            }
            .setNeutralButton("Проверка") { _, _ -> diagnostics() }
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
            getPreferences(MODE_PRIVATE).edit().putString("mode", mode.name).apply()
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
        modeLine.setTextColor(if (tx != null) MUTED else ERR)
    }

    private val clearStatus = Runnable { status.text = "" }
    private fun say(msg: String, ok: Boolean = false, err: Boolean = false) {
        status.text = msg
        status.setTextColor(if (err) ERR else if (ok) OK else MUTED)
        ui.removeCallbacks(clearStatus)
        ui.postDelayed(clearStatus, 2500)
    }

    private fun text(s: String, sp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun keyBg(color: Int, radius: Float): RippleDrawable {
        val shape = GradientDrawable().apply { setColor(color); cornerRadius = radius }
        val mask = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = radius }
        return RippleDrawable(ColorStateList.valueOf(Color.argb(40, 255, 255, 255)), shape, mask)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    @Suppress("DEPRECATION")
    private fun Intent.usbDevice(): UsbDevice? =
        if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        else getParcelableExtra(UsbManager.EXTRA_DEVICE)

    companion object {
        private const val ACTION_PERMISSION = "ru.irbis.remote.USB_PERMISSION"
        private val BTN = Color.parseColor("#141D1F")
        private val POWER = Color.parseColor("#861414")
        private val INK = Color.parseColor("#C9D3D4")
        private val TITLE = Color.parseColor("#E6ECEC")
        private val MUTED = Color.parseColor("#7F8D8F")
        private val OK = Color.parseColor("#3FB37F")
        private val ERR = Color.parseColor("#E5645B")
    }
}
