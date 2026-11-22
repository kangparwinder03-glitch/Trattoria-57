// Pictures for the printer (runs in the printer window, which has a canvas):
// kitchen dish names in big heavy letters, the logos, and table QR labels.
// Copies of TextPic.kt, Logo.kt and Labels.kt from the Android printer app.
"use strict";
const path = require("path");
const fs = require("fs");
const { Mono } = require("./escpos");

const FONT = "Arial, 'Segoe UI', Roboto, Helvetica, sans-serif";

function canvas(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#000"; g.strokeStyle = "#000";
  return [c, g];
}

function toMono(g, w, h, test) {
  const px = g.getImageData(0, 0, w, h).data;
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
    bits[i] = test(Math.floor((r * 30 + gg * 59 + b * 11) / 100), a) ? 1 : 0;
  }
  return new Mono(w, h, bits);
}

/** Kitchen tickets: dish and options drawn as a picture in a big, heavy font. Sizes are 80mm dots; 58mm scales down. */
function textPic(text, paper, size80, indent80 = 0) {
  const k = paper / 576, size = size80 * k, indent = indent80 * k;
  const [, m] = canvas(4, 4);
  m.font = `bold ${size}px ${FONT}`;
  const lines = wrap(String(text).trim(), s => m.measureText(s).width, paper, indent);
  const lh = Math.ceil(size * 1.17), asc = size * 0.93;
  const h = Math.max(1, lines.length * lh + 4);
  const [, g] = canvas(paper, h);
  g.font = `bold ${size}px ${FONT}`; g.textBaseline = "alphabetic";
  g.lineWidth = size * 0.035; g.lineJoin = "round";
  lines.forEach((s, i) => { const x = i === 0 ? 0 : indent, y = i * lh + asc; g.fillText(s, x, y); g.strokeText(s, x, y); });
  return toMono(g, paper, h, lum => lum < 140);
}

function wrap(s, measure, width, indent) {
  const out = []; let cur = "";
  const room = () => out.length === 0 ? width : width - indent;
  for (const w0 of s.split(/\s+/).filter(Boolean)) {
    let w = w0;
    const t = cur ? cur + " " + w : w;
    if (measure(t) <= room()) { cur = t; continue; }
    if (cur) { out.push(cur); cur = ""; }
    while (measure(w) > room()) {
      let n = w.length; while (n > 1 && measure(w.slice(0, n)) > room()) n--;
      out.push(w.slice(0, n)); w = w.slice(n);
    }
    cur = w;
  }
  if (cur || !out.length) out.push(cur);
  return out;
}

// ---- logos ----
const cache = {};
function loadImage(file) {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => ok(img); img.onerror = () => bad(new Error("can't load " + file));
    img.src = "data:image/png;base64," + fs.readFileSync(file).toString("base64");
  });
}
async function loadLogo(name) {
  if (cache[name]) return cache[name];
  const img = await loadImage(path.join(__dirname, "..", "assets", name + ".png"));
  const [, g] = canvas(img.width, img.height);
  g.clearRect(0, 0, img.width, img.height); g.drawImage(img, 0, 0);
  return (cache[name] = toMono(g, img.width, img.height, (lum, a) => a > 128 && lum < 128));
}
/** { full, small } for the paper width; both null when the logo is switched off. */
async function logos(cols, on) {
  if (!on) return { full: null, small: null };
  const wide = cols >= 48;
  try { return { full: await loadLogo(wide ? "logo_80" : "logo_58"), small: await loadLogo(wide ? "logo_small_80" : "logo_small_58") }; }
  catch (e) { return { full: null, small: null }; }
}

// ---- table QR labels ----
function label(L, W, H) {
  const [, c] = canvas(W, H);
  const m = 10;
  const rows = Array.isArray(L.qr) ? L.qr : [];
  const n = rows.length;
  let x0 = m;
  if (n > 0) {
    const mod = Math.max(1, Math.floor((H - 2 * m) / (n + 2)));
    const size = mod * (n + 2), ox = m, oy = Math.floor((H - size) / 2);
    for (let r = 0; r < n; r++) { const row = String(rows[r]);
      for (let k = 0; k < row.length; k++) if (row[k] === "1") c.fillRect(ox + (k + 1) * mod, oy + (r + 1) * mod, mod, mod); }
    x0 = ox + size + 8;
  }
  const tw = W - x0 - m;
  const font = (sz, bold, serif) => `${bold ? "bold " : ""}${sz}px ${serif ? "Georgia, 'Times New Roman', serif" : FONT}`;
  const fit = (t, start, bold, serif, spacing = 0) => {
    let sz = start;
    const width = s => { c.font = font(s, bold, serif); return c.measureText(t).width + spacing * s * t.length; };
    while (width(sz) > tw && sz > 10) sz -= 1;
    return sz;
  };
  const brand = L.brand || "TRATTORIA 57", name = L.name || "", l3 = L.line3 || "", l4 = L.line4 || "";
  const sB = fit(brand, H * 0.11, true, true, 0.12), sN = fit(name, H * 0.30, true, false), sS = fit(l3.length > l4.length ? l3 : l4, H * 0.10, false, false);
  const total = sB + sN + sS * 2 + 26;
  let y = (H - total) / 2 + sB;
  c.font = font(sB, true, true);
  let bx = x0; for (const ch of brand) { c.fillText(ch, bx, y); bx += c.measureText(ch).width + sB * 0.12; }
  y += 6; c.fillRect(x0, y - 1, Math.min(tw, bx - x0), 2);
  y += sN + 4; c.font = font(sN, true, false); c.fillText(name, x0, y);
  y += sS + 8; c.font = font(sS, false, false); c.fillText(l3, x0, y);
  y += sS + 2; c.fillText(l4, x0, y);
  return toMono(c, W, H, lum => lum < 140);
}

module.exports = { textPic, logos, label };
