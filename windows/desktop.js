// Trattoria 57 for Windows: small helper for the computer-screen layout (desktop.css). Only the Windows app runs it.
// Keeps the docked order panel just under the top bar, and makes the floor plan re-fit itself
// when the panel opens or closes (the floor gets narrower / wider).
(function () {
  if (window.__t57desk) return; window.__t57desk = 1;
  const root = document.documentElement;
  const hdr = () => { const h = document.querySelector("header"); if (h) root.style.setProperty("--hdr", h.offsetHeight + "px"); };
  const refit = () => { hdr(); window.dispatchEvent(new Event("resize")); };
  hdr(); addEventListener("resize", hdr);
  // the order panel, a table's booking and the lists (bookings, open tables, drinks order for…) dock on the right
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
})();
