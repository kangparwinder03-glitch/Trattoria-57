package uk.trattoria57.printtest

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import org.json.JSONArray
import org.json.JSONObject

/**
 * Table QR labels for label rolls (e.g. Katasymbol T50M Pro): each label is drawn as an exact-size picture
 * (QR on the left, TRATTORIA 57 + table name on the right), then the paper feeds the gap to the next label.
 * Sizes come from the website: w / h / gap in mm (8 printer dots per mm).
 */
object Labels {
    fun make(j: JSONObject, cols: Int): ByteArray = EscPos(cols).apply {
        val paper = if (cols >= 48) 576 else 384
        val W = minOf(paper, (j.optDouble("w", 50.0) * 8).toInt())
        val H = (j.optDouble("h", 30.0) * 8).toInt().coerceIn(80, 800)
        val gap = (j.optDouble("gap", 2.0) * 8).toInt().coerceIn(0, 255)
        val arr = j.optJSONArray("labels") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val L = arr.optJSONObject(i) ?: continue
            image(draw(L, W, H))
            if (gap > 0) raw(0x1B, 0x4A, gap)          // feed exactly the gap to the next label
        }
    }.bytes()

    private fun draw(L: JSONObject, W: Int, H: Int): Mono {
        val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp); c.drawColor(Color.WHITE)
        val m = 10
        // QR from the module grid sent by the website ("0101…" rows)
        val rows = L.optJSONArray("qr") ?: JSONArray()
        val n = rows.length()
        var x0 = m.toFloat()
        if (n > 0) {
            val mod = maxOf(1, (H - 2 * m) / (n + 2))
            val size = mod * (n + 2)
            val ox = m; val oy = (H - size) / 2
            val p = Paint().apply { color = Color.BLACK; isAntiAlias = false }
            for (r in 0 until n) { val row = rows.optString(r)
                for (k in row.indices) if (row[k] == '1')
                    c.drawRect(((ox + (k + 1) * mod).toFloat()), ((oy + (r + 1) * mod).toFloat()), ((ox + (k + 2) * mod).toFloat()), ((oy + (r + 2) * mod).toFloat()), p) }
            x0 = (ox + size + 8).toFloat()
        }
        val tw = (W - x0 - m).toFloat()
        fun paint(sz: Float, bold: Boolean, serif: Boolean) = Paint().apply {
            color = Color.BLACK; isAntiAlias = true; textSize = sz
            typeface = Typeface.create(if (serif) Typeface.SERIF else Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL) }
        fun fit(t: String, start: Float, bold: Boolean, serif: Boolean): Paint { val p = paint(start, bold, serif); while (p.measureText(t) > tw && p.textSize > 10f) p.textSize -= 1f; return p }
        val brand = L.optString("brand", "TRATTORIA 57"); val name = L.optString("name"); val l3 = L.optString("line3"); val l4 = L.optString("line4")
        val pB = fit(brand, H * 0.11f, true, true).apply { letterSpacing = 0.12f }
        while (pB.measureText(brand) > tw && pB.textSize > 10f) pB.textSize -= 1f
        val pN = fit(name, H * 0.30f, true, false)
        val pS = fit(if (l3.length > l4.length) l3 else l4, H * 0.10f, false, false)
        val total = pB.textSize + pN.textSize + pS.textSize * 2 + 26
        var y = (H - total) / 2 + pB.textSize
        c.drawText(brand, x0, y, pB); y += 6
        c.drawLine(x0, y, x0 + minOf(tw, pB.measureText(brand)), y, Paint().apply { color = Color.BLACK; strokeWidth = 2f })
        y += pN.textSize + 4; c.drawText(name, x0, y, pN)
        y += pS.textSize + 8; c.drawText(l3, x0, y, pS)
        y += pS.textSize + 2; c.drawText(l4, x0, y, pS)
        val px = IntArray(W * H); bmp.getPixels(px, 0, W, 0, 0, W, H)
        return Mono(W, H, BooleanArray(px.size) { val v = px[it]; ((v shr 16 and 255) * 30 + (v shr 8 and 255) * 59 + (v and 255) * 11) / 100 < 140 })
    }
}
