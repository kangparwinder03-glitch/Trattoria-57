// Two pretend iPads working from the till computer, then the till computer going off and coming back.
//   node test/tablets-test.js      (needs Playwright + Chromium)
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), http = require("http"), os = require("os");
const { chromium } = require("playwright");
const out = path.join(__dirname, "out-tablets"); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const IP = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === "IPv4" && !a.internal).address;
process.env.T57_SUPA_BASE = `http://${IP}:54341`;
process.env.T57_IPIFY = `http://${IP}:54341/ipify`;
process.env.T57_HUB_PORT = "57581";
process.env.T57_SUPA_LIB_FILE = path.join(__dirname, "mocklib.js");
const { Hub } = require("../src/hub");
const mock = spawn(process.execPath, [path.join(__dirname, "mock.js"), out, "54341"], { stdio: "inherit", env: Object.assign({}, process.env, { MOCK_HOST: "0.0.0.0" }) });

// the website, with a test hook to look inside the app
const docs = path.join(__dirname, "..", "..", "docs"), site = path.join(out, "site"); fs.mkdirSync(site);
for (const f of fs.readdirSync(docs)) fs.copyFileSync(path.join(docs, f), path.join(site, f));
let html = fs.readFileSync(path.join(site, "index.html"), "utf8"); const i = html.lastIndexOf("})();");
fs.writeFileSync(path.join(site, "index.html"), html.slice(0, i) + "window.__ev=s=>eval(s);\n" + html.slice(i));
http.createServer((q, s) => { const f = path.join(site, decodeURIComponent(new URL(q.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
  fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200); s.end(b); }); }).listen(54342, "127.0.0.1");

const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  — " + info : "")); if (!ok) fails++; };
const mockAll = () => new Promise(ok => http.get(`http://${IP}:54341/__all`, r => { const p = []; r.on("data", d => p.push(d)); r.on("end", () => ok(JSON.parse(Buffer.concat(p).toString()))); }));
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await wait(250); } return false; }
const dir = path.join(out, "hubdata");
// bookings: made the same way the booking form saves them
const book = (pg, L, time, name) => pg.evaluate(([L, time, name]) => window.__ev(`state.bookings[${L}]={time:"${time}",notes:"",guests:[{name:"${name}",phone:""}],email:"",status:"confirmed",size:2,walkin:false};render();save()`), [L, time, name]);
const sees = (pg, L) => pg.evaluate(L => window.__ev(`!!state.bookings[${L}]`), L);
const dayOf = pg => pg.evaluate(() => window.__ev("dateKey"));
// a day is saved as one record, with each table's booking under "b:<table>"
const onlineBk = async (day, L) => !!(((await mockAll())["plan23/" + day] || {}).data || {})["b:" + L];
const tillBk = (hub, day) => { const d = (hub.store.get("plan23", day) || { data: {} }).data; return L => !!d["b:" + L]; };
const newHub = () => new Hub({ dir, site: "http://127.0.0.1:54342/", onLog: t => console.log("   till: " + t) });
function crash(h) { for (const c of h.online.timer ? [h.online.timer] : []) clearTimeout(c); h.online.creds = null; h.online.kick = () => {};
  for (const c of h.clients) { try { c.destroy(); } catch (e) {} } h.server.close(); if (h.server.closeAllConnections) h.server.closeAllConnections(); }

(async () => {
  await wait(700);
  let hub = newHub(); await hub.start(); hub.online.setCreds({ email: "test@t57.local", pass: "pw" });
  check("till ready", await until(() => hub.store.meta.imported));
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ipad = { viewport: { width: 1180, height: 820 }, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" };
  const url = `http://${IP}:57581/`;
  const pads = [];
  for (const n of [1, 2]) {
    const ctx = await browser.newContext(ipad), pg = await ctx.newPage();
    pg.on("pageerror", e => console.log(`   iPad ${n} error: ${e.message}`));
    await pg.goto(url);
    check(`iPad ${n}: asks to link once`, await until(() => pg.isVisible("text=Link this tablet to the till")));
    await pg.fill("#lgEmail", "test@t57.local"); await pg.fill("#lgPass", "pw"); await pg.click("#loginOv button[type=submit]");
    check(`iPad ${n}: working from the till`, await until(async () => (await pg.evaluate(() => document.body.dataset.hub)) === "till"));
    pads.push(pg);
  }
  const [a, b] = pads;
  await a.screenshot({ path: path.join(out, "ipad-on-till.png") });
  const ids = pg => pg.evaluate(() => window.__ev("tickets.map(t=>t.id).join(',')"));
  check("iPads see the orders kept on the till", (await ids(b)).includes("t1"), await ids(b));

  // an order on iPad 1 shows on iPad 2 at once, and goes online
  await a.evaluate(() => window.__ev(`db.collection("tickets").doc("x1").set({station:"kitchen",date:dateKey,createdAt:Date.now(),label:"Table 8",no:21,items:[{n:"Margherita",q:1,p:9}]})`));
  const t0 = Date.now();
  check("order from iPad 1 appears on iPad 2", await until(async () => (await ids(b)).includes("x1"), 5000), (Date.now() - t0) + " ms");
  check("and is copied online within seconds", await until(async () => !!(await mockAll())["tickets/x1"], 10000));
  const before = (await mockAll());
  const ns = Object.values(before).filter(r => r.coll === "tickets").length;
  check("takeaway number claims work through the till", await a.evaluate(() => window.__ev(`db.claim("claims","pno-test",{})`)) === true &&
    await b.evaluate(() => window.__ev(`db.claim("claims","pno-test",{})`)) === false);

  // bookings: two iPads booking at once, nothing lost anywhere
  const day = await dayOf(a);
  await book(a, 3, "19:00", "Test Rossi"); await book(b, 4, "19:30", "Test Bianchi");
  check("booking from iPad 1 shows on iPad 2", await until(() => sees(b, 3), 8000));
  check("booking from iPad 2 shows on iPad 1", await until(() => sees(a, 4), 8000));
  check("both bookings kept on the till", await until(() => { const t = tillBk(hub, day); return t(3) && t(4); }, 8000));
  check("both bookings copied online", await until(async () => await onlineBk(day, 3) && await onlineBk(day, 4), 10000));
  // a booking for another day (the bookings list)
  const tmr = await a.evaluate(() => window.__ev("addDays(dateKey,1)"));
  await a.evaluate(t => window.__ev(`(async()=>{const st=await loadDay("${t}");st.bookings[7]={time:"20:00",notes:"",guests:[{name:"Test Verdi",phone:""}],email:"",status:"pending",size:4,walkin:false};await saveDay("${t}",st)})()`), tmr);
  check("booking for tomorrow kept on the till", await until(() => tillBk(hub, tmr)(7), 8000));
  check("booking for tomorrow copied online", await until(() => onlineBk(tmr, 7), 10000));
  check("iPad 2's bookings list shows tomorrow's booking", await until(() => b.evaluate(t => window.__ev(`allDays().then(d=>!!(d["${t}"]&&d["${t}"].bookings[7]))`), tmr), 8000));

  // the till computer goes off (crash, no goodbye)
  crash(hub);
  check("iPads switch to online by themselves", await until(async () => (await a.evaluate(() => document.body.dataset.hub)) === "online" && (await b.evaluate(() => document.body.dataset.hub)) === "online", 20000));
  await a.screenshot({ path: path.join(out, "ipad-online.png") });
  await a.evaluate(() => window.__ev(`db.collection("tickets").doc("x2").set({station:"kitchen",date:dateKey,createdAt:Date.now(),label:"Table 9",no:22,items:[{n:"Carbonara",q:1,p:11}]})`));
  check("orders still save while the till is off (online)", await until(async () => !!(await mockAll())["tickets/x2"], 8000));
  check("orders made before the till went off are still there", (await ids(a)).includes("x1"));

  await book(a, 6, "20:30", "Test Neri");
  check("bookings still save while the till is off (online)", await until(() => onlineBk(day, 6), 8000));
  check("…and the earlier bookings are still online", await onlineBk(day, 3) && await onlineBk(day, 4));

  // back on: picks up what happened online, the iPads move back
  hub = newHub(); await hub.start(); hub.online.setCreds({ email: "test@t57.local", pass: "pw" });
  check("till picks up the orders made while it was off", await until(() => !!hub.store.get("tickets", "x2"), 20000));
  check("iPads move back to the till", await until(async () => (await a.evaluate(() => document.body.dataset.hub)) === "till" && (await b.evaluate(() => document.body.dataset.hub)) === "till", 25000));
  check("iPad 2 sees the order made while the till was off", (await ids(b)).includes("x2"));
  await b.evaluate(() => window.__ev(`db.collection("tickets").doc("x2").update({label:"Table 9B"})`));
  check("changes after moving back reach the other iPad", await until(() => a.evaluate(() => window.__ev(`(tickets.find(t=>t.id==="x2")||{}).label==="Table 9B"`)), 5000));
  check("…and go online", await until(async () => ((await mockAll())["tickets/x2"] || { data: {} }).data.label === "Table 9B", 10000));

  check("till picks up the booking made while it was off, keeps the others", await until(() => { const t = tillBk(hub, day); return t(3) && t(4) && t(6); }, 20000));
  check("iPad 2 sees all three bookings", await until(async () => await sees(b, 3) && await sees(b, 4) && await sees(b, 6), 10000));
  await book(b, 9, "21:00", "Test Gallo");
  check("booking after moving back reaches iPad 1 and online, nothing lost", await until(async () => await sees(a, 9) && await onlineBk(day, 9) && await onlineBk(day, 3) && await onlineBk(day, 6), 10000));

  // a reload keeps the link (no new sign-in)
  await b.reload();
  check("reload: still linked, no sign-in again", await until(async () => (await b.evaluate(() => document.body.dataset.hub)) === "till", 10000) && !(await b.isVisible("text=Link this tablet to the till")));
  check("reload: bookings still there", await until(async () => await sees(b, 3) && await sees(b, 4) && await sees(b, 6) && await sees(b, 9), 10000));

  // the bug from 27 Nov: a new till that isn't signed in yet must not take over, and must not wipe a day online
  await hub.stop(); fs.rmSync(dir, { recursive: true, force: true });
  hub = newHub(); await hub.start();
  const c = await browser.newContext(ipad), till = await c.newPage();
  await till.goto(`http://127.0.0.1:57581/`);
  await wait(4000);
  await book(till, 12, "21:30", "Test Moro");   // someone books on the till before it's signed in
  await wait(3000);
  check("new till not signed in yet: that booking waits, nothing goes online", !(await onlineBk(day, 12)) && await onlineBk(day, 3));
  let refused = null; try { hub.op({ op: "merge", coll: "plan23", id: day, patch: { bookings: {} } }); } catch (e) { refused = e; }
  check("new till not signed in yet: saving is refused", refused && refused.status === 503);
  hub.online.setCreds({ email: "test@t57.local", pass: "pw" });
  check("after signing in it copies the bookings from online", await until(() => { const t = tillBk(hub, day); return t(3) && t(4) && t(6) && t(9); }, 20000));
  await wait(5000);
  check("the booking made before signing in is saved once it can be", await until(() => onlineBk(day, 12), 15000));
  check("and nothing was wiped online", await onlineBk(day, 3) && await onlineBk(day, 4) && await onlineBk(day, 6) && await onlineBk(day, 9) && await onlineBk(tmr, 7));
  await browser.close(); await hub.stop(); mock.kill("SIGTERM");
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("CRASH", e); mock.kill(); process.exit(1); });
