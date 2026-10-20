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
    /** Цвета категорий, как в Scratch 3: события, «движение» (устройства), расширения (команды), «внешность» (кондиционер), управление. */
    class Cat(val fill: Int, val edge: Int)
    val EVENT = Cat(Color.parseColor("#FFBF00"), Color.parseColor("#CC9900"))
    val DEVICE = Cat(Color.parseColor("#4C97FF"), Color.parseColor("#3373CC"))
    val COMMAND = Cat(Color.parseColor("#0FBD8C"), Color.parseColor("#0B8E69"))
    val AC = Cat(Color.parseColor("#9966FF"), Color.parseColor("#774DCB"))
    val CONTROL = Cat(Color.parseColor("#FFAB19"), Color.parseColor("#CF8B17"))

    fun cat(b: Scripts.Block): Cat = when (b) {
        is Scripts.Block.Dev -> DEVICE
        is Scripts.Block.Cmd -> COMMAND
        is Scripts.Block.Ac -> AC
        else -> CONTROL
    }

    /** Подпись блока: обычный текст и поля (‹…› — выпадающий список, (…) — число). */
    fun parts(b: Scripts.Block): List<Pair<String, Int>> = when (b) {
        is Scripts.Block.Dev -> listOf("устройство " to 0, (Scripts.DEVICES.getOrNull(b.device)?.title ?: "?") to 2)
        is Scripts.Block.Cmd -> listOf("отправить " to 0, b.label to 2)
        is Scripts.Block.Ac -> listOf("кондиционер " to 0, (if (b.power) "вкл · ${b.mode.title} · ${b.temp}° · ${b.fan.title}" else "выкл") to 2)
        is Scripts.Block.Delay -> listOf("ждать " to 0, Scripts.fmt(b.sec) to 1, " сек" to 0)
        is Scripts.Block.Loop -> listOf("повторить " to 0, b.times.toString() to 1, " раз" to 0)
        Scripts.Block.End -> emptyList()
    }

    /** Поле внутри блока: белый «овал» для чисел, тёмная «плашка с ▾» для выбора. */
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
            bg.color = if (number) Color.WHITE else cat.edge
            c.drawRoundRect(r, h / 2, h / 2, bg)
            val old = p.color
            p.color = if (number) Color.parseColor("#575E75") else Color.WHITE
            c.drawText(t, s, e, x + pad, y.toFloat(), p)
            if (!number) c.drawText("▾", x + w - pad - 9 * d, y.toFloat(), p)
            p.color = old
        }
    }

    /**
     * Форма блока. kind: 0 — обычный, 1 — шапка (скруглённый верх, без паза), 2 — C-блок «повторить»
     * (верхняя полка высотой [top], левая «рука» шириной [arm], нижняя полка высотой [bottom]).
     */
    class Shape(private val cat: Cat, private val kind: Int, private val d: Float,
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
