package uk.trattoria57.printtest

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/**
 * Kitchen tickets: dish names and options are drawn as pictures in a big, heavy, normal-spaced font
 * (the printer's own letters are fixed-width, so double-size text looks stretched and spaced out).
 * Sizes are in printer dots for 80mm paper (8 dots = 1mm); 58mm paper scales them down to fit.
 */
object TextPic {
    fun make(text: String, paper: Int, size80: Float, indent80: Int = 0): Mono {
        val k = paper / 576f
        val p = Paint().apply {
            color = Color.BLACK; isAntiAlias = true; textSize = size80 * k
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            style = Paint.Style.FILL_AND_STROKE; strokeWidth = textSize * 0.035f   // extra heavy, reads well on thermal paper
        }
        val indent = (indent80 * k)
        val lines = wrap(text.trim(), p, paper.toFloat(), indent)
        val fm = p.fontMetrics
        val lh = Math.ceil((fm.descent - fm.ascent).toDouble()).toInt()
        val h = maxOf(1, lines.size * lh + 4)
        val bmp = Bitmap.createBitmap(paper, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp); c.drawColor(Color.WHITE)
        lines.forEachIndexed { i, s -> c.drawText(s, if (i == 0) 0f else indent, i * lh - fm.ascent, p) }
        val px = IntArray(paper * h); bmp.getPixels(px, 0, paper, 0, 0, paper, h); bmp.recycle()
        return Mono(paper, h, BooleanArray(px.size) { val v = px[it]; ((v shr 16 and 255) * 30 + (v shr 8 and 255) * 59 + (v and 255) * 11) / 100 < 140 })
    }

    /** Breaks between words to fit the paper; a single word too long for a line is split. */
    private fun wrap(s: String, p: Paint, width: Float, indent: Float): List<String> {
        val out = ArrayList<String>(); var cur = ""
        fun room() = if (out.isEmpty()) width else width - indent
        for (w0 in s.split(Regex("\\s+")).filter { it.isNotEmpty() }) {
            var w = w0
            val t = if (cur.isEmpty()) w else "$cur $w"
            if (p.measureText(t) <= room()) { cur = t; continue }
            if (cur.isNotEmpty()) { out += cur; cur = "" }
            while (p.measureText(w) > room()) {
                var n = w.length; while (n > 1 && p.measureText(w, 0, n) > room()) n--
                out += w.substring(0, n); w = w.substring(n)
            }
            cur = w
        }
        if (cur.isNotEmpty() || out.isEmpty()) out += cur
        return out
    }
}
