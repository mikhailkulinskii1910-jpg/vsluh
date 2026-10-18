package ru.vsluh.glassblock

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.View
import kotlin.math.exp
import kotlin.math.min

/**
 * Пластинка в боксе: диск крутится Canvas'ом, блик винила неподвижен, бокс со шпинделем сверху.
 * Разгон и остановка плавные, как у проигрывателя. Геометрия — из tools/make_disc.py.
 */
class DiscView(context: Context) : View(context) {
    private val opts = BitmapFactory.Options().apply { inScaled = false }
    private val disc: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.disc_art, opts)
    private val sheen: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.disc_sheen, opts)
    private val case: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.case_front, opts)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF(0f, 0f, SIZE, SIZE)    // все слои одного размера, диск в центре
    private val square = RectF()

    var spinning = false
        set(value) { field = value; invalidate() }
    private var angle = 0f
    private var speed = 0f          // градусов в секунду
    private var last = 0L

    /** Попадает ли касание в бокс. */
    fun hit(x: Float, y: Float) = square.contains(x, y)

    override fun onDraw(canvas: Canvas) {
        val now = SystemClock.uptimeMillis()
        val dt = if (last == 0L) 0f else min((now - last) / 1000f, 0.1f)
        last = now
        val target = if (spinning) 360f / TURN_S else 0f
        speed += (target - speed) * (1 - exp(-dt / EASE_S))
        if (!spinning && speed < 1f) speed = 0f
        angle = (angle + speed * dt) % 360f

        val side = min(width, height) * 0.92f
        val k = side / SIZE
        square.set((width - side) / 2, (height - side) / 2, (width + side) / 2, (height + side) / 2)
        canvas.save()
        canvas.translate(square.left, square.top)
        canvas.scale(k, k)
        canvas.save()
        canvas.rotate(angle, SIZE / 2, SIZE / 2)
        canvas.drawBitmap(disc, null, rect, paint)
        canvas.restore()
        canvas.drawBitmap(sheen, null, rect, paint)
        canvas.drawBitmap(case, null, rect, paint)
        canvas.restore()
        if (speed > 0f || spinning) postInvalidateOnAnimation() else last = 0L
    }

    companion object {
        private const val SIZE = 740f
        private const val TURN_S = 1.92f      // как в виджете (indeterminateDuration)
        private const val EASE_S = 0.45f
    }
}
