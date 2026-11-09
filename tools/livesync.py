# Two-device sync test against the REAL website + database (training mode, so no real data is touched).
import asyncio, time
from playwright.async_api import async_playwright
URL = "https://kangparwinder03-glitch.github.io/Trattoria-57/?v=" + str(int(time.time()))
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
        TID = await W.evaluate("(()=>{const t=[...document.querySelectorAll('.tbl')].filter(e=>!/booked|seated|fl-/.test(e.className)&&!e.className.includes('bart'));return +t[t.length-1].dataset.id})()")
        TNAME = await W.evaluate(f"document.querySelector('.tbl[data-id=\"{TID}\"] .ttop').innerText.split('\\n')[0]")
        log("using free table id", TID, "name", TNAME)
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
        # waiter keeps the order open on "Orders & bill" while the kitchen works through the statuses
        await W.mouse.click(x, y); await W.wait_for_timeout(600)
        try: await W.click("#ordOv .otabs [data-t=sent]", timeout=3000)
        except Exception as e: log("could not open sent tab", e)
        rd = lambda: W.evaluate("(()=>{const c=[...document.querySelectorAll('#oBody .st-card')].pop();return c?c.querySelector('.h').innerText.replace(/\\s+/g,' '):'(none)'})()")
        log("waiter sees:", await rd())
        for step in range(3):
            pressed = await K.evaluate("""(NAME)=>{const c=[...document.querySelectorAll('#kitchen .tk')].filter(t=>t.innerText.toUpperCase().includes(('TABLE '+NAME).toUpperCase()));const t=c[c.length-1];if(!t)return false;const b=t.querySelector('button[data-k=next]');if(!b)return false;const tx=b.innerText;b.click();return tx}""", TNAME)
            before = await rd(); t0 = time.time(); now = before
            while time.time() - t0 < 30:
                now = await rd()
                if now != before: break
                await asyncio.sleep(0.25)
            log(f"kitchen pressed {pressed!r} -> waiter order screen changed after {round(time.time()-t0,1) if now!=before else None}s: {now}")
            await K.wait_for_timeout(800)
        log("kitchen 'To do' count:", await K.inner_text("#kitchen .n-todo"), "served count:", await K.inner_text("#kitchen .n-served"))
        await b.close()
asyncio.run(main())
