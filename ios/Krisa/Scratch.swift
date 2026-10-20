import SwiftUI
import UIKit

/**
 Блоки редактора сценариев в стиле Scratch (как Android ScratchUi.kt): цвета категорий — из текущей темы,
 «паз» сверху и «выступ» снизу, шапка «когда нажата ▶» и C-образный блок «повторить».
 */
struct ScratchCat {
    let fill: Color
    let edge: Color
    /// Цвет подписи на блоке.
    let text: Color
    /// Текст на плашке выбора (цвета кромки) — по контрасту.
    let choiceText: Color
}

enum Scratch {
    /// Категории: 0 — шапка, 1 — устройство, 2 — команда, 3 — кондиционер, 4 — управление.
    static var event: ScratchCat { themed(0) }
    static var device: ScratchCat { themed(1) }
    static var command: ScratchCat { themed(2) }
    static var ac: ScratchCat { themed(3) }
    static var control: ScratchCat { themed(4) }
    /// Поле-число: «овал» цвета фона темы с текстом цвета темы.
    static var numberBack: Color { Term.bg }
    static var numberInk: Color { Term.fg }
    /// Высота выступа снизу: следующий блок наезжает на него.
    static let bump: CGFloat = 5
    /// Шрифт блоков — шрифт интерфейса темы, жирный.
    static var font: Font { Term.ru(14).bold() }

    /// Компоненты цвета 0…1.
    static func rgb(_ c: Color) -> Blueprint.RGB {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        return Blueprint.RGB(Double(r), Double(g), Double(b))
    }

    static func lum(_ c: Blueprint.RGB) -> Double {
        let a: Double = 0.299 * c.r
        let b: Double = 0.587 * c.g
        let d: Double = 0.114 * c.b
        return a + b + d
    }

    private static func cat(_ fill: Blueprint.RGB, _ edge: Blueprint.RGB, _ text: Color) -> ScratchCat {
        let choice: Color = lum(edge) > 0.5 ? Term.bg : Color.white
        return ScratchCat(fill: fill.color(), edge: edge.color(), text: text, choiceText: choice)
    }

    /// Цвета категории i в стилистике текущей темы (вместо стандартных цветов Scratch).
    static func themed(_ i: Int) -> ScratchCat {
        let k: Int = min(max(i, 0), 4)
        if Term.prism { return prismCat(k) }
        if Term.thermal { return thermalCat(k) }
        if Term.blueprint { return blueprintCat(k) }
        return terminalCat(k)
    }

    private static func terminalCat(_ i: Int) -> ScratchCat {
        let ks: [Double] = [0.85, 0.40, 0.28, 0.34, 0.18]
        let bg: Blueprint.RGB = rgb(Term.bg)
        let fg: Blueprint.RGB = rgb(Term.fg)
        let fill: Blueprint.RGB = bg.mix(fg, ks[i])
        let edge: Blueprint.RGB = i == 0 ? fg.scaled(0.7) : fg
        let text: Color = lum(fill) > 0.5 ? Term.bg : Term.fg
        return cat(fill, edge, text)
    }

    private static func prismCat(_ i: Int) -> ScratchCat {
        let order: [Int] = [0, 3, 2, 4, 1]
        let hex: [UInt32] = Prism.irisHex
        let c: Blueprint.RGB = Blueprint.RGB(hex: hex[order[i]])
        let fill: Blueprint.RGB = Blueprint.RGB(hex: 0x120E1F).mix(c, 0.62)
        return cat(fill, c, Color.white)
    }

    private static func thermalCat(_ i: Int) -> ScratchCat {
        let ts: [Double] = [0.95, 0.32, 0.52, 0.68, 0.82]
        let fill: Blueprint.RGB = rgb(Heat.color(ts[i]))
        let edge: Blueprint.RGB = fill.scaled(0.62)
        let text: Color = lum(fill) > 0.55 ? Heat.ink : Color.white
        return cat(fill, edge, text)
    }

    private static func blueprintCat(_ i: Int) -> ScratchCat {
        let ks: [Double] = [0.34, 0.17, 0.10, 0.13, 0.05]
        let ink: Blueprint.RGB = Blueprint.inkRGB
        let fill: Blueprint.RGB = Blueprint.paperRGB.mix(ink, ks[i])
        return cat(fill, ink, Blueprint.ink)
    }

    static func cat(_ b: SBlock) -> ScratchCat {
        switch b {
        case .dev: return device
        case .cmd: return command
        case .ac: return ac
        default: return control
        }
    }

    /// Подпись блока: текст (0), число в белом «овале» (1), выбор в плашке с «▾» (2).
    static func parts(_ b: SBlock) -> [ScratchPart] {
        switch b {
        case .dev(let d):
            let title: String = d >= 0 && d < ScriptStore.devices.count ? ScriptStore.devices[d].title : "?"
            return [ScratchPart("устройство ", 0), ScratchPart(title, 2)]
        case .cmd(let label, _):
            return [ScratchPart("отправить ", 0), ScratchPart(label, 2)]
        case .ac(let power, let mode, let temp, let fan):
            let v: String = power ? "вкл · " + mode.title + " · " + String(temp) + "° · " + fan.title : "выкл"
            return [ScratchPart("кондиционер ", 0), ScratchPart(v, 2)]
        case .delay(let sec):
            return [ScratchPart("ждать ", 0), ScratchPart(ScriptStore.fmt(sec), 1), ScratchPart(" сек", 0)]
        case .loop(let n):
            return [ScratchPart("повторить ", 0), ScratchPart(String(n), 1), ScratchPart(" раз", 0)]
        case .end:
            return []
        }
    }
}

struct ScratchPart {
    let text: String
    let kind: Int
    init(_ text: String, _ kind: Int) {
        self.text = text
        self.kind = kind
    }
}

/// Подпись блока: белый жирный текст и поля.
struct ScratchLabel: View {
    let parts: [ScratchPart]
    let cat: ScratchCat

    var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<parts.count, id: \.self) { i in part(parts[i]) }
        }
        .lineLimit(1)
    }

    @ViewBuilder private func part(_ p: ScratchPart) -> some View {
        if p.kind == 1 {
            Text(p.text).font(Scratch.font).foregroundColor(Scratch.numberInk)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Capsule().fill(Scratch.numberBack))
        } else if p.kind == 2 {
            Text(p.text + "  ▾").font(Scratch.font).foregroundColor(cat.choiceText)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Capsule().fill(cat.edge))
        } else {
            Text(p.text).font(Scratch.font).foregroundColor(cat.text)
        }
    }
}

/**
 Форма блока. kind: 0 — обычный, 1 — шапка (круглая «шляпа», без паза), 2 — C-блок «повторить»
 (верхняя полка высотой top, левая «рука» шириной arm, нижняя полка высотой bottom). Выступ снизу — внутри рамки.
 */
struct ScratchShape: Shape {
    var kind: Int = 0
    var top: CGFloat = 0
    var arm: CGFloat = 0
    var bottom: CGFloat = 0

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let l: CGFloat = rect.minX
        let t: CGFloat = rect.minY
        let r: CGFloat = rect.maxX
        let btm: CGFloat = rect.maxY - Scratch.bump
        let rr: CGFloat = 4
        if kind == 1 {
            p.move(to: CGPoint(x: l, y: t + 18))
            p.addQuadCurve(to: CGPoint(x: l + 90, y: t + 14), control: CGPoint(x: l + 40, y: t - 6))
            p.addLine(to: CGPoint(x: r - rr, y: t + 14))
            p.addQuadCurve(to: CGPoint(x: r, y: t + 14 + rr), control: CGPoint(x: r, y: t + 14))
        } else {
            p.move(to: CGPoint(x: l, y: t + rr))
            p.addQuadCurve(to: CGPoint(x: l + rr, y: t), control: CGPoint(x: l, y: t))
            notchDown(&p, x: l, y: t)
            p.addLine(to: CGPoint(x: r - rr, y: t))
            p.addQuadCurve(to: CGPoint(x: r, y: t + rr), control: CGPoint(x: r, y: t))
        }
        if kind == 2 { mouth(&p, l: l, t: t, r: r, btm: btm, rr: rr) }
        p.addLine(to: CGPoint(x: r, y: btm - rr))
        p.addQuadCurve(to: CGPoint(x: r - rr, y: btm), control: CGPoint(x: r, y: btm))
        bumpBack(&p, x: l, y: btm)
        p.addLine(to: CGPoint(x: l + rr, y: btm))
        p.addQuadCurve(to: CGPoint(x: l, y: btm - rr), control: CGPoint(x: l, y: btm))
        p.closeSubpath()
        return p
    }

    /// Паз (вогнутая трапеция x 12…32), путь слева направо.
    private func notchDown(_ p: inout Path, x: CGFloat, y: CGFloat) {
        p.addLine(to: CGPoint(x: x + 12, y: y))
        p.addLine(to: CGPoint(x: x + 16, y: y + Scratch.bump))
        p.addLine(to: CGPoint(x: x + 28, y: y + Scratch.bump))
        p.addLine(to: CGPoint(x: x + 32, y: y))
    }

    /// Выступ вниз, путь справа налево.
    private func bumpBack(_ p: inout Path, x: CGFloat, y: CGFloat) {
        p.addLine(to: CGPoint(x: x + 32, y: y))
        p.addLine(to: CGPoint(x: x + 28, y: y + Scratch.bump))
        p.addLine(to: CGPoint(x: x + 16, y: y + Scratch.bump))
        p.addLine(to: CGPoint(x: x + 12, y: y))
    }

    /// «Рот» C-блока: нижний край верхней полки с выступом внутрь, рука, верх нижней полки с пазом.
    private func mouth(_ p: inout Path, l: CGFloat, t: CGFloat, r: CGFloat, btm: CGFloat, rr: CGFloat) {
        let ty: CGFloat = t + top
        let ax: CGFloat = l + arm
        p.addLine(to: CGPoint(x: r, y: ty - rr))
        p.addQuadCurve(to: CGPoint(x: r - rr, y: ty), control: CGPoint(x: r, y: ty))
        bumpBack(&p, x: ax, y: ty)
        p.addLine(to: CGPoint(x: ax + rr, y: ty))
        p.addQuadCurve(to: CGPoint(x: ax, y: ty + rr), control: CGPoint(x: ax, y: ty))
        let by: CGFloat = btm - bottom
        p.addLine(to: CGPoint(x: ax, y: by - rr))
        p.addQuadCurve(to: CGPoint(x: ax + rr, y: by), control: CGPoint(x: ax, y: by))
        notchDown(&p, x: ax, y: by)
        p.addLine(to: CGPoint(x: r - rr, y: by))
        p.addQuadCurve(to: CGPoint(x: r, y: by + rr), control: CGPoint(x: r, y: by))
    }
}

/// Фон блока: заливка категории и кромка (у выполняемого — белая рамка 3, как в Scratch).
struct ScratchBack: View {
    let shape: ScratchShape
    let cat: ScratchCat
    let lit: Bool

    var body: some View {
        ZStack {
            shape.fill(cat.fill)
            shape.stroke(lit ? Color.white : cat.edge, lineWidth: lit ? 3 : 1)
        }
    }
}
