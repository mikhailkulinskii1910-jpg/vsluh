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
 * (бренд MOSTEH, #500275), NEC, адрес 04 FB — все 52 кнопки. Те же коды дала расшифровка файлов Delly Changer «МОСТЕХ».
 * RED (04FB 3AC5) — переключатель блокировки экрана и кнопок доски.
 */
val MOC_KEYS = listOf(
    "POWER" to 0x04FB4AB5L, "INPUT" to 0x04FBE01FL, "HOME" to 0x04FB12EDL,
    "BACK" to 0x04FB50AFL, "MENU" to 0x04FBB04FL, "J OK" to 0x04FB52ADL,
    "J UP" to 0x04FBE21DL, "J DOWN" to 0x04FBB24DL, "J LEFT" to 0x04FB926DL,
    "J RIGHT" to 0x04FBD22DL, "VOL-" to 0x04FB827DL, "VOL+" to 0x04FBC03FL,
    "MUTE" to 0x04FBCA35L, "EMPTY SCREEN" to 0x04FB728DL, "ALT+F4" to 0x04FBF807L, "PAGE UP" to 0x04FB42BDL,
    "PAGE DOWN" to 0x04FBF00FL, "1" to 0x04FB00FFL, "2" to 0x04FB08F7L,
    "3" to 0x04FB8877L, "4" to 0x04FBC837L, "5" to 0x04FB28D7L,
    "6" to 0x04FBA857L, "7" to 0x04FBE817L, "8" to 0x04FB18E7L,
    "9" to 0x04FB9867L, "DISPLAY" to 0x04FB38C7L, "0" to 0x04FBD827L,
    "BACKSPACE" to 0x04FB02FDL, "CH+" to 0x04FB40BFL, "CH-" to 0x04FB906FL,
    "NOTE" to 0x04FB609FL, "RED" to 0x04FB3AC5L, "GREEN" to 0x04FBBA45L,
    "YELLOW" to 0x04FB7A85L, "BLUE" to 0x04FBFA05L, "SPACE" to 0x04FB629DL,
    "WIN" to 0x04FBD02FL, "FN" to 0x04FB32CDL, "ALT+TAB" to 0x04FBB847L,
    "F1" to 0x04FBA25DL, "F2" to 0x04FB48B7L,
    "F3" to 0x04FB8A75L, "F4" to 0x04FBDA25L, "F5" to 0x04FB22DDL,
    "F6" to 0x04FB0AF5L, "F7" to 0x04FBC23DL, "F8" to 0x04FB58A7L,
    "F9" to 0x04FB20DFL, "F10" to 0x04FB9A65L, "F11" to 0x04FBEA15L,
    "F12" to 0x04FB10EFL
)

/**
 * Проекторы (вкладка «Проекторы») — все кнопки пультов из облачной базы IrCode Finder; пульты одной марки
 * объединены (дубли кодов убраны), сначала основные кнопки, потом остальные:
 *  - NEC: #1803, #1777, #1806, #1882 (LT/NP/VT/MT…), адрес 18 97, есть отдельный POWER OFF;
 *  - Epson: #1779, #1783 (EB-…, BrightLink, PowerLite), адрес C1 AA, протокол NEC2;
 *  - InFocus: #1818, #1940 (IN1xx/IN2xxx…), адрес E1 72;
 *  - BenQ: #1759, #1764 (MX/MS/MW…), адрес 00 0C, протокол NEC2.
 * Выключение у проекторов — с подтверждением: POWER нужно нажать два раза.
 */
class Projector(val brand: String, val source: String, val keys: List<Pair<String, Long>>, val main: Int)

/** Основные кнопки MocTec (первые 15, вместе с ALT+F4); остальные — в меню «доп.». */
const val MOC_MAIN = 15

val PROJECTORS = listOf(
    Projector("NEC", "#1803, #1777, #1806, #1882", listOf(
        "POWER" to 0x189710EFL, "POWER OFF" to 0x189728D7L, "INPUT" to 0x18978F70L, "PIC-MUTE" to 0x1897E21DL,
        "MENU" to 0x1897629DL, "ENTER" to 0x1897E817L, "EXIT" to 0x1897A45BL, "UP" to 0x18977A85L,
        "DOWN" to 0x1897FA05L, "LEFT" to 0x1897BA45L, "RIGHT" to 0x18973AC5L, "VOL-" to 0x1897926DL,
        "VOL+" to 0x189712EDL, "ASPECT" to 0x189708F7L, "AUTO ADJ." to 0x1897609FL, "COMPUTER" to 0x1897CA35L,
        "DOWN 2" to 0x18973DC2L, "FOCUS" to 0x189745BAL, "MAGNIFY-" to 0x189751AEL, "MAGNIFY+" to 0x1897916EL,
        "FREEZE" to 0x189732CDL, "HELP" to 0x1897728DL, "INPUT PC1" to 0x189720DFL, "INPUT PC2" to 0x1897A05FL,
        "INPUT VIEWER" to 0x189731CEL, "KEYSTONE UP" to 0x1897D12EL, "LAMP MODE" to 0x18976897L, "LEFT 2" to 0x18977D82L,
        "LEFT CLICK" to 0x189734CBL, "NOISE RED." to 0x18973CC3L, "PAGE DOWN" to 0x1897D42BL, "PAGE UP" to 0x189754ABL,
        "PC CARD" to 0x1897E41BL, "PICTURE" to 0x1897B04FL, "RIGHT 2" to 0x18975DA2L, "RIGHT CLICK" to 0x1897B44BL,
        "S-VIDEO" to 0x1897639CL, "TIMER" to 0x1897BC43L, "UP 2" to 0x18971DE2L, "VIDEO" to 0x1897C03FL,
        "INPUT NEXT 2" to 0x1897B24DL, "FOLDER LIST" to 0x18975FA0L, "INPUT COMPUTER 3" to 0x1897AA55L, "INPUT LAN" to 0x18976A95L,
        "PJ" to 0x189749B6L, "POINTER" to 0x1897649BL, "POS DOWN" to 0x1897FB04L, "POS DOWN LEFT" to 0x189724DBL,
        "POS DOWN RIGHT" to 0x1897C43BL, "POS LEFT" to 0x1897BB44L, "POS RIGHT" to 0x18973BC4L, "POS UP" to 0x18977B84L,
        "POS UP LEFT" to 0x189744BBL, "POS UP RIGHT" to 0x1897847BL, "SLIDE-" to 0x189704FBL, "SLIDE+" to 0x1897D22DL), main = 13),
    Projector("Epson", "#1779, #1783", listOf(
        "POWER" to 0xC1AA09F6L, "SOURCE SEARCH" to 0xC1AA31CEL, "A/V MUTE" to 0xC1AAC936L, "MENU" to 0xC1AA59A6L,
        "ENTER" to 0xC1AAA15EL, "ESC" to 0xC1AA21DEL, "UP" to 0xC1AA0DF2L, "DOWN" to 0xC1AA4DB2L,
        "LEFT" to 0xC1AACD32L, "RIGHT" to 0xC1AA8D72L, "VOL-" to 0xC1AA9966L, "VOL+" to 0xC1AA19E6L,
        "0 / PEN MODE" to 0xC1AA05FAL, "1 / SCREEN FIT" to 0xC1AA857AL, "2" to 0xC1AA45BAL, "3 / 2D/3D" to 0xC1AAC53AL,
        "FOCUS LEFT" to 0xC1AA25DAL, "FOCUS RIGHT" to 0xC1AAA55AL, "6 / MHL" to 0xC1AA659AL, "AUTO" to 0xC1AA7986L,
        "ASPECT" to 0xC1AA51AEL, "COLOR MODE" to 0xC1AAF10EL, "E-ZOOM -" to 0xC1AA916EL, "E-ZOOM +" to 0xC1AA11EEL,
        "FREEZE" to 0xC1AA49B6L, "HELP" to 0xC1AAA956L, "ID" to 0xC1AA8C73L, "INPUT COMPUTER" to 0xC1AA29D6L,
        "HDMI/VIDEO" to 0xC1AA0EF1L, "INPUT LAN" to 0xC1AA2ED1L, "INPUT USB" to 0xC1AA6E91L, "PAGE DOWN" to 0xC1AAE11EL,
        "PAGE UP" to 0xC1AA619EL, "POINTER" to 0xC1AAD926L, "SPLIT" to 0xC1AA41BEL, "USER" to 0xC1AAF906L,
        "INPUT HDMI" to 0xC1AACE31L, "INPUT S-VIDEO" to 0xC1AA39C6L, "POINTER 2" to 0xC1AA956AL), main = 12),
    Projector("InFocus", "#1818, #1940", listOf(
        "POWER" to 0xE172E817L, "SOURCE" to 0xE17208F7L, "MUTE" to 0xE172946BL, "BLANK" to 0xE1728C73L,
        "MENU" to 0xE17240BFL, "SELECT" to 0xE1724CB3L, "ESC" to 0xE1720AF5L, "UP" to 0xE172C837L,
        "DOWN" to 0xE17228D7L, "LEFT" to 0xE1728877L, "RIGHT" to 0xE17248B7L, "VOL-" to 0xE17220DFL,
        "VOL+" to 0xE17210EFL, "AUTO IMAGE" to 0xE172CC33L, "CUSTOM" to 0xE172D42BL, "FREEZE" to 0xE172708FL,
        "HELP" to 0xE17250AFL, "INPUT SOURCE 1" to 0xE172B44BL, "INPUT SOURCE 2" to 0xE172748BL, "INPUT SOURCE 3" to 0xE172F40BL,
        "KEYSTONE DOWN" to 0xE172847BL, "KEYSTONE UP" to 0xE17204FBL, "PREVIOUS" to 0xE172A45BL, "MAGNIFY-" to 0xE172CA35L,
        "MAGNIFY+" to 0xE1724AB5L, "OVERSCAN" to 0xE172AC53L, "PC" to 0xE1729867L, "PRESET" to 0xE17234CBL,
        "RESIZE" to 0xE1722CD3L, "NEXT" to 0xE17224DBL, "VIDEO" to 0xE17258A7L, "MOUSE LEFT CLICK" to 0xE17230CFL,
        "MOUSE RIGHT CLICK" to 0xE172D02FL, "SOURCE 4" to 0xE1720CF3L), main = 13),
    Projector("BenQ", "#1759, #1764", listOf(
        "POWER" to 0x000C40BFL, "POWER ON" to 0x000CF20DL, "POWER OFF" to 0x000C728DL, "SOURCE" to 0x000C20DFL,
        "MUTE" to 0x000C28D7L, "ECO BLANK" to 0x000CE01FL, "MENU" to 0x000CF00FL, "ENTER" to 0x000C08F7L,
        "UP" to 0x000CD02FL, "DOWN" to 0x000C30CFL, "LEFT" to 0x000CB04FL, "RIGHT" to 0x000C708FL,
        "VOL-" to 0x000CC13EL, "VOL+" to 0x000C41BEL, "3D" to 0x000CB14EL, "3D INVERT" to 0x000CB946L,
        "ASPECT" to 0x000CC837L, "AUTO" to 0x000C10EFL, "BRIGHTNESS" to 0x000C6897L, "COLOR" to 0x000C9E61L,
        "CONTRAST" to 0x000C8877L, "DIGITAL ZOOM -" to 0x000C9867L, "DIGITAL ZOOM +" to 0x000C18E7L, "FREEZE" to 0x000CC03FL,
        "INFO" to 0x000C00FFL, "KEYSTON DOWN" to 0x000C906FL, "KEYSTON UP" to 0x000C50AFL, "PAGE DOWN" to 0x000C609FL,
        "PAGE UP" to 0x000CA05FL, "SMART ECO" to 0x000C0CF3L, "TEST" to 0x000C29D6L, "TIMER ON" to 0x000CA45BL,
        "TIMER SET UP" to 0x000C649BL, "TINT" to 0x000C5EA1L, "CAPTURE" to 0x000C7887L, "COLOR TEMP" to 0x000CFA05L,
        "FINE TUNE" to 0x000CBA45L, "INPUT COMPONENT" to 0x000C8A75L, "INPUT COMPUTER 1" to 0x000C827DL, "INPUT COMPUTER 2" to 0x000CA25DL,
        "INPUT HDMI" to 0x000C1AE5L, "INPUT HDMI 2" to 0x000C9A65L, "INPUT NETWORK" to 0x000C629DL, "INPUT S-VIDEO" to 0x000CF807L,
        "INPUT VIDEO" to 0x000C4AB5L, "NETWORK SETTING" to 0x000C817EL, "PIP" to 0x000CD827L, "SHARP" to 0x000C7E81L,
        "SRS" to 0x000C9966L, "USER1" to 0x000CAE51L, "USER2" to 0x000C6E91L, "USER3" to 0x000CEE11L), main = 14),
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
