// Sends slips to a printer. Three kinds of printer:
//   ip:192.168.0.250        network printer (Ethernet / Wi-Fi), raw ESC/POS on port 9100
//   com:COM5                Bluetooth printer paired in Windows (it shows up as a COM port), or a serial printer
//   win:POS-80              a printer installed in Windows (USB printers), sent raw through the Windows print queue
"use strict";
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

function split(addr) {
  const a = String(addr).trim(); const i = a.lastIndexOf(":");
  if (i > 0) { const p = parseInt(a.slice(i + 1), 10); if (!isNaN(p)) return [a.slice(0, i), p]; }
  return [a, 9100];
}

function openSock(addr) {
  const [host, port] = split(addr);
  return new Promise((ok, bad) => {
    const s = net.createConnection({ host, port });
    const t = setTimeout(() => { s.destroy(); bad(new Error("no answer")); }, 5000);
    s.once("connect", () => { clearTimeout(t); ok(s); });
    s.once("error", e => { clearTimeout(t); bad(e); });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

const Net = {
  async probe(addr) { const s = await openSock(addr); s.destroy(); },
  async send(addr, bytes) {
    const s = await openSock(addr);
    s.setTimeout(10000);
    try {
      for (let i = 0; i < bytes.length; i += 4096) {
        const chunk = bytes.subarray(i, Math.min(bytes.length, i + 4096));
        await new Promise((ok, bad) => { s.once("error", bad); s.write(chunk, e => { s.off("error", bad); e ? bad(e) : ok(); }); });
      }
      await wait(300 + Math.floor(bytes.length / 100));   // give the printer a moment before hanging up
    } finally { await new Promise(r => s.end(r)); s.destroy(); }
  },
};

// ---- Windows helpers (PowerShell script next to the app) ----
function script() {
  const p = [path.join(process.resourcesPath || "", "rawprint.ps1"), path.join(__dirname, "..", "rawprint.ps1")];
  return p.find(f => { try { return fs.existsSync(f) && !f.includes(".asar" + path.sep); } catch (e) { return false; } }) || p[1];
}
function ps(args, timeout = 60000) {
  return new Promise((ok, bad) => {
    if (process.platform !== "win32") return bad(new Error("only on Windows"));
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script(), ...args],
      { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, out, errOut) => {
        if (err) return bad(new Error((String(errOut || "").trim().split(/\r?\n/).pop()) || err.message));
        ok(String(out));
      });
  });
}
async function viaFile(mode, target, bytes) {
  const f = path.join(os.tmpdir(), `t57-slip-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(f, bytes);
  try { await ps([mode, target, f], 120000); } finally { try { fs.unlinkSync(f); } catch (e) {} }
}

/** Printers Windows knows about: { printers: [names], ports: [{ port, name }] } */
async function listDevices() {
  try { const j = JSON.parse(await ps(["list"], 30000)); return { printers: [].concat(j.printers || []), ports: [].concat(j.ports || []) }; }
  catch (e) { return { printers: [], ports: [], error: e.message }; }
}

/** target: "ip:…", "com:…", "win:…" */
async function probe(target) {
  const [kind, addr] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
  if (kind === "ip") return Net.probe(addr);
  if (kind === "com") return ps(["probe-com", addr], 20000);
  if (kind === "win") return ps(["probe-win", addr], 20000);
  throw new Error("no printer picked");
}
async function send(target, bytes) {
  const [kind, addr] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
  if (kind === "ip") return Net.send(addr, bytes);
  if (kind === "com") return viaFile("com", addr, bytes);
  if (kind === "win") return viaFile("win", addr, bytes);
  throw new Error("no printer picked");
}

module.exports = { probe, send, listDevices, Net };
