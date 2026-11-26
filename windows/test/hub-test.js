// Tests the restaurant hub on its own (no window): first copy from online, tablets saving and reading,
// live updates, copying changes up, picking up QR orders saved online, restart keeps everything.
//   node test/hub-test.js
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), http = require("http");
const out = path.join(__dirname, "out-hub"); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
process.env.T57_SUPA_BASE = "http://127.0.0.1:54331";
process.env.T57_IPIFY = "http://127.0.0.1:54331/ipify";
process.env.T57_HUB_PORT = "57571";
const { Hub } = require("../src/hub");
const mock = spawn(process.execPath, [path.join(__dirname, "mock.js"), out, "54331"], { stdio: "inherit" });
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  — " + info : "")); if (!ok) fails++; };
function call(method, p, body, tok) {
  return new Promise((ok, bad) => {
    const req = http.request({ host: "127.0.0.1", port: 57571, path: p, method, headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}) }, res => {
      const parts = []; res.on("data", d => parts.push(d)); res.on("end", () => { const t = Buffer.concat(parts).toString(); let j = null; try { j = JSON.parse(t); } catch (e) {} ok({ status: res.statusCode, j, t }); });
    });
    req.on("error", bad); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
const mockCall = (method, p, body) => new Promise((ok, bad) => {
  const req = http.request({ host: "127.0.0.1", port: 54331, path: p, method, headers: { "Content-Type": "application/json" } }, res => {
    const parts = []; res.on("data", d => parts.push(d)); res.on("end", () => ok(JSON.parse(Buffer.concat(parts).toString() || "null")));
  });
  req.on("error", bad); if (body) req.write(JSON.stringify(body)); req.end();
});

(async () => {
  await wait(600);
  const dir = path.join(out, "hubdata");
  let hub = new Hub({ dir, site: "http://127.0.0.1:9/", onLog: t => console.log("   hub: " + t) });
  check("hub starts", await hub.start());
  let r = await call("GET", "/hub/ping");
  check("not ready before the first copy", r.j && r.j.ready === false);
  hub.online.setCreds({ email: "test@t57.local", pass: "pw" });
  for (let i = 0; i < 40 && !hub.store.meta.imported; i++) await wait(250);
  check("first copy from online", hub.store.meta.imported && hub.store.size >= 9, hub.store.size + " records");
  r = await call("GET", "/hub/ping"); check("ready after the first copy", r.j && r.j.ready === true);

  // the app page, with the hub marker
  r = await call("GET", "/");
  check("serves the restaurant app (copy from the installer when offline)", r.status === 200 && r.t.includes("window.T57_HUB") && r.t.includes("makeHubDb"));
  check("the till's own screen gets its key, only on this computer", r.t.includes('"token"'));

  // linking a tablet
  r = await call("POST", "/hub/api", { op: "list", coll: "tickets" });
  check("refuses tablets that aren't linked", r.status === 401);
  r = await call("POST", "/hub/pair", { email: "test@t57.local", password: "nope" });
  check("wrong password refused", r.status === 401);
  r = await call("POST", "/hub/pair", { email: "Test@t57.local", password: "pw" });
  const tok = r.j && r.j.token; check("tablet linked with the restaurant login", !!tok);

  // live updates
  const evs = [];
  const es = http.get({ host: "127.0.0.1", port: 57571, path: "/hub/events?t=" + tok }, res => { res.on("data", d => evs.push(String(d))); });
  await wait(300);
  r = await call("POST", "/hub/api", { op: "set", coll: "tickets", id: "new1", data: { station: "kitchen", date: "2031-01-01", label: "Table 7", items: [{ n: "Pizza", q: 1 }] } }, tok);
  check("tablet saves an order", r.status === 200 && r.j.t);
  r = await call("POST", "/hub/api", { op: "merge", coll: "tickets", id: "new1", patch: { paid: true } }, tok);
  r = await call("POST", "/hub/api", { op: "list", coll: "tickets", where: [["date", "==", "2031-01-01"]] }, tok);
  check("tablet reads it back, with the change", r.j && r.j.length === 1 && r.j[0].data.paid === true && r.j[0].data.label === "Table 7");
  r = await call("POST", "/hub/api", { op: "claim", coll: "claims", id: "pno-1", data: {} }, tok);
  const r2 = await call("POST", "/hub/api", { op: "claim", coll: "claims", id: "pno-1", data: {} }, tok);
  check("takeaway numbers can't be taken twice", r.j.ok === true && r2.j.ok === false);
  await wait(300);
  check("other tablets hear about it at once", evs.join("").includes('"id":"new1"') && evs.join("").includes('"paid":true'));

  // copied up
  await wait(4500);
  let online = await mockCall("GET", "/__all");
  check("the change went online within seconds", online["tickets/new1"] && online["tickets/new1"].data.paid === true);
  check("the tablets can find this computer (heartbeat online)", online["hub/main"] && online["hub/main"].data.pub === "203.0.113.7" && online["hub/main"].data.at > 0);

  // a customer's QR order saved online gets picked up
  await mockCall("POST", "/__put", { coll: "tickets", id: "qr1", data: { qr: true, hold: true, station: "kitchen", date: "2031-01-01", label: "Table 3" } });
  for (let i = 0; i < 80 && !hub.store.get("tickets", "qr1"); i++) await wait(250);
  check("customer's QR order picked up from online", !!hub.store.get("tickets", "qr1"));
  await wait(300);
  check("and tablets hear about it", evs.join("").includes('"id":"qr1"'));

  // deleting
  await call("POST", "/hub/api", { op: "del", coll: "tickets", id: "new1" }, tok);
  await wait(4500);
  online = await mockCall("GET", "/__all");
  check("deletes go online too", !online["tickets/new1"]);

  // the printers on this computer
  const pl = hub.printList("tickets", [["station", "kitchen"]], { unprinted: true, since: 1 });
  check("printers see what still needs printing", pl.some(([i]) => i === "t1") && !pl.some(([i]) => i === "t5"), pl.map(x => x[0]).join(","));

  // no internet: changes wait, then go up
  hub.online.setCreds(null);
  await call("POST", "/hub/api", { op: "set", coll: "tickets", id: "off1", data: { label: "while offline" } }, tok);
  await wait(3500);
  check("change waits on this computer while offline", hub.store.dirty.has("tickets/off1"));

  // restart: everything still there, waiting changes still go up
  es.destroy();
  await hub.stop();
  hub = new Hub({ dir, site: "http://127.0.0.1:9/", onLog: t => console.log("   hub: " + t) });
  check("hub starts again", await hub.start());
  check("everything kept after a restart", !!hub.store.get("tickets", "qr1") && !hub.store.get("tickets", "new1") && hub.store.dirty.has("tickets/off1"));
  r = await call("POST", "/hub/api", { op: "get", coll: "tickets", id: "off1" }, tok);
  check("linked tablets stay linked", r.status === 200 && r.j && r.j.data.label === "while offline");
  hub.online.setCreds({ email: "test@t57.local", pass: "pw" });
  await wait(3000);
  online = await mockCall("GET", "/__all");
  check("waiting change sent once back online", online["tickets/off1"] && hub.store.dirty.size === 0, "waiting " + hub.store.dirty.size);
  await hub.stop();
  online = await mockCall("GET", "/__all");
  check("closing the app tells the tablets to carry on online", online["hub/main"].data.at === 0);
  mock.kill("SIGTERM");
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log("CRASH", e); mock.kill(); process.exit(1); });
