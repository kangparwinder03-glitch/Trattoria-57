package uk.trattoria57.printtest

import org.json.JSONObject
import java.io.DataInputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Live line to the database (Supabase Realtime, the same live updates the website uses), so a new order or
 * bill prints the moment it's saved instead of on the next check. It only says "something changed": the
 * printing service then fetches what's waiting itself, so nothing is missed if the line drops (the
 * regular check carries on underneath as a safety net).
 *
 * A small WebSocket client on a plain TLS socket (no extra libraries in the app).
 */
object Live {
    @Volatile var up = false; private set
    /** coll = which list changed ("*" = anything, e.g. after reconnecting); data = the saved item (null for a delete) */
    @Volatile var onChange: ((coll: String, data: JSONObject?) -> Unit)? = null
    @Volatile private var want = false
    @Volatile private var sock: SSLSocket? = null
    private var thread: Thread? = null
    private var ref = 0
    private const val TOPIC = "realtime:t57-printer"
    private val rnd = SecureRandom()

    @Synchronized fun start() {
        if (want) return
        want = true
        thread = Thread { run() }.apply { isDaemon = true; start() }
    }
    @Synchronized fun stop() {
        want = false; up = false
        try { sock?.close() } catch (_: Exception) {}
        thread?.interrupt(); thread = null
    }

    private fun run() {
        var retry = 1000L
        while (want) {
            var joined = false
            try { session { joined = true } } catch (_: Exception) {}
            up = false
            if (!want) break
            if (joined) retry = 1000L
            try { Thread.sleep(retry) } catch (_: InterruptedException) { break }
            retry = minOf(retry * 2, 30_000L)
        }
    }

    private fun session(onJoined: () -> Unit) {
        val host = URL(Cloud.BASE).host
        val s = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket() as SSLSocket
        sock = s
        try {
            s.connect(InetSocketAddress(host, 443), 10_000)
            s.soTimeout = 75_000   // the server answers every heartbeat (every 25s): nothing for over a minute = line is dead
            s.startHandshake()
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, s.session)) throw Exception("wrong server")
            val out = s.outputStream
            val inp = DataInputStream(s.inputStream.buffered())
            val key = android.util.Base64.encodeToString(ByteArray(16).also { rnd.nextBytes(it) }, android.util.Base64.NO_WRAP)
            out.write(("GET /realtime/v1/websocket?apikey=${Cloud.KEY}&vsn=1.0.0 HTTP/1.1\r\nHost: $host\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray())
            out.flush()
            val head = StringBuilder()
            while (!head.endsWith("\r\n\r\n")) { val b = inp.read(); if (b < 0) throw Exception("closed"); head.append(b.toChar()); if (head.length > 8000) throw Exception("bad reply") }
            if (!head.startsWith("HTTP/1.1 101")) throw Exception("refused")
            val accept = android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()), android.util.Base64.NO_WRAP)
            if (!head.lines().any { it.lowercase().startsWith("sec-websocket-accept:") && it.substringAfter(":").trim() == accept }) throw Exception("bad handshake")

            var tok = Cloud.liveToken()
            send(out, JSONObject().put("topic", TOPIC).put("event", "phx_join").put("payload", JSONObject()
                .put("config", JSONObject().put("broadcast", JSONObject().put("self", false)).put("presence", JSONObject().put("key", ""))
                    .put("postgres_changes", org.json.JSONArray().put(JSONObject().put("event", "*").put("schema", "public").put("table", "t57_docs"))))
                .put("access_token", tok)), join = true)
            // heartbeat every 25s (and pass on the renewed sign-in, so the line isn't cut after an hour)
            val beat = Thread {
                try {
                    while (want && sock === s) {
                        Thread.sleep(25_000)
                        send(out, JSONObject().put("topic", "phoenix").put("event", "heartbeat").put("payload", JSONObject()))
                        val t = try { Cloud.liveToken() } catch (_: Exception) { tok }
                        if (t != tok) { tok = t; send(out, JSONObject().put("topic", TOPIC).put("event", "access_token").put("payload", JSONObject().put("access_token", t))) }
                    }
                } catch (_: Exception) { try { s.close() } catch (_: Exception) {} }
            }.apply { isDaemon = true; start() }
            try { readLoop(inp, out, onJoined) } finally { beat.interrupt() }
        } finally { sock = null; try { s.close() } catch (_: Exception) {} }
    }

    private fun readLoop(inp: DataInputStream, out: OutputStream, onJoined: () -> Unit) {
        var frag: java.io.ByteArrayOutputStream? = null
        while (want) {
            val b0 = inp.readUnsignedByte(); val b1 = inp.readUnsignedByte()
            val fin = b0 and 0x80 != 0; val op = b0 and 0x0f
            var n = (b1 and 0x7f).toLong()
            if (n == 126L) n = inp.readUnsignedShort().toLong() else if (n == 127L) n = inp.readLong()
            if (n < 0 || n > 16L * 1024 * 1024) throw Exception("frame too big")
            val mask = if (b1 and 0x80 != 0) ByteArray(4).also { inp.readFully(it) } else null
            val data = ByteArray(n.toInt()); inp.readFully(data)
            if (mask != null) for (i in data.indices) data[i] = (data[i].toInt() xor mask[i and 3].toInt()).toByte()
            when (op) {
                0x8 -> throw Exception("closed")
                0x9 -> { frame(out, 0xA, data); continue }
                0xA -> continue
                0x1, 0x2 -> frag = java.io.ByteArrayOutputStream().apply { write(data) }
                0x0 -> frag?.write(data) ?: continue
                else -> continue
            }
            if (!fin) continue
            val text = String(frag!!.toByteArray(), Charsets.UTF_8); frag = null
            val m = try { JSONObject(text) } catch (_: Exception) { continue }
            val ev = m.optString("event"); val p = m.optJSONObject("payload")
            when {
                ev == "phx_reply" && m.optString("topic") == TOPIC -> {
                    if (p?.optString("status") != "ok") throw Exception("join refused")
                    if (!up) { up = true; onJoined(); onChange?.invoke("*", null) }   // catch up on anything from while the line was down
                }
                ev == "postgres_changes" -> {
                    val d = p?.optJSONObject("data") ?: continue
                    val del = d.optString("type") == "DELETE"
                    val rec = (if (del) d.optJSONObject("old_record") else d.optJSONObject("record"))
                    val coll = rec?.optString("coll", "") ?: ""
                    onChange?.invoke(if (coll.isEmpty()) "*" else coll, if (del) null else rec?.optJSONObject("data"))
                }
                ev == "phx_error" || ev == "phx_close" -> throw Exception(ev)
            }
        }
    }

    private fun send(out: OutputStream, o: JSONObject, join: Boolean = false) {
        synchronized(this) { ref++; o.put("ref", ref.toString()); if (join) o.put("join_ref", ref.toString()) }
        frame(out, 0x1, o.toString().toByteArray(Charsets.UTF_8))
    }

    /** one WebSocket frame from this side (always masked) */
    private fun frame(out: OutputStream, op: Int, data: ByteArray) {
        val n = data.size
        val head = java.io.ByteArrayOutputStream()
        head.write(0x80 or op)
        when {
            n < 126 -> head.write(0x80 or n)
            n < 65536 -> { head.write(0x80 or 126); head.write(n shr 8); head.write(n and 255) }
            else -> { head.write(0x80 or 127); for (i in 7 downTo 0) head.write(((n.toLong() shr (8 * i)) and 255L).toInt()) }
        }
        val mask = ByteArray(4).also { rnd.nextBytes(it) }
        head.write(mask)
        for (i in 0 until n) head.write(data[i].toInt() xor mask[i and 3].toInt())
        synchronized(out) { out.write(head.toByteArray()); out.flush() }
    }
}
