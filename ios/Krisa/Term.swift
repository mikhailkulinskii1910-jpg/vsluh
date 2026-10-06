import SwiftUI

/// Палитра и шрифты в духе чёрно-белого терминала.
enum Term {
    static let fg = Color(white: 0.93)
    static let dim = Color(white: 0.54)
    static let line = Color(white: 0.36)
    static let faint = Color(white: 0.085)
    static let noise = Array("#$%&@01<>/\\|=+*:;░▒▓")

    /// Пиксельный VT323 (латиница). Для русского — системный моноширинный: в VT323 нет кириллицы.
    static func mono(_ size: CGFloat) -> Font { .custom("VT323-Regular", size: size) }
    static func ru(_ size: CGFloat) -> Font { .system(size: size, design: .monospaced) }

    static func scramble(_ text: String, _ progress: Double) -> String {
        let shown = Int(Double(text.count) * progress)
        return String(text.enumerated().map { i, ch in
            i < shown || ch == " " ? ch : noise.randomElement()!
        })
    }

    /// Строки «лога» для фона: установка пакетов, скан портов и коды пульта.
    static let log: [String] = {
        let pk = ["libc6", "libperl5.30", "perl-base", "zlib1g", "libblkid1", "libuuid1", "fdisk", "util-linux",
                  "libgcc-s1", "libstdc++6", "dpkg", "tar", "gzip", "login", "bash", "binutils", "gcc-9", "cpp-9", "gpg", "openssl"]
        var out: [String] = []
        for (i, p) in pk.enumerated() {
            out.append("Get:\(i + 21) http://ftpmaster.internal/ubuntu focal-updates/main amd64 \(p) [\(100 + i * 137 % 3900) kB]")
        }
        for p in pk { out.append("Preparing to unpack .../\(p).deb ..."); out.append("Unpacking \(p) ...") }
        out += ["Starting Nmap 7.60 ( https://nmap.org )", "PORT     STATE SERVICE  VERSION",
                "25/tcp   open  smtp     Exim smtpd 4.84_2", "53/tcp   open  domain   ISC BIND", "-=[ 22/tcp, ssh ]=- * OPEN *",
                "PROGRAM MANDELBROT_SET;", "uses vga,crt,mouse;", "  Pmin:=-2.25;Qmin:=-1.5;"]
        for k in KEYS { out.append(String(format: "irsend nec 0x%08X  # %@", k.code, k.label)) }
        var g = SeededRandom(seed: 7)
        return out.shuffled(using: &g)
    }()
}

struct SeededRandom: RandomNumberGenerator {
    var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

/// Детерминированный «шум» для кадра анимации.
func hashNoise(_ i: Int) -> CGFloat {
    let x = sin(Double(i) * 12.9898) * 43758.5453
    return CGFloat(x - floor(x))
}

/// Фон: медленно ползущий вверх лог терминала.
struct LogBackground: View {
    private let lineH: CGFloat = 15
    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            let block = lineH * CGFloat(Term.log.count)
            let off = CGFloat(t * 14).truncatingRemainder(dividingBy: block)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(0..<(Term.log.count * 2), id: \.self) { i in
                    Text(Term.log[i % Term.log.count])
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(Term.faint)
                        .lineLimit(1)
                        .frame(height: lineH, alignment: .leading)
                }
            }
            .fixedSize()
            .offset(x: 6, y: -off)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .clipped()
        .allowsHitTesting(false)
    }
}

/// Сканлайны поверх всего, как на старом мониторе.
struct Scanlines: View {
    var body: some View {
        Canvas { ctx, size in
            var y: CGFloat = 0
            while y < size.height {
                ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(.black.opacity(0.28)))
                y += 3
            }
        }
        .allowsHitTesting(false)
    }
}

/// HUD-уголки рамки.
struct Corners: Shape {
    var k: CGFloat = 12
    func path(in r: CGRect) -> Path {
        var p = Path()
        let pts: [(CGFloat, CGFloat, CGFloat, CGFloat)] =
            [(r.minX, r.minY, 1, 1), (r.maxX, r.minY, -1, 1), (r.minX, r.maxY, 1, -1), (r.maxX, r.maxY, -1, -1)]
        for (x, y, sx, sy) in pts {
            p.move(to: CGPoint(x: x + sx * k, y: y + sy))
            p.addLine(to: CGPoint(x: x + sx, y: y + sy))
            p.addLine(to: CGPoint(x: x + sx, y: y + sy * k))
        }
        return p
    }
}

/// Текст, порезанный на полосы со сдвигом (глитч).
struct GlitchText: View {
    let text: String
    let font: Font
    let color: Color
    let jitter: [CGFloat]
    var body: some View {
        GeometryReader { g in
            ZStack {
                ForEach(0..<jitter.count, id: \.self) { i in
                    Text(text).font(font).foregroundColor(color).lineLimit(1)
                        .frame(width: g.size.width, height: g.size.height)
                        .offset(x: jitter[i])
                        .mask(
                            Rectangle()
                                .frame(height: g.size.height / CGFloat(jitter.count))
                                .offset(y: (CGFloat(i) + 0.5) * g.size.height / CGFloat(jitter.count) - g.size.height / 2)
                        )
                }
            }
        }
    }
}

/// Кнопка пульта: рамка с уголками, номер, байт команды; при нажатии — инверсия, глитч, луч передачи.
struct KeyView: View {
    let index: Int
    let label: String
    let code: UInt32
    let inverted: Bool
    let revealDelay: Double
    let onDown: () -> Void
    let onUp: () -> Void

    @State private var down = false
    @State private var shown = ""
    @State private var visible = false
    @State private var jitter: [CGFloat] = [0, 0, 0, 0]
    @State private var beam: CGFloat = 0
    @State private var beamOn = false

    var body: some View {
        let inv = inverted != down
        let fg: Color = inv ? .black : Term.fg
        GeometryReader { g in
            ZStack {
                Rectangle().fill(inv ? Term.fg : Color.black)
                Rectangle().strokeBorder(down ? Term.fg : Term.line, lineWidth: 1)
                Corners().stroke(fg, lineWidth: 2)
                GlitchText(text: shown, font: Term.mono(min(38, g.size.width / CGFloat(max(6, label.count)) * 1.55)),
                           color: fg, jitter: jitter)
                VStack {
                    HStack { Text(String(format: "[%02d]", index + 1)); Spacer() }
                    Spacer()
                    HStack { Spacer(); Text(String(format: "0x%02X", (code >> 8) & 0xFF)) }
                }
                .font(Term.mono(15))
                .foregroundColor(inv ? Color(white: 0.3) : Term.dim)
                .padding(.horizontal, 8).padding(.vertical, 5)
                if beamOn {
                    Rectangle().fill(fg.opacity(0.6)).frame(height: 2)
                        .shadow(color: fg.opacity(0.4), radius: 8)
                        .position(x: g.size.width / 2, y: beam * g.size.height)
                        .opacity(Double(1 - beam))
                }
            }
        }
        .scaleEffect(down ? 0.97 : 1)
        .opacity(visible ? 1 : 0)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { _ in if !down { pressDown() } }
            .onEnded { _ in down = false; onUp() })
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
        .onAppear { reveal() }
    }

    private func pressDown() {
        down = true
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        onDown()
        // глитч: полосы текста разъезжаются на 180 мс
        jitter = (0..<4).map { _ in CGFloat.random(in: -7...7) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.09) { jitter = (0..<4).map { _ in CGFloat.random(in: -4...4) } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { jitter = [0, 0, 0, 0] }
        // луч передачи сверху вниз
        beam = 0; beamOn = true
        withAnimation(.linear(duration: 0.42)) { beam = 1 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.44) { beamOn = false }
    }

    /// Появление: текст «расшифровывается» из шума.
    private func reveal() {
        shown = Term.scramble(label, 0)
        DispatchQueue.main.asyncAfter(deadline: .now() + revealDelay) {
            visible = true
            let steps = 16
            for s in 1...steps {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.52 * Double(s) / Double(steps)) {
                    shown = s == steps ? label : Term.scramble(label, Double(s) / Double(steps))
                    jitter = s < steps / 2 ? [CGFloat.random(in: -5...5), 0, CGFloat.random(in: -5...5), 0] : [0, 0, 0, 0]
                }
            }
        }
    }
}

/// Строка, которая печатается по буквам. Курсор «_» есть всегда и при мигании только
/// становится прозрачным — размеры не меняются, экран не дёргается.
struct TypeLine: View {
    let text: String
    let font: Font
    var color: Color = Term.fg
    @State private var count = 0
    @State private var cursor = true
    private let typeTick = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    private let blinkTick = Timer.publish(every: 0.48, on: .main, in: .common).autoconnect()

    var body: some View {
        (Text(String(text.prefix(count))).foregroundColor(color)
            + Text("_").foregroundColor(cursor || count < text.count ? color : .clear))
            .font(font)
            .lineLimit(1)
            .onReceive(typeTick) { _ in if count < text.count { count = min(text.count, count + 2) } }
            .onReceive(blinkTick) { _ in cursor.toggle() }
            .onChange(of: text) { _ in count = 0; cursor = true }
    }
}
