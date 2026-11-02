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
        for ((i, t) in listOf("Неон", "День", "Пастель", "Океан", "Малина", "Песок", "Радуга", "Лимонад").withIndex()) {
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

        // копирование варианта (⧉) и лимит 100
        click(R.id.tabItems)
        val list = root.findViewById<ViewGroup>(R.id.itemsList)
        (list.getChildAt(0) as ViewGroup).getChildAt(4).performClick(); idle(150)
        assertEquals(9, wheel.labels.size)
        assertEquals(wheel.labels[0], wheel.labels[1])
        repeat(120) { root.findViewById<View>(R.id.plus).performClick() }
        idle(150)
        assertEquals(100, wheel.labels.size)
        click(R.id.tabWheel); shot("14-wheel-100")
        click(R.id.tabItems); click(R.id.clearAll)
        (ShadowDialog.getLatestDialog() as AlertDialog).getButton(DialogInterface.BUTTON_POSITIVE).performClick(); idle(150)
        click(R.id.templates)
        (ShadowDialog.getLatestDialog() as AlertDialog).let { it.listView.performItemClick(it.listView.getChildAt(5), 5, 5) }; idle(150)

        // размер сектора: кнопка ×N открывает окно с предпросмотром
        (list.getChildAt(0) as ViewGroup).getChildAt(3).performClick(); idle(150)
        val sizeDlg = ShadowDialog.getLatestDialog() as AlertDialog
        val bar = findSeek(sizeDlg.window!!.decorView)!!
        shadowOf(bar).onSeekBarChangeListener.onProgressChanged(bar, 4, true); idle(150)
        val bmpD = Bitmap.createBitmap(sizeDlg.window!!.decorView.width, sizeDlg.window!!.decorView.height, Bitmap.Config.ARGB_8888)
        sizeDlg.window!!.decorView.draw(Canvas(bmpD))
        File(out, "15-size-dialog.png").outputStream().use { bmpD.compress(Bitmap.CompressFormat.PNG, 100, it) }
        sizeDlg.getButton(DialogInterface.BUTTON_POSITIVE).performClick(); idle(150)
        assertEquals(listOf(5, 10, 10, 10, 10, 10, 10, 10), wheel.sizes) // «Пицца» уменьшена до ×0.5
        shot("16-items-sized")
        click(R.id.tabWheel); shot("17-wheel-sized")
        // все режимы вращения: результат — сектор под стрелкой / шариком / огоньком / линией барабана
        click(R.id.tabSettings); click(R.id.optEliminate) // выбывание выкл, иначе вариантов не хватит
        click(R.id.tabWheel); root.findViewById<View>(R.id.restore).performClick(); idle(150)
        for ((k, m) in listOf("Стрелка", "Шарик", "Огоньки", "Встречное", "Барабан", "Маятник", "Часы", "Лента", "Вспышки").withIndex()) {
            click(R.id.tabSettings); clickText(m)
            click(R.id.tabWheel); shot("2${k}a-mode-$k")
            root.findViewById<View>(R.id.spin).performClick()
            if (m == "Шарик") {
                // кадры полёта шарика: дорожка → спираль → отскоки → лунка
                for (t in listOf(0.2f, 0.55f, 0.68f, 0.76f, 0.8f, 0.85f, 0.9f, 1f)) {
                    idle(1); wheel.seek(t); shot("ball-${(t * 100).toInt()}")
                }
                idle(9000)
            } else { idle(1500); shot("2${k}b-mode-$k-spin"); idle(9000) }
            shot("2${k}c-mode-$k-result")
            val res = root.findViewById<TextView>(R.id.result).text.toString()
            assertEquals(m, wheel.labels[wheel.indexUnderPointer()], res)
        }
        click(R.id.tabSettings); clickText("Колесо")
        click(R.id.tabHistory); shot("19-history-chances")
        assertTrue(findText(root, "Шансы выпадения") != null)

        // скрытая вкладка: без верного пароля не открывается
        val odds = root.findViewById<View>(R.id.panelOdds)
        fun enter(pin: String, shotName: String? = null) {
            root.findViewById<View>(R.id.title).performLongClick(); idle(150)
            val d = ShadowDialog.getLatestDialog()
            val dv = d.window!!.decorView
            pin.forEach { c -> findText(dv, c.toString())!!.performClick(); idle(60) }
            idle(400)
            if (shotName != null) {
                val b = Bitmap.createBitmap(dv.width, dv.height, Bitmap.Config.ARGB_8888)
                dv.draw(Canvas(b))
                File(out, "$shotName.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            if (d.isShowing) d.dismiss()
        }
        root.findViewById<View>(R.id.title).performClick(); idle(1000) // нажатие на заголовок — подкрутка вкл
        enter("1234", "18-pin-wrong")
        assertEquals(View.GONE, odds.visibility)
        enter("1910")
        assertEquals(View.VISIBLE, odds.visibility)
        val rig = root.findViewById<android.widget.Switch>(R.id.rigged)
        assertTrue(rig.isChecked)
        root.findViewById<View>(R.id.title).performClick(); idle(1000) // и снова выкл
        assertTrue(!rig.isChecked)
        shot("12-odds")
        click(R.id.rigged); shot("13-odds-on")
    }

    private fun findSeek(v: View): android.widget.SeekBar? {
        if (v is android.widget.SeekBar) return v
        if (v is ViewGroup) for (i in 0 until v.childCount) findSeek(v.getChildAt(i))?.let { return it }
        return null
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
