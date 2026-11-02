package ru.random.wheel

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.text.TextPaint
import android.text.TextUtils
import android.util.AttributeSet
import android.view.View
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/** Что вращается при розыгрыше. */
enum class SpinMode(val id: String, val title: String) {
    WHEEL("wheel", "Колесо"),
    ARROW("arrow", "Стрелка"),
    BALL("ball", "Шарик"),
    LIGHTS("lights", "Огоньки"),
    COUNTER("counter", "Встречное"),
    REEL("reel", "Барабан"),
    PENDULUM("pendulum", "Маятник"),
    CLOCK("clock", "Часы"),
    STRIP("strip", "Лента"),
    FLASH("flash", "Вспышки"),
    RADAR("radar", "Радар"),
    BOTTLE("bottle", "Бутылочка"),
    SNAKE("snake", "Змейка"),
    SPRING("spring", "Пружина"),
    COMET("comet", "Комета"),
    SUSPENSE("suspense", "Интрига"),
    DARTS("darts", "Дартс"),
    PLINKO("plinko", "Плинко"),
    REVERSE("reverse", "Обратное"),
    TRIPLE("triple", "Тройной"),
    TWO_ARROWS("two", "Две стрелы"),
    FIVE_ARROWS("five", "Пять стрел"),
    BOOMERANG("boomerang", "Бумеранг");

    /** Сколько указателей — столько результатов за одно вращение. */
    val pointers get() = when (this) { TRIPLE -> 3; TWO_ARROWS -> 2; FIVE_ARROWS -> 5; else -> 1 }

    /** Указатель нарисован сверху и стоит на месте — крутится само колесо. */
    val topPointer get() = this == WHEEL || this == SPRING || this == SUSPENSE || this == REVERSE

    /** Само колесо крутится — подписи не переворачиваем. */
    val wheelSpins get() = topPointer || this == COUNTER || this == DARTS || this == TRIPLE

    companion object { fun byId(id: String?) = entries.firstOrNull { it.id == id } ?: WHEEL }
}

/**
 * Колесо фортуны: сектора пропорциональны размерам [sizes].
 *
 * Положение задают два угла: [rotationDeg] — поворот колеса и [cursorDeg] — куда указывает
 * стрелка / шарик / огонёк / линия барабана (0 — вверх, по часовой). Выпавший сектор —
 * под углом колеса cursor − rotation; в режиме «Колесо» курсор — неподвижный указатель сверху (0).
 */
class WheelView(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    var labels: List<String> = emptyList()
        set(value) { field = value; recalc(); invalidate() }

    /** Размеры секторов (по умолчанию все 1). Доля сектора = размер / сумма размеров. */
    var sizes: List<Int> = emptyList()
        set(value) { field = value; recalc(); invalidate() }

    /** Выделенный сектор (обводка) — для окна изменения размера; -1 — нет. */
    var highlight = -1
        set(value) { field = value; invalidate() }

    var mode = SpinMode.WHEEL
        set(value) {
            if (spinning) return
            field = value
            if (value.topPointer) cursorDeg = 0f
            invalidate()
        }

    /** Начало каждого сектора в градусах от указателя по часовой стрелке; последний элемент — 360. */
    private var starts = FloatArray(1)

    var theme: AppTheme = Themes.all[0]
        set(value) {
            field = value
            rimPaint.color = value.rim; hubPaint.color = value.rim; pointerPaint.color = value.rim
            hubInner.color = value.panel; emptyPaint.color = value.muted
            textPaint.typeface = android.graphics.Typeface.create(value.font.family, android.graphics.Typeface.BOLD)
            emptyPaint.typeface = android.graphics.Typeface.create(value.font.family, android.graphics.Typeface.NORMAL)
            // у «комиксной» темы перегородки — жирные линии цвета обода
            linePaint.color = if (value.rimWidth >= 9f) value.rim else 0x40000000
            linePaint.strokeWidth = dp(if (value.rimWidth >= 9f) value.rimWidth * 0.45f else 1.5f)
            invalidate()
        }

    /** Указатель перешёл на следующий сектор (для щелчка и вибрации). */
    var onTick: (() -> Unit)? = null

    private var rotationDeg = 0f
    private var cursorDeg = 0f
    /** Радиус шарика (доля r) — по дорожке, по спирали внутрь, отскоки, лунка. */
    private var ballRadius = 0.92f
    /** Скорость курсора за последний кадр, градусы — длина хвоста кометы. */
    private var cursorSpeed = 0f
    /** Режим «Вспышки»: какой сектор подсвечен (−1 — по курсору). */
    private var flashIdx = -1
    /** Дартс: 0 — дротик ждёт внизу, 1 — летит (dartFly 0…1), 2 — воткнулся. */
    private var dartState = 0
    private var dartFly = 0f
    private val ringInner = 0.5f // внутренний радиус кольца секторов в режимах со стрелкой, доля r
    private var animator: ValueAnimator? = null
    val spinning get() = animator?.isRunning == true

    private val sectorPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = 0x40000000; strokeWidth = dp(1.5f)
    }
    private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#F2F2F5")
    }
    private val hubPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#F2F2F5") }
    private val hubInner = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#22242E") }
    private val pointerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F2F2F5"); setShadowLayer(dp(3f), 0f, dp(1.5f), 0x88000000.toInt())
    }
    private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER; isFakeBoldText = true
    }
    private val emptyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val emptyRing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeWidth = dp(3f)
        pathEffect = android.graphics.DashPathEffect(floatArrayOf(dp(10f), dp(8f)), 0f)
    }
    private val hlPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val fadePaint = Paint()
    private val oval = RectF()
    private val rect = RectF()
    private val pointer = Path()
    private val arrowPath = Path()

    fun colorOf(i: Int): Int {
        val pal = theme.palette
        val n = labels.size
        // последний сектор не должен совпасть по цвету с первым (они соседние)
        val k = if (n > 1 && i == n - 1 && i % pal.size == 0) pal.size / 2 else i % pal.size
        return pal[k]
    }

    private fun recalc() {
        val n = labels.size
        val w = FloatArray(n) { (sizes.getOrNull(it) ?: 1).coerceAtLeast(1).toFloat() }
        val sum = w.sum()
        starts = FloatArray(n + 1)
        for (i in 0 until n) starts[i + 1] = starts[i] + 360f * w[i] / sum
        if (n > 0) starts[n] = 360f
    }

    /** Сектор по углу колеса (0 — начало первого сектора, по часовой стрелке). */
    private fun indexAtAngle(deg: Float): Int {
        val n = labels.size
        if (n == 0) return -1
        val a = (deg % 360 + 360) % 360
        for (i in 0 until n) if (a < starts[i + 1]) return i
        return n - 1
    }

    /** Сектор под неподвижным указателем сверху (для проверки режимов «Колесо» и «Пружина»). */
    fun indexAtTop() = indexAtAngle(-rotationDeg)

    /** Индекс выпавшего / текущего сектора. */
    fun indexUnderPointer() = when {
        mode == SpinMode.FLASH && flashIdx >= 0 -> flashIdx
        mode == SpinMode.TRIPLE -> indexAtAngle(-rotationDeg)
        mode.pointers > 1 -> indexAtAngle(multiDeg[0] - rotationDeg)
        else -> indexAtAngle(cursorDeg - rotationDeg)
    }

    /** «Тройной»: что выпало у колеса (указатель сверху), стрелки и кометы. */
    fun tripleIndices() = intArrayOf(
        indexAtAngle(-rotationDeg), indexAtAngle(cursorDeg - rotationDeg), indexAtAngle(cometDeg - rotationDeg))

    /** Что выпало у каждого указателя (колесо/стрелы/комета) — для режимов с несколькими результатами. */
    fun multiIndices(): IntArray = when (mode) {
        SpinMode.TRIPLE -> tripleIndices()
        else -> IntArray(mode.pointers) { indexAtAngle(multiDeg[it] - rotationDeg) }
    }

    /** Углы стрел в «Двух стрелах» / «Пяти стрелах»; разные направления и скорости. */
    private val multiDeg = FloatArray(5) { it * 72f }
    private val multiColors get() = intArrayOf(theme.rim, theme.accent, 0xFF4FC3F7.toInt(), 0xFFFF6E6E.toInt(), 0xFF9CFF57.toInt())

    /** Несколько результатов за раз: «Тройной» или стрелы. [idx] — что должно выпасть у каждого указателя. */
    fun spinMulti(idx: IntArray, durationMs: Long, onEnd: () -> Unit) {
        if (mode == SpinMode.TRIPLE) { spinTriple(idx, durationMs, onEnd); return }
        val n = labels.size
        if (n == 0 || spinning) return
        val k = mode.pointers
        val turns = (durationMs / 800).toInt().coerceAtLeast(2)
        val rot = rotationDeg
        val a0 = FloatArray(k) { norm(multiDeg[it]) }
        val a1 = FloatArray(k)
        val stop = FloatArray(k)
        for (i in 0 until k) {
            val f = starts[idx[i]]
            val target = f + (starts[idx[i] + 1] - f) * (0.15f + 0.7f * Random.nextFloat())
            val dir = if (i % 2 == 0) 1 else -1                // чётные — по часовой, нечётные — против
            val laps = 360f * (turns + i % 3 + (if (k == 2) i else 0)) // разная скорость
            a1[i] = if (dir > 0) a0[i] + laps + norm(target + rot - a0[i]) else a0[i] - laps - norm(a0[i] - (target + rot))
            stop[i] = if (k == 1) 1f else 0.62f + 0.38f * i / (k - 1)   // встают по очереди
        }
        val frame: (Float) -> Unit = { t ->
            for (i in 0 until k) multiDeg[i] = a0[i] + (a1[i] - a0[i]) * ease(min(1f, t / stop[i]), 3f)
        }
        lastFrame = frame
        var last = multiIndices().contentHashCode()
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMs + 1200L + Random.nextLong(durationMs / 4 + 1)
            interpolator = android.view.animation.LinearInterpolator()
            addUpdateListener {
                frame(it.animatedValue as Float)
                val h = multiIndices().contentHashCode()
                if (h != last) { last = h; onTick?.invoke() }
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: Animator) { frame(1f); invalidate(); onEnd() }
            })
            start()
        }
    }

    /** Угол кометы в «Тройном» (0 — вверх, по часовой) и её скорость за кадр. */
    private var cometDeg = 0f
    private var cometSpeed = 0f

    /**
     * «Тройной»: одновременно крутятся колесо (по часовой), стрелка (против) и комета (по часовой,
     * быстрее всех). Колесо встаёт первым, потом стрелка, последней — комета. [idx] — что должно
     * выпасть у каждого (могут совпадать).
     */
    fun spinTriple(idx: IntArray, durationMs: Long, onEnd: () -> Unit) {
        val n = labels.size
        if (n == 0 || spinning) return
        fun inside(i: Int): Float { val f = starts[i]; return f + (starts[i + 1] - f) * (0.15f + 0.7f * Random.nextFloat()) }
        val tA = inside(idx[0]); val tB = inside(idx[1]); val tC = inside(idx[2])
        val turns = (durationMs / 800).toInt().coerceAtLeast(2)
        val r0 = norm(rotationDeg); val c0 = norm(cursorDeg); val k0 = norm(cometDeg)
        rotationDeg = r0; cursorDeg = c0; cometDeg = k0
        val r1 = r0 + 360f * turns + norm(-tA - r0)
        val c1 = c0 - 360f * (turns + 1) - norm(c0 - (tB + r1))
        val k1 = k0 + 360f * (turns + 3) + norm(tC + r1 - k0)
        val frame: (Float) -> Unit = { t ->
            rotationDeg = r0 + (r1 - r0) * ease(min(1f, t / 0.7f), 3f)
            cursorDeg = c0 + (c1 - c0) * ease(min(1f, t / 0.85f), 3f)
            val prev = cometDeg
            cometDeg = k0 + (k1 - k0) * ease(t, 3f)
            cometSpeed = kotlin.math.abs(cometDeg - prev)
        }
        lastFrame = frame
        var last = tripleIndices().contentHashCode()
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMs + 1500L + Random.nextLong(durationMs / 4 + 1)
            interpolator = android.view.animation.LinearInterpolator()
            addUpdateListener {
                frame(it.animatedValue as Float)
                val h = tripleIndices().contentHashCode()
                if (h != last) { last = h; onTick?.invoke() }
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: Animator) { frame(1f); cometSpeed = 0f; invalidate(); onEnd() }
            })
            start()
        }
    }

    /** Индекс сектора в точке экрана (x, y) или -1 вне колеса. */
    fun indexAt(x: Float, y: Float): Int {
        val (cx, cy, r) = geometry()
        if (mode == SpinMode.REEL) {
            reelWindow(cx, cy, r)
            if (!rect.contains(x, y)) return -1
            return indexAtAngle(cursorDeg - rotationDeg + (y - rect.centerY()) / reelPxPerDeg(rect))
        }
        if (mode == SpinMode.PLINKO) {
            plinkoBoard(cx, cy, r)
            if (!rect.contains(x, y)) return -1
            return indexAtAngle((x - rect.left) / rect.width() * 360f)
        }
        if (mode == SpinMode.STRIP) {
            stripWindow(cx, cy, r)
            if (!rect.contains(x, y)) return -1
            return indexAtAngle(cursorDeg - rotationDeg + (x - rect.centerX()) / stripPxPerDeg(rect))
        }
        val dx = x - cx; val dy = y - cy
        if (dx * dx + dy * dy > r * r) return -1
        val a = Math.toDegrees(kotlin.math.atan2(dx.toDouble(), -dy.toDouble())).toFloat() // 0 — вверх, по часовой
        return indexAtAngle(a - rotationDeg)
    }

    /** Последнее касание — чтобы по долгому нажатию узнать, какой сектор держат. */
    var lastTouchX = 0f; private set
    var lastTouchY = 0f; private set

    override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
        if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) { lastTouchX = e.x; lastTouchY = e.y }
        return super.onTouchEvent(e)
    }

    private fun geometry(): Triple<Float, Float, Float> {
        val cx = width / 2f
        val cy = height / 2f + dp(8f)
        val r = min(width / 2f, height / 2f - dp(8f)) - dp(10f)
        return Triple(cx, cy, r)
    }

    private fun norm(a: Float) = (a % 360 + 360) % 360

    private var lastFrame: ((Float) -> Unit)? = null

    /** Для проверки: показать момент [t] (0…1) последнего вращения. */
    fun seek(t: Float) { lastFrame?.invoke(t); invalidate() }

    /** Замедление к концу: 1 − (1 − t)^p. */
    private fun ease(t: Float, p: Float = 4.4f) = 1f - Math.pow((1.0 - t), p.toDouble()).toFloat()

    /** Крутит колесо / курсор так, чтобы выпал случайный угол внутри сектора [index]. */
    fun spinTo(index: Int, durationMs: Long, onEnd: () -> Unit) {
        val n = labels.size
        if (n == 0 || spinning) return
        val from = starts[index]; val span = starts[index + 1] - from
        val target = from + span * (0.12f + 0.76f * Random.nextFloat()) // угол внутри сектора
        val turns = (durationMs / 800).toInt().coerceAtLeast(2)
        fun laps() = 360f * Random.nextInt(turns, turns + 3)
        // в конце нужно: cursor − rotation ≡ target (mod 360)
        // в режимах с указателем сверху курсор всегда там (0), даже если остался от прошлого режима
        if (mode.topPointer) cursorDeg = 0f
        val r0 = norm(rotationDeg); val c0 = norm(cursorDeg)
        rotationDeg = r0; cursorDeg = c0
        flashIdx = -1
        val frame: (Float) -> Unit = when (mode) {
            SpinMode.WHEEL -> {
                val r1 = r0 + laps() + norm(c0 - target - r0);
                { t -> rotationDeg = r0 + (r1 - r0) * ease(t) }
            }
            SpinMode.COUNTER -> {
                val r1 = r0 - laps() * 0.6f - Random.nextFloat() * 360f // колесо — против часовой
                val c1 = c0 + laps() + norm(target + r1 - c0);
                { t -> val e = ease(t); rotationDeg = r0 + (r1 - r0) * e; cursorDeg = c0 + (c1 - c0) * e }
            }
            SpinMode.BALL -> ballFrame(r0, target, span, turns)
            SpinMode.REVERSE -> {
                val r1 = r0 - laps() - norm(r0 - (c0 - target)); // против часовой
                { t -> rotationDeg = r0 + (r1 - r0) * ease(t) }
            }
            SpinMode.SUSPENSE -> {
                // почти встаёт на следующем по ходу секторе у самой границы, замирает и переползает на цель
                val next = (index + 1) % n
                val edge = starts[index + 1] + min(3f, (starts[next + 1] - starts[next]) * 0.4f)
                val rMid = r0 + laps() + norm(c0 - edge - r0)
                val rEnd = rMid + norm((c0 - target) - rMid);
                { t ->
                    rotationDeg = when {
                        t < 0.72f -> r0 + (rMid - r0) * ease(t / 0.72f, 3f)
                        t < 0.86f -> rMid + 0.4f * sin((t - 0.72f) * 120f) * (1 - (t - 0.72f) / 0.14f) // дрожит
                        else -> { val u = (t - 0.86f) / 0.14f; rMid + (rEnd - rMid) * u * u * (3 - 2 * u) }
                    }
                }
            }
            SpinMode.DARTS -> {
                // колесо замедляется; в момент hit дротик втыкается сверху — там должна быть цель
                val hit = 0.55f
                val big = (laps() + norm(-target - r0)) / ease(hit, 2.2f)
                dartState = 0;
                { t ->
                    rotationDeg = r0 + big * ease(t, 2.2f)
                    when {
                        t < 0.38f -> { dartState = 0; cursorDeg = 0f }
                        t < hit -> { dartState = 1; dartFly = (t - 0.38f) / (hit - 0.38f); cursorDeg = 0f }
                        else -> { dartState = 2; cursorDeg = target + rotationDeg }
                    }
                }
            }
            SpinMode.PLINKO -> {
                // шарик падает из середины сквозь штырьки и попадает в лунку цели
                val start = 180f
                val amp = min(28f, 360f / n)
                val rows = 8
                val ph = Random.nextFloat() * 6.28f;
                { t ->
                    val p = start + (target - start) * ease(t, 1.6f) +
                        amp * (1 - t) * sin(2 * Math.PI.toFloat() * rows * t / 2 + ph) * sin(Math.PI.toFloat() * t)
                    cursorDeg = p.coerceIn(0.5f, 359.5f) + rotationDeg
                    dartFly = t // доля падения для высоты шарика
                }
            }
            SpinMode.SPRING -> {
                // колесо проскакивает цель на O градусов и пружинисто возвращается
                val r1 = r0 + laps() + norm(c0 - target - r0)
                val over = 25f + Random.nextFloat() * 20f
                { t ->
                    rotationDeg = if (t < 0.7f) r0 + (r1 + over - r0) * ease(t / 0.7f, 3f)
                    else { val u = (t - 0.7f) / 0.3f; r1 + over * (1 - u) * (1 - u) * cos((Math.PI * 1.5 * u).toFloat()) }
                }
            }
            SpinMode.BOOMERANG -> {
                // улетает далеко за цель, разворачивается и возвращается
                val c1 = c0 + laps() + norm(target + r0 - c0)
                val fly = 120f + Random.nextFloat() * 120f;
                { t ->
                    cursorDeg = if (t < 0.62f) c0 + (c1 + fly - c0) * ease(t / 0.62f, 2.6f)
                    else { val u = (t - 0.62f) / 0.38f; c1 + fly * (1 - u * u * (3 - 2 * u)) }
                }
            }
            SpinMode.PENDULUM -> {
                // затухающие качания вокруг цели; старт — из текущего положения
                val c1 = c0 + ((norm(target + r0 - c0) + 180f) % 360f - 180f)
                val swing = 160f + Random.nextFloat() * 120f
                val swings = 3 + Random.nextInt(2)
                val w = (2 * Math.PI * swings).toFloat();
                { t ->
                    val d = (1 - t) * (1 - t)
                    cursorDeg = c1 + d * ((c0 - c1) * cos(w * t) + swing * sin(w * t))
                }
            }
            SpinMode.FLASH -> {
                val steps = (durationMs / 140).toInt().coerceIn(12, 60)
                val seed = Random.nextInt()
                cursorDeg = r0 + target;
                { t ->
                    val k = (ease(t, 2.6f) * steps).toInt()
                    flashIdx = if (k >= steps || n == 1) index else {
                        // случайный сектор, но не тот же, что на прошлом шаге
                        val a = Random(seed + k).nextInt(n); val b = Random(seed + k - 1).nextInt(n)
                        if (a == b) (a + 1) % n else a
                    }
                }
            }
            else -> { // стрелка, огоньки, барабан, лента, часы — движется курсор
                val c1 = c0 + laps() + norm(target + r0 - c0);
                { t -> cursorDeg = c0 + (c1 - c0) * ease(t) }
            }
        }
        lastFrame = frame
        var lastIdx = indexUnderPointer()
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMs + Random.nextLong(durationMs / 4 + 1)
            interpolator = android.view.animation.LinearInterpolator()
            addUpdateListener {
                val prev = cursorDeg
                frame(it.animatedValue as Float)
                cursorSpeed = kotlin.math.abs(cursorDeg - prev)
                val idx = indexUnderPointer()
                if (idx != lastIdx) { lastIdx = idx; onTick?.invoke() }
                invalidate()
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: Animator) {
                    frame(1f)
                    cursorSpeed = 0f
                    if (mode == SpinMode.FLASH) { flashIdx = index; cursorDeg = rotationDeg + target }
                    invalidate(); onEnd()
                }
            })
            start()
        }
    }

    /**
     * Шарик как в рулетке. Колесо крутится по часовой и плавно останавливается; шарик бежит
     * против часовой по дорожке, теряет скорость, по спирали скатывается к лункам, отскакивает
     * от перегородок (перескакивая в соседние лунки) и замирает — дальше едет вместе с колесом.
     * Угол шарика считается относительно колеса (b), на экране он = b + поворот колеса.
     */
    private fun ballFrame(r0: Float, target: Float, span: Float, turns: Int): (Float) -> Unit {
        val r1 = r0 + 360f * (1 + turns / 3) + Random.nextFloat() * 360f
        val travel = 360f * (turns + 1) + Random.nextFloat() * 360f // путь шарика относительно колеса
        val drop = 0.62f   // когда шарик срывается с дорожки
        val land = 0.74f   // касается лунок
        val settle = 0.9f  // замер
        val bounceAmp = maxOf(span * 1.4f, 14f) * (if (Random.nextBoolean()) 1 else -1)
        val bounces = 3 + Random.nextInt(3)
        return { t ->
            rotationDeg = r0 + (r1 - r0) * ease(t, 2.0f)
            val b = when {
                t < land -> target + bounceAmp + travel * (1 - ease(t / land, 2.0f))
                t < settle -> {
                    // затухающие отскоки: туда-сюда через перегородки
                    val u = (t - land) / (settle - land)
                    target + bounceAmp * (1 - u) * (1 - u) * cos((Math.PI * bounces * u).toFloat())
                }
                else -> target
            }
            cursorDeg = b + rotationDeg
            ballRadius = when {
                t < drop -> 0.92f + 0.006f * sin(t * 90f) // лёгкое дрожание на дорожке
                t < land -> { val u = (t - drop) / (land - drop); 0.92f - 0.16f * u * u }
                t < settle -> {
                    val u = (t - land) / (settle - land)
                    0.76f + 0.07f * (1 - u) * kotlin.math.abs(sin((Math.PI * bounces * u).toFloat()))
                }
                else -> 0.76f
            }
        }
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val n = labels.size
        val (cx, cy, r) = geometry()
        if (r <= 0) return
        if (n == 0) {
            emptyRing.color = theme.muted
            canvas.drawCircle(cx, cy, r, emptyRing)
            emptyPaint.textSize = dp(18f)
            canvas.drawText("Добавьте варианты", cx, cy, emptyPaint)
            emptyPaint.textSize = dp(14f)
            canvas.drawText("на вкладке «Варианты»", cx, cy + dp(24f), emptyPaint)
            return
        }
        when (mode) {
            SpinMode.REEL -> { drawReel(canvas, cx, cy, r); return }
            SpinMode.STRIP -> { drawStrip(canvas, cx, cy, r); return }
            SpinMode.PLINKO -> { drawPlinko(canvas, cx, cy, r); return }
            // у шарика снаружи дорожка, колесо чуть меньше
            SpinMode.BALL -> drawSectors(canvas, cx, cy, r * 0.84f, ring = false)
            SpinMode.ARROW, SpinMode.COUNTER, SpinMode.PENDULUM, SpinMode.CLOCK, SpinMode.BOTTLE, SpinMode.TRIPLE,
            SpinMode.TWO_ARROWS, SpinMode.FIVE_ARROWS, SpinMode.BOOMERANG ->
                drawSectors(canvas, cx, cy, r, ring = true)
            else -> drawSectors(canvas, cx, cy, r, ring = false)
        }
        when (mode) {
            SpinMode.WHEEL, SpinMode.SPRING, SpinMode.SUSPENSE, SpinMode.REVERSE ->
                { drawHub(canvas, cx, cy, r); drawTopPointer(canvas, cx, cy, r) }
            SpinMode.DARTS -> { drawHub(canvas, cx, cy, r); drawDart(canvas, cx, cy, r) }
            SpinMode.TRIPLE -> {
                // все трое: указатель сверху (колесо), стрелка в центре, комета по ободу
                drawTopPointer(canvas, cx, cy, r)
                drawArrow(canvas, cx, cy, r, cursorDeg)
                drawCometAt(canvas, cx, cy, r, r, cometDeg, cometSpeed)
            }
            SpinMode.RADAR -> drawRadar(canvas, cx, cy, r)
            SpinMode.BOTTLE -> drawBottle(canvas, cx, cy, r)
            SpinMode.SNAKE -> drawSnake(canvas, cx, cy, r)
            SpinMode.COMET -> drawComet(canvas, cx, cy, r)
            SpinMode.ARROW, SpinMode.COUNTER, SpinMode.PENDULUM, SpinMode.BOOMERANG -> drawArrow(canvas, cx, cy, r, cursorDeg)
            SpinMode.TWO_ARROWS, SpinMode.FIVE_ARROWS -> {
                val cols = multiColors
                // последние рисуем первыми, чтобы первая стрела была сверху; чем дальше — тем тоньше
                for (i in mode.pointers - 1 downTo 0) drawArrow(canvas, cx, cy, r, multiDeg[i], cols[i], 1f - 0.12f * i, hub = i == 0)
            }
            SpinMode.CLOCK -> drawClock(canvas, cx, cy, r)
            SpinMode.BALL -> drawBall(canvas, cx, cy, r)
            SpinMode.LIGHTS, SpinMode.FLASH -> drawLights(canvas, cx, cy, r)
            else -> {}
        }
    }

    /** Сектора с подписями; [ring] — кольцом по краю (середина пустая, колесо не крутится). */
    private fun drawSectors(canvas: Canvas, cx: Float, cy: Float, r: Float, ring: Boolean) {
        val n = labels.size
        oval.set(cx - r, cy - r, cx + r, cy + r)
        fun from(i: Int) = -90f + starts[i] + rotationDeg
        fun span(i: Int) = starts[i + 1] - starts[i]

        val style = theme.sectors
        for (i in 0 until n) {
            val c = colorOf(i)
            when (style) {
                Sectors.SOLID -> sectorPaint.color = c
                // объём: к центру светлее, к ободу темнее
                Sectors.GRADIENT -> sectorPaint.shader = android.graphics.RadialGradient(cx, cy, r,
                    intArrayOf(mix(c, Color.WHITE, 0.35f), c, mix(c, Color.BLACK, 0.3f)), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
                // неон: тёмная заливка с оттенком сектора, яркий контур
                Sectors.OUTLINE -> sectorPaint.color = mix(theme.bg, c, if (theme.light) 0.12f else 0.18f)
            }
            canvas.drawArc(oval, from(i), span(i), true, sectorPaint)
            sectorPaint.shader = null
        }
        if (style == Sectors.OUTLINE) {
            hlPaint.strokeWidth = dp(2.5f)
            val inset = dp(2f)
            rect.set(oval.left + inset, oval.top + inset, oval.right - inset, oval.bottom - inset)
            for (i in 0 until n) {
                hlPaint.color = colorOf(i)
                canvas.drawArc(rect, from(i) + 0.8f, span(i) - 1.6f, true, hlPaint)
            }
        } else if (n > 1) for (i in 0 until n) canvas.drawArc(oval, from(i), span(i), true, linePaint)

        val textAt = if (ring) r * (1 + ringInner) / 2 else r * 0.58f
        val maxW = if (ring) r * (1 - ringInner) * 0.88f else r * 0.62f
        // подписи читаются, если колесо в этом режиме стоит на месте
        val upright = !mode.wheelSpins
        for (i in 0 until n) {
            // шрифт по ширине сектора: узкие сектора — мельче, совсем узкие — без подписи
            val size = min(r * (if (ring) 0.11f else 0.13f), textAt * 3.8f * span(i) / 360f + dp(6f))
            if (size < dp(7f)) continue
            textPaint.textSize = size
            canvas.save()
            val mid = from(i) + span(i) / 2
            canvas.rotate(mid, cx, cy)
            val m = norm(mid)
            if (upright && m > 90 && m < 270) canvas.rotate(180f, cx + textAt, cy)
            textPaint.color = when {
                style == Sectors.OUTLINE -> colorOf(i)
                isLight(colorOf(i)) -> 0xFF15161C.toInt()
                else -> Color.WHITE
            }
            val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, maxW, TextUtils.TruncateAt.END)
            canvas.drawText(t, 0, t.length, cx + textAt, cy - (textPaint.ascent() + textPaint.descent()) / 2, textPaint)
            canvas.restore()
        }

        if (highlight in 0 until n) {
            hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(4f)
            canvas.drawArc(oval, from(highlight), span(highlight), true, hlPaint)
        }

        rimPaint.strokeWidth = dp(theme.rimWidth)
        canvas.drawCircle(cx, cy, r, rimPaint)
        if (ring) {
            sectorPaint.color = theme.bg
            canvas.drawCircle(cx, cy, r * ringInner, sectorPaint)
            rimPaint.strokeWidth = dp(3f)
            canvas.drawCircle(cx, cy, r * ringInner, rimPaint)
        }
    }

    private fun drawHub(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        canvas.drawCircle(cx, cy, r * 0.12f, hubPaint)
        canvas.drawCircle(cx, cy, r * 0.07f, hubInner)
    }

    private fun drawTopPointer(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val pw = dp(16f)
        pointer.reset()
        pointer.moveTo(cx - pw, cy - r - dp(12f))
        pointer.lineTo(cx + pw, cy - r - dp(12f))
        pointer.lineTo(cx, cy - r + dp(18f))
        pointer.close()
        pointerPaint.color = theme.rim
        canvas.drawPath(pointer, pointerPaint)
    }

    /** Стрелка на оси в пустом центре кольца. */
    private fun drawArrow(canvas: Canvas, cx: Float, cy: Float, r: Float, deg: Float,
                          color: Int = theme.rim, thick: Float = 1f, hub: Boolean = true) {
        val inner = r * ringInner
        canvas.save()
        canvas.rotate(deg, cx, cy)
        val tip = cy - r * (ringInner + 0.06f) // остриё упирается в кольцо, подписи не закрывает
        val head = r * 0.16f         // длина наконечника
        val hw = r * 0.09f * thick           // полуширина наконечника
        val sw = r * 0.035f * thick          // полуширина древка
        val tail = cy + inner * 0.45f
        arrowPath.reset()
        arrowPath.moveTo(cx, tip)
        arrowPath.lineTo(cx + hw, tip + head)
        arrowPath.lineTo(cx + sw, tip + head * 0.8f)
        arrowPath.lineTo(cx + sw, tail)
        arrowPath.lineTo(cx + hw * 0.8f, tail + head * 0.45f)
        arrowPath.lineTo(cx - hw * 0.8f, tail + head * 0.45f)
        arrowPath.lineTo(cx - sw, tail)
        arrowPath.lineTo(cx - sw, tip + head * 0.8f)
        arrowPath.lineTo(cx - hw, tip + head)
        arrowPath.close()
        pointerPaint.color = color
        canvas.drawPath(arrowPath, pointerPaint)
        canvas.restore()

        if (!hub) return
        canvas.drawCircle(cx, cy, r * 0.09f, hubPaint)
        sectorPaint.color = theme.accent
        canvas.drawCircle(cx, cy, r * 0.05f, sectorPaint)
    }

    /** Дорожка вокруг колеса, ряд лунок у края колеса и шарик с тенью. */
    private fun drawBall(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val wr = r * 0.84f
        // дорожка
        hlPaint.color = theme.panel; hlPaint.strokeWidth = r * 0.16f
        canvas.drawCircle(cx, cy, r * 0.92f, hlPaint)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(2f)
        canvas.drawCircle(cx, cy, r, hlPaint)
        rimPaint.strokeWidth = dp(4f)
        canvas.drawCircle(cx, cy, wr, rimPaint)
        // лунки: тёмное кольцо у края и перегородки-«ромбики» на границах секторов
        dimPaint.color = 0x40000000
        hlPaint.color = 0x40000000; hlPaint.strokeWidth = r * 0.12f
        canvas.drawCircle(cx, cy, r * 0.76f, hlPaint)
        for (i in 0 until labels.size) {
            val a = Math.toRadians((starts[i] + rotationDeg - 90).toDouble())
            sectorPaint.color = theme.rim
            canvas.drawCircle(cx + r * 0.76f * cos(a).toFloat(), cy + r * 0.76f * sin(a).toFloat(), dp(2.5f), sectorPaint)
        }
        drawHub(canvas, cx, cy, wr)
        // шарик: тень, сам шарик, блик
        val a = Math.toRadians((cursorDeg - 90).toDouble())
        val br = r * ballRadius
        val bx = cx + br * cos(a).toFloat(); val by = cy + br * sin(a).toFloat()
        val ballR = r * 0.05f
        sectorPaint.color = 0x55000000
        canvas.drawCircle(bx + ballR * 0.25f, by + ballR * 0.35f, ballR * 1.05f, sectorPaint)
        sectorPaint.color = 0xFFF5F5F5.toInt()
        canvas.drawCircle(bx, by, ballR, sectorPaint)
        sectorPaint.color = 0x22000000
        canvas.drawCircle(bx + ballR * 0.2f, by + ballR * 0.2f, ballR * 0.75f, sectorPaint)
        sectorPaint.color = 0xCCFFFFFF.toInt()
        canvas.drawCircle(bx - ballR * 0.35f, by - ballR * 0.35f, ballR * 0.3f, sectorPaint)
    }

    /** Радар: колесо притушено, по нему бежит луч со светящимся шлейфом. */
    private fun drawRadar(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        oval.set(cx - r, cy - r, cx + r, cy + r)
        dimPaint.color = if (theme.light) 0x88FFFFFF.toInt() else 0x99000000.toInt()
        canvas.drawCircle(cx, cy, r, dimPaint)
        hlPaint.color = (theme.accent and 0x00FFFFFF) or 0x55000000; hlPaint.strokeWidth = dp(1.5f)
        for (k in 1..3) canvas.drawCircle(cx, cy, r * k / 4f, hlPaint)
        canvas.drawLine(cx - r, cy, cx + r, cy, hlPaint); canvas.drawLine(cx, cy - r, cx, cy + r, hlPaint)
        // сектор под лучом подсвечен
        val i = indexUnderPointer()
        sectorPaint.color = (colorOf(i) and 0x00FFFFFF) or 0x99000000.toInt()
        canvas.drawArc(oval, -90f + starts[i] + rotationDeg, starts[i + 1] - starts[i], true, sectorPaint)
        // шлейф: 70° позади луча, от прозрачного к яркому
        canvas.save()
        canvas.rotate(cursorDeg - 90f, cx, cy)
        val a = theme.accent and 0x00FFFFFF
        dimPaint.shader = android.graphics.SweepGradient(cx, cy,
            intArrayOf(a, a, a or 0x22000000, a or 0xAA000000.toInt()), floatArrayOf(0f, 0.8f, 0.9f, 1f))
        canvas.drawArc(oval, -70f, 70f, true, dimPaint)
        dimPaint.shader = null
        hlPaint.color = theme.accent; hlPaint.strokeWidth = dp(3f)
        canvas.drawLine(cx, cy, cx + r, cy, hlPaint)
        canvas.restore()
        sectorPaint.color = theme.accent
        canvas.drawCircle(cx, cy, dp(6f), sectorPaint)
    }

    /** Бутылочка в центре: горлышко указывает на вариант. */
    private fun drawBottle(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val inner = r * ringInner
        canvas.save()
        canvas.rotate(cursorDeg, cx, cy)
        val bw = inner * 0.36f          // полуширина корпуса
        val bodyTop = cy - inner * 0.15f
        val bodyBottom = cy + inner * 0.78f
        val neckW = bw * 0.38f
        val neckTop = cy - inner * 0.92f
        val glass = Path().apply {
            moveTo(cx - neckW, neckTop)
            lineTo(cx + neckW, neckTop)
            lineTo(cx + neckW, bodyTop - inner * 0.22f)
            quadTo(cx + bw, bodyTop - inner * 0.12f, cx + bw, bodyTop + inner * 0.05f)
            lineTo(cx + bw, bodyBottom - bw * 0.3f)
            quadTo(cx + bw, bodyBottom, cx + bw * 0.7f, bodyBottom)
            lineTo(cx - bw * 0.7f, bodyBottom)
            quadTo(cx - bw, bodyBottom, cx - bw, bodyBottom - bw * 0.3f)
            lineTo(cx - bw, bodyTop + inner * 0.05f)
            quadTo(cx - bw, bodyTop - inner * 0.12f, cx - neckW, bodyTop - inner * 0.22f)
            close()
        }
        pointerPaint.color = 0xFF2E7D32.toInt()   // бутылочное стекло
        canvas.drawPath(glass, pointerPaint)
        sectorPaint.color = 0xFF66BB6A.toInt()    // этикетка
        canvas.drawRect(cx - bw, cy + inner * 0.12f, cx + bw, cy + inner * 0.45f, sectorPaint)
        sectorPaint.color = 0x66FFFFFF            // блик
        canvas.drawRoundRect(cx - bw * 0.7f, bodyTop + inner * 0.05f, cx - bw * 0.45f, bodyBottom - inner * 0.1f,
            dp(3f), dp(3f), sectorPaint)
        sectorPaint.color = theme.accent          // крышечка
        canvas.drawRoundRect(cx - neckW * 1.15f, neckTop - inner * 0.08f, cx + neckW * 1.15f, neckTop + inner * 0.04f,
            dp(2f), dp(2f), sectorPaint)
        canvas.restore()
    }

    /** Змейка: голова — текущий сектор, за ней два затухающих хвостовых, остальные притушены. */
    private fun drawSnake(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val n = labels.size
        val head = indexUnderPointer()
        oval.set(cx - r, cy - r, cx + r, cy + r)
        val base = if (theme.light) 0x00FFFFFF else 0x00000000
        for (i in 0 until n) {
            val back = ((head - i) % n + n) % n // сколько секторов позади головы
            // хвост из двух затухающих секторов — только если вариантов хватает, иначе просто притушены
            val alpha = when {
                back == 0 -> continue
                n > 3 && back == 1 -> 0x55
                n > 3 && back == 2 -> 0x88
                else -> 0xB8
            }
            dimPaint.color = base or (alpha shl 24)
            canvas.drawArc(oval, -90f + starts[i] + rotationDeg, starts[i + 1] - starts[i], true, dimPaint)
        }
        // голова: обводка цветом акцента и светлая кромка по ободу
        hlPaint.color = theme.accent; hlPaint.strokeWidth = dp(6f)
        canvas.drawArc(oval, -90f + starts[head] + rotationDeg, starts[head + 1] - starts[head], true, hlPaint)
        rect.set(cx - r * 0.93f, cy - r * 0.93f, cx + r * 0.93f, cy + r * 0.93f)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(4f)
        canvas.drawArc(rect, -90f + starts[head] + rotationDeg + 1f, starts[head + 1] - starts[head] - 2f, false, hlPaint)
        drawHub(canvas, cx, cy, r)
    }

    /** Дротик: ждёт под колесом, летит вверх и втыкается; дальше крутится вместе с колесом. */
    private fun drawDart(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val hitR = r * 0.62f
        val waitY = min(cy + r + dp(36f), height - dp(30f))
        canvas.save()
        when (dartState) {
            2 -> {
                canvas.rotate(cursorDeg, cx, cy)
                drawDartShape(canvas, cx, cy - hitR, r * 0.38f, stuck = true)
            }
            1 -> {
                val f = dartFly * dartFly
                val y = waitY + (cy - hitR - waitY) * f
                drawDartShape(canvas, cx, y, r * (0.42f - 0.16f * f), stuck = false)
            }
            else -> drawDartShape(canvas, cx, waitY, r * 0.42f, stuck = false)
        }
        canvas.restore()
    }

    /** Дротик остриём вверх; (x, y) — остриё, [len] — длина. */
    private fun drawDartShape(canvas: Canvas, x: Float, y: Float, len: Float, stuck: Boolean) {
        val w = len * 0.11f
        // тень
        if (stuck) { sectorPaint.color = 0x55000000; canvas.drawCircle(x + dp(2f), y + dp(2f), w * 1.3f, sectorPaint) }
        // остриё
        sectorPaint.color = 0xFFCFD3DA.toInt()
        arrowPath.reset()
        arrowPath.moveTo(x, y); arrowPath.lineTo(x + w * 0.45f, y + len * 0.22f); arrowPath.lineTo(x - w * 0.45f, y + len * 0.22f); arrowPath.close()
        canvas.drawPath(arrowPath, sectorPaint)
        // корпус
        sectorPaint.color = theme.accent
        canvas.drawRoundRect(x - w, y + len * 0.22f, x + w, y + len * 0.5f, w, w, sectorPaint)
        // хвостовик
        hlPaint.color = theme.rim; hlPaint.strokeWidth = w * 0.5f
        canvas.drawLine(x, y + len * 0.5f, x, y + len * 0.86f, hlPaint)
        // оперение
        pointerPaint.color = theme.rim
        arrowPath.reset()
        arrowPath.moveTo(x, y + len * 0.66f); arrowPath.lineTo(x + w * 2.4f, y + len * 0.92f); arrowPath.lineTo(x + w * 2.2f, y + len)
        arrowPath.lineTo(x, y + len * 0.88f); arrowPath.lineTo(x - w * 2.2f, y + len); arrowPath.lineTo(x - w * 2.4f, y + len * 0.92f); arrowPath.close()
        canvas.drawPath(arrowPath, pointerPaint)
    }

    // --- Плинко -------------------------------------------------------------

    private fun plinkoBoard(cx: Float, cy: Float, r: Float) {
        rect.set(dp(10f), cy - r, width - dp(10f), cy + r)
    }

    /** Доска со штырьками; внизу лунки — их ширина пропорциональна размеру варианта. */
    private fun drawPlinko(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val n = labels.size
        plinkoBoard(cx, cy, r)
        val b = RectF(rect)
        val radius = dp(18f)
        sectorPaint.color = theme.panel
        canvas.drawRoundRect(b, radius, radius, sectorPaint)
        val slotTop = b.bottom - b.height() * 0.26f
        fun xAt(deg: Float) = b.left + deg / 360f * b.width()
        // лунки
        canvas.save()
        canvas.clipPath(Path().apply { addRoundRect(b, radius, radius, Path.Direction.CW) })
        for (i in 0 until n) {
            val l = xAt(starts[i]); val rr = xAt(starts[i + 1])
            sectorPaint.color = colorOf(i)
            canvas.drawRect(l, slotTop, rr, b.bottom, sectorPaint)
            canvas.drawLine(l, slotTop - dp(10f), l, b.bottom, linePaint)
            val wSlot = rr - l
            textPaint.color = if (isLight(colorOf(i))) 0xFF15161C.toInt() else Color.WHITE
            val h = b.bottom - slotTop
            if (wSlot >= dp(44f)) { // широкая лунка — подпись поперёк
                textPaint.textSize = min(dp(17f), wSlot * 0.3f)
                val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, wSlot - dp(8f), TextUtils.TruncateAt.END)
                canvas.drawText(t, 0, t.length, (l + rr) / 2, slotTop + h * 0.62f, textPaint)
            } else if (wSlot >= dp(12f)) { // узкая — вдоль
                textPaint.textSize = min(dp(15f), wSlot * 0.7f)
                canvas.save()
                canvas.rotate(-90f, (l + rr) / 2, slotTop + h / 2)
                val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, h - dp(10f), TextUtils.TruncateAt.END)
                canvas.drawText(t, 0, t.length, (l + rr) / 2, slotTop + h / 2 - (textPaint.ascent() + textPaint.descent()) / 2, textPaint)
                canvas.restore()
            }
        }
        canvas.restore()
        // штырьки в шахматном порядке
        val rows = 8
        val top = b.top + b.height() * 0.12f
        val rowH = (slotTop - dp(16f) - top) / (rows - 1)
        val cols = 9
        val colW = b.width() / cols
        sectorPaint.color = theme.rim
        for (row in 0 until rows) {
            val shift = if (row % 2 == 0) colW / 2 else 0f
            var x = b.left + shift + (if (shift == 0f) colW else 0f)
            while (x < b.right - colW * 0.3f) {
                canvas.drawCircle(x, top + row * rowH, dp(3.5f), sectorPaint)
                x += colW
            }
        }
        rimPaint.strokeWidth = dp(4f)
        canvas.drawRoundRect(b, radius, radius, rimPaint)
        // шарик: падает сверху с подскоками на штырьках, в конце лежит в лунке
        val p = norm(cursorDeg - rotationDeg)
        val bx = xAt(p)
        val f = if (spinning) dartFly else 1f
        val yStart = b.top + b.height() * 0.05f
        val yEnd = slotTop + (b.bottom - slotTop) * 0.25f
        val hop = dp(14f) * kotlin.math.abs(sin(Math.PI.toFloat() * rows * f)) * (1 - f)
        val by = yStart + (yEnd - yStart) * Math.pow(f.toDouble(), 1.15).toFloat() - hop
        val ballR = dp(9f)
        sectorPaint.color = 0x55000000
        canvas.drawCircle(bx + dp(2f), by + dp(3f), ballR, sectorPaint)
        sectorPaint.color = 0xFFF5F5F5.toInt()
        canvas.drawCircle(bx, by, ballR, sectorPaint)
        sectorPaint.color = 0xCCFFFFFF.toInt()
        canvas.drawCircle(bx - ballR * 0.35f, by - ballR * 0.35f, ballR * 0.3f, sectorPaint)
    }

    /** Комета летит по ободу; на скорости хвост длиннее. */
    private fun drawComet(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        drawHub(canvas, cx, cy, r)
        drawCometAt(canvas, cx, cy, r, r * 0.88f, cursorDeg, cursorSpeed)
    }

    private fun drawCometAt(canvas: Canvas, cx: Float, cy: Float, r: Float, cr: Float, deg: Float, speed: Float) {
        val tail = (speed * 6f).coerceIn(4f, 110f)
        val parts = 24
        for (k in parts downTo 0) {
            val f = k / parts.toFloat()
            val a = Math.toRadians((deg - tail * f - 90).toDouble())
            sectorPaint.color = (theme.rim and 0x00FFFFFF) or (((1 - f) * 200).toInt() shl 24)
            canvas.drawCircle(cx + cr * cos(a).toFloat(), cy + cr * sin(a).toFloat(), r * 0.05f * (1 - f * 0.8f), sectorPaint)
        }
        val a = Math.toRadians((deg - 90).toDouble())
        val hx = cx + cr * cos(a).toFloat(); val hy = cy + cr * sin(a).toFloat()
        pointerPaint.color = theme.accent
        canvas.drawCircle(hx, hy, r * 0.06f, pointerPaint)
        sectorPaint.color = 0xCCFFFFFF.toInt()
        canvas.drawCircle(hx, hy, r * 0.03f, sectorPaint)
    }

    /** Часы: стрелка прыгает с деления на деление — смотрит в середину текущего сектора. */
    private fun drawClock(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        // деления по кольцу
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(2f)
        for (k in 0 until 60) {
            val a = Math.toRadians((k * 6 - 90).toDouble())
            val r1 = r * ringInner * (if (k % 5 == 0) 0.84f else 0.9f)
            val r2 = r * ringInner * 0.97f
            canvas.drawLine(cx + r1 * cos(a).toFloat(), cy + r1 * sin(a).toFloat(),
                cx + r2 * cos(a).toFloat(), cy + r2 * sin(a).toFloat(), hlPaint)
        }
        val i = indexUnderPointer()
        val mid = starts[i] + (starts[i + 1] - starts[i]) / 2 + rotationDeg
        drawArrow(canvas, cx, cy, r, mid)
    }

    /** Все сектора притушены, светится только тот, на котором огонёк. */
    private fun drawLights(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val i = indexUnderPointer()
        val from = -90f + starts[i] + rotationDeg
        val span = starts[i + 1] - starts[i]
        oval.set(cx - r, cy - r, cx + r, cy + r)
        // затемнение остальных: весь круг, кроме светящегося сектора
        dimPaint.color = if (theme.light) 0x99FFFFFF.toInt() else 0x99000000.toInt()
        canvas.drawArc(oval, from + span, 360f - span, true, dimPaint)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(5f)
        canvas.drawArc(oval, from, span, true, hlPaint)
        // лампочки по ободу: горят у выбранного сектора
        val bulbs = 36
        for (k in 0 until bulbs) {
            val deg = k * 360f / bulbs
            val on = indexAtAngle(deg - rotationDeg) == i
            val a = Math.toRadians((deg - 90).toDouble())
            sectorPaint.color = if (on) theme.accent else theme.panel
            canvas.drawCircle(cx + r * cos(a).toFloat(), cy + r * sin(a).toFloat(), if (on) dp(5f) else dp(3.5f), sectorPaint)
        }
        drawHub(canvas, cx, cy, r)
    }

    // --- Барабан ----------------------------------------------------------------

    private fun reelWindow(cx: Float, cy: Float, r: Float) {
        val w = min(width - dp(24f), r * 1.7f)
        rect.set(cx - w / 2, cy - r, cx + w / 2, cy + r)
    }

    /** Масштаб ленты: в окне видно около пяти вариантов. */
    private fun reelPxPerDeg(win: RectF): Float {
        val visibleDeg = 360f * min(5, labels.size.coerceAtLeast(1)) / labels.size.coerceAtLeast(1)
        return win.height() / visibleDeg
    }

    /** Вертикальная лента, как в игровом автомате; выпавший вариант — на центральной линии. */
    private fun drawReel(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val n = labels.size
        reelWindow(cx, cy, r)
        val win = RectF(rect)
        val ppd = reelPxPerDeg(win)
        val s = cursorDeg - rotationDeg // угол ленты на центральной линии
        val radius = dp(18f)
        canvas.save()
        val clip = Path().apply { addRoundRect(win, radius, radius, Path.Direction.CW) }
        canvas.clipPath(clip)
        sectorPaint.color = theme.panel
        canvas.drawRect(win, sectorPaint)
        val halfDeg = win.height() / 2 / ppd
        var cycle = floor((s - halfDeg) / 360f) * 360f
        textPaint.textAlign = Paint.Align.CENTER
        while (cycle < s + halfDeg + 360f) {
            for (i in 0 until n) {
                val top = win.centerY() + (cycle + starts[i] - s) * ppd
                val bottom = win.centerY() + (cycle + starts[i + 1] - s) * ppd
                if (bottom < win.top || top > win.bottom) continue
                sectorPaint.color = colorOf(i)
                canvas.drawRect(win.left, top, win.right, bottom, sectorPaint)
                canvas.drawLine(win.left, top, win.right, top, linePaint)
                val h = bottom - top
                val size = min(h * 0.5f, dp(26f))
                if (size >= dp(8f)) {
                    textPaint.textSize = size
                    textPaint.color = if (isLight(colorOf(i))) 0xFF15161C.toInt() else Color.WHITE
                    val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, win.width() * 0.8f, TextUtils.TruncateAt.END)
                    canvas.drawText(t, 0, t.length, win.centerX(), (top + bottom) / 2 - (textPaint.ascent() + textPaint.descent()) / 2, textPaint)
                }
            }
            cycle += 360f
        }
        // затенение сверху и снизу — эффект цилиндра
        val fade = win.height() * 0.3f
        val shade = (theme.bg and 0x00FFFFFF) or 0xDD000000.toInt()
        val clear = theme.bg and 0x00FFFFFF
        fadePaint.shader = LinearGradient(0f, win.top, 0f, win.top + fade, shade, clear, Shader.TileMode.CLAMP)
        canvas.drawRect(win.left, win.top, win.right, win.top + fade, fadePaint)
        fadePaint.shader = LinearGradient(0f, win.bottom - fade, 0f, win.bottom, clear, shade, Shader.TileMode.CLAMP)
        canvas.drawRect(win.left, win.bottom - fade, win.right, win.bottom, fadePaint)
        fadePaint.shader = null
        canvas.restore()

        // рамка и центральная линия с указателями
        rimPaint.strokeWidth = dp(4f)
        canvas.drawRoundRect(win, radius, radius, rimPaint)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(2f)
        canvas.drawLine(win.left, win.centerY(), win.left + dp(14f), win.centerY(), hlPaint)
        canvas.drawLine(win.right - dp(14f), win.centerY(), win.right, win.centerY(), hlPaint)
        val pw = dp(13f)
        pointerPaint.color = theme.rim
        pointer.reset()
        pointer.moveTo(win.left - dp(6f), win.centerY() - pw)
        pointer.lineTo(win.left + dp(14f), win.centerY())
        pointer.lineTo(win.left - dp(6f), win.centerY() + pw)
        pointer.close()
        canvas.drawPath(pointer, pointerPaint)
        pointer.reset()
        pointer.moveTo(win.right + dp(6f), win.centerY() - pw)
        pointer.lineTo(win.right - dp(14f), win.centerY())
        pointer.lineTo(win.right + dp(6f), win.centerY() + pw)
        pointer.close()
        canvas.drawPath(pointer, pointerPaint)
    }

    // --- Лента (горизонтальная) -------------------------------------------------

    private fun stripWindow(cx: Float, cy: Float, r: Float) {
        val w = width - dp(16f)
        val h = min(r * 0.9f, dp(170f))
        rect.set(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    }

    /** В окне видно около трёх карточек. */
    private fun stripPxPerDeg(win: RectF): Float {
        val n = labels.size.coerceAtLeast(1)
        return win.width() / (360f * min(3, n) / n)
    }

    /** Карточки едут справа налево; выпавшая — под указателем в центре. */
    private fun drawStrip(canvas: Canvas, cx: Float, cy: Float, r: Float) {
        val n = labels.size
        stripWindow(cx, cy, r)
        val win = RectF(rect)
        val ppd = stripPxPerDeg(win)
        val s = cursorDeg - rotationDeg
        val radius = dp(18f)
        canvas.save()
        canvas.clipPath(Path().apply { addRoundRect(win, radius, radius, Path.Direction.CW) })
        sectorPaint.color = theme.panel
        canvas.drawRect(win, sectorPaint)
        val halfDeg = win.width() / 2 / ppd
        var cycle = floor((s - halfDeg) / 360f) * 360f
        val gap = dp(3f)
        while (cycle < s + halfDeg + 360f) {
            for (i in 0 until n) {
                val left = win.centerX() + (cycle + starts[i] - s) * ppd
                val right = win.centerX() + (cycle + starts[i + 1] - s) * ppd
                if (right < win.left || left > win.right) continue
                sectorPaint.color = colorOf(i)
                val card = RectF(left + gap, win.top + gap * 3, right - gap, win.bottom - gap * 3)
                canvas.drawRoundRect(card, dp(12f), dp(12f), sectorPaint)
                val size = min(card.height() * 0.22f, dp(24f))
                textPaint.textSize = size
                textPaint.color = if (isLight(colorOf(i))) 0xFF15161C.toInt() else Color.WHITE
                if (card.width() > dp(24f)) {
                    val t = TextUtils.ellipsize(labels[i].ifBlank { "—" }, textPaint, card.width() - dp(12f), TextUtils.TruncateAt.END)
                    canvas.drawText(t, 0, t.length, card.centerX(), card.centerY() - (textPaint.ascent() + textPaint.descent()) / 2, textPaint)
                }
            }
            cycle += 360f
        }
        val fade = win.width() * 0.22f
        val shade = (theme.bg and 0x00FFFFFF) or 0xDD000000.toInt()
        val clear = theme.bg and 0x00FFFFFF
        fadePaint.shader = LinearGradient(win.left, 0f, win.left + fade, 0f, shade, clear, Shader.TileMode.CLAMP)
        canvas.drawRect(win.left, win.top, win.left + fade, win.bottom, fadePaint)
        fadePaint.shader = LinearGradient(win.right - fade, 0f, win.right, 0f, clear, shade, Shader.TileMode.CLAMP)
        canvas.drawRect(win.right - fade, win.top, win.right, win.bottom, fadePaint)
        fadePaint.shader = null
        canvas.restore()
        rimPaint.strokeWidth = dp(4f)
        canvas.drawRoundRect(win, radius, radius, rimPaint)
        // указатели сверху и снизу
        val pw = dp(13f)
        pointerPaint.color = theme.rim
        pointer.reset()
        pointer.moveTo(win.centerX() - pw, win.top - dp(8f))
        pointer.lineTo(win.centerX() + pw, win.top - dp(8f))
        pointer.lineTo(win.centerX(), win.top + dp(14f))
        pointer.close()
        canvas.drawPath(pointer, pointerPaint)
        pointer.reset()
        pointer.moveTo(win.centerX() - pw, win.bottom + dp(8f))
        pointer.lineTo(win.centerX() + pw, win.bottom + dp(8f))
        pointer.lineTo(win.centerX(), win.bottom - dp(14f))
        pointer.close()
        canvas.drawPath(pointer, pointerPaint)
        hlPaint.color = theme.rim; hlPaint.strokeWidth = dp(2f)
        canvas.drawLine(win.centerX(), win.top + dp(14f), win.centerX(), win.top + dp(26f), hlPaint)
        canvas.drawLine(win.centerX(), win.bottom - dp(26f), win.centerX(), win.bottom - dp(14f), hlPaint)
    }

    private fun mix(a: Int, b: Int, f: Float): Int {
        fun ch(s: Int) = (((a shr s) and 0xFF) * (1 - f) + ((b shr s) and 0xFF) * f).toInt() shl s
        return (0xFF shl 24) or ch(16) or ch(8) or ch(0)
    }

    private fun isLight(c: Int) =
        Color.red(c) * 0.299 + Color.green(c) * 0.587 + Color.blue(c) * 0.114 > 160

    private fun dp(v: Float) = v * resources.displayMetrics.density
}
