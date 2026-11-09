package uk.trattoria57.printtest

import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Shared state between the background printing service and the screen. */
object Hub {
    @Volatile var status = ""; @Volatile var statusOk = true
    @Volatile var net = ""; @Volatile var netOk = true
    val logs = ArrayDeque<String>()
    @Volatile var lastSlip: ByteArray? = null
    var ui: (() -> Unit)? = null
    private val main = Handler(Looper.getMainLooper())
    private fun changed() = main.post { ui?.invoke() }

    fun say(t: String, ok: Boolean) { status = t; statusOk = ok; changed() }
    fun net(t: String, ok: Boolean) { net = t; netOk = ok; changed() }
    fun log(t: String) {
        synchronized(logs) {
            logs.addFirst("${SimpleDateFormat("HH:mm", Locale.UK).format(Date())}  $t")
            while (logs.size > 15) logs.removeLast()
        }
        changed()
    }
    fun logText() = synchronized(logs) { if (logs.isEmpty()) "—" else logs.joinToString("\n") }
}
