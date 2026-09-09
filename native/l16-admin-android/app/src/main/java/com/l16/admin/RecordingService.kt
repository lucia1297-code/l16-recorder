package com.l16.admin

import android.app.*
import android.content.Intent
import android.media.MediaRecorder
import android.os.IBinder
import java.io.File
import java.io.FileWriter
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class RecordingService : Service() {
    private var recorder: MediaRecorder? = null
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private var rotation: ScheduledFuture<*>? = null
    private var index = 0
    private var currentFile: File? = null
    private var segmentStartedAt = 0L
    private val studentCode by lazy { getSharedPreferences("l16", MODE_PRIVATE).getString("student_code", "") ?: "" }
    override fun onCreate() { super.onCreate(); createChannel(); startForeground(41, notification("녹음 준비")); startSegment(); rotation = executor.scheduleAtFixedRate({ rotate() }, 2, 2, TimeUnit.MINUTES) }
    private fun startSegment() { val file = File(getExternalFilesDir(null), "recordings/segment-${System.currentTimeMillis()}-${index++}.m4a"); file.parentFile?.mkdirs(); segmentStartedAt = System.currentTimeMillis(); currentFile = file; recorder = MediaRecorder().apply { setAudioSource(MediaRecorder.AudioSource.MIC); setOutputFormat(MediaRecorder.OutputFormat.MPEG_4); setAudioEncoder(MediaRecorder.AudioEncoder.AAC); setAudioEncodingBitRate(64000); setAudioSamplingRate(44100); setOutputFile(file); prepare(); start() }; update("녹음 중 — ${file.name}") }
    private fun finishSegment() { val file = currentFile; try { recorder?.stop() } catch (_: Exception) {}; recorder?.release(); recorder = null; currentFile = null; if (file?.exists() == true) { appendManifest(file, segmentStartedAt, System.currentTimeMillis()); executor.execute { SegmentUploader.upload(file, studentCode) } } }
    private fun rotate() { finishSegment(); startSegment() }
    override fun onDestroy() { rotation?.cancel(true); finishSegment(); executor.shutdownNow(); super.onDestroy() }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    private fun createChannel() { getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("recording", "수업 녹음", NotificationManager.IMPORTANCE_LOW)) }
    private fun notification(text: String) = Notification.Builder(this, "recording").setContentTitle("L16 관리자 녹음").setContentText(text).setSmallIcon(android.R.drawable.ic_btn_speak_now).setOngoing(true).build()
    private fun update(text: String) { getSystemService(NotificationManager::class.java).notify(41, notification(text)) }
    private fun appendManifest(file: File, startedAt: Long, endedAt: Long) {
        val manifest = File(file.parentFile, "segments.jsonl")
        val durationSec = ((endedAt - startedAt).coerceAtLeast(0L) / 1000.0)
        val line = String.format(Locale.US, "{\"file\":\"%s\",\"started_at\":%d,\"ended_at\":%d,\"duration_sec\":%.3f,\"bytes\":%d}\n", file.name, startedAt, endedAt, durationSec, file.length())
        runCatching { FileWriter(manifest, true).use { it.write(line) } }
    }
}
