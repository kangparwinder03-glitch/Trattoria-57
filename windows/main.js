// Trattoria 57 for Windows.
// One app with a desktop icon that runs everything on a Windows computer:
//   • the restaurant app (the same website the tablets use) in its own window
//   • the print station (kitchen / bar / till printers: network, Bluetooth or USB), like the T57 Printer app
//   • backups of the database on this computer, every night
//   • the restaurant hub: the data is kept on this computer and the tablets (iPads) work from it over the
//     Wi-Fi; every change is copied online straight away (src/hub.js)
//   • starts by itself when Windows starts, keeps the computer awake, and updates itself outside service hours
"use strict";
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, powerSaveBlocker, nativeImage, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { request } = require("./src/cloud");
const { Hub } = require("./src/hub");

const SITE = process.env.T57_SITE || "https://kangparwinder03-glitch.github.io/Trattoria-57/";
const REL = "https://github.com/kangparwinder03-glitch/Trattoria-57/releases/download/windows-latest/";
const BUILD = parseInt(String(app.getVersion()).split(".").pop(), 10) || 0;
const TEST = !!process.env.T57_AUTOTEST;

if (process.env.T57_USER_DATA) app.setPath("userData", process.env.T57_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId("uk.trattoria57.windows");

let till = null, printer = null, tray = null, quitting = false, hub = null, TILL_URL = SITE;
const icon = path.join(__dirname, "assets", "icon-256.png");

// ---- size of everything: bigger / smaller, remembered for each window ----
const DESKTOP_CSS = fs.readFileSync(path.join(__dirname, "desktop.css"), "utf8");
const DESKTOP_JS = fs.readFileSync(path.join(__dirname, "desktop.js"), "utf8");
const viewFile = () => path.join(app.getPath("userData"), "view.json");
let view = {};
function loadView() { try { view = JSON.parse(fs.readFileSync(viewFile(), "utf8")) || {}; } catch (e) { view = {}; } }
function saveView() { try { fs.writeFileSync(viewFile(), JSON.stringify(view)); } catch (e) {} }
/** Starting size: everything drawn as if the screen were about 1280 wide, so a 15.6" screen gets big, touch-sized buttons. */
function defaultZoom() {
  const w = screen.getPrimaryDisplay().workAreaSize.width;
  return Math.min(1.75, Math.max(1, Math.round((w / 1280) * 20) / 20));
}
const zoomOf = name => view[name] || defaultZoom();
function setZoom(name, w, z) {
  z = Math.min(2.5, Math.max(0.6, Math.round(z * 20) / 20));
  view[name] = z; saveView();
  if (w && !w.isDestroyed()) w.webContents.setZoomFactor(z);
}
function zoomWin(w, step) {
  if (!w) return;
  const name = w === printer ? "printer" : "till";
  setZoom(name, w, step === 0 ? defaultZoom() : zoomOf(name) + step);
}
function keepZoom(w, name) {
  w.webContents.on("did-finish-load", () => w.webContents.setZoomFactor(zoomOf(name)));
  w.webContents.on("zoom-changed", (_e, dir) => setZoom(name, w, zoomOf(name) + (dir === "in" ? 0.05 : -0.05)));   // Ctrl + mouse wheel
}

function showWin(w) { if (!w) return; if (w.isMinimized()) w.restore(); w.show(); w.focus(); }

function makePrinter(show) {
  printer = new BrowserWindow({
    width: 1100, height: 860, show: false, title: "Trattoria 57 — Printers & backups", icon,
    backgroundColor: "#f6eedd",
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  printer.loadFile(path.join(__dirname, "printer.html"));
  keepZoom(printer, "printer");
  printer.once("ready-to-show", () => { if (show) { if (!TEST) printer.maximize(); printer.show(); } });
  printer.on("close", e => { if (!quitting) { e.preventDefault(); printer.hide(); } });
  printer.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

function makeTill() {
  till = new BrowserWindow({
    width: 1280, height: 860, show: false, title: "Trattoria 57", icon, backgroundColor: "#f4ecdc",
    webPreferences: { backgroundThrottling: false, spellcheck: false },
  });
  till.loadURL(TILL_URL);
  keepZoom(till, "till");
  // computer-screen layout (only in the Windows app; the tablets don't get it)
  till.webContents.on("dom-ready", () => {
    till.webContents.insertCSS(DESKTOP_CSS).catch(() => {});
    till.webContents.executeJavaScript("document.documentElement.classList.add('t57win')").then(() => till.webContents.executeJavaScript(DESKTOP_JS)).catch(() => {});
  });
  till.once("ready-to-show", () => { if (!TEST) { till.maximize(); till.show(); } });
  till.on("close", e => { if (!quitting) { e.preventDefault(); till.hide(); } });
  const site = new URL(SITE), mine = new URL(TILL_URL);
  till.webContents.setWindowOpenHandler(({ url }) => {
    try { const o = new URL(url).origin; if (o === site.origin || o === mine.origin) return { action: "allow" }; } catch (e) {}
    shell.openExternal(url); return { action: "deny" };
  });
  // if the page ever crashes or the internet drops while loading, try again
  till.webContents.on("render-process-gone", () => setTimeout(() => till && till.loadURL(TILL_URL), 2000));
  till.webContents.on("did-fail-load", (_e, code, _d, url, main) => { if (main && code !== -3) setTimeout(() => till && till.loadURL(TILL_URL), 10000); });
}

function makeTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")));
  tray.setToolTip("Trattoria 57 — running");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open the restaurant app", click: () => showWin(till) },
    { label: "Printers & backups", click: () => showWin(printer) },
    { type: "separator" },
    { label: "Quit Trattoria 57 (printing stops)", click: askQuit },
  ]));
  tray.on("click", () => showWin(till));
}

function askQuit() {
  const r = dialog.showMessageBoxSync({ type: "warning", buttons: ["Keep running", "Quit"], defaultId: 0, cancelId: 0,
    title: "Quit Trattoria 57?", message: "Quit Trattoria 57?", detail: "Nothing will print on this computer until you open it again." });
  if (r === 1) { quitting = true; app.quit(); }
}

// ---- self-update: checks once an hour, installs only between 3am and 3pm (never during service) ----
let updBusy = false;
async function latest() { const r = await request(REL + "version.txt", { follow: true, timeout: 15000 }); if (r.status !== 200) throw new Error("HTTP " + r.status); return parseInt(r.text.trim(), 10) || 0; }
async function checkUpdate(manual) {
  if (updBusy || !app.isPackaged) return manual ? (app.isPackaged ? "Already checking…" : "Updates only work in the installed app") : "";
  const h = new Date().getHours();
  if (!manual && !(h >= 3 && h <= 14)) return "";
  updBusy = true;
  try {
    const want = await latest();
    if (want <= BUILD) return `✓ Up to date (version ${BUILD})`;
    const r = await request(REL + "T57-Windows-Setup.exe", { follow: true, timeout: 600000, binary: true });
    if (r.status !== 200 || r.buf.length < 1000000) throw new Error("download failed");
    const f = path.join(os.tmpdir(), `T57-Windows-Setup-${want}.exe`);
    fs.writeFileSync(f, r.buf);
    if (printer) printer.webContents.send("updating", want);
    spawn(f, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => { quitting = true; app.quit(); }, 1500);
    return `Installing version ${want}… the app will open again by itself`;
  } catch (e) { return manual ? `Couldn't check for updates (${e.message}) — try again` : ""; }
  finally { updBusy = false; }
}

// ---- the restaurant hub ----
ipcMain.handle("hub-info", () => hub ? hub.info() : { running: false });
ipcMain.handle("hub-auth", (_e, c) => { if (hub) hub.online.setCreds(c); return true; });
ipcMain.handle("hub", (_e, op, ...a) => {
  if (!hub) throw new Error("hub not running");
  if (op === "printList") return hub.printList(a[0], a[1] || [], a[2] || {});
  if (op === "merge") { if (!hub.store.meta.imported) throw new Error("till not ready yet"); hub.store.merge(a[0], a[1], a[2]); return true; }
  if (op === "all") { if (!hub.store.meta.imported) throw new Error("the till is still copying the data from online: sign in on this screen first"); return hub.store.all(); }
  return hub.op(a[0]);
});
ipcMain.handle("version", () => ({ build: BUILD, version: app.getVersion(), packaged: app.isPackaged, site: SITE, autostart: app.getLoginItemSettings().openAtLogin, printersFirst: process.argv.includes("--printers") }));
ipcMain.handle("zoom", (_e, which, step) => { const w = which === "till" ? till : printer; if (step !== null) zoomWin(w, step); return Math.round(zoomOf(which === "till" ? "till" : "printer") * 100); });
ipcMain.handle("check-update", () => checkUpdate(true));
ipcMain.handle("show-till", () => showWin(till));
ipcMain.handle("show-printer", () => showWin(printer));
ipcMain.handle("open-path", (_e, p) => shell.openPath(p));
ipcMain.handle("autostart", (_e, on) => { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!on }); return app.getLoginItemSettings().openAtLogin; });
ipcMain.handle("test-done", (_e, code) => { if (TEST) { quitting = true; app.exit(code || 0); } });
ipcMain.handle("screenshot", async (_e, which, file) => {
  const w = which === "till" ? till : printer;
  const img = await w.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG()); return file;
});

// opening the app again (desktop icons): "T57 Printers & Backups" brings that window to the front
app.on("second-instance", (_e, argv) => { showWin(argv.includes("--printers") ? printer : till); });
let hubStopped = false;
app.on("before-quit", e => {
  quitting = true;
  if (hub && !hubStopped) {   // save everything and tell the tablets to carry on online
    e.preventDefault(); hubStopped = true;
    Promise.race([hub.stop(), new Promise(r => setTimeout(r, 4000))]).finally(() => app.quit());
  }
});
app.on("window-all-closed", () => { if (quitting) app.quit(); });

app.whenReady().then(async () => {
  // keep the computer from going to sleep while the app runs (the screen may still switch off)
  powerSaveBlocker.start("prevent-app-suspension");
  if (app.isPackaged && !TEST && !app.getLoginItemSettings().openAtLogin && !fs.existsSync(path.join(app.getPath("userData"), "autostart-set"))) {
    app.setLoginItemSettings({ openAtLogin: true });     // starts with Windows (can be switched off in the app)
    fs.writeFileSync(path.join(app.getPath("userData"), "autostart-set"), "1");
  }
  loadView();
  const focused = () => BrowserWindow.getFocusedWindow() || till;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "🍝 Restaurant", accelerator: "F2", click: () => showWin(till) },
    { label: "🖨 Printers && backups", accelerator: "F3", click: () => showWin(printer) },
    { label: "➖ Smaller", accelerator: "CmdOrCtrl+-", click: () => zoomWin(focused(), -0.1) },
    { label: "➕ Bigger", accelerator: "CmdOrCtrl+=", click: () => zoomWin(focused(), 0.1) },
    { label: "Normal size", accelerator: "CmdOrCtrl+0", click: () => zoomWin(focused(), 0) },
    { label: "⛶ Full screen", accelerator: "F11", click: () => { const w = focused(); w.setFullScreen(!w.isFullScreen()); } },
    { label: "More", submenu: [
      { label: "Reload", accelerator: "F5", click: () => focused().reload() },
      { label: "Bigger", accelerator: "CmdOrCtrl+Plus", visible: false, click: () => zoomWin(focused(), 0.1) },
      { role: "toggleDevTools", accelerator: "Ctrl+Shift+I" },
      { type: "separator" }, { label: "Quit Trattoria 57", click: askQuit } ] },
    { label: "Edit", visible: false, submenu: [{ role: "undo" }, { role: "redo" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
  ]));
  if (!process.env.T57_NOHUB) {
    hub = new Hub({ dir: path.join(app.getPath("userData"), "hub"), site: SITE,
      onLog: t => { if (printer && !printer.isDestroyed()) printer.webContents.send("hub-log", t); } });
    hub.onStatus = info => { if (printer && !printer.isDestroyed()) printer.webContents.send("hub-status", info); };
    if (await hub.start()) TILL_URL = `http://127.0.0.1:${hub.port}/`;
  }
  makeTill();
  makePrinter(TEST || !process.argv.includes("--hidden"));
  makeTray();
  setInterval(() => checkUpdate(false), 3600000);
  setTimeout(() => checkUpdate(false), 60000);
});
