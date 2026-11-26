// The restaurant hub: this computer keeps the restaurant's data and the tablets (iPads) work from it
// over the restaurant Wi-Fi, so they don't each download everything from the internet.
//
//   • keeps every order, booking, setting… on this computer (in the app's data folder), saved as it changes
//   • serves the restaurant app to the tablets:  http://<this computer>:5757/
//   • tells the tablets about changes at once (a live "event stream")
//   • copies every change up to the online database (Supabase) within a few seconds. Uploads are tiny and
//     don't count much towards the free data allowance. The online copy is the backup, it's what the
//     customers' QR menu pages read, and the tablets switch to it by themselves if this computer goes off
//   • picks up anything saved online (customers' QR orders, devices still working online) every 15 seconds
//
// Runs in the app's main process.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const { request } = require("./cloud");

const PORT = +(process.env.T57_HUB_PORT || 5757);
const BASE = process.env.T57_SUPA_BASE || "https://uzrkewizkqdnqpovwune.supabase.co";
const KEY = "sb_publishable_Hix2EgA_xpjxMYFvmarVIQ_Hj0qx3YM";
const LIB_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
const PULL_MS = 15000, PUSH_WAIT = 2500, BEAT_MS = 120000;

const okWhere = (data, w) => (w || []).every(([f, op, v]) => {
  const a = data ? data[f] : undefined;
  return op === "==" ? a === v : op === ">=" ? a >= v : op === ">" ? a > v : op === "<=" ? a <= v : op === "<" ? a < v : true;
});
// the online database writes times in a few shapes ("2026-11-23 21:05:01.123456+00", "…T…+00:00", "…Z"): compare them as numbers
const tms = t => { if (!t) return 0; let x = String(t).trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1"); if (/[+-]\d\d$/.test(x)) x += ":00"; else if (!/(Z|[+-]\d\d:?\d\d)$/.test(x)) x += "Z"; return Date.parse(x) || 0; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));

// =====================================================================================
// The store: everything in memory, every change written to a journal file straight away,
// and the whole lot saved to one file every so often (then the journal starts again).
// =====================================================================================
class Store {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(dir, { recursive: true });
    this.colls = new Map();          // coll -> Map(id -> { data, t })
    this.dirty = new Map();          // "coll/id" -> t of the change still to go online ("" for a delete)
    this.meta = { imported: false, cursor: "" };
    this.listeners = new Set();
    this.lastT = 0; this.writes = 0;
    this.load();
  }
  file(n) { return path.join(this.dir, n); }
  coll(c) { let m = this.colls.get(c); if (!m) { m = new Map(); this.colls.set(c, m); } return m; }
  get size() { let n = 0; for (const m of this.colls.values()) n += m.size; return n; }
  /** a time stamp that always goes forwards (two saves in the same millisecond still get different stamps) */
  stamp() { const n = Math.max(Date.now(), this.lastT + 1); this.lastT = n; return new Date(n).toISOString(); }

  load() {
    try {
      const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(this.file("data.json.gz"))).toString("utf8"));
      for (const [c, i, d, t] of snap.rows || []) this.coll(c).set(i, { data: d, t });
      for (const [k, t] of snap.dirty || []) this.dirty.set(k, t);
      this.meta = Object.assign(this.meta, snap.meta || {});
    } catch (e) {}
    try {
      const lines = fs.readFileSync(this.file("journal.jsonl"), "utf8").split("\n");
      for (const ln of lines) { if (!ln) continue; let j; try { j = JSON.parse(ln); } catch (e) { continue; } this.replay(j); }
    } catch (e) {}
    for (const m of this.colls.values()) for (const r of m.values()) { const v = tms(r.t); if (v > this.lastT && v < Date.now() + 86400000) this.lastT = v; }
    this.compact();
  }
  replay(j) {
    const k = j.c + "/" + j.i;
    if (j.o === "w") { this.coll(j.c).set(j.i, { data: j.d, t: j.t }); if (j.l) this.dirty.set(k, j.t); else this.dirty.delete(k); }
    else if (j.o === "x") { this.coll(j.c).delete(j.i); if (j.l) this.dirty.set(k, ""); else this.dirty.delete(k); }
    else if (j.o === "k") { for (const [kk, t] of j.keys) if (this.dirty.get(kk) === t) this.dirty.delete(kk); }
    else if (j.o === "m") Object.assign(this.meta, j.m);
  }
  journal(j) {
    try { fs.appendFileSync(this.file("journal.jsonl"), JSON.stringify(j) + "\n"); } catch (e) {}
    if (++this.writes >= 3000) this.compact();
  }
  compact() {
    try {
      const rows = [];
      for (const [c, m] of this.colls) for (const [i, r] of m) rows.push([c, i, r.data, r.t]);
      const tmp = this.file("data.json.gz.part");
      fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify({ saved: new Date().toISOString(), meta: this.meta, rows, dirty: [...this.dirty] })));
      fs.renameSync(tmp, this.file("data.json.gz"));
      fs.writeFileSync(this.file("journal.jsonl"), "");
      this.writes = 0;
    } catch (e) {}
  }
  setMeta(m) { Object.assign(this.meta, m); this.journal({ o: "m", m }); }
  emit(ev) { for (const f of this.listeners) { try { f(ev); } catch (e) {} } }

  // ---- reading ----
  get(c, i) { const r = this.colls.get(c)?.get(i); return r ? { id: i, data: clone(r.data), updated_at: r.t } : null; }
  list(c, where) {
    const m = this.colls.get(c); if (!m) return [];
    const out = [];
    for (const [i, r] of m) if (okWhere(r.data, where)) out.push({ id: i, data: clone(r.data), updated_at: r.t });
    return out;
  }
  since(c, t) { const m = this.colls.get(c); if (!m) return []; const v = tms(t), out = [];
    for (const [i, r] of m) if (!v || tms(r.t) > v) out.push({ id: i, data: clone(r.data), updated_at: r.t }); return out; }
  newest() { let best = "", bv = 0; for (const m of this.colls.values()) for (const r of m.values()) { const v = tms(r.t); if (v > bv) { bv = v; best = r.t; } } return best; }
  all() { const out = []; for (const [c, m] of this.colls) for (const [i, r] of m) out.push({ coll: c, id: i, data: r.data, updated_at: r.t }); return out; }

  // ---- writing (local = made on this computer or a tablet connected to it, so it still has to go online) ----
  put(c, i, data, { local = true, t = null } = {}) {
    t = t || this.stamp();
    this.coll(c).set(i, { data, t });
    if (local) this.dirty.set(c + "/" + i, t); else this.dirty.delete(c + "/" + i);
    this.journal({ o: "w", c, i, d: data, t, l: local ? 1 : 0 });
    this.emit({ coll: c, id: i, data, updated_at: t, local });
    return t;
  }
  merge(c, i, patch, opts) { const r = this.colls.get(c)?.get(i); return this.put(c, i, Object.assign({}, r ? r.data : {}, patch || {}), opts); }
  remove(c, i, { local = true } = {}) {
    const had = this.coll(c).delete(i);
    if (local) this.dirty.set(c + "/" + i, ""); else this.dirty.delete(c + "/" + i);
    this.journal({ o: "x", c, i, l: local ? 1 : 0 });
    if (had || local) this.emit({ coll: c, id: i, data: null, updated_at: this.stamp(), local });
  }
  claim(c, i, data) { if (this.coll(c).has(i)) return false; this.put(c, i, data || {}); return true; }
  cleaned(keys) { const done = keys.filter(([k, t]) => this.dirty.get(k) === t); if (!done.length) return; for (const [k] of done) this.dirty.delete(k); this.journal({ o: "k", keys: done }); }
}

// =====================================================================================
// The online copy (Supabase)
// =====================================================================================
class Online {
  constructor(store, hub) { this.store = store; this.hub = hub; this.creds = null; this.token = null; this.tokenExp = 0;
    this.ok = false; this.msg = "Not signed in yet"; this.lastPull = 0; this.lastPush = 0; this.timer = null; this.pushT = null; this.busy = null; this.skew = 0; }
  setCreds(c) { this.creds = c && c.email && c.pass ? { email: c.email, pass: c.pass } : null; this.token = null; if (this.creds) this.kick(500); else { this.ok = false; this.msg = "Not signed in"; } }
  async bearer() {
    if (this.token && Date.now() < this.tokenExp - 120000) return this.token;
    if (!this.creds) throw new Error("not signed in");
    const r = await request(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.creds.email, password: this.creds.pass }) });
    if (r.status < 200 || r.status > 299) throw new Error("sign-in refused");
    const j = JSON.parse(r.text); this.token = j.access_token; this.tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
    return this.token;
  }
  async call(p, method = "GET", body = null, prefer = "") {
    const headers = { apikey: KEY, Authorization: "Bearer " + await this.bearer(), "Content-Type": "application/json", Accept: "application/json" };
    if (prefer) headers.Prefer = prefer;
    const r = await request(BASE + p, { method, headers, body: body ? JSON.stringify(body) : null, timeout: 30000 });
    if (r.headers && r.headers.date) { const s = Date.parse(r.headers.date); if (s) this.skew = Date.now() - s; }
    if (r.status === 401) this.token = null;
    if (r.status < 200 || r.status > 299) throw new Error(`HTTP ${r.status} ${r.text.slice(0, 120)}`);
    return r.text ? JSON.parse(r.text) : null;
  }
  /** checks someone's restaurant login with the online sign-in (for linking a tablet) */
  async checkLogin(email, pass) {
    const r = await request(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass }) });
    return r.status >= 200 && r.status < 300;
  }

  kick(ms = PUSH_WAIT) { clearTimeout(this.timer); this.timer = setTimeout(() => this.cycle(), ms); }
  /** a change was made here: send it up soon (several changes close together go in one go) */
  changed() { if (!this.pushT) this.pushT = setTimeout(() => { this.pushT = null; this.kick(0); }, PUSH_WAIT); }
  async cycle() {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    try {
      if (!this.creds) { this.ok = false; this.msg = "Not signed in: sign in on the Printers & backups screen so the online copy stays up to date"; return; }
      if (!this.store.meta.imported) await this.firstCopy();
      await this.pull();
      await this.push();
      if (Date.now() - (this.lastBeat || 0) > BEAT_MS) await this.beat();
      this.ok = true; this.msg = "Online copy up to date";
      if (Math.abs(this.skew) > 90000) this.msg = `⚠ This computer's clock is ${Math.round(Math.abs(this.skew) / 60000)} min ${this.skew > 0 ? "fast" : "slow"}. Fix the time in Windows settings`;
    } catch (e) {
      this.ok = false; this.msg = /no internet|ENOTFOUND|EAI_AGAIN|timed out|ECONN/i.test(e.message) ? "No internet: everything still works here, the online copy catches up when it's back" : "Online copy: " + e.message;
    } finally {
      this.busy = false; this.hub.status();
      if (this.again) { this.again = false; this.kick(200); } else this.kick(PULL_MS);
    }
  }

  /** first start: copy everything that's online onto this computer */
  async firstCopy() {
    const rows = [], step = 1000;
    for (;;) {
      const part = await this.call(`/rest/v1/t57_docs?select=coll,id,data,updated_at&order=coll.asc,id.asc&offset=${rows.length}&limit=${step}`);
      rows.push(...(part || []));
      if (!part || part.length < step) break;
    }
    let cursor = "";
    for (const r of rows) {
      if (!this.store.dirty.has(r.coll + "/" + r.id)) this.store.put(r.coll, r.id, r.data || {}, { local: false, t: r.updated_at });
      if (tms(r.updated_at) > tms(cursor)) cursor = r.updated_at;
    }
    this.store.setMeta({ imported: true, importedAt: Date.now(), importedRows: rows.length, cursor });
    this.store.compact();
    this.hub.log(`Copied ${rows.length} records from the online database onto this computer`);
  }

  /** anything saved online since last time (QR orders, devices still working online) */
  async pull() {
    // look back 10 seconds in case two devices saved at nearly the same moment (clocks are never exactly the same)
    const from = this.store.meta.cursor ? new Date(tms(this.store.meta.cursor) - 10000).toISOString() : "";
    let got = 0, cursor = this.store.meta.cursor || "";
    for (let off = 0; ; off += 1000) {
      const part = await this.call(`/rest/v1/t57_docs?select=coll,id,data,updated_at${from ? "&updated_at=gt." + encodeURIComponent(from) : ""}&order=updated_at.asc&offset=${off}&limit=1000`);
      for (const r of part || []) {
        if (tms(r.updated_at) > tms(cursor)) cursor = r.updated_at;
        if (r.coll === "hub") continue;
        const k = r.coll + "/" + r.id, mine = this.store.colls.get(r.coll)?.get(r.id);
        if (mine && same(mine.data, r.data)) continue;
        const waiting = this.store.dirty.get(k);
        // changed here too and not sent yet: the newer change wins
        if (waiting !== undefined && waiting !== "" && tms(waiting) >= tms(r.updated_at)) continue;
        if (waiting === "") continue;   // deleted here, the delete is on its way
        this.store.put(r.coll, r.id, r.data || {}, { local: false, t: r.updated_at }); got++;
      }
      if (!part || part.length < 1000) break;
    }
    if (cursor !== this.store.meta.cursor) this.store.setMeta({ cursor });
    this.lastPull = Date.now();
    if (got) this.hub.log(`⬇ ${got} change${got === 1 ? "" : "s"} picked up from online`);
  }

  /** send this computer's changes up */
  async push() {
    for (let round = 0; round < 50 && this.store.dirty.size; round++) {
      const batch = [...this.store.dirty].slice(0, 200);
      const ups = [], dels = [];
      for (const [k, t] of batch) {
        const i = k.indexOf("/"), c = k.slice(0, i), id = k.slice(i + 1);
        if (t === "") dels.push([k, t, c, id]);
        else { const r = this.store.colls.get(c)?.get(id); if (r) ups.push({ coll: c, id, data: r.data, updated_at: r.t }); else dels.push([k, t, c, id]); }
      }
      if (ups.length) await this.call("/rest/v1/t57_docs?on_conflict=coll,id", "POST", ups, "resolution=merge-duplicates,return=minimal");
      for (const [, , c, id] of dels) await this.call(`/rest/v1/t57_docs?coll=eq.${encodeURIComponent(c)}&id=eq.${encodeURIComponent(id)}`, "DELETE", null, "return=minimal");
      this.store.cleaned(batch);
      this.lastPush = Date.now();
    }
  }

  /** lets the tablets find this computer (they read this when they open the restaurant app) */
  async beat() {
    const u = this.hub.urls();
    // the restaurant's internet address: a tablet only moves over when it's on the same one (so not from home)
    if (!this.pub || Date.now() - this.pubAt > 1800000) {
      try { const r = await request(process.env.T57_IPIFY || "https://api.ipify.org?format=json", { timeout: 6000 }); this.pub = JSON.parse(r.text).ip || ""; this.pubAt = Date.now(); } catch (e) {}
    }
    await this.call("/rest/v1/rpc/t57_merge", "POST", { c: "hub", i: "main", patch: { url: u[0] || "", urls: u, at: this.hub.ready && this.store.meta.imported ? Date.now() : 0, pub: this.pub || "", name: os.hostname(), port: PORT } });
    this.lastBeat = Date.now();
  }
  async goodbye() { try { await this.call("/rest/v1/rpc/t57_merge", "POST", { c: "hub", i: "main", patch: { at: 0, off: Date.now() } }); } catch (e) {} }
}

// =====================================================================================
// The web server the tablets talk to
// =====================================================================================
class Hub {
  constructor({ dir, site, onLog }) {
    this.dir = dir; this.site = site.endsWith("/") ? site : site + "/";
    this.store = new Store(path.join(dir, "data"));
    this.online = new Online(this.store, this);
    this.onLog = onLog || (() => {});
    this.clients = new Set(); this.devs = {}; this.fails = []; this.ready = false; this.port = PORT;
    this.localToken = crypto.randomBytes(18).toString("hex");
    try { this.devs = JSON.parse(fs.readFileSync(path.join(dir, "devices.json"), "utf8")) || {}; } catch (e) {}
    this.store.listeners.add(ev => this.broadcast(ev));
    this.store.listeners.add(ev => { if (ev.local) this.online.changed(); });
    this.onStatus = () => {};
  }
  log(t) { this.onLog(t); }
  status() { this.onStatus(this.info()); }
  info() {
    return { running: this.ready, port: this.port, urls: this.urls(), tablets: this.clients.size, records: this.store.size,
      waiting: this.store.dirty.size, onlineOk: this.online.ok, onlineMsg: this.online.msg, lastPull: this.online.lastPull, lastPush: this.online.lastPush,
      linked: Object.keys(this.devs).length };
  }
  /** this computer's addresses on the restaurant network, best first */
  urls() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      if (/vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|docker|tailscale|zerotier/i.test(name)) continue;
      for (const a of list || []) if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) out.push({ a: a.address, w: /^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : 2 });
    }
    return out.sort((x, y) => x.w - y.w).map(x => `http://${x.a}:${this.port}/`);
  }
  saveDevs() { try { fs.writeFileSync(path.join(this.dir, "devices.json"), JSON.stringify(this.devs)); } catch (e) {} }
  authed(tok) { return !!tok && (tok === this.localToken || !!this.devs[tok]); }

  start() {
    return new Promise(ok => {
      this.server = http.createServer((q, s) => this.handle(q, s).catch(e => { try { s.writeHead(500); s.end(String(e.message || e)); } catch (x) {} }));
      this.server.keepAliveTimeout = 65000;
      this.server.on("error", e => { this.log(`⚠ The tablets can't connect: port ${this.port} is busy (${e.code})`); this.ready = false; this.status(); ok(false); });
      this.server.listen(this.port, "0.0.0.0", () => { this.ready = true; this.log(`🖥 Tablets connect to this computer: ${this.urls()[0] || "(no network yet)"}`); this.status(); ok(true); });
      setInterval(() => { for (const c of this.clients) { try { c.write(": ping\n\n"); } catch (e) {} } }, 20000);
      setInterval(() => this.store.compact(), 30 * 60000);
      this.online.kick(1000);
    });
  }
  async stop() {
    this.store.compact();
    try { if (this.online.creds) await this.online.push(); } catch (e) {}
    await this.online.goodbye();
    for (const c of this.clients) { try { c.end(); } catch (e) {} }
    try { this.server.close(); if (this.server.closeAllConnections) this.server.closeAllConnections(); } catch (e) {}
  }

  broadcast(ev) {
    const msg = `data: ${JSON.stringify(ev)}\n\n`;
    for (const c of this.clients) { try { c.write(msg); } catch (e) {} }
  }

  /** what the tablets (and the printers on this computer) ask for */
  op(q) {
    const S = this.store;
    switch (q.op) {
      case "list": return S.list(q.coll, q.where);
      case "get": return S.get(q.coll, q.id);
      case "set": return { t: S.put(q.coll, q.id, q.data || {}) };
      case "merge": return { t: S.merge(q.coll, q.id, q.patch || {}) };
      case "del": S.remove(q.coll, q.id); return {};
      case "claim": return { ok: S.claim(q.coll, q.id, q.data) };
      case "since": return S.since(q.coll, q.since);
      case "newest": return { t: S.newest() };
      case "pullnow": return this.online.cycle().then(() => ({ ok: this.online.ok }));
      default: throw new Error("unknown op " + q.op);
    }
  }
  /** for the printers on this computer: same filters as the online query */
  printList(coll, filters, { unprinted = false, since = 0 } = {}) {
    const m = this.store.colls.get(coll); if (!m) return [];
    const out = [];
    for (const [i, r] of m) {
      const d = r.data || {};
      if (!filters.every(([k, v]) => d[k] !== undefined && d[k] !== null && String(d[k]) === String(v))) continue;
      if (unprinted && !(d.printed == null || String(d.printed) === "0")) continue;
      if (since > 0 && !(typeof d.createdAt === "number" && d.createdAt >= since)) continue;
      out.push([i, clone(d)]);
    }
    return out;
  }

  async handle(req, res) {
    const u = new URL(req.url, "http://hub");
    const p = u.pathname;
    const json = (code, o) => { const b = Buffer.from(JSON.stringify(o === undefined ? null : o)); res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": b.length }); res.end(b); };
    const body = () => new Promise((ok, bad) => { const parts = []; let n = 0;
      req.on("data", d => { n += d.length; if (n > 8 << 20) { bad(new Error("too big")); req.destroy(); } else parts.push(d); });
      req.on("end", () => { try { ok(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch (e) { bad(e); } }); req.on("error", bad); });
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || u.searchParams.get("t") || "";

    if (p === "/hub/ping") return json(200, { ok: true, ready: this.ready && !!this.store.meta.imported, name: os.hostname(), linked: this.authed(tok) });

    if (p === "/hub/pair" && req.method === "POST") {
      const b = await body();
      this.fails = this.fails.filter(t => Date.now() - t < 60000);
      if (this.fails.length >= 6) return json(429, { error: "Too many tries. Wait a minute." });
      const email = String(b.email || "").trim().toLowerCase(), pass = String(b.password || "");
      const c = this.online.creds;
      let ok = !!(c && c.email.toLowerCase() === email && c.pass === pass);
      if (!ok && email && pass) { try { ok = await this.online.checkLogin(email, pass); } catch (e) { ok = false; } }
      if (!ok) { this.fails.push(Date.now()); return json(401, { error: c ? "Wrong email or password" : "Sign this computer in first (Printers & backups screen)" }); }
      const t = crypto.randomBytes(24).toString("hex");
      this.devs[t] = { at: Date.now(), name: String(b.name || "").slice(0, 60), ip: req.socket.remoteAddress };
      this.saveDevs(); this.log(`📱 A tablet was linked (${req.socket.remoteAddress.replace(/^::ffff:/, "")})`); this.status();
      return json(200, { token: t });
    }

    if (p === "/hub/api" && req.method === "POST") {
      if (!this.authed(tok)) return json(401, { error: "not linked" });
      const q = await body();
      try { return json(200, await this.op(q)); } catch (e) { return json(400, { error: e.message }); }
    }

    if (p === "/hub/events") {
      if (!this.authed(tok)) return json(401, { error: "not linked" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 2000\n\nevent: hello\ndata: {}\n\n");
      this.clients.add(res); this.status();
      req.on("close", () => { this.clients.delete(res); this.status(); });
      return;
    }

    if (p === "/hub/lib/supabase.js") return this.serveLib(res);

    if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "no" });
    return this.serveSite(req, res, p);
  }

  // ---- the restaurant app itself, from the website, kept on this computer so it opens even without internet ----
  async serveLib(res) {
    const f = path.join(this.dir, "site", "supabase.min.js");
    const send = b => { res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "max-age=3600" }); res.end(b); };
    let age = Infinity; try { age = Date.now() - fs.statSync(f).mtimeMs; } catch (e) {}
    if (process.env.T57_SUPA_LIB_FILE) return send(fs.readFileSync(process.env.T57_SUPA_LIB_FILE));
    if (age > 86400000) {
      try { const r = await request(LIB_URL, { follow: true, timeout: 8000, binary: true });
        if (r.status === 200 && r.buf.length > 10000) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, r.buf); return send(r.buf); } } catch (e) {}
    }
    if (age < Infinity) return send(fs.readFileSync(f));
    const bundled = [path.join(process.resourcesPath || "", "supabase.min.js"), path.join(__dirname, "..", "assets", "supabase.min.js")].find(x => { try { return fs.existsSync(x); } catch (e) { return false; } });
    if (bundled) return send(fs.readFileSync(bundled));
    res.writeHead(302, { Location: LIB_URL }); res.end();
  }

  async serveSite(req, res, p) {
    let rel = decodeURIComponent(p).replace(/^\/+/, "");
    if (!rel || rel.endsWith("/")) rel += "index.html";
    if (!/^[\w\-./]+$/.test(rel) || rel.split("/").includes("..")) { res.writeHead(404); return res.end(); }
    const type = { html: "text/html; charset=utf-8", js: "application/javascript", json: "application/json", webmanifest: "application/manifest+json",
      png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", ico: "image/x-icon", css: "text/css", mp3: "audio/mpeg", mp4: "video/mp4" }[rel.split(".").pop()] || "application/octet-stream";
    const cache = path.join(this.dir, "site", rel);
    const fresh = rel === "index.html" || rel === "version.json";     // always try for the newest app first
    let buf = null;
    if (fresh || !fs.existsSync(cache)) {
      try {
        const r = await request(this.site + rel + (fresh ? "?t=" + Date.now() : ""), { follow: true, timeout: fresh ? 5000 : 15000, binary: true });
        if (r.status === 200) { buf = r.buf; fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, buf); }
        else if (r.status === 404 && !fresh) { res.writeHead(404); return res.end(); }
      } catch (e) {}
    }
    if (!buf) { try { buf = fs.readFileSync(cache); } catch (e) {} }
    if (!buf) {   // first ever start without internet: the copy that came with the installer
      const b = [path.join(process.resourcesPath || "", "site", rel), path.join(__dirname, "..", "..", "docs", rel)].find(x => { try { return fs.existsSync(x); } catch (e) { return false; } });
      if (b) buf = fs.readFileSync(b);
    }
    if (!buf) { res.writeHead(404); return res.end(); }
    if (rel === "index.html") {
      const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || "");
      const inj = `<script>window.T57_HUB=${JSON.stringify({ v: 1, name: os.hostname(), token: local ? this.localToken : undefined })};</script>`;
      buf = Buffer.from(buf.toString("utf8").replace(/<head>/i, m => m + inj));
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": fresh ? "no-store" : "max-age=600", "Content-Length": buf.length });
    res.end(req.method === "HEAD" ? undefined : buf);
  }
}

module.exports = { Hub, Store, PORT, okWhere, tms };
