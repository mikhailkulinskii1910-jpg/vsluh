import SwiftUI

/**
 Тема «Чертёж»: синий лист blueprint с миллиметровкой, на фоне — схема, по ней проходит «скан»,
 в углу штамп. Кнопки — двойные рамки с метками совмещения, надписи Manrope заглавными.
 */
enum Blueprint {
    /// Цвет в долях 0…1.
    struct RGB {
        let r: Double
        let g: Double
        let b: Double
        init(_ r: Double, _ g: Double, _ b: Double) {
            self.r = r
            self.g = g
            self.b = b
        }
        init(hex: UInt32) {
            self.init(Double((hex >> 16) & 0xFF) / 255.0, Double((hex >> 8) & 0xFF) / 255.0, Double(hex & 0xFF) / 255.0)
        }
        func mix(_ o: RGB, _ k: Double) -> RGB {
            RGB(r + (o.r - r) * k, g + (o.g - g) * k, b + (o.b - b) * k)
        }
        func scaled(_ k: Double) -> RGB { RGB(r * k, g * k, b * k) }
        var luminance: Double {
            let a: Double = 0.2126 * r
            let c: Double = 0.7152 * g
            let d: Double = 0.0722 * b
            return a + c + d
        }
        func color(_ alpha: Double = 1) -> Color { Color(.sRGB, red: r, green: g, blue: b, opacity: alpha) }
    }

    static let lightHex: UInt32 = 0xF2F5FA
    static let midHex: UInt32 = 0x1A4A9E
    static let darkHex: UInt32 = 0x05070D
    /// Чернила на светлой бумаге — синие линии, как на светокопии.
    static let inkDarkHex: UInt32 = 0x0E2A66

    /// Светлота чертежа (ключ "bpShade"): 0 — белая бумага, 0.5 — синий, 1 — почти чёрный.
    /// Пока тянут ползунок, меняется сразу — фон перерисовывается каждый кадр.
    static var shade: Double = Blueprint.loadShade()

    private static func loadShade() -> Double {
        let n: NSNumber? = UserDefaults.standard.object(forKey: "bpShade") as? NSNumber
        let v: Double = n?.doubleValue ?? 0.5
        return min(1, max(0, v))
    }

    static func paper(_ v: Double) -> RGB {
        if v < 0.5 { return RGB(hex: lightHex).mix(RGB(hex: midHex), v / 0.5) }
        return RGB(hex: midHex).mix(RGB(hex: darkHex), (v - 0.5) / 0.5)
    }
    static var paperRGB: RGB { paper(shade) }
    /// Светлая бумага: чернила синие, иначе белые.
    static var light: Bool { paperRGB.luminance > 0.5 }
    static var inkRGB: RGB { light ? RGB(hex: inkDarkHex) : RGB(1, 1, 1) }

    static var bg: Color { paperRGB.color() }
    /// «Чернила»: линии, текст, рамки, схема, сетка, штамп, контур крысы.
    static var ink: Color { inkRGB.color() }
    /// Смесь бумаги и чернил.
    static func blend(_ k: Double) -> Color { paperRGB.mix(inkRGB, k).color() }
    static var dim: Color { blend(0.72) }
    static var line: Color { blend(0.6) }
    static var faint: Color { blend(0.12) }
    /// Край виньетки — темнее бумаги.
    static var edge: Color { paperRGB.scaled(0.7).color() }

    /// Подписи и кнопки — Manrope SemiBold.
    static func semi(_ size: CGFloat) -> Font { .custom("Manrope-SemiBold", size: size) }

    /// Подпись заглавными с разрядкой ~0.08em.
    static func caps(_ s: String, _ size: CGFloat) -> Text {
        Text(s.uppercased()).font(semi(size)).kerning(size * 0.08)
    }

    /// Миллиметровка: тонкие линии каждые 14 pt и линии ярче каждые 70 pt.
    static func drawGrid(_ ctx: GraphicsContext, _ size: CGSize) {
        let step: CGFloat = 14
        var fine = Path()
        var bold = Path()
        var i: Int = 0
        var x: CGFloat = 0
        while x <= size.width {
            if i % 5 == 0 { vline(&bold, x, size.height) } else { vline(&fine, x, size.height) }
            x += step
            i += 1
        }
        i = 0
        var y: CGFloat = 0
        while y <= size.height {
            if i % 5 == 0 { hline(&bold, y, size.width) } else { hline(&fine, y, size.width) }
            y += step
            i += 1
        }
        ctx.stroke(fine, with: .color(Blueprint.ink.opacity(0.06)), lineWidth: 0.6)
        ctx.stroke(bold, with: .color(Blueprint.ink.opacity(0.15)), lineWidth: 0.8)
    }

    private static func vline(_ p: inout Path, _ x: CGFloat, _ h: CGFloat) {
        p.move(to: CGPoint(x: x, y: 0))
        p.addLine(to: CGPoint(x: x, y: h))
    }

    private static func hline(_ p: inout Path, _ y: CGFloat, _ w: CGFloat) {
        p.move(to: CGPoint(x: 0, y: y))
        p.addLine(to: CGPoint(x: w, y: y))
    }

    /// Схема по ширине экрана (медленно плавает, если выше экрана) и проходящий сверху вниз «скан».
    static func drawScheme(_ ctx: GraphicsContext, _ size: CGSize, _ t: Double) {
        let iw: CGFloat = size.width * 0.95
        let ih: CGFloat = iw * 870.0 / 590.0
        let x0: CGFloat = (size.width - iw) / 2
        var y0: CGFloat = (size.height - ih) / 2
        if ih > size.height {
            let room: CGFloat = ih - size.height
            let k: Double = 0.5 + 0.5 * sin(t * 2.0 * Double.pi / 60.0)
            y0 = -room * CGFloat(k)
        }
        let rect = CGRect(x: x0, y: y0, width: iw, height: ih)
        let img = ctx.resolve(Image("schematic"))
        let inkColor: Color = Blueprint.ink
        var base = ctx
        base.opacity = 0.33
        base.drawLayer { layer in
            layer.draw(img, in: rect)
            layer.blendMode = .sourceIn          // белая схема подкрашивается в цвет чернил
            layer.fill(Path(rect), with: .color(inkColor))
        }

        // скан: полоса проходит экран за 7 с, в ней схема ярче
        let band: CGFloat = 70
        let p: Double = (t / 7.0).truncatingRemainder(dividingBy: 1.0)
        let ly: CGFloat = -band / 2 + (size.height + band) * CGFloat(p)
        let bandRect = CGRect(x: 0, y: ly - band / 2, width: size.width, height: band)
        let fade = Gradient(colors: [Blueprint.ink.opacity(0), Blueprint.ink, Blueprint.ink.opacity(0)])
        let top = CGPoint(x: 0, y: bandRect.minY)
        let bottom = CGPoint(x: 0, y: bandRect.maxY)
        var lit = ctx
        lit.opacity = 0.9
        lit.drawLayer { layer in
            layer.clip(to: Path(bandRect))
            layer.draw(img, in: rect)
            layer.blendMode = .sourceIn
            layer.fill(Path(rect), with: .color(inkColor))
            layer.blendMode = .destinationIn
            layer.fill(Path(bandRect), with: .linearGradient(fade, startPoint: top, endPoint: bottom))
        }
        let haze = Gradient(colors: [Blueprint.ink.opacity(0), Blueprint.ink.opacity(0.06), Blueprint.ink.opacity(0)])
        ctx.fill(Path(bandRect), with: .linearGradient(haze, startPoint: top, endPoint: bottom))
        var line = ctx
        line.addFilter(.shadow(color: Blueprint.ink.opacity(0.9), radius: 4))
        line.fill(Path(CGRect(x: 0, y: ly - 0.5, width: size.width, height: 1)), with: .color(Blueprint.ink.opacity(0.5)))
    }
}

/// Фон «Чертежа»: заливка с виньеткой, миллиметровка, схема со сканом, штамп.
struct BlueprintBackground: View {
    var body: some View {
        // всё внутри TimelineView: пока тянут ползунок светлоты, бумага и чернила меняются сразу
        GeometryReader { g in
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { tl in
                layers(g.size, t: Prism.time(tl.date))
            }
        }
        .clipped()
        .allowsHitTesting(false)
    }

    private func layers(_ size: CGSize, t: Double) -> some View {
        ZStack {
            paper(size)
            Canvas { ctx, sz in Blueprint.drawGrid(ctx, sz) }
            Canvas { ctx, sz in Blueprint.drawScheme(ctx, sz, t) }
            BlueprintStamp().position(x: size.width - 75 - 14, y: size.height - 32 - 14)
        }
    }

    private func paper(_ size: CGSize) -> some View {
        let r: CGFloat = max(size.width, size.height) * 0.75
        let stops: [Gradient.Stop] = [.init(color: Blueprint.bg, location: 0.45),
                                      .init(color: Blueprint.edge, location: 1)]
        return RadialGradient(gradient: Gradient(stops: stops), center: .center, startRadius: 0, endRadius: r)
    }
}

/// Штамп чертежа в правом нижнем углу.
struct BlueprintStamp: View {
    private var ink: Color { Blueprint.ink.opacity(0.55) }

    var body: some View {
        VStack(spacing: 0) {
            row("MODEL", "KRISA IR-REMOTE")
            hRule
            row("DRAWN BY", "krisa")
            hRule
            HStack(spacing: 0) {
                cell("SCALE 1:1")
                vRule
                cell("REV. A")
            }
        }
        .frame(width: 150, height: 64)
        .overlay(Rectangle().stroke(ink, lineWidth: 1))
    }

    private var hRule: some View { Rectangle().fill(ink).frame(height: 1) }
    private var vRule: some View { Rectangle().fill(ink).frame(width: 1) }

    private func row(_ key: String, _ value: String) -> some View {
        HStack(spacing: 0) {
            Text(key).font(Blueprint.semi(8)).foregroundColor(ink)
                .frame(width: 48, alignment: .leading).padding(.leading, 4)
            vRule
            Text(value).font(Blueprint.semi(9)).foregroundColor(Blueprint.ink.opacity(0.75))
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 5)
        }
        .frame(maxHeight: .infinity)
    }

    private func cell(_ text: String) -> some View {
        Text(text).font(Blueprint.semi(9)).foregroundColor(Blueprint.ink.opacity(0.75))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Штриховка 45°.
struct Hatch45: Shape {
    var step: CGFloat = 8.5
    func path(in r: CGRect) -> Path {
        var p = Path()
        var x: CGFloat = r.minX - r.height
        while x < r.maxX {
            p.move(to: CGPoint(x: x, y: r.maxY))
            p.addLine(to: CGPoint(x: x + r.height, y: r.minY))
            x += step
        }
        return p
    }
}

/// Метки совмещения «+» снаружи углов.
struct RegMarks: Shape {
    var gap: CGFloat = 4
    var arm: CGFloat = 3
    func path(in r: CGRect) -> Path {
        var p = Path()
        let pts: [CGPoint] = [CGPoint(x: r.minX - gap, y: r.minY - gap), CGPoint(x: r.maxX + gap, y: r.minY - gap),
                              CGPoint(x: r.minX - gap, y: r.maxY + gap), CGPoint(x: r.maxX + gap, y: r.maxY + gap)]
        for c in pts {
            p.move(to: CGPoint(x: c.x - arm, y: c.y))
            p.addLine(to: CGPoint(x: c.x + arm, y: c.y))
            p.move(to: CGPoint(x: c.x, y: c.y - arm))
            p.addLine(to: CGPoint(x: c.x, y: c.y + arm))
        }
        return p
    }
}

/// Кнопка пульта в «Чертеже». hatch — сила штриховки (1 — только что нажата), scan — ход полосы 0…1.
struct BlueprintKey: View {
    let label: String
    let index: Int
    let code: UInt32
    let inverted: Bool
    let hatch: Double
    let scan: Double
    let size: CGSize

    private var ink: Color { inverted ? Blueprint.bg : Blueprint.ink }
    private var fill: Color { inverted ? Blueprint.ink : Blueprint.bg.opacity(0.78) }
    private var fontSize: CGFloat {
        let k: CGFloat = size.width / CGFloat(max(6, label.count))
        return min(22, k * 1.05)
    }

    var body: some View {
        ZStack {
            Rectangle().fill(fill)
            if hatch > 0.01 {
                Hatch45().stroke(ink.opacity(0.35 * hatch), lineWidth: 1)
            }
            Rectangle().strokeBorder(inverted ? Blueprint.ink : ink, lineWidth: 1.5)
            Rectangle().strokeBorder(ink.opacity(0.45), lineWidth: 0.7).padding(4)
            if scan >= 0 && scan < 1 { scanBar }
            Blueprint.caps(label, fontSize).foregroundColor(ink)
                .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 10)
            corners
        }
        .clipped()
        .overlay(RegMarks().stroke(Blueprint.ink.opacity(0.8), lineWidth: 1))
    }

    private var scanBar: some View {
        let y: CGFloat = CGFloat(scan) * size.height
        let a: Double = 1 - scan
        return Rectangle().fill(ink.opacity(0.8 * a)).frame(height: 2)
            .shadow(color: ink.opacity(0.6 * a), radius: 6)
            .position(x: size.width / 2, y: y)
    }

    private var corners: some View {
        VStack {
            HStack {
                Text(String(format: "FIG.%02d", index + 1))
                Spacer()
            }
            Spacer()
            HStack {
                Spacer()
                Text(String(format: "0x%02X", (code >> 8) & 0xFF))
            }
        }
        .font(Blueprint.semi(10))
        .foregroundColor(ink.opacity(0.75))
        .padding(.horizontal, 9).padding(.vertical, 7)
    }
}

/// Крыса на заставке «Чертежа»: только контур (утолщённый силуэт минус сам силуэт) и слабая заливка.
struct BlueprintRat: View {
    private static let offsets: [CGSize] = [
        CGSize(width: 2, height: 0), CGSize(width: -2, height: 0), CGSize(width: 0, height: 2), CGSize(width: 0, height: -2),
        CGSize(width: 1.4, height: 1.4), CGSize(width: -1.4, height: 1.4), CGSize(width: 1.4, height: -1.4), CGSize(width: -1.4, height: -1.4),
    ]

    var body: some View {
        ZStack {
            silhouette(Blueprint.ink.opacity(0.08))
            outline
        }
    }

    private func silhouette(_ c: Color) -> some View {
        c.mask(Image("rat").resizable())
    }

    private var outline: some View {
        ZStack {
            ForEach(0..<BlueprintRat.offsets.count, id: \.self) { i in
                silhouette(Blueprint.ink).offset(BlueprintRat.offsets[i])
            }
            silhouette(Blueprint.ink).blendMode(.destinationOut)
        }
        .compositingGroup()
    }
}

/// Размерные линии вокруг крысы: «420 mm», «260 mm», подпись «Fig.1 — RAT» и выноска «TAIL».
struct BlueprintDims: View {
    let rw: CGFloat
    let rh: CGFloat
    static let margin: CGFloat = 64

    var body: some View {
        Canvas { ctx, size in BlueprintDims.draw(ctx, rw: rw, rh: rh) }
            .frame(width: rw + BlueprintDims.margin * 2, height: rh + BlueprintDims.margin * 2)
            .allowsHitTesting(false)
    }

    private static func label(_ s: String, _ size: CGFloat) -> Text {
        Text(s).font(Blueprint.semi(size)).foregroundColor(Blueprint.ink.opacity(0.9))
    }

    /// Засечка 45° на конце размерной линии.
    private static func tick(_ p: inout Path, _ c: CGPoint) {
        p.move(to: CGPoint(x: c.x - 4, y: c.y + 4))
        p.addLine(to: CGPoint(x: c.x + 4, y: c.y - 4))
    }

    static func draw(_ ctx: GraphicsContext, rw: CGFloat, rh: CGFloat) {
        let m: CGFloat = margin
        let left: CGFloat = m
        let right: CGFloat = m + rw
        let top: CGFloat = m
        let bottom: CGFloat = m + rh
        var p = Path()
        // снизу: 420 mm
        let by: CGFloat = bottom + 16
        p.move(to: CGPoint(x: left, y: bottom + 4)); p.addLine(to: CGPoint(x: left, y: by + 5))
        p.move(to: CGPoint(x: right, y: bottom + 4)); p.addLine(to: CGPoint(x: right, y: by + 5))
        p.move(to: CGPoint(x: left, y: by)); p.addLine(to: CGPoint(x: right, y: by))
        tick(&p, CGPoint(x: left, y: by))
        tick(&p, CGPoint(x: right, y: by))
        // слева: 260 mm
        let lx: CGFloat = left - 16
        p.move(to: CGPoint(x: left - 4, y: top)); p.addLine(to: CGPoint(x: lx - 5, y: top))
        p.move(to: CGPoint(x: left - 4, y: bottom)); p.addLine(to: CGPoint(x: lx - 5, y: bottom))
        p.move(to: CGPoint(x: lx, y: top)); p.addLine(to: CGPoint(x: lx, y: bottom))
        tick(&p, CGPoint(x: lx, y: top))
        tick(&p, CGPoint(x: lx, y: bottom))
        // выноска к хвосту
        let tail = CGPoint(x: left + rw * 0.96, y: top + rh * 0.35)
        let knee = CGPoint(x: right + 8, y: top - 14)
        let end = CGPoint(x: right + 40, y: top - 14)
        p.move(to: tail); p.addLine(to: knee); p.addLine(to: end)
        ctx.stroke(p, with: .color(Blueprint.ink.opacity(0.75)), lineWidth: 1)
        ctx.fill(Path(ellipseIn: CGRect(x: tail.x - 2, y: tail.y - 2, width: 4, height: 4)), with: .color(Blueprint.ink))

        ctx.draw(label("420 mm", 11), at: CGPoint(x: (left + right) / 2, y: by + 3), anchor: .top)
        ctx.draw(label("TAIL", 10), at: CGPoint(x: end.x, y: end.y - 2), anchor: .bottomTrailing)
        ctx.draw(label("Fig.1 — RAT", 11), at: CGPoint(x: left, y: top - 10), anchor: .bottomLeading)
        var rot = ctx
        rot.translateBy(x: lx - 3, y: (top + bottom) / 2)
        rot.rotate(by: .degrees(-90))
        rot.draw(label("260 mm", 11), at: .zero, anchor: .bottom)
    }
}

/// Ползунок светлоты чертежа: ⬜ — дорожка-градиент с меткой 🟦 посередине и бегунком «|» — ⬛.
struct BlueprintShadeSlider: View {
    let value: Double
    let onDrag: (Double) -> Void
    let onDone: (Double) -> Void

    private static let rim = Color(hex: 0x7F8899)
    private static let colors: [Color] = [Color(hex: Blueprint.lightHex), Color(hex: Blueprint.midHex), Color(hex: Blueprint.darkHex)]

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 10) {
                swatch(Blueprint.lightHex)
                GeometryReader { g in track(width: g.size.width) }
                    .frame(height: 64)
                swatch(Blueprint.darkHex)
            }
            HStack {
                Text("светлее")
                Spacer()
                Text("темнее")
            }
            .font(Prism.body(12))
            .foregroundColor(Term.dim)
            .padding(.horizontal, 32)
        }
    }

    private func swatch(_ hex: UInt32) -> some View {
        Rectangle().fill(Color(hex: hex))
            .frame(width: 22, height: 22)
            .overlay(Rectangle().strokeBorder(BlueprintShadeSlider.rim, lineWidth: 1))
            .offset(y: 4)
    }

    private static func clamp(_ x: CGFloat, _ width: CGFloat) -> Double {
        if width <= 0 { return 0.5 }
        let k: CGFloat = x / width
        return Double(min(1, max(0, k)))
    }

    private func track(width: CGFloat) -> some View {
        let x: CGFloat = CGFloat(value) * width
        return ZStack {
            // метка «по умолчанию» (синий) над серединой
            Rectangle().fill(Color(hex: Blueprint.midHex)).frame(width: 10, height: 10)
                .overlay(Rectangle().strokeBorder(BlueprintShadeSlider.rim, lineWidth: 1))
                .position(x: width / 2, y: 7)
            LinearGradient(colors: BlueprintShadeSlider.colors, startPoint: .leading, endPoint: .trailing)
                .frame(width: width, height: 28)
                .overlay(Rectangle().strokeBorder(BlueprintShadeSlider.rim, lineWidth: 1))
                .position(x: width / 2, y: 36)
            Rectangle().fill(Color.white).frame(width: 4, height: 44)
                .overlay(Rectangle().stroke(Color(hex: Blueprint.darkHex), lineWidth: 1))
                .position(x: x, y: 36)
        }
        .frame(width: width, height: 64)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { v in onDrag(BlueprintShadeSlider.clamp(v.location.x, width)) }
            .onEnded { v in onDone(BlueprintShadeSlider.clamp(v.location.x, width)) })
    }
}

/// Вкладка «Цвет» темы «Чертёж»: светлота листа.
struct BlueprintPanel: View {
    @AppStorage("bpShade") private var bpShade = 0.5
    /// Значение, пока палец на ползунке.
    @State private var live: Double?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                Blueprint.caps("> оттенок чертежа", 15).foregroundColor(Term.fg)
                Text("Светлее — как светокопия: белая бумага и синие линии. Темнее — ночной чертёж.")
                    .font(Prism.body(13)).foregroundColor(Term.dim)
                    .fixedSize(horizontal: false, vertical: true)
                BlueprintShadeSlider(value: live ?? Blueprint.shade, onDrag: { v in drag(v) }, onDone: { v in done(v) })
                    .padding(.top, 6)
                resetButton.padding(.top, 8)
            }
            .padding(12)
            .background(Blueprint.bg.opacity(0.78))
            .overlay(Rectangle().strokeBorder(Term.fg, lineWidth: 1))
        }
    }

    private var resetButton: some View {
        Button { done(0.5) } label: {
            Blueprint.caps("по умолчанию", 13).foregroundColor(Term.fg)
                .frame(maxWidth: .infinity).frame(height: 40)
                .background(Blueprint.bg.opacity(0.78))
                .overlay(Rectangle().strokeBorder(Term.fg, lineWidth: 1))
        }
    }

    /// Пока тянут — меняется только фон (он перерисовывается каждый кадр).
    private func drag(_ v: Double) {
        live = v
        Blueprint.shade = v
    }

    /// Отпустили — сохранить; экран перестроится с новыми цветами.
    private func done(_ v: Double) {
        Blueprint.shade = v
        live = nil
        bpShade = v
    }
}
