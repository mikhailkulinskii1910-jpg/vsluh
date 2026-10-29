package ru.random.wheel

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.random.Random

class PickerTest {
    @Test fun equalWhenNotRigged() {
        assertArrayEquals(doubleArrayOf(0.25, 0.25, 0.25, 0.25), Picker.probabilities(listOf(100, 0, 5, 50), false), 1e-9)
    }

    @Test fun equalWhenAllZero() {
        assertArrayEquals(doubleArrayOf(0.5, 0.5), Picker.probabilities(listOf(0, 0), true), 1e-9)
    }

    @Test fun normalized() {
        assertArrayEquals(doubleArrayOf(0.75, 0.25, 0.0), Picker.probabilities(listOf(75, 25, 0), true), 1e-9)
    }

    @Test fun zeroNeverWins_hundredAlwaysWins() {
        val rnd = Random(1)
        repeat(10_000) { assertEquals(1, Picker.pick(listOf(0, 100, 0), true, rnd.nextDouble())) }
        assertEquals(1, Picker.pick(listOf(0, 100, 0), true, 0.9999999999))
    }

    @Test fun distributionFollowsWeights() {
        val rnd = Random(42)
        val hits = IntArray(3)
        val n = 200_000
        repeat(n) { hits[Picker.pick(listOf(60, 30, 10), true, rnd.nextDouble())]++ }
        assertEquals(0.6, hits[0].toDouble() / n, 0.01)
        assertEquals(0.3, hits[1].toDouble() / n, 0.01)
        assertEquals(0.1, hits[2].toDouble() / n, 0.01)
    }
}
