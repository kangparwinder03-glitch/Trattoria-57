package uk.trattoria57.printtest

import java.io.ByteArrayOutputStream

/** Builds ESC/POS bytes for cheap 58mm / 80mm thermal printers. */
class EscPos(val cols: Int) {
    private val out = ByteArrayOutputStream()

    init { raw(0x1B, 0x40); raw(0x1B, 0x74, 0x00) } // initialise + code page 437

    fun raw(vararg b: Int): EscPos { b.forEach { out.write(it) }; return this }

    private fun enc(s: String): ByteArray = s.map { ch ->
        when (ch) {
            '£' -> 0x9C.toByte(); '·' -> 0xFA.toByte(); '×' -> 'x'.code.toByte()
            '█' -> 0xDB.toByte(); '▓' -> 0xB2.toByte(); '░' -> 0xB0.toByte(); '▲' -> '+'.code.toByte(); '▼' -> '-'.code.toByte()
            '—', '–', '−' -> '-'.code.toByte(); '’', '‘' -> '\''.code.toByte()
            'é' -> 0x82.toByte(); 'è' -> 0x8A.toByte(); 'à' -> 0x85.toByte(); 'ä' -> 0x84.toByte(); 'ù' -> 0x97.toByte(); 'ò' -> 0x95.toByte()
            else -> if (ch.code in 32..126) ch.code.toByte() else '?'.code.toByte()
        }
    }.toByteArray()

    fun align(a: Int): EscPos = raw(0x1B, 0x61, a)          // 0 left, 1 centre, 2 right
    fun bold(on: Boolean): EscPos = raw(0x1B, 0x45, if (on) 1 else 0)
    fun size(w: Int, h: Int): EscPos = raw(0x1D, 0x21, ((w - 1) shl 4) or (h - 1))
    fun text(s: String): EscPos { out.write(enc(s)); return this }
    fun line(s: String = ""): EscPos = text(s).raw(0x0A)
    fun feed(n: Int): EscPos = raw(0x1B, 0x64, n)
    /** End of a ticket: cut on printers with a cutter; otherwise feed extra paper so it all clears the tear edge. */
    fun cut(): EscPos = if (hasCutter) raw(0x1D, 0x56, 0x42, 0x00) else feed(3)
    companion object { @Volatile var hasCutter = true }
    fun rule(ch: Char = '-'): EscPos = line(ch.toString().repeat(cols))

    /** Left text and right text on one line, e.g. "2 x Pizza ..... £25.80". */
    fun lr(left: String, right: String): EscPos {
        val room = cols - right.length - 1
        val l = if (left.length > room) left.substring(0, room) else left
        return line(l + " ".repeat(cols - l.length - right.length) + right)
    }

    /** Prints a black & white picture (the logo), centred on the paper. Sent in bands so cheap printers keep up. */
    fun image(m: Mono?): EscPos {
        if (m == null) return this
        val paper = if (cols >= 48) 576 else 384
        val w = minOf(m.w, paper); val left = (paper - w) / 2; val bpr = paper / 8
        align(0)
        var y0 = 0
        while (y0 < m.h) {
            val bh = minOf(48, m.h - y0)
            raw(0x1D, 0x76, 0x30, 0x00, bpr and 0xFF, bpr shr 8, bh and 0xFF, bh shr 8)
            for (y in y0 until y0 + bh) for (bx in 0 until bpr) {
                var v = 0
                for (bit in 0 until 8) { val x = bx * 8 + bit - left; if (x in 0 until w && m.bits[y * m.w + x]) v = v or (0x80 shr bit) }
                out.write(v)
            }
            y0 += bh
        }
        return this
    }

    /** A QR code drawn by the printer itself (sharp and scannable), centred. */
    /**
     * QR code. Every code prints the same width on paper: short links (Google, Instagram, Facebook) use the
     * size asked for; longer links (TripAdvisor) need more squares, so their squares are made smaller to match.
     */
    fun qr(data: String, size: Int = 5): EscPos {
        val b = data.toByteArray(Charsets.UTF_8); val len = b.size + 3
        val capM = intArrayOf(14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412)
        val capL = intArrayOf(17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520)
        val long = b.size > 42                                   // longer than a version-3 code at level M
        val ver = (if (long) capL else capM).indexOfFirst { b.size <= it }.let { if (it < 0) 15 else it + 1 }
        val modules = 17 + 4 * ver
        val dot = if (modules <= 29) size else maxOf(3, Math.round(size * 29.0 / modules).toInt())
        align(1)
        raw(0x1D, 0x28, 0x6B, 4, 0, 0x31, 0x41, 0x32, 0x00)          // model 2
        raw(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x43, dot)                 // dot size
        raw(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x45, if (long) 0x30 else 0x31)  // error correction L for long links, M otherwise
        raw(0x1D, 0x28, 0x6B, len and 0xFF, len shr 8, 0x31, 0x50, 0x30); out.write(b)
        raw(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30)                // print it
        return raw(0x0A)
    }

    /** "Follow us" block with a QR code per social account. */
    fun social(list: List<Triple<String, String, String>>): EscPos {
        if (list.isEmpty()) return this
        rule(); align(1).bold(true).size(1, 2).line("FOLLOW US").size(1, 1).bold(false).line("for news, specials & events")
        // generous white space around each code so phones can pick them up easily
        list.forEachIndexed { i, (name, handle, url) ->
            feed(if (i == 0) 2 else 3)
            qr(url, if (cols >= 48) 7 else 6)
            feed(1); bold(true).line(name).bold(false); if (handle.isNotBlank()) line(handle)
        }
        feed(2); line("Scan to follow our journey"); return align(0)
    }

    fun bytes(): ByteArray = out.toByteArray()
}

/** A 1-bit picture: true = black dot. */
class Mono(val w: Int, val h: Int, val bits: BooleanArray)

/** The full logo (bills, reports) and the smaller one (kitchen, bar and pickup tickets). Null = print without logo. */
class Logos(val full: Mono?, val small: Mono?) { companion object { val NONE = Logos(null, null) } }
