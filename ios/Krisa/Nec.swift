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
/// (бренд MOSTEH, #500275), NEC, адрес 04 FB — все 52 кнопки. Те же коды дала расшифровка файлов Delly Changer «МОСТЕХ».
let MOC_KEYS: [(label: String, code: UInt32)] = [
    ("POWER", 0x04FB4AB5), ("INPUT", 0x04FBE01F), ("HOME", 0x04FB12ED),
    ("BACK", 0x04FB50AF), ("MENU", 0x04FBB04F), ("J OK", 0x04FB52AD),
    ("J UP", 0x04FBE21D), ("J DOWN", 0x04FBB24D), ("J LEFT", 0x04FB926D),
    ("J RIGHT", 0x04FBD22D), ("VOL-", 0x04FB827D), ("VOL+", 0x04FBC03F),
    ("MUTE", 0x04FBCA35), ("EMPTY SCREEN", 0x04FB728D), ("PAGE UP", 0x04FB42BD),
    ("PAGE DOWN", 0x04FBF00F), ("1", 0x04FB00FF), ("2", 0x04FB08F7),
    ("3", 0x04FB8877), ("4", 0x04FBC837), ("5", 0x04FB28D7),
    ("6", 0x04FBA857), ("7", 0x04FBE817), ("8", 0x04FB18E7),
    ("9", 0x04FB9867), ("DISPLAY", 0x04FB38C7), ("0", 0x04FBD827),
    ("BACKSPACE", 0x04FB02FD), ("CH+", 0x04FB40BF), ("CH-", 0x04FB906F),
    ("NOTE", 0x04FB609F), ("RED", 0x04FB3AC5), ("GREEN", 0x04FBBA45),
    ("YELLOW", 0x04FB7A85), ("BLUE", 0x04FBFA05), ("SPACE", 0x04FB629D),
    ("WIN", 0x04FBD02F), ("FN", 0x04FB32CD), ("ALT+TAB", 0x04FBB847),
    ("ALT+F4", 0x04FBF807), ("F1", 0x04FBA25D), ("F2", 0x04FB48B7),
    ("F3", 0x04FB8A75), ("F4", 0x04FBDA25), ("F5", 0x04FB22DD),
    ("F6", 0x04FB0AF5), ("F7", 0x04FBC23D), ("F8", 0x04FB58A7),
    ("F9", 0x04FB20DF), ("F10", 0x04FB9A65), ("F11", 0x04FBEA15),
    ("F12", 0x04FB10EF),
]

/// Пульт проектора из облачной базы IrCode Finder (NEC 38 кГц, 32 бита MSB-first).
struct ProjBrand {
    let name: String
    /// Номера пультов в базе IrCode Finder.
    let remoteNo: String
    let keys: [(label: String, code: UInt32)]
}

/// Вкладка «Проекторы»: все кнопки пультов NEC, Epson, InFocus, BenQ из IrCode Finder
/// (пульты марки объединены, дубли кодов убраны; сначала основные кнопки, потом остальные).
let PROJ_NEC: [(label: String, code: UInt32)] = [
    ("POWER", 0x189710EF), ("POWER OFF", 0x189728D7),
    ("INPUT", 0x18978F70), ("PIC-MUTE", 0x1897E21D),
    ("MENU", 0x1897629D), ("ENTER", 0x1897E817),
    ("EXIT", 0x1897A45B), ("UP", 0x18977A85),
    ("DOWN", 0x1897FA05), ("LEFT", 0x1897BA45),
    ("RIGHT", 0x18973AC5), ("VOL-", 0x1897926D),
    ("VOL+", 0x189712ED), ("ASPECT", 0x189708F7),
    ("AUTO ADJ.", 0x1897609F), ("COMPUTER", 0x1897CA35),
    ("DOWN 2", 0x18973DC2), ("FOCUS", 0x189745BA),
    ("MAGNIFY-", 0x189751AE), ("MAGNIFY+", 0x1897916E),
    ("FREEZE", 0x189732CD), ("HELP", 0x1897728D),
    ("INPUT PC1", 0x189720DF), ("INPUT PC2", 0x1897A05F),
    ("INPUT VIEWER", 0x189731CE), ("KEYSTONE UP", 0x1897D12E),
    ("LAMP MODE", 0x18976897), ("LEFT 2", 0x18977D82),
    ("LEFT CLICK", 0x189734CB), ("NOISE RED.", 0x18973CC3),
    ("PAGE DOWN", 0x1897D42B), ("PAGE UP", 0x189754AB),
    ("PC CARD", 0x1897E41B), ("PICTURE", 0x1897B04F),
    ("RIGHT 2", 0x18975DA2), ("RIGHT CLICK", 0x1897B44B),
    ("S-VIDEO", 0x1897639C), ("TIMER", 0x1897BC43),
    ("UP 2", 0x18971DE2), ("VIDEO", 0x1897C03F),
    ("INPUT NEXT 2", 0x1897B24D), ("FOLDER LIST", 0x18975FA0),
    ("INPUT COMPUTER 3", 0x1897AA55), ("INPUT LAN", 0x18976A95),
    ("PJ", 0x189749B6), ("POINTER", 0x1897649B),
    ("POS DOWN", 0x1897FB04), ("POS DOWN LEFT", 0x189724DB),
    ("POS DOWN RIGHT", 0x1897C43B), ("POS LEFT", 0x1897BB44),
    ("POS RIGHT", 0x18973BC4), ("POS UP", 0x18977B84),
    ("POS UP LEFT", 0x189744BB), ("POS UP RIGHT", 0x1897847B),
    ("SLIDE-", 0x189704FB), ("SLIDE+", 0x1897D22D),
]

let PROJ_EPSON: [(label: String, code: UInt32)] = [
    ("POWER", 0xC1AA09F6), ("SOURCE SEARCH", 0xC1AA31CE),
    ("A/V MUTE", 0xC1AAC936), ("MENU", 0xC1AA59A6),
    ("ENTER", 0xC1AAA15E), ("ESC", 0xC1AA21DE),
    ("UP", 0xC1AA0DF2), ("DOWN", 0xC1AA4DB2),
    ("LEFT", 0xC1AACD32), ("RIGHT", 0xC1AA8D72),
    ("VOL-", 0xC1AA9966), ("VOL+", 0xC1AA19E6),
    ("0 / PEN MODE", 0xC1AA05FA), ("1 / SCREEN FIT", 0xC1AA857A),
    ("2", 0xC1AA45BA), ("3 / 2D/3D", 0xC1AAC53A),
    ("FOCUS LEFT", 0xC1AA25DA), ("FOCUS RIGHT", 0xC1AAA55A),
    ("6 / MHL", 0xC1AA659A), ("AUTO", 0xC1AA7986),
    ("ASPECT", 0xC1AA51AE), ("COLOR MODE", 0xC1AAF10E),
    ("E-ZOOM -", 0xC1AA916E), ("E-ZOOM +", 0xC1AA11EE),
    ("FREEZE", 0xC1AA49B6), ("HELP", 0xC1AAA956),
    ("ID", 0xC1AA8C73), ("INPUT COMPUTER", 0xC1AA29D6),
    ("HDMI/VIDEO", 0xC1AA0EF1), ("INPUT LAN", 0xC1AA2ED1),
    ("INPUT USB", 0xC1AA6E91), ("PAGE DOWN", 0xC1AAE11E),
    ("PAGE UP", 0xC1AA619E), ("POINTER", 0xC1AAD926),
    ("SPLIT", 0xC1AA41BE), ("USER", 0xC1AAF906),
    ("INPUT HDMI", 0xC1AACE31), ("INPUT S-VIDEO", 0xC1AA39C6),
    ("POINTER 2", 0xC1AA956A),
]

let PROJ_INFOCUS: [(label: String, code: UInt32)] = [
    ("POWER", 0xE172E817), ("SOURCE", 0xE17208F7),
    ("MUTE", 0xE172946B), ("BLANK", 0xE1728C73),
    ("MENU", 0xE17240BF), ("SELECT", 0xE1724CB3),
    ("ESC", 0xE1720AF5), ("UP", 0xE172C837),
    ("DOWN", 0xE17228D7), ("LEFT", 0xE1728877),
    ("RIGHT", 0xE17248B7), ("VOL-", 0xE17220DF),
    ("VOL+", 0xE17210EF), ("AUTO IMAGE", 0xE172CC33),
    ("CUSTOM", 0xE172D42B), ("FREEZE", 0xE172708F),
    ("HELP", 0xE17250AF), ("INPUT SOURCE 1", 0xE172B44B),
    ("INPUT SOURCE 2", 0xE172748B), ("INPUT SOURCE 3", 0xE172F40B),
    ("KEYSTONE DOWN", 0xE172847B), ("KEYSTONE UP", 0xE17204FB),
    ("PREVIOUS", 0xE172A45B), ("MAGNIFY-", 0xE172CA35),
    ("MAGNIFY+", 0xE1724AB5), ("OVERSCAN", 0xE172AC53),
    ("PC", 0xE1729867), ("PRESET", 0xE17234CB),
    ("RESIZE", 0xE1722CD3), ("NEXT", 0xE17224DB),
    ("VIDEO", 0xE17258A7), ("MOUSE LEFT CLICK", 0xE17230CF),
    ("MOUSE RIGHT CLICK", 0xE172D02F), ("SOURCE 4", 0xE1720CF3),
]

let PROJ_BENQ: [(label: String, code: UInt32)] = [
    ("POWER", 0x000C40BF), ("POWER ON", 0x000CF20D),
    ("POWER OFF", 0x000C728D), ("SOURCE", 0x000C20DF),
    ("MUTE", 0x000C28D7), ("ECO BLANK", 0x000CE01F),
    ("MENU", 0x000CF00F), ("ENTER", 0x000C08F7),
    ("UP", 0x000CD02F), ("DOWN", 0x000C30CF),
    ("LEFT", 0x000CB04F), ("RIGHT", 0x000C708F),
    ("VOL-", 0x000CC13E), ("VOL+", 0x000C41BE),
    ("3D", 0x000CB14E), ("3D INVERT", 0x000CB946),
    ("ASPECT", 0x000CC837), ("AUTO", 0x000C10EF),
    ("BRIGHTNESS", 0x000C6897), ("COLOR", 0x000C9E61),
    ("CONTRAST", 0x000C8877), ("DIGITAL ZOOM -", 0x000C9867),
    ("DIGITAL ZOOM +", 0x000C18E7), ("FREEZE", 0x000CC03F),
    ("INFO", 0x000C00FF), ("KEYSTON DOWN", 0x000C906F),
    ("KEYSTON UP", 0x000C50AF), ("PAGE DOWN", 0x000C609F),
    ("PAGE UP", 0x000CA05F), ("SMART ECO", 0x000C0CF3),
    ("TEST", 0x000C29D6), ("TIMER ON", 0x000CA45B),
    ("TIMER SET UP", 0x000C649B), ("TINT", 0x000C5EA1),
    ("CAPTURE", 0x000C7887), ("COLOR TEMP", 0x000CFA05),
    ("FINE TUNE", 0x000CBA45), ("INPUT COMPONENT", 0x000C8A75),
    ("INPUT COMPUTER 1", 0x000C827D), ("INPUT COMPUTER 2", 0x000CA25D),
    ("INPUT HDMI", 0x000C1AE5), ("INPUT HDMI 2", 0x000C9A65),
    ("INPUT NETWORK", 0x000C629D), ("INPUT S-VIDEO", 0x000CF807),
    ("INPUT VIDEO", 0x000C4AB5), ("NETWORK SETTING", 0x000C817E),
    ("PIP", 0x000CD827), ("SHARP", 0x000C7E81),
    ("SRS", 0x000C9966), ("USER1", 0x000CAE51),
    ("USER2", 0x000C6E91), ("USER3", 0x000CEE11),
]

let PROJ_BRANDS: [ProjBrand] = [
    ProjBrand(name: "NEC", remoteNo: "#1803, #1777, #1806, #1882", keys: PROJ_NEC),
    ProjBrand(name: "Epson", remoteNo: "#1779, #1783", keys: PROJ_EPSON),
    ProjBrand(name: "InFocus", remoteNo: "#1818, #1940", keys: PROJ_INFOCUS),
    ProjBrand(name: "BenQ", remoteNo: "#1759, #1764", keys: PROJ_BENQ),
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
