package uk.trattoria57.printtest

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** Tablet restarted (or the app was updated): if printing was on before, switch it straight back on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val a = intent.action ?: return
        if (a != Intent.ACTION_BOOT_COMPLETED && a != "android.intent.action.QUICKBOOT_POWERON" && a != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val prefs = context.getSharedPreferences("t57", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("running", false) || prefs.getString("printer", null) == null || PrintService.running) return
        val i = Intent(context, PrintService::class.java)
        try { if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i) } catch (_: Exception) {}
    }
}
