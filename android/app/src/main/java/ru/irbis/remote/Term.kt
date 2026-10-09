package ru.irbis.remote

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.os.SystemClock
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/**
 * Палитра и шрифты. Три темы:
 *  - «Терминал» — чёрно-белый терминал, пиксельный VT323;
 *  - «Призма» — чёрный фон, переливающееся «плёночное» стекло, радужные блики как на CD и призмах;
 *  - «Тепловизор» — кадр тепловизора: палитра ironbow, жёлтые рамки обнаружения, HUD и зерно.
 */
object Term {
    var prism = false; private set
    var thermal = false; private set
    var BG = Color.BLACK; private set
    var FG = Color.parseColor("#EDEDED"); private set
    var DIM = Color.parseColor("#8A8A8A"); private set
    var LINE = Color.parseColor("#5C5C5C"); private set
    var FAINT = Color.parseColor("#151515"); private set
    const val NOISE = "#$%&@01<>/\\|=+*:;░▒▓"

    /** Радужные цвета «Призмы»: фиолетовый → бирюзовый → мятный → жёлтый → коралловый → розовый. */
    val IRIS = intArrayOf(
        Color.parseColor("#8B6CFF"), Color.parseColor("#3FE0FF"), Color.parseColor("#62FFB8"),
        Color.parseColor("#FFE66B"), Color.parseColor("#FF8A5C"), Color.parseColor("#FF5FD8"), Color.parseColor("#8B6CFF"))

    /** Заголовки и кнопки. */
    lateinit var mono: Typeface
    /** Русский текст: в VT323 нет кириллицы, поэтому в «Терминале» — системный моноширинный. */
    var ru: Typeface = Typeface.MONOSPACE; private set

    /** Цвета «люминофора» для первой темы: выбираются во вкладке «Цвет». */
    val PHOSPHOR = listOf(
        "Белый" to Color.parseColor("#EDEDED"), "Зелёный" to Color.parseColor("#33FF66"), "Янтарь" to Color.parseColor("#FFB000"),
        "Голубой" to Color.parseColor("#4FD8FF"), "Розовый" to Color.parseColor("#FF6AD5"), "Красный" to Color.parseColor("#FF4D4D"),
        "Сирень" to Color.parseColor("#A98BFF"), "Лимон" to Color.parseColor("#E9F55A"))
    val DEFAULT_COLOR = PHOSPHOR[0].second

    /** Цвет, умноженный на k (k < 1 — темнее). */
    fun shade(c: Int, k: Float) = Color.rgb((Color.red(c) * k).toInt(), (Color.green(c) * k).toInt(), (Color.blue(c) * k).toInt())

    fun init(c: Context, theme: String, termColor: Int = DEFAULT_COLOR) {
        prism = theme == "prism"
        thermal = theme == "thermal"
        if (thermal) {
            BG = Color.parseColor("#050308"); FG = Color.parseColor("#FFF1DC"); DIM = Color.parseColor("#E0974A")
            LINE = Heat.YELLOW; FAINT = Color.parseColor("#1A0E10")
            mono = c.resources.getFont(R.font.vt323); ru = Typeface.MONOSPACE
        } else if (prism) {
            BG = Color.parseColor("#07060B"); FG = Color.parseColor("#F4F1FF"); DIM = Color.parseColor("#A79FC6")
            LINE = Color.parseColor("#4B4270"); FAINT = Color.parseColor("#1A1726")
            mono = c.resources.getFont(R.font.unbounded); ru = c.resources.getFont(R.font.manrope)
        } else {
            // весь «Терминал» строится от одного цвета: основной, приглушённый, рамки и фон-лог
            BG = Color.BLACK; FG = termColor; DIM = shade(termColor, 0.58f)
            LINE = shade(termColor, 0.39f); FAINT = shade(termColor, 0.089f)
            mono = c.resources.getFont(R.font.vt323); ru = Typeface.MONOSPACE
        }
    }

    /** Фон кнопок-рамок шапки, вкладок и панели MocTec в текущей теме. */
    fun boxBg(c: Context, on: Boolean = false): android.graphics.drawable.Drawable {
        if (prism) return GlassDrawable(c, on)
        val d = c.resources.displayMetrics.density
        if (thermal) return android.graphics.drawable.GradientDrawable().apply {
            // рамка обнаружения; «включённая» — раскалённая полоса
            if (on) { orientation = android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT; colors = intArrayOf(Heat.color(0.55f), Heat.color(0.72f), Heat.color(0.86f)) }
            else setColor(Color.argb(170, 0, 0, 0))
            setStroke(d.toInt().coerceAtLeast(1), if (on) Heat.color(0.95f) else Heat.YELLOW)
        }
        return android.graphics.drawable.GradientDrawable().apply {
            setColor(if (on) FG else Color.BLACK)
            setStroke(d.toInt().coerceAtLeast(1), if (on) FG else LINE)
        }
    }

    /** Цвет текста на «включённом» фоне boxBg. */
    fun onBoxText() = if (prism) Color.parseColor("#120E1F") else if (thermal) Heat.INK else Color.BLACK

    /** Строки «лога» для фона: установка пакетов, скан портов и коды пульта. */
    val LOG: List<String> by lazy {
        val pk = listOf("libc6", "libperl5.30", "perl-base", "zlib1g", "libblkid1", "libuuid1", "fdisk", "util-linux",
            "libgcc-s1", "libstdc++6", "dpkg", "tar", "gzip", "login", "bash", "binutils", "gcc-9", "cpp-9", "gpg", "openssl")
        val out = ArrayList<String>()
        pk.forEachIndexed { i, p ->
            out += "Get:${i + 21} http://ftpmaster.internal/ubuntu focal-updates/main amd64 $p [${100 + i * 137 % 3900} kB]"
        }
        pk.forEach { p -> out += "Preparing to unpack .../$p.deb ..."; out += "Unpacking $p over (${Random(p.hashCode()).nextInt(1, 9)}.${p.length}) ..." }
        out += listOf("Starting Nmap 7.60 ( https://nmap.org )", "PORT     STATE SERVICE  VERSION",
            "25/tcp   open  smtp     Exim smtpd 4.84_2", "53/tcp   open  domain   ISC BIND", "80/tcp   open  http     Apache httpd 2.2.15",
            "-=[ 22/tcp, ssh ]=- * OPEN *", "-=[ 631/tcp, ipp ]=- * OPEN *", "PROGRAM MANDELBROT_SET;", "uses vga,crt,mouse;",
            "  Pmin:=-2.25;Qmin:=-1.5;", "  repeat k:=k+1; until (k>kmax);")
        KEYS.forEach { (l, c) -> out += "irsend nec 0x%08X  # %s".format(c, l) }
        out.shuffle(Random(7))
        out
    }

    /** Пиксельная бегущая крыса, 2 кадра (лапы перебирают). «#» — пиксель. */
    val RAT = listOf(
        listOf(
            "....................##......",
            "...................####.....",
            "............###########.....",
            ".........###############....",
            ".......################.#...",
            "......#####################.",
            "#.....##################....",
            ".#...##################.....",
            "..###.###############.......",
            "........##.......##.........",
            ".......##.........##........",
        ),
        listOf(
            "....................##......",
            "...................####.....",
            "............###########.....",
            ".........###############....",
            ".......################.#...",
            "......#####################.",
            "......##################....",
            "#....##################.....",
            ".####.###############.......",
            ".........##.....##..........",
            "..........#.....#...........",
        ),
    )

    fun scramble(text: String, progress: Float, rnd: Random = Random): String {
        val shown = (text.length * progress).toInt()
        return buildString {
            text.forEachIndexed { i, ch -> append(if (i < shown || ch == ' ') ch else NOISE[rnd.nextInt(NOISE.length)]) }
        }
    }
}

/** Фон: медленно ползущий вверх лог терминала + сканлайны. */
class TerminalBackground(c: Context) : View(c) {
    private val d = c.resources.displayMetrics.density
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Term.FAINT; typeface = Typeface.MONOSPACE; textSize = 11f * c.resources.displayMetrics.scaledDensity }
    private val scan = Paint().apply { color = Color.argb(70, 0, 0, 0) }
    private val lineH = p.textSize * 1.35f
    private val start = SystemClock.uptimeMillis()

    // Крысы: кадры спрайта как маленькие битмапы, рисуются увеличенными без сглаживания — пиксели остаются чёткими.
    private val ratFrames = Term.RAT.map { rows ->
        Bitmap.createBitmap(rows[0].length, rows.size, Bitmap.Config.ARGB_8888).apply {
            rows.forEachIndexed { y, r -> r.forEachIndexed { x, ch -> if (ch == '#') setPixel(x, y, Color.WHITE) } }
        }
    }
    private val ratPaint = Paint().apply { isFilterBitmap = false; alpha = 120 }
    private val ratPx = 2.5f * d
    private val ratW = Term.RAT[0][0].length * ratPx
    private val ratH = Term.RAT[0].size * ratPx
    private val ratDst = RectF()
    private val termTint = PorterDuffColorFilter(Term.FG, PorterDuff.Mode.SRC_IN)
    private val box = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = d }
    private val tag = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = c.resources.getFont(R.font.vt323); textSize = 12 * d }

    /** Крыса: позиция и скорость в px, направление; panic — убегает от пальца; wait — сидит за краем экрана. */
    /** shade — яркость крысы: от почти белой до тёмно-серой (белый с прозрачностью на чёрном фоне). */
    private class Rat(val speed: Float, val shade: Int) {
        var x = 0f; var y = 0f; var dir = 1; var stride = 0f
        var panic = false; var wait = 0f; var hop = 1f
    }
    private val rats = listOf(70f to 215, 110f to 95, 45f to 160, 90f to 70, 130f to 130).map { (v, a) -> Rat(v * d, a) }
    private var lastT = -1f
    private val rnd = Random(3)

    /** Испуг: все крысы подпрыгивают и удирают от точки нажатия за край экрана. */
    fun scare(px: Float, py: Float) {
        rats.forEach { r ->
            if (r.wait > 0) return@forEach
            r.dir = if (r.x + ratW / 2 < px) -1 else 1
            r.panic = true
            r.hop = 0f
        }
    }

    private fun respawn(r: Rat, anywhere: Boolean) {
        r.dir = if (rnd.nextBoolean()) 1 else -1
        r.x = if (anywhere) rnd.nextFloat() * width else if (r.dir > 0) -ratW else width.toFloat()
        r.y = 60 * d + rnd.nextFloat() * (height - 120 * d)
        r.panic = false; r.wait = 0f
    }

    private val loc = IntArray(2)
    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        if (Term.thermal) ThermalScene.resize(context, w, h) else PrismScene.resize(w, h)
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        getLocationInWindow(loc); PrismScene.ox = loc[0].toFloat(); PrismScene.oy = loc[1].toFloat()
    }

    override fun onDraw(canvas: Canvas) {
        val t = (SystemClock.uptimeMillis() - start) / 1000f
        if (Term.prism) {
            // во второй теме крыс нет — только переливающийся свет
            PrismScene.draw(canvas, PrismScene.time())
            postInvalidateOnAnimation()
            return
        }
        if (Term.thermal) {
            // тепловизор: вращающаяся радужка, HUD, а крысы — тёплые пятна в рамках обнаружения
            ThermalScene.draw(canvas, ThermalScene.time())
            drawRats(canvas, t)
            postInvalidateOnAnimation()
            return
        }
        val off = (t * 14f * d) % (lineH * Term.LOG.size)
        val first = (off / lineH).toInt()
        var y = -(off % lineH) + lineH
        var i = first
        while (y < height + lineH) {
            canvas.drawText(Term.LOG[i % Term.LOG.size], 8f, y, p)
            y += lineH; i++
        }
        drawRats(canvas, t)
        var s = 0f
        val step = 3f * d
        while (s < height) { canvas.drawRect(0f, s, width.toFloat(), s + step / 3, scan); s += step }
        postInvalidateOnAnimation()
    }

    private fun drawRats(canvas: Canvas, t: Float) {
        if (width == 0) return
        if (lastT < 0) rats.forEach { respawn(it, anywhere = true) }
        val dt = if (lastT < 0) 0f else min(t - lastT, 0.05f)
        lastT = t
        rats.forEach { r ->
            if (r.wait > 0) {
                r.wait -= dt
                if (r.wait <= 0) respawn(r, anywhere = false)
                return@forEach
            }
            val v = r.speed * if (r.panic) 4.5f else 1f
            r.x += r.dir * v * dt
            r.stride += v * dt
            r.hop = min(1f, r.hop + dt / 0.28f)
            if (r.x > width + ratW || r.x < -2 * ratW) {   // убежала за край — посидит и вернётся
                r.wait = if (r.panic) 1.5f + rnd.nextFloat() * 2.5f else 0.4f + rnd.nextFloat() * 2f
                return@forEach
            }
            val frame = ((r.stride / (9 * d)).toInt()) % 2   // лапы перебирают в такт пройденному пути
            val jump = sin(r.hop * Math.PI).toFloat() * 10 * d    // прыжок от испуга
            val yy = r.y - jump - if (frame == 1) d else 0f
            canvas.save()
            if (r.dir < 0) canvas.scale(-1f, 1f, r.x + ratW / 2, 0f)
            ratDst.set(r.x, yy, r.x + ratW, yy + ratH)
            if (Term.thermal) {
                // тёплое пятно: размытый красный ореол, тело — жёлто-оранжевое
                val heat = 0.55f + r.shade / 215f * 0.4f
                ratPaint.alpha = 255
                ratPaint.colorFilter = PorterDuffColorFilter(Heat.color(heat * 0.55f, 150), PorterDuff.Mode.SRC_IN)
                for ((ox, oy) in listOf(-1.5f to 0f, 1.5f to 0f, 0f to -1.5f, 0f to 1.5f))
                    canvas.drawBitmap(ratFrames[frame], null, RectF(ratDst.left + ox * d, ratDst.top + oy * d, ratDst.right + ox * d, ratDst.bottom + oy * d), ratPaint)
                ratPaint.colorFilter = PorterDuffColorFilter(Heat.color(heat), PorterDuff.Mode.SRC_IN)
                canvas.drawBitmap(ratFrames[frame], null, ratDst, ratPaint)
                ratPaint.colorFilter = null
            } else {
                ratPaint.alpha = r.shade
                ratPaint.colorFilter = if (Term.FG == Term.DEFAULT_COLOR) null else termTint
                canvas.drawBitmap(ratFrames[frame], null, ratDst, ratPaint)
                ratPaint.colorFilter = null
            }
            canvas.restore()
            if (Term.thermal) {
                // рамка обнаружения с подписью, как PERSON_01XX
                val i = rats.indexOf(r)
                box.color = Heat.YELLOW; box.alpha = 200
                canvas.drawRect(r.x - 4 * d, yy - 4 * d, r.x + ratW + 4 * d, yy + ratH + 3 * d, box)
                tag.color = Heat.YELLOW
                canvas.drawText("RAT_0${i + 1}XX " + Heat.temp(0.55f + r.shade / 215f * 0.4f), r.x - 4 * d, yy - 6 * d, tag)
            }
        }
    }

}

/**
 * Фон «Призмы»: плывущие пятна света, лучи призмы, медленно вращающиеся веером,
 * и радужный отблеск, пробегающий по диагонали. Один на весь экран: кнопки и заставка
 * рисуют его же у себя внутри, увеличенным, — так получается «жидкое стекло», преломляющее фон.
 */
object PrismScene {
    var w = 0f; private set
    var h = 0f; private set
    /** Положение фона в окне — от него считаются координаты «стёкол». */
    var ox = 0f; var oy = 0f
    private val t0 = SystemClock.uptimeMillis()
    fun time() = (SystemClock.uptimeMillis() - t0) / 1000f

    private val add = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = android.graphics.PorterDuffXfermode(PorterDuff.Mode.ADD) }
    private val plain = Paint(Paint.ANTI_ALIAS_FLAG)
    private var blobs: List<android.graphics.RadialGradient> = emptyList()
    private var rays: android.graphics.SweepGradient? = null
    private var sheen: android.graphics.LinearGradient? = null
    private var vignette: android.graphics.RadialGradient? = null
    private val m = android.graphics.Matrix()
    private val blobMotion = listOf(floatArrayOf(.11f, .07f, 0f, 1.3f), floatArrayOf(.07f, .13f, 2f, .4f), floatArrayOf(.09f, .05f, 4f, 2.2f),
        floatArrayOf(.05f, .1f, 1f, 3.1f), floatArrayOf(.13f, .09f, 3f, 5f))

    private fun a(c: Int, alpha: Int) = Color.argb(alpha, Color.red(c), Color.green(c), Color.blue(c))

    fun resize(width: Int, height: Int) {
        if (width <= 0 || height <= 0 || (width.toFloat() == w && height.toFloat() == h)) return
        w = width.toFloat(); h = height.toFloat()
        val r = max(w, h) * 0.42f
        blobs = Term.IRIS.take(5).map { c ->
            android.graphics.RadialGradient(0f, 0f, r, intArrayOf(a(c, 58), a(c, 14), Color.TRANSPARENT),
                floatArrayOf(0f, 0.55f, 1f), android.graphics.Shader.TileMode.CLAMP)
        }
        // веер лучей: узкие цветные полосы через тёмные промежутки
        val n = 14
        val cols = IntArray(n * 4 + 1); val pos = FloatArray(n * 4 + 1)
        for (i in 0 until n) {
            val c = Term.IRIS[i % 6]; val b = i.toFloat() / n; val st = 1f / n
            cols[i * 4] = Color.TRANSPARENT; pos[i * 4] = b
            cols[i * 4 + 1] = a(c, 34); pos[i * 4 + 1] = b + st * 0.18f
            cols[i * 4 + 2] = a(Term.IRIS[(i + 1) % 6], 22); pos[i * 4 + 2] = b + st * 0.32f
            cols[i * 4 + 3] = Color.TRANSPARENT; pos[i * 4 + 3] = b + st * 0.5f
        }
        cols[n * 4] = Color.TRANSPARENT; pos[n * 4] = 1f
        rays = android.graphics.SweepGradient(0f, 0f, cols, pos)
        // радужный отблеск — широкая диагональная полоса
        val band = max(w, h) * 0.55f
        sheen = android.graphics.LinearGradient(0f, 0f, band, band * 0.6f,
            intArrayOf(Color.TRANSPARENT, a(Term.IRIS[0], 30), a(Term.IRIS[1], 46), a(Term.IRIS[2], 40), a(Term.IRIS[3], 34),
                a(Term.IRIS[4], 30), a(Term.IRIS[5], 26), Color.TRANSPARENT),
            null, android.graphics.Shader.TileMode.CLAMP)
        // узор призмы рисуется заметное время — в фоновом потоке, чтобы не задерживать запуск
        val side = (min(w, h) * 1.05f).toInt().coerceAtMost(1400)
        burst = null
        Thread { burst = makeBurst(side) }.apply { priority = Thread.MIN_PRIORITY }.start()
        vignette = android.graphics.RadialGradient(w / 2, h * 0.45f, max(w, h) * 0.78f,
            intArrayOf(Color.TRANSPARENT, Color.argb(210, 0, 0, 0)), floatArrayOf(0.35f, 1f), android.graphics.Shader.TileMode.CLAMP)
    }

    /** Рисует сцену в координатах фона (0..w, 0..h); burstAlpha — яркость призмы (под стеклом кнопок — тусклее, чтобы читались надписи). */
    fun draw(canvas: Canvas, t: Float, burstAlpha: Int = 185) {
        canvas.drawColor(Term.BG)
        if (w == 0f) return
        val r = max(w, h) * 0.42f
        blobs.forEachIndexed { i, sh ->
            val mm = blobMotion[i]
            canvas.save()
            canvas.translate(w * (0.5f + 0.42f * sin(t * mm[0] * 6.28f + mm[2])), h * (0.5f + 0.45f * sin(t * mm[1] * 6.28f + mm[3])))
            add.shader = sh
            canvas.drawCircle(0f, 0f, r, add)
            canvas.restore()
        }
        // лучи призмы: источник над экраном, веер покачивается и медленно поворачивается
        rays?.let { sh ->
            val cx = w * (0.5f + 0.18f * sin(t * 0.21f)); val cy = -h * 0.08f
            m.setRotate(t * 4f + 25f * sin(t * 0.17f)); m.postTranslate(cx, cy); sh.setLocalMatrix(m)
            add.shader = sh; canvas.drawRect(0f, 0f, w, h, add)
        }
        // радужный отблеск пробегает по диагонали раз в ~9 с
        sheen?.let { sh ->
            val band = max(w, h) * 0.55f
            val p = (t % 9f) / 9f
            m.setTranslate(-band * 1.2f + (w + band * 1.6f) * p, -band * 0.6f + (h * 0.5f) * p); sh.setLocalMatrix(m)
            add.shader = sh; canvas.drawRect(0f, 0f, w, h, add)
        }
        // вращающаяся стеклянная призма в центре
        burst?.let { b ->
            val cx = w / 2; val cy = h * 0.48f; val half = b.width / 2f
            burstP.alpha = burstAlpha
            canvas.save(); canvas.rotate(t * 6f, cx, cy)
            canvas.drawBitmap(b, null, RectF(cx - half, cy - half, cx + half, cy + half), burstP)
            canvas.restore()
        }
        vignette?.let { plain.shader = it; canvas.drawRect(0f, 0f, w, h, plain) }
        add.shader = null
    }

    @Volatile private var burst: Bitmap? = null
    private val burstP = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { alpha = 185 }

    /**
     * Стеклянная «призма»: стеклянные бруски, расходящиеся лучами от тёмной сферы.
     * Рисуется один раз в битмап (детерминированный «случайный» узор), потом только вращается.
     */
    private fun makeBurst(size: Int): Bitmap {
        val bm = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bm)
        val R = size / 2f
        var seed = 20251009L
        fun rnd(): Float { seed = (seed * 1103515245L + 12345L) and 0x7fffffffL; return seed / 2147483648f }
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val st = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = max(1f, size / 650f) }
        val cl = android.graphics.Shader.TileMode.CLAMP
        val n = 38
        for (i in 0 until n) {
            val ang = i * 360f / n + (rnd() - 0.5f) * 6f
            val r0 = R * (0.16f + rnd() * 0.14f)
            val len = min(R * (0.30f + rnd() * 0.48f), R * 0.97f - r0)
            val bw = R * (0.055f + rnd() * 0.07f)
            val hollow = rnd() < 0.12f
            val twin = rnd() < 0.35f
            cv.save(); cv.translate(R, R); cv.rotate(ang)
            for (k in 0 until if (twin) 2 else 1) {
                val wk = if (k == 0) bw else bw * 0.6f
                val y0 = if (k == 0) -wk / 2 else bw / 2 + wk * 0.15f
                val x0 = if (k == 0) r0 else r0 + len * 0.15f
                val x1 = if (k == 0) r0 + len else r0 + len * 0.8f
                val y1 = y0 + wk
                val ins = wk * 0.22f
                if (!hollow) {
                    // тело бруска: стекло светлее к граням
                    p.shader = android.graphics.LinearGradient(0f, y0, 0f, y1,
                        intArrayOf(Color.argb(110, 255, 255, 255), Color.argb(26, 255, 255, 255), Color.argb(30, 200, 220, 255), Color.argb(95, 255, 255, 255)),
                        floatArrayOf(0f, 0.3f, 0.7f, 1f), cl)
                    cv.drawRect(x0, y0, x1, y1, p)
                    // тёмная середина — толщина стекла
                    p.shader = null; p.color = Color.argb(105, 0, 0, 0)
                    cv.drawRect(x0 + ins, y0 + ins, x1 - ins, y1 - ins, p)
                    // радужная грань: дисперсия вдоль бруска
                    val cols = IntArray(6) { j -> val c = Term.IRIS[(i + j) % 6]; Color.argb(215, Color.red(c), Color.green(c), Color.blue(c)) }
                    p.shader = android.graphics.LinearGradient(x0, 0f, x1, 0f, cols, null, cl)
                    val face = if ((i + k) % 2 == 0) y0 + ins * 0.3f else y1 - ins * 1.6f
                    cv.drawRect(x0 + ins * 0.5f, face, x1 - ins * 0.5f, face + ins * 1.3f, p)
                    // вторая, бледная радужная полоса внутри — свет, прошедший сквозь брусок
                    p.alpha = 90
                    cv.drawRect(x0 + ins, -wk * 0.08f + (y0 + y1) / 2, x1 - ins, wk * 0.08f + (y0 + y1) / 2, p)
                    p.alpha = 255
                    p.shader = null
                }
                // светлые рёбра
                st.color = Color.argb(if (hollow) 170 else 230, 255, 255, 255); cv.drawRect(x0, y0, x1, y1, st)
                st.color = Color.argb(80, 255, 255, 255); cv.drawRect(x0 + ins, y0 + ins, x1 - ins, y1 - ins, st)
                // яркий торец
                p.color = Color.argb(235, 255, 255, 255); cv.drawRect(x1 - st.strokeWidth * 1.5f, y0, x1, y1, p)
            }
            cv.restore()
        }
        // тёмная сфера в центре с голубым ободком и бликом
        val sr = R * 0.15f
        p.shader = android.graphics.RadialGradient(R, R, sr, intArrayOf(Color.BLACK, Color.BLACK, Color.parseColor("#2C5BFF"), Color.WHITE),
            floatArrayOf(0f, 0.78f, 0.93f, 1f), cl)
        cv.drawCircle(R, R, sr, p)
        p.shader = android.graphics.RadialGradient(R - sr * 0.35f, R - sr * 0.4f, sr * 0.45f, Color.argb(170, 255, 255, 255), Color.TRANSPARENT, cl)
        cv.drawCircle(R - sr * 0.35f, R - sr * 0.4f, sr * 0.45f, p)
        st.shader = android.graphics.SweepGradient(R, R, intArrayOf(Term.IRIS[0], Term.IRIS[1], Color.WHITE, Term.IRIS[5], Term.IRIS[0]), null)
        st.strokeWidth = R * 0.012f; cv.drawCircle(R, R, sr * 0.97f, st)
        return bm
    }

    private val loc = IntArray(2)
    /**
     * Преломление: рисует сцену внутри view так, как она лежит за ним, но увеличенной
     * относительно центра (линза) и чуть сдвинутой вниз (толщина стекла).
     */
    fun refract(canvas: Canvas, v: View, zoom: Float, t: Float, burstAlpha: Int = 70) {
        v.getLocationInWindow(loc)
        val vx = loc[0] - ox; val vy = loc[1] - oy
        canvas.save()
        canvas.scale(zoom, zoom, v.width / 2f, v.height / 2f)
        canvas.translate(-vx, -vy - v.resources.displayMetrics.density)
        draw(canvas, t, burstAlpha)
        canvas.restore()
    }
}

/** Фон-«жидкое стекло» для кнопок шапки, вкладок и MocTec: преломляет фон под собой. */
class GlassDrawable(c: Context, private val on: Boolean) : android.graphics.drawable.Drawable() {
    private val d = c.resources.displayMetrics.density
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.1f * d }
    private val box = RectF()
    private val path = android.graphics.Path()
    private val m = android.graphics.Matrix()

    // градиенты зависят только от размера — создаются при изменении размера, не каждый кадр
    private var holo: android.graphics.Shader? = null
    private var frost: android.graphics.Shader? = null
    private var spot: android.graphics.Shader? = null
    private var edge: android.graphics.Shader? = null

    override fun onBoundsChange(b: android.graphics.Rect) {
        val w = b.width().toFloat(); val h = b.height().toFloat()
        val r = min(16 * d, h / 2)
        val sh = android.graphics.Shader.TileMode.CLAMP
        box.set(b.left + d / 2, b.top + d / 2, b.right - d / 2, b.bottom - d / 2)
        path.reset(); path.addRoundRect(box, r, r, android.graphics.Path.Direction.CW)
        holo = android.graphics.LinearGradient(0f, 0f, max(1f, w), max(1f, h), Term.IRIS, null, android.graphics.Shader.TileMode.MIRROR)
        frost = android.graphics.LinearGradient(0f, box.top, 0f, box.bottom,
            intArrayOf(Color.argb(56, 255, 255, 255), Color.argb(12, 255, 255, 255), Color.argb(40, 120, 220, 255)), floatArrayOf(0f, 0.55f, 1f), sh)
        spot = android.graphics.RadialGradient(box.left + w * 0.2f, box.top, max(1f, max(w, h) * 0.6f), Color.argb(70, 255, 255, 255), Color.TRANSPARENT, sh)
        edge = android.graphics.LinearGradient(0f, box.top, 0f, box.bottom,
            intArrayOf(Color.argb(220, 255, 255, 255), Color.argb(50, 255, 255, 255), Color.argb(120, 190, 170, 255)), floatArrayOf(0f, 0.5f, 1f), sh)
    }

    override fun draw(canvas: Canvas) {
        val v = callback as? View ?: return
        if (frost == null) onBoundsChange(bounds)
        val w = bounds.width().toFloat(); val h = bounds.height().toFloat()
        val r = min(16 * d, h / 2)
        val t = PrismScene.time()
        canvas.save()
        canvas.clipPath(path)
        PrismScene.refract(canvas, v, 1.03f, t, if (h > 90 * d) 32 else 70)   // под большими плашками с текстом призма почти гаснет
        if (on) {
            m.setTranslate((t * 0.2f % 2f) * w, 0f); holo!!.setLocalMatrix(m)
            p.shader = holo; p.alpha = 225; canvas.drawRect(box, p); p.alpha = 255
        }
        p.shader = frost; canvas.drawRect(box, p)
        p.shader = spot; canvas.drawRect(box, p)
        canvas.restore()
        rim.shader = edge
        canvas.drawRoundRect(box, r, r, rim)
        v.postInvalidateOnAnimation()
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(cf: android.graphics.ColorFilter?) {}
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}

/** Кнопка пульта: рамка с «уголками», номер, байт команды, глитч и луч передачи при нажатии. */
class KeyView(c: Context, val label: String, private val index: Int, code: Long, private val inverted: Boolean) : View(c) {
    private val d = c.resources.displayMetrics.density
    private val main = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Term.mono; textAlign = Paint.Align.CENTER }
    private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Term.mono; textSize = 13 * d }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = d }
    private val fill = Paint()
    private val tag = "[%02d]".format(index + 1)
    private val hex = "0x%02X".format((code ushr 8) and 0xFF)
    private var shown = label
    private var pressedAt = 0L
    private var down = false
    private val rnd = Random(index)

    init {
        isClickable = true
        contentDescription = label
        alpha = 0f
    }

    /** Появление: кнопка «расшифровывается» из шума. */
    fun reveal(delay: Long) {
        ValueAnimator.ofFloat(0f, 1f).apply {
            startDelay = delay; duration = 520
            addUpdateListener { a ->
                val f = a.animatedValue as Float
                alpha = min(1f, f * 3f)
                translationX = if (f < 0.6f) (rnd.nextFloat() - 0.5f) * 10 * d * (1 - f) else 0f
                shown = if (f < 1f) Term.scramble(label, f, rnd) else label
                invalidate()
            }
            start()
        }
    }

    fun setDown(v: Boolean) {
        down = v
        if (v) pressedAt = SystemClock.uptimeMillis()
        invalidate()
    }

    // «Призма»: жидкое стекло — внутри преломлённый фон, по краю свет, сверху блик
    private val glass = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val ghost = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val box = RectF()
    private val clip = android.graphics.Path()
    private val sweepM = android.graphics.Matrix()

    /** Градиенты стекла зависят только от размера кнопки — создаются один раз, а не каждый кадр. */
    private class GlassShaders(w: Float, h: Float, d: Float, box: RectF) {
        private val cl = android.graphics.Shader.TileMode.CLAMP
        val holo = android.graphics.LinearGradient(0f, 0f, w, h, Term.IRIS, null, android.graphics.Shader.TileMode.MIRROR)
        val frost = android.graphics.LinearGradient(0f, 0f, 0f, h, Color.argb(40, 255, 255, 255), Color.argb(8, 230, 220, 255), cl)
        val frostDown = android.graphics.LinearGradient(0f, 0f, 0f, h, Color.argb(64, 255, 255, 255), Color.argb(26, 230, 220, 255), cl)
        val spot = android.graphics.RadialGradient(w * 0.22f, h * 0.05f, max(w, h) * 0.55f,
            intArrayOf(Color.argb(78, 255, 255, 255), Color.argb(18, 255, 255, 255), Color.TRANSPARENT), floatArrayOf(0f, 0.45f, 1f), cl)
        val arc = android.graphics.LinearGradient(0f, box.top, 0f, box.top + h * 0.3f, Color.argb(64, 255, 255, 255), Color.TRANSPARENT, cl)
        val bottom = android.graphics.LinearGradient(0f, h * 0.6f, 0f, h, Color.TRANSPARENT, Color.argb(54, 120, 220, 255), cl)
        val edge = android.graphics.LinearGradient(0f, 0f, 0f, h,
            intArrayOf(Color.argb(210, 255, 255, 255), Color.argb(40, 255, 255, 255), Color.argb(110, 200, 190, 255)), floatArrayOf(0f, 0.55f, 1f), cl)
        val sweep = android.graphics.SweepGradient(w / 2, h / 2, Term.IRIS, null)
        val arcRect = RectF(box.left + 5 * d, box.top + 2 * d, box.right - 5 * d, box.top + h * 0.42f)
        val inner = RectF(box.left + 2.2f * d, box.top + 2.2f * d, box.right - 2.2f * d, box.bottom - 2.2f * d)
        var text: android.graphics.Shader? = null; var textKey = 0f
    }
    private var gs: GlassShaders? = null
    private val shaderM = android.graphics.Matrix()

    private fun drawPrism(canvas: Canvas, since: Long) {
        val w = width.toFloat(); val h = height.toFloat(); val r = 22 * d
        val t = PrismScene.time()
        box.set(d, d, w - d, h - d)
        val g = gs?.takeIf { it.inner.right == box.right - 2.2f * d && it.inner.bottom == box.bottom - 2.2f * d }
            ?: GlassShaders(w, h, d, RectF(box)).also { gs = it; clip.reset(); clip.addRoundRect(box, r, r, android.graphics.Path.Direction.CW) }
        val hot = (1f - since / 520f).coerceIn(0f, 1f)          // 1 сразу после нажатия → 0
        val sh = android.graphics.Shader.TileMode.CLAMP

        canvas.save()
        canvas.clipPath(clip)
        // 1. фон под стеклом (чуть увеличен, при нажатии — сильнее)
        PrismScene.refract(canvas, this, 1.03f + 0.08f * hot + if (down) 0.03f else 0f, t)
        glass.alpha = 255
        if (inverted) {
            // POWER — голограмма: перелив поверх стекла, медленно течёт
            shaderM.setTranslate((t * 0.18f % 2f) * w, 0f); g.holo.setLocalMatrix(shaderM)
            glass.shader = g.holo; glass.alpha = if (down) 170 else 205
            canvas.drawRect(box, glass)
            glass.alpha = 255
        }
        // 2. матовость, 3. блик и дуга сверху, 4. отражённый свет снизу
        glass.shader = if (down) g.frostDown else g.frost; canvas.drawRect(box, glass)
        glass.shader = g.spot; canvas.drawRect(box, glass)
        glass.shader = g.arc; canvas.drawRoundRect(g.arcRect, r * 0.8f, r * 0.8f, glass)
        glass.shader = g.bottom; canvas.drawRect(box, glass)
        // перелив, пробегающий по кнопке после нажатия (только полсекунды после нажатия)
        if (hot > 0f) {
            val x = -w * 0.5f + w * 2f * (1f - hot)
            glass.shader = android.graphics.LinearGradient(x, 0f, x + w * 0.5f, h,
                intArrayOf(Color.TRANSPARENT, Color.argb((90 * hot).toInt(), 140, 108, 255), Color.argb((110 * hot).toInt(), 63, 224, 255),
                    Color.argb((90 * hot).toInt(), 255, 95, 216), Color.TRANSPARENT), null, sh)
            canvas.drawRect(box, glass)
        }
        canvas.restore()

        // 5. край: светлый сверху, гаснет к низу; радужная кайма чуть внутри — вращается
        rim.shader = g.edge; rim.strokeWidth = 1.2f * d; rim.alpha = 255
        canvas.drawRoundRect(box, r, r, rim)
        shaderM.setRotate(index * 37f + t * 24f + hot * 260f, w / 2, h / 2); g.sweep.setLocalMatrix(shaderM)
        rim.shader = g.sweep; rim.strokeWidth = (1.1f + 1.8f * hot) * d; rim.alpha = if (inverted) 110 else 120 + (135 * hot).toInt()
        val inset = 2.2f * d
        canvas.drawRoundRect(g.inner, r - inset, r - inset, rim)

        val ink = if (inverted) Color.parseColor("#120E1F") else Term.FG
        small.typeface = Term.ru; small.color = if (inverted) Color.argb(170, 18, 14, 31) else Term.DIM
        small.textAlign = Paint.Align.LEFT; canvas.drawText("%02d".format(index + 1), 13 * d, 19 * d, small)
        small.textAlign = Paint.Align.RIGHT; canvas.drawText(hex, w - 13 * d, h - 11 * d, small)

        main.textSize = min(24 * d, w / max(6, shown.length) * 1.02f)
        val ty = h / 2 - (main.descent() + main.ascent()) / 2
        if (hot > 0f && !inverted) {
            // хроматическая аберрация: красный и бирюзовый «призраки» расходятся и сходятся
            ghost.typeface = main.typeface; ghost.textSize = main.textSize
            val dx = 4 * d * hot
            ghost.color = Color.argb((200 * hot).toInt(), 255, 70, 140); canvas.drawText(shown, w / 2 - dx, ty, ghost)
            ghost.color = Color.argb((200 * hot).toInt(), 60, 230, 255); canvas.drawText(shown, w / 2 + dx, ty, ghost)
        }
        // стеклянный текст: светлый сверху, сиреневый снизу, с тенью-объёмом
        if (inverted) { main.shader = null; main.color = ink; main.clearShadowLayer() }
        else {
            main.color = Color.WHITE
            if (g.text == null || g.textKey != ty + main.textSize) {
                g.text = android.graphics.LinearGradient(0f, ty + main.ascent(), 0f, ty + main.descent(),
                    intArrayOf(Color.WHITE, Color.parseColor("#E9E3FF"), Color.parseColor("#B9A9FF")), floatArrayOf(0f, 0.5f, 1f), sh)
                g.textKey = ty + main.textSize
            }
            main.shader = g.text
            main.setShadowLayer(5 * d, 0f, 1.5f * d, Color.argb(150, 20, 10, 50))
        }
        canvas.drawText(shown, w / 2, ty, main)
        main.shader = null; main.clearShadowLayer()
        postInvalidateOnAnimation()   // фон за стеклом всё время движется
    }

    override fun onDraw(canvas: Canvas) {
        if (Term.prism) { drawPrism(canvas, SystemClock.uptimeMillis() - pressedAt); return }
        if (Term.thermal) { drawThermal(canvas, SystemClock.uptimeMillis() - pressedAt); return }
        val w = width.toFloat(); val h = height.toFloat()
        val now = SystemClock.uptimeMillis()
        val since = now - pressedAt
        val inv = inverted xor down
        val fg = if (inv) Color.BLACK else Term.FG

        // фон и рамка
        fill.color = if (inv) Term.FG else Color.BLACK
        canvas.drawRect(0f, 0f, w, h, fill)
        stroke.color = if (down) Term.FG else Term.LINE
        canvas.drawRect(d / 2, d / 2, w - d / 2, h - d / 2, stroke)
        // HUD-уголки
        stroke.color = fg; stroke.strokeWidth = 2 * d
        val k = 10 * d
        for ((x, y, sx, sy) in listOf(Quad(0f, 0f, 1, 1), Quad(w, 0f, -1, 1), Quad(0f, h, 1, -1), Quad(w, h, -1, -1))) {
            canvas.drawLine(x, y + sy * d, x + sx * k, y + sy * d, stroke)
            canvas.drawLine(x + sx * d, y, x + sx * d, y + sy * k, stroke)
        }
        stroke.strokeWidth = d

        small.color = if (inv) Color.DKGRAY else Term.DIM
        small.textAlign = Paint.Align.LEFT
        canvas.drawText(tag, 8 * d, 16 * d, small)
        small.textAlign = Paint.Align.RIGHT
        canvas.drawText(hex, w - 8 * d, h - 8 * d, small)

        main.color = fg
        main.textSize = min(38 * d, w / max(6, shown.length) * 1.55f)
        val ty = h / 2 - (main.descent() + main.ascent()) / 2
        val glitch = since < 180
        if (glitch) {
            // глитч: текст режется на полосы со сдвигом
            val bands = 4
            for (b in 0 until bands) {
                canvas.save()
                canvas.clipRect(0f, h * b / bands, w, h * (b + 1) / bands)
                canvas.drawText(shown, w / 2 + (rnd.nextFloat() - 0.5f) * 14 * d, ty, main)
                canvas.restore()
            }
        } else canvas.drawText(shown, w / 2, ty, main)

        // луч передачи сверху вниз
        if (since < 420) {
            val y = h * since / 420f
            fill.color = if (inv) Color.argb(120, 0, 0, 0) else Color.argb(150, Color.red(Term.FG), Color.green(Term.FG), Color.blue(Term.FG))
            canvas.drawRect(0f, y, w, y + 2 * d, fill)
            fill.color = if (inv) Color.argb(30, 0, 0, 0) else Color.argb(28, Color.red(Term.FG), Color.green(Term.FG), Color.blue(Term.FG))
            canvas.drawRect(0f, max(0f, y - 24 * d), w, y, fill)
        }
        if (since < 420) postInvalidateOnAnimation()
    }

    // «Тепловизор»: рамка обнаружения; при нажатии кнопка «нагревается» и потом остывает
    private val heatP = Paint(Paint.ANTI_ALIAS_FLAG)
    private val heatTag = "KEY_%02dXX".format(index + 1)

    private fun drawThermal(canvas: Canvas, since: Long) {
        val w = w(); val h = height.toFloat()
        val cool = (1f - since / 950f).coerceIn(0f, 1f)
        var heat = cool * cool * (3 - 2 * cool)                       // плавное остывание
        if (down) heat = max(heat, 0.92f)
        if (inverted) heat = max(heat, 0.66f + 0.06f * sin(SystemClock.uptimeMillis() / 400f))   // POWER всегда тёплая и «дышит»
        fill.color = Color.argb(150, 0, 0, 0)
        canvas.drawRect(0f, 0f, w, h, fill)
        if (heat > 0.02f) {
            heatP.shader = Heat.bloom(w / 2, h / 2, max(w, h) * (0.45f + 0.35f * heat), heat)
            canvas.drawRect(0f, 0f, w, h, heatP)
        }
        stroke.strokeWidth = 1.4f * d
        stroke.color = if (heat > 0.5f) Heat.color(0.97f) else Heat.YELLOW
        canvas.drawRect(d, d, w - d, h - d, stroke)
        stroke.strokeWidth = d

        val ink = heat > 0.5f
        small.color = if (ink) Heat.INK else Heat.YELLOW
        small.textAlign = Paint.Align.LEFT; canvas.drawText(heatTag, 7 * d, 15 * d, small)
        small.color = if (ink) Color.argb(200, 20, 7, 0) else Term.DIM
        small.textAlign = Paint.Align.RIGHT; canvas.drawText(hex + "  " + Heat.temp(heat), w - 7 * d, h - 7 * d, small)

        main.textSize = min(38 * d, w / max(6, shown.length) * 1.55f)
        val ty = h / 2 - (main.descent() + main.ascent()) / 2
        if (ink) { main.color = Heat.INK; main.clearShadowLayer() }
        else { main.color = Term.FG; main.setShadowLayer(9 * d, 0f, 0f, Heat.GLOW) }
        canvas.drawText(shown, w / 2, ty, main)
        main.clearShadowLayer()
        if (since < 950 || inverted) postInvalidateOnAnimation()
    }
    private fun w() = width.toFloat()

    private data class Quad(val x: Float, val y: Float, val sx: Int, val sy: Int)
}

/** Строка состояния, которая «печатается» по буквам, с мигающим курсором. */
class TypeLine(c: Context) : TextView(c) {
    private var target = ""
    private var pos = 0
    private var cursorOn = true
    private val hidden = ForegroundColorSpan(Color.TRANSPARENT)
    private val tick = object : Runnable {
        override fun run() {
            if (pos < target.length) pos = min(target.length, pos + 2) else cursorOn = !cursorOn
            // Курсор «_» есть в тексте всегда, при мигании он только становится прозрачным:
            // размеры строки не меняются, и экран под ней не дёргается.
            val t = SpannableString(target.substring(0, pos) + "_")
            if (!cursorOn && pos >= target.length) t.setSpan(hidden, t.length - 1, t.length, 0)
            text = t
            postDelayed(this, if (pos < target.length) 16 else 480)
        }
    }

    init { typeface = Term.ru; isSingleLine = true; post(tick) }

    fun type(s: String) { target = s; pos = 0; cursorOn = true }
}

/**
 * Заставка при запуске: загрузочный лог, падающая крыса с глитчем,
 * «krisa» под ней, затем всё рассыпается полосами и открывает пульт.
 */
class SplashView(c: Context, private val bootLines: List<String>, private val onDone: () -> Unit) : View(c) {
    private val d = c.resources.displayMetrics.density
    private val rat: Bitmap = BitmapFactory.decodeResource(c.resources, R.drawable.rat)
    private val glow: Bitmap = rat.extractAlpha()
    private val sign: Bitmap = BitmapFactory.decodeResource(c.resources, R.drawable.sign)
    private val signP = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Term.mono; textSize = 17 * d; color = Term.DIM }
    private val big = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Term.mono; textSize = 64 * d; color = Term.FG; textAlign = Paint.Align.CENTER
        setShadowLayer(14 * d, 0f, 0f, Term.FG)
    }
    // крыса на заставке «Терминала» перекрашивается в выбранный цвет
    private val bmp = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        if (Term.FG != Term.DEFAULT_COLOR) colorFilter = PorterDuffColorFilter(Term.FG, PorterDuff.Mode.SRC_IN)
    }
    private val glowP = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        colorFilter = PorterDuffColorFilter(Term.FG, PorterDuff.Mode.SRC_IN)
    }
    /**
     * Размытый ореол и «трубки» стекла готовятся один раз в фоновом потоке.
     * Раньше размытие требовало программной отрисовки всей заставки — в «Призме» и «Тепловизоре»
     * это давало подвисания при запуске; теперь заставка рисуется видеокартой.
     */
    @Volatile private var glowBlur: Bitmap? = null
    @Volatile private var tubeBmp: Bitmap? = null
    private val blurPad = 48
    private val line = Paint().apply { color = Term.FG }
    // «Призма»: крыса залита радужным переливом, по краям — красный и бирюзовый «призраки»
    private val irisP = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val fringe = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val wordP = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Term.mono; textAlign = Paint.Align.CENTER }
    private val wordEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Term.mono; textAlign = Paint.Align.CENTER; style = Paint.Style.STROKE }
    private val start = SystemClock.uptimeMillis()
    private val rnd = Random(1)
    private var finished = false

    init {
        Thread {
            val g = Bitmap.createBitmap(rat.width + 2 * blurPad, rat.height + 2 * blurPad, Bitmap.Config.ARGB_8888)
            Canvas(g).drawBitmap(glow, blurPad.toFloat(), blurPad.toFloat(),
                Paint(Paint.FILTER_BITMAP_FLAG).apply { color = Color.WHITE; maskFilter = BlurMaskFilter(blurPad * 0.6f, BlurMaskFilter.Blur.NORMAL) })
            glowBlur = g
            if (Term.prism) tubeBmp = makeTube()
        }.apply { priority = Thread.MIN_PRIORITY }.start()
        isClickable = true
        setOnClickListener { finish() }           // тап — пропустить
        setBackgroundColor(Term.BG)
        if (Term.prism) {
            txt.typeface = Term.ru; txt.textSize = 14 * d
            big.typeface = Term.mono; big.textSize = 52 * d
            big.setShadowLayer(18 * d, 0f, 0f, Color.parseColor("#8B6CFF"))
            glowP.colorFilter = PorterDuffColorFilter(Color.parseColor("#8B6CFF"), PorterDuff.Mode.SRC_IN)
            wordEdge.strokeWidth = 1.3f * d
        }
        if (Term.thermal) {
            big.setShadowLayer(18 * d, 0f, 0f, Heat.GLOW)
            glowP.colorFilter = PorterDuffColorFilter(Heat.color(0.5f), PorterDuff.Mode.SRC_IN)
        }
    }

    private fun finish() {
        if (finished) return
        finished = true
        animate().alpha(0f).setDuration(260).setInterpolator(DecelerateInterpolator()).withEndAction(onDone).start()
    }

    override fun onDraw(canvas: Canvas) {
        val t = (SystemClock.uptimeMillis() - start).toFloat()
        val w = width.toFloat(); val h = height.toFloat()
        if (Term.prism) { PrismScene.draw(canvas, PrismScene.time()); updateLens() }
        if (Term.thermal) ThermalScene.draw(canvas, ThermalScene.time())

        // 1. загрузочный лог
        var y = 40 * d
        val chars = (t / 7).toInt()
        var left = chars
        for (l in bootLines) {
            if (left <= 0) break
            canvas.drawText(l.take(left), 16 * d, y, txt)
            left -= l.length + 6
            y += txt.textSize * 1.25f
        }

        // 2. крыса падает сверху, отскакивает и «лежит»
        val rw = min(w * 0.72f, 420 * d)
        val rh = rw * rat.height / rat.width
        val cx = w / 2; val restY = h * 0.5f
        val f = ((t - 650) / 900f).coerceIn(0f, 1f)
        if (t > 650) {
            val drop = bounce(f)
            val ry = -rh + (restY + rh) * drop
            val rot = (1 - f) * -38f + if (f > 0.55f) sin(f * 26) * 4 * (1 - f) else 0f
            canvas.save()
            canvas.translate(cx, ry)
            canvas.rotate(rot)
            val dst = RectF(-rw / 2, -rh / 2, rw / 2, rh / 2)
            glowBlur?.let { gb ->
                val pad = blurPad * rw / rat.width
                glowP.alpha = (90 * f).toInt()
                canvas.drawBitmap(gb, null, RectF(dst.left - pad, dst.top - pad, dst.right + pad, dst.bottom + pad), glowP)
            }
            val moving = f < 0.95f || (t in 1800f..1900f) || (t in 2050f..2110f)
            if (Term.thermal) {
                // крыса — тепловое пятно: горячая середина, остывающие края; в полёте — полосы «помех» матрицы
                irisP.shader = Heat.bloom(-rw * 0.12f, rh * 0.08f, rw * 0.78f, 1f)
                if (moving) {
                    val bands = 7
                    for (b in 0 until bands) {
                        val sy0 = rat.height * b / bands; val sy1 = rat.height * (b + 1) / bands
                        val dx = (rnd.nextFloat() - 0.5f) * 16 * d * (if (rnd.nextInt(3) == 0) 1f else 0.15f)
                        val top = -rh / 2 + rh * b / bands; val bottom = -rh / 2 + rh * (b + 1) / bands
                        canvas.drawBitmap(glow, Rect(0, sy0, rat.width, sy1), RectF(-rw / 2 + dx, top, rw / 2 + dx, bottom), irisP)
                    }
                } else canvas.drawBitmap(glow, null, dst, irisP)
            } else if (Term.prism) {
                // в полёте «призраки» расходятся сильнее, на месте — едва заметны
                val dx = (if (moving) 9f else 2.5f) * d
                val tube = tubeBmp ?: glow   // пока «трубки» готовятся в фоне — обычный силуэт
                fringe.color = Color.argb(150, 255, 60, 140); canvas.drawBitmap(tube, null, RectF(dst.left - dx, dst.top, dst.right - dx, dst.bottom), fringe)
                fringe.color = Color.argb(150, 50, 225, 255); canvas.drawBitmap(tube, null, RectF(dst.left + dx, dst.top, dst.right + dx, dst.bottom), fringe)
                drawGlassRat(canvas, dst, cx, ry, rot, t)
            } else if (moving) {
                // глитч-полосы: битмап режется по горизонтали со сдвигами
                val bands = 9
                for (b in 0 until bands) {
                    val sy0 = rat.height * b / bands; val sy1 = rat.height * (b + 1) / bands
                    val dx = (rnd.nextFloat() - 0.5f) * 22 * d * (if (rnd.nextInt(3) == 0) 1f else 0.15f)
                    val top = -rh / 2 + rh * b / bands; val bottom = -rh / 2 + rh * (b + 1) / bands
                    canvas.drawBitmap(rat, Rect(0, sy0, rat.width, sy1), RectF(-rw / 2 + dx, top, rw / 2 + dx, bottom), bmp)
                }
            } else canvas.drawBitmap(rat, null, dst, bmp)
            canvas.restore()

            // удар об «пол» — горизонтальные полосы, как у солнца на референсе
            if (f > 0.42f && f < 0.9f) {
                val k = 1 - abs(f - 0.55f) / 0.35f
                for (i in 0 until 7) {
                    val ly = restY + rh * 0.33f + (i - 3) * 4 * d
                    val half = (rw * 0.6f + rnd.nextFloat() * rw * 0.4f) * k
                    if (Term.prism) line.color = Term.IRIS[i % 6]
                    if (Term.thermal) line.color = Heat.color(0.45f + i * 0.08f)
                    line.alpha = (180 * k).toInt().coerceIn(0, 255)
                    canvas.drawRect(cx - half, ly, cx + half, ly + d, line)
                }
            }
        }

        // 3. надпись
        if (t > 1500) {
            val p = ((t - 1500) / 450f).coerceIn(0f, 1f)
            val word = Term.scramble("krisa", p, rnd)
            val by = restY + rh * 0.5f + 80 * d
            if (Term.prism) {
                // стеклянное слово: радужная тень-свечение, тело светлое сверху, сиреневое снизу, светлый контур
                big.shader = android.graphics.LinearGradient(cx - 130 * d, 0f, cx + 130 * d, 0f, Term.IRIS, null, android.graphics.Shader.TileMode.MIRROR)
                big.alpha = 150; canvas.drawText(word, cx, by + 3 * d, big)
                big.alpha = 255
                wordP.textSize = big.textSize
                wordP.shader = android.graphics.LinearGradient(0f, by + big.ascent(), 0f, by + big.descent() * 0.4f,
                    intArrayOf(Color.argb(250, 255, 255, 255), Color.argb(200, 225, 215, 255), Color.argb(150, 150, 120, 255)), floatArrayOf(0f, 0.55f, 1f), android.graphics.Shader.TileMode.CLAMP)
                canvas.drawText(word, cx, by, wordP)
                wordEdge.textSize = big.textSize
                wordEdge.shader = android.graphics.LinearGradient(cx - 130 * d, 0f, cx + 130 * d, 0f, Term.IRIS, null, android.graphics.Shader.TileMode.MIRROR)
                canvas.drawText(word, cx, by, wordEdge)
            } else {
                if (Term.thermal) big.shader = android.graphics.LinearGradient(cx - 120 * d, 0f, cx + 120 * d, 0f,
                    intArrayOf(Heat.color(0.45f), Heat.color(0.65f), Heat.color(0.85f), Heat.color(1f), Heat.color(0.8f)), null, android.graphics.Shader.TileMode.CLAMP)
                canvas.drawText(word, cx, by, big)
            }
        }

        // тепловизор «захватил» крысу: рамка обнаружения с подписью
        if (Term.thermal && f > 0.62f) {
            val blink = t < 1700 && ((t / 70).toInt() % 2 == 0)
            if (!blink) {
                val bl = cx - rw * 0.56f; val bt = restY - rh * 0.62f; val br = cx + rw * 0.56f; val bb = restY + rh * 0.58f
                line.color = Heat.YELLOW; line.alpha = 230
                line.style = Paint.Style.STROKE; line.strokeWidth = 1.5f * d
                canvas.drawRect(bl, bt, br, bb, line)
                line.style = Paint.Style.FILL
                txt.color = Heat.YELLOW
                canvas.drawText("RAT_01XX  37.2°C", bl, bt - 6 * d, txt)
                txt.color = Term.DIM
            }
        }

        // подпись в правом нижнем углу «расписывается» слева направо
        if (t > 700) {
            val p = ((t - 700) / 650f).coerceIn(0f, 1f)
            val sw = 110 * d; val sh = sw * sign.height / sign.width
            val sx = w - sw - 18 * d; val sy = h - sh - 22 * d
            canvas.save()
            canvas.clipRect(sx, sy, sx + sw * p, sy + sh)
            signP.alpha = 220
            canvas.drawBitmap(sign, null, RectF(sx, sy, sx + sw, sy + sh), signP)
            canvas.restore()
        }

        // 4. уход: экран рассыпается полосами
        if (t > 2350) {
            val p = ((t - 2350) / 300f).coerceIn(0f, 1f)
            for (i in 0 until 14) {
                val by = rnd.nextFloat() * h
                if (Term.prism) line.color = Term.IRIS[i % 6]
                if (Term.thermal) line.color = Heat.color(0.4f + (i % 7) * 0.09f)
                line.alpha = (220 * (1 - p)).toInt()
                canvas.drawRect(0f, by, w * rnd.nextFloat(), by + rnd.nextFloat() * 6 * d, line)
            }
            if (p >= 1f) finish()
        }
        if (!finished) postInvalidateOnAnimation()
    }

    /** «Трубки» стекла: контур крысы, утолщённый во все стороны. */
    private fun makeTube(): Bitmap {
        val out = Bitmap.createBitmap(rat.width, rat.height, Bitmap.Config.ARGB_8888)
        val cv = Canvas(out); val pp = Paint(Paint.FILTER_BITMAP_FLAG).apply { color = Color.WHITE }
        val rr = rat.width / 150f
        for (k in 0 until 16) {
            val an = k * Math.PI / 8
            cv.drawBitmap(glow, (rr * kotlin.math.cos(an)).toFloat(), (rr * sin(an)).toFloat(), pp)
        }
        cv.drawBitmap(glow, 0f, 0f, pp)
        return out.extractAlpha()
    }
    /** Маленький снимок сцены (1/4 разрешения) для «линзы» внутри крысы; обновляется раз в несколько кадров. */
    private var sceneBmp: Bitmap? = null
    private var lensFrame = 0
    private val sceneM = android.graphics.Matrix()
    private val glassP = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    private fun updateLens() {
        val w = width; val h = height
        if (w == 0 || lensFrame++ % 4 != 0) return
        val bm = sceneBmp ?: Bitmap.createBitmap(max(1, w / 4), max(1, h / 4), Bitmap.Config.ARGB_8888).also { sceneBmp = it }
        val cv = Canvas(bm); cv.scale(bm.width / w.toFloat(), bm.height / h.toFloat())
        PrismScene.draw(cv, PrismScene.time())
    }

    /**
     * Крыса из жидкого стекла: утолщённый контур залит увеличенным фоном (линза)
     * с радужной подкраской и бликом; светлый край сверху-слева, бирюзовый — снизу-справа.
     * Рисуется в повёрнутых координатах крысы, поэтому фон переводится обратно в экранные.
     */
    private fun drawGlassRat(canvas: Canvas, dst: RectF, cx: Float, cy: Float, rot: Float, t: Float) {
        val bm = sceneBmp ?: return
        val tube = tubeBmp ?: return
        val sh = android.graphics.Shader.TileMode.CLAMP
        val e = 1.8f * d
        fringe.color = Color.argb(235, 255, 255, 255); canvas.drawBitmap(tube, null, RectF(dst.left - e, dst.top - e, dst.right - e, dst.bottom - e), fringe)
        fringe.color = Color.argb(210, 80, 225, 255); canvas.drawBitmap(tube, null, RectF(dst.left + e, dst.top + e, dst.right + e, dst.bottom + e), fringe)
        // линза: пиксель фона → экран (×4), увеличение ×1.35 вокруг крысы, затем в её повёрнутые координаты
        sceneM.setScale(width / bm.width.toFloat(), height / bm.height.toFloat())
        sceneM.postScale(1.35f, 1.35f, cx, cy); sceneM.postTranslate(-cx, -cy); sceneM.postRotate(-rot)
        val lens = android.graphics.BitmapShader(bm, sh, sh).apply { setLocalMatrix(sceneM) }
        val iris = android.graphics.LinearGradient(dst.left, dst.top, dst.right, dst.bottom,
            Term.IRIS.map { Color.argb(95, Color.red(it), Color.green(it), Color.blue(it)) }.toIntArray(), null, android.graphics.Shader.TileMode.MIRROR).apply {
            val mm = android.graphics.Matrix(); mm.setTranslate((t / 1000f * 0.25f % 2f) * dst.width(), 0f); setLocalMatrix(mm)
        }
        glassP.shader = android.graphics.ComposeShader(lens, iris, PorterDuff.Mode.SRC_OVER)
        canvas.drawBitmap(tube, null, dst, glassP)
        // блик
        glassP.shader = android.graphics.RadialGradient(dst.left + dst.width() * 0.3f, dst.top + dst.height() * 0.2f, dst.width() * 0.5f,
            intArrayOf(Color.argb(150, 255, 255, 255), Color.argb(30, 255, 255, 255), Color.TRANSPARENT), floatArrayOf(0f, 0.5f, 1f), sh)
        canvas.drawBitmap(tube, null, dst, glassP)
        // тонкая светлая жилка по центру трубки — как блик на гнутом стекле
        fringe.color = Color.argb(150, 255, 255, 255); canvas.drawBitmap(glow, null, RectF(dst.left - d / 2, dst.top - d / 2, dst.right - d / 2, dst.bottom - d / 2), fringe)
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        if (Term.prism) PrismScene.resize(w, h)
        if (Term.thermal) ThermalScene.resize(context, w, h)
        sceneBmp = null
    }

    /** Падение с затухающим отскоком. */
    private fun bounce(x: Float): Float {
        val n = 7.5625f; val dd = 2.75f
        return when {
            x < 1 / dd -> n * x * x
            x < 2 / dd -> { val t = x - 1.5f / dd; n * t * t + 0.75f }
            x < 2.5 / dd -> { val t = x - 2.25f / dd; n * t * t + 0.9375f }
            else -> { val t = x - 2.625f / dd; n * t * t + 0.984375f }
        }
    }
}
