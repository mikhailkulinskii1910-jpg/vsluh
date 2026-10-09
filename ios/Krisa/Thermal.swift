import SwiftUI
import UIKit

/**
 Тема «Тепловизор»: кадр тепловизора. Палитра ironbow (холод — фиолетовый, жар — жёлто-белый),
 жёлтые рамки обнаружения как PERSON_01XX, HUD (уголки, шкала температур, REC, дата), зерно матрицы,
 а на фоне медленно вращается радужка.
 */
enum Heat {
    static let pal: [UInt32] = [0x0B0418, 0x2E0B5E, 0x6B1585, 0xB51F7A, 0xE8382F, 0xFF7A1A, 0xFFC233, 0xFFF27A, 0xFFFFFF]
    static let yellow = Color(hex: 0xFFD43B)
    static let ink = Color(hex: 0x140700)
    static let glow = Color(hex: 0xFF4A12)

    /// Цвет «температуры» f = 0 (холодно) … 1 (раскалено).
    static func color(_ f: Double, alpha: Double = 1) -> Color {
        let x = min(max(f, 0), 1) * Double(pal.count - 1)
        let i = min(Int(x), pal.count - 2), k = x - Double(i)
        func ch(_ v: UInt32, _ s: UInt32) -> Double { Double((v >> s) & 0xFF) }
        func mix(_ s: UInt32) -> Double { (ch(pal[i], s) + (ch(pal[i + 1], s) - ch(pal[i], s)) * k) / 255 }
        return Color(.sRGB, red: mix(16), green: mix(8), blue: mix(0), opacity: alpha)
    }

    /// Тепловое пятно: в центре — самая горячая точка, к краям остывает и становится прозрачным.
    static func bloom(_ heat: Double) -> Gradient {
        Gradient(stops: [.init(color: color(heat), location: 0), .init(color: color(heat * 0.82), location: 0.28),
                         .init(color: color(heat * 0.6, alpha: 0.92), location: 0.52), .init(color: color(heat * 0.38, alpha: 0.67), location: 0.78),
                         .init(color: .clear, location: 1)])
    }

    /// Раскалённый градиент для текста.
    static let hot: [Color] = [0.45, 0.6, 0.75, 0.88, 1, 0.88, 0.75, 0.6, 0.45].map { color($0) }

    /// «Температура» для подписей: от комнатной до тела.
    static func temp(_ heat: Double) -> String { String(format: "%.1f°", 22.4 + heat * 14.8) }

    static let date: String = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US"); f.dateFormat = "MMM dd yyyy"
        return f.string(from: Date()).uppercased()
    }()

    /// Зерно матрицы: плитка случайных светлых точек, рисуется один раз.
    static let grain: UIImage = {
        let n = 128
        return UIGraphicsImageRenderer(size: CGSize(width: n, height: n)).image { rc in
            var g = SeededRandom(seed: 11)
            for y in 0..<n { for x in 0..<n {
                let v = Int(g.next() % 256)
                if v > 150 {
                    UIColor(red: 1, green: 0.9, blue: 0.82, alpha: CGFloat(v - 150) / 255).setFill()
                    rc.fill(CGRect(x: x, y: y, width: 1, height: 1))
                }
            } }
        }
    }()
}

/// Фон «Тепловизора»: вращающаяся радужка, зерно и HUD.
struct ThermalBackground: View {
    var body: some View {
        GeometryReader { g in
            TimelineView(.animation) { tl in
                ThermalFrame(t: Prism.time(tl.date), size: g.size)
            }
        }
        .clipped()
        .allowsHitTesting(false)
    }
}

/// Один кадр фона. Значения считаются заранее с явными типами — так компилятор Swift проверяет их быстро.
struct ThermalFrame: View {
    let t: Double
    let size: CGSize

    private var side: CGFloat {
        let base: CGFloat = min(size.width, size.height) * 1.18
        let pulse: CGFloat = CGFloat(1.0 + 0.025 * sin(t * 0.8))
        return base * pulse
    }
    private var grainShift: CGSize {
        CGSize(width: -CGFloat(Int(t * 31) % 64), height: -CGFloat(Int(t * 47) % 64))
    }

    var body: some View {
        ZStack {
            Color.black
            irisLayer
            grainLayer
            ThermalHud(t: t, size: size)
        }
    }

    // радужка вращается (оборот за ~80 с), края растворяются в чёрном
    private var irisLayer: some View {
        let s = side
        let fade = RadialGradient(stops: [.init(color: .black, location: 0.86), .init(color: .clear, location: 0.99)],
                                  center: .center, startRadius: 0, endRadius: s / 2)
        return Image("iris").resizable()
            .frame(width: s, height: s)
            .mask(fade)
            .rotationEffect(.degrees(t * 4.5))
            .position(x: size.width / 2, y: size.height / 2)
    }

    // зерно матрицы: плитка каждый кадр сдвигается
    private var grainLayer: some View {
        let sh = grainShift
        return Image(uiImage: Heat.grain).resizable(resizingMode: .tile)
            .frame(width: size.width + 128, height: size.height + 128)
            .offset(sh)
            .opacity(0.35)
            .position(x: size.width / 2 + 64, y: size.height / 2 + 64)
    }
}

/// HUD тепловизора: уголки кадра, шкала температур у правого края, REC и дата внизу.
struct ThermalHud: View {
    let t: Double
    let size: CGSize

    var body: some View {
        ZStack {
            Canvas { ctx, sz in ThermalHud.draw(ctx, sz) }
            dateLabel.position(x: size.width / 2, y: size.height - 12)
            recLabel.position(x: size.width - 46, y: size.height - 38)
        }
    }

    private var dateLabel: some View {
        Text(Heat.date + "   ZOOM:OFF").font(Term.mono(17)).foregroundColor(Color(hex: 0xFF9632, alpha: 0.8))
    }

    private var recLabel: some View {
        let on: Bool = Int(t * 1.25) % 2 == 0
        return HStack(spacing: 5) {
            Circle().fill(Color(hex: 0xFF3228)).frame(width: 7, height: 7).opacity(on ? 1 : 0)
            Text("REC").font(Term.mono(17)).foregroundColor(Color(hex: 0xFFF1DC, alpha: 0.8))
        }
    }

    private static func corner(_ p: inout Path, _ x: CGFloat, _ y: CGFloat, _ sx: CGFloat, _ sy: CGFloat) {
        let k: CGFloat = 22
        p.move(to: CGPoint(x: x + sx * k, y: y))
        p.addLine(to: CGPoint(x: x, y: y))
        p.addLine(to: CGPoint(x: x, y: y + sy * k))
    }

    static func draw(_ ctx: GraphicsContext, _ size: CGSize) {
        let m: CGFloat = 8
        let r: CGFloat = size.width - m
        let b: CGFloat = size.height - m
        var p = Path()
        corner(&p, m, m, 1, 1)
        corner(&p, r, m, -1, 1)
        corner(&p, m, b, 1, -1)
        corner(&p, r, b, -1, -1)
        ctx.stroke(p, with: .color(Heat.yellow.opacity(0.6)), lineWidth: 1.5)
        // шкала температур
        let top: CGFloat = size.height * 0.3
        let bot: CGFloat = size.height * 0.7
        let bx: CGFloat = size.width - 7
        let colors: [Color] = Heat.pal.map { Color(hex: $0) }
        ctx.fill(Path(CGRect(x: bx, y: top, width: 3, height: bot - top)),
                 with: .linearGradient(Gradient(colors: colors), startPoint: CGPoint(x: 0, y: bot), endPoint: CGPoint(x: 0, y: top)))
        var ticks = Path()
        for i in 0...8 {
            let y: CGFloat = top + (bot - top) * CGFloat(i) / 8
            ticks.move(to: CGPoint(x: bx - 3, y: y))
            ticks.addLine(to: CGPoint(x: bx, y: y))
        }
        ctx.stroke(ticks, with: .color(Color(hex: 0xFFF1DC, alpha: 0.55)), lineWidth: 1)
    }
}

/// Раскалённый текст: по нему медленно плывёт палитра ironbow, вокруг — оранжевое свечение.
struct HeatText: View {
    let text: String
    let font: Font
    var body: some View {
        TimelineView(.animation) { tl in
            let s = CGFloat((Prism.time(tl.date) / 5).truncatingRemainder(dividingBy: 1))
            heatBody(shift: s)
        }
    }
}

extension HeatText {
    private static let colors: [Color] = Heat.hot + Array(Heat.hot.dropFirst())

    func heatBody(shift s: CGFloat) -> some View {
        let grad = LinearGradient(colors: HeatText.colors,
                                  startPoint: UnitPoint(x: -s * 2, y: 0.5), endPoint: UnitPoint(x: 2 - s * 2, y: 0.5))
        let shape = Text(text).font(font).lineLimit(1).fixedSize()
        return Text(text).font(font).foregroundColor(.clear).lineLimit(1).fixedSize()
            .overlay(grad.mask(shape))
            .shadow(color: Heat.glow.opacity(0.75), radius: 10)
    }
}

/// Крыса на заставке — тепловое пятно: горячая середина, остывающие края, красный ореол.
struct HeatRat: View {
    var body: some View {
        RadialGradient(gradient: Heat.bloom(1), center: UnitPoint(x: 0.38, y: 0.58), startRadius: 0, endRadius: 260)
            .mask(Image("rat").resizable())
            .shadow(color: Color(hex: 0xE8382F), radius: 16)
            .shadow(color: Color(hex: 0xFF7A1A, alpha: 0.6), radius: 3)
    }
}
