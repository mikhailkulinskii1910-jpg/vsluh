package ru.irbis.remote

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.view.View
import android.widget.FrameLayout

/**
 * RGB-перелив первой темы. Интерфейс рисуется белым и серым на чёрном, а этот слой
 * умножает всё на диагональный градиент перелива, который медленно течёт:
 * чёрное остаётся чёрным, белое и серое окрашиваются.
 * View из [exempt] (кнопки цветов, круг, полосы переливов) перерисовываются поверх в своих цветах.
 */
class RgbFrame(c: Context, private val colors: IntArray) : FrameLayout(c) {
    val exempt = ArrayList<View>()
    private val mul = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.MULTIPLY) }
    private var shader: LinearGradient? = null
    private var span = 1f
    private val m = Matrix()
    private val t0 = SystemClock.uptimeMillis()
    private val me = IntArray(2); private val at = IntArray(2); private val r = Rect()

    init { setWillNotDraw(false) }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        // один проход палитры ≈ 1,2 высоты экрана, по диагонали сверху-слева вниз-вправо, с зеркальным повтором
        span = h * 1.2f
        shader = LinearGradient(0f, 0f, span * 0.6f, span * 0.8f, colors, null, Shader.TileMode.MIRROR)
    }

    override fun dispatchDraw(canvas: Canvas) {
        val sh = shader
        if (sh == null || width == 0) { super.dispatchDraw(canvas); return }
        val sc = canvas.saveLayer(RectF(0f, 0f, width.toFloat(), height.toFloat()), null)
        super.dispatchDraw(canvas)
        // перелив течёт: сдвиг на одну длину палитры за 6 с
        val off = (SystemClock.uptimeMillis() - t0) / 6000f * span
        m.setTranslate(off * 0.6f, off * 0.8f); sh.setLocalMatrix(m)
        mul.shader = sh
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), mul)
        canvas.restoreToCount(sc)
        // панель цвета — без перелива, в настоящих цветах
        getLocationInWindow(me)
        for (v in exempt) {
            if (!v.isShown || !v.getGlobalVisibleRect(r)) continue
            v.getLocationInWindow(at)
            canvas.save()
            canvas.clipRect(r.left - me[0], r.top - me[1], r.right - me[0], r.bottom - me[1])
            canvas.translate((at[0] - me[0]).toFloat(), (at[1] - me[1]).toFloat())
            v.draw(canvas)
            canvas.restore()
        }
        postInvalidateOnAnimation()
    }
}

/** Кнопка палитры тепловизора: название, полоса палитры от холода к жару, рамка акцентного цвета. */
class HeatButton(c: Context, private val p: Heat.Palette, private val on: Boolean) : View(c) {
    private val d = c.resources.displayMetrics.density
    private val bar = Paint()
    private val fill = Paint()
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = c.resources.getFont(R.font.vt323); textSize = 22 * d }
    private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = c.resources.getFont(R.font.vt323); textSize = 14 * d }

    init { isClickable = true; contentDescription = p.title }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        bar.shader = LinearGradient(10 * d, 0f, w - 10 * d, 0f, p.pal, null, Shader.TileMode.CLAMP)
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        fill.color = p.bg; canvas.drawRect(0f, 0f, w, h, fill)
        // тёплое пятно палитры в углу — как кадр тепловизора
        canvas.drawRect(10 * d, h - 30 * d, w - 10 * d, h - 12 * d, bar)
        stroke.color = p.accent; stroke.strokeWidth = (if (on) 3f else 1f) * d
        canvas.drawRect(stroke.strokeWidth / 2, stroke.strokeWidth / 2, w - stroke.strokeWidth / 2, h - stroke.strokeWidth / 2, stroke)
        // уголки обнаружения
        stroke.strokeWidth = 2 * d; val k = 9 * d; val o = 5 * d
        for ((x, y, sx, sy) in listOf(Q(o, o, 1, 1), Q(w - o, o, -1, 1), Q(o, h - o, 1, -1), Q(w - o, h - o, -1, -1))) {
            canvas.drawLine(x, y, x + sx * k, y, stroke); canvas.drawLine(x, y, x, y + sy * k, stroke)
        }
        label.color = p.fg
        label.setShadowLayer(6 * d, 0f, 0f, p.glow)
        canvas.drawText((if (on) "[x] " else "[ ] ") + p.title, 12 * d, 34 * d, label)
        small.color = p.dim
        canvas.drawText("cold", 10 * d, h - 34 * d, small)
        small.textAlign = Paint.Align.RIGHT; canvas.drawText("hot", w - 10 * d, h - 34 * d, small); small.textAlign = Paint.Align.LEFT
    }

    private data class Q(val x: Float, val y: Float, val sx: Int, val sy: Int)
}
