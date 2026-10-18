package ru.vsluh.glassblock

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.View
import kotlin.math.PI
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Живой стеклоблок: сцена из фото гнётся сеткой (drawBitmapMesh) — качаются растения, рябит вода,
 * поднимаются пузырьки; поверх — неподвижная стеклянная рамка. Формулы те же, что в tools/make_frames.py.
 */
class WaterView(context: Context) : View(context) {
    private val opts = BitmapFactory.Options().apply { inScaled = false }
    private val scene: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.water_scene, opts)
    private val frame: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.glass_frame, opts)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val start = SystemClock.uptimeMillis()

    // Сетка в координатах сцены (сцена = фото, обрезанное с CROP_X/CROP_Y).
    private val verts = FloatArray((MESH + 1) * (MESH + 1) * 2)
    private val base = FloatArray(verts.size)
    private val weight = FloatArray(verts.size / 2)
    private val dst = RectF()

    init {
        val w = scene.width.toFloat(); val h = scene.height.toFloat()
        var i = 0
        for (gy in 0..MESH) for (gx in 0..MESH) {
            val x = w * gx / MESH; val y = h * gy / MESH
            base[2 * i] = x; base[2 * i + 1] = y
            weight[i] = windowMask(x + CROP_X, y + CROP_Y, 24f, -6f)
            i++
        }
    }

    override fun onDraw(canvas: Canvas) {
        val t = ((SystemClock.uptimeMillis() - start) % LOOP_MS) / LOOP_MS.toFloat()
        for (i in weight.indices) {
            val x = base[2 * i] + CROP_X; val y = base[2 * i + 1] + CROP_Y
            val u = (x - WX0) / (WX1 - WX0)
            val v = ((y - WY0) / (WY1 - WY0)).coerceIn(0f, 1f)
            val s = (1 - v).pow(1.6f)
            val a = TAU * (t + 0.8f * u)
            var dx = SWAY * s * sin(a) + SWAY2 * s * sin(TAU * (2 * t + 1.7f * u + 0.3f))
            var dy = BOB * s * sin(a + 1.2f)
            dx += RIPPLE * sin(TAU * (6 * v - t))
            dy += RIPPLE * sin(TAU * (5 * u + t))
            verts[2 * i] = base[2 * i] + dx * weight[i]
            verts[2 * i + 1] = base[2 * i + 1] + dy * weight[i]
        }

        val side = min(width, height) * 0.92f
        val k = side / scene.width
        canvas.save()
        canvas.translate((width - side) / 2, (height - side) / 2)
        canvas.scale(k, k)
        canvas.drawBitmapMesh(scene, MESH, MESH, verts, 0, null, 0, paint)
        drawBubbles(canvas, t)
        dst.set(0f, 0f, scene.width.toFloat(), scene.height.toFloat())
        canvas.drawBitmap(frame, null, dst, paint)
        canvas.restore()
        postInvalidateOnAnimation()
    }

    private fun drawBubbles(canvas: Canvas, t: Float) {
        for (b in BUBBLES) {
            val p = (t + b[1]) % 1f
            val y = WY1 - 20 - p * (WY1 - WY0 - 30) - CROP_Y
            val x = WX0 + b[0] * (WX1 - WX0) + b[3] * sin(TAU * (3 * p + b[0])) - CROP_X
            val fade = min(1f, min(p / 0.12f, (1 - p) / 0.15f))
            val r = b[2]
            fill.color = argb((34 * fade).toInt(), 200, 230, 220); canvas.drawCircle(x, y, r, fill)
            ring.color = argb((170 * fade).toInt(), 225, 245, 235); ring.strokeWidth = 0.9f
            canvas.drawCircle(x, y, r - 0.45f, ring)
            fill.color = argb((220 * fade).toInt(), 255, 255, 255)
            canvas.drawCircle(x - r * 0.4f, y - r * 0.4f, r * 0.35f, fill)
        }
    }

    private fun argb(a: Int, r: Int, g: Int, b: Int) = (a.coerceIn(0, 255) shl 24) or (r shl 16) or (g shl 8) or b

    companion object {
        private const val MESH = 48
        private const val LOOP_MS = 2800L
        private const val TAU = (2 * PI).toFloat()
        private const val CROP_X = 8f
        private const val CROP_Y = 8f
        private const val WX0 = 104f; private const val WY0 = 92f
        private const val WX1 = 642f; private const val WY1 = 630f
        private const val WR = 45f
        private const val SWAY = 9f
        private const val SWAY2 = 3f
        private const val BOB = 2.5f
        private const val RIPPLE = 1.3f
        // x (доля окна), фаза, радиус, качание
        private val BUBBLES = arrayOf(
            floatArrayOf(0.18f, 0.05f, 4.0f, 5f), floatArrayOf(0.33f, 0.55f, 2.6f, 3f),
            floatArrayOf(0.52f, 0.30f, 3.4f, 4f), floatArrayOf(0.71f, 0.80f, 2.2f, 3f),
            floatArrayOf(0.84f, 0.15f, 3.8f, 6f), floatArrayOf(0.62f, 0.65f, 1.8f, 2f),
        )

        /** Скруглённое окно с растушёвкой: 1 внутри, 0 снаружи (как rounded_mask в make_frames.py). */
        private fun windowMask(x: Float, y: Float, feather: Float, inset: Float): Float {
            val x0 = WX0 + inset; val y0 = WY0 + inset; val x1 = WX1 - inset; val y1 = WY1 - inset
            val r = max(WR - inset, 1f)
            val cx = x.coerceIn(x0 + r, x1 - r); val cy = y.coerceIn(y0 + r, y1 - r)
            val d = hypot(x - cx, y - cy) - r
            return (0.5f - d / feather).coerceIn(0f, 1f)
        }
    }
}
