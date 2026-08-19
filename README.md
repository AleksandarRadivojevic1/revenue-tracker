# Revenue Tracker

A small, local dashboard to track the economics of the websites I build:
project (build) cost, monthly/yearly maintenance, client-requested features,
per-site expenses, upcoming scheduled payments, and overall revenue.

Built around my real service catalog (Start / Standard / Plus / Web app +
add-ons + maintenance tiers), with a EUR ⇄ RSD display toggle.

## Run it

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

- Front-end: Vite + React (port 5173).
- API: Express + Node's built-in `node:sqlite` (port 5173 proxies `/api` → 3001).
- Data: `payments.db` (SQLite file, gitignored). **Copy that file to back up.**

## Tests

```bash
npm test
```

Unit tests cover the money/date logic in `server/money.js` (due-date
advancement, status, MRR, rollups).

## How the data works

- **Projects** — a site + which package the client used.
- **Charges** — recurring or one-time money items, `income` or `expense`:
  build cost, maintenance (monthly/yearly), features, hosting/domain/tools.
- **Payments** — the actual ledger. Marking a charge *Paid* logs a payment and
  advances its next-due date. Revenue/expense totals come from real payments.
- **Settings** — EUR base + EUR→RSD rate. All amounts stored in EUR; RSD is a
  display conversion only.

## Production / self-host

One process serves both the API and the built front-end:

```bash
npm run build     # → dist/
npm start         # node server/index.js — serves dist/ + /api on $PORT
```

Set a password to gate the whole app (API + UI); leave it unset for open local
dev. See `.env.example` for all variables (`PORT`, `REV_TRACKER_USER`/`PASSWORD`,
`DB_PATH`, `REV_BACKUP_DIR`). When `REV_BACKUP_DIR` is set, the app writes a
nightly `VACUUM INTO` snapshot (keeps the last 14).

### Deploy on the home server (Docker)

`deploy/` contains a `Dockerfile`, a `compose.snippet.yml` to fold into the
Pi's `~/server/docker-compose.yml`, and **`deploy/DEPLOY.md`** with the full
step-by-step (published on port **8092**, Basic Auth, nightly NVMe backups,
Homepage tile, WireGuard access). No native modules, so the image needs no
compiler and an x86 build matches the arm64 Pi.

## Layout

```
server/   Express API + node:sqlite (db.js, index.js), auth.js, backup.js,
          + pure logic (money.js)
src/      React app (pages/, components/), catalog.js = service/price presets
deploy/   Dockerfile, compose.snippet.yml, DEPLOY.md
docs/     Spec (gitignored)
```
