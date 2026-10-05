package ru.irbis.remote

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
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
        for (at in listOf(300L, 900L, 1150L, 1400L, 1900L, 2500L, 3200L, 4200L)) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(at - t)); t = at
            val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(bmp))
            File(out, "f%04d.png".format(at)).outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
}
