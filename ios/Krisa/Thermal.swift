import SwiftUI
import UIKit

/**
 Тема «Тепловизор»: кадр тепловизора. Палитры ironbow / white hot / rainbow / arctic (выбор во вкладке «Цвет»),
 рамки обнаружения как PERSON_01XX, HUD (уголки, шкала температур, REC, дата), зерно матрицы,
 а на фоне медленно вращается радужка.
 */
enum Heat {
    /// Палитра тепловизора: шкала от холодного к горячему и цвета интерфейса.
    struct Palette {
        let id: String
        let title: String
        let pal: [UInt32]
        let bg: UInt32
        let fg: UInt32
        let dim: UInt32
        /// Акцент: рамки обнаружения, HUD-уголки, подписи (в ironbow — жёлтый).
        let accent: UInt32
        let glow: UInt32
        let ink: UInt32
        /// Картинка радужки на фоне.
        let iris: String
    }

    static let palettes: [Palette] = [
        Palette(id: "ironbow", title: "IRONBOW",
                pal: [0x0B0418, 0x2E0B5E, 0x6B1585, 0xB51F7A, 0xE8382F, 0xFF7A1A, 0xFFC233, 0xFFF27A, 0xFFFFFF],
                bg: 0x050308, fg: 0xFFF1DC, dim: 0xE0974A, accent: 0xFFD43B, glow: 0xFF4A12, ink: 0x140700, iris: "iris"),
        Palette(id: "white", title: "WHITE HOT",
                pal: [0x050505, 0x1E1E22, 0x3C3C42, 0x616168, 0x8A8A90, 0xB2B2B6, 0xD6D6D8, 0xF0F0F0, 0xFFFFFF],
                bg: 0x050505, fg: 0xF2F2F2, dim: 0xA3A8AE, accent: 0x4DFF7A, glow: 0xD0D8E0, ink: 0x0A0A0A, iris: "iris_white"),
        Palette(id: "rainbow", title: "RAINBOW HC",
                pal: [0x0A0030, 0x1A1AA8, 0x0070FF, 0x00C8E0, 0x00E060, 0xB8F000, 0xFFD000, 0xFF5000, 0xFF0030, 0xFFFFFF],
                bg: 0x07001F, fg: 0xFFFFFF, dim: 0x7FD6FF, accent: 0xFFFFFF, glow: 0xFF3060, ink: 0x10001A, iris: "iris_rainbow"),
        Palette(id: "arctic", title: "ARCTIC",
                pal: [0x020617, 0x0B1E5B, 0x1C47A8, 0x3C82E0, 0x8EC3F2, 0xE9D9A6, 0xF7B733, 0xFFD966, 0xFFFFFF],
                bg: 0x020617, fg: 0xF2F8FF, dim: 0x8EC3F2, accent: 0x7FE3FF, glow: 0xF7B733, ink: 0x04102A, iris: "iris_arctic"),
    ]

    static func find(_ id: String) -> Palette { palettes.first { $0.id == id } ?? palettes[0] }

    /// Выбранная палитра (ключ "heat": ironbow / white / rainbow / arctic).
    static var cur: Palette = Heat.find(UserDefaults.standard.string(forKey: "heat") ?? "ironbow")

    static var pal: [UInt32] { cur.pal }
    /// Акцентный цвет палитры (бывший жёлтый): рамки обнаружения, уголки, подписи.
    static var yellow: Color { Color(hex: cur.accent) }
    static var ink: Color { Color(hex: cur.ink) }
    static var glow: Color { Color(hex: cur.glow) }

    /// Цвет «температуры» f = 0 (холодно) … 1 (раскалено).
    static func color(_ f: Double, alpha: Double = 1) -> Color {
        let pal: [UInt32] = cur.pal
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
    static var hot: [Color] { [0.45, 0.6, 0.75, 0.88, 1, 0.88, 0.75, 0.6, 0.45].map { color($0) } }

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
            Color(hex: Heat.cur.bg)
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
        return Image(Heat.cur.iris).resizable()
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
        Text(Heat.date + "   ZOOM:OFF").font(Term.mono(17)).foregroundColor(Term.dim.opacity(0.8))
    }

    private var recLabel: some View {
        let on: Bool = Int(t * 1.25) % 2 == 0
        return HStack(spacing: 5) {
            Circle().fill(Color(hex: 0xFF3228)).frame(width: 7, height: 7).opacity(on ? 1 : 0)
            Text("REC").font(Term.mono(17)).foregroundColor(Term.fg.opacity(0.8))
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
        ctx.stroke(ticks, with: .color(Term.fg.opacity(0.55)), lineWidth: 1)
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
    private static var colors: [Color] {
        let hot: [Color] = Heat.hot
        return hot + Array(hot.dropFirst())
    }

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
            .shadow(color: Heat.color(0.5), radius: 16)
            .shadow(color: Heat.color(0.625, alpha: 0.6), radius: 3)
    }
}
