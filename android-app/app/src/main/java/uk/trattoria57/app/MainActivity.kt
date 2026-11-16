package uk.trattoria57.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

/**
 * The Trattoria 57 app: the live website, full screen, with the screen kept awake.
 * Logins, the tablet's station and everything the website saves stay on the tablet
 * (they live in the app's own storage, which survives app updates).
 */
class MainActivity : Activity() {
    companion object {
        const val HOME = "https://kangparwinder03-glitch.github.io/Trattoria-57/"
        private const val HOST = "kangparwinder03-glitch.github.io"
        private const val PATH = "/Trattoria-57"
    }

    private lateinit var frame: FrameLayout
    private var web: WebView? = null
    private lateinit var offline: TextView
    private val main = Handler(Looper.getMainLooper())
    private var failed = false

    private val retry = Runnable { failed = false; web?.loadUrl(web?.url?.takeIf { isOurs(it) } ?: HOME) }
    private val updateTick = object : Runnable {
        override fun run() { Updater.check(this@MainActivity, false) { say(it) }; main.postDelayed(this, 30 * 60_000L) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.setBackgroundColor(Color.parseColor("#f4ecdc"))
        // Lets the automatic in-app test drive the website. Only possible when USB debugging is
        // switched on in the tablet's developer settings, which restaurant tablets don't have.
        WebView.setWebContentsDebuggingEnabled(adbOn())

        frame = FrameLayout(this)
        offline = TextView(this).apply {
            text = "📶  No internet — trying again…"
            textSize = 22f; gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#3e4a22")); setBackgroundColor(Color.parseColor("#f4ecdc"))
            visibility = View.GONE
            setOnClickListener { main.removeCallbacks(retry); retry.run() }
        }
        setContentView(frame)
        makeWeb(savedInstanceState)
        frame.addView(offline, FrameLayout.LayoutParams(-1, -1))

        getSharedPreferences("t57", MODE_PRIVATE).edit().putBoolean("open", true).apply()
        KeepAlive.start(this)
        firstRunAsks()
        main.postDelayed(updateTick, 60_000L)
    }

    private fun adbOn() = try { Settings.Global.getInt(contentResolver, Settings.Global.ADB_ENABLED, 0) == 1 } catch (_: Exception) { false }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makeWeb(state: Bundle?) {
        val w = WebView(this)
        web = w
        w.setBackgroundColor(Color.parseColor("#f4ecdc"))
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true          // the website's saved data (login, station, carts)
            @Suppress("DEPRECATION")
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false   // new-order and alarm sounds play by themselves
            textZoom = 100
            setSupportMultipleWindows(false)
            userAgentString = userAgentString + " T57App/" + Updater.installed(this@MainActivity)
        }
        CookieManager.getInstance().setAcceptCookie(true)
        w.addJavascriptInterface(Bridge(), "T57App")
        w.webChromeClient = WebChromeClient()
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url.toString()
                if (isOurs(u)) return false
                openOutside(req.url); return true
            }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (!req.isForMainFrame) return
                failed = true; offline.visibility = View.VISIBLE
                main.removeCallbacks(retry); main.postDelayed(retry, 5000)
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!failed) offline.visibility = View.GONE
                CookieManager.getInstance().flush()
            }
            // If the page's engine crashes or Android reclaims it, rebuild it and carry on (instead of the app closing).
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                val last = view.url
                frame.removeView(view); view.destroy(); web = null
                main.post { makeWeb(null); web?.loadUrl(last?.takeIf { isOurs(it) } ?: HOME) }
                return true
            }
        }
        frame.addView(w, 0, FrameLayout.LayoutParams(-1, -1))
        if (state == null || w.restoreState(state) == null) w.loadUrl(HOME)
    }

    private fun isOurs(u: String): Boolean {
        val uri = Uri.parse(u)
        return (uri.scheme == "https" && uri.host == HOST && (uri.path ?: "").startsWith(PATH)) || uri.scheme == "about" || uri.scheme == "blob" || uri.scheme == "data"
    }

    /** Phone numbers, emails, WhatsApp, review links… open in the tablet's own apps. */
    private fun openOutside(uri: Uri) {
        try {
            val i = if (uri.scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) else Intent(Intent.ACTION_VIEW, uri)
            i.addCategory(Intent.CATEGORY_BROWSABLE); i.component = null; i.selector = null
            startActivity(i)
        } catch (_: ActivityNotFoundException) { say("No app on this tablet can open that") } catch (_: Exception) {}
    }

    private fun say(msg: String) { main.post { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() } }

    /** First start: allow the "keeps running" notification, and let Android leave the app running in the background. */
    private fun firstRunAsks() {
        val p = getSharedPreferences("t57", MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !p.getBoolean("askedNotif", false)) {
            p.edit().putBoolean("askedNotif", true).apply()
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            return   // battery question comes after this answer
        }
        askBattery()
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        if (code == 1) { KeepAlive.start(this); askBattery() }
    }

    @SuppressLint("BatteryLife")
    private fun askBattery() {
        if (Build.VERSION.SDK_INT < 23) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val p = getSharedPreferences("t57", MODE_PRIVATE)
        if (pm.isIgnoringBatteryOptimizations(packageName) || p.getBoolean("askedBattery", false)) return
        p.edit().putBoolean("askedBattery", true).apply()
        try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (_: Exception) {}
    }

    private fun immersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive() }

    override fun onResume() {
        super.onResume(); immersive()
        getSharedPreferences("t57", MODE_PRIVATE).edit().putBoolean("open", true).apply()
        KeepAlive.start(this)
        KeepAlive.clearReopen(this)
    }

    // The website is never paused here: orders keep syncing while another app is on top or the screen is off.
    override fun onPause() { super.onPause(); CookieManager.getInstance().flush() }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web?.saveState(out) }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent) }

    /** Back closes the open pop-up first, then goes back a screen. It never closes the app by accident. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val w = web ?: return
        w.evaluateJavascript("(function(){var o=[].slice.call(document.querySelectorAll('.overlay.show')).pop();if(!o)return 'none';var x=o.querySelector('.x,#xClose,[data-xdone]');if(x){x.click();return 'closed'}return 'none'})()") { r ->
            if (r?.contains("none") != false && w.canGoBack()) w.goBack()
        }
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        if (isFinishing) {
            getSharedPreferences("t57", MODE_PRIVATE).edit().putBoolean("open", false).apply()
            KeepAlive.stop(this, reopen = true)
        }
        web?.let { frame.removeView(it); it.destroy() }; web = null
        super.onDestroy()
    }

    /** What the website can ask the app for (window.T57App in the page). */
    inner class Bridge {
        @JavascriptInterface fun version(): Long = Updater.installed(this@MainActivity)
        @JavascriptInterface fun checkUpdate() { Updater.check(this@MainActivity, true) { say(it) } }
        /** A PDF made by the website (reports, menu): opens Android's share sheet so it can be emailed, printed or saved. */
        @JavascriptInterface fun savePdf(b64: String, name: String) {
            try {
                val dir = File(cacheDir, "pdf").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
                val safe = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").ifBlank { "Trattoria57.pdf" }
                val f = File(dir, if (safe.endsWith(".pdf", true)) safe else "$safe.pdf")
                f.writeBytes(Base64.decode(b64, Base64.DEFAULT))
                val uri = FileProvider.getUriForFile(this@MainActivity, "uk.trattoria57.app.files", f)
                val send = Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_SUBJECT, f.nameWithoutExtension.replace('_', ' ')).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                main.post { startActivity(Intent.createChooser(send, "Send or save the PDF")) }
            } catch (e: Exception) { say("Couldn't make the PDF here") }
        }
    }
}
