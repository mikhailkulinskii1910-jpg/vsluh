package ru.irbis.remote

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.text.style.ReplacementSpan

/**
 * Блоки редактора сценариев в стиле Scratch: цвета категорий, «пазы» сверху и «выступы» снизу,
 * шапка «когда нажата ▶» и C-образный блок «повторить».
 */
object Scratch {
    /**
     * Цвета категорий — в стилистике текущей темы (а не стандартные цвета Scratch):
     * терминал — оттенки свечения люминофора, призма — радужное стекло, тепловизор — цвета «температуры»
     * палитры, чертёж — калька с линиями туши. [ink] — цвет текста на блоке.
     */
    class Cat(val fill: Int, val edge: Int, val ink: Int)
    /** 0 — события (шапка), 1 — устройства, 2 — команды, 3 — кондиционер, 4 — управление. */
    fun cat(i: Int): Cat {
        val bg = Color.rgb(Color.red(Term.BG), Color.green(Term.BG), Color.blue(Term.BG))
        return when {
            Term.prism -> {
                val c = Term.IRIS[intArrayOf(0, 3, 2, 4, 1)[i] % Term.IRIS.size]
                Cat(mix(Color.parseColor("#120E1F"), c, 0.62f), c, Color.WHITE)
            }
            Term.thermal -> {
                val f = Heat.color(floatArrayOf(0.95f, 0.32f, 0.52f, 0.68f, 0.82f)[i])
                Cat(f, Term.shade(f, 0.62f), if (lum(f) > 0.55f) Heat.INK else Color.WHITE)
            }
            Term.blueprint -> {
                val b = Color.rgb(Color.red(Blueprint.BG), Color.green(Blueprint.BG), Color.blue(Blueprint.BG))
                Cat(mix(b, Blueprint.INK, floatArrayOf(0.34f, 0.17f, 0.10f, 0.13f, 0.05f)[i]), Blueprint.INK, Blueprint.INK)
            }
            else -> {
                val k = floatArrayOf(0.85f, 0.40f, 0.28f, 0.34f, 0.18f)[i]
                val f = mix(bg, Term.FG, k)
                Cat(f, if (i == 0) Term.shade(Term.FG, 0.7f) else Term.FG, if (lum(f) > 0.5f) bg else Term.FG)
            }
        }
    }
    val EVENT get() = cat(0)

    fun cat(b: Scripts.Block): Cat = cat(when (b) {
        is Scripts.Block.Dev -> 1
        is Scripts.Block.Cmd -> 2
        is Scripts.Block.Ac -> 3
        else -> 4
    })

    private fun mix(a: Int, b: Int, k: Float) = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * k).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * k).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * k).toInt())
    fun lum(c: Int) = (0.299f * Color.red(c) + 0.587f * Color.green(c) + 0.114f * Color.blue(c)) / 255f
    /** Текст на поле-плашке: тёмный на светлом, светлый на тёмном. */
    private fun on(c: Int) = if (lum(c) > 0.5f) (if (lum(Term.BG) < 0.4f) Color.rgb(Color.red(Term.BG), Color.green(Term.BG), Color.blue(Term.BG)) else Color.BLACK) else Color.WHITE

    /** Подпись блока: обычный текст и поля (‹…› — выпадающий список, (…) — число). */
    fun parts(b: Scripts.Block): List<Pair<String, Int>> = when (b) {
        is Scripts.Block.Dev -> listOf("устройство " to 0, (Scripts.DEVICES.getOrNull(b.device)?.title ?: "?") to 2)
        is Scripts.Block.Cmd -> listOf("отправить " to 0, b.label to 2)
        is Scripts.Block.Ac -> listOf("кондиционер " to 0, (if (b.power) "вкл · ${b.mode.title} · ${b.temp}° · ${b.fan.title}" else "выкл") to 2)
        is Scripts.Block.Delay -> listOf("ждать " to 0, Scripts.fmt(b.sec) to 1, " сек" to 0)
        is Scripts.Block.Loop -> listOf("повторить " to 0, b.times.toString() to 1, " раз" to 0)
        Scripts.Block.End -> emptyList()
    }

    /** Поле внутри блока: «овал» цвета фона темы для чисел, «плашка с ▾» цвета обводки для выбора. */
    class Field(private val number: Boolean, private val cat: Cat, private val d: Float) : ReplacementSpan() {
        private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
        private val pad = 8 * d
        override fun getSize(p: Paint, t: CharSequence, s: Int, e: Int, fm: Paint.FontMetricsInt?): Int =
            (p.measureText(t, s, e) + 2 * pad + if (number) 0f else 14 * d).toInt()
        override fun draw(c: Canvas, t: CharSequence, s: Int, e: Int, x: Float, top: Int, y: Int, bottom: Int, p: Paint) {
            val w = getSize(p, t, s, e, null).toFloat()
            val h = p.textSize * 1.45f
            val cy = y + p.fontMetrics.ascent / 2 + p.fontMetrics.descent / 2
            val r = RectF(x, cy - h / 2, x + w, cy + h / 2)
            bg.color = if (number) Color.rgb(Color.red(Term.BG), Color.green(Term.BG), Color.blue(Term.BG)) else cat.edge
            c.drawRoundRect(r, h / 2, h / 2, bg)
            val old = p.color
            p.color = if (number) Term.FG else on(cat.edge)
            c.drawText(t, s, e, x + pad, y.toFloat(), p)
            if (!number) c.drawText("▾", x + w - pad - 9 * d, y.toFloat(), p)
            p.color = old
        }
    }

    /**
     * Форма блока. kind: 0 — обычный, 1 — шапка (скруглённый верх, без паза), 2 — C-блок «повторить»
     * (верхняя полка высотой [top], левая «рука» шириной [arm], нижняя полка высотой [bottom]).
     */
    class Shape(val cat: Cat, private val kind: Int, private val d: Float,
                private val top: Float = 0f, private val arm: Float = 0f, private val bottom: Float = 0f) : Drawable() {
        var lit = false
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
        private val path = Path()
        /** Высота выступа снизу (он рисуется внутри границ блока, следующий блок наезжает на него). */
        val bump = 5 * d

        override fun draw(c: Canvas) {
            val b = bounds; val l = b.left.toFloat(); val t = b.top.toFloat(); val r = b.right.toFloat(); val btm = b.bottom - bump
            val rr = 4 * d
            path.reset()
            if (kind == 1) {
                // шапка «когда нажата»: круглая «шляпа» сверху
                path.moveTo(l, t + 18 * d)
                path.quadTo(l + 40 * d, t - 6 * d, l + 90 * d, t + 14 * d)
                path.lineTo(r - rr, t + 14 * d); path.quadTo(r, t + 14 * d, r, t + 14 * d + rr)
            } else {
                path.moveTo(l, t + rr); path.quadTo(l, t, l + rr, t)
                path.lineTo(l + 12 * d, t)
                // паз сверху (вогнутый) — путь идёт вниз и обратно
                path.lineTo(l + 16 * d, t + 5 * d); path.lineTo(l + 28 * d, t + 5 * d); path.lineTo(l + 32 * d, t)
                path.lineTo(r - rr, t); path.quadTo(r, t, r, t + rr)
            }
            if (kind == 2) {
                val ty = t + top
                path.lineTo(r, ty - rr); path.quadTo(r, ty, r - rr, ty)
                // нижний край верхней полки с выступом внутрь «рта»
                path.lineTo(l + arm + 32 * d, ty); path.lineTo(l + arm + 28 * d, ty + 5 * d); path.lineTo(l + arm + 16 * d, ty + 5 * d); path.lineTo(l + arm + 12 * d, ty)
                path.lineTo(l + arm + rr, ty); path.quadTo(l + arm, ty, l + arm, ty + rr)
                val by = btm - bottom
                path.lineTo(l + arm, by - rr); path.quadTo(l + arm, by, l + arm + rr, by)
                path.lineTo(l + arm + 12 * d, by); path.lineTo(l + arm + 16 * d, by + 5 * d); path.lineTo(l + arm + 28 * d, by + 5 * d); path.lineTo(l + arm + 32 * d, by)
                path.lineTo(r - rr, by); path.quadTo(r, by, r, by + rr)
            }
            path.lineTo(r, btm - rr); path.quadTo(r, btm, r - rr, btm)
            // выступ снизу
            path.lineTo(l + 32 * d, btm); path.lineTo(l + 28 * d, btm + bump); path.lineTo(l + 16 * d, btm + bump); path.lineTo(l + 12 * d, btm)
            path.lineTo(l + rr, btm); path.quadTo(l, btm, l, btm - rr)
            path.close()
            fill.color = cat.fill; c.drawPath(path, fill)
            edge.color = if (lit) Color.WHITE else cat.edge; edge.strokeWidth = (if (lit) 3f else 1f) * d
            c.drawPath(path, edge)
        }

        override fun setAlpha(alpha: Int) { fill.alpha = alpha; edge.alpha = alpha }
        override fun setColorFilter(cf: ColorFilter?) {}
        @Deprecated("Deprecated in Java")
        override fun getOpacity() = PixelFormat.TRANSLUCENT
    }
}
