import SwiftUI

/// HSV → 0xRRGGBB. h — градусы (любые, берутся по модулю 360), s и v — 0…1.
func hsvToHex(_ h: Double, _ s: Double, _ v: Double) -> UInt32 {
    var hh: Double = h.truncatingRemainder(dividingBy: 360)
    if hh < 0 { hh += 360 }
    let c: Double = v * s
    let x6: Double = hh / 60
    let k: Double = abs(x6.truncatingRemainder(dividingBy: 2) - 1)
    let x: Double = c * (1 - k)
    let m: Double = v - c
    var r: Double = 0
    var g: Double = 0
    var b: Double = 0
    switch Int(x6) % 6 {
    case 0: r = c; g = x
    case 1: r = x; g = c
    case 2: g = c; b = x
    case 3: g = x; b = c
    case 4: r = x; b = c
    default: r = c; b = x
    }
    return (hexByte(r + m) << 16) | (hexByte(g + m) << 8) | hexByte(b + m)
}

private func hexByte(_ v: Double) -> UInt32 {
    let x: Double = (v * 255).rounded()
    return UInt32(min(255, max(0, x)))
}

/// Оттенок цвета 0xRRGGBB в градусах.
func hueOf(_ hex: UInt32) -> Double {
    let r: Double = Double((hex >> 16) & 0xFF) / 255
    let g: Double = Double((hex >> 8) & 0xFF) / 255
    let b: Double = Double(hex & 0xFF) / 255
    let mx: Double = max(r, max(g, b))
    let mn: Double = min(r, min(g, b))
    let d: Double = mx - mn
    if d <= 0 { return 0 }
    var h: Double
    if mx == r {
        h = (g - b) / d
    } else if mx == g {
        h = (b - r) / d + 2
    } else {
        h = (r - g) / d + 4
    }
    h *= 60
    if h < 0 { h += 360 }
    return h
}

/// Насыщенность и яркость цвета 0xRRGGBB (HSV).
func satValOf(_ hex: UInt32) -> (Double, Double) {
    let r: Double = Double((hex >> 16) & 0xFF) / 255
    let g: Double = Double((hex >> 8) & 0xFF) / 255
    let b: Double = Double(hex & 0xFF) / 255
    let mx: Double = max(r, max(g, b))
    let mn: Double = min(r, min(g, b))
    if mx <= 0 { return (0, 0) }
    return ((mx - mn) / mx, mx)
}

/// Рисованный ползунок: дорожка-градиент, метка значения по умолчанию над ней и бегунок «|».
/// Пока палец ведёт — onDrag, при отпускании — onDone. Значения 0…1.
struct TrackSlider: View {
    let value: Double
    /// Где стоит метка значения по умолчанию.
    let mark: Double
    let markColor: Color
    let track: [Color]
    let leftText: String
    let rightText: String
    let onDrag: (Double) -> Void
    let onDone: (Double) -> Void

    private static let rim = Color(hex: 0x7F8899)

    var body: some View {
        VStack(spacing: 2) {
            GeometryReader { g in trackBody(width: g.size.width) }
                .frame(height: 64)
            if !leftText.isEmpty || !rightText.isEmpty { captions }
        }
    }

    private var captions: some View {
        HStack {
            Text(leftText)
            Spacer()
            Text(rightText)
        }
        .font(Term.ru(12))
        .foregroundColor(Term.dim)
    }

    private static func clamp(_ x: CGFloat, _ width: CGFloat) -> Double {
        if width <= 0 { return 0 }
        let k: CGFloat = x / width
        return Double(min(1, max(0, k)))
    }

    private func trackBody(width: CGFloat) -> some View {
        let x: CGFloat = CGFloat(value) * width
        let mx: CGFloat = CGFloat(mark) * width
        return ZStack {
            Rectangle().fill(markColor).frame(width: 10, height: 10)
                .overlay(Rectangle().strokeBorder(TrackSlider.rim, lineWidth: 1))
                .position(x: mx, y: 7)
            LinearGradient(colors: track, startPoint: .leading, endPoint: .trailing)
                .frame(width: width, height: 28)
                .overlay(Rectangle().strokeBorder(TrackSlider.rim, lineWidth: 1))
                .position(x: width / 2, y: 36)
            Rectangle().fill(Color.white).frame(width: 4, height: 44)
                .overlay(Rectangle().stroke(Color(hex: 0x05070D), lineWidth: 1))
                .position(x: x, y: 36)
        }
        .frame(width: width, height: 64)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { v in onDrag(TrackSlider.clamp(v.location.x, width)) }
            .onEnded { v in onDone(TrackSlider.clamp(v.location.x, width)) })
    }
}

/// Стиль кнопки, сообщающий о нажатии и отпускании. Внутри ScrollView так прокрутка работает:
/// нажатие засчитывается, только если палец не повёл экран, а начало прокрутки — это отпускание.
struct PressReport: ButtonStyle {
    let onPress: (Bool) -> Void
    func makeBody(configuration: Configuration) -> some View {
        PressBody(label: configuration.label, pressed: configuration.isPressed, onPress: onPress)
    }
}

struct PressBody<Label: View>: View {
    let label: Label
    let pressed: Bool
    let onPress: (Bool) -> Void
    var body: some View {
        label.onChange(of: pressed) { p in onPress(p) }
    }
}
