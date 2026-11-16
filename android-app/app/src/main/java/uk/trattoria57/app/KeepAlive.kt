package uk.trattoria57.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps the app running: while it's open, Android shows a small "Trattoria 57 is running" notification
 * and treats the app as in use, so it isn't closed in the background and orders keep syncing
 * (also with the screen off or another app on top). Wi-Fi is kept on too.
 */
class KeepAlive : Service() {
    companion object {
        private const val CH_RUN = "t57run"; private const val CH_OPEN = "t57open"
        private const val ID_RUN = 57; private const val ID_OPEN = 59
        @Volatile var running = false

        fun start(ctx: Context) {
            val i = Intent(ctx, KeepAlive::class.java)
            try { if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i) } catch (_: Exception) {}
        }

        fun stop(ctx: Context, reopen: Boolean) {
            ctx.stopService(Intent(ctx, KeepAlive::class.java))
            if (reopen) reopenNotice(ctx, "Trattoria 57 was closed", "Tap to open it again", false)
        }

        private fun openApp(ctx: Context): PendingIntent =
            PendingIntent.getActivity(ctx, 57, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        private fun channels(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CH_RUN, "App running", NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(CH_OPEN, "Reopen the app", NotificationManager.IMPORTANCE_HIGH))
        }

        @Suppress("DEPRECATION")
        private fun builder(ctx: Context, ch: String) = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, ch) else Notification.Builder(ctx)

        /** After a restart or an app update: open the app again by itself where Android allows it, otherwise a tap on the notification does. */
        fun reopenNotice(ctx: Context, title: String, text: String, fullScreen: Boolean) {
            channels(ctx)
            val b = builder(ctx, CH_OPEN).setContentTitle(title).setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_revert).setContentIntent(openApp(ctx)).setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
            if (fullScreen) b.setFullScreenIntent(openApp(ctx), true)
            try { (ctx.getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(ID_OPEN, b.build()) } catch (_: Exception) {}
        }

        fun clearReopen(ctx: Context) { (ctx.getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(ID_OPEN) }
    }

    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        channels(this)
        val n = builder(this, CH_RUN).setContentTitle("Trattoria 57 is running").setContentText("Orders keep syncing — tap to open")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim).setContentIntent(openApp(this)).setOngoing(true).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID_RUN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ID_RUN, n)
        } catch (_: Exception) { stopSelf(); return START_NOT_STICKY }
        if (wake == null) wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "t57:app").apply { setReferenceCounted(false); acquire() }
        if (wifi == null) try {
            @Suppress("DEPRECATION")
            val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_HIGH_PERF else WifiManager.WIFI_MODE_FULL
            wifi = (applicationContext.getSystemService(WIFI_SERVICE) as WifiManager).createWifiLock(mode, "t57:app").apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) {}
        running = true
        return START_STICKY
    }

    /** Someone swiped the app away: say so, so it's easy to get back. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        getSharedPreferences("t57", MODE_PRIVATE).edit().putBoolean("open", false).apply()
        reopenNotice(this, "Trattoria 57 was closed", "Tap to open it again", false)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        try { wake?.release() } catch (_: Exception) {}; wake = null
        try { wifi?.release() } catch (_: Exception) {}; wifi = null
        super.onDestroy()
    }
}
