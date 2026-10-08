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
# Config via env (defaults match DEPLOY.md):
#   PI_HOST       ssh destination            (acko@192.168.1.156)
#   REMOTE_DIR    snapshot dir on the Pi     (/media/library/backups/revenue-tracker)
#   LOCAL_DIR     where copies are kept      (~/Backups/revenue-tracker)
#   MAX_AGE_DAYS  staleness alarm threshold  (2)
set -euo pipefail

PI_HOST="${PI_HOST:-acko@192.168.1.156}"
REMOTE_DIR="${REMOTE_DIR:-/media/library/backups/revenue-tracker}"
LOCAL_DIR="${LOCAL_DIR:-$HOME/Backups/revenue-tracker}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-2}"

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

before=$(ls "$LOCAL_DIR" | sort)
rsync -a --ignore-existing --include='payments-*.db' --exclude='*' \
  -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' \
  "$PI_HOST:$REMOTE_DIR/" "$LOCAL_DIR/"
after=$(ls "$LOCAL_DIR" | sort)
new=$(comm -13 <(echo "$before") <(echo "$after") || true)

status=0
for f in $new; do
  if command -v sqlite3 >/dev/null; then
    result=$(sqlite3 "$LOCAL_DIR/$f" 'PRAGMA integrity_check;' 2>&1 || true)
    if [ "$result" != "ok" ]; then
      echo "[offsite] CORRUPT snapshot $f: $result" >&2
      status=1
      continue
    fi
  fi
  echo "[offsite] pulled $f"
done
[ -z "$new" ] && echo "[offsite] nothing new"

newest=$(ls "$LOCAL_DIR" | grep -E '^payments-[0-9]{4}-[0-9]{2}-[0-9]{2}\.db$' | sort | tail -1 || true)
if [ -z "$newest" ]; then
  echo "[offsite] no snapshots at all — check REV_BACKUP_DIR on the Pi" >&2
  exit 1
fi
newest_date=${newest#payments-}; newest_date=${newest_date%.db}
age_days=$(( ( $(date -u +%s) - $(date -u -d "$newest_date" +%s) ) / 86400 ))
if [ "$age_days" -gt "$MAX_AGE_DAYS" ]; then
  echo "[offsite] STALE: newest snapshot is $newest ($age_days days old) — Pi backups have stopped" >&2
  exit 1
fi
echo "[offsite] newest: $newest ($age_days day(s) old), $(echo "$after" | grep -c . ) kept in $LOCAL_DIR"
exit $status
