package uk.trattoria57.printtest

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import java.util.UUID

/**
 * Sends bytes to the printer, one print at a time: the paired Bluetooth printer, or, when a
 * network printer address is saved ("printer_ip"), a network printer over the restaurant's network.
 */
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
        netAddr(ctx)?.let { ip ->
            lastContact = System.currentTimeMillis()
            return try {
                Net.probe(ip)
                if (down || !lastOk) { lastOk = true; lastMsg = "Printer on and connected" }
                down = false; true
            } catch (e: Exception) { lastOk = false; down = true; lastMsg = "Printer off or not on the network"; false }
        }
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
    /** The saved network printer address, or null to use Bluetooth. */
    fun netAddr(ctx: Context): String? =
        ctx.getSharedPreferences("t57", Context.MODE_PRIVATE).getString("printer_ip", "")?.trim()?.takeIf { it.isNotEmpty() }

    /** true when a printer is chosen (network address saved, or a Bluetooth printer picked). */
    fun chosen(ctx: Context): Boolean =
        netAddr(ctx) != null || ctx.getSharedPreferences("t57", Context.MODE_PRIVATE).getString("printer", null) != null

    fun print(ctx: Context, bytes: ByteArray, what: String): Boolean = synchronized(lock) {
        val prefs = ctx.getSharedPreferences("t57", Context.MODE_PRIVATE)
        netAddr(ctx)?.let { ip ->
            return try {
                Net.send(ip, bytes)
                Hub.lastSlip = bytes
                Hub.log("✓ $what"); lastOk = true; down = false; lastContact = System.currentTimeMillis(); lastMsg = "Printed $what"
                true
            } catch (e: Exception) {
                Hub.say("⚠ Network printer not responding ($ip). Is it on, plugged in and in paper? Will retry.", false)
                lastOk = false; down = true; lastContact = System.currentTimeMillis(); lastMsg = "Printer not responding: off, unplugged or out of paper?"
                false
            }
        }
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
