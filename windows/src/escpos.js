// ESC/POS bytes for 58mm / 80mm thermal printers.
// A line-by-line copy of the Android printer app (print-test/.../EscPos.kt), so slips look the same.
"use strict";

const MAP = {
  "£": 0x9C, "·": 0xFA, "█": 0xDB, "▓": 0xB2, "░": 0xB0, "½": 0xAB, "¼": 0xAC, "°": 0xF8,
  "é": 0x82, "è": 0x8A, "ê": 0x88, "ë": 0x89, "à": 0x85, "á": 0xA0, "â": 0x83, "ä": 0x84,
  "ì": 0x8D, "í": 0xA1, "î": 0x8C, "ï": 0x8B, "ò": 0x95, "ó": 0xA2, "ô": 0x93, "ö": 0x94,
  "ù": 0x97, "ú": 0xA3, "û": 0x96, "ü": 0x81, "ñ": 0xA4, "ç": 0x87, "É": 0x90, "Ä": 0x8E,
  "Ö": 0x99, "Ü": 0x9A, "Ñ": 0xA5, "Ç": 0x80,
};
const PLAIN = {
  "×": "x", "▲": "+", "▼": "-", "—": "-", "–": "-", "−": "-", "’": "'", "‘": "'",
  "“": "\"", "”": "\"", "…": "...", "€": "EUR", "À": "A", "È": "E", "Ì": "I", "Ò": "O", "Ù": "U", "œ": "oe",
};

const Text = {
  /** Bytes the printer understands (code page 437). Emoji are left out; anything else unknown prints as "?". */
  cp437(s) {
    const out = [];
    for (const ch of String(s)) {
      const cp = ch.codePointAt(0);
      if (cp >= 32 && cp <= 126) out.push(cp);
      else if (MAP[ch] !== undefined) out.push(MAP[ch]);
      else if (PLAIN[ch] !== undefined) for (const c of PLAIN[ch]) out.push(c.charCodeAt(0));
      else if (cp === 0x200D || (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0x1F000 && cp <= 0x1FFFF) || (cp >= 0x2600 && cp <= 0x27BF) ||
               (cp >= 0x2B00 && cp <= 0x2BFF) || (cp >= 0xE0000 && cp <= 0xE007F)) { /* emoji & joiners */ }
      else out.push(63);
    }
    return out;
  },

  /** Breaks text into lines of at most width letters, between words. */
  wrap(s, width, indent = "  ") {
    if (s.length <= width) return [s];
    const lead = (s.match(/^ */)[0]).slice(0, Math.floor(width / 2));
    const out = [];
    let cur = lead, hasWord = false;
    const flush = () => { out.push(cur); cur = indent; hasWord = false; };
    for (const w0 of s.trim().split(/\s+/).filter(Boolean)) {
      let w = w0;
      while (w.length) {
        const sep = hasWord ? 1 : 0;
        if (cur.length + sep + w.length <= width) { if (sep) cur += " "; cur += w; hasWord = true; w = ""; }
        else if (hasWord) flush();
        else { const r = Math.max(1, width - cur.length); const n = Math.min(r, w.length); cur += w.slice(0, n); w = w.slice(n); hasWord = true; if (w.length) flush(); }
      }
    }
    if (hasWord) out.push(cur);
    return out;
  },
};

/** A 1-bit picture: bits[y*w+x] = 1 for a black dot. */
class Mono { constructor(w, h, bits) { this.w = w; this.h = h; this.bits = bits; } }

class EscPos {
  constructor(cols, hasCutter = true) {
    this.cols = cols; this.hasCutter = hasCutter;
    this.out = []; this.allBold = false; this.curW = 1;
    this.raw(0x1B, 0x40); this.raw(0x1B, 0x74, 0x00);   // initialise + code page 437
  }
  raw(...b) { for (const x of b) this.out.push(x & 0xFF); return this; }
  align(a) { return this.raw(0x1B, 0x61, a); }
  bold(on) { return this.raw(0x1B, 0x45, (on || this.allBold) ? 1 : 0); }
  heavy() { this.allBold = true; return this.raw(0x1B, 0x45, 1).raw(0x1B, 0x47, 1); }
  size(w, h) { this.curW = w; return this.raw(0x1D, 0x21, ((w - 1) << 4) | (h - 1)); }
  text(s) { for (const b of Text.cp437(s)) this.out.push(b); return this; }
  line(s = "") { return this.text(s).raw(0x0A); }
  wline(s, indent = "  ") { for (const l of Text.wrap(s, Math.max(8, Math.floor(this.cols / this.curW)), indent)) this.line(l); return this; }
  feed(n) { return this.raw(0x1B, 0x64, n); }
  cut() { return this.hasCutter ? this.raw(0x1D, 0x56, 0x42, 0x00) : this.feed(3); }
  buzz(times = 3, len = 3) { return this.raw(0x1B, 0x42, Math.min(9, Math.max(1, times)), Math.min(9, Math.max(1, len))); }
  rule(ch = "-") { return this.line(String(ch).charAt(0).repeat(this.cols)); }
  lr(left, right) {
    left = String(left); right = String(right);
    const room = this.cols - right.length - 1;
    const l = left.length > room ? left.slice(0, Math.max(0, room)) : left;
    return this.line(l + " ".repeat(Math.max(0, this.cols - l.length - right.length)) + right);
  }
  paper() { return this.cols >= 48 ? 576 : 384; }
  bar(dots = 10) {
    const bpr = this.paper() / 8;
    this.align(0).raw(0x1D, 0x76, 0x30, 0x00, bpr & 0xFF, bpr >> 8, dots & 0xFF, dots >> 8);
    for (let i = 0; i < bpr * dots; i++) this.out.push(0xFF);
    return this;
  }
  reverse(on) { return this.raw(0x1D, 0x42, on ? 1 : 0); }
  image(m) {
    if (!m) return this;
    const paper = this.paper();
    const w = Math.min(m.w, paper), left = Math.floor((paper - w) / 2), bpr = paper / 8;
    this.align(0);
    for (let y0 = 0; y0 < m.h; y0 += 48) {
      const bh = Math.min(48, m.h - y0);
      this.raw(0x1D, 0x76, 0x30, 0x00, bpr & 0xFF, bpr >> 8, bh & 0xFF, bh >> 8);
      for (let y = y0; y < y0 + bh; y++) for (let bx = 0; bx < bpr; bx++) {
        let v = 0;
        for (let bit = 0; bit < 8; bit++) { const x = bx * 8 + bit - left; if (x >= 0 && x < w && m.bits[y * m.w + x]) v |= (0x80 >> bit); }
        this.out.push(v);
      }
    }
    return this;
  }
  qr(data, size = 5) {
    const b = Buffer.from(String(data), "utf8"); const len = b.length + 3;
    const capM = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412];
    const capL = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520];
    const long = b.length > 42;
    const i = (long ? capL : capM).findIndex(c => b.length <= c);
    const ver = i < 0 ? 15 : i + 1;
    const modules = 17 + 4 * ver;
    const dot = modules <= 29 ? size : Math.max(3, Math.round(size * 29 / modules));
    this.align(1);
    this.raw(0x1D, 0x28, 0x6B, 4, 0, 0x31, 0x41, 0x32, 0x00);
    this.raw(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x43, dot);
    this.raw(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x45, long ? 0x30 : 0x31);
    this.raw(0x1D, 0x28, 0x6B, len & 0xFF, len >> 8, 0x31, 0x50, 0x30); for (const x of b) this.out.push(x);
    this.raw(0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30);
    return this.raw(0x0A);
  }
  social(list) {
    if (!list.length) return this;
    this.rule(); this.align(1).bold(true).size(1, 2).line("FOLLOW US").size(1, 1).bold(false).line("for news, specials & events");
    list.forEach(([name, handle, url], i) => {
      this.feed(i === 0 ? 2 : 3);
      this.qr(url, this.cols >= 48 ? 7 : 6);
      this.bold(true).line(name).bold(false); if (handle) this.line(handle);
    });
    this.feed(2); this.line("Scan to follow our journey"); return this.align(0);
  }
  bytes() { return Buffer.from(this.out); }
}

module.exports = { EscPos, Text, Mono };
