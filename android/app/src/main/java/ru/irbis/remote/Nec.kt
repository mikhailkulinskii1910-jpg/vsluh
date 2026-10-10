package ru.irbis.remote

/** Кнопки пульта IRBIS #500202 из базы IrCode Finder (протокол NEC, 38 кГц). Порядок — как на экране. */
val KEYS = listOf(
    "POWER" to 0x807F18E7, "VOL-" to 0x807F08F7,
    "VOL+" to 0x807F28D7, "MENU" to 0x807F02FD,
    "EMPY SCREEN" to 0x807F20DF, "FREEZE" to 0x807F48B7,
    "INPUT" to 0x807FB04F, "J DOWN" to 0x807F6897,
    "J LEFT" to 0x807FE21D, "J OK" to 0x807FAA55,
    "J RIGHT" to 0x807FA857, "J UP" to 0x807F629D,
)

/**
 * Доски MocTec / «МОСТЕХ»: пульт «Interactive Board RC 52 Key» из облачной базы IrCode Finder
 * (бренд MOSTEH, #500275), NEC, адрес 04 FB. Те же коды дала расшифровка файлов Delly Changer «МОСТЕХ».
 */
val MOC_KEYS = listOf(
    "POWER" to 0x04FB4AB5L, "J OK" to 0x04FB52ADL,
    "VOL-" to 0x04FB827DL, "VOL+" to 0x04FBC03FL,
    "EMPTY SCREEN" to 0x04FB728DL, "INPUT" to 0x04FBE01FL,
    "J UP" to 0x04FBE21DL, "J DOWN" to 0x04FBB24DL,
    "J LEFT" to 0x04FB926DL, "J RIGHT" to 0x04FBD22DL,
    "HOME" to 0x04FB12EDL, "BACK" to 0x04FB50AFL,
)

/**
 * «Рулетка»: адреса NEC, которые перебираются по очереди (по 256 команд на адрес).
 * Первым — 04 FB (MocTec), дальше — адреса, частые у китайских панелей и пультов.
 */
val ROULETTE_ADDR = intArrayOf(0x04FB, 0x807F, 0x00FF, 0x01FE, 0x02FD, 0x03FC, 0x08F7, 0x10EF, 0x40BF, 0x7F80)

/** При удержании этих кнопок шлются NEC-повторы, как у настоящего пульта. */
val REPEATABLE = setOf("VOL-", "VOL+", "J DOWN", "J LEFT", "J RIGHT", "J UP")

object Nec {
    const val CARRIER = 38000
    const val FRAME_PERIOD_MS = 108L
    private const val T = 562

    /** Кадр NEC в микросекундах: метка, пауза, метка, … (старший бит первым, как в IrCode Finder). */
    fun frame(code: Long): IntArray {
        val d = ArrayList<Int>(68)
        d += 16 * T; d += 8 * T
        for (i in 31 downTo 0) {
            d += T
            d += if ((code ushr i) and 1L == 1L) 3 * T else T
        }
        d += T
        return d.toIntArray()
    }

    /** Код повтора, который пульт шлёт каждые 108 мс, пока кнопка зажата. */
    val REPEAT = intArrayOf(16 * T, 4 * T, T)

    /** Тот же сигнал с завершающей паузой до конца периода 108 мс. */
    fun withGap(pattern: IntArray): IntArray {
        val gap = (FRAME_PERIOD_MS * 1000 - pattern.sum()).toInt().coerceAtLeast(10_000)
        return pattern + gap
    }
}
