package uk.trattoria57.printtest

import java.io.ByteArrayOutputStream

/** Builds ESC/POS bytes for cheap 58mm / 80mm thermal printers. */
class EscPos(val cols: Int) {
    private val out = ByteArrayOutputStream()

    init { raw(0x1B, 0x40); raw(0x1B, 0x74, 0x00) } // initialise + code page 437

    fun raw(vararg b: Int): EscPos { b.forEach { out.write(it) }; return this }

    private fun enc(s: String): ByteArray = Text.cp437(s)

    fun align(a: Int): EscPos = raw(0x1B, 0x61, a)          // 0 left, 1 centre, 2 right
    /** When set (kitchen tickets), every line prints bold — bold(false) can't switch it off. */
    var allBold = false
    fun bold(on: Boolean): EscPos = raw(0x1B, 0x45, if (on || allBold) 1 else 0)
    /** Everything bold + double-strike: thicker, darker print. */
    fun heavy(): EscPos { allBold = true; return raw(0x1B, 0x45, 1).raw(0x1B, 0x47, 1) }
    fun size(w: Int, h: Int): EscPos { curW = w; return raw(0x1D, 0x21, ((w - 1) shl 4) or (h - 1)) }
    fun text(s: String): EscPos { out.write(enc(s)); return this }
    fun line(s: String = ""): EscPos = text(s).raw(0x0A)
    /** Current character width (1 = normal, 2 = double width): wrapping uses it to know how many letters fit. */
    private var curW = 1
    /** A line that may be too long for the paper: broken between words (never mid-word), later lines indented. */
    fun wline(s: String, indent: String = "  "): EscPos { Text.wrap(s, maxOf(8, cols / curW), indent).forEach { line(it) }; return this }
    fun feed(n: Int): EscPos = raw(0x1B, 0x64, n)
    /** End of a ticket: cut on printers with a cutter; otherwise feed extra paper so it all clears the tear edge. */
    fun cut(): EscPos = if (hasCutter) raw(0x1D, 0x56, 0x42, 0x00) else feed(3)
    companion object { @Volatile var hasCutter = true }
    /**
     * Kitchen printers with a buzzer and flashing light: beep [times] times (each beep ~[len] x 50ms).
     * ESC B n t is the standard "sound the buzzer" command on these printers; the light flashes with it.
     * Printers without a buzzer ignore it.
     */
    fun buzz(times: Int = 3, len: Int = 3): EscPos = raw(0x1B, 0x42, times.coerceIn(1, 9), len.coerceIn(1, 9))
    fun rule(ch: Char = '-'): EscPos = line(ch.toString().repeat(cols))

    /** Left text and right text on one line, e.g. "2 x Pizza ..... £25.80". */
    fun lr(left: String, right: String): EscPos {
        val room = cols - right.length - 1
        val l = if (left.length > room) left.substring(0, room) else left
        return line(l + " ".repeat(cols - l.length - right.length) + right)
    }

    /** A solid black bar across the whole paper (thick divider between courses). */
    fun bar(dots: Int = 10): EscPos {
        val bpr = (if (cols >= 48) 576 else 384) / 8
        align(0).raw(0x1D, 0x76, 0x30, 0x00, bpr and 0xFF, bpr shr 8, dots and 0xFF, dots shr 8)
        repeat(bpr * dots) { out.write(0xFF) }
        return this
    }
    /** White-on-black text (course headings). */
    fun reverse(on: Boolean): EscPos = raw(0x1D, 0x42, if (on) 1 else 0)

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
        // white space around each code so phones can pick them up easily; the name sits right under its code
        list.forEachIndexed { i, (name, handle, url) ->
            feed(if (i == 0) 2 else 3)
            qr(url, if (cols >= 48) 7 else 6)
            bold(true).line(name).bold(false); if (handle.isNotBlank()) line(handle)
        }
        feed(2); line("Scan to follow our journey"); return align(0)
    }

    fun bytes(): ByteArray = out.toByteArray()
}

/** Text helpers for the printer: its own alphabet (code page 437) and word wrapping. */
object Text {
    private val MAP = mapOf(
        '£' to 0x9C, '·' to 0xFA, '█' to 0xDB, '▓' to 0xB2, '░' to 0xB0, '½' to 0xAB, '¼' to 0xAC, '°' to 0xF8,
        'é' to 0x82, 'è' to 0x8A, 'ê' to 0x88, 'ë' to 0x89, 'à' to 0x85, 'á' to 0xA0, 'â' to 0x83, 'ä' to 0x84,
        'ì' to 0x8D, 'í' to 0xA1, 'î' to 0x8C, 'ï' to 0x8B, 'ò' to 0x95, 'ó' to 0xA2, 'ô' to 0x93, 'ö' to 0x94,
        'ù' to 0x97, 'ú' to 0xA3, 'û' to 0x96, 'ü' to 0x81, 'ñ' to 0xA4, 'ç' to 0x87, 'É' to 0x90, 'Ä' to 0x8E,
        'Ö' to 0x99, 'Ü' to 0x9A, 'Ñ' to 0xA5, 'Ç' to 0x80)
    private val PLAIN = mapOf('×' to "x", '▲' to "+", '▼' to "-", '—' to "-", '–' to "-", '−' to "-", '’' to "'", '‘' to "'",
        '“' to "\"", '”' to "\"", '…' to "...", '€' to "EUR", 'À' to "A", 'È' to "E", 'Ì' to "I", 'Ò' to "O", 'Ù' to "U", 'œ' to "oe")

    /** Bytes the printer understands. Emoji are left out (they used to print as "?"); anything else unknown prints as "?". */
    fun cp437(s: String): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i); i += Character.charCount(cp)
            val ch = if (cp <= 0xFFFF) cp.toChar() else '\u0000'
            when {
                cp in 32..126 -> out.write(cp)
                MAP.containsKey(ch) -> out.write(MAP[ch]!!)
                PLAIN.containsKey(ch) -> out.write(PLAIN[ch]!!.toByteArray())
                cp == 0x200D || cp in 0xFE00..0xFE0F || cp in 0x1F000..0x1FFFF || cp in 0x2600..0x27BF || cp in 0x2B00..0x2BFF || cp in 0xE0000..0xE007F -> {}  // emoji & joiners
                else -> out.write('?'.code)
            }
        }
        return out.toByteArray()
    }

    /** Breaks text into lines of at most [width] letters, between words. Leading spaces are kept; a word longer than a line is split. */
    fun wrap(s: String, width: Int, indent: String = "  "): List<String> {
        if (s.length <= width) return listOf(s)
        val lead = s.takeWhile { it == ' ' }.take(width / 2)
        val out = mutableListOf<String>()
        var cur = StringBuilder(lead); var hasWord = false
        fun flush() { out += cur.toString(); cur = StringBuilder(indent); hasWord = false }
        for (w0 in s.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }) {
            var w = w0
            while (w.isNotEmpty()) {
                val sep = if (hasWord) 1 else 0
                if (cur.length + sep + w.length <= width) { if (sep == 1) cur.append(' '); cur.append(w); hasWord = true; w = "" }
                else if (hasWord) flush()
                else { val r = maxOf(1, width - cur.length); cur.append(w.substring(0, minOf(r, w.length))); w = w.substring(minOf(r, w.length)); hasWord = true; if (w.isNotEmpty()) flush() }
            }
        }
        if (hasWord) out += cur.toString()
        return out
    }
}

/** A 1-bit picture: true = black dot. */
class Mono(val w: Int, val h: Int, val bits: BooleanArray)

/** The full logo (bills, reports) and the smaller one (kitchen, bar and pickup tickets). Null = print without logo. */
class Logos(val full: Mono?, val small: Mono?) { companion object { val NONE = Logos(null, null) } }
