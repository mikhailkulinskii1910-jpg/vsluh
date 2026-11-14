package ru.irbis.remote

import java.io.ByteArrayOutputStream

/**
 * Разбор Ducky Script в список действий и в байткод для донгла (см. SPEC 1.37).
 * Только для своих устройств: это автоввод клавиатуры и мыши.
 */
object Ducky {
    const val CTRL = 1; const val SHIFT = 2; const val ALT = 4; const val WIN = 8

    sealed class Act {
        class Text(val s: String) : Act()
        class Key(val mods: Int, val code: Int) : Act()
        class Delay(val ms: Int) : Act()
        class Move(val dx: Int, val dy: Int) : Act()
        class Click(val mask: Int, val count: Int) : Act()
        class Scroll(val n: Int) : Act()
    }

    class Result(val acts: List<Act>, val error: String?)

    /** Имя клавиши → HID usage. */
    private val KEYS: Map<String, Int> = buildMap {
        for (c in 'A'..'Z') put(c.toString(), 0x04 + (c - 'A'))
        for (n in 1..9) put(n.toString(), 0x1D + n)
        put("0", 0x27)
        for (f in 1..12) put("F$f", 0x39 + f)
        put("ENTER", 0x28); put("RETURN", 0x28); put("ESC", 0x29); put("ESCAPE", 0x29)
        put("BACKSPACE", 0x2A); put("TAB", 0x2B); put("SPACE", 0x2C)
        put("MINUS", 0x2D); put("EQUAL", 0x2E)
        put("CAPSLOCK", 0x39)
        put("PRINTSCREEN", 0x46); put("SCROLLLOCK", 0x47); put("PAUSE", 0x48)
        put("INSERT", 0x49); put("HOME", 0x4A); put("PAGEUP", 0x4B)
        put("DELETE", 0x4C); put("DEL", 0x4C); put("END", 0x4D); put("PAGEDOWN", 0x4E)
        put("RIGHT", 0x4F); put("RIGHTARROW", 0x4F); put("LEFT", 0x50); put("LEFTARROW", 0x50)
        put("DOWN", 0x51); put("DOWNARROW", 0x51); put("UP", 0x52); put("UPARROW", 0x52)
        put("MENU", 0x65); put("APP", 0x65)
    }
    private val MODS = mapOf(
        "CTRL" to CTRL, "CONTROL" to CTRL, "SHIFT" to SHIFT, "ALT" to ALT,
        "GUI" to WIN, "WINDOWS" to WIN, "WIN" to WIN, "COMMAND" to WIN, "META" to WIN)

    /** Символ пунктуации → (mods, code) для одиночных символов в GUI/CTRL-строках. */
    private fun charKey(ch: Char): Pair<Int, Int>? {
        val k = Scripts2Keys[ch.uppercaseChar()]
        if (k != null) return 0 to k
        return PUNCT[ch]
    }
    private val Scripts2Keys: Map<Char, Int> = buildMap {
        for (c in 'A'..'Z') put(c, 0x04 + (c - 'A'))
        for (n in '1'..'9') put(n, 0x1D + (n - '0'))
        put('0', 0x27)
    }
    private val PUNCT: Map<Char, Pair<Int, Int>> = mapOf(
        '-' to (0 to 0x2D), '=' to (0 to 0x2E), '[' to (0 to 0x2F), ']' to (0 to 0x30),
        ';' to (0 to 0x33), '\'' to (0 to 0x34), '`' to (0 to 0x35), ',' to (0 to 0x36),
        '.' to (0 to 0x37), '/' to (0 to 0x38), '\\' to (0 to 0x31))

    fun parse(src: String): Result {
        val acts = ArrayList<Act>()
        var defDelay = 0
        var prevLine: String? = null
        val lines = src.split("\n")
        fun tween() { if (defDelay > 0) acts += Act.Delay(defDelay) }
        for ((idx, raw) in lines.withIndex()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            val sp = line.indexOf(' ')
            val cmd = (if (sp < 0) line else line.substring(0, sp)).uppercase()
            val rest = if (sp < 0) "" else line.substring(sp + 1)
            try {
                when {
                    cmd == "REM" || line.startsWith("#") -> {}
                    cmd == "STRING" -> { acts += Act.Text(rest); tween() }
                    cmd == "STRINGLN" -> { acts += Act.Text(rest); acts += Act.Key(0, 0x28); tween() }
                    cmd == "DELAY" -> acts += Act.Delay(rest.trim().toInt().coerceIn(0, 65535))
                    cmd == "DEFAULTDELAY" || cmd == "DEFAULT_DELAY" -> defDelay = rest.trim().toInt().coerceIn(0, 65535)
                    cmd == "REPEAT" -> {
                        val n = rest.trim().toIntOrNull() ?: 1
                        val last = prevLine ?: continue
                        repeat(n.coerceIn(1, 999)) { parseOne(last, acts); tween() }
                    }
                    cmd == "MOUSE" -> { parseMouse(rest, acts); tween() }
                    else -> { parseKeyLine(line, acts); tween() }
                }
            } catch (e: Exception) {
                return Result(emptyList(), "строка ${idx + 1}: «$line»")
            }
            if (cmd != "REM" && !line.startsWith("#")) prevLine = line
        }
        return Result(acts, null)
    }

    private fun parseOne(line: String, acts: ArrayList<Act>) {
        val sp = line.indexOf(' ')
        val cmd = (if (sp < 0) line else line.substring(0, sp)).uppercase()
        val rest = if (sp < 0) "" else line.substring(sp + 1)
        when {
            cmd == "STRING" -> acts += Act.Text(rest)
            cmd == "STRINGLN" -> { acts += Act.Text(rest); acts += Act.Key(0, 0x28) }
            cmd == "DELAY" -> acts += Act.Delay(rest.trim().toInt())
            cmd == "MOUSE" -> parseMouse(rest, acts)
            else -> parseKeyLine(line, acts)
        }
    }

    private fun parseMouse(rest: String, acts: ArrayList<Act>) {
        val t = rest.trim().split(Regex("[\\s-]+"))
        when (t[0].uppercase()) {
            "MOVE" -> { var dx = t[1].toInt(); var dy = t[2].toInt()
                while (dx != 0 || dy != 0) { val sx = dx.coerceIn(-127, 127); val sy = dy.coerceIn(-127, 127); acts += Act.Move(sx, sy); dx -= sx; dy -= sy } }
            "LEFT" -> acts += Act.Click(1, 1)
            "RIGHT" -> acts += Act.Click(2, 1)
            "MIDDLE" -> acts += Act.Click(4, 1)
            "DOUBLE" -> acts += Act.Click(1, 2)
            "SCROLL" -> { var n = t[1].toInt(); while (n != 0) { val s = n.coerceIn(-127, 127); acts += Act.Scroll(s); n -= s } }
            else -> throw IllegalArgumentException()
        }
    }

    /** Строка-клавиша: модификаторы (через пробел или минус) и, опционально, одна клавиша. */
    private fun parseKeyLine(line: String, acts: ArrayList<Act>) {
        val toks = line.split(Regex("[\\s-]+")).filter { it.isNotEmpty() }
        var mods = 0; var code = 0
        for (tok in toks) {
            val m = MODS[tok.uppercase()]
            if (m != null) { mods = mods or m; continue }
            val named = KEYS[tok.uppercase()]
            if (named != null) { code = named; continue }
            if (tok.length == 1) {
                val ck = charKey(tok[0]) ?: throw IllegalArgumentException()
                mods = mods or ck.first; code = ck.second; continue
            }
            throw IllegalArgumentException()
        }
        acts += Act.Key(mods, code)
    }

    /** Байткод для хранения на плате (0x21-кусками). */
    fun bytecode(acts: List<Act>): ByteArray {
        val o = ByteArrayOutputStream()
        for (a in acts) when (a) {
            is Act.Text -> {
                val bytes = a.s.toByteArray(Charsets.UTF_8)
                var i = 0
                while (i < bytes.size) {
                    // режем на куски ≤200 байт, не разрывая UTF-8 символ
                    var end = minOf(i + 200, bytes.size)
                    while (end < bytes.size && (bytes[end].toInt() and 0xC0) == 0x80) end--
                    o.write(0x01); o.write(end - i); o.write(bytes, i, end - i); i = end
                }
            }
            is Act.Key -> { o.write(0x02); o.write(a.mods); o.write(a.code) }
            is Act.Delay -> { o.write(0x03); o.write(a.ms and 0xFF); o.write((a.ms shr 8) and 0xFF) }
            is Act.Move -> { o.write(0x04); o.write(a.dx and 0xFF); o.write(a.dy and 0xFF) }
            is Act.Click -> { o.write(0x05); o.write(a.mask); o.write(a.count) }
            is Act.Scroll -> { o.write(0x08); o.write(a.n and 0xFF) }
        }
        return o.toByteArray()
    }
}
