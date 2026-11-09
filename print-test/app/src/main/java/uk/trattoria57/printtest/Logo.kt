package uk.trattoria57.printtest

import android.content.Context
import android.graphics.BitmapFactory

/** Loads the Trattoria 57 logo pictures from res/drawable-nodpi and turns them into printer dots. */
object Logo {
    private val cache = HashMap<Int, Mono>()

    fun forPaper(ctx: Context, cols: Int): Logos {
        val wide = cols >= 48
        return Logos(load(ctx, if (wide) R.drawable.logo_80 else R.drawable.logo_58),
                     load(ctx, if (wide) R.drawable.logo_small_80 else R.drawable.logo_small_58))
    }

    private fun load(ctx: Context, id: Int): Mono = cache.getOrPut(id) {
        val b = BitmapFactory.decodeResource(ctx.resources, id, BitmapFactory.Options().apply { inScaled = false })
        val px = IntArray(b.width * b.height)
        b.getPixels(px, 0, b.width, 0, 0, b.width, b.height)
        Mono(b.width, b.height, BooleanArray(px.size) {
            val c = px[it]
            val lum = (((c shr 16) and 0xFF) * 30 + ((c shr 8) and 0xFF) * 59 + (c and 0xFF) * 11) / 100
            ((c ushr 24) and 0xFF) > 128 && lum < 128
        })
    }
}
