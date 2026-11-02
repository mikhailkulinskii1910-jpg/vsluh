package ru.random.wheel

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.text.TextPaint
import android.text.TextUtils
import android.util.AttributeSet
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/** Что вращается при розыгрыше. */
enum class SpinMode(val id: String, val title: String) {
    WHEEL("wheel", "Колесо"),
    ARROW("arrow", "Стрелка"),
    BALL("ball", "Шарик"),
    LIGHTS("lights", "Огоньки"),
    COUNTER("counter", "Встречное"),
    REEL("reel", "Барабан");

    companion object { fun byId(id: String?) = entries.firstOrNull { it.id == id } ?: WHEEL }
}

/**
 * Колесо фортуны: сектора пропорциональны размерам [sizes].
 *
 * Положение задают два угла: [rotationDeg] — поворот колеса и [cursorDeg] — куда указывает
 * стрелка / шарик / огонёк / линия барабана (0 — вверх, по часовой). Выпавший сектор —
 * под углом колеса cursor − rotation; в режиме «Колесо» курсор — неподвижный указатель сверху (0).
 */
class WheelView(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    var labels: List<String> = emptyList()
        set(value) { field = value; recalc(); invalidate() }

    /** Размеры секторов (по умолчанию все 1). Доля сектора = размер / сумма размеров. */
    var sizes: List<Int> = emptyList()
        set(value) { field = value; recalc(); invalidate() }

    /** Выделенный сектор (обводка) — для окна изменения размера; -1 — нет. */
    var highlight = -1
        set(value) { field = value; invalidate() }

    var mode = SpinMode.WHEEL
        set(value) {
            if (spinning) return
            field = value
            if (value == SpinMode.WHEEL) cursorDeg = 0f
            invalidate()
        }

    /** Начало каждого сектора в градусах от указателя по часовой стрелке; последний элемент — 360. */
    private var starts = FloatArray(1)

    var theme: AppTheme = Themes.all[0]
        set(value) {
            field = value
            rimPaint.color = value.rim; hubPaint.color = value.rim; pointerPaint.color = value.rim
            hubInner.color = value.panel; emptyPaint.color = value.muted
            invalidate()
        }

    /** Указатель перешёл на следующий сектор (для щелчка и вибрации). */
    var onTick: (() -> Unit)? = null

    private var rotationDeg = 0f
    private var cursorDeg = 0f
    /** Доля пройденной анимации (0…1) — шарик в конце «падает» в сектор. */
    private var progress = 1f
    private val ringInner = 0.5f // внутренний радиус кольца секторов в режимах со стрелкой, доля r
    private var animator: ValueAnimator? = null
    val spinning get() = animator?.isRunning == true

    private val sectorPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = 0x40000000; strokeWidth = dp(1.5f)
    }
    private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#F2F2F5")
    }
    private val hubPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#F2F2F5") }
    private val hubInner = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#22242E") }
    private val pointerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F2F2F5"); setShadowLayer(dp(3f), 0f, dp(1.5f), 0x88000000.toInt())
    }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER; isFakeBoldText = true
    }
    private val emptyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val emptyRing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = dp(3f)
        pathEffect = android.graphics.DashPathEffect(floatArrayOf(dp(10f), dp(8f)), 0f)
    }
    private val hlPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val fadePaint = Paint()
    private val oval = RectF()
    private val rect = RectF()
    private val pointer = Path()
    private val arrowPath = Path()

    fun colorOf(i: Int): Int {
        val pal = theme.palette
        val n = labels.size
        // последний сектор не должен совпасть по цвету с первым (они соседние)
        val k = if (n > 1 && i == n - 1 && i % pal.size == 0) pal.size / 2 else i % pal.size
        return pal[k]
    }

    private fun recalc() {
        val n = labels.size
        val w = FloatArray(n) { (sizes.getOrNull(it) ?: 1).coerceAtLeast(1).toFloat() }
        val sum = w.sum()
        starts = FloatArray(n + 1)
        for (i in 0 until n) starts[i + 1] = starts[i] + 360f * w[i] / sum
        if (n > 0) starts[n] = 360f
    }

    /** Сектор по углу колеса (0 — начало первого сектора, по часовой стрелке). */
    private fun indexAtAngle(deg: Float): Int {
        val n = labels.size
        if (n == 0) return -1
        val a = (deg % 360 + 360) % 360
        for (i in 0 until n) if (a < starts[i + 1]) return i
        return n - 1
    }

    /** Индекс выпавшего / текущего сектора. */
    fun indexUnderPointer() = indexAtAngle(cursorDeg - rotationDeg)

    /** Индекс сектора в точке экрана (x, y) или -1 вне колеса. */
    fun indexAt(x: Float, y: Float): Int {
        val (cx, cy, r) = geometry()
        if (mode == SpinMode.REEL) {
            reelWindow(cx, cy, r)
            if (!rect.contains(x, y)) return -1
            return indexAtAngle(cursorDeg - rotationDeg + (y - rect.centerY()) / reelPxPerDeg(rect))
        }
        val dx = x - cx; val dy = y - cy
        if (dx * dx + dy * dy > r * r) return -1
        val a = Math.toDegrees(kotlin.math.atan2(dx.toDouble(), -dy.toDouble())).toFloat() // 0 — вверх, по часовой
        return indexAtAngle(a - rotationDeg)
    }

    /** Последнее касание — чтобы по долгому нажатию узнать, какой сектор держат. */
    var lastTouchX = 0f; private set
    var lastTouchY = 0f; private set

    override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
        if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) { lastTouchX = e.x; lastTouchY = e.y }
        return super.onTouchEvent(e)
    }

    private fun geometry(): Triple<Float, Float, Float> {
        val cx = width / 2f
        val cy = height / 2f + dp(8f)
        val r = min(width / 2f, height / 2f - dp(8f)) - dp(10f)
        return Triple(cx, cy, r)
    }

    private fun norm(a: Float) = (a % 360 + 360) % 360

    /** Крутит колесо / курсор так, чтобы выпал случайный угол внутри сектора [index]. */
    fun spinTo(index: Int, durationMs: Long, onEnd: () -> Unit) {
        val n = labels.size
        if (n == 0 || spinning) return
        val from = starts[index]; val span = starts[index + 1] - from
        val target = from + span * (0.12f + 0.76f * Random.nextFloat()) // угол внутри сектора
        val turns = (durationMs / 800).toInt().coerceAtLeast(2)
        fun laps() = 360f * Random.nextInt(turns, turns + 3)
        // нужно: cursorEnd − rotationEnd ≡ target (mod 360)
        val r0 = norm(rotationDeg); val c0 = norm(cursorDeg)
        var r1 = r0; var c1 = c0
        when (mode) {
            SpinMode.WHEEL -> r1 = r0 + laps() + norm(c0 - target - r0)
            SpinMode.COUNTER -> {
                r1 = r0 - laps() * 0.6f - Random.nextFloat() * 360f // колесо — против часовой
                c1 = c0 + laps() + norm(target + r1 - c0)
            }
            else -> c1 = c0 + laps() + norm(target + r0 - c0)
        }
        rotationDeg = r0; cursorDeg = c0
        var lastIdx = indexUnderPointer()
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMs + Random.nextLong(durationMs / 4 + 1)
            interpolator = DecelerateInterpolator(2.2f)
            addUpdateListener {
                val f = it.animatedValue as Float
                rotationDeg = r0 + (r1 - r0) * f
                cursorDeg = c0 + (c1 - c0) * f
                progress = it.animatedFraction
                val idx = indexUnderPointer()
                if (idx != lastIdx) { lastIdx = idx; onTick?.invoke() }
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: Animator) { progress = 1f; invalidate(); onEnd() }
            })
            start()
        }
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val n = labels.size
        val (cx, cy, r) = geometry()
        if (r <= 0) return
        if (n == 0) {
            emptyRing.color = theme.muted
            canvas.drawCircle(cx, cy, r, emptyRing)
            emptyPaint.textSize = dp(18f)
            canvas.drawText("Добавьте варианты", cx, cy, emptyPaint)
            emptyPaint.textSize = dp(14f)
            canvas.drawText("на вкладке «Варианты»", cx, cy + dp(24f), emptyPaint)
            return
        }
        when (mode) {
            SpinMode.REEL -> { drawReel(canvas, cx, cy, r); return }
            // у шарика снаружи дорожка, колесо чуть меньше
            SpinMode.BALL -> drawSectors(canvas, cx, cy, r * 0.84f, ring = false)
            SpinMode.ARROW, SpinMode.COUNTER -> drawSectors(canvas, cx, cy, r, ring = true)
            else -> drawSectors(canvas, cx, cy, r, ring = false)
        }
        when (mode) {
            SpinMode.WHEEL -> { drawHub(canvas, cx, cy, r); drawTopPointer(canvas, cx, cy, r) }
            SpinMode.ARROW, SpinMode.COUNTER -> drawArrow(canvas, cx, cy, r)
            SpinMode.BALL -> drawBall(canvas, cx, cy, r)
            SpinMode.LIGHTS -> drawLights(canvas, cx, cy, r)
            SpinMode.REEL -> {}
        }
    }

    /** Сектора с подписями; [ring] — кольцом по краю (середина пустая, колесо не крутится). */
    private fun drawSectors(canvas: Canvas, cx: Float, cy: Float, r: Float, ring: Boolean) {
        val n = labels.size
        oval.set(cx - r, cy - r, cx + r, cy + r)
        fun from(i: Int) = -90f + starts[i] + rotationDeg
        fun span(i: Int) = starts[i + 1] - starts[i]

        for (i in 0 until n) {
            sectorPaint.color = colorOf(i)
            canvas.drawArc(oval, from(i), span(i), true, sectorPaint)
        }
        if (n > 1) for (i in 0 until n) canvas.drawArc(oval, from(i), span(i), true, linePaint)

        val textAt = if (ring) r * (1 + ringInner) / 2 else r * 0.58f
        val maxW = if (ring) r * (1 - ringInner) * 0.88f else r * 0.62f
        // подписи читаются, если колесо в этом режиме стоит на месте
        val upright = mode != SpinMode.WHEEL && mode != SpinMode.COUNTER
        for (i in 0 until n) {
            // шрифт по ширине сектора: узкие сектора — мельче, совсем узкие — без подписи
            val size = min(r * (if (ring) 0.11f else 0.13f), textAt * 3.8f * span(i) / 360f + dp(6f))
            if (size < dp(7f)) continue
            textPaint.textSize = size
            canvas.save()
            val mid = from(i) + span(i) / 2
            canvas.rotate(mid, cx, cy)
            val m = norm(mid)
            if (upright && m > 90 && m < 270) canvas.rotate(180f, cx + textAt, cy)
            textPaint.color = if (isLight(colorOf(i))) 0xFF15161C.toInt() else Color.WHITE
            val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, maxW, TextUtils.TruncateAt.END)
            canvas.drawText(t, 0, t.length, cx + textAt, cy - (textPaint.ascent() + textPaint.descent()) / 2, textPaint)
            canvas.restore()
        }

        if (highlight in 0 until n) {
            hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(4f)
            canvas.drawArc(oval, from(highlight), span(highlight), true, hlPaint)
        }

        rimPaint.strokeWidth = dp(5f)
        canvas.drawCircle(cx, cy, r, rimPaint)
        if (ring) {
            sectorPaint.color = theme.bg
            canvas.drawCircle(cx, cy, r * ringInner, sectorPaint)
            rimPaint.strokeWidth = dp(3f)
            canvas.drawCircle(cx, cy, r * ringInner, rimPaint)
        }
    }

    private fun drawHub(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        canvas.drawCircle(cx, cy, r * 0.12f, hubPaint)
        canvas.drawCircle(cx, cy, r * 0.07f, hubInner)
    }

    private fun drawTopPointer(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val pw = dp(16f)
        pointer.reset()
        pointer.moveTo(cx - pw, cy - r - dp(12f))
        pointer.lineTo(cx + pw, cy - r - dp(12f))
        pointer.lineTo(cx, cy - r + dp(18f))
        pointer.close()
        pointerPaint.color = theme.rim
        canvas.drawPath(pointer, pointerPaint)
    }

    /** Стрелка на оси в пустом центре кольца. */
    private fun drawArrow(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val inner = r * ringInner
        canvas.save()
        canvas.rotate(cursorDeg, cx, cy)
        val tip = cy - r * (ringInner + 0.06f) // остриё упирается в кольцо, подписи не закрывает
        val head = r * 0.16f         // длина наконечника
        val hw = r * 0.09f           // полуширина наконечника
        val sw = r * 0.035f          // полуширина древка
        val tail = cy + inner * 0.45f
        arrowPath.reset()
        arrowPath.moveTo(cx, tip)
        arrowPath.lineTo(cx + hw, tip + head)
        arrowPath.lineTo(cx + sw, tip + head * 0.8f)
        arrowPath.lineTo(cx + sw, tail)
        arrowPath.lineTo(cx + hw * 0.8f, tail + head * 0.45f)
        arrowPath.lineTo(cx - hw * 0.8f, tail + head * 0.45f)
        arrowPath.lineTo(cx - sw, tail)
        arrowPath.lineTo(cx - sw, tip + head * 0.8f)
        arrowPath.lineTo(cx - hw, tip + head)
        arrowPath.close()
        pointerPaint.color = theme.rim
        canvas.drawPath(arrowPath, pointerPaint)
        canvas.restore()

        canvas.drawCircle(cx, cy, r * 0.09f, hubPaint)
        sectorPaint.color = theme.accent
        canvas.drawCircle(cx, cy, r * 0.05f, sectorPaint)
    }

    /** Дорожка вокруг колеса и шарик; под конец шарик скатывается в сектор. */
    private fun drawBall(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        // дорожка
        hlPaint.color = theme.panel; hlPaint.strokeWidth = r * 0.16f
        canvas.drawCircle(cx, cy, r * 0.92f, hlPaint)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(2f)
        canvas.drawCircle(cx, cy, r, hlPaint)
        rimPaint.strokeWidth = dp(4f)
        canvas.drawCircle(cx, cy, r * 0.84f, rimPaint)
        drawHub(canvas, cx, cy, r * 0.84f)
        // радиус: по дорожке, на последних 18% — внутрь, на край сектора
        val drop = ((progress - 0.82f) / 0.18f).coerceIn(0f, 1f)
        val br = r * (0.92f - 0.16f * drop * drop)
        val a = Math.toRadians((cursorDeg - 90).toDouble())
        val bx = cx + br * cos(a).toFloat(); val by = cy + br * sin(a).toFloat()
        val ballR = r * 0.055f
        pointerPaint.color = 0xFFF8F8F8.toInt()
        canvas.drawCircle(bx, by, ballR, pointerPaint)
        sectorPaint.color = 0x55FFFFFF
        canvas.drawCircle(bx - ballR * 0.35f, by - ballR * 0.35f, ballR * 0.35f, sectorPaint)
    }

    /** Все сектора притушены, светится только тот, на котором огонёк. */
    private fun drawLights(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val i = indexUnderPointer()
        val from = -90f + starts[i] + rotationDeg
        val span = starts[i + 1] - starts[i]
        oval.set(cx - r, cy - r, cx + r, cy + r)
        // затемнение остальных: весь круг, кроме светящегося сектора
        dimPaint.color = if (theme.light) 0x99FFFFFF.toInt() else 0x99000000.toInt()
        canvas.drawArc(oval, from + span, 360f - span, true, dimPaint)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(5f)
        canvas.drawArc(oval, from, span, true, hlPaint)
        // лампочки по ободу: горят у выбранного сектора
        val bulbs = 36
        for (k in 0 until bulbs) {
            val deg = k * 360f / bulbs
            val on = indexAtAngle(deg - rotationDeg) == i
            val a = Math.toRadians((deg - 90).toDouble())
            sectorPaint.color = if (on) theme.accent else theme.panel
            canvas.drawCircle(cx + r * cos(a).toFloat(), cy + r * sin(a).toFloat(), if (on) dp(5f) else dp(3.5f), sectorPaint)
        }
        drawHub(canvas, cx, cy, r)
    }

    // --- Барабан ----------------------------------------------------------------

    private fun reelWindow(cx: Float, cy: Float, r: Float) {
        val w = min(width - dp(24f), r * 1.7f)
        rect.set(cx - w / 2, cy - r, cx + w / 2, cy + r)
    }

    /** Масштаб ленты: в окне видно около пяти вариантов. */
    private fun reelPxPerDeg(win: RectF): Float {
        val visibleDeg = 360f * min(5, labels.size.coerceAtLeast(1)) / labels.size.coerceAtLeast(1)
        return win.height() / visibleDeg
    }

    /** Вертикальная лента, как в игровом автомате; выпавший вариант — на центральной линии. */
    private fun drawReel(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val n = labels.size
        reelWindow(cx, cy, r)
        val win = RectF(rect)
        val ppd = reelPxPerDeg(win)
        val s = cursorDeg - rotationDeg // угол ленты на центральной линии
        val radius = dp(18f)
        canvas.save()
        val clip = Path().apply { addRoundRect(win, radius, radius, Path.Direction.CW) }
        canvas.clipPath(clip)
        sectorPaint.color = theme.panel
        canvas.drawRect(win, sectorPaint)
        val halfDeg = win.height() / 2 / ppd
        var cycle = floor((s - halfDeg) / 360f) * 360f
        textPaint.textAlign = Paint.Align.CENTER
        while (cycle < s + halfDeg + 360f) {
            for (i in 0 until n) {
                val top = win.centerY() + (cycle + starts[i] - s) * ppd
                val bottom = win.centerY() + (cycle + starts[i + 1] - s) * ppd
                if (bottom < win.top || top > win.bottom) continue
                sectorPaint.color = colorOf(i)
                canvas.drawRect(win.left, top, win.right, bottom, sectorPaint)
                canvas.drawLine(win.left, top, win.right, top, linePaint)
                val h = bottom - top
                val size = min(h * 0.5f, dp(26f))
                if (size >= dp(8f)) {
                    textPaint.textSize = size
                    textPaint.color = if (isLight(colorOf(i))) 0xFF15161C.toInt() else Color.WHITE
                    val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, win.width() * 0.8f, TextUtils.TruncateAt.END)
                    canvas.drawText(t, 0, t.length, win.centerX(), (top + bottom) / 2 - (textPaint.ascent() + textPaint.descent()) / 2, textPaint)
                }
            }
            cycle += 360f
        }
        // затенение сверху и снизу — эффект цилиндра
        val fade = win.height() * 0.3f
        val shade = (theme.bg and 0x00FFFFFF) or 0xDD000000.toInt()
        val clear = theme.bg and 0x00FFFFFF
        fadePaint.shader = LinearGradient(0f, win.top, 0f, win.top + fade, shade, clear, Shader.TileMode.CLAMP)
        canvas.drawRect(win.left, win.top, win.right, win.top + fade, fadePaint)
        fadePaint.shader = LinearGradient(0f, win.bottom - fade, 0f, win.bottom, clear, shade, Shader.TileMode.CLAMP)
        canvas.drawRect(win.left, win.bottom - fade, win.right, win.bottom, fadePaint)
        fadePaint.shader = null
        canvas.restore()

        // рамка и центральная линия с указателями
        rimPaint.strokeWidth = dp(4f)
        canvas.drawRoundRect(win, radius, radius, rimPaint)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(2f)
        canvas.drawLine(win.left, win.centerY(), win.left + dp(14f), win.centerY(), hlPaint)
        canvas.drawLine(win.right - dp(14f), win.centerY(), win.right, win.centerY(), hlPaint)
        val pw = dp(13f)
        pointerPaint.color = theme.rim
        pointer.reset()
        pointer.moveTo(win.left - dp(6f), win.centerY() - pw)
        pointer.lineTo(win.left + dp(14f), win.centerY())
        pointer.lineTo(win.left - dp(6f), win.centerY() + pw)
        pointer.close()
        canvas.drawPath(pointer, pointerPaint)
        pointer.reset()
        pointer.moveTo(win.right + dp(6f), win.centerY() - pw)
        pointer.lineTo(win.right - dp(14f), win.centerY())
        pointer.lineTo(win.right + dp(6f), win.centerY() + pw)
        pointer.close()
        canvas.drawPath(pointer, pointerPaint)
    }

    private fun isLight(c: Int) =
        Color.red(c) * 0.299 + Color.green(c) * 0.587 + Color.blue(c) * 0.114 > 160

    private fun dp(v: Float) = v * resources.displayMetrics.density
}
