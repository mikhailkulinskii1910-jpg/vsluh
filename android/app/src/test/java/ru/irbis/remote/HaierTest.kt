package ru.irbis.remote

import org.junit.Assert.assertArrayEquals
import org.junit.Test

/** Кадры Haier сверяются с настоящими сообщениями пультов из тестов IRremoteESP8266. */
class HaierTest {
    private fun ints(vararg b: Int) = b

    @Test
    fun yrw02CoolMinTemp() {
        // охлаждение, 16°, скорость высокая, жалюзи «середина», кнопка «температура вниз»
        val s = Haier.State(model = 0, power = true, mode = Haier.Mode.COOL, temp = 16, fan = Haier.Fan.HIGH,
            swing = false, vane = Haier.Vane.MIDDLE)
        assertArrayEquals(ints(0xA6, 0x02, 0x00, 0x02, 0x40, 0x20, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x01, 0x2B),
            Haier.bytes(s, Haier.Button.TEMP_DOWN))
    }

    @Test
    fun ac176SecondBlock() {
        // второй блок пульта V9014557: B7, скорость «авто» → 0, контрольная сумма B7
        val b = Haier.bytes(Haier.State(model = 1, fan = Haier.Fan.AUTO), Haier.Button.POWER)
        assertArrayEquals(ints(0xB7, 0, 0, 0, 0, 0, 0, 0xB7), b.copyOfRange(14, 22))
    }
}
