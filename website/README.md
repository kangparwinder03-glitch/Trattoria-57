# Trattoria 57 — public website

The customer website: menu, table bookings and opening hours.

- `template.html` — the page. `{{...}}` gaps are filled in by `build.py`.
- `config.json` — address, phone, opening hours, and the booking connection.
- `food.json` — the food menu (Italian name, English name, description, price), taken from the restaurant app.
- `build.py site index.html` makes the finished page; `build.py preview preview.html` makes the design preview.

Bookings: the form calls `t57_web_book` (see `supabase/web-bookings.sql`). The request appears on the tablets
under **Bookings → From the website**, where staff tap **Give a table**.
