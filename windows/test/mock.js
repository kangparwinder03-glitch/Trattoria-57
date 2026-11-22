// Test bench: a pretend Trattoria 57 database (same web calls as Supabase) and pretend network printers
// that save whatever they're sent. Nothing real is touched.
//   node test/mock.js <outdir> <dbPort> <printerPort...>
"use strict";
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const outDir = process.argv[2] || path.join(__dirname, "out");
const dbPort = +(process.argv[3] || 54321);
const prnPorts = process.argv.slice(4).map(Number);
fs.mkdirSync(outDir, { recursive: true });

const ymd = () => { const d = new Date(Date.now() - 5 * 3600000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const now = Date.now();
const docs = {};   // "coll/id" -> { coll, id, data }
const put = (coll, id, data) => { docs[coll + "/" + id] = { coll, id, data, updated_at: new Date().toISOString() }; };

// orders like the website saves them
put("tickets", "t1", { station: "kitchen", date: ymd(), createdAt: now - 60000, label: "Table 4", no: 12, covers: 3, byName: "Sam",
  items: [{ n: "Bruschetta", en: "Bruschetta", q: 1, p: 6.5, c: "s" }, { n: "Pizza Diavola", en: "Pizza Diavola", q: 2, p: 12.9, c: "m", note: "gluten free base" },
          { n: "Tiramisù", en: "Tiramisu", q: 1, p: 6.5, c: "d" }], note: "Birthday table" });
put("tickets", "t2", { station: "kitchen", date: ymd(), createdAt: now - 30000, pickup: true, pno: 57, pat: "19:30", pname: "Dave", pphone: "07700 900111", no: 13,
  items: [{ n: "Spaghetti alla Bolognese", en: "Spaghetti Bolognese", q: 1, p: 11.9 }, { n: "Patatine", en: "Fries", q: 2, p: 3.5 }] });
put("tickets", "t3", { station: "bar", date: ymd(), createdAt: now - 20000, label: "Table 4", no: 12, byName: "Sam",
  items: [{ n: "Peroni · Pint", q: 2, p: 6 }, { n: "Coke · Regular", q: 1, p: 2.4, note: "No ice" }] });
put("tickets", "t4", { station: "kitchen", date: ymd(), createdAt: now - 10000, label: "Table 9", no: 14, hold: true, items: [{ n: "Held order", q: 1, p: 1 }] });
put("tickets", "t5", { station: "kitchen", date: ymd(), createdAt: now - 10000, label: "Table 2", no: 11, printed: now - 5000, items: [{ n: "Already printed", q: 1, p: 1 }] });
put("printjobs", "j1", { to: "till", kind: "bill", title: "Bill Table 4", logo: "full", createdAt: now - 5000, date: ymd(),
  lines: [{ l: "Table 4", r: "22/11/2026, 19:05" }, { rule: "-" }, { l: "1 x Bruschetta", r: "£6.50" }, { l: "2 x Pizza Diavola", r: "£25.80" },
          { l: "2 x Peroni · Pint", r: "£12.00" }, { rule: "-" }, { l: "Subtotal", r: "£44.30" }, { l: "TOTAL", r: "£44.30", b: 1, s: 2 }],
  reviews: [{ n: "Google", u: "https://g.page/r/example/review" }], social: [] });
put("printjobs", "j2", { to: "till", kind: "bill", title: "Old bill (yesterday)", createdAt: now - 3 * 86400000, lines: [{ t: "SHOULD NOT PRINT" }] });
put("alexa", "main", { on: false });
put("menu", "main", { items: 123 });

const log = [];
function filt(q) {
  const out = [];
  for (const [k, v] of q) {
    if (["select", "order", "offset", "limit"].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v); if (!m) continue;
    out.push([k, m[1]]);
  }
  return out;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let body = ""; req.on("data", d => body += d);
  req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
    log.push(req.method + " " + u.pathname);
    if (u.pathname === "/auth/v1/token") {
      const b = JSON.parse(body || "{}");
      if (u.searchParams.get("grant_type") === "password" && !(b.email === "test@t57.local" && b.password === "pw")) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: "tok-" + Date.now(), expires_in: 3600, refresh_token: "ref" });
    }
    if ((req.headers.authorization || "").indexOf("tok-") < 0) return send(401, { message: "not signed in" });
    if (u.pathname === "/rest/v1/t57_docs" && req.method === "GET") {
      let rows = Object.values(docs);
      for (const [k, v] of filt(u.searchParams)) rows = rows.filter(r => k.startsWith("data->>") ? String(r.data[k.slice(7)] ?? "") === v && r.data[k.slice(7)] !== undefined : String(r[k]) === v);
      rows.sort((a, b) => (a.coll + a.id).localeCompare(b.coll + b.id));
      const off = +(u.searchParams.get("offset") || 0), lim = +(u.searchParams.get("limit") || 1e9);
      rows = rows.slice(off, off + lim);
      const sel = (u.searchParams.get("select") || "").split(",");
      return send(200, rows.map(r => Object.fromEntries(sel.map(f => [f, r[f]]))));
    }
    if (u.pathname === "/rest/v1/rpc/t57_merge") {
      const { c, i, patch } = JSON.parse(body);
      const d = docs[c + "/" + i] || { coll: c, id: i, data: {} };
      d.data = Object.assign(d.data, patch); docs[c + "/" + i] = d;
      fs.writeFileSync(path.join(outDir, "db.json"), JSON.stringify(docs, null, 1));
      return send(200);
    }
    send(404, { message: "no such call" });
  });
});
server.listen(dbPort, "127.0.0.1", () => console.log("mock database on", dbPort));

for (const p of prnPorts) {
  let n = 0;
  net.createServer(sock => {
    const parts = [];
    sock.on("data", d => parts.push(d));
    sock.on("end", () => { const b = Buffer.concat(parts); if (b.length) { n++; fs.writeFileSync(path.join(outDir, `printer-${p}-${String(n).padStart(2, "0")}.bin`), b); } });
    sock.on("error", () => {});
  }).listen(p, "127.0.0.1", () => console.log("pretend printer on", p));
}
process.on("SIGTERM", () => { fs.writeFileSync(path.join(outDir, "calls.txt"), log.join("\n")); process.exit(0); });
