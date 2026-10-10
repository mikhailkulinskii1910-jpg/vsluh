import SwiftUI

/**
 Тема «Чертёж»: синий лист blueprint с миллиметровкой, на фоне — схема, по ней проходит «скан»,
 в углу штамп. Кнопки — двойные рамки с метками совмещения, надписи Manrope заглавными.
 */
enum Blueprint {
    static let bgHex: UInt32 = 0x1A4A9E
    static let edgeHex: UInt32 = 0x10357A
    static var bg: Color { Color(hex: bgHex) }

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
        ctx.stroke(fine, with: .color(Color.white.opacity(0.06)), lineWidth: 0.6)
        ctx.stroke(bold, with: .color(Color.white.opacity(0.15)), lineWidth: 0.8)
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
        var base = ctx
        base.opacity = 0.33
        base.draw(img, in: rect)

        // скан: полоса проходит экран за 7 с, в ней схема ярче
        let band: CGFloat = 70
        let p: Double = (t / 7.0).truncatingRemainder(dividingBy: 1.0)
        let ly: CGFloat = -band / 2 + (size.height + band) * CGFloat(p)
        let bandRect = CGRect(x: 0, y: ly - band / 2, width: size.width, height: band)
        let fade = Gradient(colors: [Color.white.opacity(0), Color.white, Color.white.opacity(0)])
        let top = CGPoint(x: 0, y: bandRect.minY)
        let bottom = CGPoint(x: 0, y: bandRect.maxY)
        var lit = ctx
        lit.opacity = 0.9
        lit.drawLayer { layer in
            layer.clip(to: Path(bandRect))
            layer.draw(img, in: rect)
            layer.blendMode = .destinationIn
            layer.fill(Path(bandRect), with: .linearGradient(fade, startPoint: top, endPoint: bottom))
        }
        let haze = Gradient(colors: [Color.white.opacity(0), Color.white.opacity(0.06), Color.white.opacity(0)])
        ctx.fill(Path(bandRect), with: .linearGradient(haze, startPoint: top, endPoint: bottom))
        var line = ctx
        line.addFilter(.shadow(color: Color.white.opacity(0.9), radius: 4))
        line.fill(Path(CGRect(x: 0, y: ly - 0.5, width: size.width, height: 1)), with: .color(Color.white.opacity(0.5)))
    }
}

/// Фон «Чертежа»: заливка с виньеткой, миллиметровка, схема со сканом, штамп.
struct BlueprintBackground: View {
    var body: some View {
        GeometryReader { g in
            ZStack {
                paper(g.size)
                Canvas { ctx, size in Blueprint.drawGrid(ctx, size) }
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { tl in
                    Canvas { ctx, size in Blueprint.drawScheme(ctx, size, Prism.time(tl.date)) }
                }
                BlueprintStamp().position(x: g.size.width - 75 - 14, y: g.size.height - 32 - 14)
            }
        }
        .clipped()
        .allowsHitTesting(false)
    }

    private func paper(_ size: CGSize) -> some View {
        let r: CGFloat = max(size.width, size.height) * 0.75
        let stops: [Gradient.Stop] = [.init(color: Blueprint.bg, location: 0.45),
                                      .init(color: Color(hex: Blueprint.edgeHex), location: 1)]
        return RadialGradient(gradient: Gradient(stops: stops), center: .center, startRadius: 0, endRadius: r)
    }
}

/// Штамп чертежа в правом нижнем углу.
struct BlueprintStamp: View {
    private let ink = Color.white.opacity(0.55)

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
            Text(value).font(Blueprint.semi(9)).foregroundColor(Color.white.opacity(0.75))
                .lineLimit(1).minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 5)
        }
        .frame(maxHeight: .infinity)
    }

    private func cell(_ text: String) -> some View {
        Text(text).font(Blueprint.semi(9)).foregroundColor(Color.white.opacity(0.75))
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

    private var ink: Color { inverted ? Blueprint.bg : Color.white }
    private var fill: Color { inverted ? Color.white : Blueprint.bg.opacity(0.78) }
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
            Rectangle().strokeBorder(inverted ? Color.white : ink, lineWidth: 1.5)
            Rectangle().strokeBorder(ink.opacity(0.45), lineWidth: 0.7).padding(4)
            if scan >= 0 && scan < 1 { scanBar }
            Blueprint.caps(label, fontSize).foregroundColor(ink)
                .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 10)
            corners
        }
        .clipped()
        .overlay(RegMarks().stroke(Color.white.opacity(0.8), lineWidth: 1))
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
            silhouette(Color.white.opacity(0.08))
            outline
        }
    }

    private func silhouette(_ c: Color) -> some View {
        c.mask(Image("rat").resizable())
    }

    private var outline: some View {
        ZStack {
            ForEach(0..<BlueprintRat.offsets.count, id: \.self) { i in
                silhouette(Color.white).offset(BlueprintRat.offsets[i])
            }
            silhouette(Color.white).blendMode(.destinationOut)
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
        Text(s).font(Blueprint.semi(size)).foregroundColor(Color.white.opacity(0.9))
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
        ctx.stroke(p, with: .color(Color.white.opacity(0.75)), lineWidth: 1)
        ctx.fill(Path(ellipseIn: CGRect(x: tail.x - 2, y: tail.y - 2, width: 4, height: 4)), with: .color(Color.white))

        ctx.draw(label("420 mm", 11), at: CGPoint(x: (left + right) / 2, y: by + 3), anchor: .top)
        ctx.draw(label("TAIL", 10), at: CGPoint(x: end.x, y: end.y - 2), anchor: .bottomTrailing)
        ctx.draw(label("Fig.1 — RAT", 11), at: CGPoint(x: left, y: top - 10), anchor: .bottomLeading)
        var rot = ctx
        rot.translateBy(x: lx - 3, y: (top + bottom) / 2)
        rot.rotate(by: .degrees(-90))
        rot.draw(label("260 mm", 11), at: .zero, anchor: .bottom)
    }
}
