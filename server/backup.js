import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import db from './db.js';
import { notify } from './notify.js';

const KEEP = 14; // retain the most recent N daily snapshots
// Older than this at startup means at least one nightly run was missed (the
// app or the whole Pi was down — e.g. the 2026-09-22 → 10-06 power cut).
const STALE_HOURS = 26;
const SNAPSHOT = /^payments-\d{4}-\d{2}-\d{2}\.db$/;

// One transactional snapshot via SQLite `VACUUM INTO` — a clean, consistent
// copy even while the app is writing (unlike `cp` on a live WAL database).
export function runBackup(dir = process.env.REV_BACKUP_DIR) {
  if (!dir) return { skipped: true };
  mkdirSync(dir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const target = join(dir, `payments-${date}.db`);
  // VACUUM INTO refuses to overwrite; clear a same-day snapshot first.
  if (existsSync(target)) rmSync(target);

  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  prune(dir);
  return { target };
}

/**
 * Newest snapshot in `dir` and its age in hours (from its mtime), or
 * { newest: null } when there is none yet.
 */
export function lastBackup(dir, now = Date.now()) {
  if (!existsSync(dir)) return { newest: null, ageHours: Infinity };
  const snaps = readdirSync(dir).filter((f) => SNAPSHOT.test(f)).sort();
  const newest = snaps.at(-1) || null;
  if (!newest) return { newest: null, ageHours: Infinity };
  return { newest, ageHours: (now - statSync(join(dir, newest)).mtimeMs) / 3600000 };
}

/**
 * At startup: if the last snapshot is missing or too old, say so on ntfy and
 * take a catch-up snapshot now instead of waiting for 03:00. Returns what it
 * found, for logging/tests.
 */
export async function checkMissedBackups(dir, { now = Date.now(), alert = notify, backup = runBackup } = {}) {
  const { newest, ageHours } = lastBackup(dir, now);
  if (ageHours <= STALE_HOURS) return { stale: false, newest };
  const days = Number.isFinite(ageHours) ? Math.floor(ageHours / 24) : null;
  const what = newest ? `Last snapshot is ${newest}, ${days} day(s) old` : 'No snapshot exists yet';
  let caughtUp = null;
  let error = null;
  try { caughtUp = backup(dir).target; } catch (err) { error = err.message; }
  await alert({
    title: 'revenue-tracker: backups were missed',
    message: `${what} — the app or the Pi was down, or backups failed.\n` +
      (caughtUp ? `Catch-up snapshot written: ${caughtUp}` : `Catch-up snapshot FAILED: ${error}`),
    tags: ['warning', 'floppy_disk'],
  });
  return { stale: true, newest, caughtUp, error };
}

function prune(dir) {
  const snaps = readdirSync(dir)
    .filter((f) => SNAPSHOT.test(f))
    .sort(); // ISO date names sort chronologically
  for (const old of snaps.slice(0, Math.max(0, snaps.length - KEEP))) {
    rmSync(join(dir, old));
  }
}

// Run once at the next 03:00 UTC, then every 24h. A failure is logged, pushed
// to ntfy, and never propagates — losing a backup must not take the app down.
// At startup, a stale or missing last snapshot is alerted and caught up.
export function scheduleBackups(dir = process.env.REV_BACKUP_DIR) {
  if (!dir) {
    console.log('[backup] REV_BACKUP_DIR unset — automatic backups disabled');
    return;
  }
  const safeRun = () => {
    try {
      const { target } = runBackup(dir);
      console.log(`[backup] wrote ${target}`);
    } catch (err) {
      console.error('[backup] FAILED (app continues):', err.message);
      notify({
        title: 'revenue-tracker: backup FAILED',
        message: `Nightly snapshot to ${dir} failed: ${err.message}\nThe app keeps running; check the disk/mount.`,
        tags: ['rotating_light', 'floppy_disk'],
      });
    }
  };

  checkMissedBackups(dir).then((r) => {
    if (r.stale) console.warn(`[backup] last snapshot was stale (${r.newest || 'none'}) — alerted; catch-up: ${r.caughtUp || r.error}`);
  });

  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const msUntil = next - now;

  console.log(`[backup] enabled → ${dir}; first run at ${next.toISOString()}`);
  setTimeout(() => {
    safeRun();
    setInterval(safeRun, 24 * 60 * 60 * 1000);
  }, msUntil);
}
