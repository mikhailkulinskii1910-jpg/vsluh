package ru.irbis.remote

import android.content.Context
import android.hardware.ConsumerIrManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbManager
import android.util.Log

interface IrTransmitter {
    val title: String
    /** Блокирует поток примерно на время передачи. Вызывать не из UI-потока. */
    fun transmit(pattern: IntArray)
    fun close() {}
}

/** Встроенный ИК-порт телефона (Xiaomi, Redmi, POCO, Huawei и др.). */
class BuiltinIr(context: Context) : IrTransmitter {
    private val ir = context.getSystemService(Context.CONSUMER_IR_SERVICE) as ConsumerIrManager?
    val available get() = ir?.hasIrEmitter() == true
    override val title = "Встроенный ИК-порт"

    override fun transmit(pattern: IntArray) {
        ir!!.transmit(Nec.CARRIER, pattern)
    }
}

/**
 * USB-C ИК-передатчик (VID 0x045E / 0x10C4, PID 0x8468) — тот, что продаётся как «IR remote Type-C».
 *
 * Протокол: HID-подобные пакеты по bulk-эндпоинту, до 56 байт данных в пакете:
 *   [0x02, len+3, seq(1..15), всего пакетов, номер пакета (с 1)] + данные.
 * Данные команды: "ST", n(1..127), 'D', 0, длительности, "EN".
 * Длительность — в единицах по 16 мкс, кусками до 127; у меток (чётные индексы) старший бит = 1.
 * Несущая у донгла фиксированная, 38 кГц.
 */
class UsbIr(private val conn: UsbDeviceConnection, private val out: UsbEndpoint, private val inp: UsbEndpoint?) : IrTransmitter {
    override val title = "USB-C ИК-передатчик"
    private var seq = 1      // 1..15, на каждое сообщение
    private var cmd = 0      // 1..127, на каждую команду
    private val rx = ByteArray(64)

    init {
        // Приветствие "ST" n "SEN" — после него донгл принимает команды.
        send(listOf(byteArrayOf('S'.b, 'T'.b, nextCmd(), 'S'.b, 'E'.b, 'N'.b)))
    }

    override fun transmit(pattern: IntArray) {
        val p = pattern.copyOf()
        if (p.size % 2 == 0) { val last = p.last(); p[p.size - 1] = if (last > 3000) last - 3000 else 10 }

        val data = ArrayList<Byte>(p.size + 8)
        data += 'S'.b; data += 'T'.b; data += nextCmd(); data += 'D'.b; data += 0
        p.forEachIndexed { i, us ->
            var units = us / 16
            while (units > 0) {
                val part = minOf(units, 127)
                units -= part
                data += (if (i % 2 == 0) part or 0x80 else part).toByte()
            }
        }
        data += 'E'.b; data += 'N'.b
        send(data.chunked(56).map { it.toByteArray() })
        Thread.sleep(p.sum() / 1000L + 2)
    }

    private fun send(chunks: List<ByteArray>) {
        seq = if (seq < 15) seq + 1 else 1
        chunks.forEachIndexed { i, chunk ->
            val pkt = byteArrayOf(2, (chunk.size + 3).toByte(), seq.toByte(), chunks.size.toByte(), (i + 1).toByte()) + chunk
            val n = conn.bulkTransfer(out, pkt, pkt.size, 250)
            if (n < 0) throw IllegalStateException("USB-передатчик не принял данные")
        }
        // Донгл отвечает подтверждением — вычитываем, чтобы буфер не переполнился.
        if (inp != null) while (conn.bulkTransfer(inp, rx, rx.size, 15) > 0) Unit
    }

    private fun nextCmd(): Byte { cmd = if (cmd < 127) cmd + 1 else 1; return cmd.toByte() }

    override fun close() = conn.close()

    companion object {
        private val IDS = setOf(0x045E to 0x8468, 0x10C4 to 0x8468)
        fun supports(d: UsbDevice) = (d.vendorId to d.productId) in IDS

        /** Есть ли у устройства bulk/interrupt OUT — тогда его можно попробовать как ИК-передатчик. */
        fun canTry(d: UsbDevice) = d.interfaceCount > 0 && (0 until d.getInterface(0).endpointCount).any {
            val ep = d.getInterface(0).getEndpoint(it)
            ep.direction == UsbConstants.USB_DIR_OUT &&
                (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK || ep.type == UsbConstants.USB_ENDPOINT_XFER_INT)
        }

        fun open(usb: UsbManager, d: UsbDevice): UsbIr? {
            val itf = d.getInterface(0)
            var out: UsbEndpoint? = null
            var inp: UsbEndpoint? = null
            for (i in 0 until itf.endpointCount) {
                val ep = itf.getEndpoint(i)
                if (ep.type != UsbConstants.USB_ENDPOINT_XFER_BULK && ep.type != UsbConstants.USB_ENDPOINT_XFER_INT) continue
                if (ep.direction == UsbConstants.USB_DIR_OUT) out = ep else inp = ep
            }
            if (out == null) { Log.e("UsbIr", "нет OUT-эндпоинта"); return null }
            val conn = usb.openDevice(d) ?: return null
            if (!conn.claimInterface(itf, true)) { conn.close(); return null }
            return UsbIr(conn, out, inp)
        }
    }
}

/**
 * ИК-адаптер, который работает как звуковая карта: в разъём наушников или USB-C «звуковой» донгл.
 * Как в IrCode Finder: 48 кГц, синус на половине несущей (19 кГц); при двух светодиодах
 * правый канал в противофазе — встречно включённые светодиоды дают 38 кГц.
 */
class AudioIr(private val context: Context, private val twoLeds: Boolean) : IrTransmitter {
    override val title = if (twoLeds) "Звуковой ИК-адаптер (2 светодиода)" else "Звуковой ИК-адаптер (1 светодиод)"
    private val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    override fun transmit(pattern: IntArray) {
        // Адаптеру нужна полная громкость, иначе светодиоды не загораются.
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        if (am.getStreamVolume(AudioManager.STREAM_MUSIC) < max) am.setStreamVolume(AudioManager.STREAM_MUSIC, max, 0)

        val pcm = render(pattern)
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(if (twoLeds) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO).build())
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size * 2)
            .build()
        try {
            adapterOutput(am)?.let { track.setPreferredDevice(it) }
            track.write(pcm, 0, pcm.size)
            track.play()
            Thread.sleep(pcm.size * 1000L / RATE / (if (twoLeds) 2 else 1) + 30)
            track.stop()
        } finally {
            track.release()
        }
    }

    private fun render(pattern: IntArray): ShortArray {
        val ch = if (twoLeds) 2 else 1
        val out = ArrayList<Short>(RATE / 5 * ch)
        repeat(LEAD_IN * ch) { out += 0 }   // тишина в начале, чтобы звуковой тракт успел включиться
        val step = 2 * Math.PI * (Nec.CARRIER / 2) / RATE
        pattern.forEachIndexed { i, us ->
            val n = us.toLong() * RATE / 1_000_000
            if (i % 2 == 0) {
                var ph = 0.0
                repeat(n.toInt()) {
                    out += (Math.sin(ph) * 32000).toInt().toShort()
                    if (twoLeds) out += (Math.sin(ph + Math.PI) * 32000).toInt().toShort()
                    ph += step
                }
            } else repeat((n * ch).toInt()) { out += 0 }
        }
        return out.toShortArray()
    }

    companion object {
        const val RATE = 48000
        private const val LEAD_IN = RATE / 50   // 20 мс

        /** Подключённый USB-звуковой выход (USB-C донгл, который система видит как наушники). */
        fun adapterOutput(am: AudioManager): AudioDeviceInfo? = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull {
            it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_DEVICE ||
                it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET
        }
    }
}

private val Char.b get() = code.toByte()
