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
const docs = {};
const subs = new Map();   // live-update subscribers (see below)   // "coll/id" -> { coll, id, data }
const put = (coll, id, data) => { docs[coll + "/" + id] = { coll, id, data, updated_at: new Date().toISOString() }; live(docs[coll + "/" + id]); };

// pretend live updates (Supabase Realtime): a tiny WebSocket server that tells subscribers about every change
function wsSend(sock, o) {
  const b = Buffer.from(JSON.stringify(o)), n = b.length;
  const h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const x = Buffer.alloc(10); x[0] = 0x81; x[1] = 127; x.writeBigUInt64BE(BigInt(n), 2); return x; })();
  try { sock.write(Buffer.concat([h, b])); } catch (e) {}
}
function live(rec, type = "UPDATE") { for (const [sock, topic] of subs) wsSend(sock, { topic, event: "postgres_changes", ref: null,
  payload: { data: { schema: "public", table: "t57_docs", type, commit_timestamp: new Date().toISOString(), record: type === "DELETE" ? {} : rec, old_record: type === "DELETE" ? rec : {} }, ids: [1] } }); }

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
    if (["select", "order", "offset", "limit", "updated_at", "on_conflict"].includes(k)) continue;
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
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Private-Network": "true" }); return res.end(); }
    if (u.pathname === "/auth/v1/token") {
      const b = JSON.parse(body || "{}");
      if (u.searchParams.get("grant_type") === "password" && !(b.email === "test@t57.local" && b.password === "pw")) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: "tok-" + Date.now(), expires_in: 3600, refresh_token: "ref" });
    }
    if (u.pathname === "/ipify") return send(200, { ip: "203.0.113.7" });
    if (u.pathname === "/auth/v1/user") return (req.headers.authorization || "").indexOf("tok-") >= 0 ? send(200, { email: "test@t57.local" }) : send(401, {});
    if (u.pathname.startsWith("/__")) { /* test helpers below */ }
    else if ((req.headers.authorization || "").indexOf("tok-") < 0) return send(401, { message: "not signed in" });
    if (u.pathname === "/rest/v1/t57_docs" && req.method === "GET") {
      let rows = Object.values(docs);
      for (const [k, v] of filt(u.searchParams)) rows = rows.filter(r => k.startsWith("data->>") ? String(r.data[k.slice(7)] ?? "") === v && r.data[k.slice(7)] !== undefined : String(r[k]) === v);
      // the printer apps only ask for what still needs printing (like Supabase does with these filters)
      const or = u.searchParams.get("or");
      if (or) { const f = or.replace(/^\(|\)$/g, "").split(",").map(x => /^data->>(\w+)\.(is|eq)\.(.*)$/.exec(x));
        rows = rows.filter(r => f.some(([, k, op, v]) => op === "is" ? r.data[k] == null : r.data[k] != null && String(r.data[k]) === v)); }
      for (const [k, v] of u.searchParams) { const m = /^data->(\w+)$/.exec(k), g = /^gte\.(.*)$/.exec(v);
        if (m && g) rows = rows.filter(r => typeof r.data[m[1]] === "number" && r.data[m[1]] >= +g[1]); }
      const gt = /^gt\.(.*)$/.exec(u.searchParams.get("updated_at") || "");
      if (gt) rows = rows.filter(r => r.updated_at > gt[1]);
      if ((u.searchParams.get("order") || "").startsWith("updated_at")) rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      else rows.sort((a, b) => (a.coll + a.id).localeCompare(b.coll + b.id));
      const off = +(u.searchParams.get("offset") || 0), lim = +(u.searchParams.get("limit") || 1e9);
      rows = rows.slice(off, off + lim);
      const sel = (u.searchParams.get("select") || "").split(",");
      return send(200, rows.map(r => Object.fromEntries(sel.map(f => [f, r[f]]))));
    }
    if (u.pathname === "/rest/v1/rpc/t57_merge") {
      const { c, i, patch } = JSON.parse(body);
      const d = docs[c + "/" + i] || { coll: c, id: i, data: {} };
      d.data = Object.assign(d.data, patch); d.updated_at = new Date().toISOString(); docs[c + "/" + i] = d; live(d);
      fs.writeFileSync(path.join(outDir, "db.json"), JSON.stringify(docs, null, 1));
      return send(200);
    }
    // the till computer copying its changes up (upsert) and deletes
    if (u.pathname === "/rest/v1/t57_docs" && req.method === "POST") {
      const rowsIn = [].concat(JSON.parse(body));
      if (!/merge-duplicates/.test(req.headers.prefer || "") && rowsIn.some(r => docs[r.coll + "/" + r.id])) return send(409, { code: "23505", message: "duplicate key value violates unique constraint" });
      for (const r of rowsIn) { docs[r.coll + "/" + r.id] = { coll: r.coll, id: r.id, data: r.data, updated_at: r.updated_at || new Date().toISOString() }; live(docs[r.coll + "/" + r.id]); }
      log.push("UPSERT " + rowsIn.map(r => r.coll + "/" + r.id).join(" "));
      fs.writeFileSync(path.join(outDir, "db.json"), JSON.stringify(docs, null, 1));
      return send(201);
    }
    if (u.pathname === "/rest/v1/t57_docs" && req.method === "DELETE") {
      for (const r of Object.values(docs).filter(r => filt(u.searchParams).every(([k, v]) => String(r[k]) === v))) { delete docs[r.coll + "/" + r.id]; live(r, "DELETE"); } fs.writeFileSync(path.join(outDir, "db.json"), JSON.stringify(docs, null, 1));
      return send(204);
    }
    // test helper: what's in the online database right now / add something as if a customer's phone saved it
    if (u.pathname === "/__all") return send(200, docs);
    if (u.pathname === "/__put" && req.method === "POST") { const r = JSON.parse(body);
      if (r.t) { docs[r.coll + "/" + r.id] = { coll: r.coll, id: r.id, data: r.data, updated_at: r.t }; live(docs[r.coll + "/" + r.id]); } else put(r.coll, r.id, r.data);   // t: a device whose clock is wrong
      return send(200, docs[r.coll + "/" + r.id]); }
    if (u.pathname === "/__del" && req.method === "POST") { const r = JSON.parse(body), d = docs[r.coll + "/" + r.id]; delete docs[r.coll + "/" + r.id]; if (d) live(d, "DELETE"); return send(200, {}); }
    if (u.pathname === "/__subs") return send(200, { n: subs.size });
    send(404, { message: "no such call" });
  });
});
server.on("upgrade", (req, sock) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname !== "/realtime/v1/websocket" || !u.searchParams.get("apikey")) { sock.destroy(); return; }
  const acc = require("crypto").createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  let buf = Buffer.alloc(0);
  sock.on("data", d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      let n = buf[1] & 0x7f, off = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); off = 4; } else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + 4 + n) return;
      const op = buf[0] & 0x0f, mk = buf.slice(off, off + 4), data = Buffer.from(buf.slice(off + 4, off + 4 + n)); buf = buf.slice(off + 4 + n);
      for (let i = 0; i < n; i++) data[i] ^= mk[i & 3];
      if (op === 0x8) { subs.delete(sock); sock.destroy(); return; }
      if (op !== 0x1) continue;
      const m = JSON.parse(data.toString("utf8"));
      log.push("WS " + m.event);
      if (m.event === "phx_join") {
        const ok = String((m.payload || {}).access_token || "").startsWith("tok-");
        wsSend(sock, { topic: m.topic, event: "phx_reply", ref: m.ref, join_ref: m.join_ref, payload: ok ? { status: "ok", response: { postgres_changes: [{ id: 1, event: "*", schema: "public", table: "t57_docs" }] } } : { status: "error", response: { reason: "bad token" } } });
        if (ok) subs.set(sock, m.topic);
      } else wsSend(sock, { topic: m.topic, event: "phx_reply", ref: m.ref, payload: { status: "ok", response: {} } });
    }
  });
  sock.on("close", () => subs.delete(sock)); sock.on("error", () => subs.delete(sock));
});
server.listen(dbPort, process.env.MOCK_HOST || "127.0.0.1", () => console.log("mock database on", dbPort));

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
