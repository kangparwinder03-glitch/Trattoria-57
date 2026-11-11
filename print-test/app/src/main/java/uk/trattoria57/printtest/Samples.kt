package uk.trattoria57.printtest

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Sample slips in the same layout the real hub app will print. */
object Samples {
    private fun now() = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.UK).format(Date())

    /** Logo (or the name in big letters if the logo is switched off), then the address. */
    private fun header(p: EscPos, lg: Logos) {
        if (lg.full != null) p.image(lg.full).align(1)
        else p.align(1).bold(true).line("T R A T T O R I A").size(2, 2).line("57").size(1, 1).line("ITALIAN KITCHEN & BAR").bold(false)
        p.line("55/57 Gisburn Road, Barnoldswick").line("BB18 5HB  ·  01282 816554").align(0).rule('=')
    }

    /** Smaller logo for kitchen, bar and pickup tickets. */
    private fun smallHeader(p: EscPos, lg: Logos) {
        if (lg.small != null) p.image(lg.small).feed(1)
        else p.align(1).bold(true).line("TRATTORIA 57").bold(false).align(0)
    }

    fun test(cols: Int, lg: Logos) = EscPos(cols).apply {
        image(lg.full); feed(1)
        align(1).bold(true).size(2, 2).line("PRINT TEST").size(1, 1).bold(false)
        line("Trattoria 57 print test").line(now()).line("Paper width: ${if (cols >= 48) "80mm" else "58mm"} ($cols chars)")
        rule(); align(0); line("Normal text 0123456789"); bold(true).line("Bold text £12.90").bold(false)
        size(2, 1).line("Wide text").size(1, 1); size(1, 2).line("Tall text").size(1, 1)
        rule(); lr("Left", "Right"); line("Pound sign: £  Dot: ·  Accent: é")
        align(1).line("If you can read this,").line("printing works!").align(0); feed(4); cut()
    }.bytes()

    fun kitchenTicket(cols: Int, lg: Logos) = EscPos(cols).apply {
        smallHeader(this, lg)
        align(1).bold(true).line("*** KITCHEN ***").size(2, 2).line("TABLE 5").size(1, 1).bold(false)
        line("Order #7 · ${now()}").line("Waiter: Gopi").align(0).rule()
        bold(true).size(1, 2).line("2 x Pizza Diavola").size(1, 1).bold(false).line("    > Gluten free")
        bold(true).size(1, 2).line("1 x Spaghetti Carbonara").size(1, 1).bold(false)
        bold(true).size(1, 2).line("1 x Fracosta di Bue").size(1, 1).bold(false).line("    > Medium")
        rule(); align(1).bold(true).size(1, 2).line("!! NUT ALLERGY AT TABLE !!").size(1, 1).bold(false).align(0); feed(4); cut()
    }.bytes()

    fun barTicket(cols: Int, lg: Logos) = EscPos(cols).apply {
        smallHeader(this, lg)
        align(1).bold(true).line("*** BAR ***").size(2, 2).line("TABLE B4").size(1, 1).bold(false)
        line("Order #8 · ${now()}").line("Waiter: Gopi").align(0).rule()
        bold(true).size(1, 2).line("2 x Peroni · Pint").line("1 x Aperol Spritz").line("1 x Coke · Regular").size(1, 1).bold(false).line("    > No ice")
        rule(); feed(4); cut()
    }.bytes()

    fun pickupTicket(cols: Int, lg: Logos) = EscPos(cols).apply {
        smallHeader(this, lg)
        align(1).bold(true).line("*** PICKUP ***").size(3, 3).line("#57").size(1, 1).line("Dave · 07700 900111").bold(false)
        line(now()).align(0).rule()
        bold(true).size(1, 2).line("1 x Pizza Margherita").line("1 x Garlic Bread").size(1, 1).bold(false)
        rule(); feed(4); cut()
    }.bytes()

    fun bill(cols: Int, lg: Logos) = EscPos(cols).apply {
        header(this, lg); lr("Table 1", now()); rule()
        lr("2 x Fracosta di Bue", "£55.80"); lr("1 x Coke · Pint", "£4.80"); rule()
        lr("Subtotal", "£60.60"); lr("Discount 10% (Friends)", "-£6.06"); rule('=')
        bold(true).size(1, 2).lr("TOTAL", "£54.54").size(1, 1).bold(false); rule('=')
        align(1).line("Grazie! Thank you for").line("dining with us.").align(0)
        social(listOf(Triple("Instagram", "@trattoria_57", "https://www.instagram.com/trattoria_57/"), Triple("Facebook", "Trattoria 57", "https://www.facebook.com/share/1BcKcA1rHr/")))
        feed(4); cut()
    }.bytes()

    fun dayReport(cols: Int, lg: Logos) = EscPos(cols).apply {
        header(this, lg)
        align(1).bold(true).size(1, 2).line("END OF DAY REPORT").size(1, 1).line("Trattoria 57").bold(false).line(now()).align(0); rule()
        bold(true).size(1, 2).lr("TAKINGS", "£1,284.50").size(1, 1).bold(false)
        lr("Card", "£1,032.20"); lr("Cash", "£252.30"); lr("Discounts (6 bills)", "£48.90"); lr("Voids (2)", "£16.40"); lr("Still open", "£0.00"); rule()
        lr("Covers", "58"); lr("Spend per head", "£22.15"); lr("Orders", "41"); lr("Pickup orders", "9"); lr("Avg kitchen time", "18 min"); rule()
        bold(true).line("BEST SELLERS").bold(false)
        lr("1. Pizza Margherita x14", "£161.00"); lr("2. Spaghetti Carbonara x9", "£116.10"); lr("3. Peroni Pint x22", "£132.00"); rule()
        bold(true).line("SALES BY WAITER").bold(false); lr("Gopi", "£702.10"); lr("Maria", "£582.40"); rule()
        bold(true).line("STAFF HOURS").bold(false); lr("Maria", "7h 30m"); lr("Luca", "8h 05m"); lr("Total", "15h 35m"); rule()
        bold(true).line("CASH-UP").bold(false); lr("Cash expected", "£252.30"); line(); line("Counted: £__________"); line(); line("Signed: ____________")
        rule('='); align(1).bold(true).line("TRATTORIA 57").bold(false).line("Italian Kitchen & Bar").align(0)
        feed(5); cut()
    }.bytes()

    private fun bar(v: Double, max: Double, w: Int) = "\u2588".repeat(if (max > 0) Math.round(v / max * w).toInt() else 0)

    private fun period(cols: Int, lg: Logos, title: String, range: String, days: List<Pair<String, Double>>, weekdays: List<Pair<String, Double>>?) = EscPos(cols).apply {
        header(this, lg)
        align(1).bold(true).size(1, 2).line(title).size(1, 1).line("Trattoria 57").bold(false).line(range).line("** TEST - SAMPLE NUMBERS **").align(0); rule()
        val tot = days.sumOf { it.second }
        bold(true).size(1, 2).lr("TAKINGS", "£%,.2f".format(Locale.UK, tot)).size(1, 1).bold(false)
        lr("vs previous", "+8%"); lr("Card", "£%,.2f".format(Locale.UK, tot * 0.8)); lr("Cash", "£%,.2f".format(Locale.UK, tot * 0.2)); lr("Discounts", "£96.40"); rule()
        lr("Covers", (tot / 23).toInt().toString()); lr("Spend per head", "£23.10"); lr("Avg per day open", "£%,.2f".format(Locale.UK, tot / days.count { it.second > 0 })); rule()
        bold(true).line("SALES BY DAY").bold(false)
        val mx = days.maxOf { it.second }; val w = if (cols >= 48) 30 else 16
        days.forEach { (d, v) -> line("${d.padEnd(4)}${bar(v, mx, w).padEnd(w)} £${v.toInt()}") }
        if (weekdays != null) { rule(); bold(true).line("BY WEEKDAY").bold(false); val wm = weekdays.maxOf { it.second }
            weekdays.forEach { (d, v) -> line("${d.padEnd(4)}${bar(v, wm, w).padEnd(w)} £${v.toInt()}") } }
        rule(); bold(true).line("HIGHLIGHTS").bold(false)
        bold(true).line("Most sold:").bold(false).line("  Pizza Margherita (96)")
        bold(true).line("Least sold:").bold(false).line("  Calzone (2)")
        bold(true).line("Best dish:").bold(false).line("  Pizza Margherita (96)")
        bold(true).line("Best drink:").bold(false).line("  Peroni · Pint (141)")
        bold(true).line("Busiest hour:").bold(false).line("  19:00 - 20:00"); rule()
        bold(true).line("TOP 5").bold(false)
        listOf("Peroni · Pint" to 141, "Pizza Margherita" to 96, "Spaghetti Carbonara" to 71, "Aperol Spritz" to 64, "Garlic Bread" to 52).forEachIndexed { i, (n, q) ->
            lr("${i + 1}. $n", "x$q"); line("   " + bar(q.toDouble(), 141.0, w)) }
        rule(); bold(true).line("FOOD VS DRINK").bold(false)
        lr("Food", "£%,.2f".format(Locale.UK, tot * 0.62)); line("   " + bar(62.0, 62.0, w)); lr("Drinks", "£%,.2f".format(Locale.UK, tot * 0.38)); line("   " + bar(38.0, 62.0, w))
        rule(); bold(true).line("STAFF HOURS").bold(false); lr("Maria", "38h 30m"); lr("Luca", "41h 05m"); bold(true).lr("Total", "79h 35m").bold(false)
        rule('='); align(1).bold(true).line("TRATTORIA 57").bold(false).line("Italian Kitchen & Bar").align(0)
        feed(5); cut()
    }.bytes()

    fun weekReport(cols: Int, lg: Logos) = period(cols, lg, "WEEKLY REPORT", "Mon 9 Nov - Sun 15 Nov",
        listOf("Mon" to 0.0, "Tue" to 642.5, "Wed" to 718.2, "Thu" to 905.4, "Fri" to 1640.8, "Sat" to 1987.3, "Sun" to 1210.6), null)

    fun monthReport(cols: Int, lg: Logos): ByteArray {
        val base = listOf(0.0, 640.0, 710.0, 900.0, 1650.0, 1980.0, 1200.0)
        val days = (1..30).map { d -> val wd = (d + 5) % 7; d.toString().padStart(2) to base[wd] * (0.85 + (d * 37 % 30) / 100.0) }
        val names = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        val wk = names.mapIndexed { i, n -> n to days.filterIndexed { d, _ -> (d + 6) % 7 == i }.sumOf { it.second } }
        return period(cols, lg, "MONTHLY REPORT", "November 2026", days, wk)
    }
}
