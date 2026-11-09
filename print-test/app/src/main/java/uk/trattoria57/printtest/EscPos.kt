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
    fun cut(): EscPos = raw(0x1D, 0x56, 0x42, 0x00)          // ignored by printers without a cutter
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

    fun bytes(): ByteArray = out.toByteArray()
}

/** A 1-bit picture: true = black dot. */
class Mono(val w: Int, val h: Int, val bits: BooleanArray)

/** The full logo (bills, reports) and the smaller one (kitchen, bar and pickup tickets). Null = print without logo. */
class Logos(val full: Mono?, val small: Mono?) { companion object { val NONE = Logos(null, null) } }
