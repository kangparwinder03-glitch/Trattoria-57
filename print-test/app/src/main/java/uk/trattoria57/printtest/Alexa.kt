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

    /** Does the announcement and says what happened (shown in the log / on the test button). */
    fun send(label: String, station: String, training: Boolean, fresh: Boolean = false): String {
        try {
            if (fresh || cfg == null || System.currentTimeMillis() - cfgAt > 30_000) {
                cfg = Cloud.list("alexa", emptyList()).firstOrNull { it.first == "main" }?.second
                cfgAt = System.currentTimeMillis()
            }
        } catch (e: Exception) { return "🔇 Alexa: couldn't read the settings (${e.message ?: "no internet"}) — is this printer app signed in?" }
        val c = cfg ?: return "🔇 Alexa: no settings saved yet — on the website go to ⭐ Manager → Kitchen Alexa and tap SAVE"
        if (!c.optBoolean("on")) return "🔇 Alexa is switched off (⭐ Manager → Kitchen Alexa → Switch on → Save)"
        if (!c.optBoolean(station, station == "kitchen")) return "🔇 Alexa isn't set to announce ${PrintService.stationName(station)} orders"
        val token = c.optString("token"); val device = c.optString("device")
        if (token.isBlank() || device.isBlank()) return "🔇 Alexa: token or speaker ID missing in the settings"
        return try {
            val who = label.replace("#", "").trim()
            val speech = (if (training) "Training. " else "") + c.optString("speech", "New order, {table}").ifBlank { "New order, {table}" }.replace("{table}", who)
            val e = { s: String -> URLEncoder.encode(s, "UTF-8") }
            var q = "https://api-v3.voicemonkey.io/announce?token=${e(token)}&device=${e(device)}&speech=${e(speech)}"
            q += "&chime=${e(c.optString("chime", "soundbank://soundlibrary/home/amzn_sfx_doorbell_chime_01"))}"
            val text = c.optString("show", "")
            if (text.isNotBlank()) q += "&text_display=${e(text.replace("{table}", who))}&display_seconds=20"
            val conn = (URL(q).openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 10000 }
            try {
                val code = conn.responseCode
                if (code in 200..299) "🔊 Alexa: $speech"
                else "🔇 Alexa: Voice Monkey said ${code} ${(conn.errorStream?.bufferedReader()?.readText() ?: "").take(80)}"
            } finally { conn.disconnect() }
        } catch (e: Exception) { "🔇 Alexa unreachable (${e.message ?: "no internet"})" }
    }

    fun announce(label: String, station: String, training: Boolean) {
        Thread { Hub.log(send(label, station, training)) }.start()
    }
}
