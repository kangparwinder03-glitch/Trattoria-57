// Backups on this computer: a full copy of the restaurant database every night (and when you tap
// "Back up now"), saved in Documents\Trattoria 57 Backups. Copies are kept for 90 days.
// This is as well as the nightly backup GitHub already makes.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { Cloud, store } = require("./cloud");

const KEEP_DAYS = 90;
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
  const dir = folder(), cut = Date.now() - KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(dir)) {
    if (!/^t57-backup-.*\.json\.gz$/.test(f)) continue;
    const p = path.join(dir, f);
    try { if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p); } catch (e) {}
  }
}

function last() { try { return JSON.parse(store.get("backup_last") || "null"); } catch (e) { return null; } }
function list() {
  try { return fs.readdirSync(folder()).filter(f => /^t57-backup-.*\.json\.gz$/.test(f)).sort().reverse(); } catch (e) { return []; }
}

/** Nightly: once a day after 4am (after service), or straight away if the last copy is over a day old. */
function due() {
  const l = last();
  if (!l) return true;
  const age = Date.now() - l.at;
  if (age > 26 * 3600000) return true;
  const d = new Date(); const fourAm = new Date(d); fourAm.setHours(4, 0, 0, 0);
  return d >= fourAm && l.at < fourAm.getTime();
}

module.exports = { run, last, list, due, folder, KEEP_DAYS };
