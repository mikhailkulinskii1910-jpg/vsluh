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
    val BG = Color.parseColor("#1A4A9E")
    /** Фон кнопок и плашек: синий с лёгкой прозрачностью — схема чуть просвечивает. */
    val PANEL = Color.argb(199, 0x1A, 0x4A, 0x9E)
    private val EDGE = Color.parseColor("#10357A")

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
        vignette.shader = RadialGradient(w / 2, h * 0.45f, max(w, h) * 0.75f, intArrayOf(Color.TRANSPARENT, EDGE),
            floatArrayOf(0.45f, 1f), Shader.TileMode.CLAMP)
        glow.shader = LinearGradient(0f, -12 * d, 0f, 12 * d, intArrayOf(Color.TRANSPARENT, Color.argb(46, 255, 255, 255), Color.TRANSPARENT),
            null, Shader.TileMode.CLAMP)
    }

    fun draw(canvas: Canvas, t: Float) {
        canvas.drawColor(BG)
        if (w == 0f) return
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
