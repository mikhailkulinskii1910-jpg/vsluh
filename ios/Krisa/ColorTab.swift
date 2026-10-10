import SwiftUI
import UIKit

/// RGB-перелив: имя (как на фото) и опорные цвета от начала к концу.
struct RgbFlow {
    let name: String
    let hex: [UInt32]
    init(_ name: String, _ hex: [UInt32]) {
        self.name = name
        self.hex = hex
    }
    /// Осветлённые цвета перелива — их же показываем в полосе-превью.
    var colors: [Color] { hex.map { Color(hex: TermColors.lighten($0)) } }
}

/// Цвета «Терминала»: пресеты люминофора и RGB-переливы.
enum TermColors {
    static let white: UInt32 = 0xEDEDED
    static let green: UInt32 = 0x1FFF3A

    static let presets: [(name: String, hex: UInt32)] = [
        ("Белый", 0xEDEDED), ("Зелёный", 0x1FFF3A),
        ("Красный", 0xFF2A1A), ("Оранжевый", 0xFF8C1A),
        ("Янтарь", 0xFFB52E), ("Фиолетовый", 0xA855FF),
    ]

    static let flows: [RgbFlow] = [
        RgbFlow("Rainbow", [0x7F00FF, 0x0000FF, 0x00FFFF, 0x00FF00, 0xFFFF00, 0xFF0000]),
        RgbFlow("Mac Style", [0x8000FF, 0x0040FF, 0x00FFFF, 0x00FF00, 0xFFFF00, 0xFF0000]),
        RgbFlow("jet", [0x0000FF, 0x00FFFF, 0x80FF80, 0xFFFF00, 0xFF0000, 0x800000]),
        RgbFlow("Blue-Red", [0x0000C0, 0x0060FF, 0x00FFFF, 0x80FF80, 0xFFFF00, 0xFF4000, 0xC00000]),
        RgbFlow("Eos A", [0x0010C0, 0x00A0FF, 0x00FF80, 0xE0FF00, 0xFFA000, 0xFF3000, 0xA00000]),
        RgbFlow("16 LEVEL", [0x009900, 0x00FF00, 0x00FF99, 0x00FFFF, 0x0000FF, 0x9900FF, 0xFF00FF, 0xFF0066, 0xFF0000, 0xFFCCCC, 0xFFFFFF]),
        RgbFlow("Rainbow18", [0xA000A0, 0x6060FF, 0x00C0C0, 0x00A000, 0xA0C000, 0xFFFF00, 0xFF8000, 0xFF0000, 0xFF60A0]),
        RgbFlow("PRISM", [0xFF0000, 0xFFA000, 0x80FF00, 0x00FFFF, 0x0040FF]),
        RgbFlow("Pastels", [0xFF0080, 0xFF40C0, 0x00FFFF, 0x00FF80, 0xC0FF00, 0xFFFF00]),
        RgbFlow("Hardcandy", [0x3060FF, 0x00E0FF, 0xFF0080, 0x40FF60, 0xFFE000, 0xFF60C0]),
        RgbFlow("GREEN-PINK", [0x00A040, 0x0080C0, 0x8000FF, 0xFF00C0, 0xFFC0E0]),
        RgbFlow("GRN-RED-BLU-WHT", [0x00FF00, 0xFF0000, 0xFF00FF, 0xA000FF, 0xFFFFFF]),
        RgbFlow("RED TEMPERATURE", [0xC00000, 0xFF6000, 0xFFC000, 0xFFFFE0]),
        RgbFlow("RED-PURPLE", [0xC00040, 0xFF0080, 0xFF60C0, 0xFFC0FF]),
        RgbFlow("hot", [0xFF0000, 0xFF8000, 0xFFFF00, 0xFFFFFF]),
        RgbFlow("STD GAMMA-II", [0x0000FF, 0xFF00FF, 0xFF0000, 0xFFFF00, 0xFFFFFF]),
        RgbFlow("STERN SPECIAL", [0xFF2040, 0x4040FF, 0x8080FF, 0xC0C000, 0xFFFFC0]),
        RgbFlow("Volcano", [0x6040C0, 0x00A000, 0xC06000, 0xFF0000, 0xFFFF00, 0x6060FF]),
        RgbFlow("Ocean", [0x6060E0, 0xC04040, 0xC0A040, 0x00C060, 0x60C0FF, 0x60FFE0]),
        RgbFlow("Nature", [0x00FFC0, 0xC0FF40, 0x008000, 0x4000FF, 0xFF0000]),
        RgbFlow("algae", [0x6000C0, 0x0060FF, 0x00C080, 0xC0FF00, 0xFFA000, 0xFF0000]),
        RgbFlow("arbre", [0xC00000, 0xC040C0, 0x4080FF, 0x00FFC0, 0xFFFF00]),
        RgbFlow("kamae", [0xC03000, 0xFF8000, 0xC0FF40, 0x40FFC0, 0x60C0FF, 0xC0A0FF]),
        RgbFlow("kelp", [0x3000A0, 0x4060C0, 0x60A0A0, 0xC0C060, 0xFFE080]),
        RgbFlow("dusk", [0x204080, 0x408080, 0xC08060, 0xFFA040, 0xFFF0C0]),
        RgbFlow("octarine", [0x206080, 0x408060, 0xC08080, 0xFF80C0, 0xFFC0FF]),
        RgbFlow("Haze", [0xFF80FF, 0xC0C0FF, 0x80A0FF, 0xC0A0A0, 0xFFC080, 0xFFE000]),
        RgbFlow("RdBu", [0xB00020, 0xFF8060, 0xFFFFFF, 0x60A0FF, 0x2040A0]),
    ]

    static let flowNames: Set<String> = Set(flows.map { $0.name })

    static func flow(_ name: String) -> RgbFlow? { flows.first { $0.name == name } }

    /// «Осветлить» точку перелива: если max(r,g,b) < 150 — растянуть до 150 (чёрная — серая #969696).
    static func lighten(_ h: UInt32) -> UInt32 {
        let r: Double = Double((h >> 16) & 0xFF)
        let g: Double = Double((h >> 8) & 0xFF)
        let b: Double = Double(h & 0xFF)
        let m: Double = max(r, max(g, b))
        if m <= 0 { return 0x969696 }
        if m >= 150 { return h & 0xFFFFFF }
        let k: Double = 150.0 / m
        let rr: UInt32 = UInt32(min(255.0, (r * k).rounded()))
        let gg: UInt32 = UInt32(min(255.0, (g * k).rounded()))
        let bb: UInt32 = UInt32(min(255.0, (b * k).rounded()))
        return (rr << 16) | (gg << 8) | bb
    }

    /// Цвет круга: оттенок h, насыщенность s, яркость 1 — в 0xRRGGBB.
    static func hsvHex(_ h: Double, _ s: Double) -> UInt32 {
        let c = UIColor(hue: CGFloat(h), saturation: CGFloat(s), brightness: 1, alpha: 1)
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (byte(r) << 16) | (byte(g) << 8) | byte(b)
    }

    private static func byte(_ v: CGFloat) -> UInt32 {
        let x: CGFloat = (v * 255).rounded()
        return UInt32(max(0, min(255, x)))
    }

    /// Оттенок и насыщенность цвета (для метки на круге).
    static func hueSat(_ hex: UInt32) -> (Double, Double) {
        let r: CGFloat = CGFloat((hex >> 16) & 0xFF) / 255
        let g: CGFloat = CGFloat((hex >> 8) & 0xFF) / 255
        let b: CGFloat = CGFloat(hex & 0xFF) / 255
        let c = UIColor(red: r, green: g, blue: b, alpha: 1)
        var h: CGFloat = 0
        var s: CGFloat = 0
        var v: CGFloat = 0
        var a: CGFloat = 0
        c.getHue(&h, saturation: &s, brightness: &v, alpha: &a)
        return (Double(h), Double(s))
    }
}

/// RGB-перелив поверх экрана: диагональный градиент с зеркальным повтором, режим multiply.
struct RgbOverlay: View {
    let colors: [Color]
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { tl in
            Canvas { ctx, size in RgbOverlay.paint(ctx, size, Prism.time(tl.date), colors) }
        }
        .blendMode(.multiply)
        .allowsHitTesting(false)
    }

    /// Один проход палитры ≈ 1.2 высоты экрана, проходы чередуются прямо/обратно (MIRROR),
    /// за 6 с градиент сдвигается на один проход.
    static func paint(_ ctx: GraphicsContext, _ size: CGSize, _ t: Double, _ colors: [Color]) {
        let w: CGFloat = size.width
        let h: CGFloat = size.height
        let diag: CGFloat = sqrt(w * w + h * h)
        if diag < 1 || colors.count < 2 { return }
        let dx: CGFloat = w / diag
        let dy: CGFloat = h / diag
        let pass: CGFloat = max(h * 1.2, 1)
        let cycles: Double = (t / 6.0).truncatingRemainder(dividingBy: 2.0)
        let phase: CGFloat = CGFloat(cycles) * pass
        let n: Int = Int(ceil((diag + phase) / pass)) + 2
        let total: CGFloat = CGFloat(n) * pass
        let start = CGPoint(x: -phase * dx, y: -phase * dy)
        let end = CGPoint(x: start.x + total * dx, y: start.y + total * dy)
        let grad = Gradient(stops: stops(colors, passes: n))
        ctx.fill(Path(CGRect(origin: .zero, size: size)),
                 with: .linearGradient(grad, startPoint: start, endPoint: end))
    }

    private static func stops(_ colors: [Color], passes n: Int) -> [Gradient.Stop] {
        var out: [Gradient.Stop] = []
        let m: Int = colors.count
        let rev: [Color] = colors.reversed()
        for k in 0..<n {
            let seq: [Color] = k % 2 == 0 ? colors : rev
            for j in 0..<m {
                let local: CGFloat = CGFloat(j) / CGFloat(m - 1)
                let loc: CGFloat = (CGFloat(k) + local) / CGFloat(n)
                out.append(Gradient.Stop(color: seq[j], location: loc))
            }
        }
        return out
    }
}

/// Фон «Матрица»: колонки падающих символов, поверх бегают крысы.
struct MatrixBackground: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { tl in
            ZStack {
                Canvas { ctx, size in MatrixRain.paint(ctx, size, Prism.time(tl.date)) }
                RunningRats(t: tl.date.timeIntervalSinceReferenceDate)
            }
        }
        .clipped()
        .allowsHitTesting(false)
    }
}

enum MatrixRain {
    /// Полуширинная катакана, цифры и знаки.
    static let glyphs: [String] = Array("ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+-<>|").map { String($0) }
    static let cell: CGFloat = 17
    static let head = Color(.sRGB, red: 220.0 / 255.0, green: 1.0, blue: 225.0 / 255.0, opacity: 1)

    /// Символ клетки: у каждой клетки своя частота мерцания.
    private static func glyph(col: Int, row: Int, t: Double) -> Int {
        let rate: Double = 1.5 + 6.0 * Double(hashNoise(col * 31 + row * 7 + 3))
        let flick: Int = Int(t * rate)
        let r: CGFloat = hashNoise(col * 977 + row * 131 + flick * 7)
        return min(glyphs.count - 1, Int(r * CGFloat(glyphs.count)))
    }

    static func paint(_ ctx: GraphicsContext, _ size: CGSize, _ t: Double) {
        let cols: Int = Int(size.width / cell) + 1
        let rows: Int = Int(size.height / cell) + 1
        let font: Font = .system(size: 14, design: .monospaced)
        let fg: Color = Term.fg
        // символы хвоста — один раз за кадр, прозрачность задаётся при рисовании
        let tails: [GraphicsContext.ResolvedText] = glyphs.map { ctx.resolve(Text($0).font(font).foregroundColor(fg)) }
        var glow = ctx
        glow.addFilter(.shadow(color: fg, radius: 6))
        for c in 0..<cols {
            let speed: Double = 6.0 + 16.0 * Double(hashNoise(c * 7 + 3))
            let len: Int = 8 + Int(22.0 * hashNoise(c * 13 + 5))
            let span: Double = Double(rows + len)
            let off: Double = Double(hashNoise(c * 29 + 11)) * span
            let headRow: Int = Int((t * speed + off).truncatingRemainder(dividingBy: span))
            let x: CGFloat = CGFloat(c) * cell + cell / 2
            for k in 0..<len {
                let row: Int = headRow - k
                if row < 0 || row >= rows { continue }
                let y: CGFloat = CGFloat(row) * cell + cell / 2
                let p = CGPoint(x: x, y: y)
                let gi: Int = glyph(col: c, row: row, t: t)
                if k == 0 {
                    let ht = glow.resolve(Text(glyphs[gi]).font(font).foregroundColor(head))
                    glow.draw(ht, at: p, anchor: .center)
                } else {
                    var tc = ctx
                    tc.opacity = 0.85 * (1.0 - Double(k) / Double(len))
                    tc.draw(tails[gi], at: p, anchor: .center)
                }
            }
        }
    }
}

/// Круг цветов: по кругу — оттенок, к центру — бледнее. Пока палец ведёт — меняется образец, при отпускании цвет применяется.
struct ColorWheel: View {
    let onPick: (UInt32) -> Void
    @State private var hue: Double
    @State private var sat: Double
    @State private var preview: UInt32
    private let side: CGFloat = 240

    init(start: UInt32, onPick: @escaping (UInt32) -> Void) {
        self.onPick = onPick
        let hs: (Double, Double) = TermColors.hueSat(start)
        _hue = State(initialValue: hs.0)
        _sat = State(initialValue: hs.1)
        _preview = State(initialValue: start)
    }

    private static let hues: [Color] = (0...12).map { Color(hue: Double($0) / 12.0, saturation: 1, brightness: 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            wheel
            sample
        }
    }

    private var wheel: some View {
        ZStack {
            Circle().fill(AngularGradient(gradient: Gradient(colors: ColorWheel.hues), center: .center))
            Circle().fill(RadialGradient(gradient: Gradient(colors: [Color.white, Color.white.opacity(0)]),
                                         center: .center, startRadius: 0, endRadius: side / 2))
            marker
        }
        .frame(width: side, height: side)
        .contentShape(Circle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { v in pick(v.location, apply: false) }
            .onEnded { v in pick(v.location, apply: true) })
    }

    /// Метка выбранной точки: чёрное кольцо и белое кольцо.
    private var marker: some View {
        let r: CGFloat = side / 2
        let a: Double = hue * 2 * Double.pi
        let px: CGFloat = r + CGFloat(cos(a) * sat) * r
        let py: CGFloat = r + CGFloat(sin(a) * sat) * r
        return ZStack {
            Circle().stroke(Color.black, lineWidth: 3).frame(width: 18, height: 18)
            Circle().stroke(Color.white, lineWidth: 1.5).frame(width: 12, height: 12)
        }
        .position(x: px, y: py)
    }

    private var sample: some View {
        HStack(spacing: 10) {
            Rectangle().fill(Color(hex: preview)).frame(width: 64, height: 30)
                .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
            Text(String(format: "образец  #%06X", preview)).font(Term.ru(13)).foregroundColor(Term.dim)
        }
    }

    private func pick(_ p: CGPoint, apply: Bool) {
        let r: CGFloat = side / 2
        let dx: Double = Double(p.x - r)
        let dy: Double = Double(p.y - r)
        var a: Double = atan2(dy, dx) / (2 * Double.pi)
        if a < 0 { a += 1 }
        let s: Double = min(1, sqrt(dx * dx + dy * dy) / Double(r))
        hue = a
        sat = s
        preview = TermColors.hsvHex(a, s)
        if apply { onPick(preview) }
    }
}

/// Вкладка «Цвет» темы «Терминал»: пресеты, «Матрица», свой цвет, RGB-переливы.
/// Рисуется поверх перелива — в своих настоящих цветах.
struct TermColorPanel: View {
    @AppStorage("termColor") private var termColor = 0xEDEDED
    @AppStorage("matrix") private var matrix = false
    @AppStorage("rgb") private var rgb = ""
    @State private var rgbOpen = false

    private var current: UInt32 { UInt32(truncatingIfNeeded: termColor) & 0xFFFFFF }
    private var rgbOn: Bool { !rgb.isEmpty && TermColors.flowNames.contains(rgb) }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                Text("> цвет").font(Term.ru(18)).foregroundColor(Term.fg)
                presetGrid
                if current == TermColors.green && !rgbOn { matrixButton }
                Text("> свой цвет").font(Term.ru(18)).foregroundColor(Term.fg).padding(.top, 8)
                ColorWheel(start: current) { hex in setColor(hex) }
                rgbButton.padding(.top, 6)
                if rgbOpen { rgbList }
            }
            .padding(.bottom, 24)
        }
    }

    private var presetGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(TermColors.presets.indices, id: \.self) { i in presetButton(i) }
        }
    }

    private func presetButton(_ i: Int) -> some View {
        let p = TermColors.presets[i]
        let on: Bool = !rgbOn && current == p.hex
        let c: Color = Color(hex: p.hex)
        let ink: Color = on ? Color.black : c
        return Button { setColor(p.hex) } label: {
            HStack(spacing: 6) {
                Text(on ? "[x]" : "[ ]").font(.custom("VT323-Regular", size: 22))
                Text(p.name).font(.system(size: 14, design: .monospaced))
                Spacer(minLength: 0)
            }
            .foregroundColor(ink)
            .padding(.horizontal, 10)
            .frame(height: 44)
            .background(on ? c : Color.black)
            .overlay(Rectangle().strokeBorder(c, lineWidth: 1))
        }
    }

    private var matrixButton: some View {
        let on: Bool = matrix
        let c: Color = Color(hex: TermColors.green)
        return Button {
            Term.matrixOn = !matrix
            matrix = Term.matrixOn
        } label: {
            Text(on ? "[ MATRIX: ВКЛ ]" : "[ MATRIX ]").font(.system(size: 15, design: .monospaced))
                .foregroundColor(on ? Color.black : c)
                .frame(maxWidth: .infinity).frame(height: 44)
                .background(on ? c : Color.black)
                .overlay(Rectangle().strokeBorder(c, lineWidth: 1))
        }
    }

    private var rgbButton: some View {
        let title: String = rgbOn ? "[ RGB: " + rgb + " ]" : "[ RGB ]"
        return Button { rgbOpen.toggle() } label: {
            Text(title).font(.system(size: 15, design: .monospaced)).lineLimit(1)
                .foregroundColor(rgbOn ? Color.black : Term.fg)
                .frame(maxWidth: .infinity).frame(height: 44)
                .background(rgbOn ? Term.fg : Color.black)
                .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
        }
    }

    private var rgbList: some View {
        VStack(alignment: .leading, spacing: 6) {
            offRow
            ForEach(TermColors.flows.indices, id: \.self) { i in flowRow(TermColors.flows[i]) }
        }
        .padding(8)
        .background(Color.black)
        .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
    }

    private var offRow: some View {
        let on: Bool = !rgbOn
        return Button { setFlow("") } label: {
            HStack {
                Text(on ? "[x] выкл" : "[ ] выкл").font(.system(size: 13, design: .monospaced))
                Spacer()
            }
            .foregroundColor(on ? Term.fg : Term.dim)
            .frame(height: 30)
        }
    }

    private func flowRow(_ f: RgbFlow) -> some View {
        let on: Bool = rgbOn && rgb == f.name
        let colors: [Color] = f.colors
        return Button { setFlow(f.name) } label: {
            HStack(spacing: 8) {
                LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
                    .frame(height: 26)
                    .overlay(Rectangle().strokeBorder(on ? Term.fg : Color.clear, lineWidth: 2))
                Text((on ? "[x] " : "") + f.name).font(.system(size: 11, design: .monospaced))
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .foregroundColor(on ? Term.fg : Term.dim)
                    .frame(width: 128, alignment: .leading)
            }
        }
    }

    /// Пресет или круг цветов: новый цвет, перелив выключается.
    private func setColor(_ hex: UInt32) {
        Term.termHex = hex & 0xFFFFFF
        Term.rgbName = ""
        rgb = ""
        termColor = Int(hex & 0xFFFFFF)
    }

    private func setFlow(_ name: String) {
        Term.rgbName = name
        rgb = name
    }
}

/// Вкладка «Цвет» темы «Тепловизор»: четыре палитры.
struct HeatPanel: View {
    @AppStorage("heat") private var heat = "ironbow"

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                Text("> палитра").font(Term.ru(18)).foregroundColor(Term.fg)
                Text("Палитра тепловизора: фон, кнопки, рамки обнаружения.").font(Term.ru(12)).foregroundColor(Term.dim)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(Heat.palettes.indices, id: \.self) { i in paletteButton(Heat.palettes[i]) }
                }
            }
            .padding(.bottom, 24)
        }
    }

    private func paletteButton(_ p: Heat.Palette) -> some View {
        let on: Bool = Heat.find(heat).id == p.id
        let accent: Color = Color(hex: p.accent)
        let colors: [Color] = p.pal.map { Color(hex: $0) }
        let title: String = (on ? "[x] " : "[ ] ") + p.title
        return Button {
            Heat.cur = p
            heat = p.id
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.custom("VT323-Regular", size: 20)).foregroundColor(Color(hex: p.fg)).lineLimit(1)
                LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing).frame(height: 24)
                Text("COLD .. HOT").font(.custom("VT323-Regular", size: 15)).foregroundColor(Color(hex: p.dim))
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 86, alignment: .leading)
            .background(Color(hex: p.bg))
            .overlay(Rectangle().strokeBorder(on ? accent : accent.opacity(0.35), lineWidth: on ? 3 : 1))
        }
    }
}

/// Рамка области пульта в общей системе координат экрана — сюда кладётся панель «Цвет».
struct PanelFrameKey: PreferenceKey {
    static let defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let n = nextValue()
        if n != .zero { value = n }
    }
}
