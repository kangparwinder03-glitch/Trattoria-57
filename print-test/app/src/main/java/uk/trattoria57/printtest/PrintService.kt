package uk.trattoria57.printtest

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Keeps printing in the background (with a small notification), so the tablet can be used
 * for other things — e.g. the till tablet taking orders on the website at the same time.
 */
class PrintService : Service() {
    companion object {
        @Volatile var running = false
        fun stationName(st: String) = when (st) { "bar" -> "BAR"; "till" -> "TILL"; else -> "KITCHEN" }
        fun cutterFor(prefs: android.content.SharedPreferences, st: String) = prefs.getBoolean("cutter_$st", st == "kitchen")
        fun bigFor(prefs: android.content.SharedPreferences, st: String) = prefs.getBoolean("big_$st", st == "kitchen")
        fun copiesFor(prefs: android.content.SharedPreferences, st: String) =
            prefs.getInt("copies_$st", if (st == "kitchen") 2 else 1).coerceIn(1, 3)
    }

    private var worker: Thread? = null
    private var wake: PowerManager.WakeLock? = null
    private var lastBeat = 0L
    private var lastUpd = System.currentTimeMillis() - 3540_000L   // first check ~1 min after start
    private val prefs by lazy { getSharedPreferences("t57", Context.MODE_PRIVATE) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Cloud.init(this)
        startInForeground()
        if (!running) {
            running = true
            wake = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "t57:printer").apply { setReferenceCounted(false); acquire() }
            worker = Thread { loop() }.apply { isDaemon = true; start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false; worker?.interrupt()
        val stn = prefs.getString("station", "kitchen") ?: "kitchen"
        Thread { try { Cloud.merge("printers", stn, org.json.JSONObject().put("at", System.currentTimeMillis()).put("ok", false).put("msg", "Printing switched off").put("off", true)) } catch (_: Exception) {} }.start()
        try { wake?.release() } catch (_: Exception) {}
        Hub.say("Stopped — nothing will print until you tap Start.", false); Hub.net("", true)
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("t57print", "Printing orders", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val st = prefs.getString("station", "kitchen") ?: "kitchen"
        @Suppress("DEPRECATION")
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "t57print") else Notification.Builder(this)
        val n = b.setContentTitle("🖨 Trattoria 57 — printing for ${stationName(st)}")
            .setContentText("Tap to open the printer screen").setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true).setContentIntent(open).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(57, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) else startForeground(57, n)
    }

    private fun loop() {
        while (running) {
            try { poll(); Hub.net("Connected · checked ${SimpleDateFormat("HH:mm:ss", Locale.UK).format(Date())}", true) }
            catch (e: Exception) { Hub.net("⚠ Can't reach orders (${e.message ?: "no internet"}) — retrying", false) }
            // every minute without a print, check the printer is really on (so the light goes red if it's switched off)
            if (System.currentTimeMillis() - Bt.lastContact > 60_000) {
                val was = Bt.down
                Bt.probe(this)
                if (Bt.down != was) { lastBeat = 0; Hub.say(if (Bt.down) "⚠ Can't reach the printer — is it on and charged?" else "🖨 Printer back on", !Bt.down) }
            }
            // heartbeat: the website shows a green / red light for this printer
            if (System.currentTimeMillis() - lastBeat > 15000) try {
                val st = prefs.getString("station", "kitchen") ?: "kitchen"
                Cloud.merge("printers", st, org.json.JSONObject().put("at", System.currentTimeMillis()).put("ok", Bt.lastOk).put("msg", Bt.lastMsg).put("off", false).put("down", Bt.down)
                    .put("paper", if (prefs.getInt("cols", 32) >= 48) "80mm" else "58mm").put("dev", Build.MODEL ?: ""))
                lastBeat = System.currentTimeMillis()
            } catch (_: Exception) {}
            // self-update: check once an hour (only between 3am and 3pm, never during service)
            if (System.currentTimeMillis() - lastUpd > 3600_000L) { lastUpd = System.currentTimeMillis(); Updater.check(this, false) }
            try { Thread.sleep(3000) } catch (_: InterruptedException) { break }
        }
    }

    private fun logos(cols: Int) = if (prefs.getBoolean("logo", true)) Logo.forPaper(this, cols) else Logos.NONE

    private fun poll() {
        val st = prefs.getString("station", "kitchen") ?: "kitchen"
        val cols = prefs.getInt("cols", 32)
        // same rule as the tablets: the restaurant's day runs until 5am, so orders after midnight still print
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.UK).format(Date(System.currentTimeMillis() - 5 * 3600_000L))
        val since = prefs.getLong("since", 0L)
        val done = prefs.getStringSet("done", emptySet())!!.toMutableSet()
        val ready = "🟢 Printing ${stationName(st)} automatically"
        if (!Hub.status.startsWith("⚠")) Hub.say(ready, true)
        // kitchen / bar: order tickets (real ones, plus training ones marked TRAINING). The till gets none.
        if (st != "till") {
            val tickets = listOf("tickets", "train_tickets").flatMap { coll ->
                Cloud.list(coll, listOf("date" to today, "station" to st)).map { Triple(coll, it.first, it.second) } }
                .filter { (_, id, d) -> id !in done && !d.optBoolean("hold") && !d.optBoolean("wait") && !d.optBoolean("rejected") && d.optLong("printed", 0L) == 0L && d.optLong("createdAt") >= since }
                .sortedBy { it.third.optLong("createdAt") }
            for ((coll, id, d) in tickets) {
                if (!running || prefs.getString("station", "kitchen") != st) return
                val training = coll == "train_tickets"
                val label = if (d.optBoolean("pickup")) "Pickup #${d.optInt("pno")}" else d.optString("label")
                EscPos.hasCutter = cutterFor(prefs, st)
                val copies = copiesFor(prefs, st)
                val lg = logos(cols)
                val bytes = (1..copies).map { Format.ticket(d, cols, lg, it, copies, training, bigFor(prefs, prefs.getString("station", "kitchen") ?: "kitchen")) }.reduce { a, b -> a + b }
                if (!Bt.print(this, bytes, (if (training) "TRAINING " else "") + "$label · order #${d.optInt("no")}" + if (copies > 1) " (x$copies)" else "")) return
                Hub.say(ready, true)
                markDone(done, coll, id, st)
                Alexa.announce(label, st, training)
                if (Speaker.on(prefs, st)) Speaker.say(this, Speaker.words(label, training))
            }
        }
        // bills, receipts and reports sent from the website to this printer
        val jobs = Cloud.list("printjobs", listOf("to" to st))
            .filter { (id, d) -> id !in done && d.optLong("printed", 0L) == 0L && d.optLong("createdAt") >= System.currentTimeMillis() - 2 * 3600_000L }
            .sortedBy { it.second.optLong("createdAt") }
        for ((id, d) in jobs) {
            if (!running) return
            EscPos.hasCutter = cutterFor(prefs, st)
            val bytes = if (d.optString("kind") == "labels") Labels.make(d, cols) else Format.job(d, cols, logos(cols))
            if (!Bt.print(this, bytes, d.optString("title", "Print"))) return
            Hub.say(ready, true)
            markDone(done, "printjobs", id, st)
        }
    }

    private fun markDone(done: MutableSet<String>, coll: String, id: String, st: String) {
        done.add(id)
        val keep = if (done.size > 600) done.toList().takeLast(400).toMutableSet() else done
        prefs.edit().putStringSet("done", keep).apply()
        try { Cloud.merge(coll, id, JSONObject().put("printed", System.currentTimeMillis()).put("printedBy", st)) } catch (_: Exception) {}
    }
}
