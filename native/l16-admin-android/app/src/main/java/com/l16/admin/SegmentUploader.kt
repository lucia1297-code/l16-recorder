package com.l16.admin

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

object SegmentUploader {
    fun upload(file: File, studentCode: String): Boolean {
        val base = BuildConfig.SUPABASE_URL.trimEnd('/')
        val key = BuildConfig.SUPABASE_ANON_KEY
        if (base.isBlank() || key.isBlank() || studentCode.isBlank()) return false
        val path = "android/${studentCode}/${UUID.randomUUID()}-${file.name}"
        val conn = (URL("$base/storage/v1/object/lesson-recordings/$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 120_000
            setRequestProperty("apikey", key)
            setRequestProperty("Authorization", "Bearer $key")
            setRequestProperty("Content-Type", "audio/mp4")
            setRequestProperty("x-upsert", "false")
        }
        return runCatching {
            file.inputStream().use { input -> conn.outputStream.use { output -> input.copyTo(output) } }
            conn.responseCode in 200..299
        }.getOrDefault(false).also { conn.disconnect() }
    }
}
