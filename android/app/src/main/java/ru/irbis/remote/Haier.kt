package ru.irbis.remote

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Кондиционеры Haier. В отличие от NEC-пультов, пульт кондиционера при каждом нажатии
 * шлёт всё состояние сразу: режим, температуру, скорость, жалюзи, таймер и нажатую кнопку.
 * Форматы — по описанию протоколов в IRremoteESP8266 (ir_Haier):
 *  - пульт 1: YR-W02 / HSU-09HMC203, 14 байт (HAIER_AC_YRW02);
 *  - пульт 2: V9014557 M47 8D, 22 байта (HAIER_AC176) — те же 14 байт плюс второй блок;
 *  - пульт 3: HSU07-HEA03, 9 байт (HAIER_AC).
 * Кадр: метка 3000, пауза 3000, метка 3000, пауза 4300 мкс, затем байты старшим битом вперёд
 * (метка 520, «1» — пауза 1650, «0» — пауза 650), в конце метка 520. Несущая 38 кГц.
 */
object Haier {
    /** Режимы по кругу, как кнопка «Режим». */
    enum class Mode(val title: String) { COOL("охлаждение"), HEAT("обогрев"), DRY("осушение"), FAN("вентилятор"), AUTO("авто") }
    enum class Fan(val title: String) { AUTO("авто"), LOW("1"), MED("2"), HIGH("3") }
    /** Положение жалюзи для кнопки «Направление» (когда авто-поворот выключен). */
    enum class Vane(val title: String) { TOP("верх"), MIDDLE("середина"), BOTTOM("низ"), STOP("стоп") }

    val MODELS = listOf("YR-W02", "V9014557", "HSU07")
    val TIMERS = intArrayOf(0, 1, 2, 4, 8)

    /** Кнопка, которую «нажали» — пульт передаёт её вместе с состоянием. */
    enum class Button { POWER, MODE, TEMP_UP, TEMP_DOWN, FAN, SWING, SLEEP, TURBO, TIMER }

    class State(
        var model: Int = 0, var power: Boolean = true, var mode: Mode = Mode.COOL, var temp: Int = 24,
        var fan: Fan = Fan.AUTO, var swing: Boolean = true, var vane: Vane = Vane.TOP,
        var sleep: Boolean = false, var turbo: Boolean = false, var timer: Int = 0,
    )

    private fun sum(b: IntArray, from: Int, to: Int): Int { var s = 0; for (i in from until to) s += b[i]; return s and 0xFF }

    /** Байты сообщения для выбранного пульта. */
    fun bytes(s: State, btn: Button): IntArray = when (s.model) {
        2 -> hsu07(s, btn)
        else -> yrw02(s, btn, long = s.model == 1)
    }

    private fun yrw02(s: State, btn: Button, long: Boolean): IntArray {
        val b = IntArray(if (long) 22 else 14)
        val heat = s.mode == Mode.HEAT
        val swingV = when {
            s.swing -> 0xC
            s.vane == Vane.TOP -> 0x1
            s.vane == Vane.MIDDLE -> if (heat) 0x3 else 0x2
            s.vane == Vane.BOTTOM -> if (heat) 0x3 else 0x2   // «низ» есть только в обогреве
            else -> 0x0
        }
        val fan = when (s.fan) { Fan.HIGH -> 1; Fan.MED -> 2; Fan.LOW -> 3; Fan.AUTO -> 5 }
        val mode = when (s.mode) { Mode.AUTO -> 0; Mode.COOL -> 1; Mode.DRY -> 2; Mode.HEAT -> 4; Mode.FAN -> 6 }
        val turbo = s.turbo && (s.mode == Mode.COOL || heat)
        b[0] = 0xA6
        b[1] = ((s.temp.coerceIn(16, 30) - 16) shl 4) or swingV
        b[3] = 0x02 or (if (s.timer > 0) 0x20 else 0)               // «здоровье» + таймер выключения
        b[4] = if (s.power) 0x40 else 0
        b[5] = (fan shl 5) or s.timer                                  // часы таймера выключения
        b[6] = if (turbo) 0x40 else 0
        b[7] = mode shl 5
        b[8] = if (s.sleep) 0x80 else 0
        b[12] = when (btn) {
            Button.TEMP_UP -> 0; Button.TEMP_DOWN -> 1; Button.SWING -> 2; Button.FAN -> 4; Button.POWER -> 5
            Button.MODE -> 6; Button.TURBO -> 8; Button.SLEEP -> 11; Button.TIMER -> 16
        }
        b[13] = sum(b, 0, 13)
        if (long) {
            b[14] = 0xB7
            b[16] = (if (s.fan == Fan.AUTO) 0 else fan) shl 6
            b[21] = sum(b, 14, 21)
        }
        return b
    }

    private fun hsu07(s: State, btn: Button): IntArray {
        val b = IntArray(9)
        val now = java.util.Calendar.getInstance()
        val cmd = if (!s.power) 0 else when (btn) {
            Button.POWER -> 1; Button.MODE -> 2; Button.FAN -> 3; Button.TEMP_UP -> 6; Button.TEMP_DOWN -> 7
            Button.SLEEP -> 8; Button.TIMER -> if (s.timer > 0) 9 else 10; Button.SWING -> 13; Button.TURBO -> 1
        }
        val swingV = when { s.swing -> 3; s.vane == Vane.TOP -> 1; s.vane == Vane.BOTTOM -> 2; else -> 0 }
        val fan = when (s.fan) { Fan.AUTO -> 0; Fan.HIGH -> 1; Fan.MED -> 2; Fan.LOW -> 3 }
        val mode = when (s.mode) { Mode.AUTO -> 0; Mode.COOL -> 1; Mode.DRY -> 2; Mode.HEAT -> 3; Mode.FAN -> 4 }
        b[0] = 0xA5
        b[1] = ((s.temp.coerceIn(16, 30) - 16) shl 4) or cmd
        b[2] = now.get(java.util.Calendar.HOUR_OF_DAY) or 0x20 or (swingV shl 6)
        b[3] = now.get(java.util.Calendar.MINUTE) or (if (s.timer > 0) 0x40 else 0)
        b[4] = if (s.timer > 0) s.timer else 12
        b[5] = fan shl 6
        b[6] = mode shl 5
        b[7] = if (s.sleep) 0x40 else 0
        b[8] = sum(b, 0, 8)
        return b
    }

    /** ИК-кадр в микросекундах (метка, пауза, …) для встроенного ИК-порта и звукового адаптера. */
    fun pattern(bytes: IntArray): IntArray {
        val d = ArrayList<Int>(8 + bytes.size * 16)
        d += 3000; d += 3000; d += 3000; d += 4300
        for (v in bytes) for (i in 7 downTo 0) { d += 520; d += if ((v shr i) and 1 == 1) 1650 else 650 }
        d += 520; d += 20000
        return d.toIntArray()
    }

    fun hex(bytes: IntArray) = bytes.joinToString(" ") { "%02X".format(it) }
}

/**
 * Термостат как на пульте: дуга 16…30°, бегунок по дуге, в центре температура и режим.
 * Пока ведёте пальцем — меняется число, при отпускании вызывается [onPick].
 */
class ThermoDial(c: Context, private var temp: Int, private val mode: () -> String, private val onPick: (Int) -> Unit) : View(c) {
    private val d = c.resources.displayMetrics.density
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val knob = Paint(Paint.ANTI_ALIAS_FLAG)
    private val big = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val box = RectF()
    private val start = 135f; private val sweep = 270f      // дуга снизу-слева вверх и вниз направо

    fun set(t: Int) { temp = t; invalidate() }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val r = min(width, height) / 2f - 18 * d
        box.set(cx - r, cy - r, cx + r, cy + r)
        track.strokeWidth = 12 * d
        track.color = Term.LINE; track.alpha = 255
        canvas.drawArc(box, start, sweep, false, track)
        val f = (temp - 16) / 14f
        track.color = if (Term.thermal) Heat.color(0.4f + 0.6f * f) else if (Term.prism) Term.IRIS[(f * 5).toInt().coerceIn(0, 5)] else Term.FG
        canvas.drawArc(box, start, sweep * f, false, track)
        // деления и подписи 16, 18 … 30
        small.typeface = Term.ru; small.textSize = 12 * d; small.color = Term.DIM
        for (t in 16..30 step 2) {
            val a = Math.toRadians((start + sweep * (t - 16) / 14f).toDouble())
            val rr = r + 2 * d + 14 * d
            canvas.drawText("$t°", cx + (rr * cos(a)).toFloat(), cy + (rr * sin(a)).toFloat() + 4 * d, small)
        }
        // бегунок
        val a = Math.toRadians((start + sweep * f).toDouble())
        val kx = cx + (r * cos(a)).toFloat(); val ky = cy + (r * sin(a)).toFloat()
        knob.color = Term.BG; canvas.drawCircle(kx, ky, 12 * d, knob)
        knob.color = Term.FG; canvas.drawCircle(kx, ky, 9 * d, knob)
        // температура и режим
        big.typeface = Term.mono; big.textSize = 56 * d; big.color = Term.FG
        canvas.drawText("$temp°", cx, cy + 18 * d, big)
        small.textSize = 14 * d; small.color = Term.DIM
        canvas.drawText(mode(), cx, cy - 34 * d, small)
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        val cx = width / 2f; val cy = height / 2f
        var ang = Math.toDegrees(atan2((e.y - cy).toDouble(), (e.x - cx).toDouble())).toFloat()
        ang = ((ang - start) % 360f + 360f) % 360f
        if (ang <= sweep + 20f) {
            val t = (16 + (ang.coerceAtMost(sweep) / sweep) * 14).roundToInt().coerceIn(16, 30)
            if (t != temp) { temp = t; invalidate() }
        }
        parent?.requestDisallowInterceptTouchEvent(true)
        if (e.actionMasked == MotionEvent.ACTION_UP) onPick(temp)
        return true
    }
}
