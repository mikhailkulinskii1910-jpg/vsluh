package ru.random.wheel

import android.app.AlertDialog
import android.content.DialogInterface
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.io.File
import java.time.Duration

/** Снимки экрана и проверка основных сценариев: темы, выбывание, «Удалить все», история, «Шансы». */
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
        fun click(id: Int) { root.findViewById<View>(id).performClick(); idle(150) }
        fun clickText(s: String) { findText(root, s)!!.performClick(); idle(150) }
        val wheel = root.findViewById<WheelView>(R.id.wheel)

        idle(100); shot("01-wheel")
        click(R.id.spin); idle(1000); shot("02-spinning")
        idle(8000); shot("03-result")

        // выбывание: выпавший вариант уходит с колеса перед следующим вращением
        click(R.id.tabSettings); shot("04-settings")
        click(R.id.optEliminate)
        click(R.id.tabWheel)
        click(R.id.spin); idle(9000); shot("05-eliminate")
        click(R.id.spin); idle(200)
        assertEquals(5, wheel.labels.size)
        idle(9000)

        // темы
        click(R.id.tabSettings)
        for ((i, t) in listOf("Неон", "День", "Пастель", "Океан").withIndex()) {
            clickText(t); click(R.id.tabWheel); shot("06-theme-$i-$t"); click(R.id.tabSettings)
        }
        clickText("Ночь")

        click(R.id.tabHistory); shot("07-history")

        click(R.id.tabItems); shot("08-items")
        click(R.id.clearAll)
        (ShadowDialog.getLatestDialog() as AlertDialog).getButton(DialogInterface.BUTTON_POSITIVE).performClick(); idle(150)
        assertTrue(wheel.labels.isEmpty())
        shot("09-items-empty")
        click(R.id.tabWheel); shot("10-wheel-empty")

        click(R.id.tabItems); click(R.id.templates)
        shot("11-templates")
        val dlg = ShadowDialog.getLatestDialog() as AlertDialog
        dlg.listView.performItemClick(dlg.listView.getChildAt(5), 5, 5); idle(150)
        assertEquals(8, wheel.labels.size)

        // скрытая вкладка: без верного пароля не открывается
        val odds = root.findViewById<View>(R.id.panelOdds)
        fun enter(pin: String) {
            root.findViewById<View>(R.id.title).performLongClick(); idle(150)
            val d = ShadowDialog.getLatestDialog() as AlertDialog
            findEdit(d.window!!.decorView)!!.setText(pin)
            d.getButton(DialogInterface.BUTTON_POSITIVE).performClick(); idle(150)
            if (d.isShowing) d.dismiss()
        }
        enter("1234")
        assertEquals(View.GONE, odds.visibility)
        enter("1910")
        assertEquals(View.VISIBLE, odds.visibility)
        shot("12-odds")
        click(R.id.rigged); shot("13-odds-on")
    }

    private fun findEdit(v: View): android.widget.EditText? {
        if (v is android.widget.EditText) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) findEdit(v.getChildAt(i))?.let { return it }
        return null
    }

    private fun findText(v: View, s: String): View? {
        if (v is TextView && (v.text.toString() == s || v.text.toString() == "✓ $s")) return (v.parent as? View)?.takeIf { it.hasOnClickListeners() } ?: v
        if (v is ViewGroup) for (i in 0 until v.childCount) findText(v.getChildAt(i), s)?.let { return it }
        return null
    }
}
