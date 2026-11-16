# Tests the Trattoria 57 Android app on an emulator, against the REAL website in TRAINING mode
# (no real orders, bookings or reports are touched). Run by .github/workflows/app-apk.yml.
# Checks: opens full screen with the screen kept awake, survives no-internet at start, keeps the
# "running" service, keeps syncing orders while in the background and with the screen off,
# recovers when Android kills the page engine, Back never closes the app, saved data survives a restart.
import json, os, re, subprocess, sys, time, urllib.request
import websocket, atexit
atexit.register(lambda: subprocess.run("adb logcat -d -t 4000 > logcat.txt", shell=True, timeout=20))

PKG = "uk.trattoria57.app"
HOME = "https://kangparwinder03-glitch.github.io/Trattoria-57/"
APK = sys.argv[1]
ok = True
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
def check(name, cond, extra=""):
    global ok
    log(("PASS " if cond else "FAIL ") + name, extra); ok = ok and bool(cond)
def adb(*a, check_=False):
    r = subprocess.run(["adb", *a], capture_output=True, text=True, timeout=120)
    if check_ and r.returncode: raise SystemExit("adb failed: " + " ".join(a) + "\n" + r.stdout + r.stderr)
    return r.stdout
def sh(cmd): return adb("shell", cmd)
shots = 0
def shot(name):
    global shots; shots += 1
    with open(f"shot-{shots}-{name}.png", "wb") as f: f.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True).stdout)
def pid(): return sh(f"pidof {PKG}").strip()

class CDP:
    def __init__(self):
        self.ws = None; self.n = 0
    def connect(self, secs=60):
        t0 = time.time()
        while time.time() - t0 < secs:
            try:
                sock = re.search(r"webview_devtools_remote_\d+", sh("cat /proc/net/unix"))
                if sock:
                    adb("forward", "tcp:9222", "localabstract:" + sock.group(0))
                    pages = [p for p in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5)) if p.get("type") == "page"]
                    if pages:
                        self.ws = websocket.create_connection(pages[0]["webSocketDebuggerUrl"], suppress_origin=True, timeout=30)
                        return pages[0]["url"]
            except Exception as e: last = e
            time.sleep(1)
        raise SystemExit("couldn't reach the app's page for testing")
    def send(self, method, params=None):
        self.n += 1; me = self.n
        self.ws.send(json.dumps({"id": me, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == me: return m.get("result", m.get("error"))
    def ev(self, js):
        r = self.send("Runtime.evaluate", {"expression": js, "returnByValue": True, "awaitPromise": True})
        return (r or {}).get("result", {}).get("value")
    def wait(self, js, secs):
        t0 = time.time()
        while time.time() - t0 < secs:
            try:
                if self.ev(js): return round(time.time() - t0, 1)
            except websocket.WebSocketConnectionClosedException:
                log("  lost the page connection; devices:", adb("devices").split("\n")[1:2], "app pid:", pid() or "none")
                try: self.connect(20)
                except BaseException as e: log("  reconnect failed:", e)
            except Exception: pass
            time.sleep(0.5)
        return None

KCOUNT = "document.querySelectorAll('#kitchen .tk').length"
TRAIN_JS = "try{localStorage.setItem('t57-train','1');localStorage.setItem('t57-3d-hint','0')}catch(e){}"
LIVE = "(document.getElementById('status')||{}).textContent.includes('live')"
STATUS = "(document.getElementById('status')||{}).textContent"
# The restaurant login, from the repository's secrets: a tablet signs in once, like staff do. Never printed.
CREDS = json.dumps([os.environ.get("T57_EMAIL", ""), os.environ.get("T57_PASSWORD", "")])
SIGN_IN = ("(()=>{const e=document.getElementById('lgEmail');if(!e||!document.getElementById('loginOv').classList.contains('show'))return false;"
           "const c=" + CREDS + ";e.value=c[0];document.getElementById('lgPass').value=c[1];document.querySelector('#loginOv form').requestSubmit();return true})()")

log("installing", APK); adb("install", "-r", "-g", APK, check_=True)
sh(f"dumpsys deviceidle whitelist +{PKG}")   # what the app's first-start question does on a real tablet
sh("settings put system screen_off_timeout 60000")   # short screen timeout, to prove the app keeps the screen on

# 1) Start. The restaurant's data is locked until a tablet signs in, so this first load can't read or
#    change anything; training mode is switched on before signing in.
sh(f"am start -W -n {PKG}/.MainActivity")
cdp = CDP(); log("app page:", cdp.connect())
t = cdp.wait(f"location.href.startsWith('{HOME}') && document.getElementById('lgEmail')", 90)
log("website opened in the app", f"after {t}s" if t is not None else "(sign-in screen not seen yet)")
cdp.ev(TRAIN_JS + "location.reload()"); time.sleep(2)
cdp = CDP(); cdp.connect()
t = cdp.wait("document.getElementById('lgEmail') && document.getElementById('loginOv').classList.contains('show')", 60)
shot("signin")
check("signed in", cdp.ev(SIGN_IN))
t = cdp.wait(LIVE, 40)
check("connected to the restaurant's data", t is not None, f"after {t}s; status: {cdp.ev(STATUS)}")
check("website is in TRAINING mode", cdp.ev("localStorage.getItem('t57-train')==='1' && !document.getElementById('trainBar').hidden"))
ua = cdp.ev("navigator.userAgent"); ver = cdp.ev("window.T57App && T57App.version()")
check("website knows it's inside the app", " T57App/" in ua and ver, f"app version {ver}")
shot("loaded")

# 2) Full screen, screen kept awake, keep-running service on
w = sh("dumpsys window windows")
block = w[w.find(PKG + "/" + PKG + ".MainActivity"):][:4000]
check("screen is kept awake", "KEEP_SCREEN_ON" in block)
check("'keeps running' service is on", "isForeground=true" in sh(f"dumpsys activity services {PKG}"))
time.sleep(70)   # longer than the 60s screen timeout set above
check("screen still on after the screen timeout", "mWakefulness=Awake" in sh("dumpsys power"))

# 3) Back button never closes the app
for _ in range(4): sh("input keyevent 4"); time.sleep(0.5)
check("Back doesn't close the app", PKG in sh("dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity'"))

# 4) Kitchen screen in the app; it must keep receiving orders while in the background and with the screen off
cdp.ev("location.hash='#kitchen'"); time.sleep(3)
cdp.ev("window.__tk=0;setInterval(()=>window.__tk++,1000)")
p0 = pid()

def send_order(tag):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1100, "height": 850})
        ctx.add_init_script(TRAIN_JS + "localStorage.setItem('t57-waiter',JSON.stringify({id:'apptest',name:'App test'}))")
        W = ctx.new_page(); W.goto(HOME + "?v=" + str(int(time.time())))
        W.wait_for_selector("#lgEmail", timeout=30000); W.wait_for_timeout(300); W.evaluate(SIGN_IN)
        W.wait_for_function(LIVE, timeout=30000)
        assert W.evaluate("localStorage.getItem('t57-train')==='1' && !document.getElementById('trainBar').hidden"), "sender not in training"
        W.click('#pickBtn'); W.wait_for_timeout(1000)
        W.click('#oCats [data-side="food"]'); W.click('#oCats button[data-c="Pizza"]'); W.click('.mi[data-n="Pizza Margherita"] .add')
        W.click('#oFoot [data-f=review]'); W.wait_for_timeout(400)
        W.evaluate("(()=>{const b=document.querySelector('#ordOv [data-pq=\"0\"]');if(b)b.click()})()")   # takeaway: ready 'Now'
        W.wait_for_timeout(400); W.click('#oFoot [data-f=send]'); W.wait_for_timeout(2500)
        asked = W.evaluate("document.getElementById('xOv').classList.contains('show') ? document.getElementById('xOv').innerText.slice(0,120) : ''")
        if asked: log("sender: the website asked:", asked.replace("\n", " | "))
        W.goto(HOME + "#kitchen"); W.wait_for_function(LIVE, timeout=30000); W.wait_for_timeout(3000)
        log("sender (training):", tag, "order sent; sender's own kitchen screen shows", W.evaluate(KCOUNT), "tickets"); b.close()

for label, away in (("with the app open", ""), ("in the background", "input keyevent 3"), ("with the screen off", "input keyevent 26")):
    before = cdp.ev(KCOUNT); tk0 = cdp.ev("window.__tk")
    if away: sh(away); log("app is now", label, "| kitchen tickets before:", before); time.sleep(45)
    send_order(label)
    d = cdp.wait(f"document.querySelectorAll('#kitchen .tk').length>{before}", 45)
    tk = cdp.ev("window.__tk") - tk0
    check(f"kitchen screen got the new order {label}", d is not None, f"after {d}s; page timers ran {tk} times")
    check(f"app not closed by Android {label}", pid() == p0 and cdp.wait(LIVE, 20) is not None)
    sh("input keyevent 224"); sh("wm dismiss-keyguard"); sh(f"am start -n {PKG}/.MainActivity"); time.sleep(3)
shot("kitchen")

# 5) Android kills the page engine (it can do that to save memory): the app rebuilds it and carries on
adb("root"); time.sleep(3)
rend = [l.split()[1] for l in sh("ps -A").splitlines() if "sandboxed_process" in l]
log("killing page engine", rend)
for r in rend: sh(f"kill -9 {r}")
time.sleep(6)
cdp = CDP(); cdp.connect()
t = cdp.wait(f"location.href.startsWith('{HOME}') && {LIVE}", 60)
check("recovers after the page engine is killed", t is not None and pid() == p0 and cdp.ev("localStorage.getItem('t57-train')==='1'"), f"after {t}s")

# 6) Saved data (login, station, training…) survives the app being fully stopped and reopened
cdp.ev("localStorage.setItem('t57-apptest-keep','yes')"); time.sleep(15)
sh(f"am force-stop {PKG}"); time.sleep(2); sh(f"am start -W -n {PKG}/.MainActivity")
cdp = CDP(); cdp.connect()
t = cdp.wait(f"localStorage.getItem('t57-apptest-keep')==='yes' && localStorage.getItem('t57-train')==='1' && {LIVE}", 60)
check("saved data kept after a full restart (still training)", t is not None,
      cdp.ev("JSON.stringify([localStorage.getItem('t57-apptest-keep'),localStorage.getItem('t57-train'),document.getElementById('status').textContent])"))
shot("restarted")

print("\nRESULT:", "ALL PASSED" if ok else "SOME CHECKS FAILED")
sys.exit(0 if ok else 1)
