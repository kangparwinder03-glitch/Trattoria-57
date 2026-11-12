package uk.trattoria57.printtest

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import java.util.UUID

/** Sends bytes to the paired Bluetooth printer. One print at a time. */
@SuppressLint("MissingPermission")
object Bt {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val lock = Any()

    /** Last print result, reported to the website so staff see a red light if the printer stops. */
    @Volatile var lastOk = true
    @Volatile var lastMsg = "Ready"
    /** true when the last check/print couldn't reach the printer at all (off, flat or out of range) */
    @Volatile var down = false
    /** when we last talked to the printer (print or check) */
    @Volatile var lastContact = 0L

    /** Quick check that the printer is switched on and in range: connect, then hang up. Nothing prints. */
    fun probe(ctx: Context): Boolean = synchronized(lock) {
        val addr = ctx.getSharedPreferences("t57", Context.MODE_PRIVATE).getString("printer", null) ?: return false
        val ad = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter ?: return false
        var sock: BluetoothSocket? = null
        lastContact = System.currentTimeMillis()
        try {
            ad.cancelDiscovery()
            val dev = ad.getRemoteDevice(addr)
            sock = try { dev.createRfcommSocketToServiceRecord(spp).also { it.connect() } }
                catch (e: Exception) { dev.createInsecureRfcommSocketToServiceRecord(spp).also { it.connect() } }
            if (down || !lastOk) { lastOk = true; lastMsg = "Printer on and connected" }
            down = false
            true
        } catch (e: Exception) {
            lastOk = false; down = true; lastMsg = "Printer off, flat or out of range"
            false
        } finally { try { sock?.close() } catch (ignored: Exception) {} }
    }
    fun print(ctx: Context, bytes: ByteArray, what: String): Boolean = synchronized(lock) {
        val prefs = ctx.getSharedPreferences("t57", Context.MODE_PRIVATE)
        val addr = prefs.getString("printer", null) ?: run { Hub.say("Pick a printer first.", false); return false }
        val ad = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter ?: run { Hub.say("No Bluetooth on this tablet.", false); return false }
        var sock: BluetoothSocket? = null
        try {
            ad.cancelDiscovery()
            val dev = ad.getRemoteDevice(addr)
            val s: BluetoothSocket = try { dev.createRfcommSocketToServiceRecord(spp).also { it.connect() } }
                catch (e: Exception) { dev.createInsecureRfcommSocketToServiceRecord(spp).also { it.connect() } }
            sock = s
            // send in small pieces: cheap printers drop data (and garble the logo) if it arrives too fast
            val os = s.outputStream
            var i = 0
            while (i < bytes.size) { val n = minOf(512, bytes.size - i); os.write(bytes, i, n); os.flush(); i += n; Thread.sleep(25) }
            Thread.sleep(1000 + bytes.size / 20L)
            Hub.lastSlip = bytes
            Hub.log("✓ $what"); lastOk = true; down = false; lastContact = System.currentTimeMillis(); lastMsg = "Printed $what"
            true
        } catch (e: Exception) {
            Hub.say("⚠ Printer not responding — is it on, charged and in paper? Will retry.", false)
            lastOk = false; down = true; lastContact = System.currentTimeMillis(); lastMsg = "Printer not responding — off, flat or out of paper?"
            false
        } finally { try { sock?.close() } catch (ignored: Exception) {} }
    }
}
