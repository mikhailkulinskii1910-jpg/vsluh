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

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var rx: CBCharacteristic?
    private var info: CBCharacteristic?
    private var wantConnect = false
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
        wantConnect = false
        central?.stopScan()
        if let p = peripheral { central?.cancelPeripheralConnection(p) }
        reset("не подключён")
    }

    private func reset(_ s: String) {
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
            attach(p)
            return
        }
        status = "поиск…"
        c.scanForPeripherals(withServices: [HidLink.service], options: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self, let c = self.central else { return }
            if c.isScanning && self.peripheral == nil {
                c.stopScan()
                self.wantConnect = false
                self.status = "донгл не найден — он вставлен и светится синим?"
            }
        }
    }

    private func attach(_ p: CBPeripheral) {
        peripheral = p
        p.delegate = self
        status = "поиск…"
        central?.connect(p, options: nil)
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
        c.stopScan()
        attach(p)
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        UserDefaults.standard.set(p.identifier.uuidString, forKey: "hid_last")
        connected = true
        denied = false
        status = "подключён"
        p.discoverServices([HidLink.service])
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        peripheral = nil
        reset("не подключён")
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
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
        }
        if let i = info { p.readValue(for: i) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard ch.uuid == HidLink.infoUUID, let d = ch.value, let text = String(data: d, encoding: .utf8) else { return }
        if text.contains("auth=denied") {
            denied = true
            ready = false
            status = "донгл привязан к другому телефону — удерживайте BOOT 3 с"
        } else if text.contains("usb=0") {
            denied = false
            ready = rx != nil
            status = "подключён · доска не видит USB"
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
            pad
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 8) {
                    clickRow
                    sensSlider
                    typeRow
                    keyGrid
                    flashLink
                }
                .padding(.bottom, 16)
            }
        }
        .onAppear { link.autoConnect() }
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
        }
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

    private func keyButton(_ k: HidKey) -> some View {
        Button { run(link.key(k.mods, k.code)) } label: {
            TabLabel(title: k.title, on: false, height: 42, ruSize: 12, forceRu: true)
        }
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
