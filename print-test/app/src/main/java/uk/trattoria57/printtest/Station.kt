package uk.trattoria57.printtest

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Talks to the Trattoria 57 database (Supabase) — the same one the website uses. */
object Cloud {
    const val BASE = "https://uzrkewizkqdnqpovwune.supabase.co"
    const val KEY = "sb_publishable_Hix2EgA_xpjxMYFvmarVIQ_Hj0qx3YM"

    private fun conn(path: String, method: String) = (URL(BASE + path).openConnection() as HttpURLConnection).apply {
        requestMethod = method; connectTimeout = 8000; readTimeout = 12000
        setRequestProperty("apikey", KEY); setRequestProperty("Authorization", "Bearer $KEY")
        setRequestProperty("Content-Type", "application/json"); setRequestProperty("Accept", "application/json")
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** Saved items in a collection, filtered on text fields (e.g. "date" to "2026-11-09"). */
    fun list(coll: String, filters: List<Pair<String, String>>): List<Pair<String, JSONObject>> {
        val q = StringBuilder("/rest/v1/t57_docs?select=id,data&coll=eq.").append(enc(coll))
        filters.forEach { (k, v) -> q.append('&').append(enc("data->>$k")).append("=eq.").append(enc(v)) }
        val c = conn(q.toString(), "GET")
        try {
            if (c.responseCode !in 200..299) throw Exception("HTTP ${c.responseCode} " + (c.errorStream?.bufferedReader()?.readText()?.take(100) ?: ""))
            val arr = JSONArray(c.inputStream.bufferedReader().readText())
            return (0 until arr.length()).map { val o = arr.getJSONObject(it); o.getString("id") to o.getJSONObject("data") }
        } finally { c.disconnect() }
    }

    /** Adds fields to a saved item (used to mark an order as printed). */
    fun merge(coll: String, id: String, patch: JSONObject) {
        val c = conn("/rest/v1/rpc/t57_merge", "POST"); c.doOutput = true
        try {
            c.outputStream.use { it.write(JSONObject().put("c", coll).put("i", id).put("patch", patch).toString().toByteArray()) }
            if (c.responseCode !in 200..299) throw Exception("HTTP ${c.responseCode}")
        } finally { c.disconnect() }
    }
}

/** Turns orders and print jobs from the website into printer slips. */
object Format {
    private val ALG = Regex("allerg|gluten|coeliac|celiac|dairy|lactose|\\bnuts?\\b|peanut|shellfish|prawn|\\begg|sesame|vegan|soya|\\bfish\\b|mustard|celery|anaphyl", RegexOption.IGNORE_CASE)

    fun ticket(t: JSONObject, cols: Int, lg: Logos, copy: Int = 1, copies: Int = 1, training: Boolean = false): ByteArray = EscPos(cols).apply {
        val bar = t.optString("station") == "bar"
        if (lg.small != null) image(lg.small).feed(1) else align(1).bold(true).line("TRATTORIA 57").bold(false)
        align(1).bold(true).line(if (bar) "*** BAR ***" else "*** KITCHEN ***")
        if (training) line("** TRAINING - NOT REAL **")
        if (copies > 1) line("Copy $copy of $copies")
        if (t.optBoolean("pickup")) {
            line("PICKUP").size(3, 3).line("#" + t.optInt("pno")).size(1, 1)
            val who = listOf(t.optString("pname"), t.optString("pphone")).filter { it.isNotBlank() }.joinToString(" · ")
            if (who.isNotBlank()) line(who)
        } else size(2, 2).line(t.optString("label").uppercase(Locale.UK)).size(1, 1)
        bold(false)
        val time = SimpleDateFormat("HH:mm", Locale.UK).format(Date(t.optLong("createdAt", System.currentTimeMillis())))
        val covers = t.optInt("covers")
        line("Order #${t.optInt("no")} · $time" + if (covers > 0) " · $covers covers" else "")
        val by = t.optString("byName")
        if (t.optBoolean("qr")) line("Ordered by QR code") else if (by.isNotBlank()) line("Waiter: $by")
        align(0).rule()
        var alg = ALG.containsMatchIn(t.optString("note"))
        var total = 0.0
        val items = t.optJSONArray("items") ?: JSONArray()
        for (i in 0 until items.length()) {
            val x = items.getJSONObject(i); if (x.optBoolean("v")) continue
            val q = x.optInt("q", 1); val amt = q * x.optDouble("p", 0.0); total += amt
            val name = "$q x ${x.optString("n")}"; val price = money(amt)
            bold(true).size(1, 2)
            if (name.length + price.length + 1 > cols) line(name).lr("", price) else lr(name, price)
            size(1, 1).bold(false)
            val guest = x.optString("g")
            if (guest.isNotBlank()) line("   for: $guest")
            val note = x.optString("note")
            if (note.isNotBlank()) {
                if (ALG.containsMatchIn(note)) { alg = true; bold(true).line("   > !! $note").bold(false) } else line("   > $note")
            }
        }
        rule()
        bold(true).lr("TOTAL", money(total)).bold(false)
        rule()
        val tn = t.optString("note")
        if (tn.isNotBlank()) { bold(true).line("NOTE: $tn").bold(false); rule() }
        if (alg) align(1).bold(true).size(1, 2).line("!! ALLERGY - CHECK NOTES !!").size(1, 1).bold(false).align(0)
        feed(4); cut()
    }.bytes()

    /** Bills and reports: the website sends ready-made lines. */
    fun job(j: JSONObject, cols: Int, lg: Logos): ByteArray = EscPos(cols).apply {
        val logo = j.optString("logo", "full")
        if (logo == "small") { if (lg.small != null) image(lg.small).feed(1) }
        else if (logo != "none") {
            if (lg.full != null) image(lg.full) else align(1).bold(true).line("T R A T T O R I A").size(2, 2).line("57").size(1, 1).line("ITALIAN KITCHEN & BAR").bold(false)
            align(1).line("55/57 Gisburn Road, Barnoldswick").line("BB18 5HB  ·  01282 816554").align(0).rule('=')
        }
        val lines = j.optJSONArray("lines") ?: JSONArray()
        for (i in 0 until lines.length()) {
            val o = lines.optJSONObject(i) ?: continue
            val b = o.optInt("b") == 1
            when {
                o.has("rule") -> rule(o.optString("rule").firstOrNull() ?: '-')
                o.has("l") -> bold(b).lr(o.optString("l"), o.optString("r")).bold(false)
                else -> {
                    val s = o.optInt("s", 1)
                    align(when (o.optString("a")) { "c" -> 1; "r" -> 2; else -> 0 }).bold(b)
                    if (s > 1) size(1, 2)
                    line(o.optString("t"))
                    if (s > 1) size(1, 1)
                    bold(false).align(0)
                }
            }
        }
        // review codes: "reviews" = [{n,u}] (Google, TripAdvisor…); older pages send a single "review" link
        val revArr = j.optJSONArray("reviews")
        val reviews = if (revArr != null) (0 until revArr.length()).mapNotNull { revArr.optJSONObject(it) }
            .filter { it.optString("u").isNotBlank() }.map { it.optString("n") to it.optString("u") }
            else j.optString("review").let { if (it.isNotBlank()) listOf("" to it) else emptyList() }
        if (reviews.isNotEmpty()) {
            rule(); align(1).bold(true).size(1, 2).line("ENJOYED YOUR MEAL?").size(1, 1).bold(false)
            line("Scan to leave us a review")
            reviews.forEachIndexed { i, (name, url) ->
                feed(if (i == 0) 2 else 3)
                qr(url, if (cols >= 48) 7 else 6)
                if (name.isNotBlank()) { feed(1); bold(true).line(name).bold(false) }
            }
            feed(1); line("Grazie mille!"); align(0)
        }
        val soc = j.optJSONArray("social")
        if (soc != null) social((0 until soc.length()).mapNotNull { soc.optJSONObject(it) }
            .filter { it.optString("u").isNotBlank() }.map { Triple(it.optString("n"), it.optString("h"), it.optString("u")) })
        feed(4); cut()
    }.bytes()
}

private fun money(v: Double) = "£" + String.format(Locale.UK, "%.2f", v)
