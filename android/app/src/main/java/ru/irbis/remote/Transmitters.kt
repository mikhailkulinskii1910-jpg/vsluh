package ru.irbis.remote

import android.content.Context
import android.hardware.ConsumerIrManager
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

private val Char.b get() = code.toByte()
