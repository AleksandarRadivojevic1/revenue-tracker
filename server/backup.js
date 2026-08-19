import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import db from './db.js';

const KEEP = 14; // retain the most recent N daily snapshots

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

function prune(dir) {
  const snaps = readdirSync(dir)
    .filter((f) => /^payments-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort(); // ISO date names sort chronologically
  for (const old of snaps.slice(0, Math.max(0, snaps.length - KEEP))) {
    rmSync(join(dir, old));
  }
}

// Run once at the next 03:00 UTC, then every 24h. A failure is logged and never
// propagates — losing a backup must not take the app down.
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
    }
  };

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
