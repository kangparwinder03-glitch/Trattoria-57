// Trattoria 57 for Windows: small helper for the computer-screen layout (desktop.css). Only the Windows app runs it.
// Keeps the docked panels just under the top bar and makes the floor plan re-fit itself when one opens or
// closes; on the order / takeaway "mini tablet", tap anywhere on a dish to add it, and a button switches
// the categories between down the left and across the top.
(function () {
  if (window.__t57desk) return; window.__t57desk = 1;
  const root = document.documentElement;
  const hdr = () => { const h = document.querySelector("header"); if (h) root.style.setProperty("--hdr", h.offsetHeight + "px"); };
  const refit = () => { hdr(); window.dispatchEvent(new Event("resize")); };
  hdr(); addEventListener("resize", hdr);
  // a table's booking and the lists (bookings, open tables, drinks order for…) dock on the right;
  // the order screen pops up in the middle, but takes part so whichever opened last is on top
  const docks = ["ordOv", "xOv", "sheetOv", "bkOv", "nbOv", "listOv"].map(id => document.getElementById(id)).filter(Boolean);
  const open = () => docks.some(o => o.classList.contains("show"));
  let was = open();
  const shown = new Map(docks.map(o => [o, o.classList.contains("show")]));
  const mo = new MutationObserver(() => {
    // whichever opened last goes on top (e.g. tap a table while the bookings list is open)
    // (kept under 50, so booking forms and "are you sure?" boxes still open above them)
    docks.forEach(o => { const s = o.classList.contains("show"); if (s && !shown.get(o)) { docks.forEach(d => d.style.zIndex = "42"); o.style.zIndex = "44"; } shown.set(o, s); });
    const now = open(); if (now !== was) { was = now; requestAnimationFrame(refit); }
  });
  docks.forEach(o => mo.observe(o, { attributes: true, attributeFilter: ["class"] }));

  // tap anywhere on a dish (not only its + button) to add one more
  document.addEventListener("click", e => {
    const mi = e.target.closest && e.target.closest("#ordOv #oBody .mi");
    if (!mi || e.target.closest("button, input, select, textarea, a, label")) return;
    const add = mi.querySelector('[data-a="inc"]'); if (add) add.click();
  });

  // categories down the left, or across the top: a button in the order screen's header, remembered on this computer
  const KEY = "t57-cattop";
  let top = false; try { top = localStorage.getItem(KEY) === "1"; } catch (e) {}
  const lay = document.createElement("button");
  lay.type = "button"; lay.className = "t57lay";
  const show = () => { root.classList.toggle("t57-cattop", top); lay.textContent = top ? "▦ Categories on the left" : "▤ Categories on top"; };
  lay.onclick = () => { top = !top; try { localStorage.setItem(KEY, top ? "1" : "0"); } catch (e) {} show(); };
  const head = document.querySelector("#ordOv .sh-head"), x = head && head.querySelector(".x");
  if (head) head.insertBefore(lay, x || null);
  show();
})();
