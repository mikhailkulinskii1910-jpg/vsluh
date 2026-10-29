package ru.random.wheel

/** Выбор сектора с учётом подкрутки. Сектора на колесе всегда одинаковые — меняется только вероятность. */
object Picker {
    /**
     * Итоговые вероятности (сумма 1). Без подкрутки или если у всех 0 — всем поровну;
     * иначе шанс варианта = его значение (0–100) / сумма значений.
     */
    fun probabilities(chances: List<Int>, rigged: Boolean): DoubleArray {
        val n = chances.size
        if (n == 0) return DoubleArray(0)
        val sum = chances.sumOf { it.coerceIn(0, 100) }
        if (!rigged || sum == 0) return DoubleArray(n) { 1.0 / n }
        return DoubleArray(n) { chances[it].coerceIn(0, 100).toDouble() / sum }
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
