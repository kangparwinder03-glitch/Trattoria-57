# A whole evening of service, in real time: 2 waiter tablets (Maria, Luca) + the bar tablet (Gio), open all night.
# Parties arrive at random (walk-ins and pre-booked), stay 30 min – 4 h, order in rounds, get joined tables,
# XL dishes, custom requests, half & half, free sides; bar walk-ups; bar sending drinks to tables; takeaways.
# Every bill is paid (card, cash, split evenly, per guest). Checks run every 15 minutes and at the end.
#   env: MINUTES (length of service, default 345), SPEED (1 = real time), SEED, OUT (folder for log/screenshots)
import asyncio, subprocess, time, random, json, collections, os, sys, traceback, datetime
from playwright.async_api import async_playwright

MIN = float(os.environ.get("MINUTES", "345")); SPEED = float(os.environ.get("SPEED", "1")); SEED = int(os.environ.get("SEED", "57"))
OUT = os.environ.get("OUT", "/tmp/sim"); os.makedirs(OUT, exist_ok=True); SITE = os.environ.get("SITE", "/tmp/site")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome"); PORT = int(os.environ.get("PORT", "8890"))
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ["DBLOG"] = OUT + "/dblog.txt"
srv = subprocess.Popen(["python3", HERE + "/dbserver.py", str(PORT), SITE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
MOCK = open(HERE + "/mocksupa_srv.js").read(); URL = f"http://localhost:{PORT}/index.html"
rnd = random.Random(SEED)
T0 = time.time()
def simnow(): return (time.time() - T0) * SPEED / 60          # minutes into service
def clock(m=None):
    m = simnow() if m is None else m; t = 17 * 60 + int(m); return f"{t//60:02d}:{t%60:02d}"
LOG = open(OUT + "/log.txt", "w")
def say(*a):
    s = f"[{clock()}] " + " ".join(str(x) for x in a); print(s, flush=True); LOG.write(s + "\n"); LOG.flush()
problems = []; expected = collections.defaultdict(collections.Counter); stats = collections.Counter()
def bad(m):
    problems.append(f"{clock()} {m}"); say("❌", m)
E = lambda w, s: w.evaluate("s=>__ev(s)", s)
Q = lambda s: json.dumps(s, ensure_ascii=False)
async def snap(w, tag):
    try: await w.screenshot(path=f"{OUT}/{clock().replace(':','')}_{tag}.png")
    except Exception: pass

# ── the app's clock starts at 17:00 today and runs at SPEED ──
def clock_shim():
    now = time.time() * 1000; d = datetime.datetime.now(); start = datetime.datetime(d.year, d.month, d.day, 17, 0).timestamp() * 1000
    return f"""(()=>{{const RD=Date,R0={now},S0={start},K={SPEED};const f=()=>S0+(RD.now()-R0)*K;
      class D extends RD{{constructor(...a){{if(a.length)super(...a);else super(f())}}static now(){{return f()}}}}
      D.UTC=RD.UTC;D.parse=RD.parse;window.Date=D}})();"""

async def newpage(ctx, name, hash_=""):
    w = await ctx.new_page(); w._n = name; w._errs = []; w._seen = 0
    w.on("pageerror", lambda e: w._errs.append(str(e)))
    w.on("dialog", lambda d: asyncio.ensure_future(d.accept("Extra guest")))
    await w.goto(URL + hash_); await w.wait_for_timeout(1500); return w

async def cart(w): return json.loads(await E(w, "JSON.stringify(ord?cart():[])"))
async def login(w, sid, pin, btn="#waiterBtn"):
    for tries in range(8):      # the staff list may still be syncing from the other tablet
        await reset(w, await E(w, "location.hash||'#floor'")); await w.locator(btn).tap(); await w.wait_for_timeout(400)
        if await w.locator(f'#xBody [data-w="{sid}"]').count(): break
        say(f"{w._n}: waiting for staff list ({tries+1})"); await w.wait_for_timeout(4000)
        if tries == 4: await w.reload(); await w.wait_for_timeout(2500)
    await w.locator(f'#xBody [data-w="{sid}"]').tap(); await w.wait_for_timeout(300)
    for d in pin: await w.locator(f'#padBody [data-d="{d}"]').tap(); await w.wait_for_timeout(60)
    await w.wait_for_timeout(600); return await E(w, "waiter&&waiter.name")
async def reset(w, view="#floor"):
    await E(w, "try{ord&&closeOrder()}catch(e){};try{closeX()}catch(e){};document.querySelectorAll('.overlay.show').forEach(o=>o.classList.remove('show'));try{sheetGroup=null}catch(e){}")
    await E(w, f"location.hash='{view}'"); await w.wait_for_timeout(250)
async def confirm(w):
    await w.bring_to_front(); await w.wait_for_timeout(650)
    await w.wait_for_function("!document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('#confOv')).length", timeout=8000)
    await w.locator("#confYes").tap(); await w.wait_for_timeout(900)
async def side_cat(w, n):
    info = json.loads(await E(w, f"JSON.stringify({{cat:ITEMS[{Q(n)}].cat,bar:BAR_CATS.has(ITEMS[{Q(n)}].cat)}})"))
    b = w.locator(f'#oCats button[data-side="{"drinks" if info["bar"] else "food"}"]')
    if await b.count() and "on" not in (await b.get_attribute("class") or ""): await b.tap(); await w.wait_for_timeout(120)
    c = w.locator(f'#oCats .catrow button[data-c="{info["cat"]}"]')
    if "on" not in (await c.get_attribute("class") or ""): await c.tap(); await w.wait_for_timeout(120)
async def guest(w, g):
    b = w.locator(f'.tabchips button[data-tab="{g}"]')
    if await b.count(): await b.first.tap(); await w.wait_for_timeout(120)
async def addx(w, n, g="", chips=(), mixer=None, xl=None):
    await side_cat(w, n)
    if await w.locator(".tabchips").count(): await guest(w, g)
    await w.locator(f'.mi[data-n={Q(n)}] [data-a="inc"]').first.tap(timeout=15000); await w.wait_for_timeout(150)
    if mixer and await w.locator(f'.mipop [data-pmx={Q(mixer)}]').count(): await w.locator(f'.mipop [data-pmx={Q(mixer)}]').tap(); await w.wait_for_timeout(120)
    else: mixer = None
    ch = await E(w, f"(CHOICES[{Q(n)}]||[])[0]||''")
    if ch: await w.locator(f'.mipop .choice button[data-pq={Q(ch)}]').first.tap(); await w.wait_for_timeout(120)
    for c in chips:
        b = w.locator(f'.mipop button[data-pq={Q(c)}]')
        if await b.count(): await b.first.tap(); await w.wait_for_timeout(100)
    name = n
    if xl is not None and await w.locator('.mipop [data-pxl="1"]').count():
        await w.locator('.mipop [data-pxl="1"]').tap(); await w.wait_for_timeout(200)
        if xl != "50%": await w.locator('.mipop [data-pxa]').fill(str(xl)); await w.wait_for_timeout(100)
        name = n + " (XL)"; stats["XL dishes"] += 1
    await E(w, "ord.pop=null;renderOrder()")
    return [name] + ([mixer] if mixer else [])
async def custom(w, text, price):
    await w.locator('[data-cujump]').tap(); await w.wait_for_timeout(300)
    await w.locator('#cuN').fill(text); await w.locator('#cuP').fill(str(price)); await w.locator('[data-cuadd]').tap(); await w.wait_for_timeout(300)
    stats["custom requests"] += 1; return [text]
async def halfx(w, a, b, cat="Pizza"):
    await w.locator('#oCats button[data-side="food"]').tap(); await w.wait_for_timeout(120)
    await w.locator(f'#oCats .catrow button[data-c="{cat}"]').tap(); await w.wait_for_timeout(150)
    await w.locator("[data-halfgo]").tap(); await w.locator(f'[data-half={Q(a)}]').tap(); await w.locator(f'[data-half={Q(b)}]').tap(); await w.wait_for_timeout(200)
    stats["half & half"] += 1; return [await E(w, f"halfName({Q(a)},{Q(b)})")]
async def send(w, pat=None):
    await w.locator('#oFoot [data-f="review"]').tap(); await w.wait_for_timeout(300)
    if pat is not None:     # takeaway: tap "Now" or "+30 min" on the real time wheel, like a waiter
        await w.locator(f'#patW [data-pq="{pat}"]').tap(); await w.wait_for_timeout(400)
    await w.locator('#oFoot [data-f="send"]').tap(); await w.wait_for_timeout(1500)
    left = await cart(w)
    if left: raise Exception(f"basket not empty after Send: {left}")
async def open_table(w, L):
    L = int(L); await reset(w)
    if not await E(w, "document.body.classList.contains('tiles')"): await w.locator("#modeBtn").tap(); await w.wait_for_timeout(300)
    await E(w, "area='all';applyArea();render()"); await w.wait_for_timeout(300)
    await w.locator(f'#tilesView .tile[data-t="{L}"]').first.tap(); await w.wait_for_timeout(700); return L
async def bill_tab(w):
    if not await E(w, "!!ord"): raise Exception("bill not open (table already closed?)")
    await E(w, "ord.tab='bill';renderOrder()"); await w.wait_for_timeout(400)
async def pay_all(w, how):
    await bill_tab(w); await w.locator(f'#oFoot [data-f="close"][data-pay="{how}"]').tap(); await w.wait_for_timeout(300); await confirm(w)
async def pay_guest(w, g, how):
    await bill_tab(w); await w.locator(f'[data-tpay="{how}"][data-tname={Q(g)}]').tap(); await w.wait_for_timeout(300); await confirm(w)
async def split_even(w, n, hows):
    await bill_tab(w); await w.locator('[data-f="split"]').tap(); await w.wait_for_timeout(400)
    for _ in range(n - 2): await w.locator('#xBody [data-sp="n+"]').tap(); await w.wait_for_timeout(100)
    for h in hows: await w.locator(f'#xBody [data-sp="{"ec" if h=="card" else "eh"}"]').tap(); await w.wait_for_timeout(900)
    await E(w, "typeof closeX==='function'&&closeX()")

DRINKS = ["Peroni · Pint", "Peroni · Half", "Moretti · Bottle", "Coke · Pint", "Coke · Regular", "Diet Coke · Regular", "Lemonade · Pint", "House Red · 1/2 Ltr",
          "House White · 1/2 Ltr", "House Red · 1 Ltr", "Aperol Spritz", "Small White Prosecco", "Jameson · Single", "Espresso", "Cappuccino"]
GINS = [("Whitley Neill · Double", "Tonic"), ("Gordon's Flavours · Double", "Slimline Tonic"), ("Malfy Flavours · Single", "Tonic")]
STARTERS = ["Antipasto Misto", "Polpette della Casa", "Cocktail di Gamberetti", "Brie Fritto", "Melone & Prosciutto", "Pizza all'Aglio", "Pizza all'Aglio e Mozzarella"]
MAINS = ["Pizza Margherita", "Pizza Diavola", "Pizza Funghi", "Pizza Prosciutto", "Spaghetti Carbonara", "Spaghetti Bolognese", "Lasagna", "Penne Napoli",
         "Risotto alla Panna", "Pollo alla Panna", "Pollo al Pepe", "Lamb Shank", "Fracosta di Bue", "Salmone Aurora", "Scampi Fritti", "Calzone"]
DESSERTS = ["Tiramisù", "Cheesecake", "Sticky Toffee Pudding", "Profiteroles", "Chocolate Cake"]
KIDS = ["Kids Pizza or Pasta", "Kids Chicken Nuggets & Fries", "Kids Fish Fingers & Fries"]
CUSTOM = [("Plain pasta with butter", 6), ("Birthday candle on dessert", 0), ("Side of garlic mayo", 1.5), ("Extra bread", 2), ("Child's plain pizza no sauce", 7.5)]
NAMES = ["Anna", "Ben", "Cara", "Dev", "Ella", "Finn", "Gina", "Harry", "Isla", "Jack", "Kofi", "Lena", "Marco", "Nia", "Omar", "Priya"]

async def main():
  async with async_playwright() as p:
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--enable-precise-memory-info"])
    ctx = await b.new_context(viewport={"width": 800, "height": 1280}, has_touch=True, is_mobile=True)
    await ctx.add_init_script(clock_shim() + "localStorage.setItem('t57-3d-hint','0');localStorage.setItem('t57-devmode','manager');localStorage.setItem('t57-view','2d')")
    await ctx.route("**/supabase-js@2/**", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
    await ctx.route("**/fonts.g*/**", lambda r: r.abort())
    z = await ctx.new_page(); await z.goto(URL); await z.evaluate("localStorage.clear()"); await z.close()
    A = await newpage(ctx, "Tablet A (Maria)")
    await E(A, """(async()=>{for(const [id,name,role,pin] of [['s_maria','Maria','Waiter','1111'],['s_luca','Luca','Waiter','2222'],['s_gio','Gio','Bar','3333']])
        await staffStore.put(id,{name,role,pin:await hashPin(pin,id),active:true})})()"""); await A.wait_for_timeout(800)
    B = await newpage(ctx, "Tablet B (Luca)"); BAR = await newpage(ctx, "Bar tablet (Gio)", "#bar"); await B.wait_for_timeout(800)
    for w, sid, pin, nm, btn in [(A, "s_maria", "1111", "Maria", "#waiterBtn"), (B, "s_luca", "2222", "Luca", "#waiterBtn"), (BAR, "s_gio", "3333", "Gio", "#barWho")]:
        got = await login(w, sid, pin, btn); w._waiter = nm
        if got != nm: bad(f"{w._n}: login gave {got}")
    say(f"Service starts · {MIN:.0f} min · speed ×{SPEED:g} · app clock {await E(A, 'new Date().toTimeString().slice(0,5)')}")
    await reset(A)
    if not await E(A, "document.body.classList.contains('tiles')"): await A.locator("#modeBtn").tap(); await A.wait_for_timeout(300)
    await E(A, "area='all';applyArea();render()"); await A.wait_for_timeout(300)
    tiles = json.loads(await E(A, "JSON.stringify([...document.querySelectorAll('#tilesView .tile[data-t]')].map(t=>[t.dataset.t,(t.querySelector('b,h3,.tn,strong')||t).innerText.split('\\n')[0].trim()]))"))
    names = {i: n for i, n in tiles}
    rest = [i for i, n in tiles if not n.startswith("B")]; bars = [i for i, n in tiles if n.startswith("B")]
    say("tables:", [names[i] for i in rest], [names[i] for i in bars])
    locks = {A: asyncio.Lock(), B: asyncio.Lock(), BAR: asyncio.Lock()}   # one finger per tablet
    busy = set(); bk = {}

    async def act(w, label, fn):
        """run one action on a tablet; on failure log, screenshot, recover — the night goes on"""
        async with locks[w]:
            try:
                await w.bring_to_front(); r = await fn(); stats["actions"] += 1; return r
            except Exception as ex:
                bad(f"{w._n} · {label}: {str(ex).splitlines()[0][:160]}"); await snap(w, "fail")
                try: await E(w, "try{ord&&(cart().length=0)}catch(e){}"); await reset(w)
                except Exception:
                    try: await w.reload(); await w.wait_for_timeout(2000)
                    except Exception: pass
                return None

    def pick_items(kind, k):
        if kind == "drinks": return [("d", rnd.choice(DRINKS)) if rnd.random() < .8 else ("g", rnd.choice(GINS)) for _ in range(k)]
        if kind == "food":
            out = [("f", rnd.choice(STARTERS)) for _ in range(rnd.randint(0, max(1, k // 2)))] + [("f", rnd.choice(MAINS)) for _ in range(k)]
            if rnd.random() < .25: out.append(("f", rnd.choice(KIDS)))
            if rnd.random() < .15: out.append(("half", None))
            if rnd.random() < .12: out.append(("cu", rnd.choice(CUSTOM)))
            return out
        return [("f", rnd.choice(DESSERTS)) for _ in range(k)] + [("d", rnd.choice(["Espresso", "Cappuccino", "Latte"])) for _ in range(rnd.randint(0, k))]

    async def place(w, items, names):
        its = []
        for typ, x in items:
            g = rnd.choice(names) if names and rnd.random() < .7 else ""
            if typ == "d": its += await addx(w, x, g)
            elif typ == "g": its += await addx(w, x[0], g, mixer=x[1])
            elif typ == "f":
                xl = ("50%" if rnd.random() < .5 else rnd.choice([2, 3, 4.5])) if x in MAINS and rnd.random() < .12 else None
                chips = rnd.sample(["Extra cheese", "Extra chilli flakes", "No onion"], 1) if rnd.random() < .15 else ()
                its += await addx(w, x, g, chips=chips, xl=xl)
            elif typ == "half":
                await guest(w, ""); a, c = rnd.sample(["Pizza Margherita", "Pizza Diavola", "Pizza Funghi", "Pizza Prosciutto"], 2)
                its += await halfx(w, a, c) if rnd.random() < .6 else await halfx(w, "Pizza all'Aglio", a, "Garlic Pizzas")
            elif typ == "cu": its += await custom(w, x[0], x[1])
        return its

    # ── parties ──
    class P: pass
    plan = []
    fixed = [(3, 240), (12, 210), (25, 120), (35, 30)]          # 4 h, 3.5 h, 2 h, 30 min
    for t, d in fixed: plan.append((t, d))
    # arrivals spread over the whole evening (a short run used to squeeze them all into the first few minutes)
    for _ in range(26): plan.append((rnd.uniform(0, max(MIN * 0.7, MIN - 60)), rnd.choice([30, 45, 60, 75, 90, 105, 120, 150])))
    plan.sort()
    parties = []
    for i, (t, d) in enumerate(plan):
        pa = P(); pa.i = i + 1; pa.at = t; pa.stay = min(d, MIN - t - 8); pa.w = rnd.choice([A, B]); pa.booked = rnd.random() < .45
        pa.size = rnd.choice([2, 2, 2, 3, 4, 4, 5, 6, 8]); pa.join = pa.size >= 6; pa.bar = (not pa.join) and rnd.random() < .2
        pa.names = rnd.sample(NAMES, min(pa.size, 4)) if pa.booked and rnd.random() < .6 else []
        pa.pay = rnd.choice(["card", "card", "cash", "even", "guests" if pa.names else "card"]); parties.append(pa)
    say(f"tonight: {len(parties)} parties ({sum(p.booked for p in parties)} booked, {sum(p.join for p in parties)} on joined tables, {sum(p.bar for p in parties)} at bar tables)")

    def free_table(pa):
        pool = bars if pa.bar else rest
        cands = [t for t in pool if t not in busy]
        return [rnd.choice(cands)] if cands else None

    async def until(m):
        while simnow() < m: await asyncio.sleep(min(20, max(0.5, (m - simnow()) * 60 / SPEED)))

    async def party(pa):
        await until(pa.at)
        tb = free_table(pa)
        if not tb: say(f"party {pa.i}: no free table, they go elsewhere"); stats["turned away"] += 1; return
        for t in tb: busy.add(t)
        w = pa.w; other = B if w is A else A
        try:
            async def seat():
                L = await open_table(w, tb[0])
                if pa.join:
                    # join with a table the app offers (it only offers ones that really fit next to this one)
                    await w.locator("#shJoin").tap(); await w.wait_for_timeout(400)
                    offers = [x for x in await w.locator('#xBody [data-jn]').evaluate_all("bs=>bs.map(b=>b.dataset.jn)") if not any(i in busy for i in x.split(","))]
                    if offers:
                        await w.locator(f'#xBody [data-jn="{offers[0]}"]').tap(); await w.wait_for_timeout(700); stats["joined tables"] += 1
                        for i in offers[0].split(","): tb.append(i); busy.add(i)
                    else: say(f"   (nothing free fits next to {names[tb[0]]} — party {pa.i} squeezes onto one table)")
                    await E(w, "try{closeX()}catch(e){}"); await open_table(w, tb[0])
                if pa.booked:
                    gs = [{"name": n, "phone": ""} for n in (pa.names or [rnd.choice(NAMES)])]
                    await E(w, f"state.bookings[leadOf(groupFor({L}))]={{time:{Q(clock(pa.at))},walkin:false,guests:{Q(gs)},size:{pa.size},status:'seated',notes:'',email:''}};save();render()")
                    await w.wait_for_timeout(300); await open_table(w, tb[0])
                else:
                    await w.locator("#shWalk").tap(); await w.wait_for_timeout(800)
                pa.label = await E(w, "gname(curGroup())"); return True
            if not await act(w, f"seat party {pa.i} at {"+".join(names[x] for x in tb)}", seat): busy.difference_update(tb); return
            say(f"🪑 party {pa.i} ({pa.size}{' booked' if pa.booked else ' walk-in'}) → {pa.label} with {w._waiter}, staying {pa.stay:.0f} min")
            stats["parties seated"] += 1
            async def order_on(tab, items):
                if tab is BAR:
                    await reset(BAR, "#bar"); await BAR.locator("#barTake").tap(); await BAR.wait_for_timeout(500)
                    L = await E(BAR, f'leadOf(groupFor({int(tb[0])}))'); await BAR.locator(f'#xBody [data-bt="{L}"]').tap(); await BAR.wait_for_timeout(700)
                else: await open_table(tab, tb[0])
                its = await place(tab, items, pa.names); await send(tab)
                expected[pa.label].update(its); return its
            end = pa.at + pa.stay; t = simnow() + 2; rounds = 0
            kinds = ["drinks", "food"] + ["drinks", "food", "drinks"] * 6
            k = 0
            while t < end - 8:
                await until(t)
                kind = kinds[k] if k < len(kinds) else rnd.choice(["drinks", "dessert"]); k += 1
                if t > end - 25 and rounds >= 2: kind = "dessert"
                if pa.bar and kind == "drinks": tab = BAR
                else: tab = other if rnd.random() < .2 else w      # sometimes the other waiter takes it
                items = pick_items(kind, rnd.randint(1, min(pa.size, 4)))
                its = await act(tab, f"party {pa.i} {kind} on {pa.label}", lambda: order_on(tab, items))
                if its: rounds += 1; stats["orders sent"] += 1; say(f"   {pa.label}: {kind} by {tab._waiter} — {', '.join(its)}")
                t = simnow() + rnd.uniform(12, 40) if kind != "food" else simnow() + rnd.uniform(25, 45)
                if k == 1: t = simnow() + rnd.uniform(5, 12)
            await until(end)
            if rounds == 0:      # nobody leaves without ordering something
                its = await act(w, f"party {pa.i} last-minute drinks", lambda: order_on(w, pick_items("drinks", 1)))
                if its: rounds += 1
            async def pay():
                await open_table(w, tb[0])
                if rnd.random() < .12:      # forgot to make one XL — fix on the bill
                    await bill_tab(w); row = w.locator('.rc-it[data-ld]').filter(has_text="Lasagna").first
                    if await row.count():
                        await row.tap(); await w.wait_for_timeout(400)
                        if await w.locator('#xlVal').count():
                            await w.locator('[data-xlhalf]').tap(); await w.locator('[data-xlmake]').tap(); await w.wait_for_timeout(900)
                            expected[pa.label]["Lasagna"] -= 1; expected[pa.label]["Lasagna (XL)"] += 1; stats["XL on the bill"] += 1
                        await E(w, "try{closeX()}catch(e){}")
                if not await E(w, "!!ord"): raise Exception("table has nothing to pay")
                if pa.pay == "guests" and pa.names:
                    for g in pa.names:
                        if not await E(w, "!!ord"): break        # last guest paid → table reset itself
                        await bill_tab(w)
                        if await w.locator(f'[data-tpay="card"][data-tname={Q(g)}]').count(): await pay_guest(w, g, rnd.choice(["card", "cash"]))
                    if await E(w, "ord?billOf(ordTickets()).left:0") > 0.001: await pay_all(w, "card")
                elif pa.pay == "even":
                    n = rnd.choice([2, 3]); await split_even(w, n, [rnd.choice(["card", "cash"]) for _ in range(n)])
                    if await E(w, "ord?billOf(ordTickets()).left:0") > 0.001: await pay_all(w, "card")
                else: await pay_all(w, pa.pay)
                return True
            if await act(w, f"pay {pa.label}", pay): stats["bills paid"] += 1; say(f"💳 {pa.label} paid ({pa.pay}) after {simnow()-pa.at:.0f} min")
        finally:
            # only give the table to the next party once the app shows it free
            for _ in range(30):
                if not await E(A, f"!!state.bookings[leadOf(groupFor({int(tb[0])}))]"): break
                await asyncio.sleep(10)
            else: say(f"   (table {'+'.join(names[x] for x in tb)} kept back — still occupied in the app)"); return
            busy.difference_update(tb)

    async def bar_walkups():
        t = rnd.uniform(5, 20)
        while t < MIN - 10:
            await until(t)
            async def go():
                await reset(BAR, "#bar"); await BAR.locator("#barTake").tap(); await BAR.wait_for_timeout(400)
                await BAR.locator('#xBody [data-bt="walk"]').tap(); await BAR.wait_for_timeout(700)
                its = await place(BAR, pick_items("drinks", rnd.randint(1, 3)), []); await send(BAR)
                lab = await E(BAR, "ordTickets()[0]&&ordTickets()[0].label"); expected[lab].update(its)
                await pay_all(BAR, rnd.choice(["card", "cash"])); return lab
            lab = await act(BAR, "bar walk-up", go)
            if lab: stats["bar walk-ups"] += 1; say(f"🍺 {lab} at the bar, paid")
            t = simnow() + rnd.uniform(12, 35)

    async def takeaways():
        t = rnd.uniform(10, 25)
        while t < MIN - 15:
            await until(t); w = rnd.choice([A, B]); at = None; pq = 0
            if rnd.random() < .4: pq = rnd.choice([20, 30, 45, 60]); at = f"+{pq} min"
            async def go():
                await reset(w); await w.locator("#pickBtn").tap(); await w.wait_for_timeout(600)
                if await cart(w): raise Exception("takeaway opened with items already in it")
                its = await place(w, pick_items("food", rnd.randint(1, 3)) + ([("d", "Coke · Regular")] if rnd.random() < .3 else []), [])
                await send(w, pq); lab = await E(w, "ordTickets()[0].label"); expected[lab].update(its)
                tk = json.loads(await E(w, "JSON.stringify(ordTickets().map(t=>({pat:t.pat,wait:t.wait,printed:t.printed})))"))
                if pq and not all(x["pat"] for x in tk): raise Exception(f"takeaway time {at} was not saved on the ticket")
                if any(x["wait"] for x in tk): raise Exception("takeaway held back instead of going to the kitchen now")
                await pay_all(w, rnd.choice(["card", "cash"])); return lab
            lab = await act(w, "takeaway", go)
            if lab: stats["takeaways"] += 1; say(f"🍕 {lab}{' for '+at if at else ''} by {w._waiter}, paid")
            t = simnow() + rnd.uniform(18, 45)

    heap0 = {}
    async def watch():
        while simnow() < MIN + 1:
            await asyncio.sleep(15 * 60 / SPEED)
            for w in (A, B, BAR):
                try:
                    new = w._errs[w._seen:]; w._seen = len(w._errs)
                    for e in new: bad(f"{w._n} JS error: {e[:160]}")
                    m = json.loads(await E(w, "JSON.stringify({heap:Math.round((performance.memory&&performance.memory.usedJSHeapSize||0)/1e6),open:tickets.filter(t=>!t.closed).length,tk:tickets.length,stray:(()=>{try{const r=strayOrders();return Array.isArray(r)?r.length:0}catch(e){return -1}})(),r:(()=>{const a=performance.now();render();return Math.round(performance.now()-a)})()})"))
                    heap0.setdefault(w._n, m["heap"])
                    say(f"   ⏱ {w._n}: {m['tk']} tickets ({m['open']} open), memory {m['heap']} MB, floor redraw {m['r']} ms, stray flags {m['stray']}")
                    if m["heap"] > heap0[w._n] * 3 + 50: bad(f"{w._n}: memory grew from {heap0[w._n]} to {m['heap']} MB")
                    if m["r"] > 200: bad(f"{w._n}: floor redraw slow ({m['r']} ms)")
                except Exception as ex: bad(f"{w._n}: watch failed {str(ex)[:100]}")
            # all three tablets should agree on what's open
            try:
                ks = [await E(w, "JSON.stringify(tickets.filter(t=>!t.closed).map(t=>t.id).sort())") for w in (A, B, BAR)]
                if len(set(ks)) > 1:
                    await asyncio.sleep(20)
                    ks = [await E(w, "JSON.stringify(tickets.filter(t=>!t.closed).map(t=>t.id).sort())") for w in (A, B, BAR)]
                    if len(set(ks)) > 1: bad("tablets disagree about open orders: " + " | ".join(str(len(json.loads(k))) for k in ks))
            except Exception as ex: bad(f"compare failed {str(ex)[:100]}")

    await asyncio.gather(*[party(pa) for pa in parties], bar_walkups(), takeaways(), watch())

    say("== closing checks")
    await A.wait_for_timeout(3000)
    ts = json.loads(await E(A, "JSON.stringify(tickets)"))
    got = collections.defaultdict(collections.Counter)
    for t in ts:
        for x in t["items"]:
            if not x.get("v"): got[t["label"]][x["n"]] += x["q"]
    for lab, want in expected.items():
        want = +want; g = got.get(lab, collections.Counter())
        if g != want: bad(f"{lab}: EXTRA {dict(g - want)} MISSING {dict(want - g)}")
    for lab in got:
        if lab not in expected: bad(f"ticket nobody ordered: {lab} {dict(got[lab])}")
    openT = sorted({t["label"] for t in ts if not t["closed"]})
    if openT: bad(f"still open at close: {openT}")
    for lab in expected:
        T = [t for t in ts if t["label"] == lab and not t.get("rejected")]
        tot = round(sum(x["q"] * x["p"] for t in T for x in t["items"] if not x.get("v")), 2)
        pays = [p for t in T for p in (t.get("pays") or [])]
        if pays and not all(t.get("paid") for t in T):
            paid = round(sum(p["a"] for p in pays), 2)
            if abs(paid - tot) > 0.02: bad(f"{lab}: payments £{paid:.2f} vs bill £{tot:.2f}")
    # everything on a ticket must be printable on the thermal printers (code page 437, like the printer app)
    PRINTABLE = set(map(chr, range(32, 127))) | set("£·½¼°éèêëàáâäìíîïòóôöùúûüñçÉÄÖÜÑÇ×—–−’‘“”…€")
    for t in ts:
        for x in t["items"]:
            odd = {c for c in x["n"] + (x.get("note") or "") if c not in PRINTABLE}
            if odd: bad(f"{t['label']}: '{x['n']}' has letters the printer can't print: {''.join(sorted(odd))}")
    rep = json.loads(await E(A, "(()=>{const r=buildReport({tk:tickets,ds:dateKey,de:dateKey,bk:[]});return JSON.stringify({sales:r.sales,paid:r.paidAmt,card:r.card,cash:r.cash,open:r.openAmt})})()"))
    sold = round(sum(x["q"] * x["p"] for t in ts if not t.get("rejected") for x in t["items"] if not x.get("v")), 2)
    say(f"day report: {rep} · everything sold £{sold:.2f}")
    if abs((rep.get("sales") or 0) - sold) > 0.05: bad(f"day report sales £{rep.get('sales')} ≠ sold £{sold}")
    for w in (A, B, BAR):
        for e in w._errs[w._seen:]: bad(f"{w._n} JS error: {e[:160]}")
        c = json.loads(await E(w, "JSON.stringify(Object.fromEntries(Object.entries(carts).filter(([k,v])=>v&&v.length)))"))
        if c: bad(f"{w._n}: leftover basket {c}")
        await snap(w, "end_" + w._n.split()[1])
    busy_left = await E(A, "Object.keys(state.bookings).length")
    if busy_left: bad(f"{busy_left} tables still marked busy at close")
    summary = {"minutes": MIN, "speed": SPEED, "tickets": len(ts), "sold": sold, "report": rep, "stats": dict(stats), "problems": problems}
    json.dump(summary, open(OUT + "/summary.json", "w"), indent=1, ensure_ascii=False)
    say(f"RESULT: {len(problems)} problem(s) · {len(ts)} tickets · £{sold:.2f} · {dict(stats)}")
    for x in problems: say(" -", x)
    await b.close()

try: asyncio.run(main())
finally: srv.kill()
