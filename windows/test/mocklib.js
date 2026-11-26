// Test stand-in for the supabase-js library: the same calls the restaurant app makes, sent to test/mock.js.
(function () {
  const BASE = window.__MOCK_BASE || (location.protocol + "//" + location.hostname + ":54341");
  const KEY = "t57-auth";
  const sess = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const hdr = extra => Object.assign({ "Content-Type": "application/json", apikey: "k", Authorization: "Bearer " + ((sess() || {}).access_token || "anon") }, extra || {});
  async function go(method, path, body, extra) {
    try {
      const r = await fetch(BASE + path, { method, headers: hdr(extra), body: body === undefined ? undefined : JSON.stringify(body) });
      const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
      if (!r.ok) return { data: null, error: Object.assign({ message: (j && j.message) || ("HTTP " + r.status) }, j || {}) };
      return { data: j, error: null };
    } catch (e) { return { data: null, error: { message: "TypeError: Failed to fetch" } }; }
  }
  function q(table) {
    const f = []; let mode = "select", payload = null, cols = "id,data", order = "", single = false, lim = 0;
    const b = {
      select(c) { if (c) cols = c; return b; }, eq(c, v) { f.push(`${encodeURIComponent(c)}=eq.${encodeURIComponent(v)}`); return b; },
      gt(c, v) { f.push(`${encodeURIComponent(c)}=gt.${encodeURIComponent(v)}`); return b; },
      filter(c, op, v) { f.push(`${encodeURIComponent(c)}=${op}.${encodeURIComponent(v)}`); return b; },
      order(c, o) { order = c + "." + (o && o.ascending === false ? "desc" : "asc"); return b; }, limit(n) { lim = n; return b; },
      maybeSingle() { single = true; return b; }, upsert(r) { mode = "upsert"; payload = r; return b; }, insert(r) { mode = "insert"; payload = r; return b; }, delete() { mode = "delete"; return b; },
      then(res, rej) {
        let p;
        if (mode === "upsert") p = go("POST", `/rest/v1/${table}`, payload, { Prefer: "resolution=merge-duplicates" });
        else if (mode === "insert") p = go("POST", `/rest/v1/${table}`, payload);
        else if (mode === "delete") p = go("DELETE", `/rest/v1/${table}?${f.join("&")}`);
        else p = go("GET", `/rest/v1/${table}?select=${cols}&${f.join("&")}${order ? "&order=" + order : ""}${lim ? "&limit=" + lim : ""}`)
          .then(r => single && !r.error ? { data: (r.data || [])[0] || null, error: null } : r);
        return p.then(r => (mode === "select" ? r : { data: null, error: r.error })).then(res, rej);
      },
    };
    return b;
  }
  window.supabase = { createClient() { return {
    from: t => q(t),
    rpc(name, a) { if (name !== "t57_merge") return Promise.resolve({ data: name === "t57_locked" ? true : null, error: null }); return go("POST", "/rest/v1/rpc/t57_merge", a); },
    channel() { const ch = { on() { return ch; }, subscribe(cb) { setTimeout(() => cb && cb("CHANNEL_ERROR"), 10); return ch; } }; return ch; },
    removeChannel() {},
    realtime: { setAuth() {} },
    auth: {
      async getSession() { return { data: { session: sess() } }; },
      async signInWithPassword({ email, password }) {
        const r = await fetch(BASE + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).catch(() => null);
        if (!r || !r.ok) return { data: null, error: { message: "Invalid login credentials" } };
        const j = await r.json(); const s = { access_token: j.access_token, user: { email } }; localStorage.setItem(KEY, JSON.stringify(s));
        return { data: { session: s, user: s.user }, error: null };
      },
      async signOut() { localStorage.removeItem(KEY); }, onAuthStateChange() {},
    },
  }; } };
})();
