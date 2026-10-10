import Foundation

/// Кнопки пульта IRBIS #500202 из базы IrCode Finder (протокол NEC, 38 кГц). Порядок — как на экране.
let KEYS: [(label: String, code: UInt32)] = [
    ("POWER", 0x807F18E7), ("VOL-", 0x807F08F7),
    ("VOL+", 0x807F28D7), ("MENU", 0x807F02FD),
    ("EMPY SCREEN", 0x807F20DF), ("FREEZE", 0x807F48B7),
    ("INPUT", 0x807FB04F), ("J DOWN", 0x807F6897),
    ("J LEFT", 0x807FE21D), ("J OK", 0x807FAA55),
    ("J RIGHT", 0x807FA857), ("J UP", 0x807F629D),
]

/// Доски MocTec / «МОСТЕХ»: пульт «Interactive Board RC 52 Key» из облачной базы IrCode Finder
/// (бренд MOSTEH, #500275), NEC, адрес 04 FB. Те же коды дала расшифровка файлов Delly Changer «МОСТЕХ».
let MOC_KEYS: [(label: String, code: UInt32)] = [
    ("POWER", 0x04FB4AB5), ("J OK", 0x04FB52AD),
    ("VOL-", 0x04FB827D), ("VOL+", 0x04FBC03F),
    ("EMPTY SCREEN", 0x04FB728D), ("INPUT", 0x04FBE01F),
    ("J UP", 0x04FBE21D), ("J DOWN", 0x04FBB24D),
    ("J LEFT", 0x04FB926D), ("J RIGHT", 0x04FBD22D),
    ("HOME", 0x04FB12ED), ("BACK", 0x04FB50AF),
]

/// При удержании этих кнопок шлются NEC-повторы, как у настоящего пульта.
let REPEATABLE: Set<String> = ["VOL-", "VOL+", "J DOWN", "J LEFT", "J RIGHT", "J UP"]

enum Nec {
    static let carrier = 38_000
    static let framePeriodMs = 108
    private static let t = 562

    /// Кадр NEC в микросекундах: метка, пауза, метка, … (старший бит первым, как в IrCode Finder).
    static func frame(_ code: UInt32) -> [Int] {
        var d = [16 * t, 8 * t]
        for i in stride(from: 31, through: 0, by: -1) {
            d.append(t)
            d.append((code >> UInt32(i)) & 1 == 1 ? 3 * t : t)
        }
        d.append(t)
        return d
    }

    /// Код повтора, который пульт шлёт каждые 108 мс, пока кнопка зажата.
    static let repeatCode = [16 * t, 4 * t, t]

    /// Сигнал с завершающей паузой до конца периода 108 мс.
    static func withGap(_ p: [Int]) -> [Int] {
        p + [max(framePeriodMs * 1000 - p.reduce(0, +), 10_000)]
    }
}
