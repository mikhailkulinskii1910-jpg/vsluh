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

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            LogBackground().ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        TypeLine(text: ready ? "krisa" : "", font: Term.mono(60))
                            .shadow(color: .white.opacity(0.9), radius: 8)
                        Text("#500202 :: IRBIS :: NEC 38kHz").font(Term.mono(20)).foregroundColor(Term.dim)
                        Text(model.modeLine).font(Term.ru(14)).foregroundColor(model.routeOK || model.mode == .http ? Term.fg : Term.dim)
                            .lineLimit(1).minimumScaleFactor(0.7).padding(.top, 4)
                    }
                    Spacer()
                    Button { help = true } label: {
                        Text("[?]").font(Term.mono(24)).foregroundColor(Term.fg)
                            .frame(width: 52, height: 44)
                            .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
                    }
                    .padding(.top, 10)
                    .accessibilityLabel("Как пользоваться")
                    Button { settings = true } label: {
                        Text("[tx]").font(Term.mono(24)).foregroundColor(Term.fg)
                            .frame(width: 64, height: 44)
                            .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
                    }
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

            Scanlines().ignoresSafeArea()

            if splash {
                SplashView(boot: [
                    "krisa ir-remote ios",
                    "loading nec table ........ [ok]",
                    "audio out ................ [" + (AudioIr.adapterConnected ? "ok" : "--") + "]",
                    "decoding rat.png ......... [ok]",
                ]) {
                    withAnimation(.easeOut(duration: 0.26)) { splash = false }
                    ready = true
                }
                .transition(.opacity)
                .zIndex(10)
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(splash)
        .sheet(isPresented: $settings) { SettingsView(model: model) }
        .fullScreenCover(isPresented: $help) { HelpView() }
        .onAppear {
            // Для скриншота в CI: KRISA_OPEN_HELP=1 сразу открывает «Как пользоваться».
            if ProcessInfo.processInfo.environment["KRISA_OPEN_HELP"] != nil { splash = false; ready = true; help = true }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: RemoteModel
    @Environment(\.dismiss) private var dismiss
    @State private var copied: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("> tx_mode").font(Term.mono(30))
                    Spacer()
                    Button("[ok]") { dismiss() }.font(Term.mono(26)).foregroundColor(Term.fg)
                }
                ForEach(TxMode.allCases) { m in
                    Button { model.mode = m } label: {
                        HStack {
                            Text(model.mode == m ? "[x]" : "[ ]").font(Term.mono(22))
                            Text(m.label).font(Term.ru(14))
                            Spacer()
                        }
                        .padding(10)
                        .foregroundColor(model.mode == m ? .black : Term.fg)
                        .background(model.mode == m ? Term.fg : Color.black)
                        .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
                    }
                }
                if model.mode == .http {
                    Text("Адрес модуля Tasmota").font(Term.ru(12)).foregroundColor(Term.dim)
                    TextField("192.168.1.50", text: $model.host)
                        .font(Term.ru(16)).keyboardType(.URL).autocapitalization(.none).disableAutocorrection(true)
                        .padding(10).overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
                }

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
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}

/// «Как пользоваться»: та же страница, что в веб-версии (help.html из бандла).
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
    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView()
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        if let url = Bundle.main.url(forResource: "help", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {}
}
