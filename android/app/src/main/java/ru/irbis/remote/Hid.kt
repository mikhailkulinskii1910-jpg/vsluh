package ru.irbis.remote

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import java.util.UUID
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Донгл krisa37 HID (ESP32-S3 в USB доски = клавиатура и мышь): связь по Bluetooth LE.
 * Протокол — в firmware/krisa37-hid/krisa37-hid.ino. Операции GATT идут строго по одной (очередь).
 */
@SuppressLint("MissingPermission")   // разрешения запрашивает MainActivity до connect()
class HidLink(private val c: Context, private val token: ByteArray, private val onState: (State, String?) -> Unit) {
    enum class State { OFF, SCANNING, CONNECTING, READY, USB_OFF, DENIED }

    companion object {
        val SERVICE: UUID = UUID.fromString("6b7e0001-3a1f-4c7e-9d2a-6b72697361a0")
        val RX: UUID = UUID.fromString("6b7e0002-3a1f-4c7e-9d2a-6b72697361a0")
        val INFO: UUID = UUID.fromString("6b7e0003-3a1f-4c7e-9d2a-6b72697361a0")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val CTRL = 0x01; const val SHIFT = 0x02; const val ALT = 0x04; const val WIN = 0x08

        /** Разрезать текст на куски ≤ [max] байт UTF-8, не разрывая символы. */
        fun chunks(text: String, max: Int = 18): List<ByteArray> {
            val out = ArrayList<ByteArray>(); val cur = java.io.ByteArrayOutputStream()
            var i = 0
            while (i < text.length) {
                val cp = text.codePointAt(i); val b = String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)
                if (cur.size() + b.size > max) { out += cur.toByteArray(); cur.reset() }
                cur.write(b); i += Character.charCount(cp)
            }
            if (cur.size() > 0) out += cur.toByteArray()
            return out
        }
    }

    private val ui = Handler(Looper.getMainLooper())
    private val bt = (c.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private var gatt: BluetoothGatt? = null
    private var rx: BluetoothGattCharacteristic? = null
    private var scanning = false
    var state = State.OFF; private set
    /** Адрес донгла: найденный последним — к нему подключаемся сразу, без поиска. */
    var address: String? = null

    val bluetoothOn get() = bt?.isEnabled == true

    private fun set(s: State, msg: String? = null) { state = s; ui.post { onState(s, msg) } }

    fun connect() {
        if (bt == null) return set(State.OFF, "в телефоне нет Bluetooth")
        if (!bt.isEnabled) return set(State.OFF, "включите Bluetooth")
        disconnect(quiet = true)
        val a = address
        if (a != null) open(bt.getRemoteDevice(a)) else scan()
    }

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(type: Int, r: ScanResult) {
            if (!scanning) return
            stopScan(); address = r.device.address; open(r.device)
        }
        override fun onScanFailed(code: Int) { scanning = false; set(State.OFF, "поиск не удался ($code)") }
    }

    private fun scan() {
        val sc = bt.bluetoothLeScanner ?: return set(State.OFF, "включите Bluetooth")
        scanning = true; set(State.SCANNING)
        sc.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build()),
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCb)
        ui.postDelayed({ if (scanning) { stopScan(); set(State.OFF, "донгл не найден — он вставлен в доску и прошит?") } }, 12000)
    }

    private fun stopScan() { if (scanning) { scanning = false; runCatching { bt.bluetoothLeScanner?.stopScan(scanCb) } } }

    private fun open(d: BluetoothDevice) {
        set(State.CONNECTING)
        gatt = if (Build.VERSION.SDK_INT >= 23) d.connectGatt(c, false, cb, BluetoothDevice.TRANSPORT_LE) else d.connectGatt(c, false, cb)
    }

    fun disconnect(quiet: Boolean = false) {
        stopScan()
        ops.clear(); busy = false
        gatt?.let { runCatching { it.disconnect(); it.close() } }
        gatt = null; rx = null
        if (!quiet) set(State.OFF)
    }

    /* ---------- очередь операций GATT ---------- */

    private val ops = ArrayDeque<() -> Boolean>()
    @Volatile private var busy = false

    private fun enqueue(op: () -> Boolean) { synchronized(ops) { ops.addLast(op) }; ui.post { pump() } }

    private fun pump() {
        if (busy) return
        while (true) {
            val op = synchronized(ops) { ops.removeFirstOrNull() } ?: return
            if (op()) { busy = true; ui.postDelayed(watchdog, 1500); return }
        }
    }

    /** Если ответ на операцию потерялся — не встаём навсегда. */
    private val watchdog = Runnable { busy = false; pump() }
    private fun done() { ui.removeCallbacks(watchdog); busy = false; ui.post { pump() } }

    @Suppress("DEPRECATION")
    private fun write(ch: BluetoothGattCharacteristic, v: ByteArray, withResponse: Boolean): Boolean {
        val g = gatt ?: return false
        val type = if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        return if (Build.VERSION.SDK_INT >= 33) g.writeCharacteristic(ch, v, type) == BluetoothGatt.GATT_SUCCESS
        else { ch.writeType = type; ch.value = v; g.writeCharacteristic(ch) }
    }

    /** Отправить пакет донглу (если подключены и привязаны). */
    fun send(p: ByteArray, withResponse: Boolean = false): Boolean {
        val ch = rx ?: return false
        if (state != State.READY && state != State.USB_OFF && p[0] != 0x10.toByte()) return false
        enqueue { write(ch, p, withResponse) }
        return true
    }

    /* ---------- колбэки ---------- */

    private val cb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) ui.post { g.discoverServices() }
            else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                ui.post {
                    if (gatt === g) { runCatching { g.close() }; gatt = null; rx = null; ops.clear(); busy = false; set(State.OFF, if (status != 0) "связь потеряна" else null) }
                }
            }
        }

        @Suppress("DEPRECATION")
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val s = g.getService(SERVICE) ?: return ui.post { disconnect(); set(State.OFF, "это не донгл krisa37 HID") }.let { }
            rx = s.getCharacteristic(RX)
            val info = s.getCharacteristic(INFO)
            if (info != null) {
                g.setCharacteristicNotification(info, true)
                info.getDescriptor(CCCD)?.let { d ->
                    enqueue {
                        if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
                        else { d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; g.writeDescriptor(d) }
                    }
                }
            }
            send(byteArrayOf(0x10) + token, withResponse = true)                      // привязка
            if (info != null) enqueue { g.readCharacteristic(info) }
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) = done()
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) = done()

        @Deprecated("Deprecated in Java")
        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) { info(ch.value); done() }
        override fun onCharacteristicRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray, status: Int) { info(value); done() }

        @Deprecated("Deprecated in Java")
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) { info(ch.value) }
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) { info(value) }
    }

    /** Донгл на ESP32-C3: к доске он подключается по Bluetooth, а не по USB. */
    var c3 = false; private set

    /** «krisa37-hid 1.0 usb=1 auth=ok» (у ESP32-C3 — «krisa37-hid-c3 …», usb=1 — доска подключена по Bluetooth) */
    private fun info(v: ByteArray?) {
        val s = v?.toString(Charsets.UTF_8) ?: return
        c3 = "hid-c3" in s
        set(when {
            "auth=denied" in s -> State.DENIED
            "auth=ok" in s && "usb=0" in s -> State.USB_OFF
            "auth=ok" in s -> State.READY
            else -> State.CONNECTING
        })
    }

    /* ---------- команды ---------- */

    private var mx = 0f; private var my = 0f; private var wheel = 0f
    private var lastMove = 0L

    /** Сдвиг курсора: копим и шлём не чаще раза в 15 мс, большие сдвиги — несколькими пакетами. */
    fun move(dx: Float, dy: Float) { mx += dx; my += dy; flushSoon() }
    fun scroll(steps: Float) { wheel += steps; flushSoon() }

    private val flusher = Runnable { flush() }
    private fun flushSoon() {
        val wait = 15 - (SystemClock.uptimeMillis() - lastMove)
        ui.removeCallbacks(flusher)
        if (wait <= 0) flush() else ui.postDelayed(flusher, wait)
    }

    private fun flush() {
        lastMove = SystemClock.uptimeMillis()
        var x = mx.toInt(); var y = my.toInt(); var w = wheel.toInt()
        mx -= x; my -= y; wheel -= w
        while (x != 0 || y != 0 || w != 0) {
            val sx = x.coerceIn(-127, 127); val sy = y.coerceIn(-127, 127); val sw = w.coerceIn(-127, 127)
            send(byteArrayOf(0x01, sx.toByte(), sy.toByte(), sw.toByte(), 0))
            x -= sx; y -= sy; w -= sw
        }
    }

    fun click(mask: Int, count: Int = 1) = send(byteArrayOf(0x03, mask.toByte(), count.toByte()))
    fun buttons(mask: Int) = send(byteArrayOf(0x02, mask.toByte()))
    fun key(mods: Int, code: Int) = send(byteArrayOf(0x04, mods.toByte(), code.toByte()))
    /** Зажать (держится до [keyUp]); code 0 — только модификаторы. Нужна прошивка 1.2 (C3 — 1.1). */
    fun keyDown(mods: Int, code: Int) = send(byteArrayOf(0x05, mods.toByte(), code.toByte()))
    fun keyUp(mods: Int, code: Int) = send(byteArrayOf(0x06, mods.toByte(), code.toByte()))
    /** Отпустить всё зажатое (клавиши и кнопки мыши). */
    fun releaseAll() = send(byteArrayOf(0x06))
    fun text(t: String): Boolean { var ok = true; chunks(t).forEach { ok = send(byteArrayOf(0x07) + it) && ok }; return ok }
}

/**
 * Поле-тачпад: один палец — курсор, касание — клик, два пальца — правый клик и прокрутка,
 * долгое нажатие и движение — перетаскивание.
 */
class TouchpadView(c: Context, private val sens: () -> Float, private val link: () -> HidLink?) : View(c) {
    private val d = c.resources.displayMetrics.density
    private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = d }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
    private val fill = Paint()
    private val box = RectF()
    private val slop = 8 * d

    private var lastX = 0f; private var lastY = 0f; private var lastT = 0L
    private var downX = 0f; private var downY = 0f; private var downT = 0L
    private var maxPointers = 1; private var moved = false; private var dragging = false
    private var scrollY = 0f

    private val longPress = Runnable {
        if (!moved && maxPointers == 1) { dragging = true; link()?.buttons(1); performHapticFeedback(HapticFeedbackConstants.LONG_PRESS); invalidate() }
    }

    override fun onDraw(cv: Canvas) {
        box.set(d, d, width - d, height - d)
        fill.color = if (dragging) Term.FAINT else Term.BG; fill.alpha = 150
        cv.drawRoundRect(box, 12 * d, 12 * d, fill)
        dot.color = Term.DIM; dot.alpha = 110
        val step = 22 * d
        var y = step / 2
        while (y < height) { var x = step / 2; while (x < width) { cv.drawCircle(x, y, 1.3f * d, dot); x += step }; y += step }
        frame.color = if (dragging) Term.FG else Term.LINE
        cv.drawRoundRect(box, 12 * d, 12 * d, frame)
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        parent?.requestDisallowInterceptTouchEvent(true)
        val l = link()
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.x; downY = e.y; downT = e.eventTime; lastX = e.x; lastY = e.y; lastT = e.eventTime
                maxPointers = 1; moved = false; dragging = false; scrollY = 0f
                postDelayed(longPress, 500)
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                maxPointers = maxOf(maxPointers, e.pointerCount); removeCallbacks(longPress)
                lastY = avgY(e)
            }
            MotionEvent.ACTION_MOVE -> {
                if (e.pointerCount >= 2) {
                    val y = avgY(e); scrollY += y - lastY; lastY = y
                    if (abs(scrollY) > 2 * slop) moved = true
                    val step = 14 * d
                    if (abs(scrollY) >= step) { val n = (scrollY / step).toInt(); l?.scroll(-n.toFloat()); scrollY -= n * step }
                    return true
                }
                val dx = e.x - lastX; val dy = e.y - lastY; val dt = maxOf(1L, e.eventTime - lastT)
                if (!moved && hypot(e.x - downX, e.y - downY) > slop) { moved = true; if (!dragging) removeCallbacks(longPress) }
                if (moved) {
                    val speed = hypot(dx, dy) / d / dt                 // dp за мс
                    val k = sens() * (0.8f + min(speed * 1.6f, 2.4f)) / d * 1.6f
                    l?.move(dx * k, dy * k)
                }
                lastX = e.x; lastY = e.y; lastT = e.eventTime
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                removeCallbacks(longPress)
                if (dragging) { l?.buttons(0); dragging = false; invalidate() }
                else if (e.actionMasked == MotionEvent.ACTION_UP && !moved && e.eventTime - downT < 300) {
                    l?.click(if (maxPointers >= 2) 2 else 1)
                    performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                }
            }
        }
        return true
    }

    private fun avgY(e: MotionEvent): Float { var s = 0f; for (i in 0 until e.pointerCount) s += e.getY(i); return s / e.pointerCount }

    override fun onMeasure(w: Int, h: Int) {
        val width = MeasureSpec.getSize(w)
        setMeasuredDimension(width, (width * 0.62f).roundToInt())
    }
}
