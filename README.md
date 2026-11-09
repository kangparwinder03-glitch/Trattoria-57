# Trattoria 57 — restaurant app

| Folder | What it is |
|---|---|
| `docs/index.html` | The whole restaurant app (floor plan, bookings, ordering, kitchen, bar, staff, reports). One file — edit it and re-publish. |
| `print-test/` | Android test app for the Bluetooth thermal printer. GitHub builds it automatically (Actions tab). |
| `.github/workflows/` | The automatic build for the Android app. |

**Stage 1 (now):** prove printing works with the print-test app.
**Stage 2 (later):** website + database, then the Android "hub" app that prints kitchen/bar tickets and the day report automatically.

The live working copy is still the Claude version. `docs/index.html` is a backup/source copy — nothing here is live yet.

## Logo on printouts
The print-test app prints the Trattoria 57 logo at the top of every slip:
- full logo on bills, the end-of-day report and the test slip
- a smaller logo on kitchen, bar and pickup tickets (saves paper)

The logo pictures are in `print-test/app/src/main/res/drawable-nodpi/` (`logo_58.png` / `logo_80.png` for 58mm / 80mm paper,
`logo_small_*` for tickets). They are pure black & white at the printer's exact width (384 dots for 58mm, 576 for 80mm).
Untick "Print the Trattoria 57 logo" in the app to print text-only.

## Live system (Supabase)
- Website: https://kangparwinder03-glitch.github.io/Trattoria-57/ — every device shares the same data through Supabase (`supabase/setup.sql`).
- Kitchen / bar tablets: install **T57 Printer** from
  https://github.com/kangparwinder03-glitch/Trattoria-57/releases/download/print-test-latest/T57-Print-Test.apk ,
  choose Kitchen or Bar, pick the Bluetooth printer and tap **Start printing orders**. Leave the app open.
- Bills (🧾 Print bill) and the day report (🧾 Thermal print, manager PIN) print on the bar or kitchen printer.
