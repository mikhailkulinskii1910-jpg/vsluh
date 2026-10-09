import SwiftUI
import UIKit

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }
}

/**
 Тема «Призма»: чёрный фон, плывущие пятна света, веер лучей призмы и радужный отблеск,
 кнопки из жидкого стекла, преломляющего фон под собой.
 */
enum Prism {
    /// Фиолетовый → бирюзовый → мятный → жёлтый → коралловый → розовый.
    static let irisHex: [UInt32] = [0x8B6CFF, 0x3FE0FF, 0x62FFB8, 0xFFE66B, 0xFF8A5C, 0xFF5FD8, 0x8B6CFF]
    static let iris: [Color] = irisHex.map { Color(hex: $0) }
    static func iris(_ a: Double) -> [Color] { irisHex.map { Color(hex: $0, alpha: a) } }
    static let ink = Color(hex: 0x120E1F)

    static func display(_ size: CGFloat) -> Font { .custom("Unbounded-Medium", size: size) }
    static func body(_ size: CGFloat) -> Font { .custom("Manrope-Regular", size: size) }

    private static let start = Date()
    static func time(_ d: Date) -> Double { d.timeIntervalSince(start) }
    static var screen: CGSize { UIScreen.main.bounds.size }

    /// Движение пятен: частоты по x, y и фазы.
    private static let motion: [(Double, Double, Double, Double)] =
        [(0.11, 0.07, 0, 1.3), (0.07, 0.13, 2, 0.4), (0.09, 0.05, 4, 2.2), (0.05, 0.1, 1, 3.1), (0.13, 0.09, 3, 5)]

    /// Веер лучей: узкие цветные полосы через тёмные промежутки.
    private static let rays: Gradient = {
        var stops: [Gradient.Stop] = []
        let n = 14
        for i in 0..<n {
            let b = Double(i) / Double(n), st = 1 / Double(n)
            stops.append(.init(color: .clear, location: b))
            stops.append(.init(color: Color(hex: irisHex[i % 6], alpha: 0.13), location: b + st * 0.18))
            stops.append(.init(color: Color(hex: irisHex[(i + 1) % 6], alpha: 0.085), location: b + st * 0.32))
            stops.append(.init(color: .clear, location: b + st * 0.5))
        }
        stops.append(.init(color: .clear, location: 1))
        return Gradient(stops: stops)
    }()

    private static let sheen = Gradient(colors: [.clear, Color(hex: irisHex[0], alpha: 0.12), Color(hex: irisHex[1], alpha: 0.18),
                                                 Color(hex: irisHex[2], alpha: 0.16), Color(hex: irisHex[3], alpha: 0.13),
                                                 Color(hex: irisHex[4], alpha: 0.12), Color(hex: irisHex[5], alpha: 0.1), .clear])

    private static func ui(_ hex: UInt32, _ a: CGFloat) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
    }

    /// Вращающаяся стеклянная призма: бруски-лучи вокруг тёмной сферы. Рисуется один раз, потом только вращается.
    static let burstImage: UIImage = makeBurst(min(screen.width, screen.height) * 1.05)

    /// Тот же детерминированный узор, что в Android и веб-версии.
    private static func makeBurst(_ side: CGFloat) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { rc in
            let x = rc.cgContext
            let R = side / 2
            var seed: UInt64 = 20251009
            func rnd() -> CGFloat { seed = (seed &* 1103515245 &+ 12345) & 0x7fffffff; return CGFloat(seed) / 2147483648 }
            let cs = CGColorSpaceCreateDeviceRGB()
            func grad(_ cols: [UIColor], _ locs: [CGFloat]) -> CGGradient {
                CGGradient(colorsSpace: cs, colors: cols.map { $0.cgColor } as CFArray, locations: locs)!
            }
            let lw = max(0.5, side / 650)
            let n = 38
            for i in 0..<n {
                let ang = CGFloat(i) * 360 / CGFloat(n) + (rnd() - 0.5) * 6
                let r0 = R * (0.16 + rnd() * 0.14)
                let len = min(R * (0.30 + rnd() * 0.48), R * 0.97 - r0)
                let bw = R * (0.055 + rnd() * 0.07)
                let hollow = rnd() < 0.12
                let twin = rnd() < 0.35
                x.saveGState()
                x.translateBy(x: R, y: R)
                x.rotate(by: ang * .pi / 180)
                for k in 0..<(twin ? 2 : 1) {
                    let wk = k == 0 ? bw : bw * 0.6
                    let y0 = k == 0 ? -wk / 2 : bw / 2 + wk * 0.15
                    let y1 = y0 + wk
                    let x0 = k == 0 ? r0 : r0 + len * 0.15
                    let x1 = k == 0 ? r0 + len : r0 + len * 0.8
                    let ins = wk * 0.22
                    let rect = CGRect(x: x0, y: y0, width: x1 - x0, height: wk)
                    let inner = rect.insetBy(dx: ins, dy: ins)
                    if !hollow {
                        // тело бруска: стекло светлее к граням
                        x.saveGState(); x.clip(to: rect)
                        x.drawLinearGradient(grad([ui(0xFFFFFF, 0.43), ui(0xFFFFFF, 0.1), ui(0xC8DCFF, 0.12), ui(0xFFFFFF, 0.37)], [0, 0.3, 0.7, 1]),
                                             start: CGPoint(x: 0, y: y0), end: CGPoint(x: 0, y: y1), options: [])
                        x.restoreGState()
                        // тёмная середина — толщина стекла
                        x.setFillColor(ui(0, 0.41).cgColor); x.fill(inner)
                        // радужная грань: дисперсия вдоль бруска
                        let g = grad((0..<6).map { ui(irisHex[(i + $0) % 6], 0.84) }, [0, 0.2, 0.4, 0.6, 0.8, 1])
                        let face = (i + k) % 2 == 0 ? y0 + ins * 0.3 : y1 - ins * 1.6
                        let fr = CGRect(x: x0 + ins * 0.5, y: face, width: x1 - x0 - ins, height: ins * 1.3)
                        x.saveGState(); x.clip(to: fr)
                        x.drawLinearGradient(g, start: CGPoint(x: x0, y: 0), end: CGPoint(x: x1, y: 0), options: [])
                        x.restoreGState()
                        let mid = CGRect(x: x0 + ins, y: (y0 + y1) / 2 - wk * 0.08, width: x1 - x0 - 2 * ins, height: wk * 0.16)
                        x.saveGState(); x.setAlpha(0.35); x.clip(to: mid)
                        x.drawLinearGradient(g, start: CGPoint(x: x0, y: 0), end: CGPoint(x: x1, y: 0), options: [])
                        x.restoreGState()
                    }
                    // светлые рёбра и яркий торец
                    x.setLineWidth(lw)
                    x.setStrokeColor(ui(0xFFFFFF, hollow ? 0.67 : 0.9).cgColor); x.stroke(rect)
                    x.setStrokeColor(ui(0xFFFFFF, 0.31).cgColor); x.stroke(inner)
                    x.setFillColor(ui(0xFFFFFF, 0.92).cgColor); x.fill(CGRect(x: x1 - lw * 1.5, y: y0, width: lw * 1.5, height: wk))
                }
                x.restoreGState()
            }
            // тёмная сфера с голубым ободком и бликом
            let sr = R * 0.15
            let c = CGPoint(x: R, y: R)
            x.drawRadialGradient(grad([ui(0, 1), ui(0, 1), ui(0x2C5BFF, 1), ui(0xFFFFFF, 1)], [0, 0.78, 0.93, 1]),
                                 startCenter: c, startRadius: 0, endCenter: c, endRadius: sr, options: [])
            let hc = CGPoint(x: R - sr * 0.35, y: R - sr * 0.4)
            x.drawRadialGradient(grad([ui(0xFFFFFF, 0.67), ui(0xFFFFFF, 0)], [0, 1]),
                                 startCenter: hc, startRadius: 0, endCenter: hc, endRadius: sr * 0.45, options: [])
            x.setStrokeColor(ui(0x8FA8FF, 0.9).cgColor); x.setLineWidth(R * 0.012)
            x.strokeEllipse(in: CGRect(x: R - sr * 0.97, y: R - sr * 0.97, width: sr * 1.94, height: sr * 1.94))
        }
    }

    /// Рисует сцену в координатах экрана (0..size); burstAlpha — яркость призмы (под стеклом кнопок тусклее, чтобы читались надписи).
    static func draw(_ ctx: GraphicsContext, size: CGSize, t: Double, burstAlpha: Double = 0.72) {
        let w = size.width, h = size.height
        let rect = Path(CGRect(origin: .zero, size: size))
        ctx.fill(rect, with: .color(Color(hex: 0x07060B)))
        var add = ctx
        add.blendMode = .plusLighter
        let r = max(w, h) * 0.42
        for (i, m) in motion.enumerated() {
            let c = irisHex[i]
            let cx = w * (0.5 + 0.42 * CGFloat(sin(t * m.0 * 6.28 + m.2)))
            let cy = h * (0.5 + 0.45 * CGFloat(sin(t * m.1 * 6.28 + m.3)))
            let g = Gradient(stops: [.init(color: Color(hex: c, alpha: 0.23), location: 0),
                                     .init(color: Color(hex: c, alpha: 0.055), location: 0.55),
                                     .init(color: .clear, location: 1)])
            add.fill(Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r)),
                     with: .radialGradient(g, center: CGPoint(x: cx, y: cy), startRadius: 0, endRadius: r))
        }
        // лучи призмы: источник над экраном, веер покачивается и медленно поворачивается
        let rc = CGPoint(x: w * (0.5 + 0.18 * CGFloat(sin(t * 0.21))), y: -h * 0.08)
        add.fill(rect, with: .conicGradient(rays, center: rc, angle: .degrees(t * 4 + 25 * sin(t * 0.17))))
        // радужный отблеск пробегает по диагонали раз в ~9 с
        let band = max(w, h) * 0.55
        let p = CGFloat(t.truncatingRemainder(dividingBy: 9) / 9)
        let sx = -band * 1.2 + (w + band * 1.6) * p, sy = -band * 0.6 + h * 0.5 * p
        add.fill(rect, with: .linearGradient(sheen, startPoint: CGPoint(x: sx, y: sy), endPoint: CGPoint(x: sx + band, y: sy + band * 0.6)))
        // вращающаяся стеклянная призма в центре
        var b = ctx
        b.opacity = burstAlpha
        let side = burstImage.size.width
        b.translateBy(x: w / 2, y: h * 0.48)
        b.rotate(by: .degrees(t * 6))
        b.draw(Image(uiImage: burstImage), in: CGRect(x: -side / 2, y: -side / 2, width: side, height: side))
        // затемнение к краям
        ctx.fill(rect, with: .radialGradient(Gradient(stops: [.init(color: .clear, location: 0.35), .init(color: .black.opacity(0.82), location: 1)]),
                                             center: CGPoint(x: w / 2, y: h * 0.45), startRadius: 0, endRadius: max(w, h) * 0.78))
    }
}

/// Фон «Призмы» на весь экран.
struct PrismBackground: View {
    var body: some View {
        TimelineView(.animation) { tl in
            Canvas { ctx, _ in Prism.draw(ctx, size: Prism.screen, t: Prism.time(tl.date)) }
        }
        .allowsHitTesting(false)
    }
}

/// Линза: фон, лежащий под элементом, увеличенный относительно его центра и чуть сдвинутый вниз (толщина стекла).
struct Lens: View {
    let t: Double
    var zoom: CGFloat = 1.18
    var body: some View {
        GeometryReader { g in
            let f = g.frame(in: .global)
            Canvas { ctx, size in
                var c = ctx
                c.translateBy(x: size.width / 2, y: size.height / 2)
                c.scaleBy(x: zoom, y: zoom)
                c.translateBy(x: -size.width / 2 - f.minX, y: -size.height / 2 - f.minY - 3)
                Prism.draw(c, size: Prism.screen, t: t, burstAlpha: 0.27)
            }
        }
    }
}

/// Плашка из жидкого стекла: преломлённый фон, матовость, блик, светлый край и радужная кайма.
struct GlassBody: View {
    let radius: CGFloat
    var on = false
    var pressed = false
    var hot: Double = 0
    var seed: Double = 0
    let t: Double

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let flow = CGFloat((t * 0.09).truncatingRemainder(dividingBy: 1))
        ZStack {
            Lens(t: t, zoom: CGFloat(1.18 + 0.22 * hot) + (pressed ? 0.08 : 0))
            if on {
                // включённая плашка — голограмма: перелив течёт по диагонали
                LinearGradient(colors: Prism.iris + Prism.iris.reversed().dropFirst(),
                               startPoint: UnitPoint(x: -flow * 2, y: 0), endPoint: UnitPoint(x: 2 - flow * 2, y: 1))
                    .opacity(pressed ? 0.68 : 0.82)
            }
            LinearGradient(stops: [.init(color: .white.opacity(pressed ? 0.25 : 0.16), location: 0),
                                   .init(color: .white.opacity(pressed ? 0.1 : 0.03), location: 0.55),
                                   .init(color: Color(hex: 0x78DCFF, alpha: 0.12), location: 1)],
                           startPoint: .top, endPoint: .bottom)
            EllipticalGradient(colors: [.white.opacity(0.3), .white.opacity(0.06), .clear],
                               center: UnitPoint(x: 0.22, y: 0), startRadiusFraction: 0, endRadiusFraction: 0.75)
            if hot > 0 {
                // перелив пробегает по кнопке после нажатия
                let x = CGFloat(-0.5 + 2 * (1 - hot))
                LinearGradient(colors: [.clear, Color(hex: 0x8C6CFF, alpha: 0.35 * hot), Color(hex: 0x3FE0FF, alpha: 0.43 * hot),
                                        Color(hex: 0xFF5FD8, alpha: 0.35 * hot), .clear],
                               startPoint: UnitPoint(x: x, y: 0), endPoint: UnitPoint(x: x + 0.5, y: 1))
            }
        }
        .clipShape(shape)
        .overlay(shape.strokeBorder(LinearGradient(stops: [.init(color: .white.opacity(0.82), location: 0),
                                                           .init(color: .white.opacity(0.16), location: 0.55),
                                                           .init(color: Color(hex: 0xC8BEFF, alpha: 0.45), location: 1)],
                                                   startPoint: .top, endPoint: .bottom), lineWidth: 1.2))
        .overlay(RoundedRectangle(cornerRadius: max(1, radius - 2.2), style: .continuous)
            .strokeBorder(AngularGradient(colors: Prism.iris, center: .center, angle: .degrees(seed * 37 + t * 24 + hot * 260)),
                          lineWidth: CGFloat(1.1 + 1.8 * hot))
            .opacity(on ? 0.43 : 0.47 + 0.53 * hot)
            .padding(2.2))
        .shadow(color: .black.opacity(0.45), radius: 12, x: 0, y: 8)
    }
}

/// Стеклянная плашка со своей анимацией — для кнопок шапки и настроек.
struct GlassBox: View {
    var radius: CGFloat = 16
    var on = false
    var seed: Double = 3
    var body: some View {
        TimelineView(.animation) { tl in
            GlassBody(radius: radius, on: on, seed: seed, t: Prism.time(tl.date))
        }
    }
}

/// Стеклянный текст: светлый сверху, сиреневый снизу, с объёмной тенью.
struct GlassText: View {
    let text: String
    let font: Font
    var dark = false
    var body: some View {
        if dark {
            Text(text).font(font).foregroundColor(Prism.ink).lineLimit(1)
        } else {
            Text(text).font(font).foregroundColor(.clear).lineLimit(1)
                .overlay(LinearGradient(stops: [.init(color: .white, location: 0.15), .init(color: Color(hex: 0xE9E3FF), location: 0.5),
                                                .init(color: Color(hex: 0xB9A9FF), location: 0.9)],
                                        startPoint: .top, endPoint: .bottom)
                    .mask(Text(text).font(font).lineLimit(1)))
                .shadow(color: Color(hex: 0x140A32, alpha: 0.7), radius: 2.5, x: 0, y: 1.5)
        }
    }
}

/// Радужный текст с текущим переливом и стеклянным бликом сверху (заголовок, «krisa» на заставке).
struct IrisText: View {
    let text: String
    let font: Font
    var body: some View {
        TimelineView(.animation) { tl in
            let s = CGFloat((Prism.time(tl.date) / 6).truncatingRemainder(dividingBy: 1))
            Text(text).font(font).foregroundColor(.clear).lineLimit(1).fixedSize()
                .overlay(ZStack {
                    LinearGradient(colors: Prism.iris + Prism.iris.reversed().dropFirst(),
                                   startPoint: UnitPoint(x: -s * 2, y: 0.5), endPoint: UnitPoint(x: 2 - s * 2, y: 0.5))
                    LinearGradient(stops: [.init(color: .white.opacity(0.6), location: 0), .init(color: .clear, location: 0.52)],
                                   startPoint: .top, endPoint: .bottom)
                }
                .mask(Text(text).font(font).lineLimit(1)))
                .shadow(color: Color(hex: 0x140A32, alpha: 0.6), radius: 2, x: 0, y: 2)
                .shadow(color: Color(hex: 0x8B6CFF, alpha: 0.55), radius: 12)
        }
    }
}

/// Крыса из жидкого стекла для заставки: внутри — увеличенный фон с радужным переливом и бликом,
/// по краю — светлый кант сверху-слева и бирюзовый снизу-справа; в полёте расходятся цветные «призраки».
struct GlassRat: View {
    let t: Double
    let moving: Bool
    private func silhouette(_ c: Color) -> some View {
        Image("rat").resizable().renderingMode(.template).foregroundColor(c)
    }
    var body: some View {
        let dx: CGFloat = moving ? 9 : 2.5
        let flow = CGFloat((t * 0.12).truncatingRemainder(dividingBy: 1))
        ZStack {
            silhouette(Color(hex: 0xFF3C8C, alpha: 0.6)).offset(x: -dx)
            silhouette(Color(hex: 0x32E1FF, alpha: 0.6)).offset(x: dx)
            silhouette(.white.opacity(0.92)).offset(x: -1.8, y: -1.8)
            silhouette(Color(hex: 0x50E1FF, alpha: 0.82)).offset(x: 1.8, y: 1.8)
            ZStack {
                Canvas { ctx, size in
                    // фон под крысой (она лежит в центре экрана), увеличенный линзой
                    var c = ctx
                    c.translateBy(x: size.width / 2, y: size.height / 2)
                    c.scaleBy(x: 1.35, y: 1.35)
                    c.translateBy(x: -Prism.screen.width / 2, y: -Prism.screen.height / 2)
                    Prism.draw(c, size: Prism.screen, t: t)
                }
                LinearGradient(colors: Prism.iris(0.37) + Prism.iris(0.37).reversed().dropFirst(),
                               startPoint: UnitPoint(x: -flow * 2, y: 0), endPoint: UnitPoint(x: 2 - flow * 2, y: 1))
                EllipticalGradient(colors: [.white.opacity(0.6), .white.opacity(0.1), .clear],
                                   center: UnitPoint(x: 0.3, y: 0.2), startRadiusFraction: 0, endRadiusFraction: 0.6)
                LinearGradient(stops: [.init(color: .clear, location: 0.55), .init(color: Color(hex: 0x5AE6FF, alpha: 0.32), location: 1)],
                               startPoint: .top, endPoint: .bottom)
            }
            .mask(Image("rat").resizable())
        }
        .shadow(color: Color(hex: 0x8B6CFF, alpha: 0.5), radius: 18)
    }
}
