package ru.irbis.remote

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import kotlin.math.max
import kotlin.math.sin

/**
 * Тема «Чертёж» (blueprint): синий фон, миллиметровка, схема-микросхема на фоне,
 * которую медленно «сканирует» светлая полоса, и штамп чертежа в углу.
 */
object Blueprint {
    private val PAPER = Color.parseColor("#F2F5FA")
    private val BLUE = Color.parseColor("#1A4A9E")
    private val NIGHT = Color.parseColor("#05070D")
    private val NAVY_INK = Color.parseColor("#0E2A66")

    /** Светлота чертежа с ползунка: 0 — светокопия (белая бумага, синие линии), 0.5 — синий, 1 — ночной. */
    var shade = 0.5f; private set
    var BG = BLUE; private set
    /** «Чернила»: линии, текст, рамки. На светлой бумаге — синие, на тёмной — белые. */
    var INK = Color.WHITE; private set
    /** Фон кнопок и плашек: цвет фона с лёгкой прозрачностью — схема чуть просвечивает. */
    var PANEL = Color.argb(199, 0x1A, 0x4A, 0x9E); private set
    private var EDGE = Color.parseColor("#10357A")
    private val inkTint get() = android.graphics.PorterDuffColorFilter(INK, android.graphics.PorterDuff.Mode.SRC_IN)

    fun mix(a: Int, b: Int, k: Float) = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * k).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * k).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * k).toInt())

    fun setShade(v: Float) {
        shade = v.coerceIn(0f, 1f)
        BG = if (shade < 0.5f) mix(PAPER, BLUE, shade / 0.5f) else mix(BLUE, NIGHT, (shade - 0.5f) / 0.5f)
        val lum = (0.2126f * Color.red(BG) + 0.7152f * Color.green(BG) + 0.0722f * Color.blue(BG)) / 255f
        INK = if (lum > 0.5f) NAVY_INK else Color.WHITE
        PANEL = Color.argb(199, Color.red(BG), Color.green(BG), Color.blue(BG))
        EDGE = Term.shade(BG, 0.7f)
        img.colorFilter = if (INK == Color.WHITE) null else inkTint
        if (w > 0f) makeShaders()
    }

    private var w = 0f; private var h = 0f; private var d = 1f
    private var schematic: Bitmap? = null
    private val grid = Paint().apply { color = Color.WHITE }
    private val img = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val vignette = Paint()
    private val glow = Paint()
    private val line = Paint().apply { color = Color.WHITE }
    private val stamp = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.WHITE }
    private val stampText = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val dst = RectF()

    fun resize(c: Context, width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        d = c.resources.displayMetrics.density
        if (schematic == null) schematic = BitmapFactory.decodeResource(c.resources, R.drawable.schematic)
        stampText.typeface = c.resources.getFont(R.font.manrope_semibold)
        w = width.toFloat(); h = height.toFloat()
        makeShaders()
    }

    private fun makeShaders() {
        vignette.shader = RadialGradient(w / 2, h * 0.45f, max(w, h) * 0.75f, intArrayOf(Color.TRANSPARENT, EDGE),
            floatArrayOf(0.45f, 1f), Shader.TileMode.CLAMP)
        glow.shader = LinearGradient(0f, -12 * d, 0f, 12 * d, intArrayOf(Color.TRANSPARENT, Color.argb(46, Color.red(INK), Color.green(INK), Color.blue(INK)), Color.TRANSPARENT),
            null, Shader.TileMode.CLAMP)
    }

    fun draw(canvas: Canvas, t: Float) {
        canvas.drawColor(BG)
        if (w == 0f) return
        grid.color = INK; line.color = INK; stamp.color = INK; stampText.color = INK
        canvas.drawRect(0f, 0f, w, h, vignette)
        // миллиметровка: мелкая сетка через 14dp, крупная — через 70dp
        val step = 14 * d
        var i = 0; var x = 0f
        while (x < w) { grid.alpha = if (i % 5 == 0) 38 else 15; canvas.drawRect(x, 0f, x + max(1f, d * 0.6f), h, grid); x += step; i++ }
        i = 0; var y = 0f
        while (y < h) { grid.alpha = if (i % 5 == 0) 38 else 15; canvas.drawRect(0f, y, w, y + max(1f, d * 0.6f), grid); y += step; i++ }

        // схема: по ширине экрана; если выше экрана — медленно плавает вверх-вниз (цикл ~60 с)
        schematic?.let { b ->
            val sw = w * 0.95f; val sh = sw * b.height / b.width
            val top = if (sh > h) (h - sh) * (0.5f + 0.5f * sin(t * 6.2832f / 60f)) else (h - sh) / 2
            dst.set((w - sw) / 2, top, (w + sw) / 2, top + sh)
            img.alpha = 84; canvas.drawBitmap(b, null, dst, img)
            // скан: светлая полоса сверху вниз за 7 с, в ней схема ярче
            val sy = (t % 7f) / 7f * (h + 140 * d) - 70 * d
            for ((half, a) in listOf(35f to 110, 18f to 170, 7f to 230)) {
                canvas.save(); canvas.clipRect(0f, sy - half * d, w, sy + half * d)
                img.alpha = a; canvas.drawBitmap(b, null, dst, img)
                canvas.restore()
            }
            canvas.save(); canvas.translate(0f, sy); canvas.drawRect(0f, -12 * d, w, 12 * d, glow); canvas.restore()
            line.alpha = 128; canvas.drawRect(0f, sy, w, sy + d, line)
        }
        drawStamp(canvas)
    }

    /** Штамп чертежа в правом нижнем углу, как на референсе с дроном. */
    private fun drawStamp(canvas: Canvas) {
        val bw = 162 * d; val bh = 60 * d
        val l = w - bw - 12 * d; val tp = h - bh - 12 * d
        stamp.strokeWidth = d; stamp.alpha = 140
        canvas.drawRect(l, tp, l + bw, tp + bh, stamp)
        val rh = bh / 3
        for (k in 1..2) canvas.drawLine(l, tp + rh * k, l + bw, tp + rh * k, stamp)
        canvas.drawLine(l + 58 * d, tp, l + 58 * d, tp + bh, stamp)
        stampText.textSize = 8.5f * d; stampText.alpha = 150; stampText.letterSpacing = 0.08f
        val rows = listOf("MODEL" to "KRISA IR-REMOTE", "DRAWN BY" to "krisa", "SCALE" to "1:1      REV. A")
        rows.forEachIndexed { k, (a, b) ->
            val by = tp + rh * k + rh / 2 + 3 * d
            canvas.drawText(a, l + 5 * d, by, stampText)
            canvas.drawText(b, l + 63 * d, by, stampText)
        }
    }
}

/**
 * Ползунок светлоты чертежа: ⬜ ——|—🟦——— ⬛. Дорожка — градиент бумага → синий → ночь,
 * синяя метка — значение по умолчанию, бегунок — вертикальная черта.
 * [onPick]: при перетаскивании final = false, при отпускании — true.
 */
class ShadeSlider(c: android.content.Context, initial: Float, private val onPick: (Float, Boolean) -> Unit) : android.view.View(c) {
    private val d = c.resources.displayMetrics.density
    private var v = initial
    private val track = Paint(Paint.ANTI_ALIAS_FLAG)
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val box = RectF()
    private val sq = 20f   // сторона квадратиков ⬜ ⬛, dp
    private fun left() = (sq + 10) * d
    private fun right() = width - (sq + 10) * d

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        track.shader = LinearGradient(left(), 0f, right(), 0f,
            intArrayOf(Color.parseColor("#F2F5FA"), Color.parseColor("#1A4A9E"), Color.parseColor("#05070D")), null, Shader.TileMode.CLAMP)
    }

    override fun onDraw(canvas: Canvas) {
        val cy = height / 2f + 6 * d; val th = 26 * d
        // ⬜ и ⬛ по краям
        val s = sq * d
        p.style = Paint.Style.FILL; p.color = Color.WHITE
        canvas.drawRect(0f, cy - s / 2, s, cy + s / 2, p)
        p.color = Color.BLACK; canvas.drawRect(width - s, cy - s / 2, width.toFloat(), cy + s / 2, p)
        p.style = Paint.Style.STROKE; p.strokeWidth = d; p.color = Term.FG
        canvas.drawRect(0f, cy - s / 2, s, cy + s / 2, p); canvas.drawRect(width - s, cy - s / 2, width.toFloat(), cy + s / 2, p)
        // дорожка
        box.set(left(), cy - th / 2, right(), cy + th / 2)
        canvas.drawRect(box, track)
        canvas.drawRect(box, p)
        // 🟦 — синий по умолчанию, над серединой
        val mx = (left() + right()) / 2; val ms = 11 * d
        p.style = Paint.Style.FILL; p.color = Color.parseColor("#2F6BD8")
        canvas.drawRect(mx - ms / 2, box.top - ms - 4 * d, mx + ms / 2, box.top - 4 * d, p)
        p.style = Paint.Style.STROKE; p.color = Color.WHITE
        canvas.drawRect(mx - ms / 2, box.top - ms - 4 * d, mx + ms / 2, box.top - 4 * d, p)
        // бегунок «|»
        val x = left() + (right() - left()) * v
        p.style = Paint.Style.FILL
        p.color = Color.BLACK; canvas.drawRect(x - 3.5f * d, box.top - 8 * d, x + 3.5f * d, box.bottom + 8 * d, p)
        p.color = Color.WHITE; canvas.drawRect(x - 2f * d, box.top - 6.5f * d, x + 2f * d, box.bottom + 6.5f * d, p)
    }

    override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
        v = ((e.x - left()) / (right() - left())).coerceIn(0f, 1f)
        if (kotlin.math.abs(v - 0.5f) < 0.025f) v = 0.5f          // «прилипает» к синему
        invalidate()
        parent?.requestDisallowInterceptTouchEvent(true)
        when (e.actionMasked) {
            android.view.MotionEvent.ACTION_UP -> onPick(v, true)
            android.view.MotionEvent.ACTION_CANCEL -> {}
            else -> onPick(v, false)
        }
        return true
    }
}
