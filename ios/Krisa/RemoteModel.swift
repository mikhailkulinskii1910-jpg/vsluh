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
                var next = Date().addingTimeInterval(0.4)
                if mode == .http {
                    let tx = TasmotaIr(host: host)
                    try tx.sendNec(code, repeatFrame: false)
                    // По Wi-Fi повторяем раз в 250 мс — чаще модуль не успевает.
                    while repeats && self.isHeld(id) {
                        Thread.sleep(until: next)
                        if !self.isHeld(id) { break }
                        try tx.sendNec(code, repeatFrame: true)
                        next = max(next.addingTimeInterval(0.25), Date())
                    }
                } else {
                    try audio.transmit(Nec.withGap(Nec.frame(code)))
                    // Удержание: после 400 мс — повторы каждые 108 мс, пока палец на кнопке.
                    while repeats && self.isHeld(id) {
                        Thread.sleep(until: next)
                        if !self.isHeld(id) { break }
                        try audio.transmit(Nec.withGap(Nec.repeatCode))
                        next = max(next.addingTimeInterval(Double(Nec.framePeriodMs) / 1000), Date())
                    }
                }
            } catch {
                DispatchQueue.main.async { self.say(error.localizedDescription, err: true) }
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
