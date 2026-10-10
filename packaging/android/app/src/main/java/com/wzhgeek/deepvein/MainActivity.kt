package com.wzhgeek.deepvein

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/**
 * 矿脉 Deep Vein — 安卓壳
 *
 * 整个游戏是一个自包含的 HTML（工具与音效全部内联），所以这里只需要一个 WebView：
 *   · domStorageEnabled 必须开 —— 存档走 localStorage
 *   · 强制横屏 + 全屏沉浸 —— 游戏是 16:9 横版
 *   · 不允许任何网络访问（INTERNET 权限都没申请）
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            setBackgroundColor(0xFF05060A.toInt())
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true                        // localStorage 存档
                mediaPlaybackRequiresUserGesture = false        // WebAudio 音效
                cacheMode = WebSettings.LOAD_DEFAULT
                allowFileAccess = true
            }
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            loadUrl("file:///android_asset/deepvein.html")
            // 站内请求（assets/本地文件）自己处理；其余外链（如更新下载页）交给系统浏览器
            webViewClient = object : WebViewClient() {
                // 参数类型必须与 Java 侧一致（不能声明成可空），否则 Kotlin 报 "overrides nothing"
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url.toString()
                    if (u.startsWith("file://")) return false
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)))
                        true
                    } catch (e: Exception) { true }
                }
            }
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(web)
        hideSystemBars()
    }

    /** 沉浸式全屏：状态栏/导航栏都藏起来，给游戏让出全部画面 */
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(android.view.WindowInsets.Type.systemBars())
                it.systemBarsBehavior =
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
        }
    }

    /** 返回键：游戏里按 Esc 语义返回标题页；已经在标题页就退出 */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript(
            "(function(){ if (window.VeinApp && window.VeinApp.mode !== 'title') { " +
                "window.VeinApp.mode = 'title'; return 'handled'; } return 'exit'; })()"
        ) { result ->
            if (result != null && result.contains("handled")) hideSystemBars()
            else {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }
}
