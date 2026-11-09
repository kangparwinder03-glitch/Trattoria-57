# Two-device sync test against the REAL website + database (training mode, so no real data is touched).
import asyncio, time
from playwright.async_api import async_playwright
URL = "https://kangparwinder03-glitch.github.io/Trattoria-57/?v=" + str(int(time.time()))
TID = 23   # table 15 (corner annex)
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
async def waitfor(pg, js, secs):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if await pg.evaluate(js): return round(time.time() - t0, 1)
        except Exception: pass
        await asyncio.sleep(0.25)
    return None
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pages = []
        for name in ("waiter", "kitchen"):
            ctx = await b.new_context(viewport={"width": 1100, "height": 850})
            await ctx.add_init_script("localStorage.setItem('t57-train','1');localStorage.setItem('t57-3d-hint','0')")
            pg = await ctx.new_page(); pg.on("console", lambda m, n=name: m.type == "error" and log(n, "console:", m.text))
            pg.on("pageerror", lambda e, n=name: log(n, "PAGE ERROR:", e))
            pages.append(pg)
        W, K = pages
        await W.goto(URL); await K.goto(URL + "#kitchen")
        for n, pg in (("waiter", W), ("kitchen", K)):
            st = await waitfor(pg, "document.getElementById('status').textContent.includes('live')", 20)
            log(n, "connected after", st, "s; status:", await pg.inner_text("#status"), "| training bar:", not await pg.evaluate("document.getElementById('trainBar').hidden"))
        before = await K.evaluate("document.querySelectorAll('#kitchen .tk').length")
        # waiter sends food to table 15
        x, y = await W.evaluate(f"(()=>{{const r=document.querySelector('.tbl[data-id=\"{TID}\"] .ttop').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]}})()")
        await W.mouse.click(x, y); await W.wait_for_timeout(400)
        if await W.evaluate("document.getElementById('shWalk')&&document.getElementById('sheetOv')?true:!!document.getElementById('shWalk')"):
            try: await W.click("#shWalk", timeout=3000)
            except Exception: pass
        await W.wait_for_timeout(400)
        await W.click('#oCats [data-side="food"]'); await W.click('#oCats button[data-c="Pizza"]'); await W.click('.mi[data-n="Pizza Margherita"] .add')
        await W.click('#oFoot [data-f=review]'); await W.click('#oFoot [data-f=send]'); t_send = time.time(); log("waiter sent order")
        await W.click("#oClose")
        d = await waitfor(K, f"document.querySelectorAll('#kitchen .tk').length>{before}", 40)
        log("KITCHEN received the new order after", d, "s")
        # kitchen presses the status button on the newest Table 15 ticket
        for step in range(2):
            ok = await K.evaluate("""(()=>{const c=[...document.querySelectorAll('#kitchen .tk')].filter(t=>t.innerText.includes('15'));const t=c[c.length-1];if(!t)return false;const b=t.querySelector('button[data-k=next]');if(!b)return false;b.click();return b.innerText})()""")
            log("kitchen pressed:", ok); 
            d2 = await waitfor(W, f"/fl-(prep|srv)/.test(document.querySelector('.tbl[data-id=\"{TID}\"]').className)", 40)
            log("WAITER floor flashed after", d2, "s; class:", await W.evaluate(f"document.querySelector('.tbl[data-id=\"{TID}\"]').className"))
            # acknowledge flash by tapping the table, then wait
            await W.mouse.click(x, y); await W.wait_for_timeout(1500)
            try: await W.click("#oClose", timeout=1500)
            except Exception: pass
        await b.close()
asyncio.run(main())
