import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'payments.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client TEXT DEFAULT '',
    url TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    package TEXT DEFAULT '',           -- catalog key: start | standard | plus | webapp | ''
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,            -- income | expense
    category TEXT NOT NULL DEFAULT 'other',
    label TEXT DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'one_time', -- one_time | monthly | yearly
    next_due TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    charge_id INTEGER REFERENCES charges(id) ON DELETE SET NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    paid_on TEXT NOT NULL DEFAULT (date('now')),
    note TEXT DEFAULT ''
  );

  -- Out-of-project costs (business overhead): subscriptions, tools, hosting,
  -- domains — expenses not tied to any single client project.
  CREATE TABLE IF NOT EXISTS overheads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'tool',   -- hosting | domain | tool | other
    amount REAL NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'monthly', -- one_time | monthly | yearly
    next_due TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  -- Realized overhead spend. Kept even if the overhead is deleted, so totals
  -- never silently drop (ON DELETE SET NULL, not CASCADE).
  CREATE TABLE IF NOT EXISTS overhead_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    overhead_id INTEGER REFERENCES overheads(id) ON DELETE SET NULL,
    amount REAL NOT NULL DEFAULT 0,
    paid_on TEXT NOT NULL DEFAULT (date('now')),
    note TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_currency TEXT NOT NULL DEFAULT 'EUR',
    eur_to_rsd REAL NOT NULL DEFAULT 117.0,
    display_currency TEXT NOT NULL DEFAULT 'EUR'
  );

  INSERT OR IGNORE INTO settings (id) VALUES (1);
`);

// Lightweight migration: add columns that older DB files may be missing.
function ensureColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}
ensureColumn('projects', 'package', "TEXT DEFAULT ''");

export default db;
