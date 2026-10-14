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
    /// Открытая вкладка: "boards" (доски), "proj" (проекторы), "ac" (кондиционеры), "color" (цвет).
    /// Старые значения "irbis" / "moc" — это «Доски» с соответствующим чипом.
    @AppStorage("remote") private var remote = "boards"
    /// Чип во вкладке «Доски»: 0 IRBIS, 1 MocTec.
    @AppStorage("boardBrand") private var boardBrand = 0
    /// Состояние кондиционера (для подзаголовка — номер пульта).
    @AppStorage("acState") private var acState = ""
    // цвет «Терминала» и палитра «Тепловизора» (сами значения Term/Heat держат в статических полях)
    @AppStorage("termColor") private var termColor = 0xEDEDED
    @AppStorage("matrix") private var matrix = false
    @AppStorage("rgb") private var rgb = ""
    @AppStorage("heat") private var heat = "ironbow"
    @AppStorage("bpShade") private var bpShade = 0.5
    @AppStorage("bpHue") private var bpHue = 218.0
    // настройки «Призмы»: яркость, матовость стекла, сдвиг радуги, цвет фона
    @AppStorage("prBright") private var prBright = 0.5
    @AppStorage("prFrost") private var prFrost = 0.5
    @AppStorage("prHue") private var prHue = 0.0
    @AppStorage("prBg") private var prBg = 0.0
    /// Марка проектора во вкладке PROJ: 0 NEC, 1 Epson, 2 InFocus, 3 BenQ.
    @AppStorage("projBrand") private var projBrand = 0
    /// Где на экране область пульта — туда кладётся панель «Цвет» (поверх RGB-перелива).
    @State private var panelFrame: CGRect = .zero

    var body: some View {
        ZStack {
            screen
                .id(screenKey)   // смена темы или цвета — перестроить экран с новой палитрой
            if showPanel { colorPanelLayer }
        }
        .coordinateSpace(name: "krisa")
        .onPreferenceChange(PanelFrameKey.self) { f in panelFrame = f }
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
            migrateTab()
            // Для скриншота в CI: KRISA_OPEN_HELP=1 сразу открывает «Как пользоваться».
            if ProcessInfo.processInfo.environment["KRISA_OPEN_HELP"] != nil {
                splash = false; ready = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { help = true }
            }
        }
    }

    /// Ключ перестройки экрана: тема, цвет терминала, перелив, «Матрица», палитра тепловизора.
    private var screenKey: String {
        let base: [String] = [theme, String(termColor), rgb, matrix ? "m" : "-", heat]
        let tune: [Double] = [bpShade, bpHue, prBright, prFrost, prHue, prBg]
        let parts: [String] = base + tune.map { String($0) }
        return parts.joined(separator: "|")
    }

    /// Весь экран, кроме панели «Цвет»: фон, шапка, пульт, статус, заставка и RGB-перелив поверх.
    private var screen: some View {
        ZStack {
            Term.bg.ignoresSafeArea()
            themeBackground().ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                header
                remoteTabs().padding(.top, 12)
                if colorTab {
                    panelSlot.padding(.top, 12)
                } else if tab == "proj" {
                    projArea.padding(.top, 12)
                } else if tab == "ac" {
                    AcPanel(model: model).padding(.top, 12)
                } else {
                    boardsArea.padding(.top, 12)
                }
                TypeLine(text: model.status, font: Term.ru(14),
                         color: model.status.hasPrefix("!!") || model.status.contains("[sent]") ? Term.fg : Term.dim)
                    .padding(.top, 10).padding(.leading, 4)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if Term.terminal { Scanlines().ignoresSafeArea() }

            if splash { splashLayer }

            rgbLayer.zIndex(11)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                titleView()
                Text(remoteSubtitle).font(subtitleFont).foregroundColor(Term.dim)
                    .lineLimit(1).minimumScaleFactor(0.6)
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
    }

    private var keyGrid: some View {
        GeometryReader { g in
            let rowH: CGFloat = min(110, max(64, (g.size.height - 5 * 10) / 6))
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                if ready {
                    ForEach(Array(currentKeys.enumerated()), id: \.offset) { i, k in
                        KeyView(index: i, label: k.label, code: k.code, inverted: k.label == "POWER",
                                revealDelay: 0.06 * Double(i),
                                onDown: { model.press(k.label, k.code) },
                                onUp: { model.release() })
                            .frame(height: rowH)
                    }
                }
            }
            .id(gridKey)   // другой пульт — кнопки создаются заново и снова «расшифровываются»
        }
    }

    /// Все кнопки проектора: 3 колонки, сетка прокручивается.
    private var projGrid: some View {
        ScrollView(showsIndicators: false) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10),
                                GridItem(.flexible(), spacing: 10)], spacing: 10) {
                if ready {
                    ForEach(Array(currentKeys.enumerated()), id: \.offset) { i, k in projKey(i, k.label, k.code) }
                }
            }
            .padding(6)
            .padding(.bottom, 12)
            .id(gridKey)
        }
    }

    private func projKey(_ i: Int, _ label: String, _ code: UInt32) -> some View {
        let delay: Double = 0.04 * Double(min(i, 15))
        return KeyView(index: i, label: label, code: code, inverted: label == "POWER",
                       revealDelay: delay,
                       onDown: { model.press(label, code) },
                       onUp: { model.release() },
                       scrollable: true)
            .frame(height: 64)
    }

    /// Пульт на экране (вместе с маркой).
    private var gridKey: String {
        if tab == "proj" { return "proj" + String(projIndex) }
        return "boards" + String(boardIndex)
    }

    /// Открытая вкладка; старые "irbis" / "moc" — «Доски».
    var tab: String {
        if remote == "irbis" || remote == "moc" { return "boards" }
        return remote
    }

    /// Выбранная доска: 0 IRBIS, 1 MocTec.
    var boardIndex: Int { min(max(boardBrand, 0), 1) }

    /// Перенос старой вкладки IRBIS / MocTec в «Доски» с нужным чипом.
    private func migrateTab() {
        if remote == "irbis" {
            boardBrand = 0
            remote = "boards"
        } else if remote == "moc" {
            boardBrand = 1
            remote = "boards"
        }
    }

    /// Вкладка «Доски»: чипы IRBIS / MocTec и сетка выбранного пульта.
    private var boardsArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                boardChip(0, "IRBIS")
                boardChip(1, "MocTec")
            }
            keyGrid
        }
    }

    private func boardChip(_ i: Int, _ title: String) -> some View {
        let on: Bool = i == boardIndex
        return Button { boardBrand = i } label: { tabLabel(title, on: on, height: 36) }
    }

    /// Выбранная марка проектора (индекс с защитой от мусора в настройках).
    var projIndex: Int { min(max(projBrand, 0), PROJ_BRANDS.count - 1) }

    /// Вкладка «Проекторы»: чипы марок, подсказка про выключение, все кнопки пульта.
    private var projArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            brandChips
            Text("Выключение: нажмите POWER два раза — проектор спрашивает подтверждение.")
                .font(Term.ru(13)).foregroundColor(Term.dim)
                .lineLimit(2).minimumScaleFactor(0.8)
            projGrid
        }
    }

    private var brandChips: some View {
        HStack(spacing: 6) {
            ForEach(PROJ_BRANDS.indices, id: \.self) { i in brandChip(i) }
        }
    }

    private func brandChip(_ i: Int) -> some View {
        let on: Bool = i == projIndex
        return Button { projBrand = i } label: { tabLabel(PROJ_BRANDS[i].name, on: on, height: 36) }
    }

    /// Пустое место под панель «Цвет»: только сообщает свою рамку.
    private var panelSlot: some View {
        Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(GeometryReader { g in
                Color.clear.preference(key: PanelFrameKey.self, value: g.frame(in: .named("krisa")))
            })
    }

    private var splashLayer: some View {
        SplashView(boot: [
            "krisa37™ ios",
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

    /// RGB-перелив поверх всего экрана (и заставки) в режиме multiply.
    @ViewBuilder private var rgbLayer: some View {
        if let f = activeFlow {
            RgbOverlay(colors: f.colors).ignoresSafeArea()
        }
    }

    private var activeFlow: RgbFlow? { Term.rgbActive ? TermColors.flow(Term.rgbName) : nil }

    /// Панель «Цвет» — над переливом, на месте кнопок пульта.
    private var colorPanelLayer: some View {
        colorPanel()
            .frame(width: panelFrame.width, height: panelFrame.height)
            .position(x: panelFrame.midX, y: panelFrame.midY)
    }

    @ViewBuilder private func colorPanel() -> some View {
        if Term.thermal {
            HeatPanel()
        } else if Term.prism {
            PrismPanel()
        } else if Term.blueprint {
            BlueprintPanel()
        } else {
            TermColorPanel()
        }
    }

    /// Вкладка «Цвет» есть в «Терминале», «Тепловизоре» и «Чертеже» (не в «Призме»).
    private var hasColorTab: Bool { true }
    private var colorTab: Bool { remote == "color" && hasColorTab }
    private var showPanel: Bool { colorTab && ready && !splash && panelFrame.width > 1 }
}

struct SettingsView: View {
    @ObservedObject var model: RemoteModel
    @Environment(\.dismiss) private var dismiss
    @State private var copied: String?
    @AppStorage("theme") private var theme = "terminal"
    private let themes = [("terminal", "Терминал", "Чёрно-белый, пиксельный шрифт, бегущий лог и крысы"),
                          ("prism", "Призма", "Жидкое стекло, лучи и радужные переливы"),
                          ("thermal", "Тепловизор", "Кадр тепловизора: палитры, рамки обнаружения, вращающаяся радужка"),
                          ("blueprint", "Чертёж", "Синий blueprint, схема на фоне")]

    /// Фон строки выбора в текущей теме: выбранная подсвечена.
    private func rowFill(_ on: Bool) -> AnyView {
        if !on { return AnyView(Term.bg) }
        if Term.prism { return AnyView(Color(hex: 0x8B6CFF, alpha: 0.35)) }
        if Term.thermal { return AnyView(LinearGradient(colors: [Heat.color(0.55), Heat.color(0.72), Heat.color(0.86)], startPoint: .leading, endPoint: .trailing)) }
        if Term.blueprint { return AnyView(Blueprint.ink) }
        return AnyView(Term.fg)
    }

    /// Цвет текста строки выбора.
    private func rowInk(_ on: Bool) -> Color {
        if !on || Term.prism { return Term.fg }
        if Term.blueprint { return Blueprint.bg }
        return Color.black
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
    var currentKeys: [(label: String, code: UInt32)] {
        if tab == "proj" { return PROJ_BRANDS[projIndex].keys }
        return boardIndex == 1 ? MOC_KEYS : KEYS
    }
    var remoteSubtitle: String {
        if tab == "proj" {
            let b: ProjBrand = PROJ_BRANDS[projIndex]
            return "проектор :: " + b.name + " :: " + b.remoteNo
        }
        if tab == "ac" {
            let m: Int = AcState.decode(acState).model
            return "кондиционер :: Haier :: " + Haier.models[m]
        }
        return boardIndex == 1 ? "доска :: MocTec :: NEC 04FB" : "доска :: IRBIS #500202 :: NEC 807F"
    }
    /// Шрифт подзаголовка: он русский — в VT323 кириллицы нет.
    var subtitleFont: Font {
        if Term.prism { return Prism.body(13) }
        if Term.terminal || Term.thermal { return Term.ru(14) }
        return Term.mono(20)
    }

    /// Вкладки «Доски» / «Проекторы» / «Кондиционеры» / «Цвет» над пультом.
    func remoteTabs() -> some View {
        GeometryReader { g in tabRow(width: g.size.width) }
            .frame(height: 40)
    }

    /// Вкладки: id, подпись и вес ширины (длина подписи + 2.5).
    private static let tabs: [(id: String, title: String, weight: CGFloat)] = [
        ("boards", "Доски", 7.5), ("proj", "Проекторы", 11.5), ("ac", "Кондиционеры", 14.5), ("color", "Цвет", 6.5),
    ]

    private func tabRow(width: CGFloat) -> some View {
        HStack(spacing: 8) {
            ForEach(ContentView.tabs.indices, id: \.self) { i in
                remoteTab(ContentView.tabs[i].id, ContentView.tabs[i].title)
                    .frame(width: tabWidth(i, total: width))
            }
        }
    }

    /// Ширина вкладки пропорционально её весу.
    private func tabWidth(_ i: Int, total: CGFloat) -> CGFloat {
        var sum: CGFloat = 0
        for t in ContentView.tabs { sum += t.weight }
        let gaps: CGFloat = 8 * CGFloat(ContentView.tabs.count - 1)
        let free: CGFloat = max(0, total - gaps)
        return free * ContentView.tabs[i].weight / sum
    }

    /// Какая вкладка подсвечена.
    private var shownRemote: String { tab }

    private func remoteTab(_ id: String, _ title: String) -> some View {
        let on: Bool = shownRemote == id
        return Button { remote = id } label: { tabLabel(title, on: on) }
    }

    private func tabLabel(_ title: String, on: Bool, height: CGFloat = 40) -> some View {
        TabLabel(title: title, on: on, height: height, ruSize: 12.5)
    }

    /// Фон текущей темы. В «Призме» и «Чертеже» крыс нет, в «Тепловизоре» они — тёплые пятна в рамках.
    @ViewBuilder func themeBackground() -> some View {
        if Term.prism {
            PrismBackground()
        } else if Term.thermal {
            ZStack {
                ThermalBackground()
                TimelineView(.animation) { tl in RunningRats(t: tl.date.timeIntervalSinceReferenceDate) }
            }
        } else if Term.blueprint {
            BlueprintBackground()
        } else if Term.matrix {
            MatrixBackground()
        } else {
            LogBackground()
        }
    }

    /// Заголовок «krisa» в текущей теме.
    @ViewBuilder func titleView() -> some View {
        if Term.prism {
            IrisText(text: ready ? "krisa37™" : " ", font: Prism.display(32))
        } else if Term.thermal {
            HeatText(text: ready ? "krisa37™_" : " ", font: Term.mono(60))
        } else if Term.blueprint {
            Text(ready ? "krisa37™" : " ").font(Prism.display(30)).foregroundColor(Blueprint.ink)
                .padding(.vertical, 6)
        } else {
            TypeLine(text: ready ? "krisa37™" : "", font: Term.mono(60))
                .shadow(color: Term.fg.opacity(0.9), radius: 8)
        }
    }

    /// Кнопка шапки: рамка в «Терминале», жидкое стекло в «Призме».
    @ViewBuilder func headerLabel(_ text: String, width: CGFloat) -> some View {
        if Term.prism {
            Text(text).font(Prism.display(17)).foregroundColor(Term.fg)
                .frame(width: width, height: 44)
                .background(GlassBox(radius: 16, seed: Double(width)))
        } else if Term.blueprint {
            Text(text).font(Blueprint.semi(15)).foregroundColor(Blueprint.ink)
                .frame(width: width, height: 44)
                .background(Blueprint.bg.opacity(0.78))
                .overlay(Rectangle().strokeBorder(Blueprint.ink, lineWidth: 1))
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

/// Плашка вкладки / чипа / кнопки пульта кондиционера в стиле текущей темы; on — включена (залита).
struct TabLabel: View {
    let title: String
    let on: Bool
    var height: CGFloat = 40
    /// Кегль русских подписей (в VT323 кириллицы нет — у них свой шрифт).
    var ruSize: CGFloat = 13

    /// Есть ли в подписи кириллица.
    private var isRu: Bool {
        title.unicodeScalars.contains { u in u.value >= 0x400 && u.value <= 0x4FF }
    }

    private var font: Font {
        if isRu && (Term.terminal || Term.thermal) { return Term.ru(ruSize) }
        return Term.mono(22)
    }

    var body: some View {
        if Term.prism {
            prismLabel
        } else if Term.thermal {
            Text(title).font(font).foregroundColor(on ? Heat.ink : Term.fg)
                .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 3)
                .frame(maxWidth: .infinity).frame(height: height)
                .background(thermalFill)
                .overlay(Rectangle().strokeBorder(Heat.yellow, lineWidth: 1))
        } else if Term.blueprint {
            Blueprint.caps(title, isRu ? ruSize * 0.88 : 13).foregroundColor(on ? Blueprint.bg : Blueprint.ink)
                .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 3)
                .frame(maxWidth: .infinity).frame(height: height)
                .background(on ? Blueprint.ink : Blueprint.bg.opacity(0.78))
                .overlay(Rectangle().strokeBorder(Blueprint.ink, lineWidth: 1))
        } else {
            Text(title).font(font).foregroundColor(on ? Color.black : Term.fg)
                .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 3)
                .frame(maxWidth: .infinity).frame(height: height)
                .background(on ? Term.fg : Color.black)
                .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
        }
    }

    private var prismLabel: some View {
        let size: CGFloat = isRu ? ruSize * 0.76 : 15
        return Text(title).font(Prism.display(size)).foregroundColor(on ? Prism.ink : Term.fg)
            .lineLimit(1).minimumScaleFactor(0.6).padding(.horizontal, 3)
            .frame(maxWidth: .infinity).frame(height: height)
            .background(GlassBox(radius: 14, on: on, seed: on ? 5 : 2))
    }

    private var thermalFill: AnyView {
        if on { return AnyView(LinearGradient(colors: [Heat.color(0.55), Heat.color(0.72), Heat.color(0.86)], startPoint: .leading, endPoint: .trailing)) }
        return AnyView(Color.black.opacity(0.65))
    }
}
