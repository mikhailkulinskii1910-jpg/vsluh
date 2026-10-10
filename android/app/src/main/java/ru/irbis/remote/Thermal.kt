package ru.irbis.remote

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/**
 * Тема «Тепловизор»: палитра ironbow (холод — фиолетовый, жар — жёлто-белый),
 * жёлтые рамки «обнаружения», HUD тепловизора и зерно матрицы.
 */
object Heat {
    /** Палитра тепловизора: id, подпись, цвета от холодного к горячему, картинка радужки. */
    class Palette(val id: String, val title: String, val pal: IntArray, val bg: Int, val fg: Int, val dim: Int,
                  val accent: Int, val glow: Int, val ink: Int, val iris: Int)
    private fun cs(vararg h: String) = h.map { Color.parseColor(it) }.toIntArray()
    private fun c(h: String) = Color.parseColor(h)
    /** Четыре самые популярные палитры тепловизоров (как у FLIR): Ironbow, White Hot, Rainbow HC, Arctic. */
    val PALETTES = listOf(
        Palette("ironbow", "IRONBOW", cs("#0B0418", "#2E0B5E", "#6B1585", "#B51F7A", "#E8382F", "#FF7A1A", "#FFC233", "#FFF27A", "#FFFFFF"),
            c("#050308"), c("#FFF1DC"), c("#E0974A"), c("#FFD43B"), c("#FF4A12"), c("#140700"), R.drawable.iris),
        Palette("white", "WHITE HOT", cs("#050505", "#1E1E22", "#3C3C42", "#616168", "#8A8A90", "#B2B2B6", "#D6D6D8", "#F0F0F0", "#FFFFFF"),
            c("#050505"), c("#F2F2F2"), c("#A3A8AE"), c("#4DFF7A"), c("#D0D8E0"), c("#0A0A0A"), R.drawable.iris_white),
        Palette("rainbow", "RAINBOW HC", cs("#0A0030", "#1A1AA8", "#0070FF", "#00C8E0", "#00E060", "#B8F000", "#FFD000", "#FF5000", "#FF0030", "#FFFFFF"),
            c("#07001F"), c("#FFFFFF"), c("#7FD6FF"), c("#FFFFFF"), c("#FF3060"), c("#10001A"), R.drawable.iris_rainbow),
        Palette("arctic", "ARCTIC", cs("#020617", "#0B1E5B", "#1C47A8", "#3C82E0", "#8EC3F2", "#E9D9A6", "#F7B733", "#FFD966", "#FFFFFF"),
            c("#020617"), c("#F2F8FF"), c("#8EC3F2"), c("#7FE3FF"), c("#F7B733"), c("#04102A"), R.drawable.iris_arctic),
    )
    var P = PALETTES[0]; private set
    fun use(id: String?) { P = PALETTES.firstOrNull { it.id == id } ?: PALETTES[0] }

    /** Текущая палитра: от холодного к горячему. */
    val PAL get() = P.pal
    /** Рамки обнаружения, как PERSON_01XX на референсах (в ironbow — жёлтые). */
    val YELLOW get() = P.accent
    val INK get() = P.ink
    val GLOW get() = P.glow

    /** Цвет «температуры» f = 0 (холодно) … 1 (раскалено). */
    fun color(f: Float, alpha: Int = 255): Int {
        val x = f.coerceIn(0f, 1f) * (PAL.size - 1)
        val i = min(x.toInt(), PAL.size - 2); val k = x - i
        val a = PAL[i]; val b = PAL[i + 1]
        fun mix(p: Int, q: Int) = (p + (q - p) * k).toInt()
        return Color.argb(alpha, mix(Color.red(a), Color.red(b)), mix(Color.green(a), Color.green(b)), mix(Color.blue(a), Color.blue(b)))
    }

    /** Тепловое пятно: в центре — самая горячая точка, к краям остывает и становится прозрачным. */
    fun bloom(cx: Float, cy: Float, r: Float, heat: Float): RadialGradient = RadialGradient(cx, cy, max(1f, r),
        intArrayOf(color(heat), color(heat * 0.82f), color(heat * 0.6f, 235), color(heat * 0.38f, 170), Color.TRANSPARENT),
        floatArrayOf(0f, 0.28f, 0.52f, 0.78f, 1f), Shader.TileMode.CLAMP)

    /** «Температура» для подписей: от комнатной до тела. */
    fun temp(heat: Float) = "%.1f°".format(22.4f + heat * 14.8f)
}

/**
 * Фон «Тепловизора»: на чёрном медленно вращается радужка (картинка-референс),
 * сверху — зерно матрицы и HUD: уголки кадра, шкала температур, REC и дата.
 */
object ThermalScene {
    private var w = 0f; private var h = 0f; private var d = 1f
    private val t0 = SystemClock.uptimeMillis()
    fun time() = (SystemClock.uptimeMillis() - t0) / 1000f

    private var iris: Bitmap? = null
    private var irisRes = 0
    private var grain: BitmapShader? = null
    private val irisP = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val grainP = Paint().apply { alpha = 38 }
    private val hud = Paint(Paint.ANTI_ALIAS_FLAG)
    private val hudText = Paint(Paint.ANTI_ALIAS_FLAG)
    private val scale = Paint()
    private val fade = Paint()
    private val m = Matrix()
    private val rnd = Random(5)
    private val date = java.text.SimpleDateFormat("MMM dd yyyy", java.util.Locale.US).format(java.util.Date()).uppercase()

    fun resize(c: Context, width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        d = c.resources.displayMetrics.density
        if (iris == null || irisRes != Heat.P.iris) { irisRes = Heat.P.iris; iris = BitmapFactory.decodeResource(c.resources, irisRes) }
        if (grain == null) {
            // зерно: случайные светлые точки, плитка повторяется и каждый кадр сдвигается
            val n = 128
            val g = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
            val r = Random(11)
            for (y in 0 until n) for (x in 0 until n) { val v = r.nextInt(256); g.setPixel(x, y, Color.argb(if (v > 150) v - 150 else 0, 255, 230, 210)) }
            grain = BitmapShader(g, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
        }
        hudText.typeface = c.resources.getFont(R.font.vt323)
        w = width.toFloat(); h = height.toFloat()
        // градиенты зависят только от размера экрана — создаются здесь, а не каждый кадр
        val s = min(w, h) * 1.18f
        fade.shader = RadialGradient(w / 2, h * 0.5f, s * 0.72f, intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, Term.BG),
            floatArrayOf(0f, 0.63f, 0.7f), Shader.TileMode.CLAMP)
        scale.shader = android.graphics.LinearGradient(0f, h * 0.7f, 0f, h * 0.3f, Heat.PAL, null, Shader.TileMode.CLAMP)
    }

    fun draw(canvas: Canvas, t: Float) {
        canvas.drawColor(Term.BG)
        if (w == 0f) return
        // радужка вращается (оборот за ~80 с) и чуть «дышит»
        iris?.let { b ->
            val s = min(w, h) * 1.18f * (1f + 0.025f * sin(t * 0.8f))
            canvas.save(); canvas.rotate(t * 4.5f, w / 2, h * 0.5f)
            irisP.alpha = 235
            canvas.drawBitmap(b, null, RectF(w / 2 - s / 2, h * 0.5f - s / 2, w / 2 + s / 2, h * 0.5f + s / 2), irisP)
            canvas.restore()
            // края картинки растворяются в чёрном — не видно квадрата при вращении
            canvas.drawRect(0f, 0f, w, h, fade)
        }
        // зерно матрицы
        grain?.let { g ->
            m.setTranslate(rnd.nextFloat() * 128, rnd.nextFloat() * 128); m.preScale(d * 0.8f, d * 0.8f); g.setLocalMatrix(m)
            grainP.shader = g; canvas.drawRect(0f, 0f, w, h, grainP)
        }
        drawHud(canvas, t)
    }

    private fun drawHud(canvas: Canvas, t: Float) {
        // уголки кадра
        hud.style = Paint.Style.STROKE; hud.strokeWidth = 1.5f * d; hud.color = Heat.YELLOW; hud.alpha = 150; hud.shader = null
        val k = 22 * d; val mg = 8 * d
        for ((x, y, sx, sy) in listOf(Q(mg, mg, 1, 1), Q(w - mg, mg, -1, 1), Q(mg, h - mg, 1, -1), Q(w - mg, h - mg, -1, -1))) {
            canvas.drawLine(x, y, x + sx * k, y, hud); canvas.drawLine(x, y, x, y + sy * k, hud)
        }
        // шкала температур у правого края
        val bx = w - 7 * d; val top = h * 0.3f; val bot = h * 0.7f
        canvas.drawRect(bx, top, bx + 3 * d, bot, scale)
        hud.strokeWidth = d; hud.color = Term.FG; hud.alpha = 140
        for (i in 0..8) { val y = top + (bot - top) * i / 8f; canvas.drawLine(bx - 3 * d, y, bx, y, hud) }
        // подписи: дата внизу, REC мигает
        hudText.textSize = 15 * d; hudText.textAlign = Paint.Align.CENTER; hudText.color = Term.DIM; hudText.alpha = 200
        canvas.drawText(date + "   ZOOM:OFF", w / 2, h - 6 * d, hudText)
        if ((t * 1.25f).toInt() % 2 == 0) {
            hud.style = Paint.Style.FILL; hud.color = Color.argb(220, 255, 50, 40)
            canvas.drawCircle(w - mg - 50 * d, h - mg - 26 * d, 3.5f * d, hud)
        }
        hudText.textAlign = Paint.Align.LEFT; hudText.color = Term.FG; hudText.alpha = 200
        canvas.drawText("REC", w - mg - 44 * d, h - mg - 21 * d, hudText)
    }

    private data class Q(val x: Float, val y: Float, val sx: Int, val sy: Int)
}
