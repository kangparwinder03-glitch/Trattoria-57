// Talks to the Trattoria 57 database (Supabase), the same one the website and the tablets use.
// Same calls as Cloud in the Android printer app (Station.kt).
"use strict";
const https = require("https");
const http = require("http");
const { URL } = require("url");

const BASE = process.env.T57_SUPA_BASE || "https://uzrkewizkqdnqpovwune.supabase.co";
const KEY = "sb_publishable_Hix2EgA_xpjxMYFvmarVIQ_Hj0qx3YM";

/** Small HTTP helper: returns { status, text, headers }. Follows redirects when asked. */
function request(url, { method = "GET", headers = {}, body = null, timeout = 15000, follow = false, binary = false } = {}) {
  return new Promise((ok, bad) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(u, { method, headers, timeout }, res => {
      if (follow && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return ok(request(new URL(res.headers.location, u).toString(), { method, headers, body, timeout, follow, binary }));
      }
      const parts = [];
      res.on("data", d => parts.push(d));
      res.on("end", () => { const buf = Buffer.concat(parts); ok({ status: res.statusCode, text: binary ? "" : buf.toString("utf8"), buf, headers: res.headers }); });
      res.on("error", bad);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", e => bad(new Error(e.code === "ENOTFOUND" || e.code === "EAI_AGAIN" ? "no internet" : e.message)));
    if (body) req.write(body);
    req.end();
  });
}

const store = {
  get: k => { try { return localStorage.getItem("t57." + k) || ""; } catch (e) { return ""; } },
  set: (k, v) => { try { if (v === null || v === undefined || v === "") localStorage.removeItem("t57." + k); else localStorage.setItem("t57." + k, v); } catch (e) {} },
};

let token = null, tokenExp = 0;

async function authCall(grant, body) {
  const r = await request(`${BASE}/auth/v1/token?grant_type=${grant}`, {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status < 200 || r.status > 299) return false;
  const j = JSON.parse(r.text);
  token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  if (j.refresh_token) store.set("auth_refresh", j.refresh_token);
  return true;
}

const Cloud = {
  BASE, KEY, request,
  get signedInAs() { return store.get("auth_email"); },

  async signIn(email, password) {
    let ok = false;
    try { ok = await authCall("password", { email, password }); } catch (e) { ok = false; }
    if (ok) { store.set("auth_email", email); store.set("auth_pass", password); }
    return ok;
  },
  signOut() { token = null; tokenExp = 0; store.set("auth_email", ""); store.set("auth_pass", ""); store.set("auth_refresh", ""); },

  async bearer() {
    if (token && Date.now() < tokenExp - 120000) return token;
    const rt = store.get("auth_refresh");
    if (rt) { try { if (await authCall("refresh_token", { refresh_token: rt })) return token; } catch (e) {} }
    const e = store.get("auth_email"), pw = store.get("auth_pass");
    if (e && pw) { try { if (await authCall("password", { email: e, password: pw })) return token; } catch (x) {} }
    return KEY;
  },

  async call(path, method = "GET", body = null) {
    const r = await request(BASE + path, { method, body: body ? JSON.stringify(body) : null, headers: {
      apikey: KEY, Authorization: "Bearer " + await this.bearer(), "Content-Type": "application/json", Accept: "application/json" } });
    if (r.status < 200 || r.status > 299) throw new Error(`HTTP ${r.status} ${r.text.slice(0, 100)}`);
    return r.text ? JSON.parse(r.text) : null;
  },

  /** Saved items in a collection, filtered on text fields: [[id, data], …] */
  async list(coll, filters = []) {
    let q = `/rest/v1/t57_docs?select=id,data&coll=eq.${encodeURIComponent(coll)}`;
    for (const [k, v] of filters) q += `&${encodeURIComponent("data->>" + k)}=eq.${encodeURIComponent(v)}`;
    const arr = await this.call(q);
    return (arr || []).map(o => [o.id, o.data || {}]);
  },

  /** Adds fields to a saved item (used to mark an order as printed). */
  async merge(coll, id, patch) { await this.call("/rest/v1/rpc/t57_merge", "POST", { c: coll, i: id, patch }); },

  /** Every record in the database, for the backup. */
  async everything() {
    const rows = [], step = 1000;
    for (;;) {
      const part = await this.call(`/rest/v1/t57_docs?select=coll,id,data,updated_at&order=coll.asc,id.asc&offset=${rows.length}&limit=${step}`);
      rows.push(...(part || []));
      if (!part || part.length < step) break;
    }
    return rows;
  },
};

module.exports = { Cloud, request, store };
