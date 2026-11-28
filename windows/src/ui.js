// The "Printers & backups" screen (same controls as the Android T57 Printer app, plus backups).
"use strict";
const { ipcRenderer } = require("electron");
const path = require("path");
const S = require("./src/station");
const B = require("./src/backup");
const fmt = require("./src/format");
const pics = require("./src/pictures");
const out = require("./src/send");
const { Cloud } = require("./src/cloud");
const { EscPos } = require("./src/escpos");

const $ = id => document.getElementById(id);
const radios = n => [...document.querySelectorAll(`input[name=${n}]`)];
const pick = (n, v) => radios(n).forEach(r => { r.checked = r.value === String(v); });
const picked = n => (radios(n).find(r => r.checked) || {}).value;
const { Hub } = S;

let station = localStorage.getItem("t57.edit") || S.on()[0] || "kitchen";
let devices = { printers: [], ports: [] };

// ---------- status ----------
function refresh() {
  $("status").textContent = Hub.status; $("status").className = Hub.statusOk ? "ok" : "bad";
  $("net").textContent = Hub.net; $("net").style.color = Hub.netOk ? "" : "var(--wine)";
  $("log").textContent = Hub.logs.length ? Hub.logs.join("\n") : "—";
  $("startBtn").textContent = S.running ? "⏹ Stop printing" : "▶ Start printing";
  $("startBtn").classList.toggle("on", S.running);
}
Hub.ui = refresh;

// ---------- sign-in ----------
function showAuth() {
  const who = Cloud.signedInAs;
  $("authInfo").textContent = who ? "🔐 Signed in as " + who : "🔐 Not signed in — sign in with the restaurant login";
  $("authInfo").className = who ? "ok" : "bad";
  $("authForm").classList.toggle("hide", !!who);
  $("signBtn").textContent = who ? "Sign out" : "🔐 Sign in";
}
async function signIn(email, pass) {
  $("signBtn").disabled = true; $("authInfo").textContent = "Signing in…";
  const ok = await Cloud.signIn(email, pass);
  if (ok) sendCreds();
  $("signBtn").disabled = false; $("pass").value = ""; showAuth();
  if (!ok) { $("authInfo").textContent = "❌ Wrong email or password (or no internet)"; $("authInfo").className = "bad"; }
  return ok;
}
$("signBtn").onclick = () => {
  if (Cloud.signedInAs) { Cloud.signOut(); ipcRenderer.invoke("hub-auth", null); showAuth(); return; }
  const e = $("email").value.trim(), p = $("pass").value;
  if (!e || !p) { $("authInfo").textContent = "Type the email and password first"; return; }
  signIn(e, p);
};

// ---------- the tablets connect to this computer (the restaurant hub) ----------
const { store } = require("./src/cloud");
function sendCreds() { const email = store.get("auth_email"), pass = store.get("auth_pass"); if (email && pass) ipcRenderer.invoke("hub-auth", { email, pass }); }
const ago = ms => { if (!ms) return "not yet"; const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? s + "s ago" : Math.round(s / 60) + " min ago"; };
let hubNow = null;
function showHub(h) {
  if (h) hubNow = h; h = hubNow; if (!h) return;
  if (!h.running) { $("hubInfo").innerHTML = "<span class='bad'>⚠ Tablets can't connect to this computer right now. They carry on online.</span>"; $("hubOnline").textContent = h.onlineMsg || ""; return; }
  $("hubInfo").innerHTML = `<span class="ok">🟢 Running</span> · <b>${h.tablets}</b> screen${h.tablets === 1 ? "" : "s"} connected now · ${h.linked} tablet${h.linked === 1 ? "" : "s"} linked · ${h.records} records kept here` +
    `<br><span class="mute">Address on the restaurant Wi-Fi: <b>${esc((h.urls || [])[0] || "no network")}</b></span>`;
  $("hubOnline").innerHTML = (h.onlineOk ? "☁ " : "<span class='bad'>☁ </span>") + esc(h.onlineMsg || "") +
    ` · last sent ${ago(h.lastPush)} · last checked ${ago(h.lastPull)}` + (h.waiting ? ` · <b>${h.waiting}</b> change${h.waiting === 1 ? "" : "s"} waiting to go online` : "");
}
ipcRenderer.on("hub-status", (_e, h) => showHub(h));
ipcRenderer.on("hub-log", (_e, t) => Hub.log(t));
ipcRenderer.on("hub-print", () => S.printNow());   // a new order or bill was just saved: print it straight away
setInterval(() => showHub(), 5000);

// ---------- printers on this computer ----------
async function loadDevices() {
  devices = await out.listDevices();
  const c = S.st(station).target;
  $("winSel").innerHTML = devices.printers.length ? devices.printers.map(n => `<option>${esc(n)}</option>`).join("") : "<option value=''>No printers installed in Windows</option>";
  $("comSel").innerHTML = devices.ports.length ? devices.ports.map(p => `<option value="${esc(p.port)}">${esc(p.port)} — ${esc(p.name)}</option>`).join("") : "<option value=''>No Bluetooth printers paired</option>";
  if (c.startsWith("win:")) $("winSel").value = c.slice(4);
  if (c.startsWith("com:")) $("comSel").value = c.slice(4);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
function showKind() { const k = picked("kind") || "ip"; $("kIp").classList.toggle("hide", k !== "ip"); $("kWin").classList.toggle("hide", k !== "win"); $("kCom").classList.toggle("hide", k !== "com"); }
radios("kind").forEach(r => r.onchange = showKind);
$("refresh").onclick = () => { loadDevices(); Hub.log("Printer list refreshed"); };
$("savePrn").onclick = async () => {
  const k = picked("kind") || "ip";
  const v = k === "ip" ? $("ip").value.trim() : k === "win" ? $("winSel").value : $("comSel").value;
  const s = station, nm = S.NAME[s];
  S.st(s).target = v ? k + ":" + v : ""; S.save();
  if (!v) { Hub.say(`${nm}: no printer picked.`, false); return; }
  Hub.say(`Checking the ${nm} printer (${v})…`, true);
  const ok = await S.probe(s);
  Hub.say(ok ? `🖨 ${nm}: printer found (${v})` : `⚠ No printer answering at ${v}. Check it's on, plugged in and the address is right.`, ok);
  Hub.log(`${nm} printer: ${k === "ip" ? "network" : k === "win" ? "USB" : "Bluetooth"} ${v}`);
};

// ---------- the station's settings ----------
function showStation() {
  [...document.querySelectorAll("#tabs button")].forEach(b => b.classList.toggle("sel", b.dataset.st === station));
  const nm = S.NAME[station], c = S.st(station);
  $("stHelp").textContent = ({ till: "Till: prints bills, receipts and reports sent from the restaurant app. No kitchen or bar tickets.",
    bar: "Bar: prints drinks orders, plus any bills, receipts or reports sent to the bar.",
    kitchen: "Kitchen: prints food orders, plus anything sent to the kitchen printer." })[station] +
    " This computer prints for: " + S.stationNames(S.on()) + ". The same printer can do several stations.";
  $("serveTxt").textContent = `✅ This computer prints the ${nm} tickets & slips`;
  $("serve").checked = S.on().includes(station);
  $("prnLabel").textContent = nm + " printer";
  const k = c.target ? c.target.slice(0, c.target.indexOf(":")) : "ip";
  pick("kind", k); showKind();
  $("ip").value = c.target.startsWith("ip:") ? c.target.slice(3) : "";
  if (c.target.startsWith("win:")) $("winSel").value = c.target.slice(4);
  if (c.target.startsWith("com:")) $("comSel").value = c.target.slice(4);
  pick("paper", c.cols >= 48 ? 48 : 32); pick("copies", c.copies);
  $("cutter").checked = c.cutter; $("big").checked = c.big; $("speak").checked = c.speak; $("buzz").checked = c.buzz;
  const tk = station !== "till";
  $("copiesBox").classList.toggle("hide", !tk);
  document.querySelectorAll(".tk").forEach(e => e.classList.toggle("hide", !tk));
  $("logo").checked = S.cfg.logo;
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { station = b.dataset.st; localStorage.setItem("t57.edit", station); showStation(); });
$("serve").onchange = async () => {
  const s = station, yes = $("serve").checked;
  S.setOn(s, yes);
  Hub.log(yes ? `Now printing for the ${S.NAME[s]}` : `Stopped printing for the ${S.NAME[s]}`);
  if (!yes && S.running) S.switchedOff(s);
  if (S.running && !S.on().length) await S.stop();
  showStation(); refresh();
};
radios("paper").forEach(r => r.onchange = () => { S.st(station).cols = +picked("paper"); S.save(); });
radios("copies").forEach(r => r.onchange = () => { S.st(station).copies = +picked("copies"); S.save(); Hub.log(`${S.NAME[station]} tickets now print ${picked("copies")}x`); });
const flag = (id, key, msgOn, msgOff) => $(id).onchange = () => { S.st(station)[key] = $(id).checked; S.save(); Hub.log($(id).checked ? msgOn() : msgOff()); };
flag("cutter", "cutter", () => `Auto-cut on for the ${S.NAME[station]}`, () => "No cutter: extra paper fed so you can tear cleanly");
flag("big", "big", () => `${S.NAME[station]} tickets: extra-large text`, () => `${S.NAME[station]} tickets: normal text`);
flag("buzz", "buzz", () => `🔔 ${S.NAME[station]}: buzzer & light on new orders`, () => `🔕 ${S.NAME[station]}: no buzzer`);
$("speak").onchange = () => { S.st(station).speak = $("speak").checked; S.save(); if ($("speak").checked) { S.speak("Voice on. New order, Table 4"); Hub.log(`🔊 ${S.NAME[station]}: new orders will be read out`); } else Hub.log(`🔇 ${S.NAME[station]}: orders won't be read out`); };
$("logo").onchange = () => { S.cfg.logo = $("logo").checked; S.save(); };

// ---------- start / stop ----------
$("startBtn").onclick = async () => { if (S.running) await S.stop(); else S.start(); refresh(); };
$("reprint").onclick = () => { if (!Hub.lastSlip) Hub.say("Nothing printed yet.", false); else S.print(Hub.lastSlipSt, Hub.lastSlip, "Reprint"); };
$("skip").onclick = () => { S.skipWaiting(); Hub.log("Older orders skipped — only new ones will print"); };

// ---------- test prints ----------
document.querySelectorAll("[data-test]").forEach(b => b.onclick = async () => {
  const s = station, c = S.st(s);
  if (!c.target) { Hub.say(`Pick a printer for the ${S.NAME[s]} first.`, false); return; }
  const lg = await pics.logos(c.cols, S.cfg.logo);
  const t = b.dataset.test;
  const bytes = t === "buzz" ? new EscPos(c.cols).buzz().bytes() : t === "test" ? fmt.samples.test(c.cols, lg, c.cutter) : fmt.samples[t](c.cols, lg, c.cutter, c.big);
  S.print(s, bytes, b.textContent.trim());
});
$("alexaBtn").onclick = async () => { Hub.say("🔊 Asking Alexa…", true); const r = await S.alexa("Table 4", station, false, true); Hub.say(r, r.startsWith("🔊")); Hub.log(r); };

// ---------- backups ----------
function showBackup(extra) {
  const l = B.last();
  $("bkInfo").innerHTML = (l ? `Last backup: <b>${new Date(l.at).toLocaleString("en-GB")}</b> · ${l.rows} records · ${B.list().length} copies kept`
    : "<span class='bad'>No backup on this computer yet.</span>") + (extra ? "<br>" + extra : "") +
    `<br><span class="mute">Folder: ${esc(B.folder())}</span>`;
}
async function backupNow(auto) {
  try { $("bkNow").disabled = true; if (!auto) showBackup("Backing up…");
    const r = await B.run(); Hub.log(`💾 Backup saved (${r.rows} records)`); showBackup("<span class='ok'>✓ Backup saved</span>"); return r; }
  catch (e) { Hub.log("⚠ Backup failed: " + e.message); showBackup(`<span class='bad'>⚠ Backup failed: ${esc(e.message)}</span>`); return null; }
  finally { $("bkNow").disabled = false; }
}
$("bkNow").onclick = () => backupNow(false);
$("bkOpen").onclick = () => ipcRenderer.invoke("open-path", B.folder());
setInterval(() => { if ((Cloud.signedInAs || Cloud.local) && B.due()) backupNow(true); }, 60000);   // a copy every 5 minutes

// ---------- this computer ----------
$("auto").onchange = async () => { $("auto").checked = await ipcRenderer.invoke("autostart", $("auto").checked); };
$("updBtn").onclick = async () => { $("updInfo").textContent = "Checking for updates…"; $("updInfo").textContent = await ipcRenderer.invoke("check-update"); };
$("tillBtn").onclick = () => ipcRenderer.invoke("show-till");
async function showZoom() { $("zTill").textContent = (await ipcRenderer.invoke("zoom", "till", null)) + "%"; $("zPrinter").textContent = (await ipcRenderer.invoke("zoom", "printer", null)) + "%"; }
document.querySelectorAll("[data-z]").forEach(b => b.onclick = async () => { await ipcRenderer.invoke("zoom", b.dataset.z, +b.dataset.s); showZoom(); });
setInterval(showZoom, 5000);
ipcRenderer.on("updating", (_e, v) => { Hub.say(`⬇ Installing update ${v} — printing carries on in a minute`, true); });

// ---------- start up ----------
(async function init() {
  const v = await ipcRenderer.invoke("version");
  const h = await ipcRenderer.invoke("hub-info");
  if (h && h.running) {   // printing and backups use the data kept on this computer
    Cloud.local = {
      list: (c, f, o) => ipcRenderer.invoke("hub", "printList", c, f, o),
      merge: (c, i, p) => ipcRenderer.invoke("hub", "merge", c, i, p),
      everything: () => ipcRenderer.invoke("hub", "all"),
    };
  }
  showHub(h); sendCreds();
  $("ver").textContent = `Windows · version ${v.build || "dev"} · updates install by themselves between 3am and 3pm`;
  $("auto").checked = v.autostart;
  showAuth(); showStation(); showBackup(); refresh(); showZoom();
  await loadDevices(); showStation();
  if (process.env.T57_AUTOTEST) return autotest(process.env.T57_AUTOTEST);
  // printing not set up yet, or opened from the "T57 Printers & Backups" icon: this window comes to the front
  if (!S.cfg.running || v.printersFirst) setTimeout(() => ipcRenderer.invoke("show-printer"), 2500);
  if (S.cfg.running) S.start();                      // printing switches back on after a restart or an update
  else Hub.say("Pick the printer, tick the station, then tap Start.", true);
  if ((Cloud.signedInAs || Cloud.local) && B.due()) setTimeout(() => backupNow(true), 30000);
})();

// ---------- automatic test (used by the GitHub test run only) ----------
async function autotest(file) {
  const fs = require("fs");
  const T = JSON.parse(fs.readFileSync(file, "utf8"));
  const res = { steps: [] };
  const step = (name, ok, info) => { res.steps.push({ name, ok: !!ok, info: info || "" }); fs.writeFileSync(T.result, JSON.stringify(res, null, 1)); };
  try {
    step("sign in", await signIn(T.email, T.password));
    if (T.devices) { step("list Windows printers", true, JSON.stringify(devices)); }
    for (const [s, c] of Object.entries(T.stations)) { Object.assign(S.st(s), c); S.setOn(s, true); }
    S.cfg.since = 1; S.save();
    station = Object.keys(T.stations)[0]; showStation();
    for (const s of Object.keys(T.stations)) step("printer check " + s, await S.probe(s), S.st(s).target);
    step("start printing", S.start());
    const t0 = Date.now();
    while (Date.now() - t0 < (T.waitMs || 30000)) { await new Promise(r => setTimeout(r, 1000)); if (T.until && fs.existsSync(T.until)) break; }
    step("status", S.running, Hub.status + " | " + Hub.net + " | " + Hub.logs.join(" / "));
    const r = await backupNow(true);
    step("backup", !!r, r ? r.file + " " + r.rows : "");
    if (T.shot) { window.scrollTo(0, 0); await ipcRenderer.invoke("screenshot", "printer", T.shot); }
    if (T.tillShot) { await new Promise(r => setTimeout(r, 3000)); await ipcRenderer.invoke("screenshot", "till", T.tillShot); }
    await S.stop();
    res.done = true; fs.writeFileSync(T.result, JSON.stringify(res, null, 1));
  } catch (e) { step("crash", false, String(e && e.stack || e)); }
  ipcRenderer.invoke("test-done", 0);
}
