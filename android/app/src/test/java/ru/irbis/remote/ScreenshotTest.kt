package ru.irbis.remote

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Duration

/** Снимки экрана для проверки оформления: заставка по кадрам и сам пульт. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-xxhdpi")
class ScreenshotTest {
    @Test
    fun shots() {
        val out = File(System.getProperty("shots.dir") ?: "build/shots").apply { mkdirs() }
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val root = ctl.get().window.decorView
        var t = 0L
        for (at in listOf(300L, 900L, 1150L, 1400L, 1900L, 2500L, 3200L, 4200L, 4700L)) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(at - t)); t = at
            val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(bmp))
            File(out, "f%04d.png".format(at)).outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        // нажатие на J OK: крысы должны подпрыгнуть и разбежаться от пальца
        val key = findKey(root, "J OK")!!
        val loc = IntArray(2).also { key.getLocationInWindow(it) }
        val x = loc[0] + key.width / 2f; val y = loc[1] + key.height / 2f
        root.dispatchTouchEvent(MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, x, y, 0))
        for (ms in listOf(16L, 120L, 400L)) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))
            val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(bmp))
            File(out, "scare%03d.png".format(ms)).outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        root.dispatchTouchEvent(MotionEvent.obtain(0, 0, MotionEvent.ACTION_UP, x, y, 0))

        // вкладка MocTec: подбор кода выключения
        findText(root, "MocTec")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
        Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
            root.draw(Canvas(bmp))
            File(out, "moctec.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        findText(root, "Рулетка")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
        Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
            root.draw(Canvas(bmp))
            File(out, "roulette.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    /** Тема «Призма»: заставка, пульт, нажатие кнопки, вкладка MocTec. */
    @Test
    fun shotsPrism() = themed("prism")

    /** Тема «Тепловизор»: те же кадры. */
    @Test
    fun shotsThermal() = themed("thermal")

    private fun themed(theme: String) {
        val out = File(System.getProperty("shots.dir") ?: "build/shots", theme).apply { mkdirs() }
        org.robolectric.RuntimeEnvironment.getApplication()
            .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit().putString("theme", theme).commit()
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val root = ctl.get().window.decorView
        fun shot(name: String) = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
            root.draw(Canvas(bmp)); File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        var t = 0L
        for (at in listOf(1100L, 1900L, 4700L)) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(at - t)); t = at; shot("p%04d".format(at)) }
        val key = findKey(root, "MENU")!!
        val loc = IntArray(2).also { key.getLocationInWindow(it) }
        val x = loc[0] + key.width / 2f; val y = loc[1] + key.height / 2f
        root.dispatchTouchEvent(MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, x, y, 0))
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(60)); shot("press")
        root.dispatchTouchEvent(MotionEvent.obtain(0, 0, MotionEvent.ACTION_UP, x, y, 0))
        findText(root, "MocTec")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("moctec")
        findText(root, "Рулетка")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("roulette")
    }

    /** Вкладка «Цвет» первой темы: зелёный «люминофор» — сама вкладка и пульт в этом цвете. */
    @Test
    fun shotsColor() {
        val out = File(System.getProperty("shots.dir") ?: "build/shots", "color").apply { mkdirs() }
        org.robolectric.RuntimeEnvironment.getApplication()
            .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit()
            .putString("theme", "terminal").putInt("term_color", android.graphics.Color.parseColor("#1FFF3A"))
            .putBoolean("matrix", false).putString("tab", "color").commit()
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val root = ctl.get().window.decorView
        fun shot(name: String) = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
            root.draw(Canvas(bmp)); File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1900)); shot("splash")
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(2800))
        findText(root, "IRBIS")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("remote")
        findText(root, "Цвет")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("tab")
    }

    /** Зелёный + «Матрица»: бегущий код на фоне пульта и вкладка «Цвет» с включённой кнопкой. */
    @Test
    fun shotsMatrix() {
        val out = File(System.getProperty("shots.dir") ?: "build/shots", "matrix").apply { mkdirs() }
        org.robolectric.RuntimeEnvironment.getApplication()
            .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit()
            .putString("theme", "terminal").putInt("term_color", android.graphics.Color.parseColor("#1FFF3A"))
            .putBoolean("matrix", true).putString("tab", "color").commit()
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val root = ctl.get().window.decorView
        fun shot(name: String) = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
            root.draw(Canvas(bmp)); File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1900)); shot("splash")
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(2800))
        findText(root, "IRBIS")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("remote")
        findText(root, "Цвет")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("tab")
    }

    private fun findText(v: View, t: String): android.widget.TextView? = when (v) {
        is android.widget.TextView -> v.takeIf { it.text.toString() == t }
        is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { findText(v.getChildAt(it), t) }
        else -> null
    }

    private fun findKey(v: View, label: String): KeyView? = when (v) {
        is KeyView -> v.takeIf { it.label == label }
        is ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { findKey(v.getChildAt(it), label) }
        else -> null
    }
}
