package uk.trattoria57.printtest

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.*
import java.util.Locale

/**
 * Trattoria 57 Printer — the screen.
 * Pick Kitchen, Bar or Till and the printer, then Start. Printing then carries on in the background
 * (small notification at the top), so the tablet can be used for other things, like taking orders.
 */
@SuppressLint("MissingPermission", "SetTextI18n")
class MainActivity : Activity() {
    private var devices: List<BluetoothDevice> = emptyList()
    private lateinit var picker: Spinner
    private lateinit var status: TextView
    private lateinit var netStatus: TextView
    private lateinit var log: TextView
    private lateinit var startBtn: Button
    private lateinit var logoBox: CheckBox
    private lateinit var cGroup: RadioGroup
    private lateinit var copiesLabel: TextView
    private lateinit var cutBox: CheckBox
    private var cols = 32
    private var station = "kitchen"
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

        // ---- restaurant sign-in ----
        Cloud.init(this)
        val authInfo = label("", 15f, true)
        val emailIn = EditText(this).apply { hint = "Restaurant email"; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; textSize = 17f }
        val passIn = EditText(this).apply { hint = "Password"; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD; textSize = 17f }
        val signBtn = button("🔐 Sign in", 16f) {}
        fun showAuth() {
            val who = Cloud.signedInAs
            authInfo.text = if (who.isBlank()) "🔐 Not signed in — sign in with the restaurant login" else "🔐 Signed in as $who"
            authInfo.setTextColor(if (who.isBlank()) wine else olive)
            emailIn.visibility = if (who.isBlank()) android.view.View.VISIBLE else android.view.View.GONE
            passIn.visibility = emailIn.visibility
            signBtn.text = if (who.isBlank()) "🔐 Sign in" else "Sign out"
        }
        signBtn.setOnClickListener {
            if (Cloud.signedInAs.isNotBlank()) { Cloud.signOut(); showAuth(); return@setOnClickListener }
            val e = emailIn.text.toString().trim(); val pw = passIn.text.toString()
            if (e.isBlank() || pw.isBlank()) { authInfo.text = "Type the email and password first"; return@setOnClickListener }
            signBtn.isEnabled = false; authInfo.text = "Signing in…"
            Thread { val ok = Cloud.signIn(e, pw); runOnUiThread { signBtn.isEnabled = true; passIn.setText(""); showAuth(); if (!ok) { authInfo.text = "❌ Wrong email or password (or no internet)"; authInfo.setTextColor(wine) } } }.start()
        }
        root.addView(authInfo); root.addView(emailIn); root.addView(passIn); root.addView(signBtn)
        showAuth()

        // ---- which station ----
        root.addView(label("This tablet's printer is for", 14f, true))
        val stGroup = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        stGroup.addView(RadioButton(this).apply { text = "🍝 Kitchen  "; textSize = 18f; id = 1 })
        stGroup.addView(RadioButton(this).apply { text = "🍸 Bar  "; textSize = 18f; id = 2 })
        stGroup.addView(RadioButton(this).apply { text = "🧾 Till"; textSize = 18f; id = 3 })
        stGroup.check(when (station) { "bar" -> 2; "till" -> 3; else -> 1 })
        root.addView(stGroup)
        val stHelp = label("", 13f).apply { setTextColor(Color.rgb(110, 104, 84)) }
        root.addView(stHelp)

        // ---- printer ----
        root.addView(label("Printer (pair it in Android Settings → Bluetooth first)", 14f, true))
        picker = Spinner(this); root.addView(picker, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(button("Refresh printer list", 15f) { loadDevices() })
        val wGroup = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        wGroup.addView(RadioButton(this).apply { text = "58mm paper  "; id = 58 })
        wGroup.addView(RadioButton(this).apply { text = "80mm paper"; id = 80 })
        wGroup.check(if (cols >= 48) 80 else 58)
        wGroup.setOnCheckedChangeListener { _, id -> cols = if (id == 80) 48 else 32; prefs.edit().putInt("cols", cols).apply() }
        root.addView(wGroup)

        copiesLabel = label("Copies of each order ticket", 14f, true)
        root.addView(copiesLabel)
        cGroup = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        listOf(1, 2, 3).forEach { n -> cGroup.addView(RadioButton(this).apply { text = "$n   "; textSize = 18f; id = 100 + n }) }
        root.addView(cGroup)
        cutBox = CheckBox(this).apply { text = "This printer has an auto-cutter"; textSize = 16f }
        root.addView(cutBox)
        logoBox = CheckBox(this).apply { text = "Print the Trattoria 57 logo"; textSize = 16f; isChecked = prefs.getBoolean("logo", true)
            setOnCheckedChangeListener { _, on -> prefs.edit().putBoolean("logo", on).apply() } }
        root.addView(logoBox)

        fun showStation() {
            stHelp.text = when (station) {
                "till" -> "Till: prints bills, receipts and reports sent from the website. No kitchen or bar tickets."
                "bar" -> "Bar: prints drinks orders, plus any bills, receipts or reports sent to the bar."
                else -> "Kitchen: prints food orders, plus anything sent to the kitchen printer."
            }
            val tickets = station != "till"
            copiesLabel.visibility = if (tickets) android.view.View.VISIBLE else android.view.View.GONE
            cGroup.visibility = copiesLabel.visibility
            cutBox.setOnCheckedChangeListener(null)
            cutBox.isChecked = PrintService.cutterFor(prefs, station)
            cutBox.setOnCheckedChangeListener { _, on -> prefs.edit().putBoolean("cutter_$station", on).apply()
                Hub.log(if (on) "Auto-cut on for the ${PrintService.stationName(station)}" else "No cutter: extra paper fed so you can tear cleanly") }
            cGroup.setOnCheckedChangeListener(null)
            cGroup.check(100 + PrintService.copiesFor(prefs, station))
            cGroup.setOnCheckedChangeListener { _, id -> prefs.edit().putInt("copies_$station", id - 100).apply(); Hub.log("${PrintService.stationName(station)} tickets now print ${id - 100}x") }
        }
        showStation()
        stGroup.setOnCheckedChangeListener { _, id ->
            station = when (id) { 2 -> "bar"; 3 -> "till"; else -> "kitchen" }
            prefs.edit().putString("station", station).apply(); showStation()
            Hub.log("Now printing for the ${PrintService.stationName(station)}")
            if (PrintService.running) startPrinting()   // refreshes the notification
        }

        // ---- start / stop ----
        startBtn = button("▶  Start printing", 22f) { if (PrintService.running) stopPrinting() else startPrinting() }
        root.addView(startBtn, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = pad / 2 })
        status = label("", 16f, true).apply { gravity = Gravity.CENTER }
        root.addView(status)
        netStatus = label("", 14f).apply { gravity = Gravity.CENTER }
        root.addView(netStatus)
        root.addView(label("Printing carries on in the background — you can switch to the website or other apps. Keep the tablet on charge.", 13f).apply { setTextColor(Color.rgb(110, 104, 84)); gravity = Gravity.CENTER })
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(button("🔁 Reprint last", 15f) { val b = Hub.lastSlip; if (b == null) Hub.say("Nothing printed yet.", false) else Thread { Bt.print(this, b, "Reprint") }.start() }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        row.addView(button("⏭ Skip waiting orders", 15f) { prefs.edit().putLong("since", System.currentTimeMillis()).apply(); Hub.log("Older orders skipped — only new ones will print") }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        root.addView(row)
        root.addView(label("Printed", 14f, true))
        log = label("—", 14f).apply { setTextColor(Color.rgb(90, 84, 64)) }
        root.addView(log)

        // ---- test slips ----
        root.addView(label("Test prints", 14f, true).apply { setPadding(0, pad, 0, pad / 3) })
        fun test(t: String, make: (Int, Logos) -> ByteArray) = root.addView(button(t, 15f) {
            if (picker.selectedItemPosition < 0) { Hub.say("Pick a printer first.", false); return@button }
            EscPos.hasCutter = cutBox.isChecked
            val b = make(cols, if (logoBox.isChecked) Logo.forPaper(this, cols) else Logos.NONE); Thread { Bt.print(this, b, t) }.start() }, full)
        // updates: the app keeps itself up to date (needs "Install unknown apps" allowed once)
        root.addView(label("Updates", 16f, true))
        root.addView(label("Version " + Updater.installed(this) + " · updates install by themselves between 3am and 3pm", 13f, false))
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls())
            root.addView(button("🔓  Allow automatic updates (one time)", 15f) {
                startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:$packageName"))) }, full)
        root.addView(button("⬇  Check for update now", 15f) { Hub.say("Checking for updates…", true); Updater.check(this, true) }, full)
        test("🖨  Test slip") { c, l -> Samples.test(c, l) }
        test("🍝  Sample kitchen ticket") { c, l -> Samples.kitchenTicket(c, l) }
        test("🍸  Sample bar ticket") { c, l -> Samples.barTicket(c, l) }
        test("🧾  Sample bill") { c, l -> Samples.bill(c, l) }
        test("📊  Sample end-of-day report") { c, l -> Samples.dayReport(c, l) }
        test("📈  Sample weekly report") { c, l -> Samples.weekReport(c, l) }
        test("📅  Sample monthly report") { c, l -> Samples.monthReport(c, l) }

        setContentView(ScrollView(this).apply { addView(root, MATCH_PARENT, WRAP_CONTENT) })
        val need = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 31) { need += Manifest.permission.BLUETOOTH_CONNECT; need += Manifest.permission.BLUETOOTH_SCAN }
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing = need.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
        else { loadDevices(); if (prefs.getBoolean("running", false) && !PrintService.running) startPrinting() }
    }

    override fun onResume() { super.onResume(); Hub.ui = { refresh() }; refresh() }
    override fun onPause() { Hub.ui = null; super.onPause() }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        val btOk = Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        if (btOk) { loadDevices(); if (prefs.getBoolean("running", false) && !PrintService.running) startPrinting() }
        else Hub.say("Bluetooth permission is needed. Allow 'Nearby devices' in Settings → Apps → T57 Printer.", false)
    }

    private fun refresh() {
        status.text = Hub.status; status.setTextColor(if (Hub.statusOk) olive else wine)
        netStatus.text = Hub.net; netStatus.setTextColor(if (Hub.netOk) Color.rgb(110, 104, 84) else wine)
        log.text = Hub.logText()
        val on = PrintService.running
        startBtn.text = if (on) "⏹  Stop printing" else "▶  Start printing"
        startBtn.setBackgroundColor(if (on) wine else olive); startBtn.setTextColor(Color.WHITE)
    }

    private fun loadDevices() {
        val ad = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        if (ad == null) { Hub.say("This tablet has no Bluetooth.", false); return }
        if (!ad.isEnabled) { Hub.say("Turn Bluetooth on, then tap Refresh.", false); return }
        devices = ad.bondedDevices.toList().sortedBy { it.name ?: "" }
        picker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, devices.map { "${it.name ?: "Unknown"}  (${it.address})" })
        val saved = prefs.getString("printer", null)
        devices.indexOfFirst { it.address == saved }.takeIf { it >= 0 }?.let { picker.setSelection(it) }
        picker.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: android.view.View?, pos: Int, id: Long) { devices.getOrNull(pos)?.let { prefs.edit().putString("printer", it.address).apply() } }
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        devices.getOrNull(picker.selectedItemPosition)?.let { prefs.edit().putString("printer", it.address).apply() }
        if (!PrintService.running) Hub.say(if (devices.isEmpty()) "No paired devices. Pair the printer in Settings → Bluetooth." else "Pick your printer, then tap Start.", devices.isNotEmpty())
    }

    private fun startPrinting() {
        if (prefs.getString("printer", null) == null) { Hub.say("Pick a printer first.", false); return }
        if (prefs.getLong("since", 0L) == 0L) prefs.edit().putLong("since", System.currentTimeMillis()).apply()
        prefs.edit().putBoolean("running", true).apply()
        val i = Intent(this, PrintService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i) else startService(i)
        Hub.say("🟢 Printing ${PrintService.stationName(station)} automatically", true)
        status.postDelayed({ refresh() }, 300)
    }

    private fun stopPrinting() {
        prefs.edit().putBoolean("running", false).apply()
        stopService(Intent(this, PrintService::class.java))
        status.postDelayed({ refresh() }, 300)
    }
}
