package com.l16.admin

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.l16.admin.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        val permissions = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }.filter { ContextCompat.checkSelfPermission(this@MainActivity, it) != PackageManager.PERMISSION_GRANTED }
        if (permissions.isNotEmpty()) ActivityCompat.requestPermissions(this, permissions.toTypedArray(), 10)
        binding.start.setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 10)
                return@setOnClickListener
            }
            getSharedPreferences("l16", MODE_PRIVATE).edit().putString("student_code", binding.studentCode.text.toString().trim()).apply()
            ContextCompat.startForegroundService(this, Intent(this, RecordingService::class.java))
            binding.status.text = "녹음 중 — 화면을 꺼도 계속 저장합니다"
            binding.start.isEnabled = false
            binding.stop.isEnabled = true
        }
        binding.stop.setOnClickListener { stopService(Intent(this, RecordingService::class.java)); binding.status.text = "저장 완료"; binding.start.isEnabled = true; binding.stop.isEnabled = false }
    }
}
