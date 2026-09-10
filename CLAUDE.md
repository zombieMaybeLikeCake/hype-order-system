# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A React + Express + MariaDB ordering system built for a bar ("HYPE"), open-sourced as a portfolio piece after the paid engagement ended. `client/` and `server.js` live side by side, matching what `server.js` expects at runtime (`express.static(path.join(__dirname,'client','build'))`).

The menu data in `client/src/components/data.js` and `seed_menu_items.sql` is sample data, not the real bar's menu or pricing.

## Architecture

**Stack:** React (react-router-dom, no Redux — state is local + `localStorage`) talking to an Express + MariaDB/MySQL backend (`server.js`), plus standalone Python scripts for scheduled financial exports.

### Frontend (`client/src/components/`)

Routes are declared in `App.js`:
- `/menu` (`Menu.js`) — customer-facing menu. Reads its catalog from the hardcoded `categories`/`products` objects in `data.js` (no menu API call). Table number comes from the `?tableNo=` query param; cart state is kept in `localStorage` under the key `cartItems_${tableNo}`.
- `/cart` (`CartPage.js`) — splits cart items by `category === '場地'` (venue/seating fee) vs. everything else. Submits menu items to `POST /api/orders` and, if any venue line items exist, separately posts a per-person hourly seating charge to `POST /api/venue`.
- `/login`, `/orders` (`OrdersVenuePage.js`) — staff-facing combined view of food orders + venue-fee timers, gated by JWT role, with Web Bluetooth thermal-printer support via `useBluetoothPrinter`.
- `/admin/xlsx` (`AdminXlsxPage.js`) — admin-only: lists/downloads generated `.xlsx` reports, manages employees, shows a live profit/cost window via `GET /api/orders/window`.

All pages that call the API use `const API = ''` (same-origin, served by the Express app) or `axios.create({ baseURL: process.env.REACT_APP_API_BASE || '' })`. Keep new API calls consistent with whichever pattern the file already uses.

### Backend (`server.js`)

Single-file Express app. Auth is JWT (`jsonwebtoken`), roles are `admin` and `employee` (`allowedRoles`/`allowedAdmin` gate specific routes); passwords hashed with `bcryptjs`. DB access goes through a `mysql2/promise` pool, reading `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME` from `.env` (see `.env.example`). The server refuses to start without `JWT_SECRET` set — no silent fallback to a guessable default. CORS is closed by default; set `CORS_ORIGIN` (comma-separated) only if the frontend is served from a different origin than the API.

Core tables: `employees`, `orders`, `order_items`, `menu_items` (`price`/`cost`/`profit` per item), `venue_fees` (per-table hourly seating charge, tracks `people_count`/`start_time`/`end_time`/`is_paid`). See `schema.sql`.

Key endpoint groups:
- `POST /api/login`, `GET/POST/DELETE /api/orders`, `PUT /api/orders/:id/cooked|paid` — order lifecycle.
- `GET /api/orders/window?start=&end=` — aggregates amount/cost/profit across a time range, joining `order_items` with `menu_items`; powers the admin dashboard.
- `POST /api/venue`, `PUT /api/venue/:id/people|end|pay`, `DELETE /api/venue/:id`, `GET /api/venue/unpaid[/:table_no]`, `GET /api/venue/day` — hourly per-person venue-fee tracking. Reducing `people_count` before someone leaves early appends a line to `venue_leave_log.txt`.
- `GET /api/xlsx`, `GET /api/xlsx/:name` (both `verifyAdmin`) — lists/downloads report files from `REPORT_DIR` (`./reports`), where the Python export scripts write.
- `GET/POST/DELETE /api/employees` (`verifyAdmin`) — staff account management.

**Extra-charge parsing:** free-text `custom` notes on an order item (e.g. `"加奶精(+5)"` or `"加麵10"`) are parsed into a numeric surcharge by regex in **two places** — an array-based `parseExtraCharge` inside the `POST /api/orders` handler, and a string-based one at module scope reused by `/api/orders/window` — plus a third, independent implementation in `monthly_paid_items_export.py`. All three must skip any token containing `:`/`：` (labels like `冰塊:正常` are not surcharges) before applying the numeric regexes. If you change the surcharge parsing rules, update all three.

### Python reporting scripts (`*.py`)

Standalone scripts (not imported by the Node server; run via cron/Task Scheduler), each reading `DB_CONF` from the same `.env` as `server.js` and writing `.xlsx` files into `./reports/` for `GET /api/xlsx` to serve:
- `daily_complete_order_export.py` — full order/item dump for the previous business day.
- `hourly_finance_export.py` — runs only during bar operating hours (12:00–07:00 next day, Asia/Taipei) and rolls up unpaid-order profit + in-progress and early-left venue fees for the current hour.
- `monthly_paid_items_export.py` — one workbook per month, one sheet per day, plus a month-end summary sheet of paid items only.

The bar's "business day" spans midnight — it's consistently modeled as **yesterday 12:00 → today 07:00 (Asia/Taipei)**, not a calendar day. Keep this window convention in mind when writing any new report or query against `created_at`/`start_time`.

## Cleanup pass before open-sourcing (2026-09-10)

The repo was extracted from a flat scratch folder and published to GitHub. What changed:

- `server.js` no longer falls back to `'your_secret_key'` when `JWT_SECRET` is unset — it calls `process.exit(1)` instead, across all 11 call sites.
- CORS went from wide-open (`app.use(cors())`) to closed-by-default; it only opens when `CORS_ORIGIN` is set.
- The three Python export scripts stopped hardcoding `DB_CONF` credentials and now read `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME` from the same `.env` as `server.js`, via `python-dotenv`.
- Fixed a real bug: `monthly_paid_items_export.py`'s `parse_extra_charge` was missing the colon-skip rule that `server.js`'s two `parseExtraCharge` implementations already had, so a customization note ending in a digit (e.g. `甜度:正常5`) could be miscounted as a surcharge in the monthly report specifically.
- `client/src/components/data.js` and `seed_menu_items.sql` were replaced with generic sample menu items/prices — the original files held the bar's real menu and pricing.
- Added `.env.example` and `.gitignore` (excludes `.env`, `node_modules/`, `client/build/`, `reports/`, `venue_leave_log.txt`, and the internal `部署資訊.md` deployment/credentials doc, which was never added to git).
- Pinned exact dependency versions in both `package.json` files (were `^`-ranged).
- Removed dead code (`VenueDayOrders`, an unused component in `AdminXlsxPage.js`) and decorative emoji/star markers from comments; silenced two pre-existing `react-hooks/exhaustive-deps` warnings the same way the codebase already silenced others (`// eslint-disable-next-line`) rather than restructuring the effects.
- Left out of the repo entirely: `部署資訊.md` (real IP, DB root password, admin login), the `QRCode/` folder (14 real per-table QR images pointing at a now-decommissioned domain), and unrelated personal files (spreadsheets, a GIS shapefile, `menu.pptx`, video-download scripts) that lived alongside this project in the original scratch folder.
- Verified `node server.js` starts and `npm run build` (client) compiles before pushing.
