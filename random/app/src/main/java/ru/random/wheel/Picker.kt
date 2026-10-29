package ru.random.wheel

/** Выбор сектора с учётом подкрутки. Сектора на колесе всегда одинаковые — меняется только вероятность. */
object Picker {
    /**
     * Итоговые вероятности (сумма 1). Без подкрутки — всем поровну. С подкруткой:
     * 100% — выпадает всегда (если таких несколько — только они, поровну между собой);
     * 0% — не выпадает никогда; остальные значения — шанс пропорционален значению.
     * Если у всех 0%, выбирать не из чего — тогда всем поровну.
     */
    fun probabilities(chances: List<Int>, rigged: Boolean): DoubleArray {
        val n = chances.size
        if (n == 0) return DoubleArray(0)
        val c = chances.map { it.coerceIn(0, 100) }
        if (!rigged) return DoubleArray(n) { 1.0 / n }
        val sure = c.count { it == 100 }
        if (sure > 0) return DoubleArray(n) { if (c[it] == 100) 1.0 / sure else 0.0 }
        val sum = c.sum()
        if (sum == 0) return DoubleArray(n) { 1.0 / n }
        return DoubleArray(n) { c[it].toDouble() / sum }
    }

    /** [r] — случайное число из [0, 1). Возвращает индекс выпавшего варианта. */
    fun pick(chances: List<Int>, rigged: Boolean, r: Double): Int {
        val p = probabilities(chances, rigged)
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
