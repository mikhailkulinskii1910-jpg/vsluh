import AVFoundation
import Foundation

protocol IrTransmitter {
    var title: String { get }
    /// Блокирует поток примерно на время передачи. Вызывать не из главного потока.
    func transmit(_ pattern: [Int]) throws
}

struct IrError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/**
 ИК-адаптер, который работает как звуковая карта: в разъём наушников (через переходник)
 или USB-C «звуковой» донгл. Как в IrCode Finder: 48 кГц, синус на половине несущей (19 кГц);
 при двух светодиодах правый канал в противофазе — встречно включённые светодиоды дают 38 кГц.

 Встроенного ИК-порта у iPhone нет, а прямой доступ к USB-устройствам iOS приложениям не даёт,
 поэтому звук — единственный проводной способ.
 */
final class AudioIr: IrTransmitter {
    static let rate = 48_000.0
    let twoLeds: Bool
    var title: String { twoLeds ? "Звуковой ИК-адаптер (2 светодиода)" : "Звуковой ИК-адаптер (1 светодиод)" }

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: AudioIr.rate, channels: 2)!

    init(twoLeds: Bool) {
        self.twoLeds = twoLeds
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    private func start() throws {
        let s = AVAudioSession.sharedInstance()
        try s.setCategory(.playback, mode: .default, options: [])
        try? s.setPreferredSampleRate(AudioIr.rate)
        try s.setActive(true)
        if !engine.isRunning { try engine.start() }
        if !player.isPlaying { player.play() }
    }

    func transmit(_ pattern: [Int]) throws {
        try start()
        guard let buf = render(pattern) else { throw IrError(message: "Не удалось подготовить звук") }
        let done = DispatchSemaphore(value: 0)
        player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { _ in done.signal() }
        _ = done.wait(timeout: .now() + 2)
    }

    private func render(_ pattern: [Int]) -> AVAudioPCMBuffer? {
        let leadIn = Int(AudioIr.rate / 50)   // 20 мс тишины, чтобы звуковой тракт успел включиться
        let total = leadIn + pattern.reduce(0) { $0 + Int(Double($1) * AudioIr.rate / 1e6) } + 64
        guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(total)),
              let ch = buf.floatChannelData else { return nil }
        let l = ch[0], r = ch[1]
        let step = 2 * Double.pi * Double(Nec.carrier / 2) / AudioIr.rate
        var n = 0
        for _ in 0..<leadIn { l[n] = 0; r[n] = 0; n += 1 }
        for (i, us) in pattern.enumerated() {
            let count = Int(Double(us) * AudioIr.rate / 1e6)
            var ph = 0.0
            for _ in 0..<count where n < total {
                if i % 2 == 0 {
                    let v = Float(sin(ph))
                    l[n] = v
                    r[n] = twoLeds ? -v : v
                    ph += step
                } else { l[n] = 0; r[n] = 0 }
                n += 1
            }
        }
        buf.frameLength = AVAudioFrameCount(n)
        return buf
    }

    /// Подключён ли проводной выход: наушники, USB-звук или линейный выход.
    static var adapterConnected: Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains {
            [.headphones, .usbAudio, .lineOut].contains($0.portType)
        }
    }

    static var routeDescription: String {
        let outs = AVAudioSession.sharedInstance().currentRoute.outputs
        return outs.isEmpty ? "нет" : outs.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ")
    }
}

/// Wi-Fi ИК-передатчик: модуль ESP8266/ESP32 с прошивкой Tasmota, команда IRSend.
final class TasmotaIr {
    let host: String
    var title: String { "Wi-Fi: \(host.isEmpty ? "адрес не задан" : host)" }
    init(host: String) { self.host = host }

    private func send(_ cmd: String) throws {
        let h = host.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "http://", with: "").replacingOccurrences(of: "https://", with: "")
        guard !h.isEmpty else { throw IrError(message: "Укажите адрес модуля в настройках") }
        var c = URLComponents()
        c.scheme = "http"
        c.host = h
        c.path = "/cm"
        c.queryItems = [URLQueryItem(name: "cmnd", value: cmd)]
        guard let url = c.url else { throw IrError(message: "Неверный адрес модуля") }
        var failure: Error?
        let done = DispatchSemaphore(value: 0)
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { _, _, e in failure = e; done.signal() }.resume()
        _ = done.wait(timeout: .now() + 3)
        if failure != nil { throw IrError(message: "Модуль не отвечает") }
    }

    /// Tasmota кодирует NEC сама — отправляем готовый 32-битный код.
    func sendNec(_ code: UInt32, repeatFrame: Bool) throws {
        let data = String(format: "0x%08X", code)
        try send("IRSend {\"Protocol\":\"NEC\",\"Bits\":32,\"Data\":\"\(data)\"\(repeatFrame ? ",\"Repeat\":1" : "")}")
    }
}
