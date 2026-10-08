#!/usr/bin/env bash
# Pull revenue-tracker's nightly snapshots off the Pi onto this machine.
#
# Off-site copy for financial records: the Pi writes VACUUM INTO snapshots to
# its NVMe (see DEPLOY.md "Backups"); this pulls them here over SSH (LAN or
# WireGuard). Pull, not push — the Pi holds no credentials to this machine, so
# a compromised Pi can't reach or delete these copies.
#
# Snapshots are named by date and never change, so only new ones transfer and
# every pulled copy is kept (they're tens of KB each). Each new file is
# integrity-checked. Exits non-zero if the newest snapshot is older than
# MAX_AGE_DAYS — that means backups on the Pi have stopped, and the systemd
# unit shows as failed instead of silently going stale.
#
# Alerts (desktop notification + ntfy) when snapshots are stale, corrupt, or
# the Pi has been unreachable for more than MAX_AGE_DAYS. This watcher runs
# OFF the Pi on purpose: when the Pi itself is down (2026-09-22 power cut),
# nothing on it — including its ntfy — can report that. A single unreachable
# day (laptop away, no WireGuard) only logs.
#
# Config via env (defaults match DEPLOY.md):
#   PI_HOST       ssh destination            (acko@192.168.1.156)
#   REMOTE_DIR    snapshot dir on the Pi     (/media/library/backups/revenue-tracker)
#   LOCAL_DIR     where copies are kept      (~/Backups/revenue-tracker)
#   MAX_AGE_DAYS  staleness alarm threshold  (2)
#   NTFY_URL, NTFY_TOPIC, NTFY_TOKEN   optional ntfy target for alerts
#                 (put them in ~/.config/revenue-tracker-backup.env)
set -euo pipefail

PI_HOST="${PI_HOST:-acko@192.168.1.156}"
REMOTE_DIR="${REMOTE_DIR:-/media/library/backups/revenue-tracker}"
LOCAL_DIR="${LOCAL_DIR:-$HOME/Backups/revenue-tracker}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-2}"

STAMP="$LOCAL_DIR/.last-successful-pull"

alert() { # alert "title" "message"
  echo "[offsite] ALERT: $1 — $2" >&2
  if command -v notify-send >/dev/null; then
    notify-send -u critical -a revenue-tracker "$1" "$2" 2>/dev/null || true
  fi
  if [ -n "${NTFY_URL:-}" ] && [ -n "${NTFY_TOPIC:-}" ]; then
    curl -fsS -m 15 -H "Title: $1" -H "Priority: 4" -H "Tags: warning,floppy_disk" \
      ${NTFY_TOKEN:+-H "Authorization: Bearer $NTFY_TOKEN"} \
      -d "$2" "${NTFY_URL%/}/$NTFY_TOPIC" >/dev/null 2>&1 \
      || echo "[offsite] ntfy unreachable (expected if the Pi is down)" >&2
  fi
}

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

before=$(ls "$LOCAL_DIR" | sort)
if ! rsync -a --ignore-existing --include='payments-*.db' --exclude='*' \
  -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' \
  "$PI_HOST:$REMOTE_DIR/" "$LOCAL_DIR/"; then
  last_ok=$(stat -c %Y "$STAMP" 2>/dev/null || echo 0)
  down_days=$(( ( $(date +%s) - last_ok ) / 86400 ))
  if [ "$last_ok" -eq 0 ]; then since="no pull has ever succeeded"; else since="last successful pull ${down_days} day(s) ago"; fi
  if [ "$down_days" -gt "$MAX_AGE_DAYS" ]; then
    alert "revenue-tracker: Pi unreachable" "Can't pull backups from $PI_HOST — $since. Is the Pi down?"
  else
    echo "[offsite] Pi unreachable today; $since — not alerting yet" >&2
  fi
  exit 1
fi
touch "$STAMP"
after=$(ls "$LOCAL_DIR" | sort)
new=$(comm -13 <(echo "$before") <(echo "$after") || true)

status=0
for f in $new; do
  if command -v sqlite3 >/dev/null; then
    result=$(sqlite3 "$LOCAL_DIR/$f" 'PRAGMA integrity_check;' 2>&1 || true)
    if [ "$result" != "ok" ]; then
      alert "revenue-tracker: corrupt backup" "Snapshot $f failed its integrity check: $result"
      status=1
      continue
    fi
  fi
  echo "[offsite] pulled $f"
done
[ -z "$new" ] && echo "[offsite] nothing new"

newest=$(ls "$LOCAL_DIR" | grep -E '^payments-[0-9]{4}-[0-9]{2}-[0-9]{2}\.db$' | sort | tail -1 || true)
if [ -z "$newest" ]; then
  alert "revenue-tracker: no backups" "No snapshots found on $PI_HOST:$REMOTE_DIR — check REV_BACKUP_DIR on the Pi"
  exit 1
fi
newest_date=${newest#payments-}; newest_date=${newest_date%.db}
age_days=$(( ( $(date -u +%s) - $(date -u -d "$newest_date" +%s) ) / 86400 ))
if [ "$age_days" -gt "$MAX_AGE_DAYS" ]; then
  alert "revenue-tracker: backups stopped" "Newest snapshot is $newest ($age_days days old) — backups on the Pi have stopped"
  exit 1
fi
echo "[offsite] newest: $newest ($age_days day(s) old), $(echo "$after" | grep -c . ) kept in $LOCAL_DIR"
exit $status
