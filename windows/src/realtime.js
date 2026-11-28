// Live line to the online database (Supabase Realtime), so the till computer hears about anything saved
// online (customers' QR orders, devices still working online) the moment it happens, instead of waiting
// for the next check. It only says "something changed": the hub then fetches the change itself, so
// nothing can be missed even if the line drops (the regular check carries on underneath as a safety net).
//
// A small WebSocket client on Node's own https module (the app's main process has no WebSocket built in).
"use strict";
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");

const HEARTBEAT_MS = 25000;

class Realtime {
  /**
   * @param {object} o
   * @param {string} o.base     the database address (https://….supabase.co)
   * @param {string} o.key      the public key
   * @param {() => Promise<string>} o.token  gives a signed-in access token
   * @param {(ch: {del, coll, id, data, updated_at}|null) => void} o.onChange  called for every change saved online (null: go and look)
   * @param {(up: boolean) => void} [o.onState]
   */
  constructor({ base, key, token, onChange, onState }) {
    this.base = base; this.key = key; this.token = token; this.onChange = onChange; this.onState = onState || (() => {});
    this.sock = null; this.up = false; this.want = false; this.ref = 0; this.retry = 1000; this.buf = Buffer.alloc(0);
    this.frag = null; this.beatT = null; this.againT = null; this.lastTok = "";
  }
  start() { if (this.want) return; this.want = true; this.connect(); }
  stop() {
    this.want = false; clearTimeout(this.againT); clearInterval(this.beatT);
    if (this.sock) { try { this.frame(0x8, Buffer.alloc(0)); this.sock.end(); this.sock.destroy(); } catch (e) {} }
    this.sock = null; this.setUp(false);
  }
  setUp(v) { if (this.up !== v) { this.up = v; this.onState(v); } }

  async connect() {
    if (!this.want || this.sock) return;
    let tok;
    try { tok = await this.token(); } catch (e) { return this.later(); }
    if (!this.want) return;
    const u = new URL(this.base.replace(/^http/, "ws") + "/realtime/v1/websocket");
    u.searchParams.set("apikey", this.key); u.searchParams.set("vsn", "1.0.0");
    const lib = u.protocol === "ws:" ? http : https;
    const wsKey = crypto.randomBytes(16).toString("base64");
    const req = lib.request({ host: u.hostname, port: u.port || (lib === http ? 80 : 443), path: u.pathname + u.search, timeout: 15000,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": wsKey } });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", () => this.later());
    req.on("response", res => { res.resume(); this.later(); });
    req.on("upgrade", (res, sock, head) => {
      const accept = crypto.createHash("sha1").update(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      if (res.headers["sec-websocket-accept"] !== accept) { sock.destroy(); return this.later(); }
      this.sock = sock; this.buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0); this.frag = null;
      sock.setNoDelay(true); sock.setKeepAlive(true, 30000);
      sock.on("data", d => { this.buf = Buffer.concat([this.buf, d]); this.read(); });
      sock.on("close", () => this.dropped(sock));
      sock.on("error", () => this.dropped(sock));
      this.lastTok = tok;
      this.send({ topic: "realtime:t57-hub", event: "phx_join", payload: {
        config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [{ event: "*", schema: "public", table: "t57_docs" }] },
        access_token: tok } });
      clearInterval(this.beatT);
      this.beatT = setInterval(() => this.beat(), HEARTBEAT_MS);
      if (this.buf.length) this.read();
    });
    req.end();
  }
  dropped(sock) {
    if (this.sock !== sock) return;
    this.sock = null; clearInterval(this.beatT); this.setUp(false); this.later();
  }
  later() {
    if (!this.want) return;
    clearTimeout(this.againT);
    this.againT = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 30000);
  }
  async beat() {
    this.send({ topic: "phoenix", event: "heartbeat", payload: {} });
    // the sign-in renews itself every hour: pass the new one on so the line isn't cut
    try { const t = await this.token(); if (t && t !== this.lastTok) { this.lastTok = t; this.send({ topic: "realtime:t57-hub", event: "access_token", payload: { access_token: t } }); } } catch (e) {}
  }
  send(o) { if (!this.sock) return; o.ref = String(++this.ref); if (o.event === "phx_join") o.join_ref = o.ref; try { this.frame(0x1, Buffer.from(JSON.stringify(o))); } catch (e) {} }

  /** one WebSocket frame from this side (always masked) */
  frame(op, data) {
    const n = data.length, mask = crypto.randomBytes(4);
    const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 0x80 | 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
    const body = Buffer.alloc(n); for (let i = 0; i < n; i++) body[i] = data[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([head, mask, body]));
  }
  read() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let n = b[1] & 0x7f, off = 2;
      if (n === 126) { if (b.length < 4) return; n = b.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (b.length < 10) return; n = Number(b.readBigUInt64BE(2)); off = 10; }
      const mk = masked ? b.slice(off, off + 4) : null; if (masked) off += 4;
      if (b.length < off + n) return;
      let data = b.slice(off, off + n); this.buf = b.slice(off + n);
      if (mk) { data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= mk[i & 3]; }
      if (op === 0x8) { try { this.sock.end(); this.sock.destroy(); } catch (e) {} return; }
      if (op === 0x9) { try { this.frame(0xA, data); } catch (e) {} continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2) this.frag = [data]; else if (op === 0x0 && this.frag) this.frag.push(data); else continue;
      if (!fin) continue;
      const msg = Buffer.concat(this.frag).toString("utf8"); this.frag = null;
      this.message(msg);
    }
  }
  message(text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (m.event === "phx_reply" && m.topic === "realtime:t57-hub" && m.payload) {
      if (m.payload.status === "ok") { if (!this.up) { this.retry = 1000; this.setUp(true); this.onChange(null); } }   // catch up on anything from while the line was down
      else { try { this.sock.destroy(); } catch (e) {} }
      return;
    }
    if (m.event === "postgres_changes") {
      const d = (m.payload && m.payload.data) || {};
      // a full change (the saved item itself, or which item was deleted); null = "something changed, go and look"
      const del = d.type === "DELETE", rec = del ? d.old_record : d.record;
      const ok = rec && rec.coll && rec.id != null && !(d.errors && d.errors.length) && (del || (rec.data && typeof rec.data === "object"));
      this.onChange(ok ? { del, coll: rec.coll, id: String(rec.id), data: del ? null : rec.data, updated_at: rec.updated_at || "" } : null);
      return;
    }
    if (m.event === "phx_error" || m.event === "phx_close" || m.event === "system" && m.payload && m.payload.status === "error") {
      try { this.sock.destroy(); } catch (e) {}
    }
  }
}

module.exports = { Realtime };
