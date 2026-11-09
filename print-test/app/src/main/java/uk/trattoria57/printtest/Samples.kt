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
}
