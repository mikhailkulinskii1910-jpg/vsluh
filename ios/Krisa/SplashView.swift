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
            let t = SplashView.frozenAt ?? ctx.date.timeIntervalSince(start) * 1000
            GeometryReader { g in
                let w = g.size.width, h = g.size.height
                let rw = min(w * 0.72, 420), rh = rw * 358 / 605
                let restY = h * 0.5
                let f = CGFloat(min(max((t - 650) / 900, 0), 1))
                let frame = Int(t / 16)
                ZStack(alignment: .topLeading) {
                    if Term.prism { PrismBackground() } else if Term.thermal { ThermalBackground() } else { Color.black }
                    // 1. загрузочный лог
                    Text(bootText(chars: Int(t / 7)))
                        .font(Term.prism ? Prism.body(14) : Term.mono(18)).foregroundColor(Term.dim)
                        .padding(.horizontal, 16).padding(.top, 24)

                    // 2. крыса падает сверху, отскакивает и «лежит»
                    if t > 650 {
                        let y = -rh + (restY + rh) * CGFloat(bounce(Double(f)))
                        let rot = Double((1 - f) * -38 + (f > 0.55 ? sin(f * 26) * 4 * (1 - f) : 0))
                        let moving = f < 0.95 || (1800...1900).contains(t) || (2050...2110).contains(t)
                        Group {
                            if Term.prism {
                                // крыса из жидкого стекла
                                GlassRat(t: Prism.time(ctx.date), moving: moving)
                            } else if Term.thermal {
                                // крыса — тепловое пятно
                                HeatRat()
                            } else {
                                RatSlices(bands: moving ? 9 : 1, frame: frame, amp: moving ? 22 : 0)
                                    .shadow(color: .white.opacity(Double(0.55 * f)), radius: 14)
                            }
                        }
                        .frame(width: rw, height: rh)
                        .rotationEffect(.degrees(rot))
                        .position(x: w / 2, y: y)

                        // удар об «пол» — горизонтальные полосы, как у солнца на референсе
                        if f > 0.42 && f < 0.9 {
                            let k = 1 - abs(f - 0.55) / 0.35
                            ForEach(0..<7, id: \.self) { i in
                                Rectangle().fill((Term.prism ? Prism.iris[i % 6] : Term.thermal ? Heat.color(0.45 + Double(i) * 0.08) : Color.white).opacity(Double(0.7 * k)))
                                    .frame(width: (rw * 1.2 + hashNoise(frame * 7 + i) * rw * 0.8) * k, height: 1)
                                    .position(x: w / 2, y: restY + rh * 0.33 + CGFloat(i - 3) * 4)
                            }
                        }
                    }

                    // 3. надпись
                    if t > 1500 {
                        let word = Term.scramble("krisa", min((t - 1500) / 450, 1))
                        if Term.prism {
                            IrisText(text: word, font: Prism.display(48))
                                .position(x: w / 2, y: restY + rh * 0.5 + 70)
                        } else if Term.thermal {
                            HeatText(text: word, font: Term.mono(64))
                                .position(x: w / 2, y: restY + rh * 0.5 + 70)
                        } else {
                            Text(word)
                                .font(Term.mono(64)).foregroundColor(Term.fg)
                                .shadow(color: .white, radius: 12)
                                .position(x: w / 2, y: restY + rh * 0.5 + 70)
                        }
                    }

                    // тепловизор «захватил» крысу: рамка обнаружения с подписью (мигает при появлении)
                    if Term.thermal && f > 0.62 && !(t < 1700 && Int(t / 70) % 2 == 0) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("RAT_01XX  37.2°C").font(Term.mono(18)).foregroundColor(Heat.yellow)
                            Rectangle().strokeBorder(Heat.yellow, lineWidth: 1.5).frame(width: rw * 1.12, height: rh * 1.2)
                        }
                        .position(x: w / 2, y: restY - 2)
                    }

                    // подпись в правом нижнем углу «расписывается» слева направо
                    if t > 700 {
                        let p = CGFloat(min((t - 700) / 650, 1))
                        Image("sign").resizable().aspectRatio(contentMode: .fit)
                            .frame(width: 110)
                            .opacity(0.86)
                            .mask(Rectangle().frame(width: 110 * p).frame(width: 110, alignment: .leading))
                            .position(x: w - 18 - 55, y: h - 22 - 46)
                    }

                    // 4. уход: экран рассыпается полосами
                    if t > 2350 {
                        let p = CGFloat(min((t - 2350) / 300, 1))
                        ForEach(0..<14, id: \.self) { i in
                            Rectangle().fill((Term.prism ? Prism.iris[i % 6] : Term.thermal ? Heat.color(0.4 + Double(i % 7) * 0.09) : Color.white).opacity(Double(0.85 * (1 - p))))
                                .frame(width: w * hashNoise(frame * 13 + i), height: 1 + hashNoise(frame * 5 + i) * 6)
                                .position(x: w * hashNoise(frame * 13 + i) / 2, y: h * hashNoise(frame * 31 + i))
                        }
                    }
                }
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
