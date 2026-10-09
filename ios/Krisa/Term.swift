import SwiftUI

/// Палитра и шрифты. Две темы: «Терминал» (чёрно-белый, VT323) и «Призма» (стекло и радужные переливы).
enum Term {
    /// Выбранная тема; меняется в настройках (ключ "theme": "terminal" / "prism").
    static var prism = UserDefaults.standard.string(forKey: "theme") == "prism"
    static var bg: Color { prism ? Color(hex: 0x07060B) : .black }
    static var fg: Color { prism ? Color(hex: 0xF4F1FF) : Color(white: 0.93) }
    static var dim: Color { prism ? Color(hex: 0xA79FC6) : Color(white: 0.54) }
    static var line: Color { prism ? Color(hex: 0x4B4270) : Color(white: 0.36) }
    static var faint: Color { prism ? Color(hex: 0x1A1726) : Color(white: 0.085) }
    static let noise = Array("#$%&@01<>/\\|=+*:;░▒▓")

    /// Пиксельный VT323 (латиница); в «Призме» — Unbounded (он заметно крупнее, поэтому меньше кегль).
    static func mono(_ size: CGFloat) -> Font { prism ? Prism.display(size * 0.62) : .custom("VT323-Regular", size: size) }
    /// Русский текст: в VT323 нет кириллицы — системный моноширинный; в «Призме» — Manrope.
    static func ru(_ size: CGFloat) -> Font { prism ? Prism.body(size) : .system(size: size, design: .monospaced) }

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
        // GeometryReader берёт ровно размер экрана: длинный лог не раздувает разметку.
        GeometryReader { g in
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
                            .fixedSize()
                            .frame(height: lineH, alignment: .leading)
                    }
                }
                .offset(x: 6, y: -off)
                .frame(width: g.size.width, height: g.size.height, alignment: .topLeading)
                .overlay(RunningRats(t: t))
            }
            .clipped()
        }
        .allowsHitTesting(false)
    }
}

/// Пиксельная бегущая крыса, 2 кадра (лапы перебирают). «#» — пиксель.
let RAT_SPRITE: [[String]] = [
    ["....................##......", "...................####.....", "............###########.....", ".........###############....",
     ".......################.#...", "......#####################.", "#.....##################....", ".#...##################.....",
     "..###.###############.......", "........##.......##.........", ".......##.........##........"],
    ["....................##......", "...................####.....", "............###########.....", ".........###############....",
     ".......################.#...", "......#####################.", "......##################....", "#....##################.....",
     ".####.###############.......", ".........##.....##..........", "..........#.....#..........."],
]

/// Симуляция крыс: обычно бегают по фону, при нажатии на кнопку удирают от пальца.
final class RatSim {
    static let shared = RatSim()
    static let px: CGFloat = 2.5
    static let w = CGFloat(RAT_SPRITE[0][0].count) * px
    static let h = CGFloat(RAT_SPRITE[0].count) * px

    struct Rat {
        let speed: CGFloat
        /// Оттенок: белый с прозрачностью — от почти белого до тёмно-серого.
        let shade: Double
        var x: CGFloat = 0, y: CGFloat = 0, dir: CGFloat = 1, stride: CGFloat = 0
        var panic = false, wait: Double = 0, hop: CGFloat = 1
    }
    private(set) var rats = ([(70, 0.85), (110, 0.38), (45, 0.63), (90, 0.28), (130, 0.5)] as [(CGFloat, Double)]).map { Rat(speed: $0.0, shade: $0.1) }
    private var size: CGSize = .zero
    private var last: Double?
    private let lock = NSLock()

    /// Испуг: крысы подпрыгивают и удирают от точки нажатия за край экрана.
    func scare(at p: CGPoint) {
        lock.lock(); defer { lock.unlock() }
        for i in rats.indices where rats[i].wait <= 0 {
            rats[i].dir = rats[i].x + RatSim.w / 2 < p.x ? -1 : 1
            rats[i].panic = true
            rats[i].hop = 0
        }
    }

    private func respawn(_ i: Int, anywhere: Bool) {
        rats[i].dir = Bool.random() ? 1 : -1
        rats[i].x = anywhere ? .random(in: 0...max(1, size.width)) : (rats[i].dir > 0 ? -RatSim.w : size.width)
        rats[i].y = 60 + .random(in: 0...max(1, size.height - 120))
        rats[i].panic = false
        rats[i].wait = 0
    }

    /// Шаг симуляции до момента t; возвращает, что рисовать: позиция, направление, кадр.
    func step(to t: Double, size: CGSize) -> [(CGPoint, CGFloat, Int, Double)] {
        lock.lock(); defer { lock.unlock() }
        if last == nil || self.size != size { self.size = size; for i in rats.indices { respawn(i, anywhere: true) } }
        let dt = CGFloat(min(t - (last ?? t), 0.05))
        last = t
        var out: [(CGPoint, CGFloat, Int, Double)] = []
        for i in rats.indices {
            if rats[i].wait > 0 {
                rats[i].wait -= Double(dt)
                if rats[i].wait <= 0 { respawn(i, anywhere: false) }
                continue
            }
            let v = rats[i].speed * (rats[i].panic ? 4.5 : 1)
            rats[i].x += rats[i].dir * v * dt
            rats[i].stride += v * dt
            rats[i].hop = min(1, rats[i].hop + dt / 0.28)
            if rats[i].x > size.width + RatSim.w || rats[i].x < -2 * RatSim.w {   // убежала — посидит и вернётся
                rats[i].wait = rats[i].panic ? .random(in: 1.5...4) : .random(in: 0.4...2.4)
                continue
            }
            let f = Int(rats[i].stride / 9) % 2                                     // лапы в такт пути
            let y = rats[i].y - sin(rats[i].hop * .pi) * 10 - CGFloat(f)            // прыжок от испуга
            out.append((CGPoint(x: rats[i].x, y: y), rats[i].dir, f, rats[i].shade))
        }
        return out
    }
}

/// Маленькие ч/б крысы, бегающие по фону поверх лога.
struct RunningRats: View {
    let t: Double
    /// Кадры спрайта как контуры из пикселей (собраны один раз).
    private static let frames: [Path] = RAT_SPRITE.map { rows in
        var p = Path()
        for (y, r) in rows.enumerated() {
            for (x, ch) in r.enumerated() where ch == "#" {
                p.addRect(CGRect(x: CGFloat(x) * RatSim.px, y: CGFloat(y) * RatSim.px, width: RatSim.px, height: RatSim.px))
            }
        }
        return p
    }

    var body: some View {
        Canvas { ctx, size in
            for (pos, dir, f, shade) in RatSim.shared.step(to: t, size: size) {
                var tr = CGAffineTransform(translationX: pos.x, y: pos.y)
                if dir < 0 { tr = tr.translatedBy(x: RatSim.w, y: 0).scaledBy(x: -1, y: 1) }
                ctx.fill(RunningRats.frames[f].applying(tr), with: .color(.white.opacity(shade)))
            }
        }
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
    @State private var pressedAt = Date.distantPast

    var body: some View {
        Group { if Term.prism { prismFace } else { terminalFace } }
        .scaleEffect(down ? 0.97 : 1)
        .opacity(visible ? 1 : 0)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { v in
                if !down {
                    RatSim.shared.scare(at: v.startLocation)   // крысы убегают от пальца
                    pressDown()
                }
            }
            .onEnded { _ in down = false; onUp() })
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
        .onAppear { reveal() }
    }

    /// «Призма»: жидкое стекло, стеклянный текст, после нажатия — перелив и расслоение текста на красный и бирюзовый.
    private var prismFace: some View {
        TimelineView(.animation) { tl in
            let hot = max(0, 1 - tl.date.timeIntervalSince(pressedAt) / 0.52)
            let t = Prism.time(tl.date)
            GeometryReader { g in
                let f = Prism.display(min(24, g.size.width / CGFloat(max(6, label.count)) * 1.02))
                ZStack {
                    GlassBody(radius: 22, on: inverted, pressed: down, hot: hot, seed: Double(index), t: t)
                    if hot > 0 && !inverted {
                        Text(shown).font(f).lineLimit(1).foregroundColor(Color(hex: 0xFF468C, alpha: 0.78 * hot)).offset(x: -4 * CGFloat(hot))
                        Text(shown).font(f).lineLimit(1).foregroundColor(Color(hex: 0x3CE6FF, alpha: 0.78 * hot)).offset(x: 4 * CGFloat(hot))
                    }
                    GlassText(text: shown, font: f, dark: inverted)
                    VStack {
                        HStack { Text(String(format: "%02d", index + 1)); Spacer() }
                        Spacer()
                        HStack { Spacer(); Text(String(format: "0x%02X", (code >> 8) & 0xFF)) }
                    }
                    .font(Prism.body(12))
                    .foregroundColor(inverted ? Prism.ink.opacity(0.67) : Term.dim)
                    .padding(.horizontal, 13).padding(.vertical, 9)
                }
            }
        }
    }

    private var terminalFace: some View {
        let inv = inverted != down
        let fg: Color = inv ? .black : Term.fg
        return GeometryReader { g in
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
    }

    private func pressDown() {
        down = true
        pressedAt = Date()
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
