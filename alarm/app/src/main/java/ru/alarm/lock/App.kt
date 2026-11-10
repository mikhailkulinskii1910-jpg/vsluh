package ru.alarm.lock

import android.app.Application
import android.content.Context
import java.io.File

/** Сохраняет текст последнего сбоя, чтобы его можно было посмотреть и отправить. */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { crashFile(this).writeText(error.stackTraceToString()) }
            previous?.uncaughtException(thread, error)
        }
    }
}

fun crashFile(context: Context): File = File(context.filesDir, "crash.txt")
