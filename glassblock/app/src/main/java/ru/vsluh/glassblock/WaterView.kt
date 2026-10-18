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
 * Живой стеклоблок: вода неподвижна, слой растений гнётся сеткой (drawBitmapMesh) — стебли качаются
 * от дна, листья покачиваются; поверх — неподвижная стеклянная рамка. Формулы те же, что в tools/make_frames.py.
 */
class WaterView(context: Context) : View(context) {
    private val opts = BitmapFactory.Options().apply { inScaled = false }
    private val water: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.water_bg, opts)
    private val plants: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.plants, opts)
    private val frame: Bitmap = BitmapFactory.decodeResource(resources, R.drawable.glass_frame, opts)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val start = SystemClock.uptimeMillis()

    // Сетка в координатах слоёв (слои = фото, обрезанное с CROP_X/CROP_Y); u, v, s и вес считаются один раз.
    private val n = (MESH + 1) * (MESH + 1)
    private val verts = FloatArray(n * 2)
    private val base = FloatArray(n * 2)
    private val weight = FloatArray(n)
    private val us = FloatArray(n)
    private val vs = FloatArray(n)
    private val ss = FloatArray(n)
    private val dst = RectF()

    init {
        val w = plants.width.toFloat(); val h = plants.height.toFloat()
        var i = 0
        for (gy in 0..MESH) for (gx in 0..MESH) {
            val x = w * gx / MESH; val y = h * gy / MESH
            base[2 * i] = x; base[2 * i + 1] = y
            weight[i] = windowMask(x + CROP_X, y + CROP_Y, 24f, -6f)
            us[i] = (x + CROP_X - WX0) / (WX1 - WX0)
            vs[i] = ((y + CROP_Y - WY0) / (WY1 - WY0)).coerceIn(0f, 1f)
            ss[i] = (1 - vs[i]).pow(1.6f)   // стебли закреплены у дна, верх качается сильнее
            i++
        }
    }

    override fun onDraw(canvas: Canvas) {
        val t = ((SystemClock.uptimeMillis() - start) % LOOP_MS) / LOOP_MS.toFloat()
        for (i in 0 until n) {
            val wgt = weight[i]
            if (wgt == 0f) { verts[2 * i] = base[2 * i]; verts[2 * i + 1] = base[2 * i + 1]; continue }
            val u = us[i]; val v = vs[i]; val s = ss[i]
            val a = TAU * (t + 0.6f * u - 0.25f * (1 - v))
            val dx = SWAY * s * sin(a) + SWAY2 * s * sin(TAU * (2 * t + 1.3f * u + 0.5f * v + 0.3f))
            val dy = BOB * s * sin(a + 1.2f)
            verts[2 * i] = base[2 * i] + dx * wgt
            verts[2 * i + 1] = base[2 * i + 1] + dy * wgt
        }

        val side = min(width, height) * 0.92f
        val k = side / plants.width
        canvas.save()
        canvas.translate((width - side) / 2, (height - side) / 2)
        canvas.scale(k, k)
        dst.set(0f, 0f, plants.width.toFloat(), plants.height.toFloat())
        canvas.drawBitmap(water, null, dst, paint)
        canvas.drawBitmapMesh(plants, MESH, MESH, verts, 0, null, 0, paint)
        canvas.drawBitmap(frame, null, dst, paint)
        canvas.restore()
        postInvalidateOnAnimation()
    }

    companion object {
        private const val MESH = 48
        private const val LOOP_MS = 2880L
        private const val TAU = (2 * PI).toFloat()
        private const val CROP_X = 8f
        private const val CROP_Y = 8f
        private const val WX0 = 104f; private const val WY0 = 92f
        private const val WX1 = 642f; private const val WY1 = 630f
        private const val WR = 45f
        private const val SWAY = 8f
        private const val SWAY2 = 2.5f
        private const val BOB = 2.5f

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
