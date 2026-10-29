package ru.random.wheel

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.os.SystemClock
import android.util.AttributeSet
import android.view.View
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/** Конфетти поверх экрана после выпадения результата. Касания не перехватывает. */
class ConfettiView(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    private class Bit(
        var x: Float, var y: Float, var vx: Float, var vy: Float,
        var rot: Float, val vr: Float, val w: Float, val h: Float, val color: Int,
    )

    private val bits = mutableListOf<Bit>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var last = 0L
    private var startedAt = 0L

    /** Выстрел из точки ([fx], [fy]) — доли ширины/высоты экрана. */
    fun burst(colors: IntArray, fx: Float = 0.5f, fy: Float = 0.45f) {
        if (width == 0 || colors.isEmpty()) return
        val d = resources.displayMetrics.density
        repeat(140) {
            val a = Random.nextDouble(0.0, Math.PI * 2)
            val speed = Random.nextDouble(250.0, 900.0).toFloat() * d
            bits.add(Bit(
                width * fx, height * fy,
                (cos(a) * speed).toFloat(), (sin(a) * speed).toFloat() - 350 * d,
                Random.nextFloat() * 360, Random.nextFloat() * 720 - 360,
                (4 + Random.nextFloat() * 5) * d, (8 + Random.nextFloat() * 8) * d,
                colors[Random.nextInt(colors.size)],
            ))
        }
        last = SystemClock.uptimeMillis()
        startedAt = last
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        if (bits.isEmpty()) return
        val now = SystemClock.uptimeMillis()
        val dt = ((now - last).coerceIn(0, 50)) / 1000f
        last = now
        val d = resources.displayMetrics.density
        val fade = (1f - (now - startedAt - 1800) / 900f).coerceIn(0f, 1f)
        val it = bits.iterator()
        while (it.hasNext()) {
            val b = it.next()
            b.vy += 1400 * d * dt
            b.vx *= 1 - 1.2f * dt
            b.x += b.vx * dt; b.y += b.vy * dt
            b.rot += b.vr * dt
            if (b.y > height + 40 * d) { it.remove(); continue }
            paint.color = b.color
            paint.alpha = (255 * fade).toInt()
            canvas.save()
            canvas.rotate(b.rot, b.x, b.y)
            canvas.drawRect(b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2, paint)
            canvas.restore()
        }
        if (fade <= 0f) bits.clear()
        if (bits.isNotEmpty()) postInvalidateOnAnimation()
    }
}
