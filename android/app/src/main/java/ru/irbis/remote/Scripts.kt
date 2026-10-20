package ru.irbis.remote

import org.json.JSONArray
import org.json.JSONObject

/**
 * Сценарии (вкладка «Сценарии»): программа из блоков, как в Scratch.
 * Блоки идут списком; цикл — пара блоков «цикл ×N» … «конец цикла» (циклы можно вкладывать).
 * Команда относится к устройству из ближайшего блока «устройство» выше неё.
 */
object Scripts {
    /** Устройства, которые можно выбрать в блоке «устройство». */
    class Device(val title: String, val keys: List<Pair<String, Long>>, val acModel: Int = -1)

    /** Команды IRBIS, найденные сканером (подпись, код NEC) — добавляются к 12 известным. */
    var irbisFound: List<Pair<String, Long>> = emptyList()

    val DEVICES: List<Device> get() =
        listOf(Device("Доска · IRBIS", KEYS + irbisFound), Device("Доска · MocTec", MOC_KEYS)) +
            PROJECTORS.map { Device("Проектор · ${it.brand}", it.keys) } +
            Haier.MODELS.mapIndexed { i, m -> Device("Кондиционер · Haier ${i + 1} $m", emptyList(), acModel = i) }

    sealed class Block {
        class Dev(var device: Int) : Block()
        class Cmd(var label: String, var code: Long) : Block()
        /** Команда кондиционеру: состояние целиком. */
        class Ac(var power: Boolean = true, var mode: Haier.Mode = Haier.Mode.COOL, var temp: Int = 24, var fan: Haier.Fan = Haier.Fan.AUTO) : Block()
        class Delay(var sec: Double) : Block()
        class Loop(var times: Int) : Block()
        object End : Block()
    }

    /** [pin] — сценарий вынесен кнопкой-макросом на пульт IRBIS («Мои кнопки»). */
    class Script(var name: String, val blocks: MutableList<Block> = ArrayList(), var pin: Boolean = false)

    /** Пример для первого запуска: выключить проектор NEC (два нажатия POWER) и доску MocTec. */
    fun example(): Script {
        val nec = PROJECTORS[0].keys.first { it.first == "POWER" }
        val moc = MOC_KEYS.first { it.first == "POWER" }
        return Script("Конец урока", mutableListOf(
            Block.Dev(2), Block.Cmd(nec.first, nec.second), Block.Delay(1.5), Block.Cmd(nec.first, nec.second),
            Block.Delay(2.0), Block.Dev(1), Block.Cmd(moc.first, moc.second)))
    }

    /** Готовые макросы для пульта IRBIS — создаются один раз, их можно менять и удалять. */
    fun presets(): List<Script> {
        fun k(name: String) = KEYS.first { it.first == name }.let { Block.Cmd(it.first, it.second) }
        return listOf(
            Script("Тихо", mutableListOf(Block.Dev(0), Block.Loop(20), k("VOL-"), Block.End), pin = true),
            Script("Громче +5", mutableListOf(Block.Dev(0), Block.Loop(5), k("VOL+"), Block.End), pin = true),
            Script("Пауза урока", mutableListOf(Block.Dev(0), k("FREEZE"), Block.Delay(0.5), k("EMPY SCREEN")), pin = true),
            Script("Следующий вход", mutableListOf(Block.Dev(0), k("INPUT"), Block.Delay(1.0), k("J DOWN"), Block.Delay(0.5), k("J OK")), pin = true),
        )
    }

    /** Код NEC: адрес (16 бит), команда, инверсия команды. */
    fun nec(addr: Int, cmd: Int): Long = ((addr.toLong() and 0xFFFF) shl 16) or ((cmd.toLong() and 0xFF) shl 8) or (cmd.inv() and 0xFF).toLong()

    /** Подпись известного кода из всех пультов приложения, или null. */
    fun knownLabel(code: Long): String? =
        (KEYS + irbisFound).firstOrNull { it.second == code }?.first?.let { "IRBIS $it" }
            ?: MOC_KEYS.firstOrNull { it.second == code }?.first?.let { "MocTec $it" }
            ?: PROJECTORS.firstNotNullOfOrNull { p -> p.keys.firstOrNull { it.second == code }?.first?.let { "${p.brand} $it" } }

    fun keysToJson(k: List<Pair<String, Long>>): String = JSONArray().apply { k.forEach { put(JSONObject().put("l", it.first).put("c", it.second)) } }.toString()
    fun keysFromJson(json: String?): List<Pair<String, Long>> = runCatching {
        val a = JSONArray(json ?: return emptyList())
        (0 until a.length()).map { a.getJSONObject(it).let { o -> o.getString("l") to o.getLong("c") } }
    }.getOrDefault(emptyList())

    /** Устройство, к которому относится блок номер [at] (ближайший «устройство» выше), или -1. */
    fun deviceAt(s: Script, at: Int): Int {
        for (i in at downTo 0) (s.blocks.getOrNull(i) as? Block.Dev)?.let { return it.device }
        return -1
    }

    /** Глубина вложенности циклов перед блоком [at] — для отступа в списке. */
    fun depthAt(s: Script, at: Int): Int {
        var d = 0
        for (i in 0 until at) when (s.blocks[i]) { is Block.Loop -> d++; Block.End -> d = maxOf(0, d - 1); else -> {} }
        return if (s.blocks.getOrNull(at) == Block.End) maxOf(0, d - 1) else d
    }

    /** Конец блока [i]: для цикла — индекс его «конца цикла» (или последний блок), иначе сам [i]. */
    fun rangeEnd(s: Script, i: Int): Int {
        if (s.blocks.getOrNull(i) !is Block.Loop) return i
        var d = 0
        for (k in i + 1 until s.blocks.size) when (s.blocks[k]) {
            is Block.Loop -> d++
            Block.End -> if (d == 0) return k else d--
            else -> {}
        }
        return s.blocks.size - 1
    }

    /** Перенести блок [from] (цикл — вместе с содержимым) так, чтобы он встал перед позицией [to] исходного списка. */
    fun move(s: Script, from: Int, to: Int): Boolean {
        val end = rangeEnd(s, from)
        if (to in from..end + 1) return false           // на то же место или внутрь самого себя
        val part = ArrayList(s.blocks.subList(from, end + 1))
        repeat(part.size) { s.blocks.removeAt(from) }
        val at = if (to > end) to - part.size else to
        s.blocks.addAll(at, part)
        return true
    }

    /** Удалить блок [i] (цикл — вместе с содержимым). */
    fun remove(s: Script, i: Int) { val end = rangeEnd(s, i); repeat(end - i + 1) { s.blocks.removeAt(i) } }

    fun text(b: Block, s: Script? = null): String = when (b) {
        is Block.Dev -> "→ " + (DEVICES.getOrNull(b.device)?.title ?: "?")
        is Block.Cmd -> "▶ " + b.label
        is Block.Ac -> "▶ " + (if (b.power) "вкл, ${b.mode.title}, ${b.temp}°, скорость ${b.fan.title}" else "выключить")
        is Block.Delay -> "задержка " + fmt(b.sec) + " с"
        is Block.Loop -> "цикл ×${b.times} {"
        Block.End -> "} конец цикла"
    }

    fun fmt(x: Double) = if (x == Math.floor(x)) x.toInt().toString() else ("%.1f".format(java.util.Locale.US, x))

    /* ---------- хранение: JSON ---------- */

    fun toJson(list: List<Script>): String = JSONArray().apply {
        list.forEach { s ->
            put(JSONObject().put("name", s.name).put("pin", s.pin).put("blocks", JSONArray().apply {
                s.blocks.forEach { b ->
                    put(when (b) {
                        is Block.Dev -> JSONObject().put("t", "dev").put("d", b.device)
                        is Block.Cmd -> JSONObject().put("t", "cmd").put("l", b.label).put("c", b.code)
                        is Block.Ac -> JSONObject().put("t", "ac").put("p", b.power).put("m", b.mode.name).put("x", b.temp).put("f", b.fan.name)
                        is Block.Delay -> JSONObject().put("t", "delay").put("s", b.sec)
                        is Block.Loop -> JSONObject().put("t", "loop").put("n", b.times)
                        Block.End -> JSONObject().put("t", "end")
                    })
                }
            }))
        }
    }.toString()

    fun fromJson(json: String?): MutableList<Script> {
        val out = ArrayList<Script>()
        if (json == null) return out
        runCatching {
            val a = JSONArray(json)
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i); val bl = o.getJSONArray("blocks"); val s = Script(o.getString("name"), pin = o.optBoolean("pin"))
                for (k in 0 until bl.length()) {
                    val b = bl.getJSONObject(k)
                    s.blocks += when (b.getString("t")) {
                        "dev" -> Block.Dev(b.getInt("d"))
                        "cmd" -> Block.Cmd(b.getString("l"), b.getLong("c"))
                        "ac" -> Block.Ac(b.getBoolean("p"), Haier.Mode.valueOf(b.getString("m")), b.getInt("x"), Haier.Fan.valueOf(b.getString("f")))
                        "delay" -> Block.Delay(b.getDouble("s"))
                        "loop" -> Block.Loop(b.getInt("n"))
                        else -> Block.End
                    }
                }
                out += s
            }
        }
        return out
    }

    /**
     * Выполнение. [send] — отправить ИК-кадр (мкс), [mark] — подсветить блок, [stopped] — нажата «Стоп».
     * Циклы разворачиваются по парам «цикл»/«конец»; незакрытый цикл длится до конца сценария.
     */
    fun run(s: Script, send: (IntArray, String) -> Unit, mark: (Int) -> Unit, stopped: () -> Boolean) {
        var device = -1
        fun matchEnd(from: Int): Int {
            var d = 0
            for (i in from + 1 until s.blocks.size) when (s.blocks[i]) {
                is Block.Loop -> d++
                Block.End -> if (d == 0) return i else d--
                else -> {}
            }
            return s.blocks.size
        }
        fun exec(from: Int, to: Int) {
            var i = from
            while (i < to && !stopped()) {
                mark(i)
                when (val b = s.blocks[i]) {
                    is Block.Dev -> device = b.device
                    is Block.Cmd -> send(Nec.withGap(Nec.frame(b.code)), "0x%08X %s".format(b.code, b.label))
                    is Block.Ac -> {
                        val model = DEVICES.getOrNull(device)?.acModel?.takeIf { it >= 0 } ?: 0
                        val st = Haier.State(model = model, power = b.power, mode = b.mode, temp = b.temp, fan = b.fan)
                        val bytes = Haier.bytes(st, Haier.Button.POWER)
                        send(Haier.pattern(bytes), "haier " + Haier.hex(bytes))
                    }
                    is Block.Delay -> {
                        var left = (b.sec * 1000).toLong()
                        while (left > 0 && !stopped()) { val step = minOf(left, 100L); Thread.sleep(step); left -= step }
                    }
                    is Block.Loop -> {
                        val end = matchEnd(i)
                        repeat(b.times.coerceIn(1, 999)) { if (!stopped()) exec(i + 1, end) }
                        i = end
                    }
                    Block.End -> {}
                }
                if (s.blocks.getOrNull(i) is Block.Cmd || s.blocks.getOrNull(i) is Block.Ac) Thread.sleep(150)   // пауза между командами
                i++
            }
        }
        exec(0, s.blocks.size)
    }
}
