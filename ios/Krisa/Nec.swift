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

/// Пульт проектора из облачной базы IrCode Finder (NEC 38 кГц, 32 бита MSB-first).
struct ProjBrand {
    let name: String
    /// Номер пульта в базе IrCode Finder.
    let remoteNo: String
    let keys: [(label: String, code: UInt32)]
}

/// Вкладка PROJ: пульты проекторов NEC, Epson, InFocus, BenQ. Порядок кнопок — как на экране.
let PROJ_BRANDS: [ProjBrand] = [
    ProjBrand(name: "NEC", remoteNo: "#1803", keys: [
        ("POWER", 0x189710EF), ("OFF", 0x189728D7),
        ("INPUT", 0x18978F70), ("PIC-MUTE", 0x1897E21D),
        ("MENU", 0x1897629D), ("ENTER", 0x1897E817),
        ("UP", 0x18977A85), ("DOWN", 0x1897FA05),
        ("LEFT", 0x1897BA45), ("RIGHT", 0x18973AC5),
        ("VOL-", 0x1897926D), ("VOL+", 0x189712ED),
    ]),
    ProjBrand(name: "Epson", remoteNo: "#1779", keys: [
        ("POWER", 0xC1AA09F6), ("ESC", 0xC1AA21DE),
        ("SOURCE", 0xC1AA31CE), ("A/V MUTE", 0xC1AAC936),
        ("MENU", 0xC1AA59A6), ("ENTER", 0xC1AAA15E),
        ("UP", 0xC1AA0DF2), ("DOWN", 0xC1AA4DB2),
        ("LEFT", 0xC1AACD32), ("RIGHT", 0xC1AA8D72),
        ("VOL-", 0xC1AA9966), ("VOL+", 0xC1AA19E6),
    ]),
    ProjBrand(name: "InFocus", remoteNo: "#1818", keys: [
        ("POWER", 0xE172E817), ("BLANK", 0xE1728C73),
        ("SOURCE", 0xE17208F7), ("MUTE", 0xE172946B),
        ("MENU", 0xE17240BF), ("SELECT", 0xE1724CB3),
        ("UP", 0xE172C837), ("DOWN", 0xE17228D7),
        ("LEFT", 0xE1728877), ("RIGHT", 0xE17248B7),
        ("VOL-", 0xE17220DF), ("VOL+", 0xE17210EF),
    ]),
    ProjBrand(name: "BenQ", remoteNo: "#1759", keys: [
        ("POWER", 0x000C40BF), ("OFF", 0x000C728D),
        ("SOURCE", 0x000C20DF), ("ECO BLANK", 0x000CE01F),
        ("MENU", 0x000CF00F), ("ENTER", 0x000C08F7),
        ("UP", 0x000CD02F), ("DOWN", 0x000C30CF),
        ("LEFT", 0x000CB04F), ("RIGHT", 0x000C708F),
        ("VOL-", 0x000CC13E), ("VOL+", 0x000C41BE),
    ]),
]

/// При удержании этих кнопок шлются NEC-повторы, как у настоящего пульта.
let REPEATABLE: Set<String> = ["VOL-", "VOL+", "J DOWN", "J LEFT", "J RIGHT", "J UP", "UP", "DOWN", "LEFT", "RIGHT"]

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

    /// NEC2 (Epson C1AA, BenQ 000C): при удержании повторяется весь кадр, а не короткий код повтора.
    static func repeatsFullFrame(_ code: UInt32) -> Bool {
        let address: UInt32 = code >> 16
        return address == 0xC1AA || address == 0x000C
    }

    /// Код повтора, который пульт шлёт каждые 108 мс, пока кнопка зажата.
    static let repeatCode = [16 * t, 4 * t, t]

    /// Сигнал с завершающей паузой до конца периода 108 мс.
    static func withGap(_ p: [Int]) -> [Int] {
        p + [max(framePeriodMs * 1000 - p.reduce(0, +), 10_000)]
    }
}
