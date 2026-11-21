package uk.trattoria57.printtest

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.SharedPreferences
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Which stations (kitchen / bar / till) this tablet prints for. One tablet can print for several,
 * each on its own printer — or several stations on the same printer.
 */
object Stations {
    val ALL = listOf("kitchen", "bar", "till")

    /** Moves settings from the old one-station-per-tablet app, once. */
    fun migrate(prefs: SharedPreferences) {
        if (prefs.contains("stations")) return
        val st = prefs.getString("station", "kitchen") ?: "kitchen"
        val e = prefs.edit().putStringSet("stations", setOf(st))
        prefs.getString("printer", null)?.let { e.putString("printer_$st", it) }
        prefs.getString("printer_ip", null)?.let { e.putString("printer_ip_$st", it) }
        if (prefs.contains("cols")) e.putInt("cols_$st", prefs.getInt("cols", 32))
        e.apply()
    }

    /** The stations this tablet prints for, in kitchen / bar / till order. */
    fun on(prefs: SharedPreferences): List<String> { migrate(prefs); val s = prefs.getStringSet("stations", emptySet()) ?: emptySet(); return ALL.filter { it in s } }

    fun set(prefs: SharedPreferences, st: String, on: Boolean) {
        val s = (prefs.getStringSet("stations", emptySet()) ?: emptySet()).toMutableSet()
        if (on) s.add(st) else s.remove(st)
        prefs.edit().putStringSet("stations", s).apply()
    }

    /** 32 columns = 58mm paper, 48 = 80mm. */
    fun cols(prefs: SharedPreferences, st: String) = prefs.getInt("cols_$st", prefs.getInt("cols", 32))
}

/**
 * Sends bytes to a station's printer, one print at a time: a paired Bluetooth printer, or a network
 * printer when that station has a network address saved ("printer_ip_<station>").
 */
@SuppressLint("MissingPermission")
object Bt {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val lock = Any()

    /** Last result for one station's printer, reported to the website so staff see a red light if it stops. */
    class State {
        @Volatile var lastOk = true
        @Volatile var lastMsg = "Ready"
        /** true when the last check/print couldn't reach the printer at all (off, flat or out of range) */
        @Volatile var down = false
        /** when we last talked to the printer (print or check) */
        @Volatile var lastContact = 0L
    }
    private val states = ConcurrentHashMap<String, State>()
    fun state(st: String): State = states.getOrPut(st) { State() }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("t57", Context.MODE_PRIVATE)

    /** The station's network printer address, or null to use Bluetooth. */
    fun netAddr(ctx: Context, st: String): String? = prefs(ctx).getString("printer_ip_$st", "")?.trim()?.takeIf { it.isNotEmpty() }
    fun btAddr(ctx: Context, st: String): String? = prefs(ctx).getString("printer_$st", null)

    /** true when the station has a printer (network address saved, or a Bluetooth printer picked). */
    fun chosen(ctx: Context, st: String): Boolean = netAddr(ctx, st) != null || btAddr(ctx, st) != null

    /** Who to talk to: a network address or a Bluetooth one. The same printer can serve several stations. */
    private fun target(ctx: Context, st: String): String? = netAddr(ctx, st)?.let { "ip:$it" } ?: btAddr(ctx, st)?.let { "bt:$it" }

    private fun connectBt(ctx: Context, addr: String): BluetoothSocket {
        val ad = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter ?: throw Exception("No Bluetooth on this tablet")
        ad.cancelDiscovery()
        val dev = ad.getRemoteDevice(addr)
        return try { dev.createRfcommSocketToServiceRecord(spp).also { it.connect() } }
            catch (e: Exception) { dev.createInsecureRfcommSocketToServiceRecord(spp).also { it.connect() } }
    }

    /** Quick check that the station's printer is switched on and reachable: connect, then hang up. Nothing prints. */
    fun probe(ctx: Context, st: String): Boolean = synchronized(lock) {
        val s = state(st)
        val t = target(ctx, st) ?: return false
        s.lastContact = System.currentTimeMillis()
        val net = t.startsWith("ip:")
        try {
            if (net) Net.probe(t.substring(3)) else connectBt(ctx, t.substring(3)).close()
            if (s.down || !s.lastOk) { s.lastOk = true; s.lastMsg = "Printer on and connected" }
            s.down = false
            true
        } catch (e: Exception) {
            s.lastOk = false; s.down = true; s.lastMsg = if (net) "Printer off or not on the network" else "Printer off, flat or out of range"
            false
        }
    }

    fun print(ctx: Context, st: String, bytes: ByteArray, what: String): Boolean = synchronized(lock) {
        val s = state(st)
        val name = PrintService.stationName(st)
        val t = target(ctx, st) ?: run { Hub.say("Pick a printer for the $name first.", false); return false }
        val net = t.startsWith("ip:")
        var sock: BluetoothSocket? = null
        try {
            if (net) Net.send(t.substring(3), bytes)
            else {
                sock = connectBt(ctx, t.substring(3))
                // send in small pieces: cheap printers drop data (and garble the logo) if it arrives too fast
                val os = sock.outputStream
                var i = 0
                while (i < bytes.size) { val n = minOf(512, bytes.size - i); os.write(bytes, i, n); os.flush(); i += n; Thread.sleep(25) }
                Thread.sleep(1000 + bytes.size / 20L)
            }
            Hub.lastSlip = bytes; Hub.lastSlipSt = st
            Hub.log("✓ $what"); s.lastOk = true; s.down = false; s.lastContact = System.currentTimeMillis(); s.lastMsg = "Printed $what"
            // the same printer serves other stations too: they're reachable as well
            for (o in Stations.ALL) if (o != st && target(ctx, o) == t) { val x = state(o); x.lastOk = true; x.down = false; x.lastContact = s.lastContact }
            true
        } catch (e: Exception) {
            Hub.say(if (net) "⚠ $name printer not responding (${t.substring(3)}). Is it on, plugged in and in paper? Will retry."
                    else "⚠ $name printer not responding — is it on, charged and in paper? Will retry.", false)
            s.lastOk = false; s.down = true; s.lastContact = System.currentTimeMillis()
            s.lastMsg = if (net) "Printer not responding: off, unplugged or out of paper?" else "Printer not responding — off, flat or out of paper?"
            false
        } finally { try { sock?.close() } catch (ignored: Exception) {} }
    }
}
