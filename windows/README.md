# Trattoria 57 for Windows

One app with a desktop icon that runs everything on a Windows PC or mini PC:

- **The restaurant app** in its own window. It's the same website the tablets use, with the same live orders, bookings and reports.
- **Printing**, like the T57 Printer app on the tablets. The PC can print the kitchen, bar and till tickets, bills and reports, on any of these:
  - a **network printer** on an Ethernet cable or Wi-Fi (type its address, e.g. `192.168.0.250`)
  - a **USB printer** installed in Windows (pick it from the list)
  - a **Bluetooth printer** paired in Windows Settings (it shows up as a COM port)
- **Backups**: a full copy of the database is saved every night after 4am in `Documents\Trattoria 57 Backups`, and kept for 90 days. A **Back up now** button is there too.
- It starts by itself when Windows starts, keeps the PC from going to sleep, and keeps running next to the clock when you close its windows.
- It updates itself between 3am and 3pm only, so an update never interrupts service.

## Install
1. On the Windows PC, download **T57-Windows-Setup.exe** from
   https://github.com/kangparwinder03-glitch/Trattoria-57/releases/download/windows-latest/T57-Windows-Setup.exe
2. Open it. Windows may say "Windows protected your PC". Click **More info**, then **Run anyway**. It warns about any app that isn't sold through Microsoft.
3. It installs in a few seconds and puts a **Trattoria 57** icon on the desktop.

## Set up
1. In the **Printers & backups** window, sign in with the restaurant login.
2. Pick 🍝 Kitchen, 🍸 Bar or 🧾 Till. Tick "This computer prints…", choose the printer and tap **Save & check printer**.
3. Tap **Start printing**. Then switch printing off for that station on the tablet that did it before, so nothing prints twice.
4. In the restaurant app window, sign in once, like on a tablet.

## For developers
- `npm install`, then `npm start` to run it. `xvfb-run -a node test/run-local.js` runs the full test against a pretend database and pretend printers.
- GitHub builds, installs and tests it on Windows on every change (`.github/workflows/windows-app.yml`). Only a build from `main` becomes the public download.
