import AVFoundation
import Foundation

/**
 Работа при выключенном экране (1.31). Пока идёт сценарий, макрос или авто-сканер, приложение
 непрерывно играет тишину (фоновый режим «audio» в Info.plist) — iOS не усыпляет его при блокировке,
 и ИК-кадры звукового адаптера / запросы к Tasmota продолжают уходить. По окончании тишина
 останавливается и сессия отпускается. Звонок прерывает звук — после него всё продолжается.
 */
final class KeepAlive {
    static let shared = KeepAlive()

    /// Вызывается (в главном потоке), когда прерывание звонком закончилось и работа продолжается.
    var onResume: (() -> Void)?

    private var users = 0
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private let lock = NSLock()
    private var interrupted = false

    private init() {
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            self?.interruption(n)
        }
    }

    /// Идёт ли прерывание (звонок) — передача ждёт его окончания. Можно читать из любого потока.
    var isInterrupted: Bool {
        lock.lock(); defer { lock.unlock() }
        return interrupted
    }

    private func setInterrupted(_ v: Bool) {
        lock.lock(); interrupted = v; lock.unlock()
    }

    /// Начать фоновую работу (вызывать в главном потоке; вызовы считаются).
    func begin() {
        users += 1
        if users == 1 { startSilence() }
    }

    /// Закончить фоновую работу; когда никто не работает — тишина останавливается.
    func end() {
        if users == 0 { return }
        users -= 1
        if users == 0 { stopSilence() }
    }

    private func activateSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? s.setActive(true)
    }

    private func startSilence() {
        activateSession()
        let e = AVAudioEngine()
        let p = AVAudioPlayerNode()
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2),
              let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100) else { return }
        buf.frameLength = 44_100                       // секунда нулей, играется по кругу
        if let ch = buf.floatChannelData {
            for c in 0..<Int(format.channelCount) {
                for i in 0..<Int(buf.frameLength) { ch[c][i] = 0 }
            }
        }
        e.attach(p)
        e.connect(p, to: e.mainMixerNode, format: format)
        do {
            try e.start()
        } catch {
            return
        }
        p.scheduleBuffer(buf, at: nil, options: .loops, completionHandler: nil)
        p.play()
        engine = e
        player = p
    }

    private func stopSilence() {
        player?.stop()
        engine?.stop()
        player = nil
        engine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func interruption(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            if users > 0 { setInterrupted(true) }
            return
        }
        let wasInterrupted: Bool = isInterrupted
        setInterrupted(false)
        if users > 0 {
            // звонок закончился — снова включить сессию и тишину и продолжить
            player?.stop()
            engine?.stop()
            player = nil
            engine = nil
            startSilence()
            if wasInterrupted { onResume?() }
        }
    }
}
