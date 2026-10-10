import SwiftUI

/**
 Заставка при каждом запуске: загрузочный лог, падающая крыса с глитчем и отскоком,
 «krisa» под ней, затем экран рассыпается полосами. Тап — пропустить.
 */
struct SplashView: View {
    let boot: [String]
    let onDone: () -> Void
    @State private var start = Date()
    @State private var finished = false

    var body: some View {
        TimelineView(.animation) { ctx in
            GeometryReader { g in
                scene(t: SplashView.frozenAt ?? ctx.date.timeIntervalSince(start) * 1000, date: ctx.date, size: g.size)
            }
        }
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .onAppear {
            start = Date()
            if SplashView.frozenAt == nil { DispatchQueue.main.asyncAfter(deadline: .now() + 2.65) { finish() } }
        }
    }


    // Сцена разбита на маленькие функции: одним большим body компилятор Swift не успевает проверить типы.

    private func scene(t: Double, date: Date, size: CGSize) -> some View {
        let w = size.width, h = size.height
        let rw = min(w * 0.72, 420), rh = rw * 358 / 605
        let f = CGFloat(min(max((t - 650) / 900, 0), 1))
        return ZStack(alignment: .topLeading) {
            backdrop()
            // 1. загрузочный лог
            Text(bootText(chars: Int(t / 7)))
                .font(bootFont).foregroundColor(Term.dim)
                .padding(.horizontal, 16).padding(.top, 24)
            // 2. крыса падает сверху, отскакивает и «лежит»
            if t > 650 { ratLayer(t: t, date: date, w: w, h: h, rw: rw, rh: rh, f: f) }
            // «Чертёж»: размерные линии вокруг улёгшейся крысы
            if Term.blueprint && t > 1500 { dimsLayer(t: t, rw: rw, rh: rh).position(x: w / 2, y: h * 0.5) }
            // 3. надпись
            if t > 1500 { wordLayer(Term.scramble("krisa", min((t - 1500) / 450, 1))).position(x: w / 2, y: h * 0.5 + rh * 0.5 + 70) }
            // тепловизор «захватил» крысу: рамка обнаружения с подписью (мигает при появлении)
            if Term.thermal && f > 0.62 && !(t < 1700 && Int(t / 70) % 2 == 0) { detectionBox(rw: rw, rh: rh).position(x: w / 2, y: h * 0.5 - 2) }
            // подпись в правом нижнем углу «расписывается» слева направо
            // (в «Чертеже» — выше, над штампом)
            if t > 700 { signature(p: CGFloat(min((t - 700) / 650, 1))).position(x: w - 18 - 55, y: h - 46 - signatureLift) }
            // 4. уход: экран рассыпается полосами
            if t > 2350 { exitStripes(t: t, w: w, h: h) }
        }
    }

    @ViewBuilder private func backdrop() -> some View {
        if Term.prism { PrismBackground() } else if Term.thermal { ThermalBackground() } else if Term.blueprint { BlueprintBackground() } else { Color.black }
    }

    /// Шрифт загрузочного лога.
    private var bootFont: Font {
        if Term.prism || Term.blueprint { return Prism.body(14) }
        return Term.mono(18)
    }

    private func dimsLayer(t: Double, rw: CGFloat, rh: CGFloat) -> some View {
        let a: Double = min(max((t - 1500) / 300, 0), 1)
        return BlueprintDims(rw: rw, rh: rh).opacity(a)
    }

    /// Цвет полос удара и ухода в текущей теме.
    private func stripeColor(_ i: Int, _ heat: Double) -> Color {
        if Term.prism { return Prism.iris[i % 6] }
        if Term.thermal { return Heat.color(heat) }
        if Term.blueprint { return Blueprint.ink }
        return Term.fg
    }

    @ViewBuilder private func ratBody(moving: Bool, frame: Int, f: CGFloat, date: Date) -> some View {
        if Term.prism {
            GlassRat(t: Prism.time(date), moving: moving)          // крыса из жидкого стекла
        } else if Term.thermal {
            HeatRat()                                               // крыса — тепловое пятно
        } else if Term.blueprint {
            BlueprintRat()                                          // крыса — контурный чертёж
        } else {
            RatSlices(bands: moving ? 9 : 1, frame: frame, amp: moving ? 22 : 0)
                .colorMultiply(Term.fg)                             // перекрашена в цвет «люминофора»
                .shadow(color: Term.fg.opacity(Double(0.55 * f)), radius: 14)
        }
    }

    private func ratLayer(t: Double, date: Date, w: CGFloat, h: CGFloat, rw: CGFloat, rh: CGFloat, f: CGFloat) -> some View {
        let restY = h * 0.5
        let frame = Int(t / 16)
        let y: CGFloat = -rh + (restY + rh) * CGFloat(bounce(Double(f)))
        let wobble: CGFloat = f > 0.55 ? sin(f * 26) * 4 * (1 - f) : 0
        let rot = Double((1 - f) * -38 + wobble)
        let moving = f < 0.95 || (1800...1900).contains(t) || (2050...2110).contains(t)
        let k: CGFloat = 1 - abs(f - 0.55) / 0.35
        return ZStack {
            ratBody(moving: moving, frame: frame, f: f, date: date)
                .frame(width: rw, height: rh)
                .rotationEffect(.degrees(rot))
                .position(x: w / 2, y: y)
            // удар об «пол» — горизонтальные полосы, как у солнца на референсе
            if f > 0.42 && f < 0.9 {
                ForEach(0..<7, id: \.self) { i in
                    impactLine(i: i, frame: frame, rw: rw, k: k)
                        .position(x: w / 2, y: restY + rh * 0.33 + CGFloat(i - 3) * 4)
                }
            }
        }
    }

    private func impactLine(i: Int, frame: Int, rw: CGFloat, k: CGFloat) -> some View {
        let width: CGFloat = (rw * 1.2 + hashNoise(frame * 7 + i) * rw * 0.8) * k
        return Rectangle().fill(stripeColor(i, 0.45 + Double(i) * 0.08).opacity(Double(0.7 * k)))
            .frame(width: width, height: 1)
    }

    @ViewBuilder private func wordLayer(_ word: String) -> some View {
        if Term.prism {
            IrisText(text: word, font: Prism.display(48))
        } else if Term.thermal {
            HeatText(text: word, font: Term.mono(64))
        } else if Term.blueprint {
            Text(word).font(Prism.display(46)).foregroundColor(Blueprint.ink)
        } else {
            Text(word).font(Term.mono(64)).foregroundColor(Term.fg).shadow(color: Term.fg, radius: 12)
        }
    }

    private func detectionBox(rw: CGFloat, rh: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("RAT_01XX  37.2°C").font(Term.mono(18)).foregroundColor(Heat.yellow)
            Rectangle().strokeBorder(Heat.yellow, lineWidth: 1.5).frame(width: rw * 1.12, height: rh * 1.2)
        }
    }

    private var signatureLift: CGFloat { Term.blueprint ? 90 : 22 }

    private func signature(p: CGFloat) -> some View {
        Image("sign").resizable().aspectRatio(contentMode: .fit)
            .frame(width: 110)
            .opacity(0.86)
            .mask(Rectangle().frame(width: 110 * p).frame(width: 110, alignment: .leading))
    }

    private func exitStripes(t: Double, w: CGFloat, h: CGFloat) -> some View {
        let p = CGFloat(min((t - 2350) / 300, 1))
        let frame = Int(t / 16)
        return ForEach(0..<14, id: \.self) { i in
            exitStripe(i: i, frame: frame, p: p, w: w, h: h)
        }
    }

    private func exitStripe(i: Int, frame: Int, p: CGFloat, w: CGFloat, h: CGFloat) -> some View {
        let sw: CGFloat = w * hashNoise(frame * 13 + i)
        let sh: CGFloat = 1 + hashNoise(frame * 5 + i) * 6
        return Rectangle().fill(stripeColor(i, 0.4 + Double(i % 7) * 0.09).opacity(Double(0.85 * (1 - p))))
            .frame(width: sw, height: sh)
            .position(x: sw / 2, y: h * hashNoise(frame * 31 + i))
    }

    /// Для скриншотов в CI: KRISA_SPLASH_AT=1900 останавливает заставку на этом моменте (мс).
    static let frozenAt: Double? = ProcessInfo.processInfo.environment["KRISA_SPLASH_AT"].flatMap(Double.init)

    private func finish() {
        guard !finished else { return }
        finished = true
        onDone()
    }

    private func bootText(chars: Int) -> String {
        var left = chars
        var out: [String] = []
        for l in boot where left > 0 {
            out.append(String(l.prefix(left)))
            left -= l.count + 6
        }
        return out.joined(separator: "\n")
    }

    /// Падение с затухающим отскоком.
    private func bounce(_ x: Double) -> Double {
        let n = 7.5625, d = 2.75
        if x < 1 / d { return n * x * x }
        if x < 2 / d { let t = x - 1.5 / d; return n * t * t + 0.75 }
        if x < 2.5 / d { let t = x - 2.25 / d; return n * t * t + 0.9375 }
        let t = x - 2.625 / d; return n * t * t + 0.984375
    }
}

/// Крыса, порезанная на горизонтальные полосы со случайным сдвигом (глитч в полёте).
struct RatSlices: View {
    let bands: Int
    let frame: Int
    let amp: CGFloat
    var body: some View {
        GeometryReader { g in
            ZStack {
                ForEach(0..<bands, id: \.self) { b in
                    let strong = hashNoise(frame * 3 + b) < 0.33
                    Image("rat").resizable()
                        .frame(width: g.size.width, height: g.size.height)
                        .offset(x: (hashNoise(frame * 11 + b) - 0.5) * amp * (strong ? 1 : 0.15))
                        .mask(
                            Rectangle()
                                .frame(height: g.size.height / CGFloat(bands))
                                .offset(y: (CGFloat(b) + 0.5) * g.size.height / CGFloat(bands) - g.size.height / 2)
                        )
                }
            }
        }
    }
}
