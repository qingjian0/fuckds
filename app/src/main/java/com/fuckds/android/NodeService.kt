package com.fuckds.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class NodeService : Service() {
    private val started = AtomicBoolean(false)

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "fuckds local service", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, notification())
        if (started.compareAndSet(false, true)) {
            Thread({ prepareAndStartNode() }, "fuckds-node-bootstrap").start()
        }
        return START_STICKY
    }

    private fun prepareAndStartNode() {
        try {
            val engineDir = File(noBackupFilesDir, "engine")
            val marker = File(noBackupFilesDir, "engine-version")
            val version = BuildConfig.VERSION_CODE.toString()
            val persistentConfig = File(filesDir, "config").apply { mkdirs() }
            val envBackup = File(persistentConfig, ".env")
            val previousEnv = File(engineDir, ".env")
            if (!marker.exists() || marker.readText() != version ||
                !File(engineDir, "src/index.mjs").isFile) {
                // The existing admin API writes its .env beside the engine. Preserve it
                // before replacing immutable bundled assets during an APK upgrade.
                if (previousEnv.isFile) previousEnv.copyTo(envBackup, overwrite = true)
                engineDir.deleteRecursively()
                copyAssetTree("engine", engineDir)
                check(File(engineDir, "src/index.mjs").isFile) { "Bundled src/index.mjs missing" }
                if (envBackup.isFile) envBackup.copyTo(File(engineDir, ".env"), overwrite = true)
                marker.writeText(version)
            }

            val dataDir = File(filesDir, "data").apply { mkdirs() }
            val homeDir = File(noBackupFilesDir, "home").apply { mkdirs() }
            val tempDir = File(cacheDir, "tmp").apply { mkdirs() }
            val compileCache = File(cacheDir, "node-compile-cache").apply { mkdirs() }
            val apiKey = loadOrCreateKey("api.key")
            val adminKey = loadOrCreateKey("admin.key")
            val engineMode = readEnvValue(File(engineDir, ".env"), "ENGINE") ?: "auto"
            val args = arrayOf("node", File(engineDir, "src/index.mjs").absolutePath)
            val env = arrayOf(
                "FUCKDS_ENGINE_DIR=${engineDir.absolutePath}",
                "DATA_DIR=${dataDir.absolutePath}",
                "HOME=${homeDir.absolutePath}",
                "TMPDIR=${tempDir.absolutePath}",
                "NODE_COMPILE_CACHE=${compileCache.absolutePath}",
                "NODE_COMPILE_CACHE_PORTABLE=1",
                "UV_THREADPOOL_SIZE=2",
                "HOST=127.0.0.1",
                "PORT=8787",
                "ENGINE=$engineMode",
                "WARMUP=false",
                "API_KEY=$apiKey",
                "ADMIN_API_KEY=$adminKey"
            )
            Log.i(TAG, "Starting embedded Node from ${engineDir.absolutePath}")
            val exit = NodeBridge.startNodeWithArguments(args, env)
            Log.w(TAG, "Node event loop exited: $exit")
        } catch (error: Throwable) {
            Log.e(TAG, "Node startup failed", error)
        }
    }

    private fun readEnvValue(file: File, key: String): String? {
        if (!file.isFile) return null
        val prefix = "$key="
        return file.useLines { lines ->
            lines.map { it.trim() }
                .firstOrNull { it.startsWith(prefix) && !it.startsWith("#") }
                ?.substringAfter("=", "")
                ?.trim()
                ?.removeSurrounding("\\\"")
                ?.removeSurrounding("'")
        }
    }

    private fun loadOrCreateKey(fileName: String): String {
        val keyFile = File(filesDir, fileName)
        if (keyFile.isFile) return keyFile.readText().trim()
        val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        val key = bytes.joinToString("") { "%02x".format(it) }
        keyFile.writeText(key)
        return key
    }

    private fun copyAssetTree(source: String, target: File) {
        val entries = assets.list(source) ?: emptyArray()
        if (entries.isEmpty()) {
            target.parentFile?.mkdirs()
            assets.open(source).use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            }
            return
        }
        target.mkdirs()
        for (entry in entries) copyAssetTree("$source/$entry", File(target, entry))
    }

    private fun notification(): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = android.app.PendingIntent.getActivity(
            this, 0, launch, android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
                .setContentTitle("fuckds")
                .setContentText("本机 API 服务正在运行")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentIntent(pending)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("fuckds")
                .setContentText("本机 API 服务正在运行")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentIntent(pending)
                .setOngoing(true)
                .build()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "fuckds-node"
        private const val CHANNEL = "fuckds-local-server"
        private const val NOTIFICATION_ID = 8701
    }
}
