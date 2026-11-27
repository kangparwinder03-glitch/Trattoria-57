// Backups on this computer: a full copy of the restaurant database every 5 minutes (and when you tap
// "Back up now"), saved in Documents\Trattoria 57 Backups. Every 5-minute copy is kept for 2 days,
// then one copy a day is kept for 90 days.
// This is as well as the nightly backup GitHub already makes.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { Cloud, store } = require("./cloud");

const KEEP_DAYS = 90, KEEP_ALL_DAYS = 2, EVERY_MS = 5 * 60000;
function folder() {
  const docs = process.env.T57_BACKUP_DIR || path.join(process.env.USERPROFILE || os.homedir(), "Documents", "Trattoria 57 Backups");
  fs.mkdirSync(docs, { recursive: true });
  return docs;
}
const two = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}`;

let busy = false;
/** Makes a backup now. Returns { file, rows, counts }. */
async function run() {
  if (busy) throw new Error("a backup is already running");
  busy = true;
  try {
    if (!Cloud.local && !Cloud.signedInAs) throw new Error("sign in first");
    const rows = await Cloud.everything();
    if (!rows.length) throw new Error("the backup came back empty — check the sign-in");
    const counts = {};
    for (const r of rows) counts[r.coll] = (counts[r.coll] || 0) + 1;
    const now = new Date();
    const file = path.join(folder(), `t57-backup-${stamp(now)}.json.gz`);
    const tmp = file + ".part";
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify({ made: now.toISOString(), rows, counts })));
    fs.renameSync(tmp, file);
    store.set("backup_last", JSON.stringify({ at: now.getTime(), file, rows: rows.length }));
    prune();
    return { file, rows: rows.length, counts };
  } finally { busy = false; }
}

function prune() {
  const dir = folder(), now = Date.now(), cut = now - KEEP_DAYS * 86400000, all = now - KEEP_ALL_DAYS * 86400000;
  const seenDay = new Set();
  // oldest first, so the first copy of each day is the one kept
  for (const f of fs.readdirSync(dir).filter(f => /^t57-backup-.*\.json\.gz$/.test(f)).sort()) {
    const p = path.join(dir, f), day = f.slice(11, 21);
    try {
      const t = fs.statSync(p).mtimeMs;
      if (t < cut) fs.unlinkSync(p);
      else if (t < all) { if (seenDay.has(day)) fs.unlinkSync(p); else seenDay.add(day); }
    } catch (e) {}
  }
}

function last() { try { return JSON.parse(store.get("backup_last") || "null"); } catch (e) { return null; } }
function list() {
  try { return fs.readdirSync(folder()).filter(f => /^t57-backup-.*\.json\.gz$/.test(f)).sort().reverse(); } catch (e) { return []; }
}

/** Every 5 minutes. */
function due() {
  const l = last();
  return !l || Date.now() - l.at >= EVERY_MS - 15000;
}

module.exports = { run, last, list, due, folder, prune, KEEP_DAYS };
