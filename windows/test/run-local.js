// Runs the whole app against the pretend database and printers, then checks what was printed.
//   node test/run-local.js        (Linux needs: xvfb-run -a node test/run-local.js)
"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const out = path.join(__dirname, "out"); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const exe = process.env.T57_EXE || require("electron");
const mock = spawn(process.execPath, [path.join(__dirname, "mock.js"), out, "54321", "19100", "19101"], { stdio: "inherit" });
const cfg = {
  email: "test@t57.local", password: "pw", result: path.join(out, "result.json"), shot: path.join(out, "printer-screen.png"),
  tillShot: process.env.T57_TILLSHOT ? path.join(out, "restaurant-screen.png") : "", devices: true,
  waitMs: +(process.env.T57_WAIT || 25000),
  stations: JSON.parse(process.env.T57_STATIONS || JSON.stringify({
    kitchen: { target: "ip:127.0.0.1:19100", cols: 48, copies: 2, cutter: true, big: true, buzz: true },
    bar: { target: "ip:127.0.0.1:19101", cols: 48, copies: 1 },
    till: { target: "ip:127.0.0.1:19101", cols: 48 } })),
};
fs.writeFileSync(path.join(out, "test.json"), JSON.stringify(cfg, null, 1));
setTimeout(() => {
  const args = process.env.T57_EXE ? [] : [path.join(__dirname, "..")];
  if (process.platform === "linux") args.push("--no-sandbox");
  const env = Object.assign({}, process.env, { T57_AUTOTEST: path.join(out, "test.json"), T57_SUPA_BASE: "http://127.0.0.1:54321",
    T57_SITE: process.env.T57_SITE || "about:blank", T57_BACKUP_DIR: path.join(out, "backups"), T57_USER_DATA: path.join(out, "userdata") });
  const app = spawn(exe, args, { env, stdio: "inherit" });
  const kill = setTimeout(() => { console.log("app took too long"); app.kill(); }, 180000);
  app.on("exit", code => {
    clearTimeout(kill); mock.kill("SIGTERM");
    setTimeout(() => {
      let res = {}; try { res = JSON.parse(fs.readFileSync(cfg.result, "utf8")); } catch (e) { console.log("no result file"); process.exit(1); }
      for (const s of res.steps) console.log((s.ok ? "PASS " : "FAIL ") + s.name + (s.info ? "  — " + s.info.slice(0, 300) : ""));
      const bins = fs.readdirSync(out).filter(f => f.endsWith(".bin")).sort();
      console.log("slips printed:", bins.join(", "));
      const db = JSON.parse(fs.readFileSync(path.join(out, "db.json"), "utf8"));
      const printed = Object.values(db).filter(d => d.data.printed && d.data.printedBy).map(d => d.coll + "/" + d.id + "→" + d.data.printedBy);
      console.log("marked printed:", printed.join(", "));
      const lights = Object.values(db).filter(d => d.coll === "printers").map(d => d.id + ":" + (d.data.ok ? "ok" : "not ok") + (d.data.off ? " (off)" : "") + " " + d.data.dev);
      console.log("printer lights:", lights.join(", "));
      const bad = res.steps.filter(s => !s.ok).length + (res.done ? 0 : 1);
      const expect = (process.env.T57_EXPECT || "t1,t2,t3,j1").split(",");
      const miss = expect.filter(id => !printed.some(p => p.includes("/" + id + "→")));
      const wrong = ["t4", "t5", "j2"].filter(id => printed.some(p => p.includes("/" + id + "→")) && id !== "t5");
      if (miss.length) console.log("NOT PRINTED:", miss.join(", "));
      if (wrong.length) console.log("PRINTED BUT SHOULDN'T:", wrong.join(", "));
      process.exit(bad || miss.length || wrong.length ? 1 : 0);
    }, 500);
  });
}, 800);
