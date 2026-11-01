package com.fuckds.android

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var webView: WebView
    private lateinit var status: TextView
    private lateinit var adminKey: String
    private lateinit var apiKey: String
    @Volatile private var destroyed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(17, 24, 32)
        window.navigationBarColor = Color.rgb(17, 24, 32)

        adminKey = ensureKey("admin.key")
        apiKey = ensureKey("api.key")
        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(17, 24, 32))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    return !(uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == PORT)
                }
            }
        }

        status = TextView(this).apply {
            text = "正在启动本机 Node.js 服务…"
            textSize = 16f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(17, 24, 32))
            gravity = android.view.Gravity.CENTER
        }
        val root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        root.addView(status, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        val serviceIntent = Intent(this, NodeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(serviceIntent)
        else startService(serviceIntent)
        waitForServer()
    }

    private fun ensureKey(fileName: String): String {
        val file = java.io.File(filesDir, fileName)
        if (file.isFile) return file.readText().trim()
        val bytes = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        val key = bytes.joinToString("") { "%02x".format(it) }
        file.writeText(key)
        return key
    }

    private fun showAdminKeyIfNeeded() {
        val acknowledged = java.io.File(filesDir, "admin-key-ack")
        if (acknowledged.exists()) return
        AlertDialog.Builder(this)
            .setTitle("本机管理密钥")
            .setMessage("请复制并妥善保存以下两把独立密钥。\n\nADMIN_API_KEY（账号与配置管理）：\n$adminKey\n\nAPI_KEY（OpenAI/Anthropic 客户端调用）：\n$apiKey")
            .setPositiveButton("复制并继续") { _, _ ->
                val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("fuckds API keys", "ADMIN_API_KEY=$adminKey\nAPI_KEY=$apiKey"))
                acknowledged.writeText("1")
            }
            .setNegativeButton("稍后", null)
            .show()
    }

    private fun waitForServer() {
        executor.execute {
            repeat(240) {
                if (destroyed) return@execute
                if (isServerReady()) {
                    handler.post {
                        if (!destroyed) {
                            status.visibility = View.GONE
                            webView.loadUrl("http://127.0.0.1:$PORT/app")
                            showAdminKeyIfNeeded()
                        }
                    }
                    return@execute
                }
                Thread.sleep(500)
            }
            handler.post { if (!destroyed) status.text = "服务启动超时，请查看应用日志。" }
        }
    }

    private fun isServerReady(): Boolean = try {
        (URL("http://127.0.0.1:$PORT/healthz").openConnection() as HttpURLConnection).run {
            connectTimeout = 700
            readTimeout = 700
            requestMethod = "GET"
            responseCode in 200..299
        }
    } catch (_: Exception) { false }

    override fun onDestroy() {
        destroyed = true
        executor.shutdownNow()
        webView.destroy()
        super.onDestroy()
    }

    companion object { private const val PORT = 8787 }
}
