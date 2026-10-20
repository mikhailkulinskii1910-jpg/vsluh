import SwiftUI

/**
 Сценарии (вкладка «Сценарии»): программа из блоков, как в Scratch. Перенесено с Android Scripts.kt.
 Блоки идут списком; цикл — пара блоков «цикл ×N» … «конец цикла» (циклы можно вкладывать).
 Команда относится к устройству из ближайшего блока «устройство» выше неё.
 */
enum SBlock {
    case dev(Int)
    case cmd(String, UInt32)
    /// Команда кондиционеру: состояние целиком.
    case ac(power: Bool, mode: AcMode, temp: Int, fan: AcFan)
    case delay(Double)
    case loop(Int)
    case end

    var isEnd: Bool {
        if case .end = self { return true }
        return false
    }
    var isLoop: Bool {
        if case .loop = self { return true }
        return false
    }
}

struct KScript {
    var name: String
    var blocks: [SBlock] = []
}

/// Устройство для блока «устройство».
struct SDevice {
    let title: String
    let keys: [(label: String, code: UInt32)]
    /// Номер вида пульта Haier; -1 — не кондиционер.
    let acModel: Int
}

/// Что отправить: NEC-код или кадр Haier (с номером вида пульта).
enum ScriptSend {
    case nec(UInt32, String)
    case haier([Int], Int)

    var what: String {
        switch self {
        case .nec(let code, let label): return String(format: "0x%08X ", code) + label
        case .haier(let bytes, _): return "haier " + Haier.hex(bytes)
        }
    }
}

/// JSON как у Android: [{name, blocks:[{t:"dev",d},{t:"cmd",l,c},{t:"ac",p,m,x,f},{t:"delay",s},{t:"loop",n},{t:"end"}]}].
private struct SBlockJSON: Codable {
    var t: String
    var d: Int?
    var l: String?
    var c: Int64?
    var p: Bool?
    var m: String?
    var x: Int?
    var f: String?
    var s: Double?
    var n: Int?

    init(t: String) { self.t = t }
}

private struct KScriptJSON: Codable {
    var name: String
    var blocks: [SBlockJSON]
}

enum ScriptStore {
    static let devices: [SDevice] = makeDevices()

    private static func makeDevices() -> [SDevice] {
        var out: [SDevice] = [SDevice(title: "Доска · IRBIS", keys: KEYS, acModel: -1),
                              SDevice(title: "Доска · MocTec", keys: MOC_KEYS, acModel: -1)]
        for b in PROJ_BRANDS { out.append(SDevice(title: "Проектор · " + b.name, keys: b.keys, acModel: -1)) }
        for i in 0..<Haier.models.count {
            let title: String = "Кондиционер · Haier " + String(i + 1) + " " + Haier.models[i]
            out.append(SDevice(title: title, keys: [], acModel: i))
        }
        return out
    }

    /// Пример для первого запуска: выключить проектор NEC (два нажатия POWER) и доску MocTec.
    static func example() -> KScript {
        let nec: UInt32 = PROJ_BRANDS[0].keys.first { k in k.label == "POWER" }?.code ?? 0x189710EF
        let moc: UInt32 = MOC_KEYS.first { k in k.label == "POWER" }?.code ?? 0x04FB4AB5
        let blocks: [SBlock] = [.dev(2), .cmd("POWER", nec), .delay(1.5), .cmd("POWER", nec), .delay(2), .dev(1), .cmd("POWER", moc)]
        return KScript(name: "Конец урока", blocks: blocks)
    }

    /// Устройство, к которому относится блок номер at (ближайший «устройство» выше), или -1.
    static func deviceAt(_ s: KScript, _ at: Int) -> Int {
        var i: Int = min(at, s.blocks.count - 1)
        while i >= 0 {
            if case .dev(let d) = s.blocks[i] { return d }
            i -= 1
        }
        return -1
    }

    /// Глубина вложенности циклов перед блоком at — для отступа в списке.
    static func depthAt(_ s: KScript, _ at: Int) -> Int {
        var d: Int = 0
        for i in 0..<min(at, s.blocks.count) {
            if s.blocks[i].isLoop { d += 1 } else if s.blocks[i].isEnd { d = max(0, d - 1) }
        }
        if at < s.blocks.count && s.blocks[at].isEnd { return max(0, d - 1) }
        return d
    }

    static func fmt(_ x: Double) -> String {
        if x == x.rounded(.down) { return String(Int(x)) }
        return String(format: "%.1f", x)
    }

    static func text(_ b: SBlock) -> String {
        switch b {
        case .dev(let d):
            return "→ " + (d >= 0 && d < devices.count ? devices[d].title : "?")
        case .cmd(let label, _):
            return "▶ " + label
        case .ac(let power, let mode, let temp, let fan):
            if !power { return "▶ выключить" }
            return "▶ вкл, " + mode.title + ", " + String(temp) + "°, скорость " + fan.title
        case .delay(let sec):
            return "задержка " + fmt(sec) + " с"
        case .loop(let n):
            return "цикл ×" + String(n) + " {"
        case .end:
            return "} конец цикла"
        }
    }

    /// Конец блока i: для цикла — индекс его «конца цикла» (или последний блок), иначе сам i.
    static func rangeEnd(_ s: KScript, _ i: Int) -> Int {
        if i < 0 || i >= s.blocks.count || !s.blocks[i].isLoop { return i }
        var d: Int = 0
        var k: Int = i + 1
        while k < s.blocks.count {
            if s.blocks[k].isLoop {
                d += 1
            } else if s.blocks[k].isEnd {
                if d == 0 { return k }
                d -= 1
            }
            k += 1
        }
        return s.blocks.count - 1
    }

    /// Перенести блок from (цикл — вместе с содержимым) так, чтобы он встал перед позицией to исходного списка.
    static func move(_ s: inout KScript, _ from: Int, _ to: Int) -> Bool {
        let end: Int = rangeEnd(s, from)
        if to >= from && to <= end + 1 { return false }      // на то же место или внутрь самого себя
        let part: [SBlock] = Array(s.blocks[from...end])
        s.blocks.removeSubrange(from...end)
        let at: Int = to > end ? to - part.count : to
        s.blocks.insert(contentsOf: part, at: min(max(at, 0), s.blocks.count))
        return true
    }

    /// Удалить блок i (цикл — вместе с содержимым).
    static func remove(_ s: inout KScript, _ i: Int) {
        if i < 0 || i >= s.blocks.count { return }
        let end: Int = rangeEnd(s, i)
        s.blocks.removeSubrange(i...end)
    }

    // MARK: JSON

    private static func toJSON(_ b: SBlock) -> SBlockJSON {
        switch b {
        case .dev(let d):
            var j = SBlockJSON(t: "dev"); j.d = d; return j
        case .cmd(let label, let code):
            var j = SBlockJSON(t: "cmd"); j.l = label; j.c = Int64(code); return j
        case .ac(let power, let mode, let temp, let fan):
            var j = SBlockJSON(t: "ac"); j.p = power; j.m = mode.rawValue; j.x = temp; j.f = fan.rawValue; return j
        case .delay(let sec):
            var j = SBlockJSON(t: "delay"); j.s = sec; return j
        case .loop(let n):
            var j = SBlockJSON(t: "loop"); j.n = n; return j
        case .end:
            return SBlockJSON(t: "end")
        }
    }

    private static func fromJSON(_ j: SBlockJSON) -> SBlock {
        switch j.t {
        case "dev": return .dev(j.d ?? 0)
        case "cmd": return .cmd(j.l ?? "?", UInt32(truncatingIfNeeded: j.c ?? 0))
        case "ac":
            let mode: AcMode = AcMode(rawValue: j.m ?? "") ?? .cool
            let fan: AcFan = AcFan(rawValue: j.f ?? "") ?? .auto
            return .ac(power: j.p ?? true, mode: mode, temp: min(max(j.x ?? 24, 16), 30), fan: fan)
        case "delay": return .delay(j.s ?? 1)
        case "loop": return .loop(j.n ?? 1)
        default: return .end
        }
    }

    static func encode(_ list: [KScript]) -> String {
        let arr: [KScriptJSON] = list.map { s in KScriptJSON(name: s.name, blocks: s.blocks.map { b in toJSON(b) }) }
        guard let data = try? JSONEncoder().encode(arr) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    static func decode(_ json: String) -> [KScript] {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONDecoder().decode([KScriptJSON].self, from: data) else { return [] }
        return arr.map { j in KScript(name: j.name, blocks: j.blocks.map { b in fromJSON(b) }) }
    }

    /// Сохранённые сценарии; если пусто — пример «Конец урока».
    static func load(_ json: String) -> [KScript] {
        let list: [KScript] = decode(json)
        return list.isEmpty ? [example()] : list
    }
}

/// Выполнение сценария (в потоке передачи).
enum ScriptRunner {
    /// Конец цикла, начатого блоком from (или конец сценария, если цикл не закрыт).
    private static func matchEnd(_ s: KScript, _ from: Int) -> Int {
        var d: Int = 0
        var i: Int = from + 1
        while i < s.blocks.count {
            if s.blocks[i].isLoop {
                d += 1
            } else if s.blocks[i].isEnd {
                if d == 0 { return i }
                d -= 1
            }
            i += 1
        }
        return s.blocks.count
    }

    /// send — отправить команду, mark — подсветить блок, stopped — нажата «Стоп».
    static func run(_ s: KScript, send: @escaping (ScriptSend) throws -> Void, mark: @escaping (Int) -> Void,
                    stopped: @escaping () -> Bool) throws {
        var device: Int = -1
        func exec(_ from: Int, _ to: Int) throws {
            var i: Int = from
            while i < to && !stopped() {
                mark(i)
                var sent: Bool = false
                switch s.blocks[i] {
                case .dev(let d):
                    device = d
                case .cmd(let label, let code):
                    try send(.nec(code, label))
                    sent = true
                case .ac(let power, let mode, let temp, let fan):
                    var model: Int = 0
                    if device >= 0 && device < ScriptStore.devices.count && ScriptStore.devices[device].acModel >= 0 {
                        model = ScriptStore.devices[device].acModel
                    }
                    var st = AcState()
                    st.model = model
                    st.power = power
                    st.mode = mode
                    st.temp = temp
                    st.fan = fan
                    try send(.haier(Haier.bytes(st, .power), model))
                    sent = true
                case .delay(let sec):
                    var left: Int = Int(sec * 1000)
                    while left > 0 && !stopped() {
                        let step: Int = min(left, 100)
                        Thread.sleep(forTimeInterval: Double(step) / 1000)
                        left -= step
                    }
                case .loop(let n):
                    let end: Int = matchEnd(s, i)
                    let times: Int = min(max(n, 1), 999)
                    for _ in 0..<times {
                        if stopped() { break }
                        try exec(i + 1, end)
                    }
                    i = end
                case .end:
                    break
                }
                if sent { Thread.sleep(forTimeInterval: 0.15) }   // пауза между командами
                i += 1
            }
        }
        try exec(0, s.blocks.count)
    }
}

/// Куда поставить блок из диалога: заменить блок i или вставить перед позицией i.
enum ScriptTarget {
    case replace(Int)
    case insert(Int)

    var key: String {
        switch self {
        case .replace(let i): return "r" + String(i)
        case .insert(let i): return "i" + String(i)
        }
    }
}

/// Какой диалог открыт во вкладке «Сценарии».
enum ScriptDialog: Identifiable {
    case pickScript
    case pickDevice(ScriptTarget)
    case pickCommand(Int, ScriptTarget)
    case editAc(ScriptTarget)
    case newName
    case rename
    case delay(Int)
    case loop(Int)

    var id: String {
        switch self {
        case .pickScript: return "script"
        case .pickDevice(let t): return "dev" + t.key
        case .pickCommand(let d, let t): return "cmd" + String(d) + t.key
        case .editAc(let t): return "ac" + t.key
        case .newName: return "new"
        case .rename: return "rename"
        case .delay(let i): return "delay" + String(i)
        case .loop(let i): return "loop" + String(i)
        }
    }
}

/// Образец блока в палитре.
enum PaletteItem {
    case dev(Int)
    case cmd
    case ac
    case delay
    case loop

    var block: SBlock {
        switch self {
        case .dev(let d): return .dev(d)
        case .cmd: return .cmd("кнопка", 0)
        case .ac: return .ac(power: true, mode: .cool, temp: 24, fan: .auto)
        case .delay: return .delay(1)
        case .loop: return .loop(3)
        }
    }
}

/// Поднятый (удержанием) блок: из сценария или образец из палитры.
enum HeldBlock {
    case block(Int)
    case palette(PaletteItem)
}

/// Вкладка «Сценарии»: редактор как в Scratch — палитра, стопка блоков, корзина и «▶ Отправить».
/// Перетаскивание сделано как «взять/положить»: удержание поднимает блок, нажатие на место кладёт его.
struct ScriptPanel: View {
    @ObservedObject var model: RemoteModel
    @AppStorage("scripts") private var json = ""
    @AppStorage("scriptCur") private var cur = 0
    @State private var scripts: [KScript]
    @State private var dialog: ScriptDialog?
    @State private var askDelete = false
    @State private var paletteCat = 0
    @State private var held: HeldBlock?

    init(model: RemoteModel) {
        _model = ObservedObject(wrappedValue: model)
        let saved: String = UserDefaults.standard.string(forKey: "scripts") ?? ""
        _scripts = State(initialValue: ScriptStore.load(saved))
    }

    private var idx: Int { min(max(cur, 0), scripts.count - 1) }
    private var script: KScript { scripts[idx] }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Как в Scratch: блок из палитры нажмите — он добавится в конец, или удерживайте — блок поднимется, и нажмите место в сценарии. Нажатие на блок — изменить, удержание — поднять, чтобы переставить или выбросить в корзину. Команда идёт устройству из блока «устройство» выше неё.")
                    .font(Term.ru(13)).foregroundColor(Term.dim)
                    .fixedSize(horizontal: false, vertical: true)
                Button { dialog = .pickScript } label: {
                    TabLabel(title: label("[ " + script.name + " ▾ ]"), on: false, height: 50, ruSize: 15, forceRu: true)
                }
                manageRow
                palette.padding(.top, 4)
                if held != nil { heldBanner }
                stackView.padding(.top, 6)
                trash.padding(.top, 8)
                playButton.padding(.top, 6)
            }
            .padding(.bottom, 16)
        }
        .sheet(item: $dialog) { d in dialogView(d) }
        .alert("Удалить «" + script.name + "»?", isPresented: $askDelete) {
            Button("Нет", role: .cancel) {}
            Button("Удалить", role: .destructive) { deleteScript() }
        }
        .onAppear { if json.isEmpty { save() } }
    }

    /// В «Призме» и «Чертеже» подписи кнопок без квадратных скобок.
    private func label(_ s: String) -> String {
        if !(Term.prism || Term.blueprint) { return s }
        var t: String = s
        if t.hasPrefix("[") { t.removeFirst() }
        if t.hasSuffix("]") { t.removeLast() }
        return t.trimmingCharacters(in: .whitespaces)
    }

    private func small(_ title: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TabLabel(title: label(title), on: false, height: 44, ruSize: 13)
        }
    }

    private var manageRow: some View {
        HStack(spacing: 6) {
            small("[ новый ]") { dialog = .newName }
            small("[ имя ]") { dialog = .rename }
            small("[ удалить ]") { askDelete = true }
        }
    }

    private var playButton: some View {
        let running: Bool = model.scriptRunning
        let title: String = running ? "[ ■ Стоп ]" : "[ ▶ Отправить ]"
        return Button { play() } label: {
            TabLabel(title: label(title), on: running, height: 58, ruSize: 17)
        }
    }

    // MARK: палитра

    private static let paletteCats: [String] = ["Устройства", "Команды", "Управление"]

    private var palette: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { i in paletteChip(i) }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(0..<paletteItems.count, id: \.self) { i in paletteBlock(paletteItems[i]) }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func paletteChip(_ i: Int) -> some View {
        Button { paletteCat = i } label: {
            TabLabel(title: ScriptPanel.paletteCats[i], on: paletteCat == i, height: 36, ruSize: 13)
        }
    }

    private var paletteItems: [PaletteItem] {
        if paletteCat == 0 { return (0..<ScriptStore.devices.count).map { d in PaletteItem.dev(d) } }
        if paletteCat == 1 { return [.cmd, .ac] }
        return [.delay, .loop]
    }

    private func paletteBlock(_ item: PaletteItem) -> some View {
        let b: SBlock = item.block
        return blockFace(b, lit: false)
            .onTapGesture { place(item, at: script.blocks.count) }
            .onLongPressGesture(minimumDuration: 0.4) { pickUp(.palette(item)) }
    }

    // MARK: сценарий

    private var heldBanner: some View {
        HStack(spacing: 8) {
            Text("Блок поднят — нажмите место: блок (встанет после него), цикл (внутрь), шапку (в начало) или корзину.")
                .font(Term.ru(12)).foregroundColor(Term.fg)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button { held = nil } label: {
                TabLabel(title: "отмена", on: true, height: 36, ruSize: 13).frame(width: 84)
            }
        }
    }

    private var stackView: some View {
        VStack(alignment: .leading, spacing: -Scratch.bump) {
            hat
            stack(from: 0, to: script.blocks.count)
            if script.blocks.isEmpty {
                Text("нажмите или поднимите блок в палитре выше").font(Term.ru(13)).foregroundColor(Term.dim)
                    .padding(.top, 12)
            }
        }
    }

    /// Шапка «когда нажата ▶ Отправить» — всегда первая; положить на неё — в начало.
    private var hat: some View {
        Text("когда нажата  ▶ Отправить").font(Scratch.font).foregroundColor(Scratch.event.text)
            .padding(.leading, 12).padding(.trailing, 10).padding(.top, 18).padding(.bottom, 4 + Scratch.bump)
            .frame(height: 60)
            .background(ScratchBack(shape: ScratchShape(kind: 1), cat: Scratch.event, lit: false))
            .contentShape(Rectangle())
            .onTapGesture { drop(at: 0) }
    }

    /// Блоки с from по to; цикл — C-блок с содержимым внутри. AnyView — из-за рекурсии.
    private func stack(from: Int, to: Int) -> AnyView {
        let s: KScript = script
        var items: [Int] = []
        var i: Int = from
        while i < min(to, s.blocks.count) {
            if s.blocks[i].isEnd { i += 1; continue }
            items.append(i)
            i = s.blocks[i].isLoop ? ScriptStore.rangeEnd(s, i) + 1 : i + 1
        }
        return AnyView(
            VStack(alignment: .leading, spacing: -Scratch.bump) {
                ForEach(items, id: \.self) { k in blockView(k) }
            }
        )
    }

    @ViewBuilder private func blockView(_ i: Int) -> some View {
        if script.blocks[i].isLoop {
            loopView(i)
        } else {
            plainView(i)
        }
    }

    private func isHeld(_ i: Int) -> Bool {
        if case .block(let k) = held { return k == i }
        return false
    }

    private func isLit(_ i: Int) -> Bool { model.scriptRunning && model.scriptMark == i }

    /// Блок как в Scratch: подпись с полями на фоне формы категории.
    private func blockFace(_ b: SBlock, lit: Bool) -> some View {
        ScratchLabel(parts: Scratch.parts(b), cat: Scratch.cat(b))
            .padding(.leading, 12).padding(.trailing, 10).padding(.top, 4).padding(.bottom, 4 + Scratch.bump)
            .frame(minHeight: 44)
            .background(ScratchBack(shape: ScratchShape(), cat: Scratch.cat(b), lit: lit))
            .contentShape(Rectangle())
    }

    private func plainView(_ i: Int) -> some View {
        blockFace(script.blocks[i], lit: isLit(i))
            .opacity(isHeld(i) ? 0.55 : 1)
            .onTapGesture { tapBlock(i) }
            .onLongPressGesture(minimumDuration: 0.4) { pickUp(.block(i)) }
    }

    /// C-блок «повторить»: полка 44, рука 16, «рот» с вложенными блоками (минимум 26), нижняя полка 22.
    private func loopView(_ i: Int) -> some View {
        let b: SBlock = script.blocks[i]
        let cat: ScratchCat = Scratch.cat(b)
        let end: Int = ScriptStore.rangeEnd(script, i)
        let innerTo: Int = end < script.blocks.count && script.blocks[end].isEnd ? end : end + 1
        let shape = ScratchShape(kind: 2, top: 44, arm: 16, bottom: 22)
        return VStack(alignment: .leading, spacing: 0) {
            ScratchLabel(parts: Scratch.parts(b), cat: cat)
                .padding(.leading, 12).padding(.trailing, 10)
                .frame(height: 44)
                .contentShape(Rectangle())
                .onTapGesture { tapLoopHead(i) }
                .onLongPressGesture(minimumDuration: 0.4) { pickUp(.block(i)) }
            stack(from: i + 1, to: innerTo)
                .frame(minWidth: 60, minHeight: 26, alignment: .topLeading)
                .contentShape(Rectangle())
                .onTapGesture { drop(at: i + 1) }
                .padding(.leading, 16)
            Color.clear.frame(width: 1, height: 22 + Scratch.bump)
        }
        .frame(minWidth: 200, alignment: .leading)
        .background(ScratchBack(shape: shape, cat: cat, lit: isLit(i)))
        .opacity(isHeld(i) ? 0.55 : 1)
    }

    /// Корзина под сценарием.
    private var trash: some View {
        Text("✕ перетащите блок сюда, чтобы удалить (удерживайте блок, затем нажмите сюда)")
            .font(Term.ru(13)).foregroundColor(held == nil ? Term.dim : Term.fg)
            .multilineTextAlignment(.center)
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 48)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(held == nil ? Term.line : Term.fg,
                                                              style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])))
            .contentShape(Rectangle())
            .onTapGesture { dropInTrash() }
    }

    // MARK: действия

    private func pickUp(_ h: HeldBlock) {
        if model.scriptRunning { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        held = h
    }

    private func tapBlock(_ i: Int) {
        if held != nil {
            drop(at: ScriptStore.rangeEnd(script, i) + 1)
        } else {
            editBlock(i)
        }
    }

    /// Полка цикла: с поднятым блоком — первым внутрь цикла, иначе изменить число повторов.
    private func tapLoopHead(_ i: Int) {
        if held != nil {
            drop(at: i + 1)
        } else {
            editBlock(i)
        }
    }

    /// Положить поднятый блок перед позицией at.
    private func drop(at: Int) {
        guard let h = held else { return }
        held = nil
        switch h {
        case .block(let from):
            var s: KScript = script
            if ScriptStore.move(&s, from, at) { changed(s) }
        case .palette(let item):
            place(item, at: at)
        }
    }

    private func dropInTrash() {
        guard let h = held else { return }
        held = nil
        if case .block(let i) = h {
            var s: KScript = script
            ScriptStore.remove(&s, i)
            changed(s)
        }
    }

    /// Добавить образец из палитры перед позицией at.
    private func place(_ item: PaletteItem, at: Int) {
        let pos: Int = min(max(at, 0), script.blocks.count)
        switch item {
        case .dev(let d):
            insert([.dev(d)], at: pos)
        case .cmd:
            addCommand(.insert(pos))
        case .ac:
            dialog = .editAc(.insert(pos))
        case .delay:
            insert([.delay(1)], at: pos)
        case .loop:
            insert([.loop(3), .end], at: pos)
        }
    }

    private func save() {
        json = ScriptStore.encode(scripts)
        cur = idx
    }

    private func changed(_ s: KScript) {
        scripts[idx] = s
        save()
    }

    private func insert(_ blocks: [SBlock], at: Int) {
        var s: KScript = script
        let pos: Int = min(max(at, 0), s.blocks.count)
        s.blocks.insert(contentsOf: blocks, at: pos)
        changed(s)
    }

    private func deleteScript() {
        scripts.remove(at: idx)
        if scripts.isEmpty { scripts.append(KScript(name: "Сценарий 1")) }
        cur = min(idx, scripts.count - 1)
        save()
    }

    private func play() {
        if model.scriptRunning {
            model.stopScript()
        } else {
            held = nil
            model.runScript(script)
        }
    }

    /// Команда (новая перед позицией или замена): список кнопок устройства выше, для кондиционера — редактор.
    private func addCommand(_ target: ScriptTarget) {
        var from: Int = 0
        switch target {
        case .replace(let i): from = i
        case .insert(let i): from = i - 1
        }
        let dev: Int = ScriptStore.deviceAt(script, from)
        if dev < 0 {
            model.say("Сначала добавьте блок «устройство»", err: true)
            dialog = .pickDevice(target)
            return
        }
        if ScriptStore.devices[dev].acModel >= 0 {
            dialog = .editAc(target)
        } else {
            dialog = .pickCommand(dev, target)
        }
    }

    private func editBlock(_ i: Int) {
        switch script.blocks[i] {
        case .dev: dialog = .pickDevice(.replace(i))
        case .cmd: addCommand(.replace(i))
        case .ac: dialog = .editAc(.replace(i))
        case .delay: dialog = .delay(i)
        case .loop: dialog = .loop(i)
        case .end: break
        }
    }

    private func setBlock(_ target: ScriptTarget, _ b: SBlock) {
        switch target {
        case .replace(let i):
            if i < script.blocks.count {
                var s: KScript = script
                s.blocks[i] = b
                changed(s)
            }
        case .insert(let i):
            insert([b], at: i)
        }
    }

    // MARK: диалоги

    @ViewBuilder private func dialogView(_ d: ScriptDialog) -> some View {
        switch d {
        case .pickScript:
            ChoiceSheet(title: "Сценарии", items: scripts.map { s in s.name }, selected: idx) { w in
                cur = w
                dialog = nil
            } cancel: { dialog = nil }
        case .pickDevice(let target):
            ChoiceSheet(title: "Устройство", items: ScriptStore.devices.map { x in x.title }, selected: nil) { w in
                dialog = nil
                setBlock(target, .dev(w))
            } cancel: { dialog = nil }
        case .pickCommand(let dev, let target):
            commandSheet(dev, target)
        case .editAc(let target):
            acSheet(target)
        case .newName:
            AskSheet(title: "Новый сценарий", value: "Сценарий " + String(scripts.count + 1), numeric: false) { t in
                dialog = nil
                scripts.append(KScript(name: t))
                cur = scripts.count - 1
                save()
            } cancel: { dialog = nil }
        case .rename:
            AskSheet(title: "Имя сценария", value: script.name, numeric: false) { t in
                dialog = nil
                var s: KScript = script
                s.name = t
                changed(s)
            } cancel: { dialog = nil }
        case .delay(let at):
            delaySheet(at)
        case .loop(let at):
            loopSheet(at)
        }
    }

    private func commandSheet(_ dev: Int, _ target: ScriptTarget) -> some View {
        let keys: [(label: String, code: UInt32)] = ScriptStore.devices[dev].keys
        return ChoiceSheet(title: ScriptStore.devices[dev].title, items: keys.map { k in k.label }, selected: nil) { w in
            dialog = nil
            setBlock(target, .cmd(keys[w].label, keys[w].code))
        } cancel: { dialog = nil }
    }

    private func acSheet(_ target: ScriptTarget) -> some View {
        var start: AcState = AcState.decode(UserDefaults.standard.string(forKey: "acState") ?? "")
        if case .replace(let i) = target, i < script.blocks.count, case .ac(let p, let m, let t, let f) = script.blocks[i] {
            start.power = p
            start.mode = m
            start.temp = t
            start.fan = f
        }
        return AcBlockSheet(state: start) { st in
            dialog = nil
            setBlock(target, .ac(power: st.power, mode: st.mode, temp: st.temp, fan: st.fan))
        } cancel: { dialog = nil }
    }

    private func delaySheet(_ at: Int) -> some View {
        var value: String = "1"
        if at < script.blocks.count, case .delay(let sec) = script.blocks[at] { value = ScriptStore.fmt(sec) }
        return AskSheet(title: "Задержка, секунд", value: value, numeric: true) { t in
            dialog = nil
            if let v = Double(t.replacingOccurrences(of: ",", with: ".")) {
                setBlock(.replace(at), .delay(min(max(v, 0.1), 600)))
            }
        } cancel: { dialog = nil }
    }

    private func loopSheet(_ at: Int) -> some View {
        var value: String = "3"
        if at < script.blocks.count, case .loop(let n) = script.blocks[at] { value = String(n) }
        return AskSheet(title: "Сколько раз повторить", value: value, numeric: true) { t in
            dialog = nil
            guard let v = Double(t.replacingOccurrences(of: ",", with: ".")) else { return }
            let n: Int = min(max(Int(v), 1), 999)
            setBlock(.replace(at), .loop(n))
        } cancel: { dialog = nil }
    }
}

/// Окно выбора из списка.
struct ChoiceSheet: View {
    let title: String
    let items: [String]
    let selected: Int?
    let pick: (Int) -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(Term.ru(18)).foregroundColor(Term.fg)
                Spacer()
                Button("Отмена") { cancel() }.font(Term.ru(15)).foregroundColor(Term.fg)
            }
            ScrollView {
                VStack(spacing: 6) {
                    ForEach(0..<items.count, id: \.self) { i in row(i) }
                }
            }
        }
        .padding(20)
        .modifier(ThemedSheet())
    }

    private func row(_ i: Int) -> some View {
        let on: Bool = selected == i
        return Button { pick(i) } label: {
            TabLabel(title: items[i], on: on, height: 44, ruSize: 15, leading: true, forceRu: true)
        }
    }
}

/// Окно ввода текста или числа (на iOS 15 у alert нет поля ввода).
struct AskSheet: View {
    let title: String
    let numeric: Bool
    let ok: (String) -> Void
    let cancel: () -> Void
    @State private var text: String

    init(title: String, value: String, numeric: Bool, ok: @escaping (String) -> Void, cancel: @escaping () -> Void) {
        self.title = title
        self.numeric = numeric
        self.ok = ok
        self.cancel = cancel
        _text = State(initialValue: value)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(Term.ru(18)).foregroundColor(Term.fg)
            TextField("", text: $text)
                .font(Term.ru(18)).foregroundColor(Term.fg)
                .keyboardType(numeric ? .decimalPad : .default)
                .disableAutocorrection(true)
                .padding(10)
                .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
            HStack(spacing: 8) {
                Button { cancel() } label: { TabLabel(title: "Отмена", on: false, height: 44, ruSize: 15) }
                Button { submit() } label: { TabLabel(title: "OK", on: true, height: 44, ruSize: 15, forceRu: true) }
            }
            Spacer()
        }
        .padding(20)
        .modifier(ThemedSheet())
    }

    private func submit() {
        let t: String = text.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { cancel() } else { ok(t) }
    }
}

/// Команда кондиционеру: питание, режим, температура, скорость — кнопками, которые перебирают значения.
struct AcBlockSheet: View {
    let ok: (AcState) -> Void
    let cancel: () -> Void
    @State private var st: AcState

    init(state: AcState, ok: @escaping (AcState) -> Void, cancel: @escaping () -> Void) {
        self.ok = ok
        self.cancel = cancel
        _st = State(initialValue: state)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Кондиционер").font(Term.ru(18)).foregroundColor(Term.fg)
            cycle(st.power ? "питание: вкл" : "питание: выкл") { st.power.toggle() }
            cycle("режим: " + st.mode.title) { st.mode = acNext(st.mode) }
            cycle("температура: " + String(st.temp) + "° (нажмите: +1)") { st.temp = st.temp >= 30 ? 16 : st.temp + 1 }
            cycle("скорость: " + st.fan.title) { st.fan = acNext(st.fan) }
            HStack(spacing: 8) {
                Button { cancel() } label: { TabLabel(title: "Отмена", on: false, height: 44, ruSize: 15) }
                Button { ok(st) } label: { TabLabel(title: "OK", on: true, height: 44, ruSize: 15, forceRu: true) }
            }
            .padding(.top, 6)
            Spacer()
        }
        .padding(20)
        .modifier(ThemedSheet())
    }

    private func cycle(_ title: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TabLabel(title: title, on: false, height: 46, ruSize: 15)
        }
    }
}
