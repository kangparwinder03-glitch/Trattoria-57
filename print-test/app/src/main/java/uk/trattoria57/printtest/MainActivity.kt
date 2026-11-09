package uk.trattoria57.printtest

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.*
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Trattoria 57 Printer.
 * Leave this open on the kitchen or bar tablet: it checks for new orders every few seconds
 * and prints them on the Bluetooth printer. Bills and day reports sent from the website print too.
 */
@SuppressLint("MissingPermission", "SetTextI18n")
class MainActivity : Activity() {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var devices: List<BluetoothDevice> = emptyList()
    private var printer: BluetoothDevice? = null
    private lateinit var picker: Spinner
    private lateinit var status: TextView
    private lateinit var netStatus: TextView
    private lateinit var log: TextView
    private lateinit var startBtn: Button
    private lateinit var logoBox: CheckBox
    private var cols = 32
    private var station = "kitchen"
    @Volatile private var running = false
    private var worker: Thread? = null
    private var lastSlip: ByteArray? = null
    private val printLock = Any()
    private val logLines = ArrayDeque<String>()
    private val prefs by lazy { getSharedPreferences("t57", Context.MODE_PRIVATE) }

    private val olive = Color.rgb(62, 74, 34)
    private val wine = Color.rgb(166, 69, 43)
    private val ink = Color.rgb(46, 43, 31)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cols = prefs.getInt("cols", 32)
        station = prefs.getString("station", "kitchen") ?: "kitchen"
        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad); setBackgroundColor(Color.rgb(246, 238, 221)) }
        fun label(t: String, size: Float = 16f, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(ink); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, pad / 3, 0, pad / 3)
        }
        fun button(t: String, size: Float = 17f, click: () -> Unit) = Button(this).apply { text = t; textSize = size; isAllCaps = false; setOnClickListener { click() } }
        val full = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = pad / 3 }

        root.addView(label("Trattoria 57 — Printer", 26f, true))

        // ---- which station ----
        root.addView(label("This tablet prints for", 14f, true))
        val stGroup = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        val rK = RadioButton(this).apply { text = "🍝 Kitchen  "; textSize = 18f; id = 1 }
        val rB = RadioButton(this).apply { text = "🍸 Bar"; textSize = 18f; id = 2 }
        stGroup.addView(rK); stGroup.addView(rB); stGroup.check(if (station == "bar") 2 else 1)
        stGroup.setOnCheckedChangeListener { _, id -> station = if (id == 2) "bar" else "kitchen"; prefs.edit().putString("station", station).apply(); addLog("Now printing for the ${station.uppercase(Locale.UK)}") }
        root.addView(stGroup)

        // ---- printer ----
        root.addView(label("Printer (pair it in Android Settings → Bluetooth first)", 14f, true))
        picker = Spinner(this); root.addView(picker, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(button("Refresh printer list", 15f) { loadDevices() })
        val wGroup = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        val r58 = RadioButton(this).apply { text = "58mm paper  "; id = 58 }
        val r80 = RadioButton(this).apply { text = "80mm paper"; id = 80 }
        wGroup.addView(r58); wGroup.addView(r80); wGroup.check(if (cols >= 48) 80 else 58)
        wGroup.setOnCheckedChangeListener { _, id -> cols = if (id == 80) 48 else 32; prefs.edit().putInt("cols", cols).apply() }
        root.addView(wGroup)
        root.addView(label("Copies of each order ticket", 14f, true))
        val cGroup = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        listOf(1, 2, 3).forEach { n -> cGroup.addView(RadioButton(this).apply { text = "$n   "; textSize = 18f; id = 100 + n }) }
        cGroup.check(100 + prefs.getInt("copies", 1))
        cGroup.setOnCheckedChangeListener { _, id -> prefs.edit().putInt("copies", id - 100).apply(); addLog("Order tickets now print ${id - 100}x") }
        root.addView(cGroup)
        logoBox = CheckBox(this).apply { text = "Print the Trattoria 57 logo"; textSize = 16f; isChecked = prefs.getBoolean("logo", true)
            setOnCheckedChangeListener { _, on -> prefs.edit().putBoolean("logo", on).apply() } }
        root.addView(logoBox)

        // ---- start / stop ----
        startBtn = button("▶  Start printing orders", 22f) { if (running) stopStation() else startStation() }
        root.addView(startBtn, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = pad / 2 })
        status = label("", 16f, true).apply { gravity = Gravity.CENTER }
        root.addView(status)
        netStatus = label("", 14f).apply { gravity = Gravity.CENTER }
        root.addView(netStatus)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(button("🔁 Reprint last", 15f) { val b = lastSlip; if (b == null) say("Nothing printed yet.", false) else Thread { printNow(b, "Reprint") }.start() }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        row.addView(button("⏭ Skip waiting orders", 15f) { prefs.edit().putLong("since", System.currentTimeMillis()).apply(); addLog("Older orders skipped — only new ones will print") }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        root.addView(row)
        root.addView(label("Printed", 14f, true))
        log = label("—", 14f).apply { setTextColor(Color.rgb(90, 84, 64)) }
        root.addView(log)

        // ---- test slips ----
        root.addView(label("Test prints", 14f, true).apply { setPadding(0, pad, 0, pad / 3) })
        fun test(t: String, make: (Int, Logos) -> ByteArray) = root.addView(button(t, 15f) { val b = make(cols, logos()); Thread { printNow(b, t) }.start() }, full)
        test("🖨  Test slip") { c, l -> Samples.test(c, l) }
        test("🍝  Sample kitchen ticket") { c, l -> Samples.kitchenTicket(c, l) }
        test("🍸  Sample bar ticket") { c, l -> Samples.barTicket(c, l) }
        test("🧾  Sample bill") { c, l -> Samples.bill(c, l) }
        test("📊  Sample end-of-day report") { c, l -> Samples.dayReport(c, l) }

        setContentView(ScrollView(this).apply { addView(root, MATCH_PARENT, WRAP_CONTENT) })
        updateButton()
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN), 1)
        } else { loadDevices(); if (prefs.getBoolean("running", false)) startStation() }
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        if (results.isNotEmpty() && results.all { it == PackageManager.PERMISSION_GRANTED }) { loadDevices(); if (prefs.getBoolean("running", false)) startStation() }
        else say("Bluetooth permission is needed. Allow 'Nearby devices' in Settings → Apps → T57 Printer.", false)
    }

    override fun onDestroy() { running = false; super.onDestroy() }

    private fun logos() = if (logoBox.isChecked) Logo.forPaper(this, cols) else Logos.NONE
    private fun adapter() = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private fun loadDevices() {
        val ad = adapter()
        if (ad == null) { say("This tablet has no Bluetooth.", false); return }
        if (!ad.isEnabled) { say("Turn Bluetooth on, then tap Refresh.", false); return }
        devices = ad.bondedDevices.toList().sortedBy { it.name ?: "" }
        picker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, devices.map { "${it.name ?: "Unknown"}  (${it.address})" })
        val saved = prefs.getString("printer", null)
        devices.indexOfFirst { it.address == saved }.takeIf { it >= 0 }?.let { picker.setSelection(it) }
        picker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: android.view.View?, pos: Int, id: Long) { printer = devices.getOrNull(pos); printer?.let { prefs.edit().putString("printer", it.address).apply() } }
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        printer = devices.getOrNull(picker.selectedItemPosition)
        if (!running) say(if (devices.isEmpty()) "No paired devices. Pair the printer in Settings → Bluetooth." else "Pick your printer, then tap Start.", devices.isNotEmpty())
    }

    // ---------- station loop ----------
    private fun startStation() {
        if (printer == null) { say("Pick a printer first.", false); return }
        if (prefs.getLong("since", 0L) == 0L) prefs.edit().putLong("since", System.currentTimeMillis()).apply()
        running = true; prefs.edit().putBoolean("running", true).apply()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        updateButton(); say("🟢 Printing ${station.uppercase(Locale.UK)} orders automatically", true)
        worker = Thread {
            while (running) {
                try { poll(); net("Connected · checked ${SimpleDateFormat("HH:mm:ss", Locale.UK).format(Date())}", true) }
                catch (e: Exception) { net("⚠ Can't reach orders (${e.message ?: "no internet"}) — retrying", false) }
                try { Thread.sleep(3000) } catch (_: InterruptedException) { break }
            }
        }.apply { isDaemon = true; start() }
    }

    private fun stopStation() {
        running = false; prefs.edit().putBoolean("running", false).apply(); worker?.interrupt()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        updateButton(); say("Stopped — orders won't print until you tap Start.", false); net("", true)
    }

    private fun updateButton() = runOnUiThread {
        startBtn.text = if (running) "⏹  Stop printing" else "▶  Start printing orders"
        startBtn.setBackgroundColor(if (running) wine else olive); startBtn.setTextColor(Color.WHITE)
    }

    private fun poll() {
        val st = station
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.UK).format(Date())
        val since = prefs.getLong("since", 0L)
        val done = prefs.getStringSet("done", emptySet())!!.toMutableSet()
        // orders for this station
        val tickets = Cloud.list("tickets", listOf("date" to today, "station" to st))
            .filter { (id, d) -> id !in done && !d.optBoolean("hold") && !d.optBoolean("rejected") && d.optLong("printed", 0L) == 0L && d.optLong("createdAt") >= since }
            .sortedBy { it.second.optLong("createdAt") }
        for ((id, d) in tickets) {
            if (!running || station != st) return
            val label = if (d.optBoolean("pickup")) "Pickup #${d.optInt("pno")}" else d.optString("label")
            val copies = prefs.getInt("copies", 1).coerceIn(1, 3)
            val lg = logos()
            val bytes = (1..copies).map { Format.ticket(d, cols, lg, it, copies) }.reduce { a, b -> a + b }
            if (!printNow(bytes, "$label · order #${d.optInt("no")}" + if (copies > 1) " (x$copies)" else "")) return
            markDone(done, "tickets", id)
        }
        // bills and reports sent from the website
        val jobs = Cloud.list("printjobs", listOf("to" to st))
            .filter { (id, d) -> id !in done && d.optLong("printed", 0L) == 0L && d.optLong("createdAt") >= System.currentTimeMillis() - 2 * 3600_000L }
            .sortedBy { it.second.optLong("createdAt") }
        for ((id, d) in jobs) {
            if (!running) return
            if (!printNow(Format.job(d, cols, logos()), d.optString("title", "Print"))) return
            markDone(done, "printjobs", id)
        }
    }

    private fun markDone(done: MutableSet<String>, coll: String, id: String) {
        done.add(id)
        val keep = if (done.size > 600) done.toList().takeLast(400).toMutableSet() else done
        prefs.edit().putStringSet("done", keep).apply()
        try { Cloud.merge(coll, id, JSONObject().put("printed", System.currentTimeMillis()).put("printedBy", station)) } catch (_: Exception) {}
    }

    // ---------- Bluetooth ----------
    /** Prints and waits. Returns false if the printer couldn't be reached (the order is tried again later). */
    private fun printNow(bytes: ByteArray, what: String): Boolean = synchronized(printLock) {
        val dev = printer ?: run { say("Pick a printer first.", false); return false }
        var sock: BluetoothSocket? = null
        try {
            adapter()?.cancelDiscovery()
            val s: BluetoothSocket = try { dev.createRfcommSocketToServiceRecord(spp).also { it.connect() } }
                catch (e: Exception) { dev.createInsecureRfcommSocketToServiceRecord(spp).also { it.connect() } }
            sock = s
            // send in small pieces: cheap printers drop data (and garble the logo) if it arrives too fast
            val os = s.outputStream
            var i = 0
            while (i < bytes.size) { val n = minOf(512, bytes.size - i); os.write(bytes, i, n); os.flush(); i += n; Thread.sleep(25) }
            Thread.sleep(1000 + bytes.size / 20L)
            lastSlip = bytes
            addLog("✓ $what")
            if (running) say("🟢 Printing ${station.uppercase(Locale.UK)} orders automatically", true) else say("✓ Printed: $what", true)
            true
        } catch (e: Exception) {
            say("⚠ Printer not responding — is it on, charged and in paper? Will retry.", false)
            false
        } finally { try { sock?.close() } catch (ignored: Exception) {} }
    }

    // ---------- screen helpers ----------
    private fun say(t: String, ok: Boolean) = runOnUiThread { status.text = t; status.setTextColor(if (ok) olive else wine) }
    private fun net(t: String, ok: Boolean) = runOnUiThread { netStatus.text = t; netStatus.setTextColor(if (ok) Color.rgb(110, 104, 84) else wine) }
    private fun addLog(t: String) = runOnUiThread {
        logLines.addFirst("${SimpleDateFormat("HH:mm", Locale.UK).format(Date())}  $t")
        while (logLines.size > 15) logLines.removeLast()
        log.text = logLines.joinToString("\n")
    }
}
