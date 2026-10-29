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
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.animation.DecelerateInterpolator
import kotlin.math.min
import kotlin.random.Random

/** Колесо фортуны: равные сектора, указатель сверху. */
class WheelView(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    var labels: List<String> = emptyList()
        set(value) { field = value; invalidate() }

    /** Поворот колеса по часовой стрелке, градусы. */
    private var rotationDeg = 0f
    private var animator: ValueAnimator? = null
    val spinning get() = animator?.isRunning == true

    private val sectorPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = 0x55000000; strokeWidth = dp(1.5f)
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
    private val oval = RectF()
    private val pointer = Path()

    fun colorOf(i: Int): Int {
        val n = labels.size
        // последний сектор не должен совпасть по цвету с первым (они соседние)
        val k = if (n > 1 && i == n - 1 && i % PALETTE.size == 0) 3 else i % PALETTE.size
        return PALETTE[k]
    }

    /** Индекс сектора под указателем. */
    fun indexUnderPointer(): Int {
        val n = labels.size
        if (n == 0) return -1
        val a = ((-rotationDeg) % 360 + 360) % 360
        return (a / (360f / n)).toInt().coerceIn(0, n - 1)
    }

    /** Крутит колесо так, чтобы указатель остановился в случайном месте сектора [index]. */
    fun spinTo(index: Int, onEnd: () -> Unit) {
        val n = labels.size
        if (n == 0 || spinning) return
        val s = 360f / n
        val target = index * s + s * (0.12f + 0.76f * Random.nextFloat()) // угол внутри сектора
        val start = (rotationDeg % 360 + 360) % 360
        val delta = ((-target - start) % 360 + 720) % 360
        val end = start + 360f * Random.nextInt(5, 8) + delta
        rotationDeg = start
        var lastIdx = indexUnderPointer()
        animator = ValueAnimator.ofFloat(start, end).apply {
            duration = 4200L + Random.nextLong(1200)
            interpolator = DecelerateInterpolator(2.2f)
            addUpdateListener {
                rotationDeg = it.animatedValue as Float
                val idx = indexUnderPointer()
                if (idx != lastIdx) { lastIdx = idx; performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
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
        val cx = width / 2f
        val cy = height / 2f + dp(8f)
        val r = min(width / 2f, height / 2f - dp(8f)) - dp(10f)
        if (r <= 0 || n == 0) return
        oval.set(cx - r, cy - r, cx + r, cy + r)
        val s = 360f / n

        for (i in 0 until n) {
            sectorPaint.color = colorOf(i)
            canvas.drawArc(oval, -90f + i * s + rotationDeg, s, true, sectorPaint)
        }
        if (n > 1) for (i in 0 until n) canvas.drawArc(oval, -90f + i * s + rotationDeg, s, true, linePaint)

        textPaint.textSize = min(r * 0.13f, r * 2.2f / n + dp(6f)).coerceAtLeast(dp(9f))
        val maxW = r * 0.62f
        for (i in 0 until n) {
            canvas.save()
            canvas.rotate(-90f + (i + 0.5f) * s + rotationDeg, cx, cy)
            textPaint.color = if (isLight(colorOf(i))) Color.parseColor("#15161C") else Color.WHITE
            val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, maxW, TextUtils.TruncateAt.END)
            canvas.drawText(t, 0, t.length, cx + r * 0.58f, cy - (textPaint.ascent() + textPaint.descent()) / 2, textPaint)
            canvas.restore()
        }

        rimPaint.strokeWidth = dp(5f)
        canvas.drawCircle(cx, cy, r, rimPaint)
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

    private fun isLight(c: Int) =
        Color.red(c) * 0.299 + Color.green(c) * 0.587 + Color.blue(c) * 0.114 > 160

    private fun dp(v: Float) = v * resources.displayMetrics.density

    companion object {
        val PALETTE = intArrayOf(
            0xFFE84A5F.toInt(), 0xFFFF8C42.toInt(), 0xFFFFC93C.toInt(), 0xFF8AC926.toInt(),
            0xFF2EC4B6.toInt(), 0xFF3A86FF.toInt(), 0xFF8338EC.toInt(), 0xFFFF5DA2.toInt(),
            0xFF06D6A0.toInt(), 0xFF118AB2.toInt(), 0xFFF15BB5.toInt(), 0xFFB5838D.toInt(),
        )
    }
}
