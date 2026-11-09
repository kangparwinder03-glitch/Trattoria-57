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
import android.widget.*
import java.util.UUID

@SuppressLint("MissingPermission")
class MainActivity : Activity() {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var devices: List<BluetoothDevice> = emptyList()
    private lateinit var picker: Spinner
    private lateinit var status: TextView
    private var cols = 32
    private val prefs by lazy { getSharedPreferences("t57", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cols = prefs.getInt("cols", 32)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad); setBackgroundColor(Color.rgb(246, 238, 221)) }
        fun label(t: String, size: Float = 16f, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(Color.rgb(46, 43, 31)); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, pad / 3, 0, pad / 3)
        }
        root.addView(label("Trattoria 57 — Print Test", 24f, true))
        root.addView(label("1. Pair the printer in Android Settings → Bluetooth first (PIN 0000 or 1234).\n2. Pick it below and print a test slip."))
        root.addView(label("Printer", 14f, true))
        picker = Spinner(this); root.addView(picker, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(Button(this).apply { text = "Refresh printer list"; setOnClickListener { loadDevices() } })
        root.addView(label("Paper width", 14f, true))
        val group = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        val r58 = RadioButton(this).apply { text = "58mm (32 chars)"; id = 58 }
        val r80 = RadioButton(this).apply { text = "80mm (48 chars)"; id = 80 }
        group.addView(r58); group.addView(r80); group.check(if (cols >= 48) 80 else 58)
        group.setOnCheckedChangeListener { _, id -> cols = if (id == 80) 48 else 32; prefs.edit().putInt("cols", cols).apply() }
        root.addView(group)
        val logoBox = CheckBox(this).apply { text = "Print the Trattoria 57 logo"; textSize = 16f; isChecked = prefs.getBoolean("logo", true)
            setOnCheckedChangeListener { _, on -> prefs.edit().putBoolean("logo", on).apply() } }
        root.addView(logoBox)
        fun action(t: String, make: (Int, Logos) -> ByteArray) = root.addView(Button(this).apply {
            text = t; textSize = 18f
            setOnClickListener { send(make(cols, if (logoBox.isChecked) Logo.forPaper(this@MainActivity, cols) else Logos.NONE), t) }
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = pad / 3 })
        action("🖨  Print test slip") { c, l -> Samples.test(c, l) }
        action("🍝  Sample kitchen ticket") { c, l -> Samples.kitchenTicket(c, l) }
        action("🍸  Sample bar ticket") { c, l -> Samples.barTicket(c, l) }
        action("🥡  Sample pickup ticket") { c, l -> Samples.pickupTicket(c, l) }
        action("🧾  Sample bill") { c, l -> Samples.bill(c, l) }
        action("📊  Sample end-of-day report") { c, l -> Samples.dayReport(c, l) }
        status = label("", 15f, true).apply { gravity = Gravity.CENTER; setPadding(0, pad, 0, 0) }
        root.addView(status)
        setContentView(ScrollView(this).apply { addView(root, MATCH_PARENT, WRAP_CONTENT) })
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN), 1)
        } else loadDevices()
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        if (results.isNotEmpty() && results.all { it == PackageManager.PERMISSION_GRANTED }) loadDevices()
        else say("Bluetooth permission is needed. Allow 'Nearby devices' in Settings → Apps → T57 Print Test.", false)
    }

    private fun adapter() = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

    private fun loadDevices() {
        val ad = adapter()
        if (ad == null) { say("This tablet has no Bluetooth.", false); return }
        if (!ad.isEnabled) { say("Turn Bluetooth on, then tap Refresh.", false); return }
        devices = ad.bondedDevices.toList().sortedBy { it.name ?: "" }
        picker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, devices.map { "${it.name ?: "Unknown"}  (${it.address})" })
        val saved = prefs.getString("printer", null)
        devices.indexOfFirst { it.address == saved }.takeIf { it >= 0 }?.let { picker.setSelection(it) }
        say(if (devices.isEmpty()) "No paired devices. Pair the printer in Settings → Bluetooth." else "${devices.size} paired device(s). Pick your printer.", devices.isNotEmpty())
    }

    private fun say(t: String, ok: Boolean) = runOnUiThread { status.text = t; status.setTextColor(if (ok) Color.rgb(62, 74, 34) else Color.rgb(166, 69, 43)) }

    private fun send(bytes: ByteArray, what: String) {
        val dev = devices.getOrNull(picker.selectedItemPosition) ?: run { say("Pick a printer first.", false); return }
        prefs.edit().putString("printer", dev.address).apply()
        say("Printing $what…", true)
        Thread {
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
                Thread.sleep(1200 + bytes.size / 20L)
                say("✓ Sent to ${dev.name}", true)
            } catch (e: Exception) {
                say("Couldn't print: ${e.message}\nIs the printer on, charged and paired?", false)
            } finally { try { sock?.close() } catch (ignored: Exception) {} }
        }.start()
    }
}
