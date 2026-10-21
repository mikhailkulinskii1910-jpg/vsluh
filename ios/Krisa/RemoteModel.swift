import AVFoundation
import Foundation
import SwiftUI

enum TxMode: String, CaseIterable, Identifiable {
    case audio2, audio1, http
    var id: String { rawValue }
    var label: String {
        switch self {
        case .audio2: return "Звуковой адаптер, 2 светодиода"
        case .audio1: return "Звуковой адаптер, 1 светодиод"
        case .http: return "Wi-Fi передатчик (Tasmota)"
        }
    }
}

/// Состояние пульта: выбранный передатчик, строка статуса и передача с повторами при удержании.
final class RemoteModel: ObservableObject {
    @AppStorage("tx_mode") var mode: TxMode = .audio2 { willSet { objectWillChange.send() } }
    @AppStorage("tx_host") var host: String = "" { willSet { objectWillChange.send() } }
    @Published var status = "> ready. \(KEYS.count) keys loaded"
    @Published var routeOK = AudioIr.adapterConnected

    private let io = DispatchQueue(label: "krisa.ir")
    private lazy var audio2 = AudioIr(twoLeds: true)
    private lazy var audio1 = AudioIr(twoLeds: false)
    private var pressSeq = 0
    /// Номер нажатия, кнопка которого сейчас зажата; 0 — ничего не зажато.
    private var held = 0
    private let lock = NSLock()

    init() {
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.routeOK = AudioIr.adapterConnected
        }
        KeepAlive.shared.onResume = { [weak self] in self?.say("> прервано звонком, продолжаю") }
    }

    var modeLine: String {
        switch mode {
        case .http: return "> " + TasmotaIr(host: host).title
        case .audio1, .audio2:
            return "> " + (routeOK ? mode.label : "подключите ИК-адаптер в разъём наушников")
        }
    }

    func say(_ s: String, err: Bool = false) {
        status = err ? "!! " + s : s
    }

    func press(_ label: String, _ code: UInt32) {
        lock.lock(); pressSeq += 1; let id = pressSeq; held = id; lock.unlock()
        say(String(format: "> tx %@ 0x%08X [sent]", label.padding(toLength: 11, withPad: " ", startingAt: 0), code))
        let mode = self.mode, host = self.host
        let audio = mode == .audio1 ? audio1 : audio2
        io.async { [weak self] in
            guard let self else { return }
            do {
                let repeats = REPEATABLE.contains(label)
                let fullFrame = Nec.repeatsFullFrame(code)   // NEC2: повтор всего кадра
                var next = Date().addingTimeInterval(0.4)
                if mode == .http {
                    let tx = TasmotaIr(host: host)
                    try tx.sendNec(code, repeatFrame: false)
                    // По Wi-Fi повторяем раз в 250 мс — чаще модуль не успевает.
                    while repeats && self.isHeld(id) {
                        Thread.sleep(until: next)
                        if !self.isHeld(id) { break }
                        try tx.sendNec(code, repeatFrame: !fullFrame)
                        next = max(next.addingTimeInterval(0.25), Date())
                    }
                } else {
                    try audio.transmit(Nec.withGap(Nec.frame(code)))
                    // Удержание: после 400 мс — повторы каждые 108 мс, пока палец на кнопке.
                    while repeats && self.isHeld(id) {
                        Thread.sleep(until: next)
                        if !self.isHeld(id) { break }
                        try audio.transmit(Nec.withGap(fullFrame ? Nec.frame(code) : Nec.repeatCode))
                        next = max(next.addingTimeInterval(Double(Nec.framePeriodMs) / 1000), Date())
                    }
                }
            } catch {
                DispatchQueue.main.async { self.say(error.localizedDescription, err: true) }
            }
        }
    }

    /// Произвольный кадр (кондиционер): звуковому адаптеру — массив меток и пауз в мкс,
    /// Tasmota — команда IRSend с протоколом, числом бит и данными. Без повторов.
    /// Один NEC-кадр без повторов (сканер скрытых команд).
    func sendOnce(_ code: UInt32, status: String) {
        say(status)
        let mode = self.mode, host = self.host
        let audio = mode == .audio1 ? audio1 : audio2
        io.async { [weak self] in
            do {
                if mode == .http {
                    try TasmotaIr(host: host).sendNec(code, repeatFrame: false)
                } else {
                    try audio.transmit(Nec.withGap(Nec.frame(code)))
                }
            } catch {
                DispatchQueue.main.async { self?.say(error.localizedDescription, err: true) }
            }
        }
    }

    func sendFrame(_ pattern: [Int], proto: String, bits: Int, data: String, status: String) {
        say(status)
        let mode = self.mode, host = self.host
        let audio = mode == .audio1 ? audio1 : audio2
        io.async { [weak self] in
            do {
                if mode == .http {
                    try TasmotaIr(host: host).sendRaw(proto: proto, bits: bits, data: data)
                } else {
                    try audio.transmit(pattern)
                }
            } catch {
                DispatchQueue.main.async { self?.say(error.localizedDescription, err: true) }
            }
        }
    }

    // MARK: сценарии

    /// Идёт ли сценарий и какой блок сейчас выполняется (для подсветки).
    @Published var scriptRunning = false
    @Published var scriptMark = -1
    /// Кто запустил сценарий: "panel" — вкладка «Сценарии», "macroN" — кнопка-макрос на пульте IRBIS.
    @Published var scriptTag = ""
    /// Нажата «Стоп» (читается из потока передачи).
    private var scriptStop = false

    func stopScript() { lock.lock(); scriptStop = true; lock.unlock() }
    private func scriptStopped() -> Bool { lock.lock(); defer { lock.unlock() }; return scriptStop }

    /// Отправить одну команду сценария (из потока передачи).
    private func sendScriptItem(_ item: ScriptSend, mode: TxMode, host: String, audio: AudioIr) throws {
        // звонок прервал звук — подождать его окончания и продолжить
        while KeepAlive.shared.isInterrupted && !scriptStopped() { Thread.sleep(forTimeInterval: 0.1) }
        if scriptStopped() { return }
        switch item {
        case .nec(let code, _):
            if mode == .http {
                try TasmotaIr(host: host).sendNec(code, repeatFrame: false)
            } else {
                try audio.transmit(Nec.withGap(Nec.frame(code)))
            }
        case .haier(let bytes, let model):
            if mode == .http {
                let tx: (proto: String, bits: Int) = Haier.tasmota[min(max(model, 0), 2)]
                try TasmotaIr(host: host).sendRaw(proto: tx.proto, bits: tx.bits, data: Haier.data(bytes))
            } else {
                try audio.transmit(Haier.pattern(bytes))
            }
        }
    }

    /// Выполнить сценарий: блоки по порядку, текущий подсвечивается; экран не гаснет, пока идёт.
    func runScript(_ s: KScript, tag: String = "") {
        if scriptRunning { return }
        if s.blocks.isEmpty { say("Сценарий пуст", err: true); return }
        lock.lock(); scriptStop = false; lock.unlock()
        scriptRunning = true
        scriptMark = -1
        scriptTag = tag
        UIApplication.shared.isIdleTimerDisabled = true
        KeepAlive.shared.begin()      // работает и при выключенном экране
        say("> сценарий «" + s.name + "»: старт")
        let mode = self.mode, host = self.host
        let audio = mode == .audio1 ? audio1 : audio2
        io.async { [weak self] in
            guard let self else { return }
            var failure: String?
            do {
                try ScriptRunner.run(s, send: { item in
                    try self.sendScriptItem(item, mode: mode, host: host, audio: audio)
                    let line: String = "> tx " + item.what + " [sent]"
                    DispatchQueue.main.async { self.say(line) }
                }, mark: { i in
                    DispatchQueue.main.async { self.scriptMark = i }
                }, stopped: { self.scriptStopped() })
            } catch {
                failure = error.localizedDescription
            }
            let byUser: Bool = self.scriptStopped()
            DispatchQueue.main.async {
                self.scriptRunning = false
                self.scriptMark = -1
                UIApplication.shared.isIdleTimerDisabled = false
                KeepAlive.shared.end()
                if let f = failure {
                    self.say(f, err: true)
                } else {
                    self.say(byUser ? "> сценарий остановлен" : "> сценарий выполнен")
                }
            }
        }
    }

    func release() { lock.lock(); held = 0; lock.unlock() }
    private func isHeld(_ id: Int) -> Bool { lock.lock(); defer { lock.unlock() }; return held == id }

    /// Код Pronto для копирования в другие приложения.
    static func pronto(_ code: UInt32) -> String {
        let f = 0x6D, unit = Double(f) * 0.241246
        var d = Nec.frame(code)
        d.append(Nec.framePeriodMs * 1000 - d.reduce(0, +))
        let words = [0, f, d.count / 2, 0] + d.map { Int((Double($0) / unit).rounded()) }
        return words.map { String(format: "%04X", $0) }.joined(separator: " ")
    }
}
