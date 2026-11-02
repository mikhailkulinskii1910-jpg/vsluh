package ru.random.wheel

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.text.TextPaint
import android.text.TextUtils
import android.util.AttributeSet
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.min
import kotlin.random.Random

/** Колесо фортуны: сектора пропорциональны размерам [sizes], указатель сверху. */
class WheelView(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    var labels: List<String> = emptyList()
        set(value) { field = value; recalc(); invalidate() }

    /** Размеры секторов (по умолчанию все 1). Доля сектора = размер / сумма размеров. */
    var sizes: List<Int> = emptyList()
        set(value) { field = value; recalc(); invalidate() }

    /** Выделенный сектор (обводка) — для окна изменения размера; -1 — нет. */
    var highlight = -1
        set(value) { field = value; invalidate() }

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

    /** Поворот колеса по часовой стрелке, градусы. */
    private var rotationDeg = 0f

    /**
     * Режим «Стрелка»: колесо стоит, сектора — кольцом по краю, в центре вращается стрелка.
     * [arrowDeg] — куда смотрит стрелка: 0 — вверх, по часовой стрелке.
     */
    var arrowMode = false
        set(value) { field = value; invalidate() }
    private var arrowDeg = 0f
    private val ringInner = 0.5f // внутренний радиус кольца секторов в режиме стрелки, доля r
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
    private val oval = RectF()
    private val pointer = Path()

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

    /** Индекс сектора под указателем. */
    fun indexUnderPointer() = if (arrowMode) indexAtAngle(arrowDeg - rotationDeg) else indexAtAngle(-rotationDeg)

    /** Индекс сектора в точке экрана (x, y) или -1 вне колеса. */
    fun indexAt(x: Float, y: Float): Int {
        val (cx, cy, r) = geometry()
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

    /** Крутит колесо (или стрелку) так, чтобы указатель остановился в случайном месте сектора [index]. */
    fun spinTo(index: Int, durationMs: Long, onEnd: () -> Unit) {
        val n = labels.size
        if (n == 0 || spinning) return
        val from = starts[index]; val span = starts[index + 1] - from
        val target = from + span * (0.12f + 0.76f * Random.nextFloat()) // угол внутри сектора
        val arrow = arrowMode
        // колесо: поворот r даёт под указателем угол −r; стрелка под углом a смотрит на угол a − r
        val start = ((if (arrow) arrowDeg else rotationDeg) % 360 + 360) % 360
        val want = if (arrow) target + rotationDeg else -target
        val delta = ((want - start) % 360 + 720) % 360
        val turns = (durationMs / 800).toInt().coerceAtLeast(2)
        val end = start + 360f * Random.nextInt(turns, turns + 3) + delta
        if (arrow) arrowDeg = start else rotationDeg = start
        var lastIdx = indexUnderPointer()
        animator = ValueAnimator.ofFloat(start, end).apply {
            duration = durationMs + Random.nextLong(durationMs / 4 + 1)
            interpolator = DecelerateInterpolator(2.2f)
            addUpdateListener {
                if (arrow) arrowDeg = it.animatedValue as Float else rotationDeg = it.animatedValue as Float
                val idx = indexUnderPointer()
                if (idx != lastIdx) { lastIdx = idx; onTick?.invoke() }
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: Animator) { onEnd() }
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
        oval.set(cx - r, cy - r, cx + r, cy + r)
        fun from(i: Int) = -90f + starts[i] + rotationDeg
        fun span(i: Int) = starts[i + 1] - starts[i]

        for (i in 0 until n) {
            sectorPaint.color = colorOf(i)
            canvas.drawArc(oval, from(i), span(i), true, sectorPaint)
        }
        if (n > 1) for (i in 0 until n) canvas.drawArc(oval, from(i), span(i), true, linePaint)

        // в режиме стрелки середина — пустой круг, подписи в кольце
        val textAt = if (arrowMode) r * (1 + ringInner) / 2 else r * 0.58f
        val maxW = if (arrowMode) r * (1 - ringInner) * 0.88f else r * 0.62f
        for (i in 0 until n) {
            // шрифт по ширине сектора: узкие сектора — мельче, совсем узкие — без подписи
            val size = min(r * (if (arrowMode) 0.11f else 0.13f), textAt * 3.8f * span(i) / 360f + dp(6f))
            if (size < dp(7f)) continue
            textPaint.textSize = size
            canvas.save()
            val mid = from(i) + span(i) / 2
            canvas.rotate(mid, cx, cy)
            // колесо в режиме стрелки не крутится — подписи слева переворачиваем, чтобы читались
            val m = (mid % 360 + 360) % 360
            if (arrowMode && m > 90 && m < 270) canvas.rotate(180f, cx + textAt, cy)
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
        if (arrowMode) { drawArrow(canvas, cx, cy, r); return }
        canvas.drawCircle(cx, cy, r * 0.12f, hubPaint)
        canvas.drawCircle(cx, cy, r * 0.07f, hubInner)

        val pw = dp(16f)
        pointer.reset()
        pointer.moveTo(cx - pw, cy - r - dp(12f))
        pointer.lineTo(cx + pw, cy - r - dp(12f))
        pointer.lineTo(cx, cy - r + dp(18f))
        pointer.close()
        canvas.drawPath(pointer, pointerPaint)
    }

    private val arrowPath = Path()

    /** Пустой центр с кольцом секторов вокруг и стрелка на оси. */
    private fun drawArrow(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val inner = r * ringInner
        sectorPaint.color = theme.bg
        canvas.drawCircle(cx, cy, inner, sectorPaint)
        rimPaint.strokeWidth = dp(3f)
        canvas.drawCircle(cx, cy, inner, rimPaint)

        canvas.save()
        canvas.rotate(arrowDeg, cx, cy)
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

    private fun isLight(c: Int) =
        Color.red(c) * 0.299 + Color.green(c) * 0.587 + Color.blue(c) * 0.114 > 160

    private fun dp(v: Float) = v * resources.displayMetrics.density
}
