import SwiftUI

/**
 Кондиционеры Haier. В отличие от NEC-пультов, пульт кондиционера при каждом нажатии
 шлёт всё состояние сразу: режим, температуру, скорость, жалюзи, таймер и нажатую кнопку.
 Форматы — по описанию протоколов в IRremoteESP8266 (ir_Haier), перенесено 1:1 с Android Haier.kt:
  - пульт 1: YR-W02 / HSU-09HMC203, 14 байт (HAIER_AC_YRW02);
  - пульт 2: V9014557 M47 8D, 22 байта (HAIER_AC176) — те же 14 байт плюс второй блок;
  - пульт 3: HSU07-HEA03, 9 байт (HAIER_AC).
 Кадр: метка 3000, пауза 3000, метка 3000, пауза 4300 мкс, затем байты старшим битом вперёд
 (метка 520, «1» — пауза 1650, «0» — пауза 650), в конце метка 520. Несущая 38 кГц.
 */
enum AcMode: String, CaseIterable {
    case cool = "COOL", heat = "HEAT", dry = "DRY", fan = "FAN", auto = "AUTO"
    var title: String {
        switch self {
        case .cool: return "охлаждение"
        case .heat: return "обогрев"
        case .dry: return "осушение"
        case .fan: return "вентилятор"
        case .auto: return "авто"
        }
    }
}

enum AcFan: String, CaseIterable {
    case auto = "AUTO", low = "LOW", med = "MED", high = "HIGH"
    var title: String {
        switch self {
        case .auto: return "авто"
        case .low: return "1"
        case .med: return "2"
        case .high: return "3"
        }
    }
}

/// Положение жалюзи для кнопки «Направление» (когда авто-поворот выключен).
enum AcVane: String, CaseIterable {
    case top = "TOP", middle = "MIDDLE", bottom = "BOTTOM", stop = "STOP"
    var title: String {
        switch self {
        case .top: return "верх"
        case .middle: return "середина"
        case .bottom: return "низ"
        case .stop: return "стоп"
        }
    }
}

/// Кнопка, которую «нажали» — пульт передаёт её вместе с состоянием.
enum AcButton {
    case power, mode, tempUp, tempDown, fan, swing, sleep, turbo, timer
}

/// Следующее значение по кругу.
func acNext<T: CaseIterable & Equatable>(_ v: T) -> T {
    let all: [T] = Array(T.allCases)
    let i: Int = all.firstIndex(of: v) ?? 0
    return all[(i + 1) % all.count]
}

/// Состояние кондиционера. Хранится строкой как в Android: model,power,MODE,temp,FAN,swing,VANE,sleep,turbo,timer.
struct AcState {
    var model: Int = 0
    var power: Bool = true
    var mode: AcMode = .cool
    var temp: Int = 24
    var fan: AcFan = .auto
    var swing: Bool = true
    var vane: AcVane = .top
    var sleep: Bool = false
    var turbo: Bool = false
    var timer: Int = 0

    static func decode(_ s: String) -> AcState {
        var st = AcState()
        let v: [String] = s.components(separatedBy: ",")
        if v.count < 10 { return st }
        st.model = min(max(Int(v[0]) ?? 0, 0), 2)
        st.power = v[1] == "1"
        st.mode = AcMode(rawValue: v[2]) ?? .cool
        st.temp = min(max(Int(v[3]) ?? 24, 16), 30)
        st.fan = AcFan(rawValue: v[4]) ?? .auto
        st.swing = v[5] == "1"
        st.vane = AcVane(rawValue: v[6]) ?? .top
        st.sleep = v[7] == "1"
        st.turbo = v[8] == "1"
        let t: Int = Int(v[9]) ?? 0
        st.timer = Haier.timers.contains(t) ? t : 0
        return st
    }

    func encode() -> String {
        let parts: [String] = [String(model), power ? "1" : "0", mode.rawValue, String(temp), fan.rawValue,
                               swing ? "1" : "0", vane.rawValue, sleep ? "1" : "0", turbo ? "1" : "0", String(timer)]
        return parts.joined(separator: ",")
    }
}

enum Haier {
    static let models: [String] = ["YR-W02", "V9014557", "HSU07"]
    static let timers: [Int] = [0, 1, 2, 4, 8]
    /// Протокол и число бит для Tasmota (IRSend), по номеру пульта.
    static let tasmota: [(proto: String, bits: Int)] = [("HAIER_AC_YRW02", 112), ("HAIER_AC176", 176), ("HAIER_AC", 72)]

    private static func sum(_ b: [Int], _ from: Int, _ to: Int) -> Int {
        var s: Int = 0
        for i in from..<to { s += b[i] }
        return s & 0xFF
    }

    /// Байты сообщения для выбранного пульта.
    static func bytes(_ s: AcState, _ btn: AcButton) -> [Int] {
        if s.model == 2 { return hsu07(s, btn) }
        return yrw02(s, btn, long: s.model == 1)
    }

    private static func yrw02Button(_ btn: AcButton) -> Int {
        switch btn {
        case .tempUp: return 0
        case .tempDown: return 1
        case .swing: return 2
        case .fan: return 4
        case .power: return 5
        case .mode: return 6
        case .turbo: return 8
        case .sleep: return 11
        case .timer: return 16
        }
    }

    private static func yrw02(_ s: AcState, _ btn: AcButton, long: Bool) -> [Int] {
        var b: [Int] = [Int](repeating: 0, count: long ? 22 : 14)
        let heat: Bool = s.mode == .heat
        var swingV: Int = 0
        if s.swing {
            swingV = 0xC
        } else if s.vane == .top {
            swingV = 0x1
        } else if s.vane == .middle || s.vane == .bottom {
            swingV = heat ? 0x3 : 0x2              // «низ» есть только в обогреве
        }
        var fan: Int = 5
        switch s.fan {
        case .high: fan = 1
        case .med: fan = 2
        case .low: fan = 3
        case .auto: fan = 5
        }
        var mode: Int = 1
        switch s.mode {
        case .auto: mode = 0
        case .cool: mode = 1
        case .dry: mode = 2
        case .heat: mode = 4
        case .fan: mode = 6
        }
        let turbo: Bool = s.turbo && (s.mode == .cool || heat)
        let t: Int = min(max(s.temp, 16), 30)
        b[0] = 0xA6
        b[1] = ((t - 16) << 4) | swingV
        b[3] = 0x02 | (s.timer > 0 ? 0x20 : 0)             // «здоровье» + таймер выключения
        b[4] = s.power ? 0x40 : 0
        b[5] = (fan << 5) | s.timer                         // часы таймера выключения
        b[6] = turbo ? 0x40 : 0
        b[7] = mode << 5
        b[8] = s.sleep ? 0x80 : 0
        b[12] = yrw02Button(btn)
        b[13] = sum(b, 0, 13)
        if long {
            b[14] = 0xB7
            let f2: Int = s.fan == .auto ? 0 : fan
            b[16] = f2 << 6
            b[21] = sum(b, 14, 21)
        }
        return b
    }

    private static func hsu07Command(_ s: AcState, _ btn: AcButton) -> Int {
        if !s.power { return 0 }
        switch btn {
        case .power: return 1
        case .mode: return 2
        case .fan: return 3
        case .tempUp: return 6
        case .tempDown: return 7
        case .sleep: return 8
        case .timer: return s.timer > 0 ? 9 : 10
        case .swing: return 13
        case .turbo: return 1
        }
    }

    private static func hsu07(_ s: AcState, _ btn: AcButton) -> [Int] {
        var b: [Int] = [Int](repeating: 0, count: 9)
        let now = Date()
        let hour: Int = Calendar.current.component(.hour, from: now)
        let minute: Int = Calendar.current.component(.minute, from: now)
        let cmd: Int = hsu07Command(s, btn)
        var swingV: Int = 0
        if s.swing {
            swingV = 3
        } else if s.vane == .top {
            swingV = 1
        } else if s.vane == .bottom {
            swingV = 2
        }
        var fan: Int = 0
        switch s.fan {
        case .auto: fan = 0
        case .high: fan = 1
        case .med: fan = 2
        case .low: fan = 3
        }
        var mode: Int = 1
        switch s.mode {
        case .auto: mode = 0
        case .cool: mode = 1
        case .dry: mode = 2
        case .heat: mode = 3
        case .fan: mode = 4
        }
        let t: Int = min(max(s.temp, 16), 30)
        b[0] = 0xA5
        b[1] = ((t - 16) << 4) | cmd
        b[2] = hour | 0x20 | (swingV << 6)
        b[3] = minute | (s.timer > 0 ? 0x40 : 0)
        b[4] = s.timer > 0 ? s.timer : 12
        b[5] = fan << 6
        b[6] = mode << 5
        b[7] = s.sleep ? 0x40 : 0
        b[8] = sum(b, 0, 8)
        return b
    }

    /// ИК-кадр в микросекундах (метка, пауза, …) для звукового адаптера.
    static func pattern(_ bytes: [Int]) -> [Int] {
        var d: [Int] = [3000, 3000, 3000, 4300]
        for v in bytes {
            for i in stride(from: 7, through: 0, by: -1) {
                d.append(520)
                d.append((v >> i) & 1 == 1 ? 1650 : 650)
            }
        }
        d.append(520)
        d.append(20000)
        return d
    }

    static func hex(_ bytes: [Int]) -> String {
        bytes.map { String(format: "%02X", UInt32($0 & 0xFF)) }.joined(separator: " ")
    }

    /// Данные для Tasmota: все байты подряд с префиксом 0x.
    static func data(_ bytes: [Int]) -> String {
        "0x" + bytes.map { String(format: "%02X", UInt32($0 & 0xFF)) }.joined()
    }
}

/// Термостат как на пульте: дуга 16…30°, бегунок по дуге, в центре температура и режим.
/// Пока ведёте пальцем — меняется число, при отпускании вызывается onPick.
struct ThermoDial: View {
    let temp: Int
    let mode: String
    let onPick: (Int) -> Void
    @State private var dragTemp: Int?

    private static let start: Double = 135
    private static let sweep: Double = 270

    private var shown: Int { dragTemp ?? temp }

    var body: some View {
        GeometryReader { g in
            Canvas { ctx, size in ThermoDial.draw(ctx, size, temp: shown, mode: mode) }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { v in track(v.location, g.size) }
                    .onEnded { v in finish(v.location, g.size) })
        }
    }

    /// Температура по точке касания; nil — палец в «разрыве» дуги снизу.
    private static func tempAt(_ p: CGPoint, _ size: CGSize) -> Int? {
        let dx: Double = Double(p.x - size.width / 2)
        let dy: Double = Double(p.y - size.height / 2)
        var ang: Double = atan2(dy, dx) * 180 / Double.pi
        ang = ((ang - start).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        if ang > sweep + 20 { return nil }
        let k: Double = min(ang, sweep) / sweep
        let t: Int = Int((16 + k * 14).rounded())
        return min(max(t, 16), 30)
    }

    private func track(_ p: CGPoint, _ size: CGSize) {
        if let t = ThermoDial.tempAt(p, size) { dragTemp = t }
    }

    private func finish(_ p: CGPoint, _ size: CGSize) {
        if let t = ThermoDial.tempAt(p, size) { dragTemp = t }
        let t: Int = dragTemp ?? temp
        dragTemp = nil
        onPick(t)
    }

    private static func point(_ c: CGPoint, _ r: CGFloat, _ deg: Double) -> CGPoint {
        let a: Double = deg * Double.pi / 180
        return CGPoint(x: c.x + r * CGFloat(cos(a)), y: c.y + r * CGFloat(sin(a)))
    }

    /// Дуга ломаной: угол растёт по часовой стрелке (ось y вниз), как на Android.
    private static func arc(_ c: CGPoint, _ r: CGFloat, from a0: Double, to a1: Double) -> Path {
        var p = Path()
        let steps: Int = max(2, Int((a1 - a0) / 3))
        for i in 0...steps {
            let a: Double = a0 + (a1 - a0) * Double(i) / Double(steps)
            let q: CGPoint = point(c, r, a)
            if i == 0 { p.move(to: q) } else { p.addLine(to: q) }
        }
        return p
    }

    private static func fillColor(_ f: Double) -> Color {
        if Term.thermal { return Heat.color(0.4 + 0.6 * f) }
        if Term.prism {
            let i: Int = min(5, max(0, Int(f * 5)))
            return Prism.iris[i]
        }
        return Term.fg
    }

    static func draw(_ ctx: GraphicsContext, _ size: CGSize, temp: Int, mode: String) {
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        let r: CGFloat = min(size.width, size.height) / 2 - 18
        if r < 20 { return }
        let line = StrokeStyle(lineWidth: 12, lineCap: .round)
        ctx.stroke(arc(c, r, from: start, to: start + sweep), with: .color(Term.line), style: line)
        let f: Double = Double(temp - 16) / 14
        if f > 0.001 {
            ctx.stroke(arc(c, r, from: start, to: start + sweep * f), with: .color(fillColor(f)), style: line)
        }
        // подписи 16, 18 … 30 снаружи дуги
        for t in stride(from: 16, through: 30, by: 2) {
            let a: Double = start + sweep * Double(t - 16) / 14
            let q: CGPoint = point(c, r + 16, a)
            let label = Text(String(t) + "°").font(Term.ru(12)).foregroundColor(Term.dim)
            ctx.draw(label, at: q, anchor: .center)
        }
        // бегунок
        let k: CGPoint = point(c, r, start + sweep * f)
        ctx.fill(Path(ellipseIn: CGRect(x: k.x - 12, y: k.y - 12, width: 24, height: 24)), with: .color(Term.bg))
        ctx.fill(Path(ellipseIn: CGRect(x: k.x - 9, y: k.y - 9, width: 18, height: 18)), with: .color(Term.fg))
        // температура и режим
        let big = Text(String(temp) + "°").font(Term.mono(56)).foregroundColor(Term.fg)
        ctx.draw(big, at: CGPoint(x: c.x, y: c.y + 4), anchor: .center)
        let small = Text(mode).font(Term.ru(14)).foregroundColor(Term.dim)
        ctx.draw(small, at: CGPoint(x: c.x, y: c.y - 38), anchor: .center)
    }
}

/// Вкладка «Кондиционеры»: пульт Haier — термостат, питание, режим, скорость, поворот, направление, сон, турбо, таймер.
struct AcPanel: View {
    @ObservedObject var model: RemoteModel
    @AppStorage("acState") private var stored = ""
    /// HEX последнего отправленного кадра.
    @State private var sent = ""

    private var st: AcState { AcState.decode(stored) }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) { TabLabel(title: "Haier", on: true, height: 36) }
                Text("Пульт Haier бывает трёх видов. Если кондиционер не отвечает — выберите другой номер пульта.")
                    .font(Term.ru(13)).foregroundColor(Term.dim)
                    .fixedSize(horizontal: false, vertical: true)
                modelChips
                ThermoDial(temp: st.temp, mode: modeText) { t in pickTemp(t) }
                    .frame(height: 260)
                buttons
                if !sent.isEmpty {
                    Text(sent).font(Term.ru(12)).foregroundColor(Term.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("Пульт кондиционера при каждом нажатии передаёт всё сразу: режим, температуру, скорость. " +
                     "Поэтому приложение запоминает состояние — если кондиционер включали другим пультом, сначала выставьте здесь то же самое.")
                    .font(Term.ru(12)).foregroundColor(Term.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, 16)
        }
    }

    private var modeText: String { st.power ? st.mode.title : "выключен" }

    private var modelChips: some View {
        HStack(spacing: 6) {
            ForEach(0..<3, id: \.self) { i in modelChip(i) }
        }
    }

    private func modelChip(_ i: Int) -> some View {
        let on: Bool = st.model == i
        let title: String = String(i + 1) + " · " + Haier.models[i]
        return Button {
            var s: AcState = st
            s.model = i
            stored = s.encode()
        } label: { TabLabel(title: title, on: on, height: 36, ruSize: 12) }
    }

    private var buttons: some View {
        VStack(spacing: 8) {
            rowTemp
            rowPower
            rowFan
            rowVane
            rowTimer
        }
    }

    private var rowTemp: some View {
        HStack(spacing: 8) {
            acButton("[ − ]", false) { send(.tempDown) { x in x.temp = max(16, x.temp - 1) } }
            acButton("[ + ]", false) { send(.tempUp) { x in x.temp = min(30, x.temp + 1) } }
        }
    }

    private var rowPower: some View {
        let s: AcState = st
        let power: String = s.power ? "[ питание: вкл ]" : "[ питание: выкл ]"
        let mode: String = "[ режим: " + s.mode.title + " ]"
        return HStack(spacing: 8) {
            acButton(power, s.power) { send(.power) { x in x.power.toggle() } }
            acButton(mode, false) { send(.mode) { x in x.mode = acNext(x.mode) } }
        }
    }

    private var rowFan: some View {
        let s: AcState = st
        let fan: String = "[ скорость: " + s.fan.title + " ]"
        return HStack(spacing: 8) {
            acButton(fan, false) { send(.fan) { x in x.fan = acNext(x.fan) } }
            acButton("[ авто поворот ]", s.swing) { send(.swing) { x in x.swing.toggle() } }
        }
    }

    private var rowVane: some View {
        let s: AcState = st
        let vane: String = "[ направление: " + s.vane.title + " ]"
        return HStack(spacing: 8) {
            acButton(vane, false) { send(.swing) { x in vaneStep(&x) } }
            acButton("[ сон ]", s.sleep) { send(.sleep) { x in x.sleep.toggle() } }
        }
    }

    private var rowTimer: some View {
        let s: AcState = st
        let timer: String = s.timer == 0 ? "[ таймер выкл: нет ]" : "[ таймер выкл: " + String(s.timer) + " ч ]"
        return HStack(spacing: 8) {
            acButton("[ турбо ]", s.turbo) { send(.turbo) { x in x.turbo.toggle() } }
            acButton(timer, s.timer > 0) { send(.timer) { x in timerStep(&x) } }
        }
    }

    private func vaneStep(_ x: inout AcState) {
        x.swing = false
        x.vane = acNext(x.vane)
    }

    private func timerStep(_ x: inout AcState) {
        let i: Int = Haier.timers.firstIndex(of: x.timer) ?? 0
        x.timer = Haier.timers[(i + 1) % Haier.timers.count]
    }

    private func acButton(_ title: String, _ on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TabLabel(title: title, on: on, height: 54, ruSize: 14)
        }
    }

    private func pickTemp(_ t: Int) {
        let cur: Int = st.temp
        if t == cur { return }
        let btn: AcButton = t > cur ? .tempUp : .tempDown
        send(btn) { x in x.temp = t }
    }

    /// Изменить состояние и сразу отправить его целиком, как настоящий пульт.
    private func send(_ btn: AcButton, _ change: (inout AcState) -> Void) {
        var s: AcState = st
        change(&s)
        stored = s.encode()
        let bytes: [Int] = Haier.bytes(s, btn)
        sent = Haier.hex(bytes)
        let tx: (proto: String, bits: Int) = Haier.tasmota[s.model]
        let what: String = s.power ? s.mode.title : "выкл"
        let status: String = "> tx haier " + Haier.models[s.model] + " " + what + " " + String(s.temp) + "° [sent]"
        model.sendFrame(Haier.pattern(bytes), proto: tx.proto, bits: tx.bits, data: Haier.data(bytes), status: status)
    }
}
