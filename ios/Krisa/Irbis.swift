import SwiftUI

/// Найденная сканером команда в JSON: [{l: имя, c: код}] (ключ "irbis_found").
private struct FoundKeyJSON: Codable {
    var l: String
    var c: Int64
}

/// Пульт IRBIS: найденные сканером команды, кнопки-макросы и сканер скрытых команд (как Android buildIrbis/buildScanner).
enum Irbis {
    /// Адрес NEC пульта IRBIS.
    static let addr: Int = 0x807F
    /// Темп авто-сканера, секунды.
    static let paces: [Double] = [0.5, 1, 2]

    /// Код NEC: адрес (16 бит), команда, инверсия команды.
    static func nec(_ addr: Int, _ cmd: Int) -> UInt32 {
        let a: UInt32 = UInt32(addr & 0xFFFF) << 16
        let c: UInt32 = UInt32(cmd & 0xFF) << 8
        let n: UInt32 = UInt32(~cmd & 0xFF)
        return a | c | n
    }

    /// Подпись известного кода из всех пультов приложения, или nil.
    static func knownLabel(_ code: UInt32) -> String? {
        let irbis: [(label: String, code: UInt32)] = KEYS + ScriptStore.irbisFound
        if let k = irbis.first(where: { k in k.code == code }) { return "IRBIS " + k.label }
        if let k = MOC_KEYS.first(where: { k in k.code == code }) { return "MocTec " + k.label }
        for b in PROJ_BRANDS {
            if let k = b.keys.first(where: { k in k.code == code }) { return b.name + " " + k.label }
        }
        return nil
    }

    static func decodeFound(_ json: String) -> [(label: String, code: UInt32)] {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONDecoder().decode([FoundKeyJSON].self, from: data) else { return [] }
        return arr.map { j in (label: j.l, code: UInt32(truncatingIfNeeded: j.c)) }
    }

    static func encodeFound(_ list: [(label: String, code: UInt32)]) -> String {
        let arr: [FoundKeyJSON] = list.map { k in FoundKeyJSON(l: k.label, c: Int64(k.code)) }
        guard let data = try? JSONEncoder().encode(arr) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    static func hex2(_ v: Int) -> String { String(format: "%02X", UInt32(v & 0xFF)) }
    static func hex4(_ v: Int) -> String { String(format: "%04X", UInt32(v & 0xFFFF)) }
    static func hex8(_ v: UInt32) -> String { String(format: "%08X", v) }
}

/// Какое окно ввода/выбора открыто в разделе IRBIS.
enum IrbisAsk: Identifiable {
    case newMacro
    case renameMacro(Int)
    case saveFound(UInt32)
    case address
    case foundList
    case renameFound(UInt32)

    var id: String {
        switch self {
        case .newMacro: return "new"
        case .renameMacro(let i): return "rename" + String(i)
        case .saveFound(let c): return "save" + String(c)
        case .address: return "addr"
        case .foundList: return "found"
        case .renameFound(let c): return "rf" + String(c)
        }
    }
}

/// Под 12 кнопками IRBIS: найденные сканером, «мои кнопки» (макросы), «+ макрос», «сканер» и панель сканера.
struct IrbisExtras: View {
    @ObservedObject var model: RemoteModel
    @Binding var scanOpen: Bool
    let ready: Bool
    /// Открыть сценарий номер i во вкладке «Сценарии».
    let openScript: (Int) -> Void

    @AppStorage("scripts") private var json = ""
    @AppStorage("irbis_found") private var foundJSON = ""
    @AppStorage("scanAddr") private var scanAddr = 0x807F
    @AppStorage("scanCmd") private var scanCmd = 0
    @AppStorage("scanSkip") private var scanSkip = true
    @AppStorage("scanPace") private var scanPace = 1

    @State private var ask: IrbisAsk?
    @State private var macroMenu: Int?
    @State private var deleteMacro: Int?
    @State private var foundMenu: UInt32?
    @State private var autoOn = false
    @State private var autoToken = 0

    private var scripts: [KScript] { ScriptStore.load(json) }
    private var found: [(label: String, code: UInt32)] { Irbis.decodeFound(foundJSON) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            foundSection
            caption("мои кнопки").padding(.top, 8)
            macros
            HStack(spacing: 6) {
                bigButton("[ + макрос ]", on: false) { ask = .newMacro }
                bigButton(scanOpen ? "[ сканер ▴ ]" : "[ сканер ▾ ]", on: scanOpen) { scanOpen.toggle() }
            }
            .padding(.top, 8)
            if scanOpen { scanner.padding(.top, 8) }
        }
        .sheet(item: $ask) { a in askView(a) }
        .confirmationDialog(macroTitle, isPresented: macroMenuShown, titleVisibility: .visible) { macroActions }
        .alert(deleteTitle, isPresented: deleteShown) {
            Button("Нет", role: .cancel) {}
            Button("Удалить", role: .destructive) { confirmDelete() }
        }
    }

    // MARK: общие элементы

    private func caption(_ t: String) -> some View {
        Text(t).font(Term.ru(14)).foregroundColor(Term.dim).padding(.leading, 4)
    }

    /// В «Призме» и «Чертеже» подписи кнопок без квадратных скобок.
    private func label(_ s: String) -> String {
        if !(Term.prism || Term.blueprint) { return s }
        var t: String = s
        if t.hasPrefix("[") { t.removeFirst() }
        if t.hasSuffix("]") { t.removeLast() }
        return t.trimmingCharacters(in: .whitespaces)
    }

    private func bigButton(_ title: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TabLabel(title: label(title), on: on, height: 48, ruSize: 15, forceRu: true)
        }
    }

    private func smallButton(_ title: String, on: Bool, height: CGFloat, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TabLabel(title: label(title), on: on, height: height, ruSize: 13, forceRu: true)
        }
    }

    // MARK: найденные сканером

    private static let grid3: [GridItem] = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10),
                                            GridItem(.flexible(), spacing: 10)]

    @ViewBuilder private var foundSection: some View {
        let list: [(label: String, code: UInt32)] = found
        if !list.isEmpty && ready {
            caption("найденные сканером").padding(.top, 8)
            LazyVGrid(columns: IrbisExtras.grid3, spacing: 10) {
                ForEach(0..<list.count, id: \.self) { i in foundKey(i, list[i].label, list[i].code) }
            }
        }
    }

    private func foundKey(_ i: Int, _ label: String, _ code: UInt32) -> some View {
        KeyView(index: KEYS.count + i, label: label, code: code, inverted: false,
                revealDelay: 0.04 * Double(min(i, 15)),
                onDown: { model.press(label, code) },
                onUp: { model.release() },
                scrollable: true)
            .frame(height: 64)
    }

    // MARK: мои кнопки

    @ViewBuilder private var macros: some View {
        let list: [KScript] = scripts
        let pinned: [Int] = list.indices.filter { i in list[i].pin }
        if pinned.isEmpty {
            Text("нет — нажмите «+ макрос» или в «Сценариях» кнопку «на пульт»")
                .font(Term.ru(13)).foregroundColor(Term.dim).padding(.leading, 4)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                ForEach(pinned, id: \.self) { i in macroButton(i, list[i].name) }
            }
        }
    }

    private func macroButton(_ i: Int, _ name: String) -> some View {
        let tag: String = "macro" + String(i)
        let on: Bool = model.scriptRunning && model.scriptTag == tag
        return TabLabel(title: label("[ " + name + " ]"), on: on, height: 52, ruSize: 15, forceRu: true)
            .contentShape(Rectangle())
            .onTapGesture { runMacro(i) }
            .onLongPressGesture(minimumDuration: 0.5) { macroMenu = i }
    }

    private func runMacro(_ i: Int) {
        if model.scriptRunning {
            model.stopScript()
            return
        }
        let list: [KScript] = scripts
        if i < list.count { model.runScript(list[i], tag: "macro" + String(i)) }
    }

    private var macroTitle: String {
        let list: [KScript] = scripts
        if let i = macroMenu, i < list.count { return list[i].name }
        return ""
    }

    private var macroMenuShown: Binding<Bool> {
        Binding(get: { macroMenu != nil }, set: { v in if !v { macroMenu = nil } })
    }

    @ViewBuilder private var macroActions: some View {
        if let i = macroMenu {
            Button("Изменить в «Сценариях»") { openScript(i) }
            Button("Переименовать") { later { ask = .renameMacro(i) } }
            Button("Убрать с пульта") { unpin(i) }
            Button("Удалить", role: .destructive) { later { deleteMacro = i } }
        }
        Button("Отмена", role: .cancel) {}
    }

    /// Открыть следующее окно, когда закроется текущее меню.
    private func later(_ f: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { f() }
    }

    private var deleteTitle: String {
        let list: [KScript] = scripts
        if let i = deleteMacro, i < list.count { return "Удалить «" + list[i].name + "»?" }
        return "Удалить?"
    }

    private var deleteShown: Binding<Bool> {
        Binding(get: { deleteMacro != nil }, set: { v in if !v { deleteMacro = nil } })
    }

    private func saveScripts(_ list: [KScript]) {
        json = ScriptStore.encode(list)
    }

    private func unpin(_ i: Int) {
        var list: [KScript] = scripts
        if i < list.count {
            list[i].pin = false
            saveScripts(list)
        }
    }

    private func confirmDelete() {
        guard let i = deleteMacro else { return }
        deleteMacro = nil
        var list: [KScript] = scripts
        if i >= list.count { return }
        list.remove(at: i)
        if list.isEmpty { list.append(KScript(name: "Сценарий 1")) }
        let cur: Int = UserDefaults.standard.integer(forKey: "scriptCur")
        if cur >= i && cur > 0 { UserDefaults.standard.set(cur - 1, forKey: "scriptCur") }
        saveScripts(list)
    }

    // MARK: сканер

    private var code: UInt32 { Irbis.nec(scanAddr, scanCmd) }
    private var pace: Double { Irbis.paces[min(max(scanPace, 0), Irbis.paces.count - 1)] }

    private var warning: some View {
        let plate: Bool = Term.prism || Term.thermal || Term.blueprint
        let text: String = "⚠ Сканер шлёт команды, которых нет на пульте. Доска может открыть сервисное меню, поменять настройки или выключиться — авто-режим не оставляйте без присмотра.\n1. Направьте телефон на доску, нажмите «▶ авто» (или «▶|» по одной).\n2. Доска отреагировала — «пауза», затем «◀» и «⟳», чтобы найти точный код.\n3. «★ сработало» — дайте имя, и код станет кнопкой пульта и командой в «Сценариях»."
        return Text(text).font(Term.ru(13))
            .foregroundColor(plate ? Term.fg : Term.dim)
            .fixedSize(horizontal: false, vertical: true)
            .padding(plate ? 12 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(plate ? Term.bg.opacity(0.85) : Color.clear)
            .overlay(Rectangle().strokeBorder(plate ? Term.line : Color.clear, lineWidth: 1))
    }

    private var codePlate: some View {
        let c: UInt32 = code
        let top: String = Irbis.hex4(Int(c >> 16)) + " " + Irbis.hex4(Int(c & 0xFFFF))
        let known: String? = Irbis.knownLabel(c)
        let state: String = known.map { k in "известна: " + k } ?? "новая"
        let info: String = "команда 0x" + Irbis.hex2(scanCmd) + " · " + String(scanCmd + 1) + " / 256 · " + state
        return VStack(spacing: 4) {
            Text(top).font(Term.mono(44)).foregroundColor(Term.fg).lineLimit(1).minimumScaleFactor(0.5)
                .shadow(color: Term.thermal ? Heat.glow : Term.fg.opacity(0.6), radius: 8)
            Text(info).font(Term.ru(14)).foregroundColor(Term.dim).lineLimit(2).multilineTextAlignment(.center)
        }
        .padding(.vertical, 10).padding(.horizontal, 8)
        .frame(maxWidth: .infinity)
        .background(Term.bg.opacity(0.85))
        .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
    }

    private var scanner: some View {
        VStack(spacing: 6) {
            warning
            codePlate.padding(.top, 2)
            HStack(spacing: 6) {
                smallButton("[◀]", on: false, height: 54) { step(-1) }
                smallButton("[⟳]", on: false, height: 54) { step(0) }
                smallButton("[▶|]", on: false, height: 54) { step(1) }
            }
            HStack(spacing: 6) {
                smallButton(autoOn ? "[|| пауза]" : "[▶ авто]", on: autoOn, height: 54) { toggleAuto() }
                smallButton("[ ★ сработало ]", on: false, height: 54) { saveCurrent() }
            }
            HStack(spacing: 6) {
                smallButton("[ адрес " + Irbis.hex4(scanAddr) + " ]", on: false, height: 44) { ask = .address }
                smallButton(scanSkip ? "[ только новые ]" : "[ все коды ]", on: false, height: 44) { scanSkip.toggle() }
                smallButton("[ темп " + ScriptStore.fmt(pace) + " с ]", on: false, height: 44) { scanPace = (scanPace + 1) % Irbis.paces.count }
            }
            HStack(spacing: 6) {
                smallButton("[ с 00 ]", on: false, height: 44) { fromStart() }
                smallButton("[ найденные: " + String(found.count) + " ]", on: false, height: 44) { manageFound() }
            }
        }
        .onDisappear { pause(quiet: true) }
        .confirmationDialog(foundTitle, isPresented: foundMenuShown, titleVisibility: .visible) { foundActions }
    }

    /// Следующая (dir = ±1) команда с учётом «только новые»; nil, если дальше ничего нет.
    private func next(_ from: Int, _ dir: Int) -> Int? {
        var i: Int = from + dir
        while i >= 0 && i <= 255 {
            if !scanSkip || Irbis.knownLabel(Irbis.nec(scanAddr, i)) == nil { return i }
            i += dir
        }
        return nil
    }

    private func sendCurrent() {
        let c: UInt32 = code
        model.sendOnce(c, status: "> tx скан 0x" + Irbis.hex8(c) + " [sent]")
    }

    private func step(_ dir: Int) {
        if autoOn { pause(quiet: true) }
        if dir != 0 {
            guard let n = next(scanCmd, dir) else {
                model.say(dir > 0 ? "> дальше команд нет (FF)" : "> это первая команда")
                return
            }
            scanCmd = n
        }
        sendCurrent()
    }

    private func start() {
        if scanSkip && Irbis.knownLabel(code) != nil { scanCmd = next(scanCmd, 1) ?? 0 }
        autoOn = true
        autoToken += 1
        UIApplication.shared.isIdleTimerDisabled = true
        tick(autoToken)
    }

    /// Авто: отправить текущий, подождать темп, перейти к следующему.
    private func tick(_ token: Int) {
        guard autoOn && token == autoToken else { return }
        sendCurrent()
        DispatchQueue.main.asyncAfter(deadline: .now() + pace) {
            guard autoOn && token == autoToken else { return }
            if let n = next(scanCmd, 1) {
                scanCmd = n
                tick(token)
            } else {
                pause(quiet: true)
                model.say("> сканер прошёл все команды адреса " + Irbis.hex4(scanAddr))
            }
        }
    }

    private func toggleAuto() {
        if autoOn {
            pause(quiet: false)
        } else {
            start()
        }
    }

    private func pause(quiet: Bool) {
        if !quiet && autoOn { model.say("> пауза на 0x" + Irbis.hex8(code)) }
        if autoOn { UIApplication.shared.isIdleTimerDisabled = false }
        autoOn = false
        autoToken += 1
    }

    private func fromStart() {
        pause(quiet: true)
        scanCmd = 0
    }

    private func saveCurrent() {
        if autoOn { pause(quiet: false) }
        if let k = Irbis.knownLabel(code) {
            model.say("> этот код уже есть: " + k)
            return
        }
        ask = .saveFound(code)
    }

    private func setFound(_ list: [(label: String, code: UInt32)]) {
        foundJSON = Irbis.encodeFound(list)
        ScriptStore.irbisFound = list
    }

    private func manageFound() {
        if found.isEmpty {
            model.say("> пока ничего не найдено")
            return
        }
        ask = .foundList
    }

    private var foundTitle: String {
        guard let c = foundMenu else { return "" }
        return found.first(where: { k in k.code == c })?.label ?? ""
    }

    private var foundMenuShown: Binding<Bool> {
        Binding(get: { foundMenu != nil }, set: { v in if !v { foundMenu = nil } })
    }

    @ViewBuilder private var foundActions: some View {
        if let c = foundMenu {
            Button("Переименовать") { later { ask = .renameFound(c) } }
            Button("Удалить", role: .destructive) { setFound(found.filter { k in k.code != c }) }
        }
        Button("Отмена", role: .cancel) {}
    }

    // MARK: окна

    @ViewBuilder private func askView(_ a: IrbisAsk) -> some View {
        switch a {
        case .newMacro:
            newMacroSheet
        case .renameMacro(let i):
            renameMacroSheet(i)
        case .saveFound(let c):
            saveFoundSheet(c)
        case .address:
            addressSheet
        case .foundList:
            foundListSheet
        case .renameFound(let c):
            renameFoundSheet(c)
        }
    }

    private var newMacroSheet: some View {
        let n: Int = scripts.filter { s in s.pin }.count + 1
        return AskSheet(title: "Новая кнопка-макрос", value: "Макрос " + String(n), numeric: false) { t in
            ask = nil
            var list: [KScript] = scripts
            list.append(KScript(name: t, blocks: [.dev(0)], pin: true))
            saveScripts(list)
            openScript(list.count - 1)
            model.say("> добавляйте блоки «отправить», «ждать», «повторить» — кнопка уже на пульте IRBIS")
        } cancel: { ask = nil }
    }

    private func renameMacroSheet(_ i: Int) -> some View {
        let list: [KScript] = scripts
        let name: String = i < list.count ? list[i].name : ""
        return AskSheet(title: "Имя кнопки", value: name, numeric: false) { t in
            ask = nil
            var l: [KScript] = scripts
            if i < l.count {
                l[i].name = t
                saveScripts(l)
            }
        } cancel: { ask = nil }
    }

    private func saveFoundSheet(_ c: UInt32) -> some View {
        let cmd: Int = Int((c >> 8) & 0xFF)
        return AskSheet(title: "Что сделала доска? (имя кнопки)", value: "CMD " + Irbis.hex2(cmd), numeric: false) { t in
            ask = nil
            var list: [(label: String, code: UInt32)] = found
            list.append((label: t, code: c))
            setFound(list)
            model.say("> «" + t + "» (0x" + Irbis.hex8(c) + ") — новая кнопка IRBIS")
        } cancel: { ask = nil }
    }

    private var addressSheet: some View {
        AskSheet(title: "Адрес NEC (4 hex-цифры)", value: Irbis.hex4(scanAddr), numeric: false) { t in
            ask = nil
            if t.count <= 4, let v = Int(t, radix: 16) {
                pause(quiet: true)
                scanAddr = v
                scanCmd = 0
            } else {
                model.say("Нужно 4 hex-цифры, например 807F", err: true)
            }
        } cancel: { ask = nil }
    }

    private var foundListSheet: some View {
        let list: [(label: String, code: UInt32)] = found
        let items: [String] = list.map { k in k.label + " · " + Irbis.hex8(k.code) }
        return ChoiceSheet(title: "Найденные команды", items: items, selected: nil) { w in
            ask = nil
            if w < list.count {
                let c: UInt32 = list[w].code
                later { foundMenu = c }
            }
        } cancel: { ask = nil }
    }

    private func renameFoundSheet(_ c: UInt32) -> some View {
        let name: String = found.first(where: { k in k.code == c })?.label ?? ""
        return AskSheet(title: "Имя кнопки", value: name, numeric: false) { t in
            ask = nil
            var list: [(label: String, code: UInt32)] = found
            for k in list.indices where list[k].code == c { list[k].label = t }
            setFound(list)
        } cancel: { ask = nil }
    }
}
