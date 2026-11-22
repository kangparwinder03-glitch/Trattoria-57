// Turns orders and print jobs from the website into printer slips.
// A copy of Format / Labels in the Android printer app (Station.kt, Labels.kt), so tickets look identical.
"use strict";
const { EscPos } = require("./escpos");
const pics = require("./pictures");

const ALG = /allerg|gluten|coeliac|celiac|dairy|lactose|\bnuts?\b|peanut|shellfish|prawn|\begg|sesame|vegan|soya|\bfish\b|mustard|celery|anaphyl/i;
const money = v => "£" + (Math.round(v * 100) / 100).toFixed(2);
const two = n => String(n).padStart(2, "0");
const hhmm = ms => { const d = new Date(ms); return two(d.getHours()) + ":" + two(d.getMinutes()); };
const str = v => (v === undefined || v === null) ? "" : String(v);
const int = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };

function ticket(t, cols, lg, { copy = 1, copies = 1, training = false, big = false, buzz = false, cutter = true } = {}) {
  const p = new EscPos(cols, cutter);
  const bar = t.station === "bar";
  if (!bar) p.heavy();
  if (lg.small) p.image(lg.small).feed(1); else p.align(1).bold(true).line("TRATTORIA 57").bold(false);
  p.align(1).bold(true).line(bar ? "*** BAR ***" : "*** KITCHEN ***");
  if (training) p.line("** TRAINING - NOT REAL **");
  if (copies > 1) p.line(`Copy ${copy} of ${copies}`);
  if (t.pickup) {
    const pat = str(t.pat);
    if (!bar) { p.line("COLLECTION TIME"); p.size(4, 4).line(pat.trim() ? pat : "ASAP").size(1, 1); p.bar(8); }
    else if (pat.trim()) p.size(2, 2).line("FOR " + pat).size(1, 1);
    p.line("TAKEAWAY").size(2, 2).line("#" + int(t.pno)).size(1, 1);
    const who = [str(t.pname), str(t.pphone)].filter(s => s.trim()).join(" · ");
    if (who.trim()) p.wline(who);
  } else p.size(2, 2).line(str(t.label).toUpperCase()).size(1, 1);
  p.bold(false);
  const time = hhmm(t.createdAt || Date.now());
  if ((t.firedAt || 0) > 0) p.line("*** MAINS - FIRED ***");
  const covers = int(t.covers);
  p.line(`Order #${int(t.no)} · ${time}` + (covers > 0 ? ` · ${covers} covers` : ""));
  const by = str(t.byName);
  if (t.qr) p.line("Ordered by QR code"); else if (by.trim()) p.line("Waiter: " + by);
  p.align(0).rule();
  let alg = ALG.test(str(t.note));
  let total = 0;
  const items = Array.isArray(t.items) ? t.items : [];
  const course = i => str(items[i].c);
  const grouped = !bar && !t.pickup && items.some((_, i) => course(i).trim());
  const order = [];
  if (grouped) { for (const c of ["s", "m", "", "d"]) items.forEach((x, i) => { if (course(i) === c && !x.v) order.push(i); }); }
  else items.forEach((x, i) => { if (!x.v) order.push(i); });
  let lastC = null;
  const paper = cols >= 48 ? 576 : 384;
  for (const i of order) {
    const x = items[i];
    if (grouped) {
      const c = str(x.c).trim() ? str(x.c) : "m";
      if (c !== lastC) {
        if (lastC !== null) { p.feed(1); p.bar(12); p.feed(1); }
        p.align(1).bold(true).reverse(true).size(2, 2)
          .line(" " + (c === "s" ? "STARTERS" : c === "d" ? "DESSERTS" : "MAINS") + " ")
          .size(1, 1).reverse(false).bold(false).align(0);
        lastC = c;
      }
    }
    const q = x.q === undefined ? 1 : int(x.q); const amt = q * (Number(x.p) || 0); total += amt;
    const dish = bar ? str(x.n) : (str(x.en).trim() ? str(x.en) : str(x.n));
    const name = `${q} x ${dish}`, price = money(amt);
    const guest = str(x.g), note = str(x.note);
    const isAlg = note.trim() !== "" && ALG.test(note);
    if (isAlg) alg = true;
    if (!bar) {
      p.image(pics.textPic(`${q}x ${dish}`, paper, big ? 64 : 52, 40));
      if (guest.trim()) p.bold(true).size(1, 2).line("   for: " + guest).size(1, 1).bold(false);
      if (note.trim()) p.image(pics.textPic((isAlg ? "> !! " : "> ") + note, paper, big ? 52 : 42, 32));
      p.feed(1);
    } else if (big) {
      p.bold(true).size(2, 2).wline(name).size(1, 1).bold(false);
      p.lr(guest.trim() ? "   for: " + guest : "", price);
      if (note.trim()) p.bold(true).size(1, 2).wline((isAlg ? " > !! " : " > ") + note, "   ").size(1, 1).bold(false);
      p.feed(1);
    } else {
      p.bold(true).size(1, 2);
      if (name.length + price.length + 1 > cols) p.wline(name).lr("", price); else p.lr(name, price);
      p.size(1, 1).bold(false);
      if (guest.trim()) p.line("   for: " + guest);
      if (note.trim()) { if (isAlg) p.bold(true).wline("   > !! " + note, "     ").bold(false); else p.wline("   > " + note, "     "); }
    }
  }
  p.rule();
  if (bar) { p.bold(true).lr("TOTAL", money(total)).bold(false); p.rule(); }
  const tn = str(t.note);
  if (tn.trim()) { p.bold(true); if (big) p.size(1, 2); p.wline("NOTE: " + tn).size(1, 1).bold(false); p.rule(); }
  if (alg) p.align(1).bold(true).size(1, 2).line("!! ALLERGY - CHECK NOTES !!").size(1, 1).bold(false).align(0);
  p.feed(4); p.cut();
  if (buzz) p.buzz();
  return p.bytes();
}

function header(p, lg) {
  if (lg.full) p.image(lg.full);
  else p.align(1).bold(true).line("T R A T T O R I A").size(2, 2).line("57").size(1, 1).line("ITALIAN KITCHEN & BAR").bold(false);
  p.align(1).line("55/57 Gisburn Road, Barnoldswick").line("BB18 5HB  ·  01282 816554").align(0).rule("=");
}

/** Bills and reports: the website sends ready-made lines. */
function job(j, cols, lg, cutter = true) {
  const p = new EscPos(cols, cutter);
  const logo = j.logo || "full";
  if (logo === "small") { if (lg.small) p.image(lg.small).feed(1); }
  else if (logo !== "none") header(p, lg);
  for (const o of (Array.isArray(j.lines) ? j.lines : [])) {
    if (!o || typeof o !== "object") continue;
    const b = int(o.b) === 1;
    if ("rule" in o) p.rule(str(o.rule).charAt(0) || "-");
    else if ("l" in o) {
      const l = str(o.l), r = str(o.r);
      if (int(o.s || 1) > 1) {
        const c2 = Math.floor(cols / 2), room = c2 - r.length - 1;
        const ll = l.length > room ? l.slice(0, Math.max(0, room)) : l;
        p.bold(true).size(2, 2).line(ll + " ".repeat(Math.max(1, c2 - ll.length - r.length)) + r).size(1, 1).bold(false);
      } else if (l.length + r.length + 1 > cols && r.trim()) p.bold(b).wline(l).lr("", r).bold(false);
      else if (l.length > cols) p.bold(b).wline(l).bold(false);
      else p.bold(b).lr(l, r).bold(false);
    } else {
      const s = int(o.s || 1);
      p.align(o.a === "c" ? 1 : o.a === "r" ? 2 : 0).bold(b);
      if (s > 1) p.size(1, 2);
      p.wline(str(o.t), "");
      if (s > 1) p.size(1, 1);
      p.bold(false).align(0);
    }
  }
  const reviews = Array.isArray(j.reviews)
    ? j.reviews.filter(x => x && str(x.u).trim()).map(x => [str(x.n), str(x.u)])
    : (str(j.review).trim() ? [["", str(j.review)]] : []);
  if (reviews.length) {
    p.rule(); p.align(1).bold(true).size(1, 2).line("ENJOYED YOUR MEAL?").size(1, 1).bold(false);
    p.line("Scan to leave us a review");
    reviews.forEach(([name, url], i) => {
      p.feed(i === 0 ? 2 : 3);
      p.qr(url, cols >= 48 ? 7 : 6);
      if (name.trim()) p.bold(true).line(name).bold(false);
    });
    p.feed(1); p.line("Grazie mille!"); p.align(0);
  }
  if (Array.isArray(j.social)) p.social(j.social.filter(x => x && str(x.u).trim()).map(x => [str(x.n), str(x.h), str(x.u)]));
  p.feed(4); p.cut();
  return p.bytes();
}

/** Table QR labels for label rolls: exact-size pictures, then feed the gap. */
function labels(j, cols, cutter = true) {
  const p = new EscPos(cols, cutter);
  const paper = cols >= 48 ? 576 : 384;
  const W = Math.min(paper, Math.floor((Number(j.w) || 50) * 8));
  const H = Math.min(800, Math.max(80, Math.floor((Number(j.h) || 30) * 8)));
  const gap = Math.min(255, Math.max(0, Math.floor((j.gap === undefined ? 2 : Number(j.gap)) * 8)));
  for (const L of (Array.isArray(j.labels) ? j.labels : [])) {
    if (!L || typeof L !== "object") continue;
    p.image(pics.label(L, W, H));
    if (gap > 0) p.raw(0x1B, 0x4A, gap);
  }
  return p.bytes();
}

// ---- test slips (same as Samples.kt) ----
const now = () => { const d = new Date(); return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const samples = {
  test(cols, lg, cutter) {
    const p = new EscPos(cols, cutter);
    p.image(lg.full); p.feed(1);
    p.align(1).bold(true).size(2, 2).line("PRINT TEST").size(1, 1).bold(false);
    p.line("Trattoria 57 print test (Windows)").line(now()).line(`Paper width: ${cols >= 48 ? "80mm" : "58mm"} (${cols} chars)`);
    p.rule(); p.align(0); p.line("Normal text 0123456789"); p.bold(true).line("Bold text £12.90").bold(false);
    p.size(2, 1).line("Wide text").size(1, 1); p.size(1, 2).line("Tall text").size(1, 1);
    p.rule(); p.lr("Left", "Right"); p.line("Pound sign: £  Dot: ·  Accent: é");
    p.align(1).line("If you can read this,").line("printing works!").align(0); p.feed(4); p.cut();
    return p.bytes();
  },
  kitchen(cols, lg, cutter, big) {
    return ticket({ station: "kitchen", label: "Table 5", no: 7, createdAt: Date.now(), byName: "Gopi", covers: 4,
      items: [{ n: "Pizza Diavola", q: 2, p: 12.9, c: "m", note: "Gluten free base" }, { n: "Bruschetta", en: "Bruschetta", q: 1, p: 6.5, c: "s" },
              { n: "Spaghetti Carbonara", q: 1, p: 12.5, c: "m" }, { n: "Tiramisù", en: "Tiramisu", q: 2, p: 6.5, c: "d", note: "nut allergy" }] },
      cols, lg, { cutter, big });
  },
  bar(cols, lg, cutter, big) {
    return ticket({ station: "bar", label: "Table B4", no: 8, createdAt: Date.now(), byName: "Gopi",
      items: [{ n: "Peroni · Pint", q: 2, p: 6 }, { n: "Aperol Spritz", q: 1, p: 8.5 }, { n: "Coke · Regular", q: 1, p: 2.4, note: "No ice" }] },
      cols, lg, { cutter, big });
  },
  bill(cols, lg, cutter) {
    const L = [{ l: "Table 5", r: now() }, { rule: "-" }, { l: "2 x Pizza Diavola", r: "£25.80" }, { l: "1 x Spaghetti Carbonara", r: "£12.50" },
      { l: "2 x Peroni · Pint", r: "£12.00" }, { rule: "-" }, { l: "Subtotal", r: "£50.30" }, { l: "TOTAL", r: "£50.30", b: 1, s: 2 }, { rule: "-" },
      { t: "Thank you for dining with us!", a: "c" }];
    return job({ lines: L, logo: "full" }, cols, lg, cutter);
  },
};

module.exports = { ticket, job, labels, samples };
