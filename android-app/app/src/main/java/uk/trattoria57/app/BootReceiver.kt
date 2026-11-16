package uk.trattoria57.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Tablet restarted, or the app just updated itself: if the app was open before, open it again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val a = intent.action ?: return
        if (a != Intent.ACTION_BOOT_COMPLETED && a != "android.intent.action.QUICKBOOT_POWERON" && a != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!ctx.getSharedPreferences("t57", Context.MODE_PRIVATE).getBoolean("open", false)) return
        // Newer Android shows it full screen or as a "tap to open" notification; older Android opens it straight away.
        val updated = a == Intent.ACTION_MY_PACKAGE_REPLACED
        KeepAlive.reopenNotice(ctx, if (updated) "Trattoria 57 updated" else "Tablet restarted", "Tap to open Trattoria 57", true)
        try { ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
    }
}
