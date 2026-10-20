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
        findText(root, "Доски")!!.performClick(); findText(root, "MocTec")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
        Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
            root.draw(Canvas(bmp))
            File(out, "moctec.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        findText(root, "Проекторы")!!.performClick()
        for (b in listOf("NEC", "Epson", "InFocus", "BenQ")) {
            findText(root, b)!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
            Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
                root.draw(Canvas(bmp))
                File(out, "proj-$b.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
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
        findText(root, "Доски")!!.performClick(); findText(root, "MocTec")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("moctec")
        findText(root, "Рулетка")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("roulette")
    }

    /** Тема «Чертёж». */
    @Test
    fun shotsBlueprint() = themed("blueprint")

    /** Ползунок светлоты «Чертежа»: светокопия, синий и ночной — пульт и вкладка «Цвет». */
    @Test
    fun shotsShade() {
        for (v in listOf(0.1f, 0.3f, 0.5f, 0.9f)) {
            val out = File(System.getProperty("shots.dir") ?: "build/shots", "shade-$v").apply { mkdirs() }
            org.robolectric.RuntimeEnvironment.getApplication()
                .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit()
                .putString("theme", "blueprint").putFloat("bp_shade", v).putString("tab", "irbis").commit()
            val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
            val root = ctl.get().window.decorView
            fun shot(name: String) = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
                root.draw(Canvas(bmp)); File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1900)); shot("splash")
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(2800))
            findText(root, "Цвет")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("tab")
            findText(root, "Доски")!!.performClick(); findText(root, "IRBIS")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("remote")
            findText(root, "Цвет")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("tab")
            ctl.pause().stop().destroy()
        }
    }

    /** «Призма» с ползунками (сдвиг радуги, цветной фон, ярче, прозрачнее) и «Чертёж» с зелёным оттенком. */
    @Test
    fun shotsTuned() {
        val cases = listOf(
            "prism-tuned" to mapOf("theme" to "prism", "pr_bright" to 0.9f, "pr_frost" to 0.15f, "pr_hue" to 0.5f, "pr_bg" to 0.6f),
            "prism-dim" to mapOf("theme" to "prism", "pr_bright" to 0.1f, "pr_frost" to 1f, "pr_hue" to 0.25f, "pr_bg" to 0.15f),
            "bp-green" to mapOf("theme" to "blueprint", "bp_hue" to 130f, "bp_shade" to 0.5f),
            "bp-red-light" to mapOf("theme" to "blueprint", "bp_hue" to 350f, "bp_shade" to 0.15f))
        for ((name, prefs) in cases) {
            val out = File(System.getProperty("shots.dir") ?: "build/shots", name).apply { mkdirs() }
            val e = org.robolectric.RuntimeEnvironment.getApplication()
                .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit().clear()
            prefs.forEach { (k, v) -> if (v is String) e.putString(k, v) else e.putFloat(k, v as Float) }
            e.putString("tab", "irbis").commit()
            val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
            val root = ctl.get().window.decorView
            fun shot(n: String) = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
                root.draw(Canvas(bmp)); File(out, "$n.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(4700))
            findText(root, "Доски")!!.performClick(); findText(root, "IRBIS")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("remote")
            findText(root, "Цвет")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("tab")
            findText(root, "Проекторы")!!.performClick()
            findText(root, "BenQ")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("proj")
            ctl.pause().stop().destroy()
        }
    }

    /** Меню выбора темы — в цветах темы: тёмный зелёный «Чертёж», тепловизор Lava, зелёный терминал. */
    @Test
    fun shotsDialogs() {
        val cases = listOf("bp" to mapOf("theme" to "blueprint", "bp_shade" to 0.9f, "bp_hue" to 130f),
            "heat" to mapOf("theme" to "thermal", "heat" to "lava"), "term" to mapOf("theme" to "terminal", "term_color" to 0xFF1FFF3A.toInt()))
        for ((name, prefs) in cases) {
            val out = File(System.getProperty("shots.dir") ?: "build/shots", "dialogs").apply { mkdirs() }
            val e = org.robolectric.RuntimeEnvironment.getApplication()
                .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit().clear()
            prefs.forEach { (k, v) -> when (v) { is String -> e.putString(k, v); is Float -> e.putFloat(k, v); is Int -> e.putInt(k, v) } }
            e.putString("tab", "color").commit()
            val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
            val root = ctl.get().window.decorView
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(4700))
            root.draw(Canvas(Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)))
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600))
            findText(root, "[tx]")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(200))
            (org.robolectric.shadows.ShadowDialog.getLatestDialog() as android.app.AlertDialog).getButton(android.app.AlertDialog.BUTTON_NEGATIVE).performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
            val dv = org.robolectric.shadows.ShadowDialog.getLatestDialog().window!!.decorView
            Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
                val c = Canvas(bmp); root.draw(c)
                val loc = IntArray(2).also { dv.getLocationOnScreen(it) }
                c.translate(((root.width - dv.width) / 2).toFloat(), ((root.height - dv.height) / 2).toFloat()); dv.draw(c)
                File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            ctl.pause().stop().destroy()
        }
    }

    /** Вкладка «Сценарии» с примером, в двух темах; и сам пример выполняется до конца. */
    @Test
    fun shotsScripts() {
        for (theme in listOf("terminal", "prism", "blueprint")) {
            val out = File(System.getProperty("shots.dir") ?: "build/shots", "scripts").apply { mkdirs() }
            org.robolectric.RuntimeEnvironment.getApplication()
                .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit().clear()
                .putString("theme", theme).putString("tab", "scripts")
                .putString("scripts", """[{"name":"Громкость","blocks":[{"t":"dev","d":1},{"t":"cmd","l":"POWER","c":83577525},{"t":"loop","n":5},{"t":"cmd","l":"VOL+","c":83607615},{"t":"delay","s":0.3},{"t":"end"},{"t":"dev","d":6},{"t":"ac","p":true,"m":"COOL","x":22,"f":"AUTO"}]}]""").commit()
            val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
            val root = ctl.get().window.decorView
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(4700))
            root.draw(Canvas(Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)))
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600))
            findText(root, "Сценарии")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
            Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
                root.draw(Canvas(bmp)); File(out, "$theme.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            ctl.pause().stop().destroy()
        }
    }

    /** Вкладка «Кондиционеры» во всех темах. */
    @Test
    fun shotsAc() {
        for (theme in listOf("terminal", "prism", "thermal", "blueprint")) {
            val out = File(System.getProperty("shots.dir") ?: "build/shots", "ac").apply { mkdirs() }
            org.robolectric.RuntimeEnvironment.getApplication()
                .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit().clear()
                .putString("theme", theme).putString("tab", "ac").commit()
            val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
            val root = ctl.get().window.decorView
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(4700))
            root.draw(Canvas(Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)))   // заставка доигрывает и уходит
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(600))
            findText(root, "Кондиционеры")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
            Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
                root.draw(Canvas(bmp)); File(out, "$theme.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            ctl.pause().stop().destroy()
        }
    }

    /** Палитры тепловизора: пульт в каждой и вкладка «Цвет». */
    @Test
    fun shotsHeat() {
        for (id in listOf("white", "rainbow", "arctic", "lava", "night")) {
            val out = File(System.getProperty("shots.dir") ?: "build/shots", "heat-$id").apply { mkdirs() }
            org.robolectric.RuntimeEnvironment.getApplication()
                .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit()
                .putString("theme", "thermal").putString("heat", id).putString("tab", "irbis").commit()
            val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
            val root = ctl.get().window.decorView
            fun shot(name: String) = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
                root.draw(Canvas(bmp)); File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(4700)); shot("remote")
            findText(root, "Цвет")!!.performClick()
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("tab")
            ctl.pause().stop().destroy()
        }
    }

    /** RGB-перелив: пульт и вкладка «Цвет» с открытой графой переливов. */
    @Test
    fun shotsRgb() {
        val out = File(System.getProperty("shots.dir") ?: "build/shots", "rgb").apply { mkdirs() }
        org.robolectric.RuntimeEnvironment.getApplication()
            .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit()
            .putString("theme", "terminal").putString("rgb", "Rainbow").putBoolean("rgb_open", true).putString("tab", "irbis").commit()
        val ctl = Robolectric.buildActivity(MainActivity::class.java).setup()
        val root = ctl.get().window.decorView
        fun shot(name: String) = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888).also { bmp ->
            root.draw(Canvas(bmp)); File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1900)); shot("splash")
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(2800)); shot("remote")
        findText(root, "Цвет")!!.performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300)); shot("tab")
        // прокрутить к графе переливов
        (findText(root, "[ RGB: Rainbow ]")!!).let { b -> (b.parent.parent.parent as? android.widget.ScrollView)?.scrollTo(0, (b.parent as View).top + b.top - 200) }
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100)); shot("list")
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
        findText(root, "Доски")!!.performClick(); findText(root, "IRBIS")!!.performClick()
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
        findText(root, "Доски")!!.performClick(); findText(root, "IRBIS")!!.performClick()
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
