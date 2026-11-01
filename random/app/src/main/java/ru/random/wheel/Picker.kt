package ru.random.wheel

/**
 * Выбор сектора. Без подкрутки шанс = доля сектора на колесе (размер / сумма размеров).
 * С подкруткой решают скрытые значения 0–100%, а размер сектора служит множителем.
 */
object Picker {
    /**
     * Итоговые вероятности (сумма 1). [sizes] — размеры секторов (пусто — все 1).
     * С подкруткой: 100% — выпадает всегда (если таких несколько — только они, по их размерам);
     * 0% — не выпадает никогда; остальные — шанс пропорционален значению × размер.
     * Если у всех 0%, выбирать не из чего — тогда как без подкрутки.
     */
    fun probabilities(chances: List<Int>, rigged: Boolean, sizes: List<Int> = emptyList()): DoubleArray {
        val n = chances.size
        if (n == 0) return DoubleArray(0)
        val c = chances.map { it.coerceIn(0, 100) }
        val w = DoubleArray(n) { (sizes.getOrNull(it) ?: 1).coerceAtLeast(1).toDouble() }
        fun norm(x: DoubleArray): DoubleArray { val s = x.sum(); return DoubleArray(n) { x[it] / s } }
        if (!rigged) return norm(w)
        if (c.any { it == 100 }) return norm(DoubleArray(n) { if (c[it] == 100) w[it] else 0.0 })
        if (c.all { it == 0 }) return norm(w)
        return norm(DoubleArray(n) { c[it] * w[it] })
    }

    /** [r] — случайное число из [0, 1). Возвращает индекс выпавшего варианта. */
    fun pick(chances: List<Int>, rigged: Boolean, r: Double, sizes: List<Int> = emptyList()): Int {
        val p = probabilities(chances, rigged, sizes)
        var acc = 0.0
        var last = 0
        for (i in p.indices) {
            if (p[i] <= 0.0) continue
            last = i
            acc += p[i]
            if (r < acc) return i
        }
        return last // погрешность округления: r почти 1
    }
}
