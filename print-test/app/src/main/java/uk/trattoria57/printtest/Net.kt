package uk.trattoria57.printtest

import java.net.InetSocketAddress
import java.net.Socket

/**
 * Sends bytes to a network (Ethernet / Wi-Fi) printer on the restaurant's network.
 * Almost every thermal printer with a network socket listens on port 9100 for raw ESC/POS,
 * the same bytes we send over Bluetooth.
 */
object Net {
    const val PORT = 9100

    /** "192.168.1.50" or "192.168.1.50:9100" -> host and port. */
    private fun split(addr: String): Pair<String, Int> {
        val a = addr.trim()
        val i = a.lastIndexOf(':')
        if (i > 0) a.substring(i + 1).toIntOrNull()?.let { return a.substring(0, i) to it }
        return a to PORT
    }

    private fun open(addr: String): Socket {
        val (host, port) = split(addr)
        return Socket().apply { soTimeout = 10000; connect(InetSocketAddress(host, port), 5000) }
    }

    /** Connect and hang up: is the printer switched on and on the network? Throws if not. */
    fun probe(addr: String) { open(addr).close() }

    /** Sends the slip. Throws if the printer can't be reached. */
    fun send(addr: String, bytes: ByteArray) {
        open(addr).use { s ->
            val os = s.getOutputStream()
            var i = 0
            while (i < bytes.size) { val n = minOf(4096, bytes.size - i); os.write(bytes, i, n); os.flush(); i += n }
            // give the printer a moment to take everything in before we hang up
            Thread.sleep(300 + bytes.size / 100L)
        }
    }
}
