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
 * Проекторы (вкладка PROJ) — пульты из облачной базы IrCode Finder, у каждой марки один пульт на сотни моделей:
 *  - NEC: #1803 (LT/NP/VT/MT…; тот же код у #1777, #1806, #1882), адрес 18 97, есть отдельный POWER OFF;
 *  - Epson: #1779 (EB-…, BrightLink, PowerLite; тот же код у #1783), адрес C1 AA, протокол NEC2;
 *  - InFocus: #1818 (IN1xx/IN2xxx…; тот же у #1940), адрес E1 72;
 *  - BenQ: #1759 (MX/MS/MW…) и #1764 (POWER OFF), адрес 00 0C, протокол NEC2.
 * Выключение у проекторов — с подтверждением: POWER нужно нажать два раза.
 */
class Projector(val brand: String, val source: String, val keys: List<Pair<String, Long>>)

val PROJECTORS = listOf(
    Projector("NEC", "#1803", listOf(
        "POWER" to 0x189710EFL, "OFF" to 0x189728D7L, "INPUT" to 0x18978F70L, "PIC-MUTE" to 0x1897E21DL,
        "MENU" to 0x1897629DL, "ENTER" to 0x1897E817L, "UP" to 0x18977A85L, "DOWN" to 0x1897FA05L,
        "LEFT" to 0x1897BA45L, "RIGHT" to 0x18973AC5L, "VOL-" to 0x1897926DL, "VOL+" to 0x189712EDL)),
    Projector("Epson", "#1779", listOf(
        "POWER" to 0xC1AA09F6L, "ESC" to 0xC1AA21DEL, "SOURCE" to 0xC1AA31CEL, "A/V MUTE" to 0xC1AAC936L,
        "MENU" to 0xC1AA59A6L, "ENTER" to 0xC1AAA15EL, "UP" to 0xC1AA0DF2L, "DOWN" to 0xC1AA4DB2L,
        "LEFT" to 0xC1AACD32L, "RIGHT" to 0xC1AA8D72L, "VOL-" to 0xC1AA9966L, "VOL+" to 0xC1AA19E6L)),
    Projector("InFocus", "#1818", listOf(
        "POWER" to 0xE172E817L, "BLANK" to 0xE1728C73L, "SOURCE" to 0xE17208F7L, "MUTE" to 0xE172946BL,
        "MENU" to 0xE17240BFL, "SELECT" to 0xE1724CB3L, "UP" to 0xE172C837L, "DOWN" to 0xE17228D7L,
        "LEFT" to 0xE1728877L, "RIGHT" to 0xE17248B7L, "VOL-" to 0xE17220DFL, "VOL+" to 0xE17210EFL)),
    Projector("BenQ", "#1759", listOf(
        "POWER" to 0x000C40BFL, "OFF" to 0x000C728DL, "SOURCE" to 0x000C20DFL, "ECO BLANK" to 0x000CE01FL,
        "MENU" to 0x000CF00FL, "ENTER" to 0x000C08F7L, "UP" to 0x000CD02FL, "DOWN" to 0x000C30CFL,
        "LEFT" to 0x000CB04FL, "RIGHT" to 0x000C708FL, "VOL-" to 0x000CC13EL, "VOL+" to 0x000C41BEL)),
)

/** Адреса с протоколом NEC2 (Epson, BenQ): при удержании повторяется весь кадр, а не короткий код повтора. */
val NEC2_ADDR = setOf(0xC1AA, 0x000C)

/**
 * «Рулетка»: адреса NEC, которые перебираются по очереди (по 256 команд на адрес).
 * Первым — 04 FB (MocTec), дальше — адреса, частые у китайских панелей и пультов.
 */
val ROULETTE_ADDR = intArrayOf(0x04FB, 0x807F, 0x00FF, 0x01FE, 0x02FD, 0x03FC, 0x08F7, 0x10EF, 0x40BF, 0x7F80)

/** При удержании этих кнопок шлются NEC-повторы, как у настоящего пульта. */
val REPEATABLE = setOf("VOL-", "VOL+", "J DOWN", "J LEFT", "J RIGHT", "J UP", "UP", "DOWN", "LEFT", "RIGHT")

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
