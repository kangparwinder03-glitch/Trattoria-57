package uk.trattoria57.printtest

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Kitchen Alexa: after a new kitchen ticket prints, an Echo says "New order, Table 4" (via Voice Monkey).
 *  Set up in the website: ⭐ Manager → Kitchen Alexa (token + speaker ID are kept in the locked database). */
object Alexa {
    @Volatile private var cfg: JSONObject? = null
    @Volatile private var cfgAt = 0L

    fun announce(label: String, station: String, training: Boolean) {
        Thread {
            try {
                if (System.currentTimeMillis() - cfgAt > 60_000) {
                    cfg = Cloud.list("alexa", emptyList()).firstOrNull { it.first == "main" }?.second
                    cfgAt = System.currentTimeMillis()
                }
                val c = cfg ?: return@Thread
                if (!c.optBoolean("on") || !c.optBoolean(station, station == "kitchen")) return@Thread
                val token = c.optString("token"); val device = c.optString("device")
                if (token.isBlank() || device.isBlank()) return@Thread
                val who = label.replace("#", "").trim()
                val speech = (if (training) "Training. " else "") + c.optString("speech", "New order, {table}").replace("{table}", who)
                val e = { s: String -> URLEncoder.encode(s, "UTF-8") }
                var q = "https://api-v3.voicemonkey.io/announce?token=${e(token)}&device=${e(device)}&speech=${e(speech)}"
                val chime = c.optString("chime", "soundbank://soundlibrary/home/amzn_sfx_doorbell_chime_01")
                if (chime.isNotBlank()) q += "&chime=${e(chime)}"
                val text = c.optString("show", "")
                if (text.isNotBlank()) q += "&text_display=${e(text.replace("{table}", who))}&display_seconds=20"
                val conn = (URL(q).openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 10000 }
                try { val code = conn.responseCode; Hub.log(if (code in 200..299) "🔊 Alexa: $speech" else "🔇 Alexa didn't answer ($code)") } finally { conn.disconnect() }
            } catch (_: Exception) { Hub.log("🔇 Alexa unreachable") }
        }.start()
    }
}
