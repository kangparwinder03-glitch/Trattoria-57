// The print station: checks the database every 3 seconds and prints kitchen / bar tickets and
// bills / receipts / reports, exactly like PrintService in the Android printer app.
"use strict";
const os = require("os");
const { Cloud, store } = require("./cloud");
const fmt = require("./format");
const pics = require("./pictures");
const out = require("./send");

const ALL = ["kitchen", "bar", "till"];
const NAME = { kitchen: "KITCHEN", bar: "BAR", till: "TILL" };
const stationNames = sts => sts.length ? sts.map(s => NAME[s]).join(" + ") : "nothing";

// ---- settings (kept on this computer) ----
const DEF = () => ({ stations: [], st: {}, logo: true, running: false, since: 0 });
function load() { try { return Object.assign(DEF(), JSON.parse(store.get("cfg") || "{}")); } catch (e) { return DEF(); } }
let cfg = load();
const save = () => store.set("cfg", JSON.stringify(cfg));
function st(s) {
  cfg.st[s] = Object.assign({ target: "", cols: 48, copies: s === "kitchen" ? 2 : 1, cutter: true, big: s === "kitchen", buzz: false, speak: false }, cfg.st[s] || {});
  return cfg.st[s];
}
const on = () => ALL.filter(s => cfg.stations.includes(s));
function setOn(s, yes) { cfg.stations = ALL.filter(x => x === s ? yes : cfg.stations.includes(x)); save(); }

// ---- done list (so nothing prints twice, even if marking it printed online fails) ----
let done = []; try { done = JSON.parse(store.get("done") || "[]"); } catch (e) {}
let copiesDone = {}; try { copiesDone = JSON.parse(store.get("copiesdone") || "{}"); } catch (e) {}
const saveDone = () => { if (done.length > 600) done = done.slice(-400); store.set("done", JSON.stringify(done)); store.set("copiesdone", JSON.stringify(copiesDone)); };

// ---- what the screen shows ----
const Hub = {
  status: "", statusOk: true, net: "", netOk: true, logs: [], lastSlip: null, lastSlipSt: "kitchen", ui: () => {},
  say(t, ok) { this.status = t; this.statusOk = ok; this.ui(); },
  setNet(t, ok) { this.net = t; this.netOk = ok; this.ui(); },
  log(t) { const d = new Date(); this.logs.unshift(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}  ${t}`); this.logs.length = Math.min(this.logs.length, 30); this.ui(); },
};

// ---- printer state (green / red light on the website) ----
const states = {};
const state = s => (states[s] = states[s] || { lastOk: true, lastMsg: "Ready", down: false, lastContact: 0 });
const kindOf = t => t.startsWith("ip:") ? "network" : t.startsWith("com:") ? "Bluetooth" : "USB";

let busy = Promise.resolve();   // one print at a time
function serial(fn) { const p = busy.then(fn, fn); busy = p.catch(() => {}); return p; }

function probe(s) {
  return serial(async () => {
    const S = state(s), t = st(s).target;
    if (!t) return false;
    S.lastContact = Date.now();
    try {
      await out.probe(t);
      if (S.down || !S.lastOk) { S.lastOk = true; S.lastMsg = "Printer on and connected"; }
      S.down = false; return true;
    } catch (e) {
      S.lastOk = false; S.down = true;
      S.lastMsg = kindOf(t) === "network" ? "Printer off or not on the network" : kindOf(t) === "Bluetooth" ? "Printer off, flat or out of range" : "Printer off or unplugged";
      return false;
    }
  });
}

function print(s, bytes, what) {
  return serial(async () => {
    const S = state(s), t = st(s).target;
    if (!t) { Hub.say(`Pick a printer for the ${NAME[s]} first.`, false); return false; }
    try {
      await out.send(t, bytes);
      Hub.lastSlip = bytes; Hub.lastSlipSt = s;
      Hub.log("✓ " + what); S.lastOk = true; S.down = false; S.lastContact = Date.now(); S.lastMsg = "Printed " + what;
      for (const o of ALL) if (o !== s && st(o).target === t) Object.assign(state(o), { lastOk: true, down: false, lastContact: S.lastContact });
      return true;
    } catch (e) {
      const k = kindOf(t);
      Hub.say(k === "network" ? `⚠ ${NAME[s]} printer not responding (${t.slice(3)}). Is it on, plugged in and in paper? Will retry.`
                              : `⚠ ${NAME[s]} printer not responding (${e.message}). Is it on and in paper? Will retry.`, false);
      Object.assign(S, { lastOk: false, down: true, lastContact: Date.now(),
        lastMsg: k === "network" ? "Printer not responding: off, unplugged or out of paper?" : "Printer not responding — off, flat or out of paper?" });
      return false;
    }
  });
}

// ---- announcements ----
let alexaCfg = null, alexaAt = 0;
async function alexa(label, s, training, fresh = false) {
  try {
    if (fresh || !alexaCfg || Date.now() - alexaAt > 30000) { alexaCfg = ((await Cloud.list("alexa")).find(x => x[0] === "main") || [])[1] || null; alexaAt = Date.now(); }
  } catch (e) { return `🔇 Alexa: couldn't read the settings (${e.message}) — is this computer signed in?`; }
  const c = alexaCfg;
  if (!c) return "🔇 Alexa: no settings saved yet — on the website go to ⭐ Manager → Kitchen Alexa and tap SAVE";
  if (c.from === "web" && !fresh) return "🔊 Alexa is announced by the tablet that sends the order";
  if (!c.on) return "🔇 Alexa is switched off (⭐ Manager → Kitchen Alexa → Switch on → Save)";
  if (!(c[s] === undefined ? s === "kitchen" : c[s])) return `🔇 Alexa isn't set to announce ${NAME[s]} orders`;
  if (!c.token || !c.device) return "🔇 Alexa: token or speaker ID missing in the settings";
  const who = String(label).replace(/#/g, "").trim();
  const speech = (training ? "Training. " : "") + ((c.speech || "").trim() || "New order, {table}").replace(/\{table\}/g, who);
  const e = encodeURIComponent;
  let q = `https://api-v3.voicemonkey.io/announce?token=${e(c.token)}&device=${e(c.device)}&speech=${e(speech)}`;
  q += `&chime=${e(c.chime || "soundbank://soundlibrary/home/amzn_sfx_doorbell_chime_01")}`;
  if ((c.show || "").trim()) q += `&text_display=${e(c.show.replace(/\{table\}/g, who))}&display_seconds=20`;
  try { const r = await Cloud.request(q, { timeout: 10000 }); return r.status >= 200 && r.status < 300 ? "🔊 Alexa: " + speech : `🔇 Alexa: Voice Monkey said ${r.status} ${r.text.slice(0, 80)}`; }
  catch (x) { return `🔇 Alexa unreachable (${x.message})`; }
}
function speakWords(label, training) {
  const l = String(label).replace(/\+/g, " and ").replace(/#/g, "number ").trim();
  const what = /^(pickup|takeaway|bar walk)/i.test(l) ? "New " + l : "New order, " + l;
  return (training ? "Training. " : "") + what;
}
function speak(text) {
  try {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 880; g.gain.value = 0.3; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.45);
    setTimeout(() => ac.close(), 1500);
  } catch (e) {}
  setTimeout(() => {
    try {
      const u = new SpeechSynthesisUtterance(text); u.rate = 0.95;
      const v = speechSynthesis.getVoices().find(v => v.lang === "en-GB"); if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  }, 600);
}

// ---- the loop ----
let running = false, timer = null, lastBeat = 0;
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function dayStart() { const d = new Date(Date.now() - 5 * 3600000); d.setHours(5, 0, 0, 0); return d.getTime(); }

async function markDone(coll, id, s) {
  done.push(id); saveDone();
  try { await Cloud.merge(coll, id, { printed: Date.now(), printedBy: s }); } catch (e) {}
}

async function pollStation(s, ready) {
  const c = st(s), cols = c.cols;
  const today = ymd(Date.now() - 5 * 3600000);
  if (s !== "till") {
    let tickets = [];
    for (const coll of ["tickets", "train_tickets"]) for (const [id, d] of await Cloud.list(coll, [["date", today], ["station", s]])) tickets.push([coll, id, d]);
    tickets = tickets.filter(([, id, d]) => !done.includes(id) && !d.hold && !d.wait && !d.rejected && !(d.printed > 0) && (d.createdAt || 0) >= cfg.since)
      .sort((a, b) => (a[2].createdAt || 0) - (b[2].createdAt || 0));
    for (const [coll, id, d] of tickets) {
      if (!running || !on().includes(s)) return;
      const training = coll === "train_tickets";
      const label = d.pickup ? `Takeaway #${parseInt(d.pno, 10) || 0}` : String(d.label || "");
      const copies = Math.min(3, Math.max(1, c.copies));
      const lg = await pics.logos(cols, cfg.logo);
      for (let k = (copiesDone[id] || 0) + 1; k <= copies; k++) {
        const bytes = fmt.ticket(d, cols, lg, { copy: k, copies, training, big: c.big, buzz: k === 1 && c.buzz, cutter: c.cutter });
        if (!await print(s, bytes, (training ? "TRAINING " : "") + `${label} · order #${parseInt(d.no, 10) || 0}` + (copies > 1 ? ` (copy ${k} of ${copies})` : ""))) return;
        copiesDone[id] = k; saveDone();
      }
      delete copiesDone[id];
      Hub.say(ready, true);
      await markDone(coll, id, s);
      alexa(label, s, training).then(r => Hub.log(r));
      if (c.speak) speak(speakWords(label, training));
    }
  }
  const jobs = (await Cloud.list("printjobs", [["to", s]]))
    .filter(([id, d]) => !done.includes(id) && !(d.printed > 0) && (d.createdAt || 0) >= dayStart())
    .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
  for (const [id, d] of jobs) {
    if (!running || !on().includes(s)) return;
    const bytes = d.kind === "labels" ? fmt.labels(d, cols, c.cutter) : fmt.job(d, cols, await pics.logos(cols, cfg.logo), c.cutter);
    if (!await print(s, bytes, d.title || "Print")) return;
    Hub.say(ready, true);
    await markDone("printjobs", id, s);
  }
}

async function tick() {
  if (!running) return;
  const sts = on();
  const ready = `🟢 Printing ${stationNames(sts)} automatically`;
  try {
    if (!Hub.status.startsWith("⚠")) Hub.say(ready, true);
    for (const s of sts) { if (!running) break; await pollStation(s, ready); }
    const d = new Date();
    Hub.setNet(`Connected · checked ${[d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":")}`, true);
  } catch (e) { Hub.setNet(`⚠ Can't reach orders (${e.message || "no internet"}) — retrying`, false); }
  for (const s of sts) {
    const b = state(s);
    if (Date.now() - b.lastContact > 60000) {
      const was = b.down; await probe(s);
      if (b.down !== was) { lastBeat = 0; Hub.say(b.down ? `⚠ Can't reach the ${NAME[s]} printer — is it switched on?` : `🖨 ${NAME[s]} printer back on`, !b.down); }
    }
  }
  if (Date.now() - lastBeat > 15000) {
    for (const s of sts) {
      const b = state(s);
      try { await Cloud.merge("printers", s, { at: Date.now(), ok: b.lastOk, msg: b.lastMsg, off: false, down: b.down,
        paper: st(s).cols >= 48 ? "80mm" : "58mm", dev: "Windows " + os.hostname(), copies: s === "till" ? 1 : st(s).copies }); } catch (e) {}
    }
    lastBeat = Date.now();
  }
  if (running) timer = setTimeout(tick, 3000);
}

function start() {
  const sts = on();
  if (!sts.length) { Hub.say("Tick \"This computer prints…\" for at least one station first.", false); return false; }
  const missing = sts.find(s => !st(s).target);
  if (missing) { Hub.say(`Pick a printer for the ${NAME[missing]} first.`, false); return false; }
  if (!cfg.since) cfg.since = Date.now();
  cfg.running = true; save();
  if (!running) { running = true; lastBeat = 0; tick(); }
  Hub.say(`🟢 Printing ${stationNames(sts)} automatically`, true);
  return true;
}
async function stop(why = "Printing switched off") {
  cfg.running = false; save();
  running = false; clearTimeout(timer);
  for (const s of on()) { try { await Cloud.merge("printers", s, { at: Date.now(), ok: false, msg: why, off: true }); } catch (e) {} }
  Hub.say("Stopped — nothing will print until you tap Start.", false); Hub.setNet("", true);
}
/** Lets the website know a station is no longer printed here (its light goes grey). */
async function switchedOff(s) { try { await Cloud.merge("printers", s, { at: Date.now(), ok: false, msg: "Printing switched off", off: true }); } catch (e) {} }

module.exports = {
  ALL, NAME, stationNames, Hub, state, st, on, setOn, probe, print, start, stop, switchedOff, alexa, speak, speakWords,
  get cfg() { return cfg; }, save, get running() { return running; },
  skipWaiting() { cfg.since = Date.now(); save(); },
};
