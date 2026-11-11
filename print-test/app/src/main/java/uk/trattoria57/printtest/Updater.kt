package uk.trattoria57.printtest

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar

/**
 * Keeps the printer app up to date by itself: checks the GitHub release for a newer build,
 * downloads it and installs it. On Android 12+ it installs without a tap (the app updates itself);
 * otherwise a notification asks someone to tap "Update". Printing switches back on after the update.
 */
object Updater {
    private const val REL = "https://github.com/kangparwinder03-glitch/Trattoria-57/releases/download/print-test-latest/"
    @Volatile private var busy = false

    fun installed(ctx: Context): Long {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else pi.versionCode.toLong()
    }

    /** Auto checks only outside service hours (3am–3pm), so an update never interrupts a busy evening. */
    fun quietHours(): Boolean { val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY); return h in 3..14 }

    private fun get(url: String): HttpURLConnection {
        var u = url
        repeat(5) {
            val c = (URL(u).openConnection() as HttpURLConnection).apply { instanceFollowRedirects = false; connectTimeout = 15000; readTimeout = 60000 }
            val code = c.responseCode
            if (code in 300..399) { u = c.getHeaderField("Location") ?: throw Exception("bad redirect"); c.disconnect() }
            else if (code in 200..299) return c
            else throw Exception("HTTP $code")
        }
        throw Exception("too many redirects")
    }

    fun latest(): Long = get(REL + "version.txt").inputStream.bufferedReader().use { it.readText().trim().toLong() }

    /** manual = tapped "Check for update" (any time); otherwise only in quiet hours. Runs on a background thread. */
    fun check(ctx: Context, manual: Boolean) {
        if (busy) return
        if (!manual && !quietHours()) return
        busy = true
        Thread {
            try {
                val have = installed(ctx); val want = latest()
                if (want <= have) { if (manual) Hub.say("✓ Printer app is up to date (version $have)", true); return@Thread }
                if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
                    Hub.say("Update $want ready — tap 'Allow automatic updates' first", false); return@Thread }
                Hub.log("Downloading printer app update $want…")
                val f = File(ctx.cacheDir, "update.apk")
                get(REL + "T57-Print-Test.apk").inputStream.use { inp -> f.outputStream().use { inp.copyTo(it) } }
                install(ctx, f, want)
            } catch (e: Exception) { if (manual) Hub.say("Couldn't check for updates (${e.message}) — try again", false) }
            finally { busy = false }
        }.start()
    }

    private fun install(ctx: Context, apk: File, ver: Long) {
        val pi = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            s.openWrite("app", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val cb = PendingIntent.getBroadcast(ctx, 57, Intent(ctx, UpdateReceiver::class.java).putExtra("ver", ver), flags)
            Hub.log("Installing printer app update $ver…")
            s.commit(cb.intentSender)
        }
    }
}

/** Result of the install. If Android wants a tap, show a notification "Tap to finish the printer app update". */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (confirm == null) return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("t57upd", "Printer app updates", NotificationManager.IMPORTANCE_HIGH))
                val pend = PendingIntent.getActivity(ctx, 58, confirm, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                @Suppress("DEPRECATION")
                val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, "t57upd") else Notification.Builder(ctx)
                nm.notify(58, b.setContentTitle("🖨 Printer app update ready").setContentText("Tap to install — printing carries on straight after")
                    .setSmallIcon(android.R.drawable.stat_sys_download_done).setContentIntent(pend).setAutoCancel(true).build())
                Hub.say("Update downloaded — tap the notification to install", false)
            }
            PackageInstaller.STATUS_SUCCESS -> Hub.log("✓ Printer app updated")
            else -> Hub.log("Update didn't install: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "unknown"}")
        }
    }
}
