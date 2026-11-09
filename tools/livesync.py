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
            await ctx.add_init_script("localStorage.setItem('t57-train','1');localStorage.setItem('t57-3d-hint','0');localStorage.setItem('t57-waiter',JSON.stringify({id:'synctest',name:'Sync test'}))")
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
        await W.click('#pickBtn'); await W.wait_for_timeout(600)
        await W.wait_for_timeout(400)
        await W.click('#oCats [data-side="food"]'); await W.click('#oCats button[data-c="Pizza"]'); await W.click('.mi[data-n="Pizza Margherita"] .add')
        await W.click('#oFoot [data-f=review]'); await W.click('#oFoot [data-f=send]'); await W.wait_for_timeout(800)
        if await W.evaluate("document.getElementById('xOv').classList.contains('show')"):
            log("app asks 'Who is serving?' (staff exist) - closing it and sending without login is not allowed, so skip"); await W.click('#xClose')
        t_send = time.time(); log("waiter sent order")
        try: await W.click("#oClose", timeout=3000)
        except Exception: pass
        d = await waitfor(K, f"document.querySelectorAll('#kitchen .tk').length>{before}", 40)
        log("KITCHEN received the new order after", d, "s")
        # one-tap kitchen: press Ready once; the waiter's screen should flash orange and the order show SERVED
        pressed = await K.evaluate("""()=>{const c=[...document.querySelectorAll('#kitchen .tk')];const t=c[c.length-1];if(!t)return false;const b=t.querySelector('button[data-k=ready]');if(!b)return 'no ready button: '+t.innerText.slice(0,60);b.click();return b.innerText}""")
        t0 = time.time(); log("kitchen pressed:", pressed)
        fl = await waitfor(W, "document.getElementById('bigFlash').className.includes('on')", 20)
        log("WAITER orange flash after", fl, "s:", (await W.inner_text("#bigFlash")).replace("\n"," | "))
        await W.click("#bigFlash"); await W.wait_for_timeout(300)
        log("kitchen 'To do' now:", await K.inner_text("#kitchen .n-todo"), "| served:", await K.inner_text("#kitchen .n-served"))
        log("page errors seen above? (none printed = OK)")
        await b.close()
asyncio.run(main())
