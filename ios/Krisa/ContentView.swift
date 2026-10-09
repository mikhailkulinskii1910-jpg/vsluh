import SwiftUI
import WebKit

@main
struct KrisaApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @StateObject private var model = RemoteModel()
    @State private var splash = true
    @State private var ready = false
    @State private var settings = false
    @State private var help = false
    @State private var noIr = false
    @AppStorage("theme") private var theme = "terminal"

    var body: some View {
        ZStack {
            Term.bg.ignoresSafeArea()
            themeBackground().ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        titleView()
                        Text("#500202 :: IRBIS :: NEC 38kHz").font(Term.prism ? Prism.body(13) : Term.mono(20)).foregroundColor(Term.dim)
                        Text(model.modeLine).font(Term.ru(14)).foregroundColor(model.routeOK || model.mode == .http ? Term.fg : Term.dim)
                            .lineLimit(1).minimumScaleFactor(0.7).padding(.top, 4)
                    }
                    Spacer()
                    Button { help = true } label: { headerLabel(Term.prism ? "?" : "[?]", width: 52) }
                    .padding(.top, 10)
                    .accessibilityLabel("Как пользоваться")
                    Button { settings = true } label: { headerLabel(Term.prism ? "tx" : "[tx]", width: 64) }
                    .padding(.top, 10)
                    .accessibilityLabel("Передатчик")
                }

                GeometryReader { g in
                    let rowH = min(110, max(64, (g.size.height - 5 * 10) / 6))
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        if ready {
                            ForEach(Array(KEYS.enumerated()), id: \.offset) { i, k in
                                KeyView(index: i, label: k.label, code: k.code, inverted: k.label == "POWER",
                                        revealDelay: 0.06 * Double(i),
                                        onDown: { model.press(k.label, k.code) },
                                        onUp: { model.release() })
                                    .frame(height: rowH)
                            }
                        }
                    }
                }
                .padding(.top, 14)

                TypeLine(text: model.status, font: Term.ru(14),
                         color: model.status.hasPrefix("!!") || model.status.contains("[sent]") ? Term.fg : Term.dim)
                    .padding(.top, 10).padding(.leading, 4)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if !Term.prism && !Term.thermal { Scanlines().ignoresSafeArea() }

            if splash {
                SplashView(boot: [
                    "krisa ir-remote ios",
                    "loading nec table ........ [ok]",
                    "audio out ................ [" + (AudioIr.adapterConnected ? "ok" : "--") + "]",
                    "decoding rat.png ......... [ok]",
                ]) {
                    guard splash else { return }   // заставку уже убрали (отладочный запуск)
                    withAnimation(.easeOut(duration: 0.26)) { splash = false }
                    ready = true
                    checkIrPort()
                }
                .transition(.opacity)
                .zIndex(10)
            }
        }
        .id(theme)   // смена темы — перестроить экран с новой палитрой
        .preferredColorScheme(.dark)
        .statusBarHidden(splash)
        .sheet(isPresented: $settings) { SettingsView(model: model) }
        .fullScreenCover(isPresented: $help) { HelpView() }
        .alert("> ИК-порт не найден", isPresented: $noIr) {
            Button("Как подключить") { help = true }
            Button("OK", role: .cancel) {}
        } message: {
            Text("У iPhone нет встроенного ИК-порта. Вставьте звуковой ИК-адаптер в разъём наушников (через переходник) или в USB-C, либо выберите Wi-Fi передатчик кнопкой [tx].")
        }
        .onAppear {
            // Для скриншота в CI: KRISA_OPEN_HELP=1 сразу открывает «Как пользоваться».
            if ProcessInfo.processInfo.environment["KRISA_OPEN_HELP"] != nil {
                splash = false; ready = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { help = true }
            }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: RemoteModel
    @Environment(\.dismiss) private var dismiss
    @State private var copied: String?
    @AppStorage("theme") private var theme = "terminal"
    private let themes = [("terminal", "Терминал", "Чёрно-белый, пиксельный шрифт, бегущий лог и крысы"),
                          ("prism", "Призма", "Жидкое стекло, лучи и радужные переливы"),
                          ("thermal", "Тепловизор", "Кадр тепловизора: палитра ironbow, рамки обнаружения, вращающаяся радужка")]

    /// Фон строки выбора в текущей теме: выбранная подсвечена.
    private func rowFill(_ on: Bool) -> AnyView {
        if !on { return AnyView(Term.bg) }
        if Term.prism { return AnyView(Color(hex: 0x8B6CFF, alpha: 0.35)) }
        if Term.thermal { return AnyView(LinearGradient(colors: [Heat.color(0.55), Heat.color(0.72), Heat.color(0.86)], startPoint: .leading, endPoint: .trailing)) }
        return AnyView(Term.fg)
    }

    /// Цвет текста строки выбора.
    private func rowInk(_ on: Bool) -> Color {
        on && !Term.prism ? Color.black : Term.fg
    }

    private func themeRow(_ i: Int) -> some View {
        let th = themes[i]
        let on: Bool = theme == th.0
        return Button {
            Term.theme = th.0
            theme = th.0
        } label: {
            HStack {
                Text(on ? "[x]" : "[ ]").font(Term.mono(22))
                VStack(alignment: .leading, spacing: 2) {
                    Text(th.1).font(Term.ru(15))
                    Text(th.2).font(Term.ru(11)).opacity(0.75)
                }
                Spacer()
            }
            .padding(10)
            .foregroundColor(rowInk(on))
            .background(rowFill(on))
            .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
        }
    }

    private func modeRow(_ m: TxMode) -> some View {
        let on: Bool = model.mode == m
        return Button { model.mode = m } label: {
            HStack {
                Text(on ? "[x]" : "[ ]").font(Term.mono(22))
                Text(m.label).font(Term.ru(14))
                Spacer()
            }
            .padding(10)
            .foregroundColor(rowInk(on))
            .background(rowFill(on))
            .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
        }
    }

    private var choices: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("> theme").font(Term.mono(26))
            ForEach(themes.indices, id: \.self) { i in themeRow(i) }
            Text("> tx_mode").font(Term.mono(26)).padding(.top, 10)
            ForEach(TxMode.allCases) { m in modeRow(m) }
            if model.mode == .http {
                Text("Адрес модуля Tasmota").font(Term.ru(12)).foregroundColor(Term.dim)
                TextField("192.168.1.50", text: $model.host)
                    .font(Term.ru(16)).keyboardType(.URL).autocapitalization(.none).disableAutocorrection(true)
                    .padding(10).overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("> settings").font(Term.mono(30))
                    Spacer()
                    Button("[ok]") { dismiss() }.font(Term.mono(26)).foregroundColor(Term.fg)
                }
                choices

                Text("> diag").font(Term.mono(26)).padding(.top, 10)
                Group {
                    Text("Звуковой выход: \(AudioIr.routeDescription)")
                    Text(model.routeOK ? "Проводной выход найден — адаптер должен работать." :
                         "Проводной выход не найден. Вставьте ИК-адаптер (через переходник на 3,5 мм или USB-C).")
                    Text("Громкость iPhone должна быть на максимуме — иначе светодиоды не загораются.")
                    Text("Встроенного ИК-порта у iPhone нет, а прямой доступ к USB-донглам iOS приложениям не даёт. Поэтому работают только звуковые ИК-адаптеры и Wi-Fi передатчики.")
                }
                .font(Term.ru(12)).foregroundColor(Term.dim)

                Text("> codes (NEC 38kHz)").font(Term.mono(26)).padding(.top, 10)
                Text("Нажмите строку, чтобы скопировать код Pronto.").font(Term.ru(12)).foregroundColor(Term.dim)
                ForEach(KEYS, id: \.label) { k in
                    Button {
                        UIPasteboard.general.string = RemoteModel.pronto(k.code)
                        copied = k.label
                    } label: {
                        HStack {
                            Text(k.label).font(Term.mono(20))
                            Spacer()
                            Text(copied == k.label ? "copied" : String(format: "0x%08X", k.code)).font(Term.mono(20))
                        }
                        .foregroundColor(Term.fg)
                    }
                    Rectangle().fill(Color(white: 0.16)).frame(height: 1)
                }
            }
            .foregroundColor(Term.fg)
            .padding(20)
        }
        .background(Term.bg.ignoresSafeArea())
        .id(theme)
        .preferredColorScheme(.dark)
    }
}

extension ContentView {
    /// Фон текущей темы. Во второй теме крыс нет, в «Тепловизоре» они — тёплые пятна в рамках.
    @ViewBuilder func themeBackground() -> some View {
        if Term.prism {
            PrismBackground()
        } else if Term.thermal {
            ZStack {
                ThermalBackground()
                TimelineView(.animation) { tl in RunningRats(t: tl.date.timeIntervalSinceReferenceDate) }
            }
        } else {
            LogBackground()
        }
    }

    /// Заголовок «krisa» в текущей теме.
    @ViewBuilder func titleView() -> some View {
        if Term.prism {
            IrisText(text: ready ? "krisa" : " ", font: Prism.display(40))
        } else if Term.thermal {
            HeatText(text: ready ? "krisa_" : " ", font: Term.mono(60))
        } else {
            TypeLine(text: ready ? "krisa" : "", font: Term.mono(60))
                .shadow(color: .white.opacity(0.9), radius: 8)
        }
    }

    /// Кнопка шапки: рамка в «Терминале», жидкое стекло в «Призме».
    @ViewBuilder func headerLabel(_ text: String, width: CGFloat) -> some View {
        if Term.prism {
            Text(text).font(Prism.display(17)).foregroundColor(Term.fg)
                .frame(width: width, height: 44)
                .background(GlassBox(radius: 16, seed: Double(width)))
        } else {
            Text(text).font(Term.mono(24)).foregroundColor(Term.fg)
                .frame(width: width, height: 44)
                .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
        }
    }

    /// Проверка при запуске: у iPhone своего ИК-порта нет — нужен звуковой адаптер или Wi-Fi передатчик.
    func checkIrPort() {
        if model.mode == .http { return }
        if AudioIr.adapterConnected { model.say("> ir: звуковой адаптер найден [ok]") }
        else {
            model.say("ИК-порт не найден: нужен звуковой адаптер", err: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { noIr = true }
        }
    }
}

/// «Как пользоваться»: тот же гид, что в веб-версии (папка guide/ в бандле).
struct HelpView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("[<] к пульту") { dismiss() }.font(Term.mono(24)).foregroundColor(Term.fg)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            HelpWeb().ignoresSafeArea(edges: .bottom)
        }
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}

struct HelpWeb: UIViewRepresentable {
    /// Ссылки на сайты и файлы открываем в Safari, разделы гида (#якоря) — здесь же.
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, ["http", "https"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
        // ссылки с target="_blank" приходят сюда — тоже отдаём Safari
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView()
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "guide") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {}
}
