import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = ':memory:';
let backup;
let dir;
beforeAll(async () => {
  backup = await import('./backup.js');
  dir = mkdtempSync(join(tmpdir(), 'rt-backup-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HOUR = 3600000;
const touch = (name, ageHours, now) => {
  const f = join(dir, name);
  writeFileSync(f, '');
  const t = (now - ageHours * HOUR) / 1000;
  utimesSync(f, t, t);
};

describe('backups', () => {
  it('runBackup writes a dated snapshot', () => {
    const { target } = backup.runBackup(dir);
    expect(existsSync(target)).toBe(true);
    expect(backup.lastBackup(dir).ageHours).toBeLessThan(1);
  });

  it('a recent snapshot is not stale — no alert, no catch-up', async () => {
    const alert = vi.fn();
    const r = await backup.checkMissedBackups(dir, { alert });
    expect(r.stale).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a 14-day-old snapshot (the power-cut case) alerts and catches up', async () => {
    const stale = mkdtempSync(join(tmpdir(), 'rt-stale-'));
    const now = Date.now();
    writeFileSync(join(stale, 'payments-2026-09-22.db'), '');
    utimesSync(join(stale, 'payments-2026-09-22.db'), (now - 14 * 24 * HOUR) / 1000, (now - 14 * 24 * HOUR) / 1000);
    const alert = vi.fn(async () => true);
    const r = await backup.checkMissedBackups(stale, { now, alert });
    expect(r).toMatchObject({ stale: true, newest: 'payments-2026-09-22.db' });
    expect(r.caughtUp).toMatch(/payments-\d{4}-\d{2}-\d{2}\.db$/);
    expect(alert).toHaveBeenCalledOnce();
    expect(alert.mock.calls[0][0].message).toMatch(/payments-2026-09-22\.db, 14 day\(s\) old/);
    rmSync(stale, { recursive: true, force: true });
  });

  it('alerts even when the catch-up itself fails', async () => {
    const alert = vi.fn(async () => true);
    const r = await backup.checkMissedBackups(join(dir, 'nope'), {
      alert, backup: () => { throw new Error('read-only file system'); },
    });
    expect(r).toMatchObject({ stale: true, newest: null, error: 'read-only file system' });
    expect(alert.mock.calls[0][0].message).toMatch(/No snapshot exists yet[^]*FAILED: read-only file system/);
  });

  it('lastBackup ignores files that are not daily snapshots', () => {
    const now = Date.now();
    touch('payments-predeploy-2026-10-08.db', 0, now);
    expect(backup.lastBackup(dir, now).newest).toMatch(/^payments-\d{4}-\d{2}-\d{2}\.db$/);
  });
});
