# Deploying revenue-tracker on the Pi

One container: a Node service (Express API + built Vite front-end) that stores
everything in a single SQLite file it writes itself. It folds into the existing
`~/server/docker-compose.yml` next to seo-cockpit and the rest of the stack.

Target: Raspberry Pi 5 (arm64), `acko@192.168.1.156` / `piserver.local`.

Unlike seo-cockpit, there is **no native module** (it uses Node's built-in
`node:sqlite`), so there is no `better-sqlite3` / glibc / prebuild trap — an
x86 build is representative of the Pi, and the image is ~230 MB with no
Chromium. There is also only **one** container, and it is the **writer**, so
the data mount is read-write.

---

## 1. Layout

```
~/server/revenue-tracker/
  src/    git checkout — code only, and the docker build context
  data/   payments.db. PERSISTENT, deliberately OUTSIDE the checkout
```

`data/` sits beside the checkout, not inside it, so a re-clone or a hard reset
can never destroy it. **This database is hand-entered and cannot be re-fetched
from any API — losing it loses the data permanently.** The repo gitignores the
DB anyway, so it was never version-controlled.

```bash
mkdir -p ~/server/revenue-tracker/data
cd ~/server/revenue-tracker
git clone https://github.com/AleksandarRadivojevic1/revenue-tracker.git src
# thereafter:  git -C ~/server/revenue-tracker/src pull --ff-only
```

---

## 2. Environment (`~/server/.env`)

The app is gated by HTTP Basic Auth over the entire surface (API + UI). This
matters here more than for seo-cockpit: your WireGuard peers include family, and
they route the full tunnel, so any peer can reach `:8092`. Set a password:

```
REV_TRACKER_PASSWORD=<a strong password>
# REV_TRACKER_USER defaults to acko; set it only to override.
# REV_TRACKER_UID / REV_TRACKER_GID default to 1000; set only if `id -u` differs.
```

`REV_TRACKER_PASSWORD` is marked required in the compose snippet (`:?`), so
`docker compose` refuses to start the service if it is unset — the finances
never come up unauthenticated by accident.

Nothing is copied into the image; `.dockerignore` also keeps `.env`, `data/`,
and the DB out of the build context entirely.

---

## 3. Fold in the service

Append the `revenue-tracker` service from `src/deploy/compose.snippet.yml` to
`~/server/docker-compose.yml` under its existing `services:` key.

**Back up and validate — this file runs the whole house:**

```bash
cd ~/server
cp docker-compose.yml docker-compose.yml.bak-$(date +%F-%H%M%S)
sed -n '/^  revenue-tracker:/,$p' revenue-tracker/src/deploy/compose.snippet.yml \
  >> docker-compose.yml
REV_TRACKER_PASSWORD=$(grep -oP 'REV_TRACKER_PASSWORD=\K.*' .env) \
  docker compose config >/dev/null && echo OK || echo "INVALID — restore the backup"
```

Confirm the append changed nothing existing:

```bash
diff docker-compose.yml.bak-* docker-compose.yml | grep '^<' || echo "additions only"
```

---

## 4. Port check

**8092 is what the snippet publishes** (8091 is seo-cockpit). Already taken on
this Pi: 80 homepage, 1880 nodered, 1883 mosquitto, 3000 grafana, 5000
changedetection, 8086 influxdb, 8090 ntfy, 8091 seo-cockpit, 51820/udp
wireguard. Re-check in case the stack changed:

```bash
ss -ltnp | grep 8092 || echo "8092 free"
```

If taken, change the host side of the port mapping in the live compose file
(and the Homepage tile in step 7).

---

## 5. Build and bring up

```bash
cd ~/server
docker compose build revenue-tracker
docker compose up -d revenue-tracker
docker compose ps
docker builder prune -f     # reclaim build cache
```

A Pi 5 builds this natively; no swap tuning or emulation needed.

---

## 6. Verify

```bash
# auth is enforced (401 without creds, 200 with):
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8092/api/bootstrap          # 401
curl -s -o /dev/null -w "%{http_code}\n" -u acko:"$REV_TRACKER_PASSWORD" \
  http://localhost:8092/api/bootstrap                                                 # 200

# the container runs as your uid and can write the DB:
docker compose exec revenue-tracker id
ls -la ~/server/revenue-tracker/data     # payments.db (+ -wal/-shm) appear after first write
```

Then load `http://192.168.1.156:8092` (or `http://piserver.local:8092`), enter
the credentials, and add a project.

### Backups

The app writes a `VACUUM INTO` snapshot nightly at **03:00 UTC** to
`/media/library/backups/revenue-tracker` on the NVMe, keeping the **14 most
recent**. Force one now to confirm the path and permissions:

```bash
docker compose exec revenue-tracker \
  node -e "import('./server/backup.js').then(m=>console.log(m.runBackup()))"
ls -la /media/library/backups/revenue-tracker     # payments-YYYY-MM-DD.db
```

`REV_BACKUP_DIR` unset disables backups by design — there is no SD-card
fallback, because a backup that dies with its original is worse than none.

**To restore:** stop the service and copy a snapshot over `data/payments.db`
(remove any `payments.db-wal` / `-shm` sidecars first). The snapshots are plain
SQLite files — nothing to unpack.

```bash
docker compose stop revenue-tracker
rm -f ~/server/revenue-tracker/data/payments.db-wal ~/server/revenue-tracker/data/payments.db-shm
cp /media/library/backups/revenue-tracker/payments-<date>.db \
   ~/server/revenue-tracker/data/payments.db
docker compose start revenue-tracker
```

---

## 7. Homepage tile

Homepage's config lives at `~/server/homepage`. Add to its `services.yaml`:

```yaml
- Revenue Tracker:
    href: http://192.168.1.156:8092
    description: Client sites — payments, maintenance, revenue
    icon: mdi-cash-multiple
```

Use the IP rather than `piserver.local` — the tile is rendered in *your*
browser, and mDNS is less reliable across clients than the LAN address.

---

## 8. Access from outside the LAN

**Use the existing WireGuard, not a port forward.** Even with the password gate,
publishing `:8092` to the open internet is unnecessary — WireGuard already
carries the LAN off-site (peers for laptop, phone, brother, marija; full-tunnel
`ALLOWEDIPS`). With `wg0` up, `http://192.168.1.156:8092` loads off-LAN exactly
as at home.

```bash
sudo wg-quick up wg0     # then browse to http://192.168.1.156:8092
```

If a client ever needed a link (they should not — this is your internal ops
tool, not a client deliverable), that would need a Cloudflare Tunnel + Access in
front, never a port-forward.

---

## 9. Troubleshooting

**`unable to open database file` on startup / `Permission denied` writing
`payments.db`.** The `user:` override is not matching the owner of `data/`.
Check `id -u`; if not 1000, set `REV_TRACKER_UID`/`REV_TRACKER_GID` in
`~/server/.env`. Verify what the container runs as:

```bash
docker compose exec revenue-tracker id
```

**Service won't start, compose error about `REV_TRACKER_PASSWORD`.** It is
unset in `~/server/.env`. That is the guard working — set it.

**Browser never prompts / loads without asking for a password.**
`REV_TRACKER_PASSWORD` reached the container empty. Auth disables itself when
the password is blank (so local dev stays open); in the container that means
the env var did not propagate. Confirm the live compose file references it and
`.env` has it:

```bash
docker compose exec revenue-tracker printenv REV_TRACKER_PASSWORD
```

**Port 8092 already taken.** Change the host side of `- "8092:3000"` in the live
compose file and the Homepage tile.

**Backups not appearing.** `REV_BACKUP_DIR` must be `/backups` and the NVMe path
`/media/library/backups/revenue-tracker` must exist and be writable by your uid.
The nightly run only fires at 03:00 UTC — use the manual command in step 6 to
test immediately. A backup failure is logged (`[backup] FAILED`) and never
stops the app.

**Everything is UTC on purpose.** The backup schedule is pinned to UTC (`TZ=UTC`)
so 03:00 is predictable regardless of the host clock.
