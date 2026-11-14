import CoreBluetooth
import SwiftUI
import UIKit

/**
 Донгл krisa37 HID (ESP32-S3 в USB доски — USB-клавиатура и мышь). Телефон говорит с ним по Bluetooth LE:
 сервис 6b7e0001…, RX (запись) 6b7e0002…, INFO (чтение + уведомления) 6b7e0003…
 Пакеты: 0x10 AUTH, 0x01 MOVE, 0x02 BUTTONS, 0x03 CLICK, 0x04 KEY, 0x07 TEXT.
 */
final class HidLink: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = HidLink()

    static let service = CBUUID(string: "6b7e0001-3a1f-4c7e-9d2a-6b72697361a0")
    static let rxUUID = CBUUID(string: "6b7e0002-3a1f-4c7e-9d2a-6b72697361a0")
    static let infoUUID = CBUUID(string: "6b7e0003-3a1f-4c7e-9d2a-6b72697361a0")

    /// Статус словами: «не подключён», «поиск…», «подключён», …
    @Published var status: String = "не подключён"
    /// Есть соединение с донглом (может быть ещё не готов к командам).
    @Published var connected = false
    /// Можно слать команды: соединение есть, RX найдена, привязка не отклонена.
    @Published var ready = false
    /// Залипшие модификаторы (1 Ctrl, 2 Shift, 4 Alt, 8 Win), зажатые кнопками над быстрыми клавишами.
    @Published var stickyMods: UInt8 = 0
    /// Светодиод донгла по INFO: "rgb" (S3, цветной), "mono" (C3, синий) или "" — пока неизвестно.
    @Published var ledKind: String = ""
    /// Найдено несколько донглов — выбор (по уровню сигнала).
    @Published var choices: [HidChoice] = []
    /// На плате сохранён скрипт (scr=1 в INFO).
    @Published var scrSaved = false

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var rx: CBCharacteristic?
    private var info: CBCharacteristic?
    private var wantConnect = false
    /// Номер попытки подключения — для таймаута прежнего донгла.
    private var attempt = 0
    /// Найденные при поиске донглы и их сигнал.
    private var scanned: [UUID: CBPeripheral] = [:]
    private var signal: [UUID: Int] = [:]
    private var collecting = false
    private var denied = false

    /// Токен привязки: 8 случайных байт, создаётся один раз (ключ "hid_token").
    private var token: [UInt8] {
        if let d = UserDefaults.standard.data(forKey: "hid_token"), d.count == 8 { return [UInt8](d) }
        var t: [UInt8] = []
        for _ in 0..<8 { t.append(UInt8.random(in: 0...255)) }
        UserDefaults.standard.set(Data(t), forKey: "hid_token")
        return t
    }

    // MARK: подключение

    /// Подключиться (по кнопке): при первом разе iOS спросит разрешение на Bluetooth.
    func connect() {
        wantConnect = true
        if central == nil {
            central = CBCentralManager(delegate: self, queue: nil)
            return                                  // продолжим в centralManagerDidUpdateState
        }
        start()
    }

    /// При открытии вкладки: переподключиться, если разрешение уже дано и донгл был подключён раньше.
    func autoConnect() {
        if connected || wantConnect { return }
        if CBCentralManager.authorization != .allowedAlways { return }
        if UserDefaults.standard.string(forKey: "hid_last") == nil { return }
        connect()
    }

    func disconnect() {
        releaseAll()                    // всё зажатое — отпустить, пока связь ещё есть
        wantConnect = false
        central?.stopScan()
        if let p = peripheral { central?.cancelPeripheralConnection(p) }
        reset("не подключён")
    }

    private func reset(_ s: String) {
        stickyMods = 0
        ledKind = ""
        scrSaved = false
        rx = nil
        info = nil
        connected = false
        ready = false
        status = s
    }

    private func start() {
        guard let c = central, c.state == .poweredOn, wantConnect else { return }
        if let idText = UserDefaults.standard.string(forKey: "hid_last"), let id = UUID(uuidString: idText),
           let p = c.retrievePeripherals(withIdentifiers: [id]).first {
            attach(p, remembered: true)
            return
        }
        scan()
    }

    /// Обычный поиск: после первой находки ещё 2.5 с собираем остальные донглы.
    private func scan() {
        guard let c = central, c.state == .poweredOn else { return }
        scanned = [:]
        signal = [:]
        choices = []
        collecting = false
        status = "поиск…"
        c.scanForPeripherals(withServices: [HidLink.service], options: nil)
        attempt += 1
        let token: Int = attempt
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self, let c = self.central, token == self.attempt else { return }
            if c.isScanning && self.scanned.isEmpty {
                c.stopScan()
                self.wantConnect = false
                self.status = "донгл не найден — он вставлен и светится синим?"
            }
        }
    }

    /// Поиск закончен: один донгл — подключиться, несколько — спросить, какой.
    private func finishScan() {
        central?.stopScan()
        collecting = false
        let ids: [UUID] = Array(scanned.keys)
        if ids.count == 1, let p = scanned[ids[0]] {
            attach(p, remembered: false)
            return
        }
        var list: [HidChoice] = []
        for id in ids {
            let rssi: Int = signal[id] ?? -127
            let tail: String = String(id.uuidString.suffix(5))
            list.append(HidChoice(id: id, label: "krisa37 HID · " + tail + " · сигнал " + String(rssi) + " dBm", rssi: rssi))
        }
        list.sort { a, b in a.rssi > b.rssi }
        status = "найдено донглов: " + String(list.count) + " — выберите"
        choices = list
    }

    /// Выбран донгл из списка.
    func pick(_ id: UUID) {
        guard let p = scanned[id] else { return }
        choices = []
        wantConnect = true
        attach(p, remembered: false)
    }

    /// Выбор отменён.
    func cancelPick() {
        choices = []
        if peripheral == nil {
            wantConnect = false
            status = "не подключён"
        }
    }

    /// Забыть донгл: при следующем подключении — обычный поиск.
    func forget() {
        UserDefaults.standard.removeObject(forKey: "hid_last")
        if !connected { status = "донгл забыт — при подключении найду заново" }
    }

    private func attach(_ p: CBPeripheral, remembered: Bool) {
        peripheral = p
        p.delegate = self
        status = "поиск…"
        attempt += 1
        let token: Int = attempt
        central?.connect(p, options: nil)
        if !remembered { return }
        // прежний донгл мог исчезнуть (поменяли плату) — не ждать вечно
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self = self, token == self.attempt, !self.ready, let old = self.peripheral else { return }
            self.peripheral = nil
            self.central?.cancelPeripheralConnection(old)
            UserDefaults.standard.removeObject(forKey: "hid_last")
            self.reset("прежний донгл не отвечает — ищу заново")
            self.scan()
            self.status = "прежний донгл не отвечает — ищу заново"
        }
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        switch c.state {
        case .poweredOn:
            start()
        case .poweredOff:
            reset("Bluetooth выключен")
        case .unauthorized:
            reset("нет доступа к Bluetooth — разрешите в Настройках")
        case .unsupported:
            reset("Bluetooth LE недоступен")
        default:
            break
        }
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        scanned[p.identifier] = p
        signal[p.identifier] = RSSI.intValue
        if collecting { return }
        collecting = true
        let token: Int = attempt
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self = self, token == self.attempt, self.collecting else { return }
            self.finishScan()
        }
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        UserDefaults.standard.set(p.identifier.uuidString, forKey: "hid_last")
        connected = true
        denied = false
        status = "подключён"
        p.discoverServices([HidLink.service])
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        if p.identifier != peripheral?.identifier { return }   // старая попытка (прежний донгл)
        peripheral = nil
        reset("не подключён")
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        if p.identifier != peripheral?.identifier { return }   // отменённое подключение к прежнему донглу
        peripheral = nil
        reset(denied ? "донгл привязан к другому телефону — удерживайте BOOT 3 с" : "не подключён")
        wantConnect = false
    }

    // MARK: GATT

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard let s = p.services?.first(where: { s in s.uuid == HidLink.service }) else { return }
        p.discoverCharacteristics([HidLink.rxUUID, HidLink.infoUUID], for: s)
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for ch in s.characteristics ?? [] {
            if ch.uuid == HidLink.rxUUID { rx = ch }
            if ch.uuid == HidLink.infoUUID { info = ch }
        }
        if let i = info { p.setNotifyValue(true, for: i) }
        if let r = rx {
            let auth: [UInt8] = [0x10] + token
            p.writeValue(Data(auth), for: r, type: .withResponse)
            ready = true
            // сохранённый цвет светодиода — сразу после привязки, если не «авто»
            let led: LedState = LedState.load(UserDefaults.standard.string(forKey: "hid_led") ?? "")
            if led.mode != 0 { send(led.packet) }
        }
        if let i = info { p.readValue(for: i) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard ch.uuid == HidLink.infoUUID, let d = ch.value, let text = String(data: d, encoding: .utf8) else { return }
        if text.contains("led=rgb") {
            ledKind = "rgb"
        } else if text.contains("led=mono") {
            ledKind = "mono"
        }
        if text.contains("scr=1") {
            scrSaved = true
        } else if text.contains("scr=0") {
            scrSaved = false
        }
        if text.contains("auth=denied") {
            denied = true
            ready = false
            status = "донгл привязан к другому телефону — удерживайте BOOT 3 с"
        } else if text.contains("usb=0") {
            denied = false
            ready = rx != nil
            status = text.contains("hid-c3") ? "подключён · подключите «krisa37 HID» в Bluetooth доски" : "подключён · доска не видит USB"
        } else {
            denied = false
            ready = rx != nil
            status = "подключён"
        }
    }

    // MARK: команды

    /// Отправить пакет в RX; false — донгл не подключён.
    @discardableResult func send(_ bytes: [UInt8]) -> Bool {
        guard ready, let p = peripheral, let r = rx else { return false }
        let noReply: Bool = r.properties.contains(.writeWithoutResponse) && p.canSendWriteWithoutResponse
        p.writeValue(Data(bytes), for: r, type: noReply ? .withoutResponse : .withResponse)
        return true
    }

    private static func i8(_ v: Int) -> UInt8 {
        let c: Int = min(127, max(-127, v))
        return UInt8(bitPattern: Int8(c))
    }

    /// Сдвиг курсора и прокрутка; большие сдвиги дробятся по ±127.
    @discardableResult func move(_ dx: Int, _ dy: Int, wheel: Int = 0, pan: Int = 0) -> Bool {
        var x: Int = dx
        var y: Int = dy
        var w: Int = wheel
        var h: Int = pan
        var ok: Bool = true
        repeat {
            let sx: Int = min(127, max(-127, x))
            let sy: Int = min(127, max(-127, y))
            let sw: Int = min(127, max(-127, w))
            let sh: Int = min(127, max(-127, h))
            ok = send([0x01, HidLink.i8(sx), HidLink.i8(sy), HidLink.i8(sw), HidLink.i8(sh)])
            x -= sx
            y -= sy
            w -= sw
            h -= sh
        } while ok && (x != 0 || y != 0 || w != 0 || h != 0)
        return ok
    }

    @discardableResult func buttons(_ mask: UInt8) -> Bool { send([0x02, mask]) }
    @discardableResult func click(_ mask: UInt8, count: UInt8 = 1) -> Bool { send([0x03, mask, count]) }
    @discardableResult func key(_ mods: UInt8, _ code: UInt8) -> Bool { send([0x04, mods, code]) }
    /// Зажать (держится до KEYUP; keycode 0 — только модификаторы).
    @discardableResult func keyDown(_ mods: UInt8, _ code: UInt8) -> Bool { send([0x05, mods, code]) }
    /// Отпустить то же сочетание.
    @discardableResult func keyUp(_ mods: UInt8, _ code: UInt8) -> Bool { send([0x06, mods, code]) }

    /// Отпустить всё ([0x06]: клавиши и кнопки мыши) и снять залипшие модификаторы.
    func releaseAll() {
        if ready { send([0x06]) }
        stickyMods = 0
    }

    /// Залипающий модификатор: касание — зажать, ещё касание — отпустить.
    @discardableResult func toggleSticky(_ mod: UInt8) -> Bool {
        if stickyMods & mod != 0 {
            let ok: Bool = keyUp(mod, 0)
            stickyMods &= ~mod
            return ok
        }
        if !keyDown(mod, 0) { return false }
        stickyMods |= mod
        return true
    }

    // MARK: скрипт на плате (0x20 начать, 0x21 кусок, 0x22 сохранить+auto, 0x23 выполнить, 0x24 стереть)

    @discardableResult func scriptBegin() -> Bool { send([0x20]) }
    @discardableResult func scriptChunk(_ bytes: [UInt8]) -> Bool { send([0x21] + bytes) }
    @discardableResult func scriptSave(_ auto: Bool) -> Bool { send([0x22, auto ? 1 : 0]) }
    @discardableResult func scriptRunSaved() -> Bool { send([0x23]) }
    @discardableResult func scriptErase() -> Bool { send([0x24]) }

    /// Записать байткод на плату кусками ≤18 байт и сохранить (auto — автозапуск).
    @discardableResult func uploadScript(_ code: [UInt8], auto: Bool) -> Bool {
        if !scriptBegin() { return false }
        var i: Int = 0
        while i < code.count {
            let end: Int = min(i + 18, code.count)
            if !scriptChunk(Array(code[i..<end])) { return false }
            i = end
        }
        return scriptSave(auto)
    }

    /// Напечатать текст: куски ≤ 18 байт по границам символов.
    @discardableResult func text(_ s: String) -> Bool {
        var chunk: [UInt8] = []
        for ch in s {
            let b: [UInt8] = Array(String(ch).utf8)
            if chunk.count + b.count > 18 {
                if !send([0x07] + chunk) { return false }
                chunk = []
            }
            chunk += b
        }
        if !chunk.isEmpty { return send([0x07] + chunk) }
        return true
    }
}

/// UIView для тачпада: настоящие касания (один и два пальца), курсор, клики, прокрутка, перетаскивание.
final class TouchPadView: UIView {
    var sens: CGFloat = 1
    var onMove: ((Int, Int) -> Void)?
    var onWheel: ((Int) -> Void)?
    var onClick: ((UInt8) -> Void)?
    var onButtons: ((UInt8) -> Void)?

    private var maxFingers = 0
    private var startTime = Date()
    private var moved = false
    private var dragging = false
    private var travel: CGFloat = 0
    private var lastPoint: CGPoint = .zero
    private var lastTime: TimeInterval = 0
    private var lastMid: CGPoint = .zero
    private var accX: CGFloat = 0
    private var accY: CGFloat = 0
    private var accW: CGFloat = 0
    private var lastSent: TimeInterval = 0
    private var hold: DispatchWorkItem?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        isMultipleTouchEnabled = true
    }

    /// Касания на этом поле, которые ещё на экране.
    private func live(_ event: UIEvent?) -> [UITouch] {
        let all: Set<UITouch> = event?.allTouches ?? []
        return Array(all).filter { t in t.view === self && t.phase != .ended && t.phase != .cancelled }
    }

    private func mid(_ ts: [UITouch]) -> CGPoint {
        var x: CGFloat = 0
        var y: CGFloat = 0
        for t in ts {
            let p: CGPoint = t.location(in: self)
            x += p.x
            y += p.y
        }
        let n: CGFloat = CGFloat(max(1, ts.count))
        return CGPoint(x: x / n, y: y / n)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        let all: [UITouch] = live(event)
        if maxFingers == 0 {
            startTime = Date()
            moved = false
            travel = 0
        }
        maxFingers = max(maxFingers, all.count)
        if all.count == 1, let t = all.first {
            lastPoint = t.location(in: self)
            lastTime = t.timestamp
            scheduleHold()
        } else {
            hold?.cancel()
            lastMid = mid(all)
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        let all: [UITouch] = live(event)
        if all.count >= 2 {
            let m: CGPoint = mid(all)
            let dy: CGFloat = m.y - lastMid.y
            lastMid = m
            travel += abs(dy)
            if travel > 8 {
                moved = true
                hold?.cancel()
            }
            accW += dy / 12                            // прокрутка двумя пальцами, как на ноутбуке
            flush(event?.timestamp ?? 0, force: false)
        } else if let t = all.first {
            let p: CGPoint = t.location(in: self)
            let dx: CGFloat = p.x - lastPoint.x
            let dy: CGFloat = p.y - lastPoint.y
            let dt: CGFloat = CGFloat(max(0.001, t.timestamp - lastTime))
            lastPoint = p
            lastTime = t.timestamp
            let dist: CGFloat = sqrt(dx * dx + dy * dy)
            travel += dist
            if travel > 8 && !dragging {
                moved = true
                hold?.cancel()
            }
            let speed: CGFloat = dist / dt
            let accel: CGFloat = 1 + min(2, speed / 900)   // ускорение по скорости
            accX += dx * sens * accel
            accY += dy * sens * accel
            flush(t.timestamp, force: false)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { finish(event) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { finish(event) }

    private func finish(_ event: UIEvent?) {
        let left: [UITouch] = live(event)
        if left.count == 1, let t = left.first {
            lastPoint = t.location(in: self)
            lastTime = t.timestamp
        }
        if left.count >= 2 { lastMid = mid(left) }
        if !left.isEmpty { return }
        hold?.cancel()
        flush(0, force: true)
        if dragging {
            dragging = false
            onButtons?(0)
        } else if !moved && Date().timeIntervalSince(startTime) < 0.35 {
            onClick?(maxFingers >= 2 ? 2 : 1)          // касание — левый клик, двумя пальцами — правый
        }
        maxFingers = 0
    }

    /// Отправка не чаще раза в 15 мс; дробные остатки копятся.
    private func flush(_ ts: TimeInterval, force: Bool) {
        if !force && ts - lastSent < 0.015 { return }
        lastSent = ts
        let ix: Int = Int(accX.rounded(.towardZero))
        let iy: Int = Int(accY.rounded(.towardZero))
        let iw: Int = Int(accW.rounded(.towardZero))
        accX -= CGFloat(ix)
        accY -= CGFloat(iy)
        accW -= CGFloat(iw)
        if ix != 0 || iy != 0 { onMove?(ix, iy) }
        if iw != 0 { onWheel?(iw) }
    }

    /// Долгое нажатие 500 мс — перетаскивание (левая кнопка зажата до отпускания).
    private func scheduleHold() {
        hold?.cancel()
        let w = DispatchWorkItem { [weak self] in
            guard let self = self, !self.moved, self.maxFingers == 1 else { return }
            self.dragging = true
            self.moved = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            self.onButtons?(1)
        }
        hold = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: w)
    }
}

struct TouchSurface: UIViewRepresentable {
    let sens: CGFloat
    let onMove: (Int, Int) -> Void
    let onWheel: (Int) -> Void
    let onClick: (UInt8) -> Void
    let onButtons: (UInt8) -> Void

    func makeUIView(context: Context) -> TouchPadView {
        let v = TouchPadView(frame: .zero)
        apply(v)
        return v
    }

    func updateUIView(_ v: TouchPadView, context: Context) { apply(v) }

    private func apply(_ v: TouchPadView) {
        v.sens = sens
        v.onMove = onMove
        v.onWheel = onWheel
        v.onClick = onClick
        v.onButtons = onButtons
    }
}

/// Быстрая клавиша: подпись, модификаторы, HID-код.
struct HidKey {
    let title: String
    let mods: UInt8
    let code: UInt8
    init(_ title: String, _ mods: UInt8, _ code: UInt8) {
        self.title = title
        self.mods = mods
        self.code = code
    }
}

/// Вкладка «Тачпад»: мышь и клавиатура через донгл krisa37 HID.
struct TouchpadPanel: View {
    @ObservedObject var model: RemoteModel
    @ObservedObject private var link = HidLink.shared
    @AppStorage("hidSens") private var sens = 0.5
    @AppStorage("hidLayout") private var layout = 0
    @State private var typed = ""
    @State private var liveSens: Double?
    /// Подвкладка: 0 — тачпад, 1 — светодиод.
    @AppStorage("hidSub") private var sub = 0
    @Environment(\.scenePhase) private var scenePhase
    /// «Мои сочетания» (JSON [{"n":имя,"m":mods,"k":keycode}]).
    @AppStorage("hid_combos") private var combosJSON = ""
    @State private var editing = false
    @State private var building = false
    @State private var comboMenu: Int?
    @State private var renaming: ComboIndex?

    private static let keys: [HidKey] = [
        HidKey("Esc", 0, 0x29), HidKey("Tab", 0, 0x2B), HidKey("Enter", 0, 0x28), HidKey("⌫", 0, 0x2A),
        HidKey("Win", 0x08, 0), HidKey("Alt+Tab", 0x04, 0x2B), HidKey("Alt+F4", 0x04, 0x3D), HidKey("Del", 0, 0x4C),
        HidKey("Ctrl+C", 0x01, 0x06), HidKey("Ctrl+V", 0x01, 0x19), HidKey("Ctrl+Z", 0x01, 0x1D), HidKey("Ctrl+A", 0x01, 0x04),
        HidKey("←", 0, 0x50), HidKey("→", 0, 0x4F), HidKey("↑", 0, 0x52), HidKey("↓", 0, 0x51),
        HidKey("F5", 0, 0x3E), HidKey("Shift+F5", 0x02, 0x3E), HidKey("PgUp", 0, 0x4B), HidKey("PgDn", 0, 0x4E),
        HidKey("Home", 0, 0x4A), HidKey("End", 0, 0x4D), HidKey("Win+D", 0x08, 0x07), HidKey("Ctrl+S", 0x01, 0x16),
    ]

    /// Комбинации смены раскладки (по кругу): Alt+Shift → Win+Space → Ctrl+Shift → Ctrl+Space.
    private static let layouts: [HidKey] = [
        HidKey("Alt+Shift", 0x04 | 0x02, 0), HidKey("Win+Space", 0x08, 0x2C),
        HidKey("Ctrl+Shift", 0x01 | 0x02, 0), HidKey("Ctrl+Space", 0x01, 0x2C),
    ]

    private static let flashURL = URL(string: "https://mikhailkulinskii1910-jpg.github.io/vsluh/irbis/flash/")

    private var layoutKey: HidKey { TouchpadPanel.layouts[min(max(layout, 0), TouchpadPanel.layouts.count - 1)] }
    /// Множитель курсора по ползунку: 0.5 … 3.
    private var factor: CGFloat { CGFloat(0.5 + 2.5 * sens) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            statusRow
            subTabs
            if sub == 1 {
                LedPanel(model: model)
            } else if sub == 2 {
                HidScriptPanel(model: model)
            } else {
                touchArea
            }
        }
        .onAppear { link.autoConnect() }
        .onDisappear { link.releaseAll() }            // ушли с вкладки — всё отпустить
        .onChange(of: scenePhase) { p in
            if p == .background { link.releaseAll() }  // приложение свернули
        }
        .sheet(item: $renaming) { r in renameSheet(r.index) }
        .confirmationDialog(comboTitle, isPresented: comboMenuShown, titleVisibility: .visible) { comboActions }
    }

    /// Подвкладки «тачпад» | «светодиод» (выбор запоминается).
    private var subTabs: some View {
        HStack(spacing: 6) {
            subChip(0, "тачпад")
            subChip(1, "светодиод")
            subChip(2, "скрипт")
        }
    }

    private func subChip(_ i: Int, _ title: String) -> some View {
        Button {
            if sub == 0 && i != 0 { link.releaseAll() }
            sub = i
        } label: {
            TabLabel(title: title, on: sub == i, height: 36, ruSize: 13, forceRu: true)
        }
    }

    private var touchArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            pad
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 8) {
                    clickRow
                    sensSlider
                    typeRow
                    stickyRow
                    keyGrid
                    combosSection
                    flashLink
                }
                .padding(.bottom, 16)
            }
        }
    }

    /// В «Призме» и «Чертеже» подписи кнопок без квадратных скобок.
    private func label(_ s: String) -> String {
        if !(Term.prism || Term.blueprint) { return s }
        var t: String = s
        if t.hasPrefix("[") { t.removeFirst() }
        if t.hasSuffix("]") { t.removeLast() }
        return t.trimmingCharacters(in: .whitespaces)
    }

    private func button(_ title: String, on: Bool, height: CGFloat, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TabLabel(title: label(title), on: on, height: height, ruSize: 13, forceRu: true)
        }
    }

    /// Команда без подключения — подсказка в журнал (без повторов подряд).
    private func notConnected() {
        let msg: String = "> донгл не подключён — [ подключить ]"
        if model.status != msg { model.say(msg) }
    }

    private func run(_ ok: Bool) {
        if !ok { notConnected() }
    }

    // MARK: части

    private var statusRow: some View {
        HStack(spacing: 8) {
            Text(link.status).font(Term.ru(13)).foregroundColor(link.ready ? Term.fg : Term.dim)
                .lineLimit(2).minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)
            button(link.connected ? "[ отключить ]" : "[ подключить ]", on: link.connected, height: 40) {
                if link.connected { link.disconnect() } else { link.connect() }
            }
            .frame(width: 140)
            if !link.connected {
                button("[ забыть ]", on: false, height: 40) { link.forget() }
                    .frame(width: 84)
            }
        }
        .confirmationDialog("Найдено несколько донглов", isPresented: choicesShown, titleVisibility: .visible) {
            ForEach(link.choices) { c in
                Button(c.label) { link.pick(c.id) }
            }
            Button("Отмена", role: .cancel) { link.cancelPick() }
        }
    }

    private var choicesShown: Binding<Bool> {
        Binding(get: { !link.choices.isEmpty }, set: { v in if !v { link.cancelPick() } })
    }

    private var pad: some View {
        GeometryReader { g in
            ZStack {
                Canvas { ctx, size in TouchpadPanel.dots(ctx, size) }
                TouchSurface(sens: factor,
                             onMove: { dx, dy in run(link.move(dx, dy)) },
                             onWheel: { w in run(link.move(0, 0, wheel: w)) },
                             onClick: { m in run(link.click(m)) },
                             onButtons: { m in run(link.buttons(m)) })
            }
            .frame(width: g.size.width, height: g.size.width * 0.6)
            .background(Term.bg.opacity(0.6))
            .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
        }
        .aspectRatio(1 / 0.6, contentMode: .fit)
    }

    /// Сетка точек на поле.
    private static func dots(_ ctx: GraphicsContext, _ size: CGSize) {
        let step: CGFloat = 18
        var p = Path()
        var y: CGFloat = step / 2
        while y < size.height {
            var x: CGFloat = step / 2
            while x < size.width {
                p.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                x += step
            }
            y += step
        }
        ctx.fill(p, with: .color(Term.line.opacity(0.7)))
    }

    private var clickRow: some View {
        HStack(spacing: 6) {
            button("[ Л ]", on: false, height: 44) { run(link.click(1)) }
            button("[ С ]", on: false, height: 44) { run(link.click(4)) }
            button("[ П ]", on: false, height: 44) { run(link.click(2)) }
        }
    }

    private var sensSlider: some View {
        let track: [Color] = [Term.bg, Term.fg]
        return VStack(alignment: .leading, spacing: 0) {
            Text("чувствительность").font(Term.ru(13)).foregroundColor(Term.dim)
            TrackSlider(value: liveSens ?? sens, mark: 0.5, markColor: Term.fg, track: track,
                        leftText: "медленнее", rightText: "быстрее",
                        onDrag: { v in liveSens = v }, onDone: { v in liveSens = nil; sens = v })
        }
    }

    private var typeRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                TextField("⌨ печатать", text: $typed)
                    .font(Term.ru(16)).foregroundColor(Term.fg)
                    .disableAutocorrection(true)
                    .padding(10)
                    .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
                    .onSubmit { sendTyped(enter: true) }
                button("[ отправить ]", on: false, height: 42) { sendTyped(enter: false) }
                    .frame(width: 120)
            }
            HStack(spacing: 6) {
                button("[ РУС/ENG · " + layoutKey.title + " ]", on: false, height: 42) {
                    run(link.key(layoutKey.mods, layoutKey.code))
                }
                button("[ ⇄ ]", on: false, height: 42) { layout = (layout + 1) % TouchpadPanel.layouts.count }
                    .frame(width: 60)
            }
        }
    }

    private func sendTyped(enter: Bool) {
        let t: String = enter ? typed + "\n" : typed
        if t.isEmpty { return }
        if link.text(t) {
            typed = ""
        } else {
            notConnected()
        }
    }

    private var keyGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6),
                            GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
            ForEach(0..<TouchpadPanel.keys.count, id: \.self) { i in keyButton(TouchpadPanel.keys[i]) }
        }
    }

    /// Быстрая клавиша «как настоящая»: палец на кнопке — зажата, убран — отпущена.
    private func keyButton(_ k: HidKey) -> some View {
        HoldKeyButton(title: k.title, mods: k.mods, code: k.code, notConnected: { notConnected() })
    }

    // MARK: залипающие модификаторы

    private static let stickies: [HidKey] = [HidKey("Ctrl", 0x01, 0), HidKey("Shift", 0x02, 0), HidKey("Alt", 0x04, 0), HidKey("Win", 0x08, 0)]

    private var stickyRow: some View {
        HStack(spacing: 6) {
            ForEach(0..<TouchpadPanel.stickies.count, id: \.self) { i in stickyButton(TouchpadPanel.stickies[i]) }
            Button { link.releaseAll() } label: {
                TabLabel(title: "отпустить всё", on: false, height: 42, ruSize: 11, forceRu: true)
            }
            .frame(width: 92)
        }
    }

    private func stickyButton(_ k: HidKey) -> some View {
        let on: Bool = link.stickyMods & k.mods != 0
        return Button { run(link.toggleSticky(k.mods)) } label: {
            TabLabel(title: k.title, on: on, height: 42, ruSize: 13, forceRu: true)
        }
    }

    // MARK: мои сочетания

    private var combos: [HidCombo] { HidCombo.decode(combosJSON) }

    private func saveCombos(_ list: [HidCombo]) { combosJSON = HidCombo.encode(list) }

    private var combosSection: some View {
        let list: [HidCombo] = combos
        return VStack(alignment: .leading, spacing: 6) {
            Text("мои сочетания").font(Term.ru(14)).foregroundColor(Term.dim).padding(.top, 6)
            if !list.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6),
                                    GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                    ForEach(0..<list.count, id: \.self) { i in comboButton(i, list[i]) }
                }
            }
            HStack(spacing: 6) {
                button("[ + сочетание ]", on: false, height: 42) { building = true }
                if !list.isEmpty {
                    button(editing ? "[ готово ]" : "[ изменить ]", on: editing, height: 42) { editing.toggle() }
                }
            }
        }
        .sheet(isPresented: $building) {
            ComboSheet { c in addCombo(c) } cancel: { building = false }
        }
    }

    private func comboButton(_ i: Int, _ c: HidCombo) -> some View {
        var edit: (() -> Void)? = nil
        if editing { edit = { comboMenu = i } }
        return HoldKeyButton(title: c.n, mods: UInt8(c.m & 0xFF), code: UInt8(c.k & 0xFF),
                             notConnected: { notConnected() }, tapOverride: edit)
    }

    private func addCombo(_ c: HidCombo) {
        building = false
        var list: [HidCombo] = combos
        list.append(c)
        saveCombos(list)
    }

    private var comboTitle: String {
        let list: [HidCombo] = combos
        if let i = comboMenu, i < list.count { return list[i].n }
        return ""
    }

    private var comboMenuShown: Binding<Bool> {
        Binding(get: { comboMenu != nil }, set: { v in if !v { comboMenu = nil } })
    }

    @ViewBuilder private var comboActions: some View {
        if let i = comboMenu {
            Button("Переименовать") {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { renaming = ComboIndex(index: i) }
            }
            Button("Удалить", role: .destructive) { deleteCombo(i) }
        }
        Button("Отмена", role: .cancel) {}
    }

    private func deleteCombo(_ i: Int) {
        var list: [HidCombo] = combos
        if i < list.count { list.remove(at: i) }
        saveCombos(list)
        if list.isEmpty { editing = false }
    }

    private func renameSheet(_ i: Int) -> some View {
        let list: [HidCombo] = combos
        let name: String = i < list.count ? list[i].n : ""
        return AskSheet(title: "Имя сочетания", value: name, numeric: false) { t in
            renaming = nil
            var l: [HidCombo] = combos
            if i < l.count {
                l[i].n = t
                saveCombos(l)
            }
        } cancel: { renaming = nil }
    }

    @ViewBuilder private var flashLink: some View {
        if let url = TouchpadPanel.flashURL {
            Link(destination: url) {
                Text("Как прошить донгл →").font(Term.ru(14)).foregroundColor(Term.fg).underline()
            }
            .padding(.top, 4)
        }
    }
}

/// Номер сочетания для окна переименования.
struct ComboIndex: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Своё сочетание: имя, модификаторы, HID-код (0 — только модификаторы).
struct HidCombo: Codable {
    var n: String
    var m: Int
    var k: Int

    static func decode(_ json: String) -> [HidCombo] {
        guard let d = json.data(using: .utf8), let arr = try? JSONDecoder().decode([HidCombo].self, from: d) else { return [] }
        return arr
    }

    static func encode(_ list: [HidCombo]) -> String {
        guard let d = try? JSONEncoder().encode(list) else { return "[]" }
        return String(data: d, encoding: .utf8) ?? "[]"
    }

    /// Имя по умолчанию: «Ctrl+Shift+Esc».
    static func defaultName(_ mods: Int, _ key: Int) -> String {
        var parts: [String] = []
        if mods & 0x01 != 0 { parts.append("Ctrl") }
        if mods & 0x02 != 0 { parts.append("Shift") }
        if mods & 0x04 != 0 { parts.append("Alt") }
        if mods & 0x08 != 0 { parts.append("Win") }
        if key != 0, let k = ComboSheet.keys.first(where: { x in Int(x.code) == key }) { parts.append(k.title) }
        return parts.isEmpty ? "—" : parts.joined(separator: "+")
    }
}

/// Кнопка-клавиша с зажатием: касание — KEYDOWN, палец убран (или ушёл с кнопки, или началась прокрутка) — KEYUP.
/// Очень быстрый тап, не показавший нажатие, шлёт обычное нажатие KEY. В режиме правки касание вызывает tapOverride.
struct HoldKeyButton: View {
    let title: String
    let mods: UInt8
    let code: UInt8
    var height: CGFloat = 42
    let notConnected: () -> Void
    var tapOverride: (() -> Void)? = nil

    @State private var pressed = false
    @State private var sawPress = false

    var body: some View {
        Button(action: tapped) {
            TabLabel(title: title, on: pressed, height: height, ruSize: 12, forceRu: true)
        }
        .buttonStyle(PressReport(onPress: { p in press(p) }))
    }

    private func press(_ p: Bool) {
        if tapOverride != nil { return }
        if p {
            sawPress = true
            if !pressed {
                if HidLink.shared.keyDown(mods, code) {
                    pressed = true
                } else {
                    notConnected()
                }
            }
        } else if pressed {
            pressed = false
            HidLink.shared.keyUp(mods, code)
        }
    }

    private func tapped() {
        if let t = tapOverride {
            t()
            return
        }
        if !sawPress && !HidLink.shared.key(mods, code) { notConnected() }
        sawPress = false
    }
}

/// Конструктор сочетания: Ctrl / Shift / Alt / Win, клавиша из списка и необязательное имя.
struct ComboSheet: View {
    let ok: (HidCombo) -> Void
    let cancel: () -> Void

    @State private var mods = 0
    @State private var key = 0
    @State private var name = ""

    static let keys: [HidKey] = ComboSheet.makeKeys()

    private static func makeKeys() -> [HidKey] {
        var out: [HidKey] = []
        let letters: [String] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".map { c in String(c) }
        for i in 0..<letters.count { out.append(HidKey(letters[i], 0, UInt8(0x04 + i))) }
        out.append(HidKey("0", 0, 0x27))
        for i in 1...9 { out.append(HidKey(String(i), 0, UInt8(0x1E + i - 1))) }
        for i in 1...12 { out.append(HidKey("F" + String(i), 0, UInt8(0x3A + i - 1))) }
        let named: [HidKey] = [
            HidKey("Esc", 0, 0x29), HidKey("Tab", 0, 0x2B), HidKey("Enter", 0, 0x28), HidKey("Space", 0, 0x2C),
            HidKey("⌫", 0, 0x2A), HidKey("Del", 0, 0x4C), HidKey("Insert", 0, 0x49), HidKey("Home", 0, 0x4A),
            HidKey("End", 0, 0x4D), HidKey("PgUp", 0, 0x4B), HidKey("PgDn", 0, 0x4E), HidKey("←", 0, 0x50),
            HidKey("→", 0, 0x4F), HidKey("↑", 0, 0x52), HidKey("↓", 0, 0x51), HidKey("PrtSc", 0, 0x46),
            HidKey("Pause", 0, 0x48), HidKey("CapsLock", 0, 0x39), HidKey("-", 0, 0x2D), HidKey("=", 0, 0x2E),
            HidKey("[", 0, 0x2F), HidKey("]", 0, 0x30), HidKey(";", 0, 0x33), HidKey("'", 0, 0x34),
            HidKey(",", 0, 0x36), HidKey(".", 0, 0x37), HidKey("/", 0, 0x38), HidKey("`", 0, 0x35),
        ]
        out.append(contentsOf: named)
        out.append(HidKey("нет — только модификаторы", 0, 0))
        return out
    }

    private static let modList: [HidKey] = [HidKey("Ctrl", 0x01, 0), HidKey("Shift", 0x02, 0), HidKey("Alt", 0x04, 0), HidKey("Win", 0x08, 0)]

    private var preview: String { HidCombo.defaultName(mods, key) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Сочетание").font(Term.ru(18)).foregroundColor(Term.fg)
                Spacer()
                Button("Отмена") { cancel() }.font(Term.ru(15)).foregroundColor(Term.fg)
            }
            HStack(spacing: 6) {
                ForEach(0..<ComboSheet.modList.count, id: \.self) { i in modButton(ComboSheet.modList[i]) }
            }
            Text("клавиша").font(Term.ru(13)).foregroundColor(Term.dim)
            ScrollView {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6),
                                    GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                    ForEach(0..<ComboSheet.keys.count, id: \.self) { i in keyChoice(ComboSheet.keys[i]) }
                }
            }
            TextField(preview, text: $name)
                .font(Term.ru(16)).foregroundColor(Term.fg)
                .disableAutocorrection(true)
                .padding(10)
                .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
            Button { submit() } label: {
                TabLabel(title: "OK — " + preview, on: true, height: 46, ruSize: 15, forceRu: true)
            }
        }
        .padding(20)
        .modifier(ThemedSheet())
    }

    private func modButton(_ m: HidKey) -> some View {
        let bit: Int = Int(m.mods)
        let on: Bool = mods & bit != 0
        return Button { mods ^= bit } label: {
            TabLabel(title: m.title, on: on, height: 42, ruSize: 13, forceRu: true)
        }
    }

    private func keyChoice(_ k: HidKey) -> some View {
        let on: Bool = key == Int(k.code)
        return Button { key = Int(k.code) } label: {
            TabLabel(title: k.title, on: on, height: 40, ruSize: 12, forceRu: true)
        }
    }

    private func submit() {
        let n: String = name.trimmingCharacters(in: .whitespaces)
        ok(HidCombo(n: n.isEmpty ? preview : n, m: mods, k: key))
    }
}

/// Светодиод донгла: режим (0 авто, 1 цвет, 2 дыхание, 3 радуга, 4 выкл), цвет и яркость. Хранится в "hid_led".
struct LedState {
    var mode: Int = 0
    var r: Int = 0x00
    var g: Int = 0x40
    var b: Int = 0xFF
    var bright: Int = 40

    static func load(_ s: String) -> LedState {
        var st = LedState()
        let v: [Int] = s.components(separatedBy: ",").compactMap { x in Int(x) }
        if v.count < 5 { return st }
        st.mode = min(max(v[0], 0), 4)
        st.r = min(max(v[1], 0), 255)
        st.g = min(max(v[2], 0), 255)
        st.b = min(max(v[3], 0), 255)
        st.bright = min(max(v[4], 0), 255)
        return st
    }

    func encode() -> String {
        let parts: [String] = [String(mode), String(r), String(g), String(b), String(bright)]
        return parts.joined(separator: ",")
    }

    var hex: UInt32 { (UInt32(r) << 16) | (UInt32(g) << 8) | UInt32(b) }

    mutating func setHex(_ h: UInt32) {
        r = Int((h >> 16) & 0xFF)
        g = Int((h >> 8) & 0xFF)
        b = Int(h & 0xFF)
    }

    /// Пакет 0x08 LED [0x08, mode, r, g, b, bright].
    var packet: [UInt8] { [0x08, UInt8(mode), UInt8(r), UInt8(g), UInt8(b), UInt8(bright)] }
}

/// Подвкладка «светодиод»: режим, цвет (для цветного светодиода) и яркость.
struct LedPanel: View {
    @ObservedObject var model: RemoteModel
    @ObservedObject private var link = HidLink.shared
    @AppStorage("hid_led") private var stored = ""
    /// Состояние, пока тянут ползунок (сохраняется при отпускании).
    @State private var live: LedState?
    @State private var lastSent = Date.distantPast

    private static let swatches: [UInt32] = [0xFF0000, 0xFF6000, 0xFFC800, 0x80FF00, 0x00FF40, 0x00FFC0,
                                             0x00C0FF, 0x0040FF, 0x8000FF, 0xFF00C0, 0xFFFFFF, 0xFFB070]
    private static let rainbow: [Color] = (0...12).map { i in Color(hex: hsvToHex(Double(i) * 30, 1, 1)) }

    private var st: LedState { live ?? LedState.load(stored) }
    private var mono: Bool { link.ledKind == "mono" }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                modeRow
                preview
                if !mono { palette }
                if link.ledKind == "rgb" { hueSlider }
                brightSlider
                Text("Нужна прошивка донгла 1.3 (ESP32-C3 — 1.2). На ESP32-C3 светодиод синий — меняется яркость и режим.")
                    .font(Term.ru(12)).foregroundColor(Term.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, 16)
        }
    }

    private var modeRow: some View {
        let titles: [String] = ["авто", "цвет", "дыхание", mono ? "мигает" : "радуга", "выкл"]
        return HStack(spacing: 6) {
            ForEach(0..<5, id: \.self) { i in modeButton(i, titles[i]) }
        }
    }

    private func modeButton(_ i: Int, _ title: String) -> some View {
        Button {
            var s: LedState = st
            s.mode = i
            commit(s)
        } label: {
            TabLabel(title: title, on: st.mode == i, height: 42, ruSize: 12, forceRu: true)
        }
    }

    /// Текущий цвет × яркость (для одноцветного — синий).
    private var preview: some View {
        let s: LedState = st
        let base: UInt32 = mono ? 0x0040FF : s.hex
        let k: Double = 0.15 + 0.85 * Double(s.bright) / 255
        let rr: Double = Double((base >> 16) & 0xFF) / 255 * k
        let gg: Double = Double((base >> 8) & 0xFF) / 255 * k
        let bb: Double = Double(base & 0xFF) / 255 * k
        let c = Color(.sRGB, red: rr, green: gg, blue: bb, opacity: 1)
        let pct: Int = Int((Double(s.bright) / 255 * 100).rounded())
        return HStack(spacing: 14) {
            Circle().fill(c).frame(width: 64, height: 64)
                .overlay(Circle().stroke(Term.line, lineWidth: 1))
                .shadow(color: c.opacity(s.mode == 4 ? 0 : 0.8), radius: 12)
            Text("яркость " + String(pct) + "%").font(Term.ru(14)).foregroundColor(Term.dim)
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var palette: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 6), spacing: 8) {
            ForEach(0..<LedPanel.swatches.count, id: \.self) { i in swatch(LedPanel.swatches[i]) }
        }
    }

    private func swatch(_ h: UInt32) -> some View {
        let on: Bool = st.hex == h && st.mode != 0 && st.mode != 4
        return Button {
            var s: LedState = st
            s.setHex(h)
            if s.mode == 0 || s.mode == 4 { s.mode = 1 }   // касание образца — режим «цвет»
            commit(s)
        } label: {
            RoundedRectangle(cornerRadius: 6).fill(Color(hex: h)).frame(height: 40)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(on ? Term.fg : Term.line, lineWidth: on ? 3 : 1))
        }
    }

    private var hueSlider: some View {
        let h: Double = hueOf(st.hex) / 360
        return VStack(alignment: .leading, spacing: 0) {
            Text("оттенок").font(Term.ru(13)).foregroundColor(Term.dim)
            TrackSlider(value: h, mark: 0, markColor: Color(hex: 0xFF0000), track: LedPanel.rainbow,
                        leftText: "", rightText: "",
                        onDrag: { v in hue(v, final: false) }, onDone: { v in hue(v, final: true) })
        }
    }

    private var brightSlider: some View {
        let s: LedState = st
        let top: Color = Color(hex: mono ? 0x0040FF : s.hex)
        return VStack(alignment: .leading, spacing: 0) {
            Text("яркость").font(Term.ru(13)).foregroundColor(Term.dim)
            TrackSlider(value: Double(s.bright) / 255, mark: 40.0 / 255.0, markColor: top, track: [Color.black, top],
                        leftText: "0%", rightText: "100%",
                        onDrag: { v in bright(v, final: false) }, onDone: { v in bright(v, final: true) })
        }
    }

    private func hue(_ v: Double, final: Bool) {
        var s: LedState = st
        s.setHex(hsvToHex(v * 360, 1, 1))
        if s.mode == 0 || s.mode == 4 { s.mode = 1 }
        apply(s, final: final)
    }

    private func bright(_ v: Double, final: Bool) {
        var s: LedState = st
        s.bright = Int((v * 255).rounded())
        apply(s, final: final)
    }

    /// Во время движения ползунка — не чаще раза в 60 мс, при отпускании — финальный пакет и сохранение.
    private func apply(_ s: LedState, final: Bool) {
        if final {
            live = nil
            commit(s)
            return
        }
        live = s
        if Date().timeIntervalSince(lastSent) >= 0.06 {
            lastSent = Date()
            _ = link.send(s.packet)
        }
    }

    /// Сохранить и отправить; без подключения — подсказка, цвет применится при подключении.
    private func commit(_ s: LedState) {
        stored = s.encode()
        lastSent = Date()
        if !link.send(s.packet) {
            let msg: String = "> донгл не подключён — цвет применится при подключении"
            if model.status != msg { model.say(msg) }
        }
    }
}

/// Донгл в списке выбора, когда их найдено несколько.
struct HidChoice: Identifiable {
    let id: UUID
    let label: String
    let rssi: Int
}

// MARK: Ducky Script

/// Одно действие скрипта.
enum DuckyAction {
    case text(String)
    case key(UInt8, UInt8)
    case delay(Int)
    case move(Int, Int)
    case click(UInt8, UInt8)
    case scroll(Int)
}

struct DuckyError: Error {
    let line: Int
    let msg: String
}

enum Ducky {
    /// HID-код именованной клавиши или одиночного символа; nil — не клавиша.
    static func keyCode(_ raw: String) -> UInt8? {
        let up: String = raw.uppercased()
        if let c = named[up] { return c }
        if up.count == 1, let ch = up.first {
            if ch >= "A" && ch <= "Z" {
                let base: Int = Int(("A" as Character).asciiValue ?? 65)
                return UInt8(0x04 + (Int(ch.asciiValue ?? 65) - base))
            }
            if let d = digit[ch] { return d }
            if let s = symbol[ch] { return s }
        }
        return nil
    }

    static func modBit(_ raw: String) -> UInt8? {
        switch raw.uppercased() {
        case "CTRL", "CONTROL": return 0x01
        case "SHIFT": return 0x02
        case "ALT", "OPTION": return 0x04
        case "GUI", "WINDOWS", "WIN", "COMMAND", "CMD": return 0x08
        default: return nil
        }
    }

    private static let named: [String: UInt8] = [
        "ENTER": 0x28, "RETURN": 0x28, "TAB": 0x2B, "ESC": 0x29, "ESCAPE": 0x29, "SPACE": 0x2C,
        "BACKSPACE": 0x2A, "DELETE": 0x4C, "DEL": 0x4C, "INSERT": 0x49, "HOME": 0x4A, "END": 0x4D,
        "PAGEUP": 0x4B, "PAGEDOWN": 0x4E, "UP": 0x52, "UPARROW": 0x52, "DOWN": 0x51, "DOWNARROW": 0x51,
        "LEFT": 0x50, "LEFTARROW": 0x50, "RIGHT": 0x4F, "RIGHTARROW": 0x4F, "PRINTSCREEN": 0x46,
        "PAUSE": 0x48, "BREAK": 0x48, "CAPSLOCK": 0x39, "MENU": 0x65, "APP": 0x65,
        "F1": 0x3A, "F2": 0x3B, "F3": 0x3C, "F4": 0x3D, "F5": 0x3E, "F6": 0x3F,
        "F7": 0x40, "F8": 0x41, "F9": 0x42, "F10": 0x43, "F11": 0x44, "F12": 0x45,
    ]
    private static let digit: [Character: UInt8] = [
        "1": 0x1E, "2": 0x1F, "3": 0x20, "4": 0x21, "5": 0x22, "6": 0x23, "7": 0x24, "8": 0x25, "9": 0x26, "0": 0x27,
    ]
    private static let symbol: [Character: UInt8] = [
        "-": 0x2D, "=": 0x2E, "[": 0x2F, "]": 0x30, "\\": 0x31, ";": 0x33, "'": 0x34,
        ",": 0x36, ".": 0x37, "/": 0x38, "`": 0x35,
    ]

    /// Разобрать текст скрипта в список действий (с учётом DEFAULTDELAY и REPEAT).
    static func parse(_ src: String) throws -> [DuckyAction] {
        var out: [DuckyAction] = []
        var def: Int = 0
        var prev: [DuckyAction] = []
        let lines: [Substring] = src.split(separator: "\n", omittingEmptySubsequences: false)
        for (idx, rawLine) in lines.enumerated() {
            let lineNo: Int = idx + 1
            let line: String = String(rawLine).trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let tokens: [String] = line.split(separator: " ").map { t in String(t) }
            let cmd: String = tokens[0].uppercased()
            let rest: String = tokens.count > 1 ? String(line.dropFirst(tokens[0].count)).trimmingCharacters(in: .whitespaces) : ""

            if cmd == "REM" || cmd.hasPrefix("#") { continue }

            if cmd == "DEFAULTDELAY" || cmd == "DEFAULT_DELAY" {
                def = max(0, Int(rest) ?? 0)
                continue
            }
            if cmd == "REPEAT" {
                let n: Int = max(0, Int(rest) ?? 0)
                for _ in 0..<n { out.append(contentsOf: prev) }
                continue
            }

            var block: [DuckyAction] = []
            var withDefault: Bool = true
            if cmd == "STRING" {
                block.append(.text(rest))
            } else if cmd == "STRINGLN" {
                block.append(.text(rest))
                block.append(.key(0, 0x28))
            } else if cmd == "DELAY" {
                block.append(.delay(max(0, Int(rest) ?? 0)))
                withDefault = false
            } else if cmd == "MOUSE" {
                block = try mouse(tokens, lineNo)
            } else {
                block.append(try combo(tokens, lineNo))
            }

            if withDefault && def > 0 { block.append(.delay(def)) }
            out.append(contentsOf: block)
            prev = block
        }
        return out
    }

    private static func combo(_ tokens: [String], _ lineNo: Int) throws -> DuckyAction {
        var mods: UInt8 = 0
        var code: UInt8 = 0
        for token in tokens {
            for part in token.split(separator: "-").map({ p in String(p) }) {
                if let m = modBit(part) {
                    mods |= m
                } else if let c = keyCode(part) {
                    code = c
                } else {
                    throw DuckyError(line: lineNo, msg: "неизвестная клавиша «" + part + "»")
                }
            }
        }
        return .key(mods, code)
    }

    private static func mouse(_ tokens: [String], _ lineNo: Int) throws -> [DuckyAction] {
        if tokens.count < 2 { throw DuckyError(line: lineNo, msg: "после MOUSE нужно действие") }
        let what: String = tokens[1].uppercased()
        switch what {
        case "MOVE":
            if tokens.count < 4 { throw DuckyError(line: lineNo, msg: "MOUSE MOVE нужны dx и dy") }
            let dx: Int = Int(tokens[2]) ?? 0
            let dy: Int = Int(tokens[3]) ?? 0
            return [.move(dx, dy)]
        case "LEFT": return [.click(1, 1)]
        case "RIGHT": return [.click(2, 1)]
        case "MIDDLE": return [.click(4, 1)]
        case "DOUBLE": return [.click(1, 2)]
        case "SCROLL":
            if tokens.count < 3 { throw DuckyError(line: lineNo, msg: "MOUSE SCROLL нужно число") }
            return [.scroll(Int(tokens[2]) ?? 0)]
        default:
            throw DuckyError(line: lineNo, msg: "неизвестное MOUSE «" + what + "»")
        }
    }

    /// Байткод для платы.
    static func compile(_ acts: [DuckyAction]) -> [UInt8] {
        var out: [UInt8] = []
        for a in acts {
            switch a {
            case .text(let s):
                out.append(contentsOf: textBytes(s))
            case .key(let m, let k):
                out.append(contentsOf: [0x02, m, k])
            case .delay(let ms):
                let v: Int = min(65535, max(0, ms))
                out.append(contentsOf: [0x03, UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)])
            case .move(let dx, let dy):
                out.append(contentsOf: moveBytes(dx, dy))
            case .click(let mask, let count):
                out.append(contentsOf: [0x05, mask, count])
            case .scroll(let w):
                out.append(contentsOf: scrollBytes(w))
            }
        }
        return out
    }

    /// 0x01 len <UTF-8>, куски ≤200 байт по границам символов.
    private static func textBytes(_ s: String) -> [UInt8] {
        var out: [UInt8] = []
        var chunk: [UInt8] = []
        for ch in s {
            let b: [UInt8] = Array(String(ch).utf8)
            if chunk.count + b.count > 200 {
                out.append(0x01)
                out.append(UInt8(chunk.count))
                out.append(contentsOf: chunk)
                chunk = []
            }
            chunk += b
        }
        if !chunk.isEmpty {
            out.append(0x01)
            out.append(UInt8(chunk.count))
            out.append(contentsOf: chunk)
        }
        return out
    }

    private static func i8(_ v: Int) -> UInt8 { UInt8(bitPattern: Int8(min(127, max(-127, v)))) }

    private static func moveBytes(_ dx: Int, _ dy: Int) -> [UInt8] {
        var out: [UInt8] = []
        var x: Int = dx
        var y: Int = dy
        repeat {
            let sx: Int = min(127, max(-127, x))
            let sy: Int = min(127, max(-127, y))
            out.append(contentsOf: [0x04, i8(sx), i8(sy)])
            x -= sx
            y -= sy
        } while x != 0 || y != 0
        return out
    }

    private static func scrollBytes(_ w: Int) -> [UInt8] {
        var out: [UInt8] = []
        var v: Int = w
        repeat {
            let s: Int = min(127, max(-127, v))
            out.append(contentsOf: [0x08, i8(s)])
            v -= s
        } while v != 0
        return out
    }
}

/// Скрипт пользователя: имя, текст Ducky, автозапуск.
struct HidScript: Codable {
    var n: String
    var src: String
    var auto: Bool
}

enum HidScriptStore {
    static func decode(_ json: String) -> [HidScript] {
        guard let d = json.data(using: .utf8), let arr = try? JSONDecoder().decode([HidScript].self, from: d) else { return [] }
        return arr
    }

    static func encode(_ list: [HidScript]) -> String {
        guard let d = try? JSONEncoder().encode(list) else { return "[]" }
        return String(data: d, encoding: .utf8) ?? "[]"
    }

    static func examples() -> [HidScript] {
        let notepad: String = "GUI r\nDELAY 400\nSTRING notepad\nENTER\nDELAY 600\nSTRING Привет от krisa37!"
        return [HidScript(n: "Блокнот", src: notepad, auto: false),
                HidScript(n: "Свернуть всё", src: "GUI d", auto: false),
                HidScript(n: "Переключить окно", src: "ALT TAB", auto: false)]
    }

    static func load(_ json: String) -> [HidScript] {
        let list: [HidScript] = decode(json)
        return list.isEmpty ? examples() : list
    }
}

/// Какое окно открыто в подвкладке «скрипт».
enum HidScriptDialog: Identifiable {
    case pick
    case newName
    case rename
    var id: String {
        switch self {
        case .pick: return "pick"
        case .newName: return "new"
        case .rename: return "rename"
        }
    }
}

/// Подвкладка «скрипт»: редактор Ducky Script, запись движений мыши, запись на плату и автозапуск.
struct HidScriptPanel: View {
    @ObservedObject var model: RemoteModel
    @ObservedObject private var link = HidLink.shared
    @AppStorage("hid_scripts") private var json = ""
    @AppStorage("hid_script_cur") private var cur = 0
    @State private var scripts: [HidScript]
    @State private var dialog: HidScriptDialog?
    @State private var askDelete = false
    @State private var parseInfo = ""
    @State private var running = false
    @State private var recording = false
    @State private var recorded: [String] = []
    @State private var lastEvent = Date()

    init(model: RemoteModel) {
        _model = ObservedObject(wrappedValue: model)
        let saved: String = UserDefaults.standard.string(forKey: "hid_scripts") ?? ""
        _scripts = State(initialValue: HidScriptStore.load(saved))
    }

    private var idx: Int { min(max(cur, 0), scripts.count - 1) }
    private var script: HidScript { scripts[idx] }

    private static let placeholder: String = "GUI r\nDELAY 400\nSTRING notepad\nENTER"

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Автоввод работает на вашем компьютере. Не подключайте донгл к чужим устройствам без разрешения.")
                    .font(Term.ru(12)).foregroundColor(Term.dim)
                    .fixedSize(horizontal: false, vertical: true)
                nameButton
                manageRow
                editor
                if !parseInfo.isEmpty {
                    Text(parseInfo).font(Term.ru(12)).foregroundColor(Term.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                actionRows
                recorder
                Text("Нужна прошивка донгла 1.5 (ESP32-C3 — 1.3).")
                    .font(Term.ru(12)).foregroundColor(Term.dim)
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

    // MARK: имя, управление

    private func label(_ s: String) -> String {
        if !(Term.prism || Term.blueprint) { return s }
        var t: String = s
        if t.hasPrefix("[") { t.removeFirst() }
        if t.hasSuffix("]") { t.removeLast() }
        return t.trimmingCharacters(in: .whitespaces)
    }

    private func button(_ title: String, on: Bool, height: CGFloat, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            TabLabel(title: label(title), on: on, height: height, ruSize: 13, forceRu: true)
        }
    }

    private var nameButton: some View {
        Button { dialog = .pick } label: {
            TabLabel(title: label("[ " + script.name + " ▾ ]"), on: false, height: 46, ruSize: 15, forceRu: true)
        }
    }

    private var manageRow: some View {
        HStack(spacing: 6) {
            button("[ новый ]", on: false, height: 42) { dialog = .newName }
            button("[ имя ]", on: false, height: 42) { dialog = .rename }
            button("[ удалить ]", on: false, height: 42) { askDelete = true }
        }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if script.src.isEmpty {
                Text(HidScriptPanel.placeholder)
                    .font(.system(size: 14, design: .monospaced)).foregroundColor(Term.dim.opacity(0.6))
                    .padding(10)
            }
            TextEditor(text: srcBinding)
                .font(.system(size: 14, design: .monospaced))
                .foregroundColor(Term.fg)
                .frame(height: 180)
                .padding(4)
        }
        .background(Term.bg.opacity(0.6))
        .overlay(Rectangle().strokeBorder(Term.line, lineWidth: 1))
    }

    private var srcBinding: Binding<String> {
        Binding(get: { script.src }, set: { v in
            var s: HidScript = script
            s.src = v
            scripts[idx] = s
            save()
        })
    }

    // MARK: кнопки действий

    private var actionRows: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                button(running ? "[ ▶ идёт… ]" : "[ ▶ Выполнить ]", on: running, height: 46) { runLive() }
                button("[ ⤓ На плату ]", on: false, height: 46) { upload(auto: script.auto) }
            }
            HStack(spacing: 6) {
                button(script.auto ? "[ ⎙ Автозапуск: вкл ]" : "[ ⎙ Автозапуск: выкл ]", on: script.auto, height: 44) { toggleAuto() }
                button("[ ✖ Стереть с платы ]", on: false, height: 44) { eraseBoard() }
            }
        }
    }

    // MARK: запись мыши

    private var recorder: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("запись мыши").font(Term.ru(13)).foregroundColor(Term.dim).padding(.top, 6)
            GeometryReader { g in
                ZStack {
                    Canvas { ctx, size in HidScriptPanel.dots(ctx, size) }
                    TouchSurface(sens: 1,
                                 onMove: { dx, dy in record("MOUSE MOVE " + String(dx) + " " + String(dy)) },
                                 onWheel: { w in record("MOUSE SCROLL " + String(w)) },
                                 onClick: { m in record(m == 2 ? "MOUSE RIGHT" : "MOUSE LEFT") },
                                 onButtons: { _ in })
                }
                .frame(width: g.size.width, height: g.size.width * 0.4)
                .background(Term.bg.opacity(0.6))
                .overlay(Rectangle().strokeBorder(recording ? Term.fg : Term.line, lineWidth: recording ? 2 : 1))
            }
            .aspectRatio(1 / 0.4, contentMode: .fit)
            HStack(spacing: 6) {
                button(recording ? "[ ■ стоп ]" : "[ ● запись ]", on: recording, height: 42) { toggleRecord() }
                button("[ вставить в скрипт ]", on: false, height: 42) { insertRecorded() }
            }
        }
    }

    private static func dots(_ ctx: GraphicsContext, _ size: CGSize) {
        let step: CGFloat = 18
        var p = Path()
        var y: CGFloat = step / 2
        while y < size.height {
            var x: CGFloat = step / 2
            while x < size.width {
                p.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                x += step
            }
            y += step
        }
        ctx.fill(p, with: .color(Term.line.opacity(0.7)))
    }

    private func toggleRecord() {
        recording.toggle()
        if recording {
            recorded = []
            lastEvent = Date()
        }
    }

    private func record(_ line: String) {
        if !recording { return }
        let gap: Int = Int(Date().timeIntervalSince(lastEvent) * 1000)
        lastEvent = Date()
        if gap >= 20 { recorded.append("DELAY " + String(gap)) }
        recorded.append(line)
    }

    private func insertRecorded() {
        if recorded.isEmpty {
            model.say("> нет записанных движений")
            return
        }
        recording = false
        var s: HidScript = script
        let add: String = recorded.joined(separator: "\n")
        s.src = s.src.isEmpty ? add : s.src + "\n" + add
        scripts[idx] = s
        save()
        recorded = []
    }

    // MARK: действия со скриптом

    private func save() {
        json = HidScriptStore.encode(scripts)
        cur = idx
    }

    private func change(_ s: HidScript) {
        scripts[idx] = s
        save()
    }

    private func deleteScript() {
        scripts.remove(at: idx)
        if scripts.isEmpty { scripts.append(HidScript(n: "Скрипт 1", src: "", auto: false)) }
        cur = min(idx, scripts.count - 1)
        save()
    }

    /// Разобрать текущий текст; при ошибке показать строку.
    private func parsed() -> [DuckyAction]? {
        do {
            let acts: [DuckyAction] = try Ducky.parse(script.src)
            parseInfo = "OK, " + String(acts.count) + " действий"
            return acts
        } catch let e as DuckyError {
            parseInfo = "ошибка в строке " + String(e.line) + ": " + e.msg
            return nil
        } catch {
            parseInfo = "ошибка разбора"
            return nil
        }
    }

    private func runLive() {
        if running { return }
        guard let acts = parsed() else { return }
        if !link.ready {
            model.say("> донгл не подключён — [ подключить ]")
            return
        }
        running = true
        model.say("> скрипт «" + script.name + "»: выполняю")
        DispatchQueue.global(qos: .userInitiated).async {
            for a in acts { HidScriptPanel.live(a, link) }
            DispatchQueue.main.async {
                running = false
                model.say("> скрипт выполнен")
            }
        }
    }

    private static func live(_ a: DuckyAction, _ link: HidLink) {
        switch a {
        case .text(let s): link.text(s)
        case .key(let m, let k): link.key(m, k)
        case .delay(let ms): Thread.sleep(forTimeInterval: Double(ms) / 1000)
        case .move(let dx, let dy): link.move(dx, dy)
        case .click(let mask, let count): link.click(mask, count: count)
        case .scroll(let w): link.move(0, 0, wheel: w)
        }
    }

    private func upload(auto: Bool) {
        guard let acts = parsed() else { return }
        if !link.ready {
            model.say("> донгл не подключён — [ подключить ]")
            return
        }
        let code: [UInt8] = Ducky.compile(acts)
        if link.uploadScript(code, auto: auto) {
            model.say(auto ? "> скрипт записан на плату · автозапуск включён" : "> скрипт записан на плату")
        } else {
            model.say("> не удалось записать скрипт", err: true)
        }
    }

    private func toggleAuto() {
        var s: HidScript = script
        s.auto.toggle()
        change(s)
        if s.auto {
            upload(auto: true)                 // включили — сразу на плату с автозапуском
        } else if link.ready {
            link.scriptSave(false)             // выключили — снять автозапуск
            model.say("> автозапуск выключен")
        }
    }

    private func eraseBoard() {
        if !link.ready {
            model.say("> донгл не подключён — [ подключить ]")
            return
        }
        link.scriptErase()
        var s: HidScript = script
        if s.auto {
            s.auto = false
            change(s)
        }
        model.say("> скрипт стёрт с платы")
    }

    // MARK: окна

    @ViewBuilder private func dialogView(_ d: HidScriptDialog) -> some View {
        switch d {
        case .pick:
            ChoiceSheet(title: "Скрипты", items: scripts.map { s in s.n }, selected: idx) { w in
                cur = w
                parseInfo = ""
                dialog = nil
            } cancel: { dialog = nil }
        case .newName:
            AskSheet(title: "Новый скрипт", value: "Скрипт " + String(scripts.count + 1), numeric: false) { t in
                dialog = nil
                scripts.append(HidScript(n: t, src: "", auto: false))
                cur = scripts.count - 1
                save()
            } cancel: { dialog = nil }
        case .rename:
            AskSheet(title: "Имя скрипта", value: script.name, numeric: false) { t in
                dialog = nil
                var s: HidScript = script
                s.n = t
                change(s)
            } cancel: { dialog = nil }
        }
    }
}

extension HidScript {
    /// Имя для подписей.
    var name: String { n }
}
