package ru.irbis.remote

import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Сценарии: циклы разворачиваются, сценарий сохраняется в JSON и читается обратно (org.json — из Robolectric). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ScriptsTest {
    @Test
    fun scriptRunsLoopsAndJson() {
        // цикл ×2 { POWER } + задержка: должно уйти два кадра; сценарий переживает JSON
        val s = Scripts.Script("t", mutableListOf(Scripts.Block.Dev(0), Scripts.Block.Loop(2), Scripts.Block.Cmd("POWER", 0x807F18E7L),
            Scripts.Block.End, Scripts.Block.Delay(0.1)))
        val back = Scripts.fromJson(Scripts.toJson(listOf(s)))[0]
        var sent = 0
        Scripts.run(back, send = { _, _ -> sent++ }, mark = {}, stopped = { false })
        org.junit.Assert.assertEquals(2, sent)
        org.junit.Assert.assertEquals(5, back.blocks.size)
    }


    @Test
    fun moveAndRemoveKeepLoopsTogether() {
        // [dev, loop, cmd, end, delay] — переносим цикл (с телом) в конец, затем удаляем его целиком
        val s = Scripts.Script("m", mutableListOf(Scripts.Block.Dev(0), Scripts.Block.Loop(2), Scripts.Block.Cmd("A", 1), Scripts.Block.End, Scripts.Block.Delay(1.0)))
        org.junit.Assert.assertTrue(Scripts.move(s, 1, 5))
        org.junit.Assert.assertTrue(s.blocks[1] is Scripts.Block.Delay && s.blocks[2] is Scripts.Block.Loop && s.blocks[4] == Scripts.Block.End)
        org.junit.Assert.assertFalse(Scripts.move(s, 2, 3))          // внутрь самого себя нельзя
        Scripts.remove(s, 2)
        org.junit.Assert.assertEquals(2, s.blocks.size)
    }
}
