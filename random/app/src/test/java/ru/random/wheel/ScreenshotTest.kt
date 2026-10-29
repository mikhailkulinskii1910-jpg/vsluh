package ru.random.wheel

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Duration

/** Снимки экрана: колесо, вращение, варианты и скрытая вкладка «Шансы». */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-xxhdpi")
class ScreenshotTest {
    @Test
    fun shots() {
        val out = File(System.getProperty("shots.dir") ?: "build/shots").apply { mkdirs() }
        val root = Robolectric.buildActivity(MainActivity::class.java).setup().get().window.decorView
        fun idle(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))
        fun shot(name: String) {
            val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
            root.draw(Canvas(bmp))
            File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        idle(100); shot("1-wheel")
        root.findViewById<View>(R.id.spin).performClick()
        idle(1200); shot("2-spinning")
        idle(6000); shot("3-result")
        root.findViewById<View>(R.id.tabItems).performClick(); idle(100); shot("4-items")
        root.findViewById<View>(R.id.title).performLongClick(); idle(100); shot("5-odds")
        root.findViewById<View>(R.id.rigged).performClick(); idle(100); shot("6-odds-on")
    }
}
